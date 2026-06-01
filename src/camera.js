import * as pc from '../lib/playcanvas.mjs';
import { BG_COLOR, CAM_TRAIL_DISTANCE, CAM_TRAIL_HEIGHT, CAM_LERP } from './config.js';

// Creates a third-person chase camera that trails behind the ship. The trail
// DIRECTION is smoothed (so turns lag/lead naturally), but the trail DISTANCE
// is rigid: the camera sits exactly CAM_TRAIL_DISTANCE behind the ship's real
// position every frame. Smoothing the camera's *position* instead would make
// its per-frame catch-up lag the ship's per-frame travel, so under variable
// frame times the camera-to-ship distance pumps and lookAt turns that pumping
// into a speed-dependent view shake. Keeping distance constant removes it.
export function setupCamera(app, ship) {
    const camera = new pc.Entity('camera');
    camera.addComponent('camera', {
        clearColor: BG_COLOR,
        farClip: 1000,
        fov: 60
    });

    // The HDR env atlas drives glossy reflections, but we don't want it drawn as
    // the background — the world is a white void. Dropping the skybox layer keeps
    // the clearColor backdrop while materials still sample the atlas in-shader.
    camera.camera.layers = camera.camera.layers.filter((id) => id !== pc.LAYERID_SKYBOX);

    // Start already behind the ship so the first frame isn't a swoop-in.
    const start = new pc.Vec3()
        .copy(ship.forward).mulScalar(-CAM_TRAIL_DISTANCE)
        .add(ship.getPosition());
    start.y += CAM_TRAIL_HEIGHT;
    camera.setPosition(start);
    camera.lookAt(ship.getPosition());

    app.root.addChild(camera);

    // Smoothed trailing direction (world-space). Starts aligned with the ship.
    const trailDir = new pc.Vec3().copy(ship.forward);
    const camPos = new pc.Vec3();

    function update(dt) {
        // Smooth only the direction we trail from. Frame-rate-independent
        // exponential decay: equal smoothing regardless of how dt is chopped up.
        const t = 1 - Math.exp(-CAM_LERP * dt);
        trailDir.lerp(trailDir, ship.forward, t);
        if (trailDir.lengthSq() > 1e-8) trailDir.normalize();

        // Rigid offset from the ship's real position -> constant distance.
        camPos.copy(trailDir).mulScalar(-CAM_TRAIL_DISTANCE).add(ship.getPosition());
        camPos.y += CAM_TRAIL_HEIGHT;
        camera.setPosition(camPos);
        camera.lookAt(ship.getPosition());
    }

    return { camera, update };
}
