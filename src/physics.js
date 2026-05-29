import * as pc from '../lib/playcanvas.mjs';

// Loads the ammo.js physics backend. This MUST resolve before any rigidbody
// component is created (the RigidBodyComponentSystem reads the global Ammo at
// component-create time) and before app.start().
export function loadAmmo() {
    pc.WasmModule.setConfig('Ammo', {
        glueUrl: './lib/ammo/ammo.wasm.js',
        wasmUrl: './lib/ammo/ammo.wasm.wasm',
        fallbackUrl: './lib/ammo/ammo.js'
    });

    return new Promise((resolve) => {
        pc.WasmModule.getInstance('Ammo', () => resolve());
    });
}
