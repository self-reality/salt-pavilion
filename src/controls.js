import * as pc from '../lib/playcanvas.mjs';
import {
    THRUST_FORCE, VERTICAL_THRUST, MOUSE_SENSITIVITY,
    DEFAULT_SCHEME, ROLL_RATE, PITCH_RATE, TURN_COUPLING,
    AUTO_LEVEL_RATE, THROTTLE_ACCEL, THROTTLE_MAX
} from './config.js';

// Flight controls with three live-switchable schemes (pick one in the sidebar):
//
//   'spaceship' — 6DOF free flight. Mouse pitch/yaw, Q/E roll, WASD thrust,
//                 R/F vertical, Space smart-brake. No horizon: fly fully inverted.
//   'airplane'  — bank-to-turn. A/D (or arrows) bank, W/S pitch, banking yaws the
//                 nose (coordinated turn). Shift/Ctrl = throttle. No horizon.
//   'arcade'    — mouse pitch/yaw like spaceship, but the wings auto-level to a
//                 soft horizon when no roll key is held. Easiest to fly.
//
// Orientation is a maintained quaternion updated by RELATIVE rotations about the
// ship's LOCAL axes (no Euler clamp, no gimbal lock), then written onto the Ammo
// body in place — position stays solver-owned, rotation controller-owned.
// Returns { update(dt), setScheme(name), getScheme(), schemes }.
const SCHEMES = ['spaceship', 'airplane', 'arcade'];

// Local-axis unit vectors reused for the per-frame delta rotations.
const AXIS_X = new pc.Vec3(1, 0, 0); // pitch (nose up = +)
const AXIS_Y = new pc.Vec3(0, 1, 0); // yaw   (nose left = +)
const AXIS_Z = new pc.Vec3(0, 0, 1); // roll  (roll left = +; right wing up)

