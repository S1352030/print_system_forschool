import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium, webkit, devices } = require('playwright');
const projectRoot = path.resolve(import.meta.dirname, '..');

function createPdf(paddingBytes = 180_000) {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 5 0 R >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Contents 6 0 R >>',
    '<< /Length 0 >>\nstream\n\nendstream',
    '<< /Length 0 >>\nstream\n\nendstream',
    `<< /Length ${paddingBytes} >>\nstream\n${'x'.repeat(paddingBytes)}\nendstream`,
  ];
  let body = '%PDF-1.7\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n`;
  body += '0000000000 65535 f \n';
  offsets.slice(1).forEach((offset) => {
    body += `${String(offset).padStart(10, '0')} 00000 n \n`;
  });
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  body += `startxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body);
}

const fixturePdf = createPdf();
let fallbackRequests = 0;
let rangeRequests = 0;

const mimeTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.wasm', 'application/wasm'],
  ['.bcmap', 'application/octet-stream'],
  ['.ttf', 'font/ttf'],
  ['.icc', 'application/vnd.iccprofile'],
]);

function sendJson(response, value) {
  response.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(JSON.stringify(value));
}

function sendPdf(request, response) {
  const range = request.headers.range;
  const headers = {
    'Content-Type': 'application/pdf',
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, no-cache',
  };
  if (!range) {
    response.writeHead(200, { ...headers, 'Content-Length': fixturePdf.length });
    response.end(fixturePdf);
    return;
  }
  rangeRequests += 1;
  const match = /^bytes=(\d+)-(\d*)$/.exec(range);
  const start = Number(match?.[1] || 0);
  const requestedEnd = match?.[2] ? Number(match[2]) : fixturePdf.length - 1;
  const end = Math.min(requestedEnd, fixturePdf.length - 1);
  const chunk = fixturePdf.subarray(start, end + 1);
  response.writeHead(206, {
    ...headers,
    'Content-Length': chunk.length,
    'Content-Range': `bytes ${start}-${end}/${fixturePdf.length}`,
  });
  response.end(chunk);
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  if (url.pathname === '/api/check-pages') {
    fallbackRequests += 1;
    response.writeHead(500);
    response.end();
    return;
  }
  if (url.pathname.startsWith('/api/orders/1/file/')) {
    sendPdf(request, response);
    return;
  }
  if (url.pathname === '/api/orders') {
    sendJson(response, {
      items: [{
        id: 1,
        user_name: '測試者',
        file_name: 'remote.pdf',
        total_pages: 2,
        total_price: 2,
        color_mode: 'bw',
        duplex: 'single',
        fit_mode: 'fit',
        binding: null,
        pickup_location: null,
        is_paid: false,
        is_printed: false,
        created_at: '2026-07-30T12:00:00',
      }],
      total: 1,
      page: 1,
      page_size: 50,
      total_pages: 1,
    });
    return;
  }
  if (url.pathname === '/api/announcements' || url.pathname === '/api/admin/announcements') {
    sendJson(response, []);
    return;
  }
  if (url.pathname.startsWith('/api/')) {
    sendJson(response, { items: [], total: 0, page: 1, page_size: 50, total_pages: 0 });
    return;
  }

  const relative = url.pathname === '/'
    ? 'index.html'
    : url.pathname === '/admin'
      ? 'admin.html'
      : decodeURIComponent(url.pathname).replace(/^\/+/, '');
  const resolved = path.resolve(projectRoot, relative);
  if (!resolved.startsWith(projectRoot + path.sep)) {
    response.writeHead(403);
    response.end();
    return;
  }
  try {
    const body = await fs.readFile(resolved);
    response.writeHead(200, {
      'Content-Type': mimeTypes.get(path.extname(resolved)) || 'application/octet-stream',
      'Content-Length': body.length,
      'Cache-Control': 'no-cache',
    });
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end();
  }
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address();
const origin = `http://127.0.0.1:${port}`;

