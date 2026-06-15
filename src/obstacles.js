import * as pc from '../lib/playcanvas.mjs';
import {
    OBSTACLE_COUNT, CAN_CONCURRENCY, CAN_DENSITY, ATMO_DENSITY, CAN_DRAG,
    RESTITUTION, FRICTION, SPAWN_RADIUS,
    CAN_INDEX_URL, CAN_DIR, CAN_MIN_LEN, CAN_MAX_LEN,
    CAN_SHARED_MR_URL, CAN_SHARED_NORMAL_URL,
    HERO_DISTANCE, HERO_HEIGHT, HERO_FACING_YAW
} from './config.js';

function rand(min, max) {
    return min + Math.random() * (max - min);
}

// Finds the collection entry for a ?artist=<author> deep-link: exact author
// match first, then a substring fallback (case-insensitive). Mirrors
// findArtistInManifest in the sibling spam-can project (lib/dataset.js).
function findCanByAuthor(entries, query) {
    const q = String(query || '').toLowerCase().trim();
    if (!q) return null;
    return entries.find((e) => String(e?.author || '').toLowerCase() === q)
        || entries.find((e) => String(e?.author || '').toLowerCase().includes(q))
        || null;
}

// Fisher-Yates: pick `count` distinct entries from `arr` without mutating it.
function sample(arr, count) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a.slice(0, count);
}

function loadContainer(app, name, url) {
    const asset = new pc.Asset(name, 'container', { url });
    return new Promise((resolve, reject) => {
        asset.once('load', () => resolve(asset));
        asset.once('error', reject);
        app.assets.add(asset);
        app.assets.load(asset);
    });
}

// Loads a texture asset, resolving to null if the file doesn't exist (older
// can collections embed the shared maps in every GLB instead).
function loadTexture(app, name, url) {
    const asset = new pc.Asset(name, 'texture', { url });
    return new Promise((resolve) => {
        asset.once('load', () => resolve(asset.resource));
        asset.once('error', () => resolve(null));
        app.assets.add(asset);
        app.assets.load(asset);
    });
}

// The prerender's --strip-shared-maps mode removes the metallic-roughness and
// normal maps (identical in every can) from the GLBs; this puts them back. The
// channel wiring mirrors PlayCanvas's own glTF material parser (metalness in B,
// roughness in G with glossInvert already set by the parser), so a stripped can
// renders identically to one with the maps embedded.
function attachSharedMaps(materials, mrMap, normalMap) {
    for (const mat of materials) {
        if (mrMap && !mat.metalnessMap) {
            mat.metalnessMap = mrMap;
            mat.metalnessMapChannel = 'b';
            mat.glossMap = mrMap;
            mat.glossMapChannel = 'g';
        }
        if (normalMap && !mat.normalMap) mat.normalMap = normalMap;
        mat.update();
    }
}

// Builds one floating spam can: load the textured GLB, scale it so its longest
// axis lands in [CAN_MIN_LEN, CAN_MAX_LEN], recenter on the rigidbody pivot, and
// size a box collider from the scaled bounds (cans are box-ish tins). Keeps the
// can's baked artwork materials. Mirrors the load/measure/scale flow in player.js.
function colliderVolume(entity) {
    const he = entity.collision.halfExtents;
    return 8 * he.x * he.y * he.z;
}

