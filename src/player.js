import * as pc from '../lib/playcanvas.mjs';
import {
    PLAYER_SIZE, PLAYER_COLOR, PLAYER_MASS,
    RESTITUTION, FRICTION, LINEAR_DAMPING, ANGULAR_DAMPING,
    EDGE_RADIUS_FRACTION, EDGE_SEGMENTS
} from './config.js';
import { createRoundedBoxMesh } from './roundedbox.js';

// Creates the black spaceship: a dynamic rigidbody box. Movement is driven by
// forces (controls.js); rotation is driven by the mouse (controls.js).
export function createPlayer(app) {
    const material = new pc.StandardMaterial();
    material.diffuse = PLAYER_COLOR;
    material.gloss = 0.76;
    material.metalness = 0.43;
    material.useMetalness = true;
    material.reflectivity = 0.57;
    material.update();

    const he = new pc.Vec3(PLAYER_SIZE.x * 0.5, PLAYER_SIZE.y * 0.5, PLAYER_SIZE.z * 0.5);
    const radius = Math.min(he.x, he.y, he.z) * EDGE_RADIUS_FRACTION;
    const mesh = createRoundedBoxMesh(app.graphicsDevice, he, radius, EDGE_SEGMENTS);

    const ship = new pc.Entity('ship');
    ship.addComponent('render', {
        meshInstances: [new pc.MeshInstance(mesh, material)]
    });

    ship.addComponent('collision', {
        type: 'box',
        halfExtents: new pc.Vec3(PLAYER_SIZE.x * 0.5, PLAYER_SIZE.y * 0.5, PLAYER_SIZE.z * 0.5)
    });

    ship.addComponent('rigidbody', {
        type: 'dynamic',
        mass: PLAYER_MASS,
        restitution: RESTITUTION,
        friction: FRICTION,
        linearDamping: LINEAR_DAMPING,
        angularDamping: ANGULAR_DAMPING
    });

    ship.setPosition(0, 0, 0);
    app.root.addChild(ship);

    return { ship, material };
}
