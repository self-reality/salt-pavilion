// Loader menu: a small frosted panel (top-left, clear of the right-edge tweaks
// sidebar) that reports the can stream as it downloads — cans loaded vs. to go,
// MB loaded vs. total — and offers a Pause button that holds the download queue.
// Driven entirely by the obstacles loader controller (see createObstacles): it
// subscribes to onProgress and toggles pause()/resume(). Shown on every page;
// it fades out and removes itself once the whole collection is in.

const STYLE = `
#loader{position:fixed;top:0;left:0;width:240px;box-sizing:border-box;margin:12px;
 padding:10px 12px;background:rgba(255,255,255,0.92);border:1px solid #ddd;border-radius:6px;
 font:12px/1.3 -apple-system,system-ui,sans-serif;color:#333;z-index:10;
 backdrop-filter:blur(4px);transition:opacity .6s ease;}
#loader h2{margin:0 0 8px;font-size:11px;font-weight:600;text-transform:uppercase;
 letter-spacing:.06em;color:#888;}
#loader .bar{height:4px;border-radius:2px;background:#e3e3e3;overflow:hidden;margin:0 0 8px;}
#loader .bar>span{display:block;height:100%;width:0;background:#c0392b;transition:width .2s ease;}
#loader .line{display:flex;justify-content:space-between;margin:3px 0;
 font-variant-numeric:tabular-nums;}
#loader .line .muted{color:#999;}
#loader button{margin-top:8px;width:100%;padding:5px 0;font:inherit;color:#333;
 background:#f4f4f4;border:1px solid #ccc;border-radius:4px;cursor:pointer;}
#loader button:hover{background:#ececec;}
`;

function mb(bytes) {
    return (bytes / (1024 * 1024)).toFixed(1);
}

// Builds the loader menu and binds it to the loader controller returned by
// createObstacles. Returns nothing — the panel removes itself when loading ends.
export function createLoaderMenu(loader) {
    const style = document.createElement('style');
    style.textContent = STYLE;
    document.head.appendChild(style);

    const el = document.createElement('div');
    el.id = 'loader';
    // Sibling of the canvas — swallow pointerdown so clicking Pause doesn't trip
    // the canvas's click-to-fly pointer lock (matches the tweaks sidebar).
    el.addEventListener('pointerdown', (e) => e.stopPropagation());
    el.innerHTML = `
        <h2>Loading cans</h2>
        <div class="bar"><span></span></div>
        <div class="line"><span class="cans"></span><span class="togo muted"></span></div>
        <div class="line"><span class="mb"></span><span class="muted">MB</span></div>
        <button type="button"></button>`;
    document.body.appendChild(el);

    const fill = el.querySelector('.bar > span');
    const cansEl = el.querySelector('.cans');
    const togoEl = el.querySelector('.togo');
    const mbEl = el.querySelector('.mb');
    const btn = el.querySelector('button');

    btn.addEventListener('click', () => {
        if (loader.paused) loader.resume(); else loader.pause();
    });

    let removed = false;
    function update(l) {
        const pct = l.totalBytes ? (l.loadedBytes / l.totalBytes) * 100 : 0;
        fill.style.width = pct + '%';
        cansEl.textContent = `${l.loaded} / ${l.total} cans`;
        togoEl.textContent = `${Math.max(0, l.total - l.loaded)} to go`;
        mbEl.textContent = `${mb(l.loadedBytes)} / ${mb(l.totalBytes)}`;
        btn.textContent = l.paused ? 'Resume' : 'Pause';

        // Auto-hide once the collection is fully in (guard the pre-seed emit
        // where total is still 0).
        if (!removed && l.total > 0 && l.loaded >= l.total) {
            removed = true;
            el.style.opacity = '0';
            el.addEventListener('transitionend', () => el.remove(), { once: true });
        }
    }

    loader.onProgress(update);
    update(loader);
}
