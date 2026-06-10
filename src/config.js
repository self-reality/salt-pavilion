import * as pc from '../lib/playcanvas.mjs';

// ---------------------------------------------------------------------------
// All tunable parameters live here so the rest of the code reads cleanly.
// ---------------------------------------------------------------------------

// Player ship: a black van model. PLAYER_SIZE no longer sizes the ship (the
// collision box is derived from the loaded van), but obstacles still scale
// relative to it, so it stays as the reference size.
export const PLAYER_SIZE = new pc.Vec3(1.4, 0.8, 2.4); // x=width, y=height, z=length
export const PLAYER_COLOR = new pc.Color(197 / 255, 163 / 255, 219 / 255); // 197,163,219
export const PLAYER_MASS = 5;

// Van model (replaces the old box). Loaded untextured and recolored to
// PLAYER_COLOR. Scaled uniformly so its longest axis equals VAN_TARGET_LEN
// (proportions preserved). VAN_YAW points the nose down the ship's forward (-Z).
export const VAN_URL = 'assets/Van.glb';
export const VAN_TARGET_LEN = 2.4;
export const VAN_YAW = -90; // van's length runs along its local X; rotate onto -Z
export const VAN_PITCH = -12; // nose up/down tilt about the ship's local X (cosmetic)

// Movement: forces applied for thrust (zero-G inertia / drift feel).
export const THRUST_FORCE = 60;       // forward/back/strafe
export const VERTICAL_THRUST = 45;    // up/down (Space / Shift)
export const LINEAR_DAMPING = 0.15;   // small -> long coast/drift
export const ANGULAR_DAMPING = 0.95;  // high -> collisions don't spin the ship freely

// Bounciness / surface for everything.
export const RESTITUTION = 0.75;
export const FRICTION = 0.4;

// Obstacles. Each is a prerendered, textured spam-can GLB picked at random from
// the collection (assets/cans, symlinked to the prerender output) on every load.
export const OBSTACLE_COUNT = 20;
export const OBSTACLE_MASS = 1;
export const SPAWN_RADIUS = 14;         // cans float within this distance of origin
export const INITIAL_DRIFT = 0.6;       // small random starting velocity

export const CAN_INDEX_URL = 'assets/cans-index.json';
export const CAN_DIR = 'assets/cans/';
export const CAN_MIN_LEN = 1.0;         // random longest-axis target (world units)
export const CAN_MAX_LEN = 1.8;

// Mouse look.
export const MOUSE_SENSITIVITY = 0.16; // degrees per pixel of movement
export const PITCH_LIMIT = 88;         // clamp pitch to avoid flipping over

// Chase camera.
export const CAM_TRAIL_DISTANCE = 6;
export const CAM_TRAIL_HEIGHT = 2.2;
export const CAM_LERP = 6;             // higher = snappier follow

// World.
export const BG_COLOR = new pc.Color(1, 1, 1); // white void

// Inverted disco ball: a huge sphere tiled on the INSIDE with thick mirror
// squares, enclosing the whole scene. The wall sits past fog range so the
// centre still reads as white void; fly out and the tiles emerge, glinting,
// reflecting the van live (see the centre cubemap probe + per-object proxy
// ray hits in discoball.js). The van soft-stops at the wall and cannot pass.
export const DISCO = {
    radius: 55,            // huge; well past fog start so the centre stays a void
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
    curveAmount: 1.0,        // 0 = one smooth spherical mirror, 1 = faceted per-tile scatter
    cubemapSize: 1024,       // per-face resolution of the live reflection probe

    boundaryMargin: 1.5,   // van soft-stops this far inside the radius
    seed: 1337             // fixed so the wall looks identical across reloads
};
