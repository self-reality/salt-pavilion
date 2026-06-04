import * as pc from '../lib/playcanvas.mjs';
import { DISCO, BG_COLOR } from './config.js';

// Inverted disco ball — the edge of the world. A huge sphere tiled on the
// INSIDE with thick mirror squares enclosing the whole scene. The wall sits
// past fog range, so the centre still reads as white void; fly out and the
// tiles emerge, glinting, reflecting the van live. The van soft-stops at the
// wall and cannot pass through.
//
// Three pieces:
//   1. A single baked mesh of all tiles (Fibonacci-spiral placement + jitter so
//      they look hand-glued, each a thin cuboid with real thickness).
//   2. A camera-following cubemap probe that re-renders one face per frame, so
//      the van — sitting just ahead of the camera — shows up in nearby tiles.
//   3. A spherical boundary that cancels the van's outward velocity at the wall.

// Small seeded RNG so the wall looks identical across reloads.
function mulberry32(a) {
    return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const GOLDEN = Math.PI * (3 - Math.sqrt(5)); // golden angle

// Place tileCount points evenly on the sphere via the golden spiral, then add
// per-tile jitter (tangential nudge, in/out gluing depth, off-tangent lean,
// full in-plane roll, size variance) so the grid never reads as a grid.
function buildTiles(cfg, rng) {
    const tiles = [];
    const N = cfg.tileCount;
    for (let i = 0; i < N; i++) {
        const y = 1 - (i + 0.5) * (2 / N);
        const ring = Math.sqrt(Math.max(0, 1 - y * y));
        const theta = i * GOLDEN;
        let nx = Math.cos(theta) * ring;
        let ny = y;
        let nz = Math.sin(theta) * ring;

        nx += (rng() * 2 - 1) * cfg.posJitter;
        ny += (rng() * 2 - 1) * cfg.posJitter;
        nz += (rng() * 2 - 1) * cfg.posJitter;
        const inv = 1 / Math.hypot(nx, ny, nz);
        nx *= inv; ny *= inv; nz *= inv;

        const radius = cfg.radius + (rng() * 2 - 1) * cfg.radialJitter;

        // Inward normal (the mirror face looks at the scene centre) and a
        // right-handed tangent basis (tx, ty, inward).
        const inward = new pc.Vec3(-nx, -ny, -nz);
        const up = Math.abs(ny) > 0.99 ? new pc.Vec3(1, 0, 0) : new pc.Vec3(0, 1, 0);
        const tx = new pc.Vec3().cross(up, inward).normalize();
        const ty = new pc.Vec3().cross(inward, tx).normalize();

        tiles.push({
            center: new pc.Vec3(nx * radius, ny * radius, nz * radius),
            tx, ty, inward,
            tiltX: (rng() * 2 - 1) * cfg.tiltJitter,
            tiltY: (rng() * 2 - 1) * cfg.tiltJitter,
            roll: rng() * 360,
            size: cfg.tileSize * (1 + (rng() * 2 - 1) * cfg.sizeJitter)
        });
    }
    return tiles;
}

// Unit cube centred on the origin, ±0.5, 24 verts with per-face normals and
// outward CCW winding. Local +Z is the mirror face (mapped to `inward`).
function unitBox() {
    const faces = [
        { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
        { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0] },
        { n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0] },
        { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
        { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1] },
        { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] }
    ];
    const pos = [], nrm = [], uv = [], idx = [];
    for (const f of faces) {
        const base = pos.length / 3;
        for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
            for (let k = 0; k < 3; k++) {
                pos.push(f.n[k] * 0.5 + f.u[k] * 0.5 * su + f.v[k] * 0.5 * sv);
                nrm.push(f.n[k]);
            }
            uv.push((su + 1) / 2, (sv + 1) / 2);
        }
        idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    return { pos, nrm, uv, idx };
}

// Bake every tile box into one mesh: transform the unit box by each tile's TRS
// (basis rotation × local jitter, scaled size×size×thickness) and accumulate.
function bakeDiscoBall(device, tiles, cfg) {
    const B = unitBox();
    const positions = [], normals = [], uvs = [], indices = [];
    const m = new pc.Mat4();
    const basis = new pc.Mat4();
    const jitter = new pc.Mat4();
    const nrmMat = new pc.Mat4();
    const q = new pc.Quat();
    const s = new pc.Vec3();
    const p = new pc.Vec3();
    const n = new pc.Vec3();

    for (const t of tiles) {
        basis.set([
            t.tx.x, t.tx.y, t.tx.z, 0,
            t.ty.x, t.ty.y, t.ty.z, 0,
            t.inward.x, t.inward.y, t.inward.z, 0,
            0, 0, 0, 1
        ]);
        jitter.setFromEulerAngles(t.tiltX, t.tiltY, t.roll);
        q.setFromMat4(m.mul2(basis, jitter));
        s.set(t.size, t.size, cfg.tileThickness);
        m.setTRS(t.center, q, s);
        nrmMat.copy(m).invert().transpose();

        const base = positions.length / 3;
        for (let i = 0; i < B.pos.length; i += 3) {
            p.set(B.pos[i], B.pos[i + 1], B.pos[i + 2]);
            m.transformPoint(p, p);
            positions.push(p.x, p.y, p.z);
            n.set(B.nrm[i], B.nrm[i + 1], B.nrm[i + 2]);
            nrmMat.transformVector(n, n).normalize();
            normals.push(n.x, n.y, n.z);
        }
        for (let i = 0; i < B.uv.length; i++) uvs.push(B.uv[i]);
        for (let i = 0; i < B.idx.length; i++) indices.push(base + B.idx[i]);
    }

    const geom = new pc.Geometry();
    geom.positions = positions;
    geom.normals = normals;
    geom.uvs = uvs;
    geom.indices = indices;
    return pc.Mesh.fromGeometry(device, geom);
}

