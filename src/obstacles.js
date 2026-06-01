import * as pc from '../lib/playcanvas.mjs';
import {
    PLAYER_SIZE, OBSTACLE_COUNT, OBSTACLE_MIN_SCALE, OBSTACLE_MAX_SCALE,
    OBSTACLE_MASS, RESTITUTION, FRICTION, SPAWN_RADIUS, INITIAL_DRIFT, PALETTE,
    EDGE_RADIUS_FRACTION, EDGE_SEGMENTS
} from './config.js';
import { createRoundedBoxMesh } from './roundedbox.js';

function rand(min, max) {
    return min + Math.random() * (max - min);
}

// Spawns OBSTACLE_COUNT colored boxes floating near the origin. Each box has
// non-uniform dimensions (various shapes) sized 25-50% of the player ship, a
// bright color, and a dynamic rigidbody so it bounces on collision.
export function createObstacles(app) {
    const boxes = [];
    const materials = [];

    for (let i = 0; i < OBSTACLE_COUNT; i++) {
        // Independent per-axis scale factor -> varied shapes (slabs, rods, cubes).
        const sx = PLAYER_SIZE.x * rand(OBSTACLE_MIN_SCALE, OBSTACLE_MAX_SCALE);
        const sy = PLAYER_SIZE.y * rand(OBSTACLE_MIN_SCALE, OBSTACLE_MAX_SCALE);
        const sz = PLAYER_SIZE.z * rand(OBSTACLE_MIN_SCALE, OBSTACLE_MAX_SCALE);

        const color = PALETTE[i % PALETTE.length];
        const material = new pc.StandardMaterial();
        material.diffuse = color;
        material.gloss = 0.85;
        material.metalness = 0.0;
        material.useMetalness = true;
        material.reflectivity = 0.5;
        material.update();
        materials.push(material);

        const he = new pc.Vec3(sx * 0.5, sy * 0.5, sz * 0.5);
        const radius = Math.min(he.x, he.y, he.z) * EDGE_RADIUS_FRACTION;
        const mesh = createRoundedBoxMesh(app.graphicsDevice, he, radius, EDGE_SEGMENTS);

        const box = new pc.Entity('obstacle_' + i);
        box.addComponent('render', {
            meshInstances: [new pc.MeshInstance(mesh, material)]
        });

        box.addComponent('collision', {
            type: 'box',
            halfExtents: new pc.Vec3(sx * 0.5, sy * 0.5, sz * 0.5)
        });

        box.addComponent('rigidbody', {
            type: 'dynamic',
            mass: OBSTACLE_MASS,
            restitution: RESTITUTION,
            friction: FRICTION,
            linearDamping: 0.05,
            angularDamping: 0.05
        });

        // Random position in a spherical shell around the origin (keep clear of
        // the player's spawn point).
        const dir = new pc.Vec3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize();
        const dist = rand(SPAWN_RADIUS * 0.35, SPAWN_RADIUS);
        box.setPosition(dir.x * dist, dir.y * dist, dir.z * dist);
        box.setEulerAngles(rand(0, 360), rand(0, 360), rand(0, 360));

        app.root.addChild(box);

        // Gentle initial drift + tumble.
        box.rigidbody.linearVelocity = new pc.Vec3(
            rand(-INITIAL_DRIFT, INITIAL_DRIFT),
            rand(-INITIAL_DRIFT, INITIAL_DRIFT),
            rand(-INITIAL_DRIFT, INITIAL_DRIFT)
        );
        box.rigidbody.angularVelocity = new pc.Vec3(
            rand(-1, 1), rand(-1, 1), rand(-1, 1)
        );

        // Keep the boxes drifting forever. The initial drift is below Bullet's
        // sleep threshold, so by default a body deactivates after a couple of
        // seconds and the engine stops updating its transform (it freezes in
        // place until something hits it). DISABLE_DEACTIVATION (4) opts the
        // body out of sleeping so zero-G drift actually persists.
        box.rigidbody.body.setActivationState(4);

        boxes.push(box);
    }

    return { boxes, materials };
}
