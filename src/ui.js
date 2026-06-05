import * as pc from '../lib/playcanvas.mjs';
import { PLAYER_COLOR, VAN_PITCH, DISCO } from './config.js';
import { setVanPitch } from './player.js';

const FOG_TYPES = {
    none: pc.FOG_NONE, linear: pc.FOG_LINEAR, exp: pc.FOG_EXP, exp2: pc.FOG_EXP2
};
const TONE_MAPS = {
    linear: pc.TONEMAP_LINEAR, neutral: pc.TONEMAP_NEUTRAL,
    aces: pc.TONEMAP_ACES, filmic: pc.TONEMAP_FILMIC
};

function hex2rgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
function rgb2hex(r, g, b) {
    const c = (v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0');
    return `#${c(r)}${c(g)}${c(b)}`;
}

const STYLE = `
#sidebar{position:fixed;top:0;right:0;width:288px;max-height:100%;overflow-y:auto;
 box-sizing:border-box;padding:8px 12px 24px;background:rgba(255,255,255,0.92);
 border-left:1px solid #ddd;font:12px/1.3 -apple-system,system-ui,sans-serif;color:#333;
 z-index:10;backdrop-filter:blur(4px);}
#sidebar h2{margin:4px 0 12px;font-size:13px;letter-spacing:.04em;color:#111;}
#sidebar fieldset{border:1px solid #e3e3e3;border-radius:6px;margin:0 0 10px;padding:6px 10px 10px;}
#sidebar legend{padding:0 4px;color:#888;font-weight:600;text-transform:uppercase;font-size:10px;letter-spacing:.06em;}
#sidebar .row{display:grid;grid-template-columns:1fr 96px 34px;align-items:center;gap:6px;margin:5px 0;}
#sidebar .row.wide{grid-template-columns:1fr auto;}
#sidebar label{color:#555;}
#sidebar input[type=range]{width:100%;}
#sidebar input[type=color]{width:96px;height:20px;padding:0;border:1px solid #ccc;border-radius:3px;background:none;}
#sidebar select{width:100%;}
#sidebar .val{text-align:right;color:#999;font-variant-numeric:tabular-nums;}
`;

// Hand-rolled tweak panel. Wires range/color/select inputs directly to live
// scene, material, environment and post-process state so every change shows
// without a reload. The panel is a sibling of the canvas, so clicking it does
// not trigger the canvas's pointer-lock (click-to-fly): press Esc to release
// the lock, tweak, then click the canvas to fly again.
export function createSidebar(ctx) {
    const { scene, light, materials, playerMaterial, van, cf, disco } = ctx;
    const allMaterials = [playerMaterial, ...materials];

    const style = document.createElement('style');
    style.textContent = STYLE;
    document.head.appendChild(style);

    const bar = document.createElement('div');
    bar.id = 'sidebar';
    bar.addEventListener('pointerdown', (e) => e.stopPropagation());
    bar.innerHTML = '<h2>ATMOSPHERE & LIGHTING</h2>';
    document.body.appendChild(bar);

    function section(name) {
        const fs = document.createElement('fieldset');
        fs.innerHTML = `<legend>${name}</legend>`;
        bar.appendChild(fs);
        return fs;
    }

    function slider(parent, label, min, max, step, value, onInput) {
        const row = document.createElement('div');
        row.className = 'row';
        row.innerHTML = `<label>${label}</label>`;
        const range = document.createElement('input');
        range.type = 'range';
        range.min = min; range.max = max; range.step = step; range.value = value;
        const val = document.createElement('span');
        val.className = 'val';
        val.textContent = value;
        range.addEventListener('input', () => {
            val.textContent = range.value;
            onInput(parseFloat(range.value));
        });
        row.appendChild(range);
        row.appendChild(val);
        parent.appendChild(row);
    }

    function color(parent, label, hex, onInput) {
        const row = document.createElement('div');
        row.className = 'row wide';
        row.innerHTML = `<label>${label}</label>`;
        const inp = document.createElement('input');
        inp.type = 'color';
        inp.value = hex;
        inp.addEventListener('input', () => onInput(inp.value));
        row.appendChild(inp);
        parent.appendChild(row);
    }

    function select(parent, label, options, current, onInput) {
        const row = document.createElement('div');
        row.className = 'row wide';
        row.innerHTML = `<label>${label}</label>`;
        const sel = document.createElement('select');
        for (const o of options) {
            const opt = document.createElement('option');
            opt.value = o; opt.textContent = o;
            if (o === current) opt.selected = true;
            sel.appendChild(opt);
        }
        sel.addEventListener('change', () => onInput(sel.value));
        row.appendChild(sel);
        parent.appendChild(row);
    }

    // ----- Van -----
    const vanSec = section('Van');
    slider(vanSec, 'Pitch (up/down)', -45, 45, 1, VAN_PITCH,
        (v) => setVanPitch(van, v));
    color(vanSec, 'Color', rgb2hex(PLAYER_COLOR.r, PLAYER_COLOR.g, PLAYER_COLOR.b),
        (h) => { playerMaterial.diffuse.set(...hex2rgb(h)); playerMaterial.update(); });

    // ----- Atmosphere (fog) -----
    const atm = section('Atmosphere');
    select(atm, 'Fog type', ['none', 'linear', 'exp', 'exp2'], 'linear',
        (v) => { scene.fog.type = FOG_TYPES[v]; });
    color(atm, 'Fog color', rgb2hex(0.93, 0.95, 0.97),
        (h) => scene.fog.color.set(...hex2rgb(h)));
    slider(atm, 'Fog start', 0, 40, 0.5, 3.5, (v) => { scene.fog.start = v; });
    slider(atm, 'Fog end', 5, 120, 1, 46, (v) => { scene.fog.end = v; });
    slider(atm, 'Fog density', 0, 0.1, 0.001, 0.096, (v) => { scene.fog.density = v; });

    // ----- Lighting -----
    const lit = section('Lighting');
    let ambHex = '#c0392b', ambInt = 0.86;
    const applyAmbient = () => {
        const [r, g, b] = hex2rgb(ambHex);
        scene.ambientLight = new pc.Color(r * ambInt, g * ambInt, b * ambInt);
    };
    color(lit, 'Ambient color', ambHex, (h) => { ambHex = h; applyAmbient(); });
    slider(lit, 'Ambient intensity', 0, 1.5, 0.01, ambInt, (v) => { ambInt = v; applyAmbient(); });
    color(lit, 'Sun color', '#ffffff', (h) => light.light.color.set(...hex2rgb(h)));
    slider(lit, 'Sun intensity', 0, 3, 0.01, 3, (v) => { light.light.intensity = v; });
    let yaw = -53, pitch = 10;
    slider(lit, 'Sun yaw', -180, 180, 1, yaw, (v) => { yaw = v; light.setEulerAngles(pitch, yaw, 0); });
    slider(lit, 'Sun pitch', 0, 90, 1, pitch, (v) => { pitch = v; light.setEulerAngles(pitch, yaw, 0); });
    slider(lit, 'Env intensity', 0, 3, 0.01, 1.03, (v) => { scene.skyboxIntensity = v; });

    // ----- Materials -----
    const mat = section('Materials');
    const applyMat = (prop, v) => {
        for (const m of allMaterials) { m[prop] = v; m.update(); }
    };
    slider(mat, 'Gloss', 0, 1, 0.01, 0.76, (v) => applyMat('gloss', v));
    slider(mat, 'Metalness', 0, 1, 0.01, 0.43, (v) => applyMat('metalness', v));
    slider(mat, 'Reflectivity', 0, 1, 0.01, 0.57, (v) => applyMat('reflectivity', v));

    // ----- Mirrors (disco ball) -----
    const mir = section('Mirrors');
    const mc = DISCO.mirrorColor;
    color(mir, 'Mirror tint', rgb2hex(mc.r, mc.g, mc.b),
        (h) => disco.setMirrorTint(...hex2rgb(h)));
    slider(mir, 'Tint strength', 0, 2, 0.01, DISCO.mirrorTintStrength,
        (v) => disco.setTintStrength(v));
    slider(mir, 'Reflectivity', 0, 1, 0.01, DISCO.mirrorReflectivity,
        (v) => { disco.material.reflectivity = v; disco.material.update(); });
    slider(mir, 'Curvature', 0, 1, 0.01, DISCO.curveAmount,
        (v) => disco.setCurveAmount(v));

    // ----- Post -----
    const post = section('Post (halo)');
    select(post, 'Tone map', ['linear', 'neutral', 'aces', 'filmic'], 'linear',
        (v) => { cf.rendering.toneMapping = TONE_MAPS[v]; cf.update(); });
    slider(post, 'Bloom intensity', 0, 0.2, 0.005, 0.035, (v) => { cf.bloom.intensity = v; cf.update(); });
    slider(post, 'Bloom blur', 1, 16, 1, 4, (v) => { cf.bloom.blurLevel = v; cf.update(); });
    slider(post, 'Vignette', 0, 1, 0.01, 0.12, (v) => { cf.vignette.intensity = v; cf.update(); });
    select(post, 'MSAA', ['1', '2', '4'], '4',
        (v) => { cf.rendering.samples = parseInt(v, 10); cf.update(); });
}
