import * as pc from '../lib/playcanvas.mjs';

// Builds a rounded-box mesh: a rectangular box whose edges and corners are
// rounded off by `radius`. The dimensions are baked into the geometry (no
// non-uniform entity scale), so the rounding stays an even bevel on every axis.
//
// Construction: each of the 6 faces is a grid sampled densely across the two
// rounded bands (one per edge) and sparsely across the flat middle. Every
// sampled point is projected onto the surface of the rounded box by clamping it
// to the inner (un-rounded) box and pushing it out along the offset direction
// by `radius`. That offset direction is also the exact surface normal, so the
// shading is perfectly smooth and face seams line up vertex-for-vertex.

function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
}

// Sample positions along one axis: `seg` segments through each rounded band
// plus a single flat span across the middle. Returns 2*(seg+1) values.
function axisSamples(he, inner, seg) {
    const vals = [];
    for (let i = 0; i <= seg; i++) vals.push(-he + (he - inner) * (i / seg));
    for (let i = 0; i <= seg; i++) vals.push(inner + (he - inner) * (i / seg));
    return vals;
}

const FACES = [
    { axis: 0, sign:  1, u: 2, v: 1 },
    { axis: 0, sign: -1, u: 2, v: 1 },
    { axis: 1, sign:  1, u: 0, v: 2 },
    { axis: 1, sign: -1, u: 0, v: 2 },
    { axis: 2, sign:  1, u: 0, v: 1 },
    { axis: 2, sign: -1, u: 0, v: 1 }
];

export function createRoundedBoxMesh(device, halfExtents, radius, seg = 6) {
    const he = [halfExtents.x, halfExtents.y, halfExtents.z];
    const r = Math.min(radius, 0.99 * Math.min(he[0], he[1], he[2]));
    const inner = [he[0] - r, he[1] - r, he[2] - r];

    const positions = [];
    const normals = [];
    const uvs = [];
    const indices = [];

    for (const f of FACES) {
        const us = axisSamples(he[f.u], inner[f.u], seg);
        const vs = axisSamples(he[f.v], inner[f.v], seg);
        const base = positions.length / 3;

        for (let iv = 0; iv < vs.length; iv++) {
            for (let iu = 0; iu < us.length; iu++) {
                const p = [0, 0, 0];
                p[f.axis] = f.sign * he[f.axis];
                p[f.u] = us[iu];
                p[f.v] = vs[iv];

                const c = [
                    clamp(p[0], -inner[0], inner[0]),
                    clamp(p[1], -inner[1], inner[1]),
                    clamp(p[2], -inner[2], inner[2])
                ];
                const d = [p[0] - c[0], p[1] - c[1], p[2] - c[2]];
                const len = Math.hypot(d[0], d[1], d[2]) || 1;
                const n = [d[0] / len, d[1] / len, d[2] / len];

                positions.push(c[0] + n[0] * r, c[1] + n[1] * r, c[2] + n[2] * r);
                normals.push(n[0], n[1], n[2]);
                uvs.push(iu / (us.length - 1), iv / (vs.length - 1));
            }
        }

        // Winding: keep triangles CCW when viewed from outside. The grid's
        // u->v cross product points along ±axis; flip the order when it points
        // inward so back-face culling shows the outer surface.
        const cross = [0, 0, 0];
        const eu = [0, 0, 0]; eu[f.u] = 1;
        const ev = [0, 0, 0]; ev[f.v] = 1;
        cross[0] = eu[1] * ev[2] - eu[2] * ev[1];
        cross[1] = eu[2] * ev[0] - eu[0] * ev[2];
        cross[2] = eu[0] * ev[1] - eu[1] * ev[0];
        const ccw = cross[f.axis] * f.sign > 0;

        const stride = us.length;
        for (let iv = 0; iv < vs.length - 1; iv++) {
            for (let iu = 0; iu < us.length - 1; iu++) {
                const a = base + iv * stride + iu;
                const b = a + 1;
                const c2 = a + stride + 1;
                const dd = a + stride;
                if (ccw) {
                    indices.push(a, b, c2, a, c2, dd);
                } else {
                    indices.push(a, c2, b, a, dd, c2);
                }
            }
        }
    }

    const geom = new pc.Geometry();
    geom.positions = positions;
    geom.normals = normals;
    geom.uvs = uvs;
    geom.indices = indices;
    return pc.Mesh.fromGeometry(device, geom);
}
