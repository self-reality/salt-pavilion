import * as pc from '../lib/playcanvas.mjs';
import { THRUST_FORCE, VERTICAL_THRUST, MOUSE_SENSITIVITY, PITCH_LIMIT } from './config.js';

// Wires up flight controls:
//  - Mouse (while pointer-locked) yaws/pitches the ship.
//  - WASD applies thrust relative to the ship's facing; Space/Shift = up/down.
// Returns an object with update(dt) to be called each frame.
export function registerControls(app, ship) {
    let yaw = 0;    // degrees, around world Y
    let pitch = 0;  // degrees, around local X

    // Pointer lock on click; only steer while locked.
    app.mouse.disableContextMenu();
    const canvas = app.graphicsDevice.canvas;
    canvas.addEventListener('click', () => app.mouse.enablePointerLock());

    app.mouse.on(pc.EVENT_MOUSEMOVE, (e) => {
        if (!app.mouse.isPointerLocked()) return;
        yaw -= e.dx * MOUSE_SENSITIVITY;
        pitch -= e.dy * MOUSE_SENSITIVITY;
        pitch = pc.math.clamp(pitch, -PITCH_LIMIT, PITCH_LIMIT);
    });

    const desiredRot = new pc.Quat();
    const force = new pc.Vec3();
    const tmp = new pc.Vec3();

    function update(/* dt */) {
        const kb = app.keyboard;

        // --- Orientation: drive the dynamic body's rotation directly. ---
        desiredRot.setFromEulerAngles(pitch, yaw, 0);
        // Keep the physics-updated position, override only the rotation so the
        // player steers while collisions still translate the ship.
        ship.rigidbody.teleport(ship.getPosition(), desiredRot);

        // --- Thrust: sum forces along the ship's local axes. ---
        force.set(0, 0, 0);

        if (kb.isPressed(pc.KEY_W)) force.add(tmp.copy(ship.forward).mulScalar(THRUST_FORCE));
        if (kb.isPressed(pc.KEY_S)) force.add(tmp.copy(ship.forward).mulScalar(-THRUST_FORCE));
        if (kb.isPressed(pc.KEY_D)) force.add(tmp.copy(ship.right).mulScalar(THRUST_FORCE));
        if (kb.isPressed(pc.KEY_A)) force.add(tmp.copy(ship.right).mulScalar(-THRUST_FORCE));
        if (kb.isPressed(pc.KEY_SPACE)) force.add(tmp.copy(ship.up).mulScalar(VERTICAL_THRUST));
        if (kb.isPressed(pc.KEY_SHIFT)) force.add(tmp.copy(ship.up).mulScalar(-VERTICAL_THRUST));

        if (force.lengthSq() > 0) {
            ship.rigidbody.applyForce(force);
        }
    }

    return { update };
}
