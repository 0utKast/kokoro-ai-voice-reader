/**
 * Kokoro AI Voice Reader - Mobile PWA Service Worker
 * Provides offline caching for application assets, WASM binaries, and voices.
 */

const CACHE_NAME = 'kokoro-pwa-v1.1.7';

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

  // Skip chrome-extension:// or non-HTTP schemes
  if (!url.protocol.startsWith('http')) return;

  // Cache-first for voices and model assets
  if (url.pathname.includes('/voices/') || url.pathname.endsWith('.wasm') || url.pathname.endsWith('.bin')) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
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
      .catch(() => {
        return caches.match(event.request).then((cached) => {
          if (cached) return cached;
          if (event.request.mode === 'navigate') {
            return caches.match('./index.html');
          }
        });
      })
  );
});
