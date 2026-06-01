import * as pc from '../lib/playcanvas.mjs';

// Lights the white void so the colored boxes read clearly, hangs a milky fog
// in front of the white background, and disables gravity so everything floats.
export function setupScene(app) {
    app.scene.ambientLight = new pc.Color(0.5, 0.5, 0.5);

    // A soft directional light for gentle shading / a sense of form. Its
    // specular highlight is what the bloom pass turns into a halo.
    const light = new pc.Entity('light');
    light.addComponent('light', {
        type: 'directional',
        color: new pc.Color(1, 1, 1),
        intensity: 0.9,
        castShadows: false
    });
    light.setEulerAngles(50, 30, 0);
    app.root.addChild(light);

    // Milk diluted with water: a near-white linear fog that only softens the
    // distance, leaving the white clearColor as the background.
    const fog = app.scene.fog;
    fog.type = pc.FOG_LINEAR;
    fog.color = new pc.Color(0.93, 0.95, 0.97);
    fog.start = 10;
    fog.end = 55;

    // Zero-G: nothing falls.
    app.systems.rigidbody.gravity = new pc.Vec3(0, 0, 0);

    return { light };
}
