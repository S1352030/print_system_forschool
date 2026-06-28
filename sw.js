// Service Worker - 影印計價與通知系統
const CACHE_NAME = 'print-system-v2';

// ── Install：預快取首頁 ──────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(['/']))
  );
  self.skipWaiting();
});

// ── Activate：清除舊版本快取 ──────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// ── Fetch：依請求類型選擇快取策略 ─────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // 只處理 http/https 請求（排除 chrome-extension:// 等）
  if (!url.protocol.startsWith('http')) {
    return;
  }

  // 只快取 GET 請求（Cache API 不支援 POST 等方法）
  if (request.method !== 'GET') {
    return;
  }

  // API 請求與後台頁面：Network Only（永不快取，交由瀏覽器原生處理，避免 Basic Auth 與 520 問題）
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/admin')) {
    return; // 不攔截，讓瀏覽器正常發送
  }

  // 字型檔案：Cache First（字型幾乎不會變動）
  if (
    url.pathname.endsWith('.woff2') ||
    url.hostname === 'fonts.googleapis.com' ||
    url.hostname === 'fonts.gstatic.com'
  ) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // HTML 頁面導覽：Network First + Cache Fallback
  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
    return;
  }

  // 其他資源：Network First + Cache Fallback
  event.respondWith(networkFirst(request));
});

// ── 策略：Network First ──────────────────────────────────
async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok && canCache(request)) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    const cached = await caches.match(request);
    return cached || new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
  }
}

// ── 策略：Cache First ────────────────────────────────────
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) {
    return cached;
  }
  try {
    const response = await fetch(request);
    if (response.ok && canCache(request)) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
  }
}

// ── 輔助：判斷請求是否可快取 ──────────────────────────────
function canCache(request) {
  const url = new URL(request.url);
  return request.method === 'GET' && url.protocol.startsWith('http');
}
