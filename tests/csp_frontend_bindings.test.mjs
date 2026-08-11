import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('HTML 無外部字型、classic dialog 與 inline event handler', async () => {
  const [indexHtml, adminHtml] = await Promise.all([
    read('index.html'),
    read('admin.html'),
  ]);

  for (const html of [indexHtml, adminHtml]) {
    assert.doesNotMatch(html, /fonts\.(?:googleapis|gstatic)\.com/i);
    assert.doesNotMatch(html, /rel=["']preconnect["']/i);
    assert.doesNotMatch(html, /\son(?:click|change|input|load)\s*=/i);
    assert.doesNotMatch(html, /<script[^>]+src=["']\/static\/dialog\.js/i);
  }
  assert.match(indexHtml, /<script type="module" src="\/static\/js\/app\.js/);
  assert.match(adminHtml, /<script type="module" src="\/static\/js\/admin\/app\.js/);
});

test('兩頁使用相同且固定的 theme bootstrap inline script', async () => {
  const [indexHtml, adminHtml, mainSource] = await Promise.all([
    read('index.html'),
    read('admin.html'),
    read('main.py'),
  ]);
  const extract = (html) => html.match(/<script data-theme-bootstrap>([\s\S]*?)<\/script>/)?.[1];
  const indexTheme = extract(indexHtml);
  const adminTheme = extract(adminHtml);

  assert.ok(indexTheme);
  assert.equal(indexTheme, adminTheme);
  assert.match(indexTheme, /prefers-color-scheme: dark/);
  assert.match(indexTheme, /selected-palette/);

  const cspHash = createHash('sha256').update(indexTheme, 'utf8').digest('base64');
  assert.match(mainSource, new RegExp(`'sha256-${cspHash.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`));
  assert.doesNotMatch(mainSource, /script-src[^;\n]*'unsafe-inline'/);
});

test('dialog API 是真正的 ESM exports', async () => {
  const dialogApi = await import('../static/js/dialog-api.js');
  assert.equal(typeof dialogApi.showAlert, 'function');
  assert.equal(typeof dialogApi.showConfirm, 'function');
});

test('動態操作採 data attributes 與事件委派，不再掛 window globals', async () => {
  const paths = [
    'static/js/app.js',
    'static/js/upload.js',
    'static/js/history.js',
    'static/js/admin/app.js',
    'static/js/admin/orders.js',
    'static/js/admin/announcements.js',
  ];
  const sources = await Promise.all(paths.map(read));
  for (const source of sources) {
    assert.doesNotMatch(source, /\son(?:click|change|input)\s*=/i);
    assert.doesNotMatch(source, /window\.[A-Za-z_$][\w$]*\s*=/);
  }

  assert.match(sources[1], /data-file-action="preview"/);
  assert.match(sources[1], /addEventListener\('change', handleFileListChange\)/);
  assert.match(sources[2], /data-history-action="preview"/);
  assert.match(sources[3], /data-order-action/);
  assert.match(sources[3], /data-announcement-action/);
  assert.match(
    sources[0],
    /import\s*\{[^}]*\bfetchHistory\b[^}]*\}\s*from\s*['"]\.\/history\.js['"]/s,
  );
});

test('Service Worker 對 build 與 PDF.js cache-first，導覽 network-first 且不預抓 PDF', async () => {
  const source = await read('sw.js');
  assert.match(source, /MAX_APP_ENTRIES = 60/);
  assert.match(source, /MAX_PDF_ENGINE_ENTRIES = 60/);
  assert.match(source, /pathname\.startsWith\('\/static\/builds\/'\)/);
  assert.match(source, /pathname\.startsWith\('\/static\/pdfjs\/5\.7\.284\/'\)/);
  assert.match(source, /url\.search && \(isVersionedPdfEngine \|\| isVersionedAppAsset\)/);
  assert.match(source, /PDF_ENGINE_CACHE, MAX_PDF_ENGINE_ENTRIES/);
  assert.match(source, /request\.mode === 'navigate'/);
  assert.match(source, /不預抓 PDF 引擎/);
  assert.doesNotMatch(source, /cache\.addAll\([^)]*pdfjs/i);
});

test('部署失敗會回復可驗證的前一 Git 版本，purge 重試保留原模式', async () => {
  const source = await read('deploy.sh');
  assert.match(source, /PREVIOUS_GIT_REVISION="\$\(git rev-parse HEAD\)"/);
  assert.match(source, /PULL_ATTEMPTED=true\s+git pull --ff-only origin main/);
  assert.match(source, /git reset --keep "\$PREVIOUS_GIT_REVISION"/);
  assert.match(source, /restore_previous_python_dependencies/);
  assert.match(source, /PYTHON_DEPENDENCIES_UPDATED=true/);
  assert.match(source, /-m pip check/);
  assert.match(source, /export BACKEND_BUILD_ID="\$PREVIOUS_GIT_BUILD_ID"/);
  assert.match(source, /CF_PURGE_MODE=urls PUBLIC_ORIGIN="\$rollback_origin"/);
  assert.match(source, /請以 CF_PURGE_MODE=urls PUBLIC_ORIGIN=/);
  assert.doesNotMatch(source, /purge=pending（可安全重試 npm run purge:cloudflare/);
});
