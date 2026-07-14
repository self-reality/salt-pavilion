import { COLLISION_SOUND, THRUST_SOUND } from './config.js';

// All of the game's synthesized audio, sharing one AudioContext and output bus:
//
//   • Collision "tin can" clank — every van↔can hit is synthesized live from a
//     metallic ring (a few inharmonic partials) plus a short noisy attack
//     transient. trigger(impactSpeed) is the per-hit voice.
//   • Thrust "organ" drone — a sustained pipe/Hammond-organ tone built from nine
//     always-on drawbar partials plus a Leslie swirl, whose envelope swells
//     while the van thrusts and fades when it coasts. setThrust(level) drives it.
//
// Both read their params from live objects (COLLISION_SOUND / THRUST_SOUND) so
// every character is tweakable from the sidebar. Browsers block audio until a
// user gesture, so the AudioContext is created lazily in unlock() (called from
// the same click that starts click-to-fly) and nothing is heard before then.

// Modal frequency ratios of a struck metal object (inharmonic) and the plain
// harmonic series. `metallic` blends between them: 0 = pitched/bell-ish,
// 1 = clangy/tin. Four partials is enough to read as metal without muddiness.
const HARMONIC = [1, 2, 3, 4];
const INHARMONIC = [1, 2.76, 5.4, 8.93];