async function createCan(app, name, url, tuning, opts) {
    const asset = await loadContainer(app, name, url);
    const model = asset.resource.instantiateRenderEntity();
    const meshInstances = model.findComponents('render').flatMap((r) => r.meshInstances);

    const box = new pc.Entity(name);
    box.addChild(model);
    app.root.addChild(box);
    app.root.syncHierarchy();

    // Combined world AABB at scale 1 (box sits at the origin unrotated here, so
    // world space == box-local space).
    const aabb = new pc.BoundingBox();
    aabb.copy(meshInstances[0].aabb);
    for (let i = 1; i < meshInstances.length; i++) aabb.add(meshInstances[i].aabb);

    const he = aabb.halfExtents;
    const scale = rand(CAN_MIN_LEN, CAN_MAX_LEN) / (2 * Math.max(he.x, he.y, he.z));
    model.setLocalScale(scale, scale, scale);
    model.setLocalPosition(
        -aabb.center.x * scale,
        -aabb.center.y * scale,
        -aabb.center.z * scale
    );
    const halfExtents = new pc.Vec3(he.x * scale, he.y * scale, he.z * scale);

    box.addComponent('collision', { type: 'box', halfExtents });
    box.addComponent('rigidbody', {
        type: 'dynamic',
        mass: tuning.canDensity * 8 * halfExtents.x * halfExtents.y * halfExtents.z,
        restitution: RESTITUTION,
        friction: FRICTION,
        linearDamping: tuning.atmoDensity * CAN_DRAG,
        angularDamping: tuning.atmoDensity * CAN_DRAG
    });

    // Placement. The hero can (opts) lands at a fixed spot in front of the van;
    // every other can gets a random position in a spherical shell around the
    // origin (kept clear of the player's spawn point) with a random tumble
    // orientation. Must go through teleport(): plain setPosition() on a
    // dynamic-bodied entity never reaches the physics body (the body would stay
    // at the origin and the simulation would snap the entity back there on the
    // next step).
    if (opts) {
        box.rigidbody.teleport(opts.position, opts.eulerAngles);
    } else {
        const dir = new pc.Vec3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize();
        const dist = rand(SPAWN_RADIUS * 0.35, SPAWN_RADIUS);
        box.rigidbody.teleport(
            new pc.Vec3(dir.x * dist, dir.y * dist, dir.z * dist),
            new pc.Vec3(rand(0, 360), rand(0, 360), rand(0, 360))
        );
    }

    // Cans start at rest — a calm gallery. They stay dynamic, so the van still
    // knocks them around on contact; they just don't drift or tumble on their own.
    box.rigidbody.linearVelocity = new pc.Vec3(0, 0, 0);
    box.rigidbody.angularVelocity = new pc.Vec3(0, 0, 0);

    // Opt out of Bullet's sleeping (DISABLE_DEACTIVATION = 4): a motionless body
    // is below the sleep threshold, and keeping it awake guarantees it responds
    // the instant the van bumps it. A still can simply sits at rest until then.
    box.rigidbody.body.setActivationState(4);

    return { box, materials: meshInstances.map((mi) => mi.material) };
}

