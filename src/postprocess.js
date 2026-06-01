import * as pc from '../lib/playcanvas.mjs';

// Routes the camera through PlayCanvas's HDR CameraFrame pipeline so specular
// highlights can exceed 1.0 and bloom into a soft halo. Tone mapping is NEUTRAL
// because it keeps the white background closest to white; bloom is kept low so
// only the bright reflected sun flares rather than the whole milky void.
export function setupPostProcess(app, cameraComponent) {
    const cf = new pc.CameraFrame(app, cameraComponent);
    cf.rendering.toneMapping = pc.TONEMAP_NEUTRAL;
    cf.rendering.samples = 4;
    cf.bloom.intensity = 0.02;
    cf.bloom.blurLevel = 16;
    cf.update();
    return { cf };
}
