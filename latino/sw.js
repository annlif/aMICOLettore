// Service worker di aMICOLatino: rende l'app installabile e utilizzabile anche senza internet.
// Le versioni, le traduzioni e le parole sono salvate a parte, in IndexedDB.
const VERSION = '__VERSION__';
const CACHE = `amicolatino-${VERSION}`;
const ASSETS = __ASSETS__;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith('amicolatino-') && key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  // Azure Speech e i siti esterni (es. il dizionario Olivetti): sempre in rete
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    if (req.mode === 'navigate') {
      try { return await fetch(req); } catch { return (await cache.match('./index.html', { ignoreSearch: true })) || Response.error(); }
    }
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    const res = await fetch(req);
    if (res.ok && url.pathname.includes('/vendor/cmaps/')) cache.put(req, res.clone());
    return res;
  })());
});
