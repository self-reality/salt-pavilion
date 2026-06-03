import * as pc from '../lib/playcanvas.mjs';

// ---------------------------------------------------------------------------
// All tunable parameters live here so the rest of the code reads cleanly.
// ---------------------------------------------------------------------------

// Player ship: a black van model. PLAYER_SIZE no longer sizes the ship (the
// collision box is derived from the loaded van), but obstacles still scale
// relative to it, so it stays as the reference size.
export const PLAYER_SIZE = new pc.Vec3(1.4, 0.8, 2.4); // x=width, y=height, z=length
export const PLAYER_COLOR = new pc.Color(0.05, 0.05, 0.05);
export const PLAYER_MASS = 5;

// Van model (replaces the old box). Loaded untextured and recolored to
// PLAYER_COLOR. Scaled uniformly so its longest axis equals VAN_TARGET_LEN
// (proportions preserved). VAN_YAW points the nose down the ship's forward (-Z).
export const VAN_URL = 'assets/Van.glb';
export const VAN_TARGET_LEN = 2.4;
export const VAN_YAW = -90; // van's length runs along its local X; rotate onto -Z

// Movement: forces applied for thrust (zero-G inertia / drift feel).
export const THRUST_FORCE = 60;       // forward/back/strafe
export const VERTICAL_THRUST = 45;    // up/down (Space / Shift)
export const LINEAR_DAMPING = 0.15;   // small -> long coast/drift
export const ANGULAR_DAMPING = 0.95;  // high -> collisions don't spin the ship freely

// Bounciness / surface for everything.
export const RESTITUTION = 0.75;
export const FRICTION = 0.4;

// Rounded edges. Bevel radius = smallest half-extent * this fraction; segments
// control how many facets smooth each rounded band (higher = rounder).
export const EDGE_RADIUS_FRACTION = 0.28;
export const EDGE_SEGMENTS = 6;

// Obstacles.
export const OBSTACLE_COUNT = 20;
export const OBSTACLE_MIN_SCALE = 0.25; // 25% of player size
export const OBSTACLE_MAX_SCALE = 0.50; // 50% of player size
export const OBSTACLE_MASS = 1;
export const SPAWN_RADIUS = 14;         // boxes float within this distance of origin
export const INITIAL_DRIFT = 0.6;       // small random starting velocity

// Bright color palette for the obstacles.
export const PALETTE = [
    new pc.Color(0.95, 0.20, 0.25), // red
    new pc.Color(0.20, 0.55, 0.95), // blue
    new pc.Color(0.20, 0.80, 0.35), // green
    new pc.Color(0.98, 0.78, 0.15), // yellow
    new pc.Color(0.65, 0.30, 0.90), // purple
    new pc.Color(0.10, 0.80, 0.80), // cyan
    new pc.Color(0.98, 0.45, 0.10), // orange
    new pc.Color(0.95, 0.35, 0.65)  // pink
];

// Mouse look.
export const MOUSE_SENSITIVITY = 0.16; // degrees per pixel of movement
export const PITCH_LIMIT = 88;         // clamp pitch to avoid flipping over

// Chase camera.
export const CAM_TRAIL_DISTANCE = 6;
export const CAM_TRAIL_HEIGHT = 2.2;
export const CAM_LERP = 6;             // higher = snappier follow

// World.
export const BG_COLOR = new pc.Color(1, 1, 1); // white void
