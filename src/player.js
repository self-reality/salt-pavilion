import * as pc from '../lib/playcanvas.mjs';
import {
    PLAYER_COLOR, PLAYER_MASS,
    RESTITUTION, FRICTION, LINEAR_DAMPING, ANGULAR_DAMPING,
    VAN_URL, VAN_TARGET_LEN, VAN_YAW, VAN_PITCH
} from './config.js';

// Sets the van's nose-up/down tilt (PITCH, not roll). The van is yawed so its
// length faces -Z, so a pitch must turn about the ship's X (left/right) axis
// AFTER that yaw: compose as pitch * yaw. Folding the angle into the X slot of
// setLocalEulerAngles instead spins the van about its own length axis, which
// reads as ROLL. Positive pitchDeg lifts the nose.
export function setVanPitch(van, pitchDeg) {
    const yaw = new pc.Quat().setFromEulerAngles(0, VAN_YAW, 0);
    const pitch = new pc.Quat().setFromEulerAngles(pitchDeg, 0, 0);
    van.setLocalRotation(pitch.mul(yaw)); // yaw first, then pitch about ship X
}

// Creates the black spaceship: the van GLB, loaded untextured and recolored to
// PLAYER_COLOR, riding a dynamic rigidbody. The visual keeps the van's natural
// proportions (uniform scale); the box collider is sized from the scaled van's
// bounds. Movement is force-driven (controls.js); rotation is mouse-driven.
// Async: resolves once the van is loaded and the physics body is built.
export async function createPlayer(app) {
    const material = new pc.StandardMaterial();
    material.diffuse = PLAYER_COLOR;
    material.gloss = 0.83;
    material.metalness = 0.84;
    material.useMetalness = true;
    material.reflectivity = 1.0;
    material.update();

    const ship = new pc.Entity('ship');
    ship.setPosition(0, 0, 0);
    app.root.addChild(ship);

    const asset = new pc.Asset('van', 'container', { url: VAN_URL });
    await new Promise((resolve, reject) => {
        asset.once('load', resolve);
        asset.once('error', reject);
        app.assets.add(asset);
        app.assets.load(asset);
    });

    const model = asset.resource.instantiateRenderEntity();
    const meshInstances = model.findComponents('render').flatMap((r) => r.meshInstances);
    for (const mi of meshInstances) mi.material = material;

    // Orient first, then measure: the world AABB must reflect the yaw so the
    // collider matches the drawn van.
    model.setLocalEulerAngles(0, VAN_YAW, 0);
    ship.addChild(model);
    app.root.syncHierarchy();

    // Combined world AABB at scale 1 (ship sits at the origin with no rotation,
    // so world space == ship-local space here).
    const aabb = new pc.BoundingBox();
    aabb.copy(meshInstances[0].aabb);
    for (let i = 1; i < meshInstances.length; i++) aabb.add(meshInstances[i].aabb);

    // Uniform scale so the longest axis == VAN_TARGET_LEN, preserving proportions.
    const he = aabb.halfExtents;
    const scale = VAN_TARGET_LEN / (2 * Math.max(he.x, he.y, he.z));
    model.setLocalScale(scale, scale, scale);

    // Uniform scale about the model pivot maps the measured center/extents
    // linearly, so recenter the van on the ship origin and size the collider
    // from the scaled half-extents.
    model.setLocalPosition(
        -aabb.center.x * scale,
        -aabb.center.y * scale,
        -aabb.center.z * scale
    );
    const halfExtents = new pc.Vec3(he.x * scale, he.y * scale, he.z * scale);

    // Cosmetic nose tilt, applied after the collider is measured from the
    // yaw-only orientation so the box stays axis-aligned with the ship.
    setVanPitch(model, VAN_PITCH);

    ship.addComponent('collision', { type: 'box', halfExtents });
    ship.addComponent('rigidbody', {
        type: 'dynamic',
        mass: PLAYER_MASS,
        restitution: RESTITUTION,
        friction: FRICTION,
        linearDamping: LINEAR_DAMPING,
        angularDamping: ANGULAR_DAMPING
    });

    return { ship, material, van: model };
}
