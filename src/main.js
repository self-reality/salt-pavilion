import { createApp } from './engine.js';
import { loadAmmo } from './physics.js';
import { setupScene } from './scene.js';
import { createEnvironment } from './environment.js';
import { createPlayer } from './player.js';
import { createObstacles } from './obstacles.js';
import { registerControls } from './controls.js';
import { setupCamera } from './camera.js';
import { setupPostProcess } from './postprocess.js';
import { createDiscoBall } from './discoball.js';
import { createSidebar } from './ui.js';
import { createLoaderMenu } from './loader-ui.js';
import { createAudio } from './audio.js';

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

    // Not awaited: cans.boxes / cans.materials are live arrays that fill in as
    // each can downloads, so the game is playable as soon as the van is in.
    const cans = createObstacles(app, ship);

    // Loader menu (cans loaded / to go, MB, Pause). Shown on every page — it
    // fades out once the collection is fully in.
    createLoaderMenu(cans.loader);

    const camera = setupCamera(app, ship);
    const post = setupPostProcess(app, camera.camera.camera);

    // Game audio: tin-can collision clank + organ thrust drone. The
    // AudioContext can't start until a user gesture, so unlock it on the first
    // pointerdown (the same gesture that triggers click-to-fly). Nothing is
    // audible before then. Created before the controls so they can drive the
    // thrust drone via audio.setThrust() each frame.
    const audio = createAudio();
    window.addEventListener('pointerdown', () => audio.unlock());

    const controls = registerControls(app, ship, audio);
    const disco = createDiscoBall(app, camera.camera, ship, cans.boxes);

    // Registering this listener is also what makes PlayCanvas track the van's
    // contacts. It fires only for van↔can hits: the disco-ball wall is a manual
    // velocity clamp (not a rigidbody), there is no ground, and gravity is off,
    // so a can is the only thing the van's body can actually collide with.
    ship.collision.on('collisionstart', (result) => {
        const other = result.other;
        if (!other || !other.rigidbody) return;
        // Impact strength = the two bodies' relative velocity, projected onto
        // the contact normal (the closing speed) when a contact point is
        // available, else its raw magnitude. Robust across engine versions;
        // contact impulse is not reliably populated.
        const rel = ship.rigidbody.linearVelocity.clone().sub(other.rigidbody.linearVelocity);
        const contact = result.contacts && result.contacts[0];
        const speed = contact && contact.normal ? Math.abs(rel.dot(contact.normal)) : rel.length();
        audio.trigger(speed);
    });

    // The tuning panel is opt-in: tweaks.html sets this flag before the module
    // loads, the public index.html does not. Keeps the deployed page clean.
    if (window.SPAM_TWEAKS) {
        createSidebar({
            app, scene: app.scene, light, materials: cans.materials,
            playerMaterial, ship, van, cans, controls, cf: post.cf, disco, audio
        });
    }

    app.on('update', (dt) => {
        controls.update(dt);
        camera.update(dt);
        disco.update(dt);
    });

    // Hide the "click to start" hint once the pointer is locked.
    const hint = document.getElementById('hint');
    document.addEventListener('pointerlockchange', () => {
        hint.style.display = document.pointerLockElement ? 'none' : '';
    });

    console.log('[SPAM] ready: ship in, physics online, cans streaming');
    cans.ready
        .then(() => console.log(`[SPAM] all ${cans.boxes.length} cans loaded`))
        .catch((err) => console.error('[SPAM] can loading failed:', err));
}

boot().catch((err) => {
    console.error('[SPAM] boot failed:', err);
});
