/* DITHER service worker. Generated at build time from src/sw/sw-template.js.
 *
 * - Precaches the whole app (shell, fonts, art, onnxruntime wasm) so it runs offline after
 *   the first load. Model packs are not cached here: they live in OPFS (models/opfs.ts).
 * - Adds COOP/COEP/CORP headers to every same-origin response, so the page is cross-origin
 *   isolated (WASM threads) even on static hosts that cannot set headers.
 */
const VERSION = '__VERSION__';
const PRECACHE = __PRECACHE__;
const CACHE = `dither-${VERSION}`;
const SHELL = new URL('./', self.location).pathname;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE.map((p) => new Request(new URL(p, self.location), { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('dither-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isolate(response) {
  if (!response || response.status === 0 || response.type === 'opaque') return response;
  const headers = new Headers(response.headers);
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
  headers.set('Cross-Origin-Resource-Policy', 'same-origin');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    // Offline-first app shell; refresh the cached copy in the background when online.
    event.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const cached = await cache.match(SHELL);
        const network = fetch(req)
          .then((res) => {
            if (res.ok) cache.put(SHELL, res.clone());
            return res;
          })
          .catch(() => undefined);
        const res = cached ?? (await network) ?? new Response('Offline', { status: 503 });
        return isolate(res);
      })
    );
    return;
  }

  event.respondWith(
    // ignoreVary: precached files are the same for every request, but a host may still mark them
    // `Vary: Origin` (vite preview does), and module imports carry an Origin header the precache
    // requests did not, so honouring Vary would miss the cache exactly when offline.
    caches.match(req, { ignoreSearch: false, ignoreVary: true }).then(async (cached) => {
      if (cached) return isolate(cached);
      try {
        return isolate(await fetch(req));
      } catch {
        return new Response('', { status: 504, statusText: 'Offline' });
      }
    })
  );
});
