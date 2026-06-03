import { createApp } from './engine.js';
import { loadAmmo } from './physics.js';
import { setupScene } from './scene.js';
import { createEnvironment } from './environment.js';
import { createPlayer } from './player.js';
import { createObstacles } from './obstacles.js';
import { registerControls } from './controls.js';
import { setupCamera } from './camera.js';
import { setupPostProcess } from './postprocess.js';
import { createSidebar } from './ui.js';

async function boot() {
    const canvas = document.getElementById('app');

    // Physics MUST be loaded BEFORE the app is created: the rigidbody system
    // initializes its dynamics world at construction only if Ammo already
    // exists. Creating the app first leaves the world uninitialized.
    await loadAmmo();

    const app = createApp(canvas);

    // start() initializes the rigidbody dynamics world and its ammo temp
    // objects. This must happen before any rigidbody component is created.
    app.start();

    const { light } = setupScene(app);

    // Kick off the HDR reflection atlas; it pops in once the map downloads.
    createEnvironment(app);

    const { ship, material: playerMaterial, van } = await createPlayer(app);
    const { boxes: obstacles, materials } = createObstacles(app);
    const camera = setupCamera(app, ship);
    const post = setupPostProcess(app, camera.camera.camera);
    const controls = registerControls(app, ship);

    createSidebar({
        app, scene: app.scene, light, materials, playerMaterial, van, cf: post.cf
    });

    app.on('update', (dt) => {
        controls.update(dt);
        camera.update(dt);
    });

    // Hide the "click to start" hint once the pointer is locked.
    const hint = document.getElementById('hint');
    document.addEventListener('pointerlockchange', () => {
        hint.style.display = document.pointerLockElement ? 'none' : '';
    });

    console.log(`[SPAM] ready: ship + ${obstacles.length} obstacles, physics online`);
}

boot().catch((err) => {
    console.error('[SPAM] boot failed:', err);
});
