import * as pc from '../lib/playcanvas.mjs';

// Reflection environment. The world is a white void with no skybox, so glossy
// surfaces would have nothing to reflect. We load an equirectangular HDR and
// prefilter it into the atlas that scene.envAtlas consumes — the same
// venice-sunset map the spam-can renderer reflects off the can. The bright sky
// and sun in the HDR are what slide across the glossy boxes as moving
// highlights, and what the bloom pass flares into a halo.
const ENV_MAP_URL =
    'https://cdn.jsdelivr.net/gh/mrdoob/three.js@r164/examples/textures/equirectangular/venice_sunset_1k.hdr';

export function createEnvironment(app) {
    // Empty data object lets the HDR parser tag the asset as RGBE on load.
    const asset = new pc.Asset('env-hdr', 'texture', { url: ENV_MAP_URL }, {});

    const ready = new Promise((resolve) => {
        asset.once('load', () => {
            const source = asset.resource;
            source.projection = pc.TEXTUREPROJECTION_EQUIRECT;

            // Prefilter the equirect HDR into a mip-chained cubemap, then pack
            // that into the equirect atlas scene.envAtlas reads each frame.
            const lighting = pc.EnvLighting.generateLightingSource(source);
            const atlas = pc.EnvLighting.generateAtlas(lighting);
            lighting.destroy();
            app.scene.envAtlas = atlas;
            resolve(atlas);
        });
        asset.once('error', (err) => {
            console.error('[SPAM] env HDR load failed:', err);
            resolve(null);
        });
    });

    app.assets.add(asset);
    app.assets.load(asset);

    return { ready };
}
