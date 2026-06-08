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

// Custom reflection chunk (overrides `reflectionCubePS`). A second camera renders
// the van + cans into uReflectionTex from the mirror of the main camera across
// the wall plane. The flat way to read it is each tile sampling its own screen
// pixel — but that makes the whole wall one FLAT mirror, since the tile's normal
// never enters the lookup. A real disco ball is faceted: each flat tile reflects
// a slice of the scene shifted by its own orientation, and the image steps at the
// grout lines between tiles.
//
// So we curve the reflection PER TILE, not per pixel. Driving the warp from the
// fragment's own ray makes the guards below (denom / t / clip.w) flip partway
// across a tile, tearing the reflection inside a single facet. Instead we derive
// everything from per-tile-CONSTANT inputs: the tile centre and its face normal.
// vNormalW is constant across a flat face and points inward, so the tile centre
// is -normalize(vNormalW) * radius. We reflect the eye→centre ray off that normal,
// intersect a focal plane through the scene centre, and project the hit into the
// mirror render — giving one sphere sample point for the whole tile. The shift
// between that and where the centre samples flat is a per-tile constant `delta`;
// every fragment reads the flat mirror offset by delta * uCurveAmount, so the
// crop is smooth within a tile and only steps at the borders.
const SPHERE_REFLECTION_CHUNK = `
uniform sampler2D uReflectionTex;
uniform vec2 uReflectTexel;        // (1/width, 1/height) of the screen render
uniform mat4 uReflectViewProj;     // mirror camera's view-projection
uniform mat4 uMainViewProj;        // main camera's view-projection
uniform vec3 uFocalNormal;         // main camera forward; orients the focal plane
uniform vec3 uEye;                 // main camera world position
uniform float uWallRadius;         // sphere radius the tile centres sit on
uniform float uCurveAmount;        // 0 = flat mirror, 1 = full spherical curvature
uniform float material_reflectivity;
uniform vec3 uMirrorTint;
uniform float uMirrorTintStrength;
vec3 calcReflection(vec3 reflDir, float gloss) {
    vec2 flatUv = gl_FragCoord.xy * uReflectTexel;
    vec2 uv = flatUv;
    // Reconstruct the tile centre and the tile-constant reflected ray. Using the
    // face normal (constant per tile) keeps every fragment of the tile on the same
    // branch, so the warp steps only at the grout lines.
    vec3 nrm = normalize(vNormalW);
    vec3 centerW = -nrm * uWallRadius;
    vec3 reflDirTile = reflect(normalize(centerW - uEye), nrm);
    // Intersect the tile's reflected ray with the focal plane through the origin,
    // then project both the hit and the centre to get the per-tile sample shift.
    // The plane equation's sign cancels in the ratio, so uFocalNormal's orientation
    // doesn't matter.
    float denom = dot(reflDirTile, uFocalNormal);
    if (abs(denom) > 1e-3) {
        float t = dot(-centerW, uFocalNormal) / denom;
        if (t > 0.0) {
            vec4 sphereClip = uReflectViewProj * vec4(centerW + reflDirTile * t, 1.0);
            vec4 flatClip = uMainViewProj * vec4(centerW, 1.0);
            if (sphereClip.w > 0.0 && flatClip.w > 0.0) {
                vec2 sphereUv = sphereClip.xy / sphereClip.w * 0.5 + 0.5;
                vec2 flatUvCenter = flatClip.xy / flatClip.w * 0.5 + 0.5;
                uv = flatUv + (sphereUv - flatUvCenter) * uCurveAmount;
            }
        }
    }
    vec3 refl = texture2D(uReflectionTex, uv).rgb;
    return refl * uMirrorTint * uMirrorTintStrength;
}
void addReflection(vec3 reflDir, float gloss) {
    dReflection += vec4(calcReflection(reflDir, gloss), material_reflectivity);
}
`;

// 4x4 reflection across the plane n·x + d = 0 (n unit), column-major. The 3x3
// block is symmetric; the last column is the -2d·n translation.
function reflectionMatrix(out, n, d) {
    const x = n.x, y = n.y, z = n.z;
    out.set([
        1 - 2 * x * x, -2 * x * y, -2 * x * z, 0,
        -2 * x * y, 1 - 2 * y * y, -2 * y * z, 0,
        -2 * x * z, -2 * y * z, 1 - 2 * z * z, 0,
        -2 * x * d, -2 * y * d, -2 * z * d, 1
    ]);
    return out;
}

