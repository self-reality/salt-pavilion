import * as pc from '../lib/playcanvas.mjs';

// Lights the white void so the colored boxes read clearly, and disables
// gravity so everything floats (zero-G).
export function setupScene(app) {
    // High ambient keeps the matte boxes bright against the white background.
    app.scene.ambientLight = new pc.Color(0.55, 0.55, 0.55);

    // A soft directional light for gentle shading / a sense of form.
    const light = new pc.Entity('light');
    light.addComponent('light', {
        type: 'directional',
        color: new pc.Color(1, 1, 1),
        intensity: 0.9,
        castShadows: false
    });
    light.setEulerAngles(50, 30, 0);
    app.root.addChild(light);

    // Zero-G: nothing falls.
    app.systems.rigidbody.gravity = new pc.Vec3(0, 0, 0);
}
