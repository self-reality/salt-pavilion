import * as pc from '../lib/playcanvas.mjs';
import { THRUST_FORCE, VERTICAL_THRUST, MOUSE_SENSITIVITY, ROLL_RATE } from './config.js';

// 6DOF free-flight controls (no fixed horizon — fly fully inverted or on a side):
//   - Mouse (while pointer-locked) pitches/yaws the ship.
//   - Q/E roll about the nose.
//   - WASD thrust forward/back/strafe; R/F = up/down.
//   - Space brakes the ship smoothly to a stop at thrust strength.
//
// Orientation is a maintained quaternion updated by RELATIVE rotations about the
// ship's LOCAL axes (no Euler clamp, no gimbal lock), then written onto the Ammo
// body in place — position stays solver-owned, rotation controller-owned.
// Returns an object with update(dt) to be called each frame.

// Local-axis unit vectors reused for the per-frame delta rotations.
const AXIS_X = new pc.Vec3(1, 0, 0); // pitch (nose up = +)
const AXIS_Y = new pc.Vec3(0, 1, 0); // yaw   (nose left = +)
const AXIS_Z = new pc.Vec3(0, 0, 1); // roll  (roll left = +)

export function registerControls(app, ship) {
    // Authoritative orientation, seeded from the body's current rotation.
    const orient = new pc.Quat().copy(ship.getRotation());
    const qDelta = new pc.Quat();

    // Apply a rotation of angleDeg about a LOCAL axis (right-multiply = local).
    function rotateLocal(axis, angleDeg) {
        if (!angleDeg) return;
        qDelta.setFromAxisAngle(axis, angleDeg);
        orient.mul(qDelta);
    }

    // Pointer lock on click; only steer while locked.
    app.mouse.disableContextMenu();
    const canvas = app.graphicsDevice.canvas;
    canvas.addEventListener('click', () => app.mouse.enablePointerLock());

    // Accumulate raw mouse pixels in the (async) handler; the update loop
    // consumes them so rotations compose against this frame's orientation.
    let pendingDx = 0, pendingDy = 0;
    app.mouse.on(pc.EVENT_MOUSEMOVE, (e) => {
        // isPointerLocked is a static method on pc.Mouse, not an instance
        // method — calling it as app.mouse.isPointerLocked() throws on every
        // mouse move, killing steering and stuttering the frame loop.
        if (!pc.Mouse.isPointerLocked()) return;
        pendingDx += e.dx;
        pendingDy += e.dy;
    });

    const force = new pc.Vec3();
    const tmp = new pc.Vec3();

    // Reusable Ammo scratch for rewriting the body's orientation in place. Ammo
    // is loaded before controls are registered, so the global exists here.
    const Ammo = globalThis.Ammo;
    const btQuat = new Ammo.btQuaternion(0, 0, 0, 1);
    const btTransform = new Ammo.btTransform();

    function update(dt) {
        const kb = app.keyboard;

        // --- Orientation: relative local-axis rotations from mouse + roll keys. ---
        rotateLocal(AXIS_X, -pendingDy * MOUSE_SENSITIVITY); // mouse down = nose down
        rotateLocal(AXIS_Y, -pendingDx * MOUSE_SENSITIVITY); // mouse right = nose right
        pendingDx = 0; pendingDy = 0;
        if (kb.isPressed(pc.KEY_Q)) rotateLocal(AXIS_Z, ROLL_RATE * dt);  // roll left
        if (kb.isPressed(pc.KEY_E)) rotateLocal(AXIS_Z, -ROLL_RATE * dt); // roll right
        orient.normalize(); // kill the FP drift that repeated mul() accumulates

        // --- Write ONLY the body's rotation, in place. ---
        // teleport(ship.getPosition(), ...) used to write the interpolated render
        // position back as authoritative, feeding frame-timing jitter into the
        // physics whenever the ship moved. Here we copy the body's own origin
        // back unchanged and replace just the rotation, never touching the entity
        // transform — so position stays solver-owned and Bullet's render
        // interpolation stays intact (smooth), while steering is instant 1:1.
        const body = ship.rigidbody.body;
        btTransform.setOrigin(body.getWorldTransform().getOrigin());
        btQuat.setValue(orient.x, orient.y, orient.z, orient.w);
        btTransform.setRotation(btQuat);
        body.setWorldTransform(btTransform);
        body.activate();

        // --- Thrust: sum forces along the ship's local axes. ---
        force.set(0, 0, 0);

        if (kb.isPressed(pc.KEY_W)) force.add(tmp.copy(ship.forward).mulScalar(THRUST_FORCE));
        if (kb.isPressed(pc.KEY_S)) force.add(tmp.copy(ship.forward).mulScalar(-THRUST_FORCE));
        if (kb.isPressed(pc.KEY_D)) force.add(tmp.copy(ship.right).mulScalar(THRUST_FORCE));
        if (kb.isPressed(pc.KEY_A)) force.add(tmp.copy(ship.right).mulScalar(-THRUST_FORCE));
        if (kb.isPressed(pc.KEY_R)) force.add(tmp.copy(ship.up).mulScalar(VERTICAL_THRUST));
        if (kb.isPressed(pc.KEY_F)) force.add(tmp.copy(ship.up).mulScalar(-VERTICAL_THRUST));

        // Brake: push against current velocity at thrust strength. Clamp the
        // force so a single frame can't overshoot into reverse — once the
        // remaining speed is below what this frame would cancel, scale down to
        // land exactly on zero.
        if (kb.isPressed(pc.KEY_SPACE)) {
            const v = ship.rigidbody.linearVelocity;
            const speed = v.length();
            if (speed > 0) {
                const mass = ship.rigidbody.mass;
                const maxDelta = (THRUST_FORCE / mass) * dt;
                const brake = speed > maxDelta ? THRUST_FORCE : (speed / dt) * mass;
                force.add(tmp.copy(v).mulScalar(-brake / speed));
            }
        }

        if (force.lengthSq() > 0) ship.rigidbody.applyForce(force);
    }

    return { update };
}
