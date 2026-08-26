/**
 * Offline shell for the web/mobile build. Hand-rolled rather than pulled from a
 * plugin: the whole job is "serve the shell and the hashed assets from cache",
 * and this file ships verbatim out of public/ with no build step or dependency.
 *
 * Electron never registers this — see the guard in src/main.tsx.
 *
 * Cache busting rides on the registration URL (`sw.js?v=3.0.1&b=<built-at>`). The
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

/** Everything needed to boot with no network. Hashed assets aren't listed — they
 *  change every build and get picked up by the runtime cache below instead. */
const SHELL = ['./', './index.html', './manifest.webmanifest', './logo.svg', './pwa-192.png', './pwa-512.png'];

self.addEventListener('install', event => {
  // One bad URL would reject the whole addAll and leave the worker uninstalled,
  // so shell entries are cached individually and failures tolerated.
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => Promise.all(SHELL.map(url => cache.add(url).catch(() => {}))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('milestone-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;
  if (new URL(request.url).origin !== self.location.origin) return;

  // Navigations: prefer the network so a deployed update is picked up promptly,
  // but fall back to the cached shell when offline. Hash routing means every
  // route is the same document, so one cached shell covers all of them.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match('./index.html').then(r => r || caches.match('./'))),
    );
    return;
  }

  // Assets are content-hashed, so a cache hit is always correct — serve it and
  // skip the network entirely.
  event.respondWith(
    caches.match(request).then(hit => hit || fetch(request).then(res => {
      if (res.ok && res.type === 'basic') {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(request, copy));
      }
      return res;
    })),
  );
});