// Camera rotations for the 6 cubemap faces, matching the engine's own point-
// light convention (LightCamera.pointLightRotations).
const FACE_ROT = [
    new pc.Quat().setFromEulerAngles(0, 90, 180),
    new pc.Quat().setFromEulerAngles(0, -90, 180),
    new pc.Quat().setFromEulerAngles(90, 0, 0),
    new pc.Quat().setFromEulerAngles(-90, 0, 0),
    new pc.Quat().setFromEulerAngles(0, 180, 180),
    new pc.Quat().setFromEulerAngles(0, 0, 180)
];

export function createDiscoBall(app, cameraEntity, ship) {
    const device = app.graphicsDevice;
    const rng = mulberry32(DISCO.seed);
    const mesh = bakeDiscoBall(device, buildTiles(DISCO, rng), DISCO);

    // Live reflection cubemap, refreshed one face per frame by the probe camera.
    const cube = new pc.Texture(device, {
        name: 'discoReflect',
        cubemap: true,
        width: DISCO.reflectCubeSize,
        height: DISCO.reflectCubeSize,
        format: pc.PIXELFORMAT_RGBA8,
        addressU: pc.ADDRESS_CLAMP_TO_EDGE,
        addressV: pc.ADDRESS_CLAMP_TO_EDGE,
        mipmaps: false // a near-mirror samples level 0; no stale-mip blur
    });
    const faces = [];
    for (let f = 0; f < 6; f++) {
        faces.push(new pc.RenderTarget({ name: `disco-face-${f}`, colorBuffer: cube, face: f, depth: true }));
    }

    const mat = new pc.StandardMaterial();
    mat.useMetalness = true;
    mat.metalness = DISCO.mirrorMetalness;
    mat.gloss = DISCO.mirrorGloss;
    mat.reflectivity = DISCO.mirrorReflectivity;
    // Metalness workflow: a metal's reflection colour IS its albedo. A bright
    // tint here = a bright mirror; black would reflect nothing.
    mat.diffuse = DISCO.mirrorColor;
    mat.cubeMap = cube; // takes priority over scene.envAtlas -> reflects the scene
    // No box projection: it assumes the reflected content lives on the box
    // surface, but the van orbits the centre while the box would have to enclose
    // the far tiles — so it pastes the van onto the distant wall (tiny, and with
    // the parallax collapsed to an infinite-environment lookup). Plain direction
    // sampling against a centre-pinned probe reads the van's true bearing.
    mat.useFog = true;  // distant tiles fade into the void like everything else
    mat.update();

    // Own layer so the probe camera can exclude the ball (no mirror feedback,
    // and the ball's far walls don't clutter the reflection). Insert it into the
    // scene group right after World (i.e. before the Immediate layer) so the tiles
    // render inside CameraFrame's HDR scene pass, sharing its depth buffer with the
    // van. Pushing to the end of the list instead lands them in the post-compose
    // after-pass, which clears to a fresh depth buffer — there the tiles paint over
    // the van regardless of which is actually nearer.
    const discoLayer = new pc.Layer({ name: 'DiscoBall' });
    const layers = app.scene.layers;
    const worldLayer = layers.getLayerById(pc.LAYERID_WORLD);
    layers.insert(discoLayer, layers.layerList.lastIndexOf(worldLayer) + 1);
    cameraEntity.camera.layers = [...cameraEntity.camera.layers, discoLayer.id];

    const entity = new pc.Entity('discoBall');
    entity.addComponent('render', { meshInstances: [new pc.MeshInstance(mesh, mat)], layers: [discoLayer.id] });
    app.root.addChild(entity);

    // Probe camera: pinned at the sphere centre (the focal point every mirror
    // faces, and the centre of the projection box above). Renders only the WORLD
    // layer (van + boxes + white void) into the cube. Priority < 0 so it renders
    // before the main camera each frame. It is the van that moves inside the
    // fixed sphere, so the probe never needs to follow the camera.
    const probe = new pc.Entity('discoProbe');
    probe.addComponent('camera', {
        fov: 90,
        nearClip: 0.1,
        farClip: DISCO.radius * 2.5,
        clearColor: BG_COLOR,
        layers: [pc.LAYERID_WORLD],
        priority: -10,
        renderTarget: faces[0]
    });
    probe.camera.aspectRatioMode = pc.ASPECT_MANUAL;
    probe.camera.aspectRatio = 1;
    probe.setPosition(0, 0, 0);
    app.root.addChild(probe);

    let face = 0;
    const _p = new pc.Vec3();
    const _n = new pc.Vec3();
    const _v = new pc.Vec3();

    function update() {
        // Refresh one cube face per frame from the sphere centre.
        probe.setRotation(FACE_ROT[face]);
        probe.camera.renderTarget = faces[face];
        face = (face + 1) % 6;

        // Spherical boundary: at the wall, kill outward velocity and clamp back.
        _p.copy(ship.getPosition());
        const dist = _p.length();
        const limit = DISCO.radius - DISCO.boundaryMargin;
        if (dist > limit && dist > 1e-4) {
            const rb = ship.rigidbody;
            _n.copy(_p).mulScalar(1 / dist); // outward unit
            _v.copy(rb.linearVelocity);
            const vr = _v.dot(_n);
            if (vr > 0) {
                _v.x -= _n.x * vr; _v.y -= _n.y * vr; _v.z -= _n.z * vr;
                rb.linearVelocity = _v;
            }
            rb.teleport(_n.x * limit, _n.y * limit, _n.z * limit);
        }
    }

    return { entity, material: mat, update };
}