async function exercise(browserType, device) {
  const bundledExecutable = browserType.executablePath();
  const systemChromium = process.platform === 'win32'
    ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
    : null;
  const executablePath = existsSync(bundledExecutable)
    ? bundledExecutable
    : browserType.name() === 'chromium' && systemChromium && existsSync(systemChromium)
      ? systemChromium
      : undefined;
  const browser = await browserType.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {}),
  });
  const context = await browser.newContext({
    ...device,
    serviceWorkers: 'block',
  });
  const page = await context.newPage();
  const pageErrors = [];
  const consoleErrors = [];
  let engineRequests = 0;
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/static/pdfjs/5.7.284/')) {
      engineRequests += 1;
    }
  });

  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  assert.equal(engineRequests, 0, 'PDF engine must remain lazy before file selection');

  await page.locator('#pdf_file').setInputFiles({
    name: 'mobile-preview.pdf',
    mimeType: 'application/pdf',
    buffer: fixturePdf,
  });
  const canvas = page.locator('#pdf-preview-container [data-pdf-canvas]');
  try {
    await canvas.waitFor({ state: 'visible' });
  } catch (error) {
    const state = await page.locator('#pdf-preview-container').evaluate((element) => ({
      className: element.className,
      status: element.querySelector('[data-pdf-status]')?.textContent,
      error: element.querySelector('[data-pdf-error-message]')?.textContent,
    }));
    throw new Error(`${error.message}\nstate=${JSON.stringify(state)}\npageErrors=${JSON.stringify(pageErrors)}\nconsoleErrors=${JSON.stringify(consoleErrors)}`);
  }
  await page.waitForFunction(() =>
    document.querySelector('[data-pdf-canvas]')?.getAttribute('aria-label')?.includes('共 2 頁'),
  );
  assert.ok(engineRequests > 0, 'PDF engine should load after file selection');
  assert.equal(await page.locator('#pdf-preview-container canvas').count(), 1);
  assert.equal(fallbackRequests, 0, 'valid local PDF must not call /api/check-pages');

  await page.getByRole('button', { name: '下一頁' }).click();
  await page.waitForFunction(() =>
    document.querySelector('[data-pdf-canvas]')?.getAttribute('aria-label')?.includes('第 2 頁'),
  );
  assert.equal(await page.getByRole('button', { name: '下一頁' }).isDisabled(), true);
  if (process.env.PREVIEW_SCREENSHOT_DIR) {
    await fs.mkdir(process.env.PREVIEW_SCREENSHOT_DIR, { recursive: true });
    await page.screenshot({
      path: path.join(process.env.PREVIEW_SCREENSHOT_DIR, `${browserType.name()}-front.png`),
      fullPage: true,
    });
  }

  const fullscreen = page.getByRole('button', { name: '開啟全螢幕預覽' });
  await fullscreen.click();
  await page.locator('#pdf-fullscreen-dialog[open]').waitFor();
  await page.locator('#pdf-fullscreen-dialog [data-pdf-zoom]').selectOption('1.25');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('#pdf-fullscreen-dialog')?.open);
  await page.waitForFunction(() =>
    document.activeElement?.hasAttribute('data-pdf-fullscreen'),
  );

  await page.locator('#pdf_file').setInputFiles({
    name: 'second-preview.pdf',
    mimeType: 'application/pdf',
    buffer: fixturePdf,
  });
  await page.evaluate(() => {
    window.previewFile(0);
    window.previewFile(1);
  });
  await page.waitForFunction(() =>
    document.querySelector('[data-pdf-canvas]')?.getAttribute('aria-label')
      ?.startsWith('second-preview.pdf'),
  );
  assert.equal(await page.locator('#pdf-preview-container canvas').count(), 1);
  assert.equal(fallbackRequests, 0);

  await page.goto(`${origin}/admin`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /查看/ }).click();
  await page.locator('#pdf-modal[open]').waitFor();
  await page.waitForFunction(() =>
    document.querySelector('#admin-pdf-preview [data-pdf-canvas]')
      ?.getAttribute('aria-label')?.includes('共 2 頁'),
  );
  assert.equal(await page.locator('#admin-pdf-preview canvas').count(), 1);
  assert.equal(
    await page.locator('#admin-pdf-preview [data-pdf-paper]').textContent(),
    'A4 直向',
  );
  if (process.env.PREVIEW_SCREENSHOT_DIR) {
    await page.screenshot({
      path: path.join(process.env.PREVIEW_SCREENSHOT_DIR, `${browserType.name()}-admin.png`),
      fullPage: true,
    });
  }
  await page.locator('[data-admin-pdf-close]').click();
  assert.ok(rangeRequests > 0, 'remote preview must use HTTP Range');

  assert.deepEqual(pageErrors, []);
  await context.close();
  await browser.close();
}

try {
  await exercise(chromium, devices['Pixel 7']);
  await exercise(webkit, devices['iPhone 14']);
  console.log('Chromium and WebKit mobile PDF preview smoke tests passed.');
} finally {
  await new Promise((resolve) => server.close(resolve));
}
