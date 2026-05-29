# SPAM — PlayCanvas Physics Test

A tiny 3D physics sandbox built on the PlayCanvas engine. You pilot a black
"spaceship" (a box) through a white void filled with 20 smaller, brightly
colored boxes. Ram them and they bounce away — zero-G, with inertia.

## Controls

- **Click** the canvas to capture the mouse and start flying.
- **Mouse** — steer (yaw / pitch). The chase camera trails behind the ship.
- **WASD** — thrust forward / back / strafe (relative to where you point).
- **Space / Shift** — thrust up / down.
- **Esc** — release the mouse.

Movement uses forces, so the ship drifts and coasts — let off the keys and you
keep gliding.

## Run it

The game must be served over HTTP (ES modules + WASM won't load from `file://`).

```bash
cd /Users/petrporobov/Projects/SPAM/game
python3 -m http.server 8000
```

Then open <http://localhost:8000> and click the canvas.

If modules or the `.wasm` file fail to load (some servers send the wrong MIME
type), use a JS-aware static server instead:

```bash
npx serve .
```

## Layout

```
index.html          # entry: canvas + white-void styling + module bootstrap
lib/
  playcanvas.mjs     # vendored PlayCanvas engine 2.19.0 (ESM build)
  ammo/              # vendored ammo.js physics backend (wasm + asm.js fallback)
src/
  main.js            # async boot orchestrator (loads physics before rigidbodies)
  config.js          # all tunables (sizes, colors, forces, camera)
  engine.js          # PlayCanvas app + canvas + input setup
  physics.js         # ammo loader
  scene.js           # lighting + zero gravity
  player.js          # black ship: dynamic rigidbody box
  obstacles.js       # 20 colored physics boxes
  controls.js        # pointer-lock steering + force-based thrust
  camera.js          # third-person chase camera
```

Tweak gameplay feel in `src/config.js` (thrust, bounciness, obstacle count,
colors, camera distance).
