import * as pc from '../lib/playcanvas.mjs';
import { DISCO } from './config.js';

// Inverted disco ball — the edge of the world. A huge sphere tiled on the
// INSIDE with thick mirror squares enclosing the whole scene. The wall sits
// past fog range, so the centre still reads as white void; fly out and the
// tiles emerge, glinting, reflecting the van live. The van soft-stops at the
// wall and cannot pass through.
//
// Three pieces:
//   1. A single baked mesh of all tiles (laid in latitude rings + slight tilt
//      so they look hand-glued, each a thin cuboid with real thickness).
//   2. Screen-space reflections: the tile material's reflection chunk is replaced
//      with a world-space ray-march through the camera's scene depth/colour grabs
//      (which hold the van + cans, not the tiles), so reflections have true scale
//      and parallax. Rays that miss or leave the screen fall back to a flat,
//      tweakable mirror tint.
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

// GLSL float literal: GLSL ES needs a decimal point on float constants.
const glf = (x) => (Number.isInteger(x) ? x.toFixed(1) : String(x));

// Custom reflection chunk (overrides `reflectionCubePS`). Marches the reflection
// ray in world space, stepping through the scene depth grab; on a depth crossing
// it samples the scene colour grab — that's the van/cans reflected at their true
// on-screen scale. Misses and off-screen rays fall back to the mirror tint. The
// tiles are excluded from the grabs, so rays only ever hit the van + cans.
function ssrReflectionChunk(cfg, floatDepth) {
    return `
// CameraFrame's depth prepass stores LINEAR view depth (R32F, or packed RGBA8
// where float render targets aren't available), so select the matching
// getLinearScreenDepth() branch — the engine can't infer it for an override.
#define SCENE_DEPTHMAP_LINEAR
${floatDepth ? '#define SCENE_DEPTHMAP_FLOAT' : ''}
#include "screenDepthPS"
uniform sampler2D uSceneColorMap;
uniform mat4 matrix_viewProjection;
uniform float material_reflectivity;
uniform vec3 uMirrorTint;
uniform float uMirrorTintStrength;
#define SSR_STEPS ${Math.max(1, Math.round(cfg.ssrSteps))}
#define SSR_STEP ${glf(cfg.ssrStep)}
#define SSR_BIAS ${glf(cfg.ssrBias)}
#define SSR_THICKNESS ${glf(cfg.ssrThickness)}

vec3 calcReflection(vec3 reflDir, float gloss) {
    vec3 tint = uMirrorTint * uMirrorTintStrength;
    float t = SSR_STEP;
    float prevT = 0.0;
    vec2 hitUv = vec2(0.0);
    bool hit = false;

    for (int i = 0; i < SSR_STEPS; i++) {
        vec3 p = vPositionW + reflDir * t;
        vec4 clip = matrix_viewProjection * vec4(p, 1.0);
        if (clip.w <= 0.0) break;                      // behind the camera
        vec2 uv = (clip.xy / clip.w) * 0.5 + 0.5;
        if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) break; // off-screen

        float diff = getLinearDepth(p) - getLinearScreenDepth(uv);
        if (diff > SSR_BIAS && diff < SSR_THICKNESS) { // ray crossed a surface
            float lo = prevT, hi = t;                  // refine for a sharp contact
            for (int j = 0; j < 4; j++) {
                float mid = 0.5 * (lo + hi);
                vec3 pm = vPositionW + reflDir * mid;
                vec4 cm = matrix_viewProjection * vec4(pm, 1.0);
                vec2 um = (cm.xy / cm.w) * 0.5 + 0.5;
                if (getLinearDepth(pm) - getLinearScreenDepth(um) > SSR_BIAS) { hi = mid; uv = um; }
                else lo = mid;
            }
            hitUv = uv;
            hit = true;
            break;
        }
        prevT = t;
        t += SSR_STEP;
    }

    if (!hit) return tint;
    return texture2D(uSceneColorMap, hitUv).rgb * uMirrorTint;
}

void addReflection(vec3 reflDir, float gloss) {
    dReflection += vec4(calcReflection(reflDir, gloss), material_reflectivity);
}
`;
}

export function createDiscoBall(app, cameraEntity, ship, cf) {
    const device = app.graphicsDevice;
    const rng = mulberry32(DISCO.seed);
    const mesh = bakeDiscoBall(device, buildTiles(DISCO, rng), DISCO);

    // The camera renders through CameraFrame, which owns its render passes — so
    // the per-camera requestScene*Map path is bypassed and the grabs must be
    // enabled on CameraFrame instead. sceneDepthMap adds a linear-depth prepass
    // (uSceneDepthMap); sceneColorMap grabs the lit scene (uSceneColorMap). The
    // tile shader ray-marches both to reflect the van + cans.
    cf.rendering.sceneColorMap = true;
    cf.rendering.sceneDepthMap = true;
    cf.update();

    const mat = new pc.StandardMaterial();
    mat.useMetalness = true;
    mat.metalness = DISCO.mirrorMetalness;
    mat.gloss = DISCO.mirrorGloss;
    mat.reflectivity = DISCO.mirrorReflectivity;
    // Metalness workflow: a metal's reflection colour IS its albedo. A bright
    // tint here = a bright mirror; black would reflect nothing.
    mat.diffuse = DISCO.mirrorColor;
    // A 1x1 dummy cubemap is never sampled — it only forces the material onto the
    // REFLECTIONSRC_CUBEMAP path so our overridden `reflectionCubePS` (the SSR
    // ray-march) is the reflection code that runs.
    mat.cubeMap = new pc.Texture(device, {
        name: 'discoDummyCube', cubemap: true, width: 1, height: 1,
        format: pc.PIXELFORMAT_RGBA8, mipmaps: false
    });
    mat.getShaderChunks(pc.SHADERLANGUAGE_GLSL).set('reflectionCubePS', ssrReflectionChunk(DISCO, device.textureFloatRenderable));
    const tint = DISCO.mirrorColor;
    mat.setParameter('uMirrorTint', [tint.r, tint.g, tint.b]);
    mat.setParameter('uMirrorTintStrength', DISCO.mirrorTintStrength);
    mat.useFog = true;  // distant tiles fade into the void like everything else
    mat.update();

    // Own layer, inserted right AFTER the DEPTH layer so the colour/depth grabs
    // (which run at DEPTH) capture the van + cans but NOT the tiles — the tiles
    // therefore sample a self-free scene, and never reflect each other. It still
    // sits inside CameraFrame's HDR scene pass (before Skybox/Immediate), sharing
    // the world depth buffer so the van occludes tiles correctly.
    const discoLayer = new pc.Layer({ name: 'DiscoBall' });
    const layers = app.scene.layers;
    const depthLayer = layers.getLayerById(pc.LAYERID_DEPTH);
    layers.insert(discoLayer, layers.layerList.lastIndexOf(depthLayer) + 1);
    cameraEntity.camera.layers = [...cameraEntity.camera.layers, discoLayer.id];

    const entity = new pc.Entity('discoBall');
    entity.addComponent('render', { meshInstances: [new pc.MeshInstance(mesh, mat)], layers: [discoLayer.id] });
    app.root.addChild(entity);

    const _p = new pc.Vec3();
    const _n = new pc.Vec3();
    const _v = new pc.Vec3();

    function update() {
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

    return {
        entity,
        material: mat,
        update,
        setMirrorTint: (r, g, b) => mat.setParameter('uMirrorTint', [r, g, b]),
        setTintStrength: (v) => mat.setParameter('uMirrorTintStrength', v)
    };
}
