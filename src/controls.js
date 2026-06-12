import * as pc from '../lib/playcanvas.mjs';
import { THRUST_FORCE, VERTICAL_THRUST, HANDLING_FORCE, MOUSE_SENSITIVITY, ROLL_RATE } from './config.js';

// 6DOF free-flight controls (no fixed horizon — fly fully inverted or on a side):
//   - Mouse (while pointer-locked) pitches/yaws the ship.
//   - Q/E roll about the nose.
//   - WASD thrust forward/back/strafe; R/F = up/down.
//   - "Handling": any local axis with NO thrust input this frame is braked
//     toward zero velocity (HANDLING_FORCE). Stray off-nose drift bleeds away so
//     the ship follows where it points, and letting off all keys coasts it to a
//     gradual stop. Momentum along an axis you ARE thrusting is left untouched,
//     so inertia in your chosen direction survives. setHandling() retunes it live.
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

    // Per-axis brake strength; retuned live from the panel via setHandling().
    let handling = HANDLING_FORCE;

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

        // --- Thrust along the ship's local axes, plus a per-axis handling brake. ---
        // Each axis pair (forward/back, right/left, up/down) thrusts only while a
        // key is held. An axis with NO input is braked toward zero velocity at
        // `handling` strength, clamped so a single frame can't overshoot into
        // reverse — so stray sideways/vertical drift (e.g. the horizontal momentum
        // left over when you pitch into a dive) bleeds away and the ship swings to
        // follow its nose, while letting off all keys coasts it to a gradual stop.
        force.set(0, 0, 0);

        const v = ship.rigidbody.linearVelocity;
        const mass = ship.rigidbody.mass;
        const key = (k) => (kb.isPressed(k) ? 1 : 0);

        // dir = -1/0/+1 input along the axis; thrust = force magnitude for that axis.
        function axis(axisVec, dir, thrust) {
            if (dir) { force.add(tmp.copy(axisVec).mulScalar(thrust * dir)); return; }
            const comp = v.dot(axisVec);            // signed speed along this axis
            const speed = Math.abs(comp);
            if (speed === 0) return;
            const maxDelta = (handling / mass) * dt; // clamp so one frame can't reverse
            const brake = speed > maxDelta ? handling : (speed / dt) * mass;
            force.add(tmp.copy(axisVec).mulScalar(-Math.sign(comp) * brake));
        }

        axis(ship.forward, key(pc.KEY_W) - key(pc.KEY_S), THRUST_FORCE);
        axis(ship.right,   key(pc.KEY_D) - key(pc.KEY_A), THRUST_FORCE);
        axis(ship.up,      key(pc.KEY_R) - key(pc.KEY_F), VERTICAL_THRUST);

        if (force.lengthSq() > 0) ship.rigidbody.applyForce(force);
    }

    return { update, setHandling: (v) => { handling = v; } };
}
