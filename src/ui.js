import * as pc from '../lib/playcanvas.mjs';
import {
    PLAYER_COLOR, VAN_PITCH, DISCO,
    VAN_DENSITY, CAN_DENSITY, ATMO_DENSITY, HANDLING_FORCE
} from './config.js';
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
#sidebar .row input[type=checkbox]{margin:0;justify-self:start;}
#sidebar .row button{grid-column:1/-1;padding:5px 8px;font:inherit;color:#333;
 background:#f2f2f2;border:1px solid #ccc;border-radius:4px;cursor:pointer;}
#sidebar .row button:hover{background:#e8e8e8;}
#sidebar .row button:active{background:#dcdcdc;}
`;

// Hand-rolled tweak panel. Wires range/color/select inputs directly to live
// scene, material, environment and post-process state so every change shows
// without a reload. The panel is a sibling of the canvas, so clicking it does
// not trigger the canvas's pointer-lock (click-to-fly): press Esc to release
// the lock, tweak, then click the canvas to fly again.
export function createSidebar(ctx) {
    const { app, scene, light, materials, playerMaterial, ship, van, cans, controls, cf, disco, audio } = ctx;

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

    function toggle(parent, label, checked, onInput) {
        const row = document.createElement('div');
        row.className = 'row wide';
        row.innerHTML = `<label>${label}</label>`;
        const inp = document.createElement('input');
        inp.type = 'checkbox';
        inp.checked = checked;
        inp.addEventListener('change', () => onInput(inp.checked));
        row.appendChild(inp);
        parent.appendChild(row);
    }

    function button(parent, label, onClick) {
        const row = document.createElement('div');
        row.className = 'row wide';
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = label;
        btn.addEventListener('click', onClick);
        row.appendChild(btn);
        parent.appendChild(row);
    }

    // Live, read-only stat row. Returns its value span so the frame loop can
    // write to it each refresh.
    function readout(parent, label) {
        const row = document.createElement('div');
        row.className = 'row wide';
        row.innerHTML = `<label>${label}</label>`;
        const val = document.createElement('span');
        val.className = 'val';
        val.textContent = '—';
        row.appendChild(val);
        parent.appendChild(row);
        return val;
    }

    // ----- Performance -----
    // Live readouts, updated from the engine's own frame events. "CPU" is the
    // main-thread busy time per frame (frameupdate → frameend), which is the
    // only processor-usage signal a browser exposes; there is no OS CPU API.
    // "Memory" is the JS heap via performance.memory (Chromium only).
    const perf = section('Performance');
    const fpsOut = readout(perf, 'FPS');
    const frameOut = readout(perf, 'Frame time');
    const cpuOut = readout(perf, 'CPU (main thread)');
    const memOut = readout(perf, 'JS heap');

    const MB = 1024 * 1024;
    const mem = performance.memory; // non-standard; Chromium-only
    if (!mem) memOut.textContent = 'unavailable';

    let frameStart = performance.now();
    let lastEnd = frameStart;
    // Exponential moving averages so the text is readable, not a blur. FPS is
    // derived from emaInterval at display time so the two can never disagree.
    let emaInterval = 1000 / 60, emaBusy = 0;
    const smooth = (avg, sample, a = 0.1) => avg + (sample - avg) * a;

    app.on('frameupdate', () => { frameStart = performance.now(); });
    app.on('frameend', () => {
        const now = performance.now();
        emaBusy = smooth(emaBusy, now - frameStart);
        emaInterval = smooth(emaInterval, now - lastEnd);
        lastEnd = now;
    });

    // Refresh the DOM at ~5 Hz rather than every frame.
    let acc = 0;
    app.on('update', (dt) => {
        acc += dt;
        if (acc < 0.2) return;
        acc = 0;
        fpsOut.textContent = (1000 / Math.max(emaInterval, 0.001)).toFixed(0);
        frameOut.textContent = `${emaInterval.toFixed(1)} ms`;
        const load = (emaBusy / Math.max(emaInterval, 0.001)) * 100;
        cpuOut.textContent = `${emaBusy.toFixed(1)} ms · ${load.toFixed(0)}%`;
        if (mem) {
            memOut.textContent =
                `${(mem.usedJSHeapSize / MB).toFixed(0)} / ${(mem.jsHeapSizeLimit / MB).toFixed(0)} MB`;
        }
    });

    // ----- Van -----
    const vanSec = section('Van');
    // Density rescales mass against the fixed collider volume, so the same
    // thrust pushes a denser van more sluggishly.
    const he = ship.collision.halfExtents;
    const shipVolume = 8 * he.x * he.y * he.z;
    slider(vanSec, 'Density', 0.2, 10, 0.02, VAN_DENSITY,
        (v) => { ship.rigidbody.mass = v * shipVolume; });
    slider(vanSec, 'Handling (grip)', 0, 200, 1, HANDLING_FORCE,
        (v) => controls.setHandling(v));
    slider(vanSec, 'Pitch (up/down)', -45, 45, 1, VAN_PITCH,
        (v) => setVanPitch(van, v));
    color(vanSec, 'Color', rgb2hex(PLAYER_COLOR.r, PLAYER_COLOR.g, PLAYER_COLOR.b),
        (h) => { playerMaterial.diffuse.set(...hex2rgb(h)); playerMaterial.update(); });

    // ----- Cans -----
    const canSec = section('Cans');
    slider(canSec, 'Density', 0.05, 10, 0.05, CAN_DENSITY,
        (v) => cans.setCanDensity(v));

    // ----- Collision sound -----
    // Sliders mutate audio.params in place; audio.js reads it fresh on every
    // hit, so tweaks are audible on the next clank (or immediately via Test).
    const snd = section('Collision sound');
    const p = audio.params;
    slider(snd, 'Volume', 0, 1, 0.01, p.volume, (v) => { p.volume = v; });
    slider(snd, 'Pitch (Hz)', 120, 1200, 1, p.pitch, (v) => { p.pitch = v; });
    slider(snd, 'Ring (decay s)', 0.05, 1.0, 0.01, p.decay, (v) => { p.decay = v; });
    slider(snd, 'Brightness', 0, 1, 0.01, p.brightness, (v) => { p.brightness = v; });
    slider(snd, 'Metallic', 0, 1, 0.01, p.metallic, (v) => { p.metallic = v; });
    slider(snd, 'Attack (tink)', 0, 1, 0.01, p.attack, (v) => { p.attack = v; });
    slider(snd, 'Min speed', 0, 5, 0.05, p.minSpeed, (v) => { p.minSpeed = v; });
    slider(snd, 'Ref speed', 2, 30, 0.5, p.refSpeed, (v) => { p.refSpeed = v; });
    slider(snd, 'Sensitivity', 0.2, 2, 0.01, p.sensitivity, (v) => { p.sensitivity = v; });
    slider(snd, 'Pitch random', 0, 0.3, 0.005, p.pitchRandom, (v) => { p.pitchRandom = v; });
    slider(snd, 'Cooldown (ms)', 0, 200, 1, p.cooldown, (v) => { p.cooldown = v; });
    toggle(snd, 'Mute', audio.muted, (v) => { audio.muted = v; });
    button(snd, 'Test sound', () => audio.test());

    // ----- Hero can (focused ?artist=) initial pose -----
    // Sliders mutate the shared hero pose in place and re-teleport the can live.
    // Inert until an ?artist= can streams in; the defaults reflect config.js.
    const hero = cans.hero;
    const heroSec = section('Hero can (?artist=)');
    slider(heroSec, 'Pos X', -30, 30, 0.1, hero.position.x,
        (v) => { hero.position.x = v; hero.apply(); });
    slider(heroSec, 'Pos Y', -30, 30, 0.1, hero.position.y,
        (v) => { hero.position.y = v; hero.apply(); });
    slider(heroSec, 'Pos Z', -30, 30, 0.1, hero.position.z,
        (v) => { hero.position.z = v; hero.apply(); });
    slider(heroSec, 'Angle X', -180, 180, 1, hero.eulerAngles.x,
        (v) => { hero.eulerAngles.x = v; hero.apply(); });
    slider(heroSec, 'Angle Y', -180, 180, 1, hero.eulerAngles.y,
        (v) => { hero.eulerAngles.y = v; hero.apply(); });
    slider(heroSec, 'Angle Z', -180, 180, 1, hero.eulerAngles.z,
        (v) => { hero.eulerAngles.z = v; hero.apply(); });

    // ----- Atmosphere (drag + fog) -----
    const atm = section('Atmosphere');
    // Density is drag: the ship's linear damping, with cans feeling a scaled
    // share of it (see CAN_DRAG). 0 = vacuum, high = flying through soup.
    slider(atm, 'Density (drag)', 0, 0.9, 0.005, ATMO_DENSITY, (v) => {
        ship.rigidbody.linearDamping = v;
        cans.setAtmoDensity(v);
    });
    select(atm, 'Fog type', ['none', 'linear', 'exp', 'exp2'], 'linear',
        (v) => { scene.fog.type = FOG_TYPES[v]; });
    color(atm, 'Fog color', rgb2hex(1, 1, 1),
        (h) => scene.fog.color.set(...hex2rgb(h)));
    slider(atm, 'Fog start', 0, 40, 0.5, 21.5, (v) => { scene.fog.start = v; });
    slider(atm, 'Fog end', 5, 120, 1, 82, (v) => { scene.fog.end = v; });
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
    // `materials` is a live array (cans stream in after the sidebar is built),
    // so spread it at use time rather than snapshotting it here.
    const applyMat = (prop, v) => {
        for (const m of [playerMaterial, ...materials]) { m[prop] = v; m.update(); }
    };
    slider(mat, 'Gloss', 0, 1, 0.01, 0.83, (v) => applyMat('gloss', v));
    slider(mat, 'Metalness', 0, 1, 0.01, 0.84, (v) => applyMat('metalness', v));
    slider(mat, 'Reflectivity', 0, 1, 0.01, 1, (v) => applyMat('reflectivity', v));

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
    slider(post, 'Bloom intensity', 0, 0.2, 0.005, 0.03, (v) => { cf.bloom.intensity = v; cf.update(); });
    slider(post, 'Bloom blur', 1, 16, 1, 3, (v) => { cf.bloom.blurLevel = v; cf.update(); });
    slider(post, 'Vignette', 0, 1, 0.01, 0, (v) => { cf.vignette.intensity = v; cf.update(); });
    select(post, 'MSAA', ['1', '2', '4'], '4',
        (v) => { cf.rendering.samples = parseInt(v, 10); cf.update(); });
}
