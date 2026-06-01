import * as pc from '../lib/playcanvas.mjs';
import { THRUST_FORCE, VERTICAL_THRUST, MOUSE_SENSITIVITY, PITCH_LIMIT } from './config.js';

// Wires up flight controls:
//  - Mouse (while pointer-locked) yaws/pitches the ship.
//  - WASD applies thrust relative to the ship's facing; Q/E = up/down.
//  - Space brings the ship to a stop.
// Returns an object with update(dt) to be called each frame.
export function registerControls(app, ship) {
    let yaw = 0;    // degrees, around world Y
    let pitch = 0;  // degrees, around local X

    // Pointer lock on click; only steer while locked.
    app.mouse.disableContextMenu();
    const canvas = app.graphicsDevice.canvas;
    canvas.addEventListener('click', () => app.mouse.enablePointerLock());

    app.mouse.on(pc.EVENT_MOUSEMOVE, (e) => {
        // isPointerLocked is a static method on pc.Mouse, not an instance
        // method — calling it as app.mouse.isPointerLocked() threw on every
        // mouse move, killing steering and stuttering the frame loop.
        if (!pc.Mouse.isPointerLocked()) return;
        yaw -= e.dx * MOUSE_SENSITIVITY;
        pitch -= e.dy * MOUSE_SENSITIVITY;
        pitch = pc.math.clamp(pitch, -PITCH_LIMIT, PITCH_LIMIT);
    });

    const desiredRot = new pc.Quat();
    const force = new pc.Vec3();
    const tmp = new pc.Vec3();

    // Reusable Ammo scratch for rewriting the body's orientation in place. Ammo
    // is loaded before controls are registered, so the global exists here.
    const Ammo = globalThis.Ammo;
    const btQuat = new Ammo.btQuaternion(0, 0, 0, 1);
    const btTransform = new Ammo.btTransform();

    function update(/* dt */) {
        const kb = app.keyboard;

        // --- Orientation: override ONLY the body's rotation, in place. ---
        // teleport(ship.getPosition(), ...) used to write the interpolated
        // render position back as the authoritative one, feeding frame-timing
        // jitter into the physics whenever the ship moved. Here we copy the
        // body's own (authoritative) origin back unchanged and replace just the
        // rotation, and never touch the entity transform — so position stays
        // solver-owned and Bullet's render interpolation stays intact (smooth),
        // while steering remains instant 1:1 like a direct set.
        desiredRot.setFromEulerAngles(pitch, yaw, 0);
        const body = ship.rigidbody.body;
        btTransform.setOrigin(body.getWorldTransform().getOrigin());
        btQuat.setValue(desiredRot.x, desiredRot.y, desiredRot.z, desiredRot.w);
        btTransform.setRotation(btQuat);
        body.setWorldTransform(btTransform);
        body.activate();

        // --- Thrust: sum forces along the ship's local axes. ---
        force.set(0, 0, 0);

        if (kb.isPressed(pc.KEY_W)) force.add(tmp.copy(ship.forward).mulScalar(THRUST_FORCE));
        if (kb.isPressed(pc.KEY_S)) force.add(tmp.copy(ship.forward).mulScalar(-THRUST_FORCE));
        if (kb.isPressed(pc.KEY_D)) force.add(tmp.copy(ship.right).mulScalar(THRUST_FORCE));
        if (kb.isPressed(pc.KEY_A)) force.add(tmp.copy(ship.right).mulScalar(-THRUST_FORCE));
        if (kb.isPressed(pc.KEY_Q)) force.add(tmp.copy(ship.up).mulScalar(VERTICAL_THRUST));
        if (kb.isPressed(pc.KEY_E)) force.add(tmp.copy(ship.up).mulScalar(-VERTICAL_THRUST));

        if (force.lengthSq() > 0) {
            ship.rigidbody.applyForce(force);
        }

        if (kb.isPressed(pc.KEY_SPACE)) {
            ship.rigidbody.linearVelocity = pc.Vec3.ZERO;
            ship.rigidbody.angularVelocity = pc.Vec3.ZERO;
        }
    }

    return { update };
}
