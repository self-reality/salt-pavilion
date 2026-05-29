import * as pc from '../lib/playcanvas.mjs';
import { BG_COLOR } from './config.js';

// Creates the PlayCanvas application bound to the canvas, wires input devices,
// and configures the canvas to fill the window. Does NOT call app.start() —
// the caller must start the app only after ammo physics has finished loading.
export function createApp(canvas) {
    const app = new pc.Application(canvas, {
        mouse: new pc.Mouse(canvas),
        keyboard: new pc.Keyboard(window)
    });

    app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW);
    app.setCanvasResolution(pc.RESOLUTION_AUTO);

    window.addEventListener('resize', () => app.resizeCanvas());

    // White-void background.
    app.scene.clearColor = BG_COLOR;

    return app;
}
