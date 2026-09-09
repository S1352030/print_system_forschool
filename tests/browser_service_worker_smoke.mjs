import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import { createRequire } from 'node:module';

const { chromium, devices } = createRequire(import.meta.url)('playwright');
const workerSource = await readFile(new URL('../sw.js', import.meta.url), 'utf8');
const registrationSource = await readFile(new URL('../static/js/service-worker-registration.js', import.meta.url));
const appCache = 'print-system-app-20260810';
const assetPath = '/static/builds/smoke/assets/app.js';
let variant = 'normal';
const requests = [];
const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body><h1>Service Worker smoke</h1><input id="draft"><script type="module">
import { registerServiceWorker } from '/registration.js'; registerServiceWorker();
</script></body></html>`;
const server = http.createServer((request, response) => {
  requests.push({ path: request.url, preload: request.headers['service-worker-navigation-preload'] });
  const headers = { 'Cache-Control': 'no-cache' };
  if (request.url === '/sw.js') {
    const prefix = variant === 'quota'
      ? 'Cache.prototype.put = async function () { throw new DOMException("Test quota exhausted", "QuotaExceededError"); };\n'
      : '';
    response.writeHead(200, { ...headers, 'Content-Type': 'text/javascript' }).end(prefix + workerSource);
  } else if (request.url === '/registration.js') {
    response.writeHead(200, { ...headers, 'Content-Type': 'text/javascript' }).end(registrationSource);
  } else if (request.url === '/') {
    response.writeHead(200, { ...headers, 'Content-Type': 'text/html' }).end(html);
  } else if (request.url === assetPath) {
    response.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'public, max-age=31536000, immutable' }).end('/* cacheable asset */');
  } else if (request.url === '/api/test' || request.url === '/health') {
    response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end('{}');
  } else {
    response.writeHead(404, { 'Cache-Control': 'no-store' }).end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const bundled = chromium.executablePath();
let browser;
try {
  browser = await chromium.launch({ headless: true, executablePath: existsSync(bundled)
    ? bundled : 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' });
  const context = await browser.newContext({ ...devices['Pixel 7'], serviceWorkers: 'allow' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(origin);
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  assert.equal(requests.filter((entry) => entry.path === '/').length, 1, 'first install must not reload');
  assert.equal(await page.evaluate(async () => (await (await navigator.serviceWorker.ready).navigationPreload.getState()).enabled), true);

  // Stop the worker so the next navigation exercises real browser navigation preload.
  const cdp = await context.newCDPSession(page);
  await cdp.send('ServiceWorker.enable');
  await cdp.send('ServiceWorker.stopAllWorkers');
  const before = requests.filter((entry) => entry.path === '/').length;
  await page.goto(origin);
  assert.equal(requests.filter((entry) => entry.path === '/').length, before + 1, 'preload must not duplicate navigation');
  assert.equal(requests.filter((entry) => entry.path === '/').at(-1).preload, 'true');
  await page.waitForFunction(async (name) => Boolean(await (await caches.open(name)).match('/')), appCache);

  await page.evaluate(async (pathname) => { await (await fetch(pathname)).text(); }, assetPath);
  await page.waitForFunction(async ({ name, pathname }) => Boolean(await (await caches.open(name)).match(pathname)), { name: appCache, pathname: assetPath });
  const assetDownloads = requests.filter((entry) => entry.path === assetPath).length;
  await page.evaluate(async (pathname) => { await (await fetch(pathname)).text(); }, assetPath);
  assert.equal(requests.filter((entry) => entry.path === assetPath).length, assetDownloads);

  await page.evaluate(async () => { await fetch('/api/test'); await fetch('/health'); });
  assert.equal(await page.evaluate(async () => Boolean(await caches.match('/api/test') || await caches.match('/health'))), false);
  await context.setOffline(true);
  assert.equal((await page.goto(origin)).status(), 200, 'offline navigation uses cached HTML');
  assert.equal(await page.locator('h1').textContent(), 'Service Worker smoke');
  await context.setOffline(false);

  // Deliver a changed worker whose Cache.put always fails, exercising the real update flow.
  const beforeUpdate = requests.filter((entry) => entry.path === '/').length;
  variant = 'quota';
  const updateLoaded = page.waitForEvent('load');
  await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
  await updateLoaded;
  await page.waitForTimeout(400);
  assert.equal(requests.filter((entry) => entry.path === '/').length, beforeUpdate + 1, 'update reloads exactly once');
  assert.equal((await page.goto(origin)).status(), 200, 'quota failure keeps a successful navigation');
  assert.equal(await page.locator('h1').textContent(), 'Service Worker smoke');
  assert.equal(await page.evaluate(async ({ name, pathname }) => Boolean(await (await caches.open(name)).match(pathname)), { name: appCache, pathname: assetPath }), true, 'worker update preserves immutable assets');
  assert.deepEqual(errors, []);
  await context.close();
  console.log('Chromium: navigation preload, single download, offline fallback, cache reuse, quota failure and one update reload passed.');
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
