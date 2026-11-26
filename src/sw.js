// Service worker: rende l'app installabile e utilizzabile anche senza internet
// (l'audio già generato è salvato a parte, in IndexedDB).
const VERSION = '__VERSION__';
const CACHE = `amicolettore-${VERSION}`;
const ASSETS = __ASSETS__;
const LATINO = new URL('latino/', self.registration.scope).href;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith('amicolettore-') && key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return; // Azure: sempre in rete
  if (url.href.startsWith(LATINO)) return; // aMICOLatino è un'altra app, con il suo service worker

  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(async () => (await caches.match('./index.html', { ignoreSearch: true })) || Response.error()));
    return;
  }
  event.respondWith((async () => {
    const hit = await caches.match(req, { ignoreSearch: true });
    if (hit) return hit;
    const res = await fetch(req);
    if (res.ok && url.pathname.includes('/vendor/cmaps/')) (await caches.open(CACHE)).put(req, res.clone());
    return res;
  })());
});
