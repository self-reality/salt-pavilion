import * as pc from '../lib/playcanvas.mjs';
import { BG_COLOR, CAM_TRAIL_DISTANCE, CAM_TRAIL_HEIGHT, CAM_LERP } from './config.js';

// Creates a third-person chase camera that smoothly trails behind the ship.
// The camera is an independent entity (not parented) so it lags/leads naturally.
export function setupCamera(app, ship) {
    const camera = new pc.Entity('camera');
    camera.addComponent('camera', {
        clearColor: BG_COLOR,
        farClip: 1000,
        fov: 60
    });

    // Start already behind the ship so the first frame isn't a swoop-in.
    const start = new pc.Vec3()
        .copy(ship.forward).mulScalar(-CAM_TRAIL_DISTANCE)
        .add(ship.getPosition());
    start.y += CAM_TRAIL_HEIGHT;
    camera.setPosition(start);
    camera.lookAt(ship.getPosition());

    app.root.addChild(camera);

    const desired = new pc.Vec3();
    const current = new pc.Vec3();
    const up = new pc.Vec3(0, 1, 0);

    function update(dt) {
        // Desired position: behind the ship along its forward axis, raised up.
        desired.copy(ship.forward).mulScalar(-CAM_TRAIL_DISTANCE).add(ship.getPosition());
        desired.add(up.clone().mulScalar(CAM_TRAIL_HEIGHT));

        // Frame-rate independent smoothing toward the desired position.
        const t = Math.min(1, CAM_LERP * dt);
        current.lerp(camera.getPosition(), desired, t);
        camera.setPosition(current);
        camera.lookAt(ship.getPosition());
    }

    return { camera, update };
}
