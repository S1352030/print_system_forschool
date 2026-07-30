// Service Worker - 影印計價與通知系統
const APP_CACHE = 'print-system-app-20260730';
const PDF_ENGINE_CACHE = 'print-system-pdf-engine-5.7.284';
const ACTIVE_CACHES = new Set([APP_CACHE, PDF_ENGINE_CACHE]);
const MAX_APP_ENTRIES = 40;

self.addEventListener('install', (event) => {
  // 不預抓 PDF 引擎；使用者第一次開啟預覽時才下載。
  event.waitUntil(Promise.all([
    caches.open(APP_CACHE),
    caches.open(PDF_ENGINE_CACHE),
  ]));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => !ACTIVE_CACHES.has(key)).map((key) => caches.delete(key))),
    ),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (!['http:', 'https:'].includes(url.protocol)) return;

  // API、後台、Blob、本地檔案與使用者 PDF 永不進入 Service Worker 快取。
  if (
    url.origin !== self.location.origin ||
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/admin') ||
    url.pathname.toLowerCase().endsWith('.pdf')
  ) {
    return;
  }

  if (url.pathname.startsWith('/static/pdfjs/5.7.284/')) {
    event.respondWith(cacheFirst(request, PDF_ENGINE_CACHE));
    return;
  }

  // HTML、CSS 與應用程式模組一律先取網路，離線才使用上一份。
  event.respondWith(networkFirst(request));
});

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (isCacheable(response)) {
      const cache = await caches.open(APP_CACHE);
      await cache.put(request, response.clone());
      await trimCache(cache, MAX_APP_ENTRIES);
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    return cached || new Response('Offline', {
      status: 503,
      statusText: 'Service Unavailable',
    });
  }
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (isCacheable(response)) await cache.put(request, response.clone());
    return response;
  } catch {
    return new Response('Offline', {
      status: 503,
      statusText: 'Service Unavailable',
    });
  }
}

function isCacheable(response) {
  if (!response.ok || response.type !== 'basic') return false;
  const cacheControl = response.headers.get('Cache-Control') || '';
  return !/\b(?:no-store|private)\b/i.test(cacheControl);
}

async function trimCache(cache, maxEntries) {
  const keys = await cache.keys();
  const overflow = keys.length - maxEntries;
  for (let index = 0; index < overflow; index += 1) {
    await cache.delete(keys[index]);
  }
}
