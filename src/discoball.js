import * as pc from '../lib/playcanvas.mjs';
import { DISCO, BG_COLOR } from './config.js';

// Inverted disco ball — the edge of the world. A huge sphere tiled on the
// INSIDE with thick mirror squares enclosing the whole scene. The wall sits
// past fog range, so the centre still reads as white void; fly out and the
// tiles emerge, glinting, reflecting the van live. The van soft-stops at the
// wall and cannot pass through.
//
// Three pieces:
//   1. A single baked mesh of all tiles (laid in latitude rings + slight tilt
//      so they look hand-glued, each a thin cuboid with real thickness).
//   2. Live reflections: a probe at the sphere centre renders the van + cans
//      into a cubemap each frame. Per fragment, the tile's reflected ray is
//      intersected against each object's real bounding sphere (a small uniform
//      array); a hit samples the cubemap toward the hit point. Footprints are
//      therefore true mirror footprints — right place, right size, at any
//      distance, the same logic for the van and every can — and rays that hit
//      nothing stay a plain tinted mirror, so nothing ever smears or balloons.
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

// Lay equal-size tiles in horizontal rings (parallels), like a real glued disco
// ball. A square of edge s tangent to radius R subtends angle 2*atan(s/2R); that
// sets both the pole-to-pole ring step and the spacing within each ring, so the
// whole sphere fills with only a thin grout gap. Per tile: a small gluing-depth
// wobble plus a slight off-tangent lean and in-plane roll.
function buildTiles(cfg, rng) {
    const tiles = [];
    const R = cfg.radius;
    const s = cfg.tileSize * (1 + cfg.gap);          // effective size incl. grout
    const alpha = 2 * Math.atan(s / (2 * R));        // tile angular size
    const ringCount = Math.max(1, Math.round(Math.PI / alpha));
    const dTheta = Math.PI / ringCount;              // even pole-to-pole step

    for (let ir = 0; ir < ringCount; ir++) {
        const theta = (ir + 0.5) * dTheta;           // ring band centre, avoids exact poles
        const ny = Math.cos(theta);
        const r = Math.sin(theta);                   // unit ring radius
        const phiW = 2 * Math.atan(s / (2 * R * r)); // tile angular width around the axis
        const n = Math.max(1, Math.floor((2 * Math.PI) / phiW));

        for (let it = 0; it < n; it++) {
            const phi = it * (2 * Math.PI / n);
            const nx = Math.cos(phi) * r;
            const nz = Math.sin(phi) * r;
            const radius = cfg.radius + (rng() * 2 - 1) * cfg.radialJitter;

            // Inward normal (the mirror face looks at the scene centre) and a
            // right-handed tangent basis: tx runs east (horizontal edge), ty
            // runs along the meridian (vertical edge).
            const inward = new pc.Vec3(-nx, -ny, -nz);
            const up = Math.abs(ny) > 0.99 ? new pc.Vec3(1, 0, 0) : new pc.Vec3(0, 1, 0);
            const tx = new pc.Vec3().cross(up, inward).normalize();
            const ty = new pc.Vec3().cross(inward, tx).normalize();

            tiles.push({
                center: new pc.Vec3(nx * radius, ny * radius, nz * radius),
                tx, ty, inward,
                tiltX: (rng() * 2 - 1) * cfg.tiltJitter,
                tiltY: (rng() * 2 - 1) * cfg.tiltJitter,
                roll: (rng() * 2 - 1) * cfg.rollJitter,
                size: cfg.tileSize
            });
        }
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

// Most simultaneous reflectable objects (van + cans). Mirrors the uniform array
// size in the shader chunk.
const MAX_PROXIES = 32;

// Custom reflection chunk (overrides `reflectionCubePS`). uReflectCube is a
// cubemap of the van + cans rendered each frame from the sphere centre. A naive
// lookup by reflected-ray direction would paint every object at infinity (the
// old screen-space mirror's failure: sizes drifted with distance and objects
// smeared whole tiles). Instead the reflected ray is intersected against each
// object's bounding sphere (uProxies, world space); only a genuine hit samples
// the cubemap, toward the hit point, so each reflection lands exactly where a
// real mirror facet would put it and covers exactly the area it should. Rays
// that miss everything stay the flat tinted mirror. The reflected leg's length
// runs through the same linear fog as the scene, so far content dissolves into
// the void instead of popping.
//
// uCurveAmount blends the facet's own normal (1, faceted scatter like a real
// disco ball) toward the smooth sphere normal (0, one continuous curved
// mirror): un-reflect to recover the incident ray (reflect is an involution),
// re-reflect about the radial normal, and mix.
const SPHERE_REFLECTION_CHUNK = `
uniform samplerCube uReflectCube;
uniform vec4 uProxies[${MAX_PROXIES}];   // xyz = world centre, w = radius
uniform int uProxyCount;
uniform float uWallRadius;
uniform float uCurveAmount;
uniform vec2 uReflFog;                   // linear fog start/end along the reflected ray
uniform float material_reflectivity;
uniform vec3 uMirrorTint;
uniform float uMirrorTintStrength;
vec3 calcReflection(vec3 reflDir, float gloss) {
    vec3 rd = normalize(reflDir);
    vec3 incident = reflect(rd, normalize(vNormalW));
    rd = normalize(mix(reflect(incident, -normalize(vPositionW)), rd, uCurveAmount));

    // Where the reflected ray would exit the wall sphere caps the search.
    float b = dot(vPositionW, rd);
    float tExit = -b + sqrt(max(b * b - dot(vPositionW, vPositionW) + uWallRadius * uWallRadius, 0.0));

    float tHit = tExit;
    for (int i = 0; i < ${MAX_PROXIES}; i++) {
        if (i >= uProxyCount) break;
        vec3 oc = vPositionW - uProxies[i].xyz;
        float pb = dot(oc, rd);
        float disc = pb * pb - dot(oc, oc) + uProxies[i].w * uProxies[i].w;
        if (disc > 0.0) {
            float t = -pb - sqrt(disc);
            if (t > 0.0 && t < tHit) tHit = t;
        }
    }

    // Sample toward the hit point (the probe at the origin saw the object in
    // that direction). The sample is gamma-encoded in the RT; bring it back to
    // linear before joining the lighting math.
    vec3 hit = vPositionW + rd * tHit;
    vec3 texel = pow(textureCube(uReflectCube, normalize(hit)).rgb, vec3(2.2));
    float fog = clamp((uReflFog.y - tHit) / (uReflFog.y - uReflFog.x), 0.0, 1.0);
    float hitMask = tHit < tExit ? 1.0 : 0.0;
    vec3 refl = mix(vec3(1.0), texel, hitMask * fog);
    return refl * uMirrorTint * uMirrorTintStrength;
}
void addReflection(vec3 reflDir, float gloss) {
    dReflection += vec4(calcReflection(reflDir, gloss), material_reflectivity);
}
`;

// Camera rotations for the six cubemap faces (+X,-X,+Y,-Y,+Z,-Z) — the same
// table the engine uses for omni shadow cubes, whose maps are sampled with the
// raw world direction, so the chunk above needs no axis flips.
const CUBE_FACE_EULERS = [
    [0, 90, 180], [0, -90, 180], [90, 0, 0], [-90, 0, 0], [0, 180, 180], [0, 0, 180]
];

export function createDiscoBall(app, cameraEntity, ship, reflectorEntities = []) {
    const device = app.graphicsDevice;
    const rng = mulberry32(DISCO.seed);
    const mesh = bakeDiscoBall(device, buildTiles(DISCO, rng), DISCO);
    const R = DISCO.radius;

    // Private layer holding fog-free twins of the van + cans: same meshes and
    // nodes, cloned materials with fog off. The probe sits at the origin, so
    // scene fog (distance from the probe) would wash out exactly the near-wall
    // content whose reflections matter most; the reflected ray's own fog is
    // applied in the chunk instead, with the true reflected distance.
    const reflectLayer = new pc.Layer({ name: 'DiscoReflect' });
    app.scene.layers.push(reflectLayer);
    for (const lc of app.root.findComponents('light')) {
        lc.layers = [...lc.layers, reflectLayer.id];
    }

    // The probe cubemap and its six face cameras, fixed at the sphere centre.
    const cubeTex = new pc.Texture(device, {
        name: 'discoReflectCube', cubemap: true,
        width: DISCO.cubemapSize, height: DISCO.cubemapSize,
        format: pc.PIXELFORMAT_RGBA8, mipmaps: false,
        minFilter: pc.FILTER_LINEAR, magFilter: pc.FILTER_LINEAR,
        addressU: pc.ADDRESS_CLAMP_TO_EDGE, addressV: pc.ADDRESS_CLAMP_TO_EDGE
    });
    for (let face = 0; face < 6; face++) {
        const cam = new pc.Entity('discoProbe_' + face);
        cam.addComponent('camera', {
            clearColor: BG_COLOR,
            layers: [reflectLayer.id],
            priority: -10,
            renderTarget: new pc.RenderTarget({
                name: 'discoReflectRT_' + face, colorBuffer: cubeTex, face, depth: true
            }),
            fov: 90,
            nearClip: 0.25,
            farClip: R + 10
        });
        cam.setEulerAngles(...CUBE_FACE_EULERS[face]);
        app.root.addChild(cam);
    }

    const mat = new pc.StandardMaterial();
    mat.useMetalness = true;
    mat.metalness = DISCO.mirrorMetalness;
    mat.gloss = DISCO.mirrorGloss;
    mat.reflectivity = DISCO.mirrorReflectivity;
    // White albedo: with metalness the reflection colour is the albedo, so a tint
    // here would double up with uMirrorTint applied in the chunk. Keep it neutral
    // and let the chunk (and the sidebar slider) own the tint.
    mat.diffuse = new pc.Color(1, 1, 1);
    // A 1x1 dummy cubemap is never sampled — it only forces the material onto the
    // REFLECTIONSRC_CUBEMAP path so our overridden `reflectionCubePS` runs.
    mat.cubeMap = new pc.Texture(device, {
        name: 'discoDummyCube', cubemap: true, width: 1, height: 1,
        format: pc.PIXELFORMAT_RGBA8, mipmaps: false
    });
    mat.getShaderChunks(pc.SHADERLANGUAGE_GLSL).set('reflectionCubePS', SPHERE_REFLECTION_CHUNK);
    const proxyData = new Float32Array(MAX_PROXIES * 4);
    mat.setParameter('uReflectCube', cubeTex);
    mat.setParameter('uProxies[0]', proxyData);
    mat.setParameter('uProxyCount', 0);
    mat.setParameter('uWallRadius', R);
    mat.setParameter('uCurveAmount', DISCO.curveAmount);
    mat.setParameter('uReflFog', [app.scene.fog.start, app.scene.fog.end]);
    const tint = DISCO.mirrorColor;
    mat.setParameter('uMirrorTint', [tint.r, tint.g, tint.b]);
    mat.setParameter('uMirrorTintStrength', DISCO.mirrorTintStrength);
    mat.useFog = true;  // distant tiles fade into the void like everything else
    mat.update();

    // Own layer so the probe cameras can exclude the ball (no mirror-in-mirror).
    // Inserted right after World so the tiles render inside CameraFrame's HDR scene
    // pass, sharing the world depth buffer (the van occludes tiles correctly).
    const discoLayer = new pc.Layer({ name: 'DiscoBall' });
    const layers = app.scene.layers;
    const worldLayer = layers.getLayerById(pc.LAYERID_WORLD);
    layers.insert(discoLayer, layers.layerList.lastIndexOf(worldLayer) + 1);
    cameraEntity.camera.layers = [...cameraEntity.camera.layers, discoLayer.id];

    const entity = new pc.Entity('discoBall');
    entity.addComponent('render', { meshInstances: [new pc.MeshInstance(mesh, mat)], layers: [discoLayer.id] });
    app.root.addChild(entity);

    // ----- Reflectors: objects the wall mirrors -----
    const reflectors = [];
    const twinMaterials = new Map();
    function fogFreeClone(material) {
        let clone = twinMaterials.get(material);
        if (!clone) {
            clone = material.clone();
            clone.useFog = false;
            clone.update();
            twinMaterials.set(material, clone);
        }
        return clone;
    }

    function registerReflector(reflectorEntity) {
        const mis = reflectorEntity.findComponents('render').flatMap((r) => r.meshInstances);
        if (!mis.length) return;
        reflectLayer.addMeshInstances(mis.map(
            (mi) => new pc.MeshInstance(mi.mesh, fogFreeClone(mi.material), mi.node)
        ));

        // Proxy bounding sphere: circumscribes the combined AABB, so it stays
        // valid under any rotation. Slightly padded so the footprint never
        // clips the image (the rim just samples background).
        const aabb = new pc.BoundingBox();
        aabb.copy(mis[0].aabb);
        for (let i = 1; i < mis.length; i++) aabb.add(mis[i].aabb);
        reflectors.push({ entity: reflectorEntity, radius: aabb.halfExtents.length() * 1.1 });
    }

    registerReflector(ship);
    for (const e of reflectorEntities) registerReflector(e);

    function updateProxies() {
        let n = 0;
        for (const r of reflectors) {
            if (n >= MAX_PROXIES) break;
            const p = r.entity.getPosition();
            // Skip objects past the wall (escaped cans) — a mirror has nothing
            // behind it to show.
            if (p.length() > R - 0.5) continue;
            proxyData[n * 4] = p.x;
            proxyData[n * 4 + 1] = p.y;
            proxyData[n * 4 + 2] = p.z;
            proxyData[n * 4 + 3] = r.radius;
            n++;
        }
        mat.setParameter('uProxies[0]', proxyData);
        mat.setParameter('uProxyCount', n);
    }

    const _p = new pc.Vec3();
    const _bn = new pc.Vec3();
    const _v = new pc.Vec3();

    function update() {
        updateProxies();

        // Spherical boundary: at the wall, kill outward velocity and clamp back.
        _p.copy(ship.getPosition());
        const dist = _p.length();
        const limit = R - DISCO.boundaryMargin;
        if (dist > limit && dist > 1e-4) {
            const rb = ship.rigidbody;
            _bn.copy(_p).mulScalar(1 / dist); // outward unit
            _v.copy(rb.linearVelocity);
            const vr = _v.dot(_bn);
            if (vr > 0) {
                _v.x -= _bn.x * vr; _v.y -= _bn.y * vr; _v.z -= _bn.z * vr;
                rb.linearVelocity = _v;
            }
            rb.teleport(_bn.x * limit, _bn.y * limit, _bn.z * limit);
        }
    }

    return {
        entity,
        material: mat,
        update,
        registerReflector,
        setMirrorTint: (r, g, b) => mat.setParameter('uMirrorTint', [r, g, b]),
        setTintStrength: (v) => mat.setParameter('uMirrorTintStrength', v),
        setCurveAmount: (v) => mat.setParameter('uCurveAmount', v)
    };
}
