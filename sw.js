// Service Worker - 影印計價與通知系統
const APP_CACHE = 'print-system-app-20260810';
const PDF_ENGINE_CACHE = 'print-system-pdf-engine-5.7.284';
const ACTIVE_CACHES = new Set([APP_CACHE, PDF_ENGINE_CACHE]);
const MAX_APP_ENTRIES = 60;
const MAX_PDF_ENGINE_ENTRIES = 60;

self.addEventListener('install', (event) => {
  // 不預抓 PDF 引擎；使用者第一次開啟預覽時才下載。
  event.waitUntil(Promise.all([
    caches.open(APP_CACHE),
    caches.open(PDF_ENGINE_CACHE),
  ]).catch(() => {}).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(Promise.all([
    // 快取不可用時仍讓 Worker 啟用，網路請求可以繼續工作。
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => !ACTIVE_CACHES.has(key)).map((key) => caches.delete(key))),
    ).catch(() => {}),
    // 導覽下載與 Worker 啟動並行；不支援或啟用失敗時使用一般 fetch。
    Promise.resolve().then(() => self.registration.navigationPreload?.enable()).catch(() => {}),
  ]).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (!['http:', 'https:'].includes(url.protocol)) return;

  // API、後台、Blob、本地檔案與使用者 PDF 永不進入 Service Worker 快取。
  if (
    url.origin !== self.location.origin ||
    request.headers.has('authorization') ||
    url.pathname === '/health' ||
    url.pathname === '/sw.js' ||
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/admin') ||
    url.pathname.toLowerCase().endsWith('.pdf')
  ) {
    return;
  }

  const isVersionedPdfEngine = url.pathname.startsWith('/static/pdfjs/5.7.284/');
  const isVersionedAppAsset = url.pathname.startsWith('/static/builds/');

  // 帶 query 的版本資源不進 Cache API，與 origin/Cloudflare 的 queryless 契約一致。
  if (url.search && (isVersionedPdfEngine || isVersionedAppAsset)) return;

  if (isVersionedPdfEngine) {
    respondWithBackground(event, (tasks) => cacheFirst(event, tasks, PDF_ENGINE_CACHE, MAX_PDF_ENGINE_ENTRIES));
    return;
  }

  // Vite 等建置工具產生的雜湊資源內容不可變，優先由快取供應。
  if (isVersionedAppAsset) {
    respondWithBackground(event, (tasks) => cacheFirst(event, tasks, APP_CACHE, MAX_APP_ENTRIES));
    return;
  }

  // 首頁與導覽請求先取網路，離線時才回退至最近快取的頁面。
  if (request.mode === 'navigate' || url.pathname === '/') {
    respondWithBackground(event, (tasks) => networkFirst(event, tasks));
    return;
  }

  // 尚未進入建置目錄的來源 CSS/JS 維持 network-first，確保開發時不吃舊檔。
  respondWithBackground(event, (tasks) => networkFirst(event, tasks));
});

function respondWithBackground(event, handler) {
  const tasks = [];
  const response = handler(tasks);
  event.respondWith(response);
  // 同步登記生命週期；回應交給瀏覽器後，仍保證快取工作有時間完成。
  event.waitUntil(response.then(() => Promise.all(tasks)).catch(() => {}));
}

async function fetchResponse(event) {
  if (event.request.mode === 'navigate') {
    try {
      const preloaded = await event.preloadResponse;
      if (preloaded) return preloaded;
    } catch { /* 預載失敗仍嘗試一般網路請求。 */ }
  }
  return fetch(event.request);
}

function cacheInBackground(request, response, tasks, cacheName, maxEntries) {
  if (!isCacheable(response)) return;
  // 在瀏覽器開始消費 body 前複製；儲存失敗不得改變成功的網路回應。
  const copy = response.clone();
  tasks.push((async () => {
    const cache = await caches.open(cacheName);
    await cache.put(request, copy);
    await trimCache(cache, maxEntries);
  })().catch(() => {}));
}

function offlineResponse() {
  return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
}

async function networkFirst(event, tasks) {
  const { request } = event;
  try {
    const response = await fetchResponse(event);
    cacheInBackground(request, response, tasks, APP_CACHE, MAX_APP_ENTRIES);
    return response;
  } catch {
    try {
      const cache = await caches.open(APP_CACHE);
      const cached = await cache.match(request);
      if (cached) return cached;
    } catch { /* 離線且無法讀取快取。 */ }
    return offlineResponse();
  }
}

async function cacheFirst(event, tasks, cacheName, maxEntries) {
  const { request } = event;
  try {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(request);
    if (cached) return cached;
  } catch { /* 快取讀取失敗時直接使用網路。 */ }

  try {
    const response = await fetchResponse(event);
    cacheInBackground(request, response, tasks, cacheName, maxEntries);
    return response;
  } catch {
    return offlineResponse();
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