export function createDiscoBall(app, cameraEntity, ship) {
    const device = app.graphicsDevice;
    const rng = mulberry32(DISCO.seed);
    const mesh = bakeDiscoBall(device, buildTiles(DISCO, rng), DISCO);

    // Render target the reflection camera draws the van + cans into, sampled by
    // the tiles in screen space. Sized to the screen, recreated on resize.
    function makeReflectRT(w, h) {
        const colorBuffer = new pc.Texture(device, {
            name: 'discoReflectTex', width: w, height: h, format: pc.PIXELFORMAT_RGBA8,
            mipmaps: false, minFilter: pc.FILTER_LINEAR, magFilter: pc.FILTER_LINEAR,
            addressU: pc.ADDRESS_CLAMP_TO_EDGE, addressV: pc.ADDRESS_CLAMP_TO_EDGE
        });
        return new pc.RenderTarget({ name: 'discoReflectRT', colorBuffer, depth: true });
    }
    let rtW = Math.max(1, device.width), rtH = Math.max(1, device.height);
    let reflectRT = makeReflectRT(rtW, rtH);

    // Reflection camera: a mirror image of the main camera across the wall plane.
    // calculateTransform feeds it the reflected world matrix; flipFaces undoes the
    // winding inversion a mirror causes (otherwise the van shows inside-out). It
    // renders only the World layer (van + cans + white void) ahead of the main
    // camera, into reflectRT.
    const reflectWorld = new pc.Mat4();
    const reflectCam = new pc.Entity('discoReflectCam');
    reflectCam.addComponent('camera', {
        clearColor: BG_COLOR,
        layers: [pc.LAYERID_WORLD],
        priority: -10,
        renderTarget: reflectRT,
        fov: cameraEntity.camera.fov,
        nearClip: cameraEntity.camera.nearClip,
        farClip: cameraEntity.camera.farClip
    });
    reflectCam.camera.flipFaces = true;
    reflectCam.camera.calculateTransform = (mat) => mat.copy(reflectWorld);
    app.root.addChild(reflectCam);

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
    mat.setParameter('uReflectionTex', reflectRT.colorBuffer);
    mat.setParameter('uReflectTexel', [1 / rtW, 1 / rtH]);
    mat.setParameter('uCurveAmount', DISCO.curveAmount);
    mat.setParameter('uWallRadius', DISCO.radius);
    const tint = DISCO.mirrorColor;
    mat.setParameter('uMirrorTint', [tint.r, tint.g, tint.b]);
    mat.setParameter('uMirrorTintStrength', DISCO.mirrorTintStrength);
    mat.useFog = true;  // distant tiles fade into the void like everything else
    mat.update();

    // Own layer so the reflection camera can exclude the ball (no mirror-in-mirror).
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

    const _p = new pc.Vec3();
    const _bn = new pc.Vec3();
    const _v = new pc.Vec3();
    const _eye = new pc.Vec3();
    const _fwd = new pc.Vec3();
    const _look = new pc.Vec3();
    const _n = new pc.Vec3();
    const _refl = new pc.Mat4();
    const _viewInv = new pc.Mat4();
    const _viewProj = new pc.Mat4();
    const _mainViewProj = new pc.Mat4();
    const R = DISCO.radius;

    function updateReflection() {
        if (device.width !== rtW || device.height !== rtH) {
            rtW = Math.max(1, device.width); rtH = Math.max(1, device.height);
            reflectRT.destroy();
            reflectRT = makeReflectRT(rtW, rtH);
            reflectCam.camera.renderTarget = reflectRT;
            mat.setParameter('uReflectionTex', reflectRT.colorBuffer);
            mat.setParameter('uReflectTexel', [1 / rtW, 1 / rtH]);
        }

        // Reflection plane = sphere's tangent where the camera looks. Intersect the
        // view ray with the wall sphere; the plane normal is the inward radius there.
        _eye.copy(cameraEntity.getPosition());
        _fwd.copy(cameraEntity.forward);
        // Per-tile curvature reads the scene from the real eye through the main
        // camera's view-projection (set before _eye is mirrored below).
        mat.setParameter('uEye', [_eye.x, _eye.y, _eye.z]);
        _mainViewProj.mul2(cameraEntity.camera.projectionMatrix, _viewInv.copy(cameraEntity.getWorldTransform()).invert());
        mat.setParameter('uMainViewProj', _mainViewProj.data);
        const b = 2 * _eye.dot(_fwd);
        const c = _eye.lengthSq() - R * R;
        const disc = b * b - 4 * c;
        const t = disc > 0 ? (-b + Math.sqrt(disc)) * 0.5 : R;
        _look.copy(_fwd).mulScalar(t).add(_eye);          // point on the wall
        _n.copy(_look).mulScalar(-1).normalize();         // inward normal
        const d = -_n.dot(_look);                         // plane: n·x + d = 0

        reflectionMatrix(_refl, _n, d);
        reflectWorld.mul2(_refl, cameraEntity.getWorldTransform());
        // Node position only feeds the view-position uniform; mirror the eye so
        // specular on the reflected van is computed from the right vantage.
        _refl.transformPoint(_eye, _eye);
        reflectCam.setPosition(_eye);

        // Hand the curved-reflection chunk the mirror camera's view-projection and
        // the focal-plane orientation, so each tile can project its reflected ray's
        // hit point back into this frame's reflection render.
        _viewInv.copy(reflectWorld).invert();
        _viewProj.mul2(reflectCam.camera.projectionMatrix, _viewInv);
        mat.setParameter('uReflectViewProj', _viewProj.data);
        mat.setParameter('uFocalNormal', [_fwd.x, _fwd.y, _fwd.z]);
    }

    function update() {
        updateReflection();

        // Spherical boundary: at the wall, kill outward velocity and clamp back.
        _p.copy(ship.getPosition());
        const dist = _p.length();
        const limit = DISCO.radius - DISCO.boundaryMargin;
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
        setMirrorTint: (r, g, b) => mat.setParameter('uMirrorTint', [r, g, b]),
        setTintStrength: (v) => mat.setParameter('uMirrorTintStrength', v),
        setCurveAmount: (v) => mat.setParameter('uCurveAmount', v)
    };
}
