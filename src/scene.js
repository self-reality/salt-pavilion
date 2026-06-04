import * as pc from '../lib/playcanvas.mjs';

// Lights the white void so the colored boxes read clearly, hangs a milky fog
// in front of the white background, and disables gravity so everything floats.
export function setupScene(app) {
    // Warm red ambient (#c0392b) scaled by 0.86 intensity.
    app.scene.ambientLight = new pc.Color(0.6475, 0.1922, 0.1450);
    app.scene.skyboxIntensity = 1.03;

    // A soft directional light for gentle shading / a sense of form. Its
    // specular highlight is what the bloom pass turns into a halo.
    const light = new pc.Entity('light');
    light.addComponent('light', {
        type: 'directional',
        color: new pc.Color(1, 1, 1),
        intensity: 3,
        castShadows: false
    });
    light.setEulerAngles(10, -53, 0);
    app.root.addChild(light);

    // Pure-white linear fog matching the white clearColor, so distant geometry
    // dissolves seamlessly into the background instead of greying against it.
    const fog = app.scene.fog;
    fog.type = pc.FOG_LINEAR;
    fog.color = new pc.Color(1, 1, 1);
    fog.start = 3.5;
    fog.end = 46;
    fog.density = 0.096;

    // Zero-G: nothing falls.
    app.systems.rigidbody.gravity = new pc.Vec3(0, 0, 0);

    return { light };
}