// Spawns OBSTACLE_COUNT floating spam cans, each a distinct textured GLB picked
// at random from the collection on every load. Returns immediately: `boxes` and
// `materials` are live arrays that fill in as each can's GLB arrives, so cans
// pop into the world one by one instead of waiting for the slowest download.
// `ready` resolves once the whole collection is in. The materials list feeds
// the tweak panel (gloss/metalness/reflectivity across all cans), and the
// density setters back its physics sliders: they retune every spawned can AND
// update the values cans still streaming in will spawn with. `loader` is the
// progress/pause controller backing the loader menu (see src/loader-ui.js).
export function createObstacles(app, ship) {
    const boxes = [];
    const materials = [];
    const tuning = { canDensity: CAN_DENSITY, atmoDensity: ATMO_DENSITY };

    function setCanDensity(density) {
        tuning.canDensity = density;
        for (const box of boxes) {
            box.rigidbody.mass = density * colliderVolume(box);
            // The mass setter re-adds the body with the default ACTIVE_TAG
            // state, losing the no-sleep opt-out — restore it (see createCan).
            box.rigidbody.body.setActivationState(4);
        }
    }

    function setAtmoDensity(density) {
        tuning.atmoDensity = density;
        for (const box of boxes) {
            box.rigidbody.linearDamping = density * CAN_DRAG;
            box.rigidbody.angularDamping = density * CAN_DRAG;
        }
    }

    // Focused "hero" pose, derived once from the van's spawn pose (origin, facing
    // -Z): a point HERO_DISTANCE ahead, nudged up by HERO_HEIGHT, with the
    // artwork yawed toward the camera. Computed synchronously so the sidebar can
    // seed its sliders from these defaults before the can finishes loading. The
    // sidebar mutates `position`/`eulerAngles` in place and calls apply() to
    // re-teleport the hero live (no-op until the can streams in).
    const hero = {
        box: null,
        position: ship.getPosition().clone()
            .add(ship.forward.clone().mulScalar(HERO_DISTANCE))
            .add(new pc.Vec3(0, HERO_HEIGHT, 0)),
        eulerAngles: new pc.Vec3(0, HERO_FACING_YAW, 0),
        apply() {
            if (!hero.box) return;
            hero.box.rigidbody.teleport(hero.position, hero.eulerAngles);
            hero.box.rigidbody.linearVelocity = new pc.Vec3(0, 0, 0);
            hero.box.rigidbody.angularVelocity = new pc.Vec3(0, 0, 0);
        }
    };

    // Streaming-load controller for the loader menu. Counts and byte totals are
    // seeded once the pick list (and thus the per-can `bytes` from the manifest)
    // is known, then advanced as each can lands. pause()/resume() gate the
    // worker queue: pausing lets in-flight downloads finish but stops new ones
    // from starting. onProgress fires on every can and on pause/resume so the UI
    // can re-render. emit() is a no-op until the menu (or anything) subscribes.
    const loader = {
        total: 0, totalBytes: 0,
        loaded: 0, loadedBytes: 0,
        paused: false,
        _waiters: [],
        _subs: [],
        onProgress(cb) {
            loader._subs.push(cb);
            return () => { loader._subs = loader._subs.filter((s) => s !== cb); };
        },
        pause() { loader.paused = true; emit(); },
        resume() {
            loader.paused = false;
            loader._waiters.splice(0).forEach((r) => r());
            emit();
        }
    };
    function emit() { for (const cb of loader._subs) cb(loader); }

    const ready = (async () => {
        // Shared PBR maps are two small textures — load them up front so every
        // can gets its maps attached the moment it spawns.
        const [index, mrMap, normalMap] = await Promise.all([
            fetch(CAN_INDEX_URL).then((r) => r.json()),
            loadTexture(app, 'can_shared_mr', CAN_SHARED_MR_URL),
            loadTexture(app, 'can_shared_normal', CAN_SHARED_NORMAL_URL)
        ]);
        let picks = sample(index.entries, OBSTACLE_COUNT);

        // Optional ?artist=<author> deep-link: pull that artist's can to the
        // front of the pick list (so it loads first and pops in immediately) and
        // tag it as the hero to be posed in front of the van.
        const requestedArtist = new URLSearchParams(location.search).get('artist');
        let heroIndex = -1;
        if (requestedArtist) {
            const hero = findCanByAuthor(index.entries, requestedArtist);
            if (hero) {
                picks = [hero, ...picks.filter((e) => e !== hero)];
                heroIndex = 0;
            } else {
                console.warn(`[SPAM] requested artist not in collection: ${requestedArtist}`);
            }
        }

        loader.total = picks.length;
        loader.totalBytes = picks.reduce((s, e) => s + (e.bytes || 0), 0);
        emit();

        // CAN_CONCURRENCY workers pull from a shared cursor instead of firing all
        // downloads at once, so the loader menu's Pause can hold the queue: a
        // paused worker parks on a resume promise before claiming its next index,
        // letting any in-flight createCan finish. Index 0 (the ?artist= hero when
        // matched) is still claimed first, so it pops in first as before.
        let next = 0;
        async function worker() {
            for (;;) {
                while (loader.paused) await new Promise((r) => loader._waiters.push(r));
                const i = next++;
                if (i >= picks.length) return;
                const entry = picks[i];
                const opts = (i === heroIndex)
                    ? { position: hero.position, eulerAngles: hero.eulerAngles } : null;
                const can = await createCan(app, 'obstacle_' + i, CAN_DIR + entry.base + '.glb', tuning, opts);
                attachSharedMaps(can.materials, mrMap, normalMap);
                boxes.push(can.box);
                materials.push(...can.materials);
                if (i === heroIndex) hero.box = can.box;
                loader.loaded++;
                loader.loadedBytes += entry.bytes || 0;
                emit();
            }
        }
        await Promise.all(Array.from({ length: CAN_CONCURRENCY }, worker));
    })();

    return { boxes, materials, ready, loader, setCanDensity, setAtmoDensity, hero };
}
