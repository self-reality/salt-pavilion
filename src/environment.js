import * as pc from '../lib/playcanvas.mjs';

export const DEFAULT_ENV = {
    skyTop: [255, 255, 255],
    skyBottom: [232, 238, 245],
    sunU: 0.5,
    sunV: 0.35,
    sunSize: 0.12,
    sunBright: 0.7
};

// Builds the reflection environment. There is no skybox or external HDRI — the
// world is a white void — so glossy surfaces would have nothing to reflect. We
// paint a 2:1 equirect "sky" on a canvas (a milky vertical gradient plus one
// soft bright sun spot) and run it through EnvLighting to produce the prefiltered
// atlas that scene.envAtlas consumes. The bright sun is what slides across the
// glossy boxes as a moving highlight, and what the bloom pass flares into a halo.
export function createEnvironment(app) {
    const device = app.graphicsDevice;
    const W = 512, H = 256;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');

    let source = null;
    let atlas = null;

    function paint(p) {
        const g = ctx.createLinearGradient(0, 0, 0, H);
        g.addColorStop(0, `rgb(${p.skyTop.join(',')})`);
        g.addColorStop(1, `rgb(${p.skyBottom.join(',')})`);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);

        const sx = p.sunU * W, sy = p.sunV * H;
        const r = Math.max(1, p.sunSize * W);
        const rg = ctx.createRadialGradient(sx, sy, 0, sx, sy, r);
        rg.addColorStop(0, `rgba(255,255,255,${p.sunBright})`);
        rg.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = rg;
        ctx.fillRect(0, 0, W, H);
    }

    function rebuild(p) {
        paint(p);
        // A canvas-backed texture can be unreliable to re-upload in place, so we
        // recreate the lightweight source each time and reproject into the same
        // atlas target to avoid leaking GPU textures while dragging sliders.
        if (source) source.destroy();
        source = new pc.Texture(device, {
            name: 'env-source',
            width: W,
            height: H,
            format: pc.PIXELFORMAT_RGBA8,
            projection: pc.TEXTUREPROJECTION_EQUIRECT,
            mipmaps: true,
            levels: [canvas]
        });
        atlas = pc.EnvLighting.generateAtlas(source, atlas ? { target: atlas } : undefined);
        app.scene.envAtlas = atlas;
    }

    return { rebuild };
}
