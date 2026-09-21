import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = path.resolve(import.meta.dirname, '..');
const python = process.env.TEST_PYTHON || 'python';
const temp = await mkdtemp(path.join(os.tmpdir(), 'print-gift-browser-'));
const screenshotDir = process.env.GIFT_SCREENSHOT_DIR || temp;
await mkdir(screenshotDir, { recursive: true });
const portServer = net.createServer();
await new Promise((resolve) => portServer.listen(0, '127.0.0.1', resolve));
const port = portServer.address().port;
await new Promise((resolve) => portServer.close(resolve));
const origin = `http://127.0.0.1:${port}`;
const pdfResult = spawnSync(python, ['-c', `
import base64, io, json
from pypdf import PdfWriter
result = {}
for pages in (2, 3, 5):
    writer = PdfWriter()
    for _ in range(pages): writer.add_blank_page(width=595, height=842)
    output = io.BytesIO(); writer.write(output)
    result[str(pages)] = base64.b64encode(output.getvalue()).decode()
print(json.dumps(result))
`], { encoding: 'utf8', windowsHide: true });
assert.equal(pdfResult.status, 0, pdfResult.stderr);
const pdfs = JSON.parse(pdfResult.stdout);
const server = spawn(python, ['-c', `
import main, uvicorn
main.rate_limiter.is_allowed = lambda *args: True
main._send_line_notification_bg = lambda **kwargs: None
uvicorn.run(main.app, host='127.0.0.1', port=${port}, log_level='warning')
`], { cwd: root, windowsHide: true, env: {
  ...process.env, PYTHONUTF8: '1', DATABASE_URL: `sqlite:///${path.join(temp, 'test.sqlite3').replaceAll('\\', '/')}`,
  UPLOAD_DIR: path.join(temp, 'uploads'), ADMIN_USERNAME: 'gift-test-admin', ADMIN_PASSWORD: 'gift-test-password',
  LINE_CHANNEL_ACCESS_TOKEN: '', LINE_RECEIVER_ID: '', APP_BUILD_ID: '', BACKEND_BUILD_ID: '',
} });
let serverOutput = '';
server.stdout.on('data', (chunk) => { serverOutput += chunk.toString(); });
server.stderr.on('data', (chunk) => { serverOutput += chunk.toString(); });
let browser;
try {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) throw new Error(serverOutput);
    try { if ((await fetch(`${origin}/health`)).ok) break; } catch { /* starting */ }
    if (attempt === 99) throw new Error(`Server did not start: ${serverOutput}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  browser = await chromium.launch({ headless: true,
    ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}),
    ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}),
  });
  const context = await browser.newContext({ httpCredentials: { username: 'gift-test-admin', password: 'gift-test-password' },
    viewport: { width: 1365, height: 1000 }, reducedMotion: 'reduce', permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const api = context.request;
  const upload = async (pages, extra = {}) => {
    const response = await api.post(`${origin}/api/upload`, { multipart: {
      user_name: '禮物卡流程測試', pickup_location: '明天中午', request_id: crypto.randomUUID(),
      file: { name: `print-${pages}.pdf`, mimeType: 'application/pdf', buffer: Buffer.from(pdfs[pages], 'base64') }, ...extra,
    } });
    assert.equal(response.status(), 201, await response.text());
    return response.json();
  };
  const order = await upload(3);
  await page.goto(`${origin}/admin`);
  await page.locator(`[data-order-action="payment"][data-order-id="${order.order_id}"]`).click();
  await page.locator('#payment-cash').fill('5');
  assert.match(await page.locator('#payment-preview').textContent(), /發放 2 元禮物卡/);
  await page.screenshot({ path: path.join(screenshotDir, 'payment-desktop.png') });
  await page.locator('#payment-submit').click();
  await page.waitForFunction(() => document.querySelector('#payment-title').textContent === '收款完成');
  const code = await page.locator('#payment-result code').textContent();
  await page.locator('#payment-result [data-copy-code]').click();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), code);
  await page.locator('[data-close-finance="payment-dialog"]').click();
  await page.locator('#gift-card-list code').filter({ hasText: code }).waitFor();

  // 真實前台多檔上傳：首份全額折抵，餘額用完後第二份照原價。
  await page.goto(origin);
  await page.locator('#user_name').fill('禮物卡流程測試');
  await page.locator('#pickup_location').fill('明天中午');
  await page.locator('#pdf_file').setInputFiles([2, 3].map((pages) => ({
    name: `multi-${pages}.pdf`, mimeType: 'application/pdf', buffer: Buffer.from(pdfs[pages], 'base64'),
  })));
  await page.locator('#gift-card-code').fill(code);
  assert.equal(await page.locator('#submit-btn').isDisabled(), true);
  await page.locator('#gift-card-apply').click();
  await page.waitForFunction(() => document.querySelector('#gift-card-status').textContent.includes('可用餘額 NT$ 2'));
  await page.waitForFunction(() => document.querySelector('#price-total-amount').textContent === 'NT$ 3 元');
  await page.locator('#submit-btn').click();
  await page.waitForFunction(() => document.querySelector('#m3-dialog-content')?.textContent.includes('上傳成功'));
  assert.match(await page.locator('#m3-dialog-content').textContent(), /折抵 NT\$ 2 元，應收金額 NT\$ 3 元/);
  await page.locator('#m3-dialog-btn-confirm').click();
  const history = await (await api.get(`${origin}/api/orders/history?user_name=${encodeURIComponent('禮物卡流程測試')}`)).json();
  const credited = history.find((row) => row.file_name === 'multi-2.pdf');
  assert.equal(credited.amount_due, 0);
  assert.equal(credited.is_paid, true);
  assert.equal(history.find((row) => row.file_name === 'multi-3.pdf').amount_due, 3);

  // 後台取消與退款。
  await page.goto(`${origin}/admin`);
  await page.locator(`[data-order-action="cancel"][data-order-id="${credited.id}"]`).click();
  await page.locator('#m3-dialog-btn-confirm').click();
  await page.waitForFunction(() => document.querySelector('#m3-dialog-content')?.textContent.includes('訂單已取消'));
  await page.locator('#m3-dialog-btn-confirm').click();
  assert.match(await page.locator(`#row-${credited.id}`).textContent(), /已取消/);
  await page.locator('[data-card-detail]').first().click();
  await page.locator('#gift-detail-body').getByText('取消訂單退回 +2 元', { exact: true }).waitFor();
  await page.locator('[data-close-finance="gift-detail-dialog"]').click();

  // 行動裝置：套用、試算、全額卡餘額與收款視窗不超出畫面。
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(origin);
  await page.locator('#user_name').fill('手機測試');
  await page.locator('#pickup_location').fill('明天中午');
  await page.locator('#pdf_file').setInputFiles({ name: 'mobile.pdf', mimeType: 'application/pdf', buffer: Buffer.from(pdfs[5], 'base64') });
  await page.locator('#gift-card-code').fill(code);
  await page.locator('#gift-card-apply').click();
  await page.waitForFunction(() => document.querySelector('#price-total-amount').textContent === 'NT$ 3 元');
  await page.locator('#gift-card-fields').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(screenshotDir, 'gift-mobile.png') });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);

  // 回應遺失：伺服器已扣款，但重試必須回原訂單，不再扣一次。
  let lost = false;
  let originalUpload;
  await page.route('**/api/upload', async (route) => {
    const response = await route.fetch();
    if (!lost) {
      lost = true;
      originalUpload = await response.json();
      await route.abort('failed');
    } else {
      assert.equal((await response.json()).order_id, originalUpload.order_id);
      await route.fulfill({ response });
    }
  });
  await page.locator('#submit-btn').click();
  await page.waitForFunction(() => document.querySelector('#m3-dialog-content')?.textContent.includes('重試確認上傳結果'));
  await page.locator('#m3-dialog-btn-confirm').click();
  assert.equal(await page.locator('#gift-card-code').isDisabled(), true);
  await page.getByRole('button', { name: '重試確認上傳結果', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#m3-dialog-content')?.textContent.includes('上傳成功'));
  await page.locator('#m3-dialog-btn-confirm').click();
  const checked = await (await api.post(`${origin}/api/gift-cards/check`, { data: { code } })).json();
  assert.equal(checked.balance, 0);
  await page.unroute('**/api/upload');

  const mobileOrder = await upload(3);
  await page.goto(`${origin}/admin`);
  await page.locator(`[data-order-action="payment"][data-order-id="${mobileOrder.order_id}"]`).click();
  await page.locator('#payment-cash').fill('5');
  await page.screenshot({ path: path.join(screenshotDir, 'payment-mobile.png') });
  const bounds = await page.locator('#payment-dialog').boundingBox();
  assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 390);
  await page.locator('#payment-submit').click();
  await page.waitForFunction(() => document.querySelector('#payment-title').textContent === '收款完成');
  assert.deepEqual(errors, []);
  console.log('Gift card desktop/mobile, cash issuance, multi-file redemption, cancellation and lost-response retry passed.');
  console.log(`Screenshots: ${screenshotDir}`);
  await context.close();
} finally {
  await browser?.close();
  server.kill();
}
