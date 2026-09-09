// Read-only browser measurements. Local mode uses a built frontend and mock announcements.
// Set NODE_PATH to a Playwright installation when it is provided by the host runtime.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { gzipSync } from 'node:zlib';

const { chromium, devices } = createRequire(import.meta.url)('playwright');
const root = path.resolve(import.meta.dirname, '..');
const buildId = process.env.APP_BUILD_ID || 'local';
assert.match(buildId, /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/);
const samples = Number(process.env.LOAD_TEST_SAMPLES || 10);
const latencyMs = Number(process.env.LOAD_TEST_LATENCY_MS || 120);
assert.ok(Number.isInteger(samples) && samples >= 1 && samples <= 100);
assert.ok(Number.isFinite(latencyMs) && latencyMs >= 0 && latencyMs <= 5000);
const output = process.env.LOAD_TEST_OUTPUT;
const swPath = path.resolve(root, process.env.LOAD_TEST_SW_PATH || 'sw.js');
const swSource = await readFile(swPath);
let server;
let origin = process.env.LOAD_TEST_ORIGIN;
const originRequests = [];
const blockedFixtureUrls = ['*://*.scr.kaspersky-labs.com/*'];

if (!origin) {
  const index = await readFile(path.join(root, 'static', 'builds', buildId, 'index.html'));
  // Match the production CSP, including its bootstrap hash. Without it, local
  // antivirus script injection can add seconds of unrelated render blocking.
  const backend = await readFile(path.join(root, 'main.py'), 'utf8');
  const csp = backend.match(/^\s*csp = "([^"\r\n]+)"/m)?.[1];
  assert.ok(csp, 'The local measurement fixture requires the production CSP');
  const payloads = new Map();
  server = http.createServer(async (request, response) => {
    const url = new URL(request.url, 'http://localhost');
    const entry = { path: url.pathname, preload: request.headers['service-worker-navigation-preload'] || null };
    originRequests.push(entry);
    try {
      if (request.method !== 'GET') { response.writeHead(405).end(); return; }
      if (url.pathname === '/favicon.ico') { response.writeHead(204).end(); return; }
      let body;
      let type;
      let cacheControl;
      if (url.pathname === '/') {
        body = index;
        type = 'text/html; charset=utf-8';
        cacheControl = 'public, no-cache';
      } else if (url.pathname === '/sw.js') {
        body = swSource;
        type = 'text/javascript; charset=utf-8';
        cacheControl = 'no-cache';
      } else if (url.pathname === '/api/announcements') {
        body = Buffer.from('[]');
        type = 'application/json';
        cacheControl = 'public, max-age=300';
      } else {
        assert.ok(url.pathname.startsWith(`/static/builds/${buildId}/`));
        const resolved = path.resolve(root, `.${decodeURIComponent(url.pathname)}`);
        const releaseRoot = path.join(root, 'static', 'builds', buildId) + path.sep;
        assert.ok(resolved.startsWith(releaseRoot));
        body = await readFile(resolved);
        type = resolved.endsWith('.css') ? 'text/css' : 'text/javascript';
        cacheControl = 'public, max-age=31536000, immutable';
      }
      // The exact same gzip payload and artificial origin delay apply to both versions.
      if (!payloads.has(url.pathname)) payloads.set(url.pathname, gzipSync(body));
      const compressed = payloads.get(url.pathname);
      await delay(latencyMs);
      response.writeHead(200, {
        'Content-Type': type, 'Content-Encoding': 'gzip',
        'Content-Length': compressed.length, 'Cache-Control': cacheControl,
        'Vary': 'Accept-Encoding', 'Service-Worker-Allowed': '/',
        'Content-Security-Policy': csp,
      });
      response.end(compressed);
    } catch {
      response.writeHead(404, { 'Cache-Control': 'no-store' }).end();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
}

const bundled = chromium.executablePath();
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
  || (existsSync(bundled) ? bundled : 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe');
let browser;
const rows = [];
try {
  browser = await chromium.launch({ headless: true, executablePath });
  for (let sample = 1; sample <= samples; sample += 1) {
    const context = await browser.newContext({ ...devices['Pixel 7'], serviceWorkers: 'allow' });
    try {
      const page = await context.newPage();
      if (server) {
        // Some antivirus proxies also rewrite CSP. Isolate only the known injected
        // script inside this fixture browser; keep HTTP cache and SW behavior intact.
        const cdp = await context.newCDPSession(page);
        await cdp.send('Network.enable');
        await cdp.send('Network.setBlockedURLs', { urls: blockedFixtureUrls });
      }
      const pageErrors = [];
      page.on('pageerror', (error) => pageErrors.push(error.message));
      await page.addInitScript(() => {
        window.__loadLcp = null;
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) window.__loadLcp = entry.startTime;
        }).observe({ type: 'largest-contentful-paint', buffered: true });
      });
      for (const visit of ['cold', 'warm']) {
        // A second navigation retains this context's HTTP and Service Worker caches.
        const requestStart = originRequests.length;
        const response = await page.goto(origin, { waitUntil: 'load' });
        assert.equal(response.status(), 200);
        await page.waitForFunction(() => window.__loadLcp !== null);
        // Fixed observation window also includes the nonblocking announcements request.
        await page.waitForTimeout(700);
        const values = await page.evaluate(() => {
          const navigation = performance.getEntriesByType('navigation')[0];
          const entries = [navigation, ...performance.getEntriesByType('resource')];
          return {
            ttfbMs: navigation.responseStart,
            fcpMs: performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? null,
            lcpMs: window.__loadLcp,
            requestCount: entries.length,
            transferBytes: entries.reduce((sum, entry) => sum + entry.transferSize, 0),
            encodedBytes: entries.reduce((sum, entry) => sum + entry.encodedBodySize, 0),
            workerStartMs: navigation.workerStart,
            resources: entries.map((entry) => ({
              name: new URL(entry.name).origin === location.origin
                ? new URL(entry.name).pathname : new URL(entry.name).origin,
              startTime: entry.startTime, responseEnd: entry.responseEnd,
              initiatorType: entry.initiatorType, transferSize: entry.transferSize,
            })),
          };
        });
        const headers = await response.allHeaders();
        const requests = server ? originRequests.slice(requestStart) : null;
        if (requests) {
          assert.equal(requests.filter((item) => item.path === '/').length, 1, 'one origin navigation per visit');
        }
        rows.push({ sample, visit, ...values,
          cfRay: headers['cf-ray'] || null,
          cfCacheStatus: headers['cf-cache-status'] || null,
          age: headers.age ?? null,
          originRequestCount: requests?.length ?? null,
          preloadCount: requests?.filter((item) => item.preload).length ?? null,
        });
        if (visit === 'cold') {
          await page.evaluate(async () => {
            await navigator.serviceWorker.ready;
            if (!navigator.serviceWorker.controller) {
              await new Promise((resolve) => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
            }
          });
        }
      }
      assert.deepEqual(pageErrors, []);
      console.log(`Measured ${sample}/${samples} cold + warm visits.`);
    } finally {
      await context.close();
    }
  }
  function stats(visit, key) {
    const sorted = rows.filter((row) => row.visit === visit).map((row) => row[key]).filter(Number.isFinite).sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return { median: sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2,
      p90: sorted[Math.ceil(sorted.length * 0.9) - 1] };
  }
  const report = {
    capturedAt: new Date().toISOString(), origin, browser: browser.version(),
    environment: server ? 'Local synthetic origin; not Taiwan or production latency' : 'Live site from this host; cfRay identifies the edge, not the client location',
    latencyMs: server ? latencyMs : null, buildId: server ? buildId : null,
    blockedFixtureUrls: server ? blockedFixtureUrls : [],
    swSha256: server ? createHash('sha256').update(swSource).digest('hex') : null,
    samples, observationWindowMs: 700,
    transferNote: 'requestCount counts resource timing entries, not network trips. Performance API bytes exclude SW background requests; Cache API responses may report zero. Origin request counts are included in local mode.',
    summary: Object.fromEntries(['cold', 'warm'].map((visit) => [visit, Object.fromEntries(
      ['ttfbMs', 'fcpMs', 'lcpMs', 'requestCount', 'transferBytes', 'encodedBytes'].map((key) => [key, stats(visit, key)]),
    )])), rows,
  };
  if (output) {
    await mkdir(path.dirname(path.resolve(output)), { recursive: true });
    await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  }
  console.log(JSON.stringify(report.summary, null, 2));
} finally {
  await browser?.close();
  if (server) await new Promise((resolve) => server.close(resolve));
}
