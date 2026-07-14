import * as pc from '../lib/playcanvas.mjs';

// ---------------------------------------------------------------------------
// All tunable parameters live here so the rest of the code reads cleanly.
// ---------------------------------------------------------------------------

// Player ship: a black van model. PLAYER_SIZE no longer sizes the ship (the
// collision box is derived from the loaded van), but obstacles still scale
// relative to it, so it stays as the reference size.
export const PLAYER_SIZE = new pc.Vec3(1.4, 0.8, 2.4); // x=width, y=height, z=length
export const PLAYER_COLOR = new pc.Color(197 / 255, 163 / 255, 219 / 255); // 197,163,219

// Densities (mass per world-unit³ of collider box). Every body's mass is
// density × its collider volume, so bigger cans really are heavier and the
// sidebar's density sliders rescale mass live. 1.86 × the van's ~2.69-unit³
// box ≈ the old fixed mass of 5; 0.9 × a mid-size can's box ≈ the old 1.
export const VAN_DENSITY = 1.86;
export const CAN_DENSITY = 0.9;

// Van model (replaces the old box). Loaded untextured and recolored to
// PLAYER_COLOR. Scaled uniformly so its longest axis equals VAN_TARGET_LEN
// (proportions preserved). VAN_YAW points the nose down the ship's forward (-Z).
export const VAN_URL = 'assets/Van.glb';
export const VAN_TARGET_LEN = 2.4;
export const VAN_YAW = -90; // van's length runs along its local X; rotate onto -Z
export const VAN_PITCH = -12; // nose up/down tilt about the ship's local X (cosmetic)

// Movement: forces applied for thrust (zero-G inertia / drift feel).
export const THRUST_FORCE = 60;       // forward/back/strafe
export const VERTICAL_THRUST = 45;    // up/down (R/F)
export const ANGULAR_DAMPING = 0.95;  // high -> collisions don't spin the ship freely

// Handling: per-axis brake (N) applied to whichever local axes you are NOT
// thrusting. Bleeds off off-nose drift so the ship flies where it points and
// coasts to a gradual stop when you let off — without erasing inertia along the
// axis you ARE thrusting. 0 = pure drift (old feel); higher = grippier/arcade.
export const HANDLING_FORCE = 60;

// Atmosphere: the medium everything flies through. Density IS the ship's
// linear damping (0 = vacuum and endless coasting, toward 1 = soup). Cans
// feel CAN_DRAG times that (linear and angular) so the default atmosphere
// leaves their slow drift and tumble alive.
export const ATMO_DENSITY = 0.15;
export const CAN_DRAG = 1 / 3;

// Bounciness / surface for everything.
export const RESTITUTION = 0.75;
export const FRICTION = 0.4;

// Obstacles. Each is a prerendered, textured spam-can GLB picked at random from
// the collection (assets/cans, real files copied from the prerender output) on
// every load.
export const OBSTACLE_COUNT = Infinity;  // every can in the collection
// How many can GLBs download at once. The loader pulls from a shared queue with
// this many workers so the menu's Pause can hold the queue between items (cans
// already in flight finish; no new ones start until Resume).
export const CAN_CONCURRENCY = 8;

// Focused "hero" can: when the page is opened with ?artist=<author>, that
// artist's can is placed directly in front of the van's spawn pose (origin,
// facing -Z) so the link lands on a readable close-up. FACING_YAW spins the
// artwork toward the camera (dial in live — the label wraps the whole can).
export const HERO_DISTANCE = 4.5;       // units in front of the van
export const HERO_HEIGHT = 0.0;         // vertical offset of the hero can
export const HERO_FACING_YAW = 0;       // deg about Y so the artwork faces camera

export const CAN_INDEX_URL = 'assets/cans-index.json';
export const CAN_DIR = 'assets/cans/';
// PBR maps identical across all cans, stripped from the GLBs by the prerender's
// --strip-shared-maps flag and reattached to every can material at load. Absent
// files are fine (older unstripped GLBs embed the maps themselves).
export const CAN_SHARED_MR_URL = CAN_DIR + 'shared-maps/metallic-roughness.png';
export const CAN_SHARED_NORMAL_URL = CAN_DIR + 'shared-maps/normal.png';
export const CAN_MIN_LEN = 1.0;         // random longest-axis target (world units)
export const CAN_MAX_LEN = 1.8;

// Mouse look. Orientation is quaternion-based and rotations are applied about
// the ship's LOCAL axes, so there is no fixed horizon — fly fully inverted or
// on a side.
export const MOUSE_SENSITIVITY = 0.16; // degrees per pixel of movement
export const ROLL_RATE = 90;           // deg/s — Q/E roll about the nose

// Chase camera.
export const CAM_TRAIL_DISTANCE = 6;
export const CAM_TRAIL_HEIGHT = 2.2;
export const CAM_LERP = 6;             // higher = snappier follow
export const CAM_UP_LERP = 6;          // how fast the camera rolls to match the ship