// Footage ratios (relative to 8' = the fundamental) of the nine Hammond
// drawbars, in the panel's slider order: 16', 5⅓', 8', 4', 2⅔', 2', 1⅗', 1⅓', 1'.
const DRAWBAR_RATIOS = [0.5, 1.5, 1, 2, 3, 4, 5, 6, 8];

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function createAudio() {
    // Live params: the sidebar mutates these in place. Collision is re-read on
    // every hit; the organ's running nodes are updated via refreshThrust().
    const params = { ...COLLISION_SOUND };
    const thrust = { ...THRUST_SOUND, drawbars: [...THRUST_SOUND.drawbars] };

    let ctx = null;          // created on first gesture
    let master = null;       // shared output bus (all voices -> compressor -> out)
    let noiseBuffer = null;  // reused white-noise buffer for the attack transient
    let lastHit = -1e9;      // ctx time of the last played hit (cooldown gate)

    // Organ voice: nine sustained partials + one Leslie (vibrato + tremolo LFOs),
    // gated by an attack/release envelope. Built once, in unlock().
    let organEnv = null, organMix = null;
    let organOscs = null, organGains = null;
    let vibLfo = null, vibDepthGain = null, tremLfo = null, tremDepthGain = null;
    let curLevel = 0;        // current thrust 0..1 driving the envelope
    let curTarget = -1;      // last envelope target (for attack-vs-release choice)
    let testUntil = 0;       // ctx time until which testThrust() owns the voice

    const api = {
        params, thrust, muted: false, thrustMuted: false,
        unlock, trigger, test, setThrust, refreshThrust, testThrust
    };
    return api;

    // ---- setup -------------------------------------------------------------

    // Idempotent: builds the context + output bus + organ voice once, and
    // resumes the context (it can start "suspended" until a gesture). Safe to
    // call on every pointerdown.
    function unlock() {
        if (!ctx) {
            const AC = window.AudioContext || window.webkitAudioContext;
            if (!AC) return; // no Web Audio (very old browser) — stay silent
            ctx = new AC();

            // A gentle limiter so a burst of simultaneous clanks (van shoving a
            // cluster of cans) or a full-throttle organ can't clip into a nasty
            // digital crackle.
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

            buildOrgan();
        }
        if (ctx.state === 'suspended') ctx.resume();
    }

    // ---- collision ---------------------------------------------------------

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

    // ---- thrust (organ) ----------------------------------------------------

    function drawbarSum() {
        let s = 0;
        for (let i = 0; i < thrust.drawbars.length; i++) s += thrust.drawbars[i];
        return s || 1; // avoid a divide-by-zero when every drawbar is pulled out
    }

    // Wire the sustained organ voice. Runs once (from unlock): nine sine
    // partials all feed a mix bus, one Leslie modulates them (vibrato -> every
    // partial's detune, tremolo -> the mix gain), and an envelope gain is what
    // actually makes it audible — it sits at ~0 until thrust swells it.
    function buildOrgan() {
        organMix = ctx.createGain();
        organMix.gain.value = 1;
        organEnv = ctx.createGain();
        organEnv.gain.value = 0;
        organMix.connect(organEnv);
        organEnv.connect(master);

        // One Leslie at `thrust.vibrato` Hz: a vibrato LFO into every partial's
        // detune (pitch swirl) and a tremolo LFO into the mix gain (amplitude
        // swirl). detune is in cents, so the wobble is constant across partials.
        vibLfo = ctx.createOscillator();
        vibLfo.type = 'sine';
        vibLfo.frequency.value = thrust.vibrato;
        vibDepthGain = ctx.createGain();
        vibDepthGain.gain.value = thrust.vibratoDepth;
        vibLfo.connect(vibDepthGain);
        vibLfo.start();

        tremLfo = ctx.createOscillator();
        tremLfo.type = 'sine';
        tremLfo.frequency.value = thrust.vibrato;
        tremDepthGain = ctx.createGain();
        tremDepthGain.gain.value = thrust.tremolo;
        tremLfo.connect(tremDepthGain);
        tremDepthGain.connect(organMix.gain); // sums with the .value of 1
        tremLfo.start();

        // Nine always-on sine partials (the drawbars), normalized so a full
        // registration peaks near unity before the envelope/volume scale it.
        const sum = drawbarSum();
        organOscs = [];
        organGains = [];
        for (let i = 0; i < DRAWBAR_RATIOS.length; i++) {
            const osc = ctx.createOscillator();
            osc.type = 'sine';
            osc.frequency.value = thrust.pitch * DRAWBAR_RATIOS[i];
            vibDepthGain.connect(osc.detune);
            const g = ctx.createGain();
            g.gain.value = thrust.drawbars[i] / sum;
            osc.connect(g);
            g.connect(organMix);
            osc.start();
            organOscs.push(osc);
            organGains.push(g);
        }
    }

    // Push the current thrust level (and the live volume/attack/release/bend/
    // mute params) onto the running voice: the envelope glides toward its target
    // and every partial's base detune glides toward the throttle-up bend.
    function applyEnv() {
        if (!organEnv) return;
        const now = ctx.currentTime;
        const target = api.thrustMuted ? 0 : thrust.volume * curLevel;
        const rising = target > curTarget;
        const tc = Math.max(0.005, (rising ? thrust.attack : thrust.release) / 3);
        organEnv.gain.setTargetAtTime(target, now, tc);
        curTarget = target;

        const bend = thrust.bend * curLevel;
        for (let i = 0; i < organOscs.length; i++) {
            organOscs[i].detune.setTargetAtTime(bend, now, 0.05);
        }
    }

    // Called every frame from the controls with 0..1 = how hard the van is
    // thrusting. Cheap no-op until the level actually moves (or while a Test
    // swell owns the voice).
    function setThrust(level) {
        if (!organEnv) return;
        if (ctx.currentTime < testUntil) return;
        level = clamp(level, 0, 1);
        if (Math.abs(level - curLevel) < 1e-3) return;
        curLevel = level;
        applyEnv();
    }

    // Re-read every thrust param onto the live nodes — called by the sidebar
    // after any organ slider moves so changes are heard while the drone sounds.
    function refreshThrust() {
        if (!organOscs) return;
        const sum = drawbarSum();
        for (let i = 0; i < organOscs.length; i++) {
            organOscs[i].frequency.value = thrust.pitch * DRAWBAR_RATIOS[i];
            organGains[i].gain.value = thrust.drawbars[i] / sum;
        }
        vibLfo.frequency.value = thrust.vibrato;
        tremLfo.frequency.value = thrust.vibrato;
        vibDepthGain.gain.value = thrust.vibratoDepth;
        tremDepthGain.gain.value = thrust.tremolo;
        applyEnv();
    }

    // Sidebar Test button: a ~1 s organ swell so the timbre is audible without
    // flying. testUntil makes it briefly ignore the controls' per-frame
    // setThrust(0) so the swell isn't cut off the instant it starts.
    function testThrust() {
        unlock();
        curLevel = 1;
        applyEnv();
        testUntil = ctx.currentTime + 0.9;
        clearTimeout(testThrust._t);
        testThrust._t = setTimeout(() => {
            testUntil = 0;
            curLevel = 0;
            applyEnv();
        }, 900);
    }
}