export function registerControls(app, ship) {
    let scheme = SCHEMES.includes(DEFAULT_SCHEME) ? DEFAULT_SCHEME : 'spaceship';

    // Authoritative orientation, seeded from the body's current rotation.
    const orient = new pc.Quat().copy(ship.getRotation());
    const qDelta = new pc.Quat();

    // Apply a rotation of angleDeg about a LOCAL axis (right-multiply = local).
    function rotateLocal(axis, angleDeg) {
        if (!angleDeg) return;
        qDelta.setFromAxisAngle(axis, angleDeg);
        orient.mul(qDelta);
    }

    // Pointer lock on click; only the mouse-steered schemes read it.
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

    let throttle = 0; // airplane only: persistent forward force

    const force = new pc.Vec3();
    const tmp = new pc.Vec3();

    // Reusable Ammo scratch for rewriting the body's orientation in place. Ammo
    // is loaded before controls are registered, so the global exists here.
    const Ammo = globalThis.Ammo;
    const btQuat = new Ammo.btQuaternion(0, 0, 0, 1);
    const btTransform = new Ammo.btTransform();

    // Consume buffered mouse motion as local pitch/yaw deltas. Always called so
    // motion can't pile up while flying a keyboard scheme and fling the ship on
    // the way back to a mouse scheme.
    function applyMouseLook() {
        rotateLocal(AXIS_X, -pendingDy * MOUSE_SENSITIVITY); // mouse down = nose down
        rotateLocal(AXIS_Y, -pendingDx * MOUSE_SENSITIVITY); // mouse right = nose right
        pendingDx = 0; pendingDy = 0;
    }

    function updateSpaceship(dt, kb) {
        applyMouseLook();
        if (kb.isPressed(pc.KEY_Q)) rotateLocal(AXIS_Z, ROLL_RATE * dt);  // roll left
        if (kb.isPressed(pc.KEY_E)) rotateLocal(AXIS_Z, -ROLL_RATE * dt); // roll right
    }

    function updateArcade(dt, kb) {
        applyMouseLook();
        let rolled = false;
        if (kb.isPressed(pc.KEY_Q)) { rotateLocal(AXIS_Z, ROLL_RATE * dt); rolled = true; }
        if (kb.isPressed(pc.KEY_E)) { rotateLocal(AXIS_Z, -ROLL_RATE * dt); rolled = true; }
        // Soft horizon: with no roll input, null the bank (roll error only, so
        // pitch/heading are untouched and loops still work). Frame-rate-
        // independent exponential decay, same idiom as the camera smoothing.
        if (!rolled) {
            const right = ship.right, up = ship.up;
            const rollErr = Math.atan2(right.y, up.y) * pc.math.RAD_TO_DEG;
            if (Math.abs(rollErr) > 0.05) {
                const t = 1 - Math.exp(-AUTO_LEVEL_RATE * dt);
                rotateLocal(AXIS_Z, -rollErr * t);
            }
        }
    }

    function updateAirplane(dt, kb) {
        // Bank with A/D or the arrow keys.
        if (kb.isPressed(pc.KEY_A) || kb.isPressed(pc.KEY_LEFT)) rotateLocal(AXIS_Z, ROLL_RATE * dt);
        if (kb.isPressed(pc.KEY_D) || kb.isPressed(pc.KEY_RIGHT)) rotateLocal(AXIS_Z, -ROLL_RATE * dt);
        // Pitch with W/S or up/down (W = nose up, like pulling a stick back-ish).
        if (kb.isPressed(pc.KEY_W) || kb.isPressed(pc.KEY_UP)) rotateLocal(AXIS_X, PITCH_RATE * dt);
        if (kb.isPressed(pc.KEY_S) || kb.isPressed(pc.KEY_DOWN)) rotateLocal(AXIS_X, -PITCH_RATE * dt);
        // Coordinated turn: a bank yaws the nose proportionally to how far the
        // right wing has dipped. Inverted flight flips right.y, reversing the
        // turn — which is the correct behaviour for a banked inverted turn.
        rotateLocal(AXIS_Y, ship.right.y * TURN_COUPLING * dt);
    }

    function writeOrientation() {
        orient.normalize(); // kill the FP drift that repeated mul() accumulates
        const body = ship.rigidbody.body;
        // teleport(ship.getPosition(), ...) used to write the interpolated render
        // position back as authoritative, feeding frame-timing jitter into the
        // physics whenever the ship moved. Here we copy the body's own origin
        // back unchanged and replace just the rotation, never touching the entity
        // transform — so position stays solver-owned and Bullet's render
        // interpolation stays intact (smooth), while steering is instant 1:1.
        btTransform.setOrigin(body.getWorldTransform().getOrigin());
        btQuat.setValue(orient.x, orient.y, orient.z, orient.w);
        btTransform.setRotation(btQuat);
        body.setWorldTransform(btTransform);
        body.activate();
    }

    function applyThrust(dt, kb) {
        force.set(0, 0, 0);

        if (scheme === 'airplane') {
            // Persistent throttle along the nose; no strafe/vertical/brake.
            if (kb.isPressed(pc.KEY_SHIFT)) throttle += THROTTLE_ACCEL * dt;
            if (kb.isPressed(pc.KEY_CONTROL)) throttle -= THROTTLE_ACCEL * dt;
            throttle = pc.math.clamp(throttle, 0, THROTTLE_MAX);
            if (throttle > 0) force.add(tmp.copy(ship.forward).mulScalar(throttle));
            if (force.lengthSq() > 0) ship.rigidbody.applyForce(force);
            return;
        }

        // spaceship / arcade: zero-G thrust relative to the ship's axes.
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

    function update(dt) {
        const kb = app.keyboard;
        if (scheme === 'airplane') updateAirplane(dt, kb);
        else if (scheme === 'arcade') updateArcade(dt, kb);
        else updateSpaceship(dt, kb);
        writeOrientation();
        applyThrust(dt, kb);
    }

    function setScheme(name) {
        if (!SCHEMES.includes(name) || name === scheme) return;
        scheme = name;
        // Re-seed from the body's live rotation so the switch never snaps the
        // ship, and clear transient state that shouldn't carry across schemes.
        orient.copy(ship.getRotation());
        throttle = 0;
        pendingDx = 0; pendingDy = 0;
    }

    return { update, setScheme, getScheme: () => scheme, schemes: SCHEMES.slice() };
}