// World.
export const BG_COLOR = new pc.Color(1, 1, 1); // white void

// Inverted disco ball: a huge sphere tiled on the INSIDE with thick mirror
// squares, enclosing the whole scene. The wall sits past fog range so the
// centre still reads as white void; fly out and the tiles emerge, glinting,
// reflecting the van live (see the camera-following cubemap probe in
// discoball.js). The van soft-stops at the wall and cannot pass through.
export const DISCO = {
    radius: 55,            // huge; > fog end (46) so the centre stays a void
    // Tiles are laid in horizontal rings (parallels), equal size, packed nearly
    // edge-to-edge. Ring count and per-ring count are derived from tileSize, so
    // the whole surface fills like a real glued disco ball.
    tileSize: 2.4,         // edge length of a tile (world units)
    tileThickness: 0.18,   // real depth, like a cut mirror
    gap: 0.04,             // fractional grout spacing between tiles
    radialJitter: 0.5,     // in/out wobble of the gluing depth (units)
    tiltJitter: 5,         // off-tangent lean (deg) so tiles catch light unevenly
    rollJitter: 5,         // in-plane roll (deg); small lean, not a full spin

    mirrorMetalness: 1.0,
    mirrorGloss: 0.97,     // near-mirror sharpness
    mirrorReflectivity: 1.0,
    mirrorColor: new pc.Color(179 / 255, 200 / 255, 255 / 255), // 179,200,255 glass tint multiplied over the reflection
    mirrorTintStrength: 1.0, // brightness of the mirror tint
    curveAmount: 1.0,        // 0 = flat mirror, 1 = full spherical-mirror magnification

    boundaryMargin: 1.5,   // van soft-stops this far inside the radius
    seed: 1337             // fixed so the wall looks identical across reloads
};

// Cans spawn inside a sphere half the disco ball's size, sharing its centre
// (the origin — also where the van appears). Defined after DISCO so the link
// to the ball's radius stays explicit.
export const SPAWN_RADIUS = DISCO.radius / 2;

// Collision sound: a procedural "tin can" clank synthesized on the fly (Web
// Audio) each time the van hits a can — the wall isn't a physics body and there
// is no ground, so the van's only rigidbody contacts are cans. Every field is a
// live sidebar slider; audio.js reads this object fresh on every hit, so tweaks
// apply immediately. Loudness scales with impact speed between minSpeed (silent)
// and refSpeed (full), shaped by sensitivity.
export const COLLISION_SOUND = {
    volume: 0.6,        // master gain 0..1
    pitch: 433,         // Hz — fundamental of the metallic ring
    decay: 0.77,        // s — ring/tail length
    brightness: 0.6,    // 0..1 — attack-noise bandpass + weighting of high partials
    metallic: 0.46,     // 0..1 — partial spread: harmonic (pitched) .. inharmonic (clangy)
    attack: 0.5,        // 0..1 — loudness of the noisy impact transient ("tink")
    minSpeed: 0.6,      // world-units/s — impacts softer than this make no sound
    refSpeed: 12,       // world-units/s — impact that maps to full volume
    sensitivity: 0.8,   // exponent on normalized impact -> loudness curve
    pitchRandom: 0.275, // +/- per-hit detune fraction (so repeated hits differ)
    cooldown: 20        // ms — min gap between hits (kills machine-gun on can clusters)
};

// Thrust sound: a sustained pipe/Hammond-organ drone synthesized live (Web
// Audio) that swells while the van is thrusting and fades as you coast. It's
// built additively from nine drawbar partials — a harmonic stack, exactly how
// an organ's registration works — plus a Leslie-style vibrato+tremolo swirl.
// Every field is a live sidebar slider; audio.js pushes changes straight onto
// the running voice. Loudness follows how hard you thrust (how many axes fire).
export const THRUST_SOUND = {
    volume: 0.3,        // master gain 0..1 at full thrust
    pitch: 116,         // Hz — the 8' fundamental the drawbars stack on. Kept in
                        // the ear's sensitive band (and above small-speaker
                        // roll-off) so the drone is actually audible; a deep 65 Hz
                        // organ measured strong but read as near-silent next to
                        // the collision clank. Lower it here for a bigger console.
    attack: 0.21,       // s — swell-in time when thrust engages
    release: 0.75,      // s — fade-out time when thrust releases
    // Drawbar registration: relative level of each footage — this IS the organ
    // timbre. Order: 16', 5⅓', 8', 4', 2⅔', 2', 1⅗', 1⅓', 1'.
    drawbars: [0.76, 0.68, 0.66, 0.55, 0.26, 0.32, 0.12, 0.05, 0.35],
    vibrato: 11.7,      // Hz — Leslie swirl rate (shared by vibrato + tremolo)
    vibratoDepth: 12,   // cents — pitch-wobble depth of the swirl
    tremolo: 0.47,      // 0..1 — amplitude-wobble depth of the swirl
    bend: 123           // cents — pitch rise from idle to full thrust
};
