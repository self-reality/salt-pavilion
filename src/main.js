import { createApp } from './engine.js';
import { loadAmmo } from './physics.js';
import { setupScene } from './scene.js';
import { createPlayer } from './player.js';
import { createObstacles } from './obstacles.js';
import { registerControls } from './controls.js';
import { setupCamera } from './camera.js';

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

    setupScene(app);
    const ship = createPlayer(app);
    const obstacles = createObstacles(app);
    const camera = setupCamera(app, ship);
    const controls = registerControls(app, ship);

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
