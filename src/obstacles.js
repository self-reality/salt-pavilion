import * as pc from '../lib/playcanvas.mjs';
import {
    OBSTACLE_COUNT, OBSTACLE_MASS, RESTITUTION, FRICTION, SPAWN_RADIUS,
    INITIAL_DRIFT, CAN_INDEX_URL, CAN_DIR, CAN_MIN_LEN, CAN_MAX_LEN,
    CAN_SHARED_MR_URL, CAN_SHARED_NORMAL_URL
} from './config.js';

function rand(min, max) {
    return min + Math.random() * (max - min);
}

// Fisher-Yates: pick `count` distinct entries from `arr` without mutating it.
function sample(arr, count) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a.slice(0, count);
}

function loadContainer(app, name, url) {
    const asset = new pc.Asset(name, 'container', { url });
    return new Promise((resolve, reject) => {
        asset.once('load', () => resolve(asset));
        asset.once('error', reject);
        app.assets.add(asset);
        app.assets.load(asset);
    });
}

// Loads a texture asset, resolving to null if the file doesn't exist (older
// can collections embed the shared maps in every GLB instead).
function loadTexture(app, name, url) {
    const asset = new pc.Asset(name, 'texture', { url });
    return new Promise((resolve) => {
        asset.once('load', () => resolve(asset.resource));
        asset.once('error', () => resolve(null));
        app.assets.add(asset);
        app.assets.load(asset);
    });
}

// The prerender's --strip-shared-maps mode removes the metallic-roughness and
// normal maps (identical in every can) from the GLBs; this puts them back. The
// channel wiring mirrors PlayCanvas's own glTF material parser (metalness in B,
// roughness in G with glossInvert already set by the parser), so a stripped can
// renders identically to one with the maps embedded.
function attachSharedMaps(materials, mrMap, normalMap) {
    for (const mat of materials) {
        if (mrMap && !mat.metalnessMap) {
            mat.metalnessMap = mrMap;
            mat.metalnessMapChannel = 'b';
            mat.glossMap = mrMap;
            mat.glossMapChannel = 'g';
        }
        if (normalMap && !mat.normalMap) mat.normalMap = normalMap;
        mat.update();
    }
}

// Builds one floating spam can: load the textured GLB, scale it so its longest
// axis lands in [CAN_MIN_LEN, CAN_MAX_LEN], recenter on the rigidbody pivot, and
// size a box collider from the scaled bounds (cans are box-ish tins). Keeps the
// can's baked artwork materials. Mirrors the load/measure/scale flow in player.js.
async function createCan(app, name, url) {
    const asset = await loadContainer(app, name, url);
    const model = asset.resource.instantiateRenderEntity();
    const meshInstances = model.findComponents('render').flatMap((r) => r.meshInstances);

    const box = new pc.Entity(name);
    box.addChild(model);
    app.root.addChild(box);
    app.root.syncHierarchy();

    // Combined world AABB at scale 1 (box sits at the origin unrotated here, so
    // world space == box-local space).
    const aabb = new pc.BoundingBox();
    aabb.copy(meshInstances[0].aabb);
    for (let i = 1; i < meshInstances.length; i++) aabb.add(meshInstances[i].aabb);

    const he = aabb.halfExtents;
    const scale = rand(CAN_MIN_LEN, CAN_MAX_LEN) / (2 * Math.max(he.x, he.y, he.z));
    model.setLocalScale(scale, scale, scale);
    model.setLocalPosition(
        -aabb.center.x * scale,
        -aabb.center.y * scale,
        -aabb.center.z * scale
    );
    const halfExtents = new pc.Vec3(he.x * scale, he.y * scale, he.z * scale);

    box.addComponent('collision', { type: 'box', halfExtents });
    box.addComponent('rigidbody', {
        type: 'dynamic',
        mass: OBSTACLE_MASS,
        restitution: RESTITUTION,
        friction: FRICTION,
        linearDamping: 0.05,
        angularDamping: 0.05
    });

    // Random position in a spherical shell around the origin (keep clear of the
    // player's spawn point), random tumble orientation. Must go through
    // teleport(): plain setPosition() on a dynamic-bodied entity never reaches
    // the physics body (the body would stay at the origin and the simulation
    // would snap the entity back there on the next step).
    const dir = new pc.Vec3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize();
    const dist = rand(SPAWN_RADIUS * 0.35, SPAWN_RADIUS);
    box.rigidbody.teleport(
        new pc.Vec3(dir.x * dist, dir.y * dist, dir.z * dist),
        new pc.Vec3(rand(0, 360), rand(0, 360), rand(0, 360))
    );

    box.rigidbody.linearVelocity = new pc.Vec3(
        rand(-INITIAL_DRIFT, INITIAL_DRIFT),
        rand(-INITIAL_DRIFT, INITIAL_DRIFT),
        rand(-INITIAL_DRIFT, INITIAL_DRIFT)
    );
    box.rigidbody.angularVelocity = new pc.Vec3(rand(-1, 1), rand(-1, 1), rand(-1, 1));

    // Keep the cans drifting forever. The initial drift is below Bullet's sleep
    // threshold, so a body would otherwise deactivate after a second or two and
    // freeze in place. DISABLE_DEACTIVATION (4) opts it out of sleeping.
    box.rigidbody.body.setActivationState(4);

    return { box, materials: meshInstances.map((mi) => mi.material) };
}

// Spawns OBSTACLE_COUNT floating spam cans, each a distinct textured GLB picked
// at random from the collection on every load. Loads them in parallel. Returns
// the entities plus the flattened list of can materials (the tweak panel drives
// gloss/metalness/reflectivity across them).
export async function createObstacles(app) {
    const index = await (await fetch(CAN_INDEX_URL)).json();
    const picks = sample(index.entries, OBSTACLE_COUNT);

    const [cans, mrMap, normalMap] = await Promise.all([
        Promise.all(picks.map((entry, i) =>
            createCan(app, 'obstacle_' + i, CAN_DIR + entry.base + '.glb'))),
        loadTexture(app, 'can_shared_mr', CAN_SHARED_MR_URL),
        loadTexture(app, 'can_shared_normal', CAN_SHARED_NORMAL_URL)
    ]);

    const materials = cans.flatMap((c) => c.materials);
    attachSharedMaps(materials, mrMap, normalMap);

    return {
        boxes: cans.map((c) => c.box),
        materials
    };
}
