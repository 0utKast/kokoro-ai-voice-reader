/**
 * Kokoro AI Voice Reader - Mobile PWA Service Worker
 * Provides offline caching for application assets, WASM binaries, and voices.
 */

const CACHE_NAME = 'kokoro-pwa-v1.1.8';

const PRECACHE_ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-128.png',
  '../src/libs/lame.min.js',
  '../src/libs/kokoro.web.js',
  '../src/libs/pdf.min.mjs',
  '../src/libs/pdf.worker.min.mjs',
  '../src/shared/audio-utils.js',
  '../src/shared/audio-storage.js',
  '../src/shared/constants.js',
  '../src/shared/storage.js',
  '../src/shared/pdf-extractor.js'
];

// Install: precache essential shell assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_ASSETS).catch((err) => {
        console.warn('[SW] Precache incomplete (some assets will load on-demand):', err);
      });
    }).then(() => self.skipWaiting())
  );
});

// Activate: cleanup old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME && key.startsWith('kokoro-pwa-')) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch: Stale-While-Revalidate / Cache-First strategy
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Skip non-HTTP schemes and telemetry/API calls
  if (!url.protocol.startsWith('http') || url.pathname.startsWith('/api/')) return;

  // Direct bypass for explicit reset query parameter
  if (url.searchParams.has('reset')) {
    event.respondWith(fetch(event.request));
    return;
  }

  // Cache-first for voices and model assets
  if (url.pathname.includes('/voices/') || url.pathname.endsWith('.wasm') || url.pathname.endsWith('.bin')) {
    event.respondWith(
      caches.match(event.request, { ignoreSearch: true }).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        });
      })
    );
    return;
  }

  // Network-first with cache fallback for HTML & app code
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response && response.status === 200 && event.request.method === 'GET') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(event.request, { ignoreSearch: true });
        if (cached) return cached;
        if (event.request.mode === 'navigate') {
          const fallback = await caches.match('./index.html', { ignoreSearch: true }) ||
                           await caches.match('/pwa/index.html', { ignoreSearch: true }) ||
                           await caches.match('./', { ignoreSearch: true });
          if (fallback) return fallback;
        }
        return new Response('Sin conexión a red local', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
      })
  );
});
