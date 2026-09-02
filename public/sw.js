/**
 * Offline shell for the web/mobile build. Hand-rolled rather than pulled from a
 * plugin: the whole job is "serve the shell and the hashed assets from cache",
 * and this file ships verbatim out of public/ with no build step or dependency.
 *
 * Electron never registers this — see the guard in src/main.tsx.
 *
 * Cache busting rides on the registration URL (`sw.js?v=3.0.3&b=<built-at>`). The
 * browser treats a changed script URL as a new worker, and that string keys the
 * cache, so a release both installs a fresh worker and drops the previous one's
 * entries.
 *
 * The build stamp is in there because the version alone is not a build identity:
 * two different builds of 3.0.1 share a URL, so the browser saw no new worker and
 * the phone went on serving the older one from cache.
 */
const params = new URL(self.location.href).searchParams;
const VERSION = (params.get('v') || 'dev') + (params.get('b') ? '-' + params.get('b') : '');
const CACHE = `milestone-${VERSION}`;

/** Everything needed to boot with no network. Hashed assets aren't listed here —
 *  they change every build, and come from the manifest below instead. */
const SHELL = ['./', './index.html', './manifest.webmanifest', './logo.svg', './pwa-192.png', './pwa-512.png', './pwa-apple-180.png'];

/**
 * Written by the build (see `assetManifest` in vite.config.ts): every js/css file
 * this build produced, including the per-tab chunks.
 *
 * Precaching those is the difference between an app that opens and an app that
 * works. Only Today is in the entry chunk; Quests, Vynues, Systems and All are
 * fetched the first time they're opened, so an installed phone app that had only
 * ever cached what it had loaded could open Today and nothing else — and a failed
 * chunk fetch takes the whole React tree down with it, which is a blank screen.
 * Whatever a release costs to download, it costs it once, at install.
 */
const MANIFEST = './asset-manifest.json';

/** Cached one at a time and failures tolerated: `addAll` rejects as a unit, and
 *  one unlucky file must not leave the worker uninstalled and the app with no
 *  offline support at all. */
async function cacheEach(cache, urls) {
  await Promise.all(urls.map(url => cache.add(url).catch(() => {})));
}

/**
 * The shell, fetched past the HTTP cache.
 *
 * `cache.add` would honour it, and index.html is served with a short max-age —
 * so a worker installing just after a deploy could precache the *previous*
 * build's HTML, which names chunk files this build no longer has. The offline
 * shell would then boot into missing scripts. Hashed assets don't need this
 * (their names are their versions) and are better off reusing the HTTP cache.
 */
async function cacheFresh(cache, urls) {
  await Promise.all(urls.map(async url => {
    try {
      const res = await fetch(url, { cache: 'reload' });
      if (res.ok) await cache.put(url, res);
    } catch { /* one missing shell entry is not worth failing the install over */ }
  }));
}

async function precache() {
  const cache = await caches.open(CACHE);
  await cacheFresh(cache, SHELL);

  // `no-store`, or the manifest itself could come from the HTTP cache and hand
  // back the *previous* build's file names — precisely the failure this exists
  // to prevent.
  try {
    const res = await fetch(MANIFEST, { cache: 'no-store' });
    if (res.ok) {
      const { files } = await res.json();
      if (Array.isArray(files)) await cacheEach(cache, files);
    }
  } catch {
    // No manifest (an old build, or offline mid-update) — the runtime cache in
    // the fetch handler still fills in as pages are opened.
  }
}

self.addEventListener('install', event => {
  event.waitUntil(precache().then(() => self.skipWaiting()));
});

/**
 * Old builds are evicted, but not all of them: the one immediately before this
 * is kept.
 *
 * A phone keeps the installed app resident for days, so a document from the
 * previous build is very often still on screen when this worker activates — and
 * it will go on asking for *its* chunk names, which the deploy has already
 * removed from the server. Deleting its cache the moment we take over is how a
 * tab it hadn't opened yet turned into a blank screen. Keeping one generation
 * lets it finish its session; it goes on the next release.
 */
async function evictOldCaches() {
  // Insertion order, so the last non-current entry is the previous build's.
  const keys = (await caches.keys()).filter(k => k.startsWith('milestone-') && k !== CACHE);
  const doomed = keys.slice(0, -1);
  await Promise.all(doomed.map(k => caches.delete(k)));
}

self.addEventListener('activate', event => {
  event.waitUntil(evictOldCaches().then(() => self.clients.claim()));
});

/**
 * This build's copy first, anything still on disk second.
 *
 * The order matters now that the previous build's cache outlives it: both hold
 * an `index.html`, and answering a navigation from the older one would pin the
 * phone to the build we just replaced.
 */
async function fromCache(request) {
  const current = await caches.open(CACHE);
  return (await current.match(request)) || (await caches.match(request));
}

/** Navigations: prefer the network so a deployed update is picked up promptly,
 *  but fall back to the cached shell when offline. Hash routing means every
 *  route is the same document, so one cached shell covers all of them. */
async function handleNavigate(request) {
  try {
    const res = await fetch(request);
    // Only a real page becomes the offline shell. A 404 or a 502 from the host
    // is still a response, and caching one would leave the installed app
    // opening onto an error page every time it was launched without a network —
    // until some later launch happened to be online *and* succeed.
    if (res.ok) {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put('./index.html', copy));
    }
    return res;
  } catch (err) {
    const shell = await fromCache('./index.html') || await fromCache('./');
    if (shell) return shell;
    throw err;
  }
}

/** Assets are content-hashed, so a cache hit is always correct — serve it and
 *  skip the network entirely. */
async function handleAsset(request) {
  const hit = await fromCache(request);
  if (hit) return hit;

  const res = await fetch(request);
  if (res.ok && res.type === 'basic') {
    const copy = res.clone();
    caches.open(CACHE).then(c => c.put(request, copy));
  }
  return res;
}

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Sync is not an asset. When the app is served by the desktop bridge or by a
  // relay, the same origin also carries the sync API, and `api/peers` is polled
  // every few seconds on an unchanging URL (src/lib/phoneTransport.ts). Handing
  // that to the cache-first branch below meant the first poll's answer was
  // returned to every later poll for the life of the cache: the phone went on
  // syncing, saw the same document forever, and silently never learned anything
  // the desktop did. `cache: 'no-store'` on the call doesn't help — that governs
  // the HTTP cache, and a service worker sits in front of it.
  if (url.pathname.includes('/api/')) return;

  if (request.mode === 'navigate') { event.respondWith(handleNavigate(request)); return; }

  // A rejection here is deliberately left to reject: for a route chunk that is
  // the app's own retry-and-reload path (src/lib/lazyChunk.ts) taking over,
  // which is a far better answer than a fabricated response the browser would
  // then fail to parse as a module.
  event.respondWith(handleAsset(request));
});
