/*
 * Service worker for the MarkItDown Website.
 *
 * Strategy (intentionally minimal and safe — Task 16.1, Requirements 12.1):
 *   - Cache-first for build output under `/assets/` only. These files are
 *     content-hashed by Vite (e.g. `index.<hash>.js`), so they are immutable:
 *     a given URL never changes contents, which makes cache-first safe and
 *     means a new deploy fetches new URLs (and old caches are pruned below).
 *   - Everything else falls through to the network untouched. In particular
 *     API calls (`/api/...`) and non-GET requests are NEVER cached, so the
 *     worker can never serve stale or cross-user conversion data.
 *
 * The worker takes control as soon as it activates and prunes caches from
 * previous versions on activation.
 */

const CACHE_VERSION = 'v1';
const CACHE_NAME = `markitdown-static-${CACHE_VERSION}`;

// Activate the new worker immediately rather than waiting for existing tabs
// to close.
self.addEventListener('install', () => {
  self.skipWaiting();
});

// Clean up caches left behind by older worker versions and take control of
// open clients.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith('markitdown-static-') && key !== CACHE_NAME)
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

/**
 * Only hashed build assets served from this origin under `/assets/` are
 * eligible for caching.
 */
function isCacheableAsset(request, url) {
  return (
    request.method === 'GET' &&
    url.origin === self.location.origin &&
    url.pathname.includes('/assets/')
  );
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Never intercept API traffic or non-GET requests — let the network handle
  // them so responses are always fresh and never persisted.
  if (request.method !== 'GET' || url.pathname.startsWith('/api')) {
    return;
  }

  if (!isCacheableAsset(request, url)) {
    return;
  }

  // Cache-first: serve the cached copy if present, otherwise fetch, cache a
  // clone, and return it. Only successful basic responses are stored.
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(request);
      if (cached) {
        return cached;
      }
      const response = await fetch(request);
      if (response && response.status === 200 && response.type === 'basic') {
        cache.put(request, response.clone());
      }
      return response;
    })(),
  );
});
