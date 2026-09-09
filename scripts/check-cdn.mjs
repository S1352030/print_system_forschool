// Read-only checks of public cache headers. No purge, credentials or order-file access.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const origin = new URL(process.env.PUBLIC_ORIGIN || 'https://ampaprint.systems');
assert.equal(origin.protocol, 'https:');
assert.ok(!origin.username && !origin.password && origin.pathname === '/' && !origin.search && !origin.hash);
const output = process.env.CDN_CHECK_OUTPUT;
const rows = [];
const failures = [];
const headerNames = ['cache-control', 'cloudflare-cdn-cache-control', 'cf-cache-status', 'age', 'cf-ray', 'content-encoding', 'vary'];

async function inspect(pathname, kind, expectedStatus = 200) {
  let html = '';
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const started = performance.now();
    const response = await fetch(new URL(pathname, origin), {
      headers: { 'Accept-Encoding': 'br, gzip' },
      redirect: 'error', signal: AbortSignal.timeout(20_000),
    });
    const ttfbMs = performance.now() - started;
    const body = await response.text();
    if (pathname === '/') html = body;
    const headers = Object.fromEntries(headerNames.map((name) => [name, response.headers.get(name)]));
    const row = { path: pathname, attempt, kind, status: response.status, ttfbMs, totalMs: performance.now() - started, headers };
    rows.push(row);
    if (response.status !== expectedStatus) failures.push(`${pathname}: expected ${expectedStatus}, got ${response.status}`);
    const control = headers['cache-control'] || '';
    if (kind === 'immutable' && !/max-age=31536000\b/.test(control)) failures.push(`${pathname}: missing one-year TTL`);
    if (kind === 'immutable' && !/\bimmutable\b/.test(control)) failures.push(`${pathname}: missing immutable`);
    if (kind === 'announcements' && !/max-age=300\b/.test(control)) failures.push(`${pathname}: missing 300-second TTL`);
    if (kind === 'html' && !/\bno-cache\b/.test(control)) failures.push(`${pathname}: missing browser revalidation`);
    if (kind === 'private' || kind === 'sw') {
      if (!new RegExp(kind === 'sw' ? '\\bno-cache\\b' : '\\bno-store\\b').test(control)) failures.push(`${pathname}: unexpected browser caching`);
      if (headers.age !== null || /^(HIT|STALE|UPDATING|REVALIDATED)$/.test(headers['cf-cache-status'] || '')) failures.push(`${pathname}: sensitive response cached at edge`);
    } else if (attempt === 2 && !['HIT', 'UPDATING'].includes(headers['cf-cache-status'])) {
      failures.push(`${pathname}: second request did not hit edge cache (${headers['cf-cache-status']})`);
    }
  }
  return html;
}

try {
  const html = await inspect('/', 'html');
  const assets = [...html.matchAll(/\b(?:src|href)=["'](\/static\/builds\/[^"']+)["']/g)].map((match) => match[1]);
  for (const extension of ['js', 'css']) {
    const asset = assets.find((value) => value.endsWith(`.${extension}`));
    if (asset) await inspect(asset, 'immutable');
    else failures.push(`Homepage does not reference a versioned ${extension} asset`);
  }
  await inspect('/static/pdfjs/5.7.284/build/pdf.min.mjs', 'immutable');
  await inspect('/api/announcements', 'announcements');
  await inspect('/sw.js', 'sw');
  await inspect('/health', 'private');
  await inspect('/admin', 'private', 401);
  await inspect('/api/orders', 'private', 401);
  await inspect('/static/builds/cdn-check-missing/not-found.js', 'private', 404);
} catch (error) {
  failures.push(error.message);
} finally {
  const report = {
    capturedAt: new Date().toISOString(), origin: origin.origin,
    note: 'Read-only edge observations; Cloudflare removes its CDN control header before delivery. Exact edge TTL needs origin/config inspection. No authenticated requests or user PDFs are accessed.',
    rows, failures: [...new Set(failures)],
  };
  if (output) {
    await mkdir(path.dirname(path.resolve(output)), { recursive: true });
    await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  }
  console.log(JSON.stringify(report, null, 2));
  if (failures.length) process.exitCode = 1;
}
