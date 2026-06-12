# SPAM — PlayCanvas Physics Test

A tiny 3D physics sandbox built on the PlayCanvas engine. You pilot a black
"spaceship" (a van model) through a white void filled with 20 floating,
textured spam cans — each a distinct prerendered artwork picked at random on
every load. Ram them and they bounce away — zero-G, with inertia.

## Controls

Pick a flight scheme in the sidebar's **Controls** section. All three rotate the
ship freely (no fixed horizon — you can fly upside down or on a side) except where
noted. The chase camera rolls with the ship. **Click** the canvas to capture the
mouse, **Esc** to release it; switching schemes never snaps your orientation.

**6DOF Spaceship** (default) — free flight:
- **Mouse** — pitch / yaw. **Q / E** — roll left / right.
- **WASD** — thrust forward / back / strafe. **R / F** — thrust up / down.
- **Space** — smart brake (coasts to a stop).

**Airplane** — bank-to-turn (mouse not used):
- **A / D** (or **← / →**) — bank; banking turns the nose like a real plane.
- **W / S** (or **↑ / ↓**) — pitch the nose up / down (loop the loop).
- **Shift / Ctrl** — throttle up / down (persistent forward speed).

**Arcade** — assisted:
- **Mouse** — pitch / yaw, same thrust keys as Spaceship.
- Wings **auto-level** to a soft horizon when you let off the roll keys (**Q / E**).

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
  obstacles.js       # 20 floating spam-can GLBs (random pick from assets/cans)
  controls.js        # switchable flight schemes (quaternion steering + thrust)
  camera.js          # third-person chase camera
```

Tweak gameplay feel in `src/config.js` (thrust, bounciness, obstacle count,
colors, camera distance).
