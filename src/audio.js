import { COLLISION_SOUND } from './config.js';

// Procedural "tin can" collision sound. No audio asset — every clank is
// synthesized live from a metallic ring (a few inharmonic partials) plus a
// short noisy attack transient, so the whole character is tweakable from the
// sidebar. See COLLISION_SOUND in config.js for the parameters and their ranges.
//
// Browsers block audio until a user gesture, so the AudioContext is created
// lazily in unlock() (called from the same click that starts click-to-fly) and
// nothing is heard before then. trigger(impactSpeed) is the per-hit voice;
// test() plays a reference hit for the sidebar's Test button.

// Modal frequency ratios of a struck metal object (inharmonic) and the plain
// harmonic series. `metallic` blends between them: 0 = pitched/bell-ish,
// 1 = clangy/tin. Four partials is enough to read as metal without muddiness.
const HARMONIC = [1, 2, 3, 4];
const INHARMONIC = [1, 2.76, 5.4, 8.93];

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function createCollisionAudio() {
    // Live params: the sidebar mutates this in place and trigger() reads it
    // fresh, so slider moves take effect on the very next hit.
    const params = { ...COLLISION_SOUND };

    let ctx = null;          // created on first gesture
    let master = null;       // shared output bus (all voices -> compressor -> out)
    let noiseBuffer = null;  // reused white-noise buffer for the attack transient
    let lastHit = -1e9;      // ctx time of the last played hit (cooldown gate)

    const api = { params, muted: false, unlock, trigger, test };
    return api;

    // ---- setup -------------------------------------------------------------

    // Idempotent: builds the context + output bus once, and resumes it (a
    // context can start "suspended" until a gesture). Safe to call on every
    // pointerdown.
    function unlock() {
        if (!ctx) {
            const AC = window.AudioContext || window.webkitAudioContext;
            if (!AC) return; // no Web Audio (very old browser) — stay silent
            ctx = new AC();

            // A gentle limiter so a burst of simultaneous clanks (van shoving a
            // cluster of cans) can't clip into a nasty digital crackle.
            const comp = ctx.createDynamicsCompressor();
            comp.threshold.value = -12;
            comp.ratio.value = 12;
            comp.attack.value = 0.003;
            comp.release.value = 0.25;

            master = ctx.createGain();
            master.gain.value = 1;
            master.connect(comp);
            comp.connect(ctx.destination);

            // 0.3 s of white noise, generated once and reused for every attack.
            const len = Math.floor(ctx.sampleRate * 0.3);
            noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
            const data = noiseBuffer.getChannelData(0);
            for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
        }
        if (ctx.state === 'suspended') ctx.resume();
    }

    // ---- playback ----------------------------------------------------------

    // Play one tin-can hit whose loudness tracks impactSpeed. No-ops before the
    // context is unlocked, while muted, below minSpeed, or within the cooldown
    // window since the last hit.
    function trigger(impactSpeed) {
        if (!ctx || api.muted) return;
        const p = params;
        if (impactSpeed < p.minSpeed) return;

        const now = ctx.currentTime;
        if ((now - lastHit) * 1000 < p.cooldown) return;
        lastHit = now;

        // Normalize impact between the silent floor and the full-volume
        // reference, then shape it with the sensitivity exponent.
        const span = Math.max(0.001, p.refSpeed - p.minSpeed);
        const norm = clamp((impactSpeed - p.minSpeed) / span, 0, 1);
        const amp = p.volume * Math.pow(norm, p.sensitivity);
        if (amp <= 0.0001) return;

        // Per-hit detune so repeated hits never sound identical.
        const base = p.pitch * (1 + (Math.random() * 2 - 1) * p.pitchRandom);
        const decay = Math.max(0.02, p.decay);
        const end = now + decay + 0.05;

        // --- Metallic ring: inharmonic partials, each with its own decay. -----
        for (let i = 0; i < INHARMONIC.length; i++) {
            const ratio = HARMONIC[i] + (INHARMONIC[i] - HARMONIC[i]) * p.metallic;
            const osc = ctx.createOscillator();
            osc.type = i === 0 ? 'triangle' : 'sine';
            osc.frequency.value = base * ratio;

            // Higher partials are quieter and shorter — but `brightness` lifts
            // them back up, so a bright can keeps its high shimmer longer.
            const bright = 0.4 + p.brightness;
            const partialAmp = amp * Math.pow(bright / (i + 1), 1.3);
            const partialDecay = decay * (1 - i * 0.18);

            const g = ctx.createGain();
            g.gain.setValueAtTime(Math.max(0.0001, partialAmp), now);
            g.gain.exponentialRampToValueAtTime(0.0001, now + Math.max(0.02, partialDecay));

            osc.connect(g);
            g.connect(master);
            osc.start(now);
            osc.stop(end);
            osc.onended = () => { osc.disconnect(); g.disconnect(); };
        }

        // --- Attack transient: a short filtered noise "tink". ----------------
        const noise = ctx.createBufferSource();
        noise.buffer = noiseBuffer;
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = 1500 + p.brightness * 4500; // brighter -> higher
        bp.Q.value = 1.2;
        const ng = ctx.createGain();
        const attackAmp = amp * p.attack * 1.5;
        ng.gain.setValueAtTime(Math.max(0.0001, attackAmp), now);
        ng.gain.exponentialRampToValueAtTime(0.0001, now + 0.025);
        noise.connect(bp);
        bp.connect(ng);
        ng.connect(master);
        noise.start(now);
        noise.stop(now + 0.05);
        noise.onended = () => { noise.disconnect(); bp.disconnect(); ng.disconnect(); };
    }

    // Reference hit for the sidebar Test button — unlock first so it works even
    // before the first collision.
    function test() {
        unlock();
        trigger(params.refSpeed);
    }
}
