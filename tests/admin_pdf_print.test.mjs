import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PDF_PRINT_DELAY_MS,
  PDF_PRINT_LOAD_TIMEOUT_MS,
  canPrintPdf,
  createPdfPrinter,
  isPrintAbort,
} from '../static/js/admin/pdf-print.js';

// 以下皆為測試用假物件：模擬 iframe、document、URL、fetch 與計時器，
// 只驗證列印模組的呼叫契約與清理，不代表真實瀏覽器會叫出對話框或出紙。

class FakeFrame {
  constructor(doc) {
    this.doc = doc;
    this.attributes = new Map();
    this.style = {};
    this.listeners = new Map();
    this.src = '';
    this.title = '';
    this.printCalls = 0;
    this.printError = null;
    const frame = this;
    this.contentWindow = {
      print() {
        frame.printCalls += 1;
        if (frame.printError) throw frame.printError;
      },
    };
  }

  setAttribute(name, value) { this.attributes.set(name, String(value)); }

  hasAttribute(name) { return this.attributes.has(name); }

  addEventListener(type, listener) {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  removeEventListener(type, listener) {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((item) => item !== listener));
  }

  dispatch(type) {
    const list = this.listeners.get(type) ?? [];
    this.listeners.set(type, []);
    for (const listener of list) listener();
  }

  remove() {
    this.doc.body.children = this.doc.body.children.filter((child) => child !== this);
  }
}

function createEnvironment({ responses = [] } = {}) {
  const doc = {
    frames: [],
    body: {
      children: [],
      appendChild(child) { this.children.push(child); },
    },
    createElement(tag) {
      assert.equal(tag, 'iframe');
      const frame = new FakeFrame(doc);
      doc.frames.push(frame);
      return frame;
    },
  };

  const urls = { created: [], revoked: [] };
  const URLApi = {
    createObjectURL(blob) {
      const url = `blob:test/${urls.created.length + 1}`;
      urls.created.push({ url, blob });
      return url;
    },
    revokeObjectURL(url) { urls.revoked.push(url); },
  };

  const timers = new Map();
  let nextTimer = 1;
  const clock = {
    setTimeout(fn, ms) {
      const id = nextTimer++;
      timers.set(id, { fn, ms });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    fire(ms) {
      for (const [id, timer] of [...timers]) {
        if (timer.ms !== ms) continue;
        timers.delete(id);
        timer.fn();
      }
    },
    pending: () => [...timers.values()].map((timer) => timer.ms),
  };

  const fetchCalls = [];
  const queue = [...responses];
  const fetch = (url, init) => {
    fetchCalls.push({ url, init });
    const next = queue.shift() ?? { ok: true, status: 200, type: 'application/pdf' };
    if (typeof next === 'function') return next(init);
    if (next instanceof Error) return Promise.reject(next);
    return Promise.resolve({
      ok: next.ok,
      status: next.status,
      blob: async () => new Blob(['%PDF-1.4 test'], { type: next.type ?? 'application/pdf' }),
    });
  };

  const printer = createPdfPrinter({
    document: doc,
    URL: URLApi,
    fetch,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
  });
  return { doc, urls, clock, fetchCalls, printer };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));
const pdfUrl = '/api/orders/7/file/report.pdf';

/** fetch 永遠不完成，直到 signal 中止才以 AbortError 拒絕（與瀏覽器 fetch 一致）。 */
function pendingUntilAborted(init) {
  return new Promise((_, reject) => {
    init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
  });
}

test('只有瀏覽器明確回報內建 PDF 檢視器時才可列印', () => {
  assert.equal(canPrintPdf({ pdfViewerEnabled: true }), true);
  assert.equal(canPrintPdf({ pdfViewerEnabled: false }), false);
  assert.equal(canPrintPdf({}), false);
  assert.equal(canPrintPdf(undefined), false);
});

test('取得原檔後放進畫面外 iframe，載入並延遲後只呼叫一次 print()', async () => {
  const { doc, urls, clock, fetchCalls, printer } = createEnvironment();
  let settled = false;
  const job = printer.print(pdfUrl).then(() => { settled = true; });
  await flush();

  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].url, pdfUrl);
  assert.ok(fetchCalls[0].init.signal, 'fetch 必須可被中止');

  assert.equal(doc.body.children.length, 1);
  const frame = doc.body.children[0];
  assert.ok(frame.hasAttribute('data-admin-print-frame'));
  assert.equal(frame.attributes.get('aria-hidden'), 'true');
  assert.notEqual(frame.style.display, 'none');
  assert.equal(frame.style.position, 'fixed');
  assert.equal(frame.style.width, '1px');
  assert.equal(frame.src, urls.created[0].url);
  assert.match(frame.src, /^blob:/);
  assert.equal(urls.created[0].blob.type, 'application/pdf');

  frame.dispatch('load');
  await flush();
  assert.equal(frame.printCalls, 0, '必須等待檢視器初始化延遲');
  assert.deepEqual(clock.pending(), [PDF_PRINT_DELAY_MS]);

  clock.fire(PDF_PRINT_DELAY_MS);
  await job;
  assert.equal(settled, true);
  assert.equal(frame.printCalls, 1);
  assert.equal(doc.body.children.length, 1, '列印對話框開啟期間保留 frame');
  assert.deepEqual(urls.revoked, []);
});

test('回應不是 PDF 類型時仍以 application/pdf 交給檢視器', async () => {
  const { urls, printer } = createEnvironment({
    responses: [{ ok: true, status: 200, type: 'application/octet-stream' }],
  });
  void printer.print(pdfUrl).catch(() => {});
  await flush();
  assert.equal(urls.created[0].blob.type, 'application/pdf');
  printer.cleanup();
});

test('原檔回應非 2xx 時拋出含狀態碼的錯誤，不建立 frame', async () => {
  const { doc, urls, printer } = createEnvironment({ responses: [{ ok: false, status: 404 }] });
  await assert.rejects(printer.print(pdfUrl), (error) => {
    assert.match(error.message, /HTTP 404/);
    assert.equal(isPrintAbort(error), false);
    return true;
  });
  assert.equal(doc.frames.length, 0);
  assert.deepEqual(urls.created, []);
});

test('網路錯誤直接拋出，不建立 frame', async () => {
  const failure = new TypeError('Failed to fetch');
  const { doc, printer } = createEnvironment({ responses: [failure] });
  await assert.rejects(printer.print(pdfUrl), failure);
  assert.equal(doc.frames.length, 0);
});

test('print() 拋錯時清理 frame 與 blob URL 並回報錯誤', async () => {
  const { doc, urls, clock, printer } = createEnvironment();
  const job = printer.print(pdfUrl);
  await flush();
  const frame = doc.body.children[0];
  frame.printError = new Error('SecurityError');
  frame.dispatch('load');
  await flush();
  clock.fire(PDF_PRINT_DELAY_MS);

  await assert.rejects(job, /SecurityError/);
  assert.equal(doc.body.children.length, 0);
  assert.deepEqual(urls.revoked, [urls.created[0].url]);
});

test('iframe 一直沒有載入時逾時失敗並清理', async () => {
  const { doc, urls, clock, printer } = createEnvironment();
  const job = printer.print(pdfUrl);
  await flush();
  assert.deepEqual(clock.pending(), [PDF_PRINT_LOAD_TIMEOUT_MS]);

  clock.fire(PDF_PRINT_LOAD_TIMEOUT_MS);
  await assert.rejects(job, /PDF 載入逾時/);
  assert.equal(doc.body.children.length, 0);
  assert.deepEqual(urls.revoked, [urls.created[0].url]);
});

test('取得原檔期間 cleanup() 會中止請求，不建立 frame 也不列印', async () => {
  const { doc, fetchCalls, printer } = createEnvironment({ responses: [pendingUntilAborted] });
  const job = printer.print(pdfUrl);
  await flush();
  printer.cleanup();

  await assert.rejects(job, (error) => isPrintAbort(error));
  assert.equal(fetchCalls[0].init.signal.aborted, true);
  assert.equal(doc.frames.length, 0);
});

test('中止後才抵達的過期回應不會建立 frame', async () => {
  let resolveLate;
  const late = () => new Promise((resolve) => { resolveLate = resolve; });
  const { doc, urls, printer } = createEnvironment({ responses: [late] });
  const job = printer.print(pdfUrl);
  await flush();
  printer.cleanup();
  resolveLate({ ok: true, status: 200, blob: async () => new Blob(['%PDF'], { type: 'application/pdf' }) });

  await assert.rejects(job, (error) => isPrintAbort(error));
  assert.equal(doc.frames.length, 0);
  assert.deepEqual(urls.created, []);
});

test('延遲期間 cleanup() 會移除 frame、撤銷 URL，且之後不會呼叫 print()', async () => {
  const { doc, urls, clock, printer } = createEnvironment();
  const job = printer.print(pdfUrl);
  await flush();
  const frame = doc.body.children[0];
  frame.dispatch('load');
  await flush();
  printer.cleanup();

  await assert.rejects(job, (error) => isPrintAbort(error));
  assert.deepEqual(clock.pending(), [], '延遲計時器必須被清除');
  assert.equal(frame.printCalls, 0);
  assert.equal(doc.body.children.length, 0);
  assert.deepEqual(urls.revoked, [urls.created[0].url]);
});

test('再次列印會先移除上一個 frame 並撤銷其 blob URL', async () => {
  const { doc, urls, clock, printer } = createEnvironment();
  const first = printer.print(pdfUrl);
  await flush();
  const firstFrame = doc.body.children[0];
  firstFrame.dispatch('load');
  await flush();
  clock.fire(PDF_PRINT_DELAY_MS);
  await first;

  const second = printer.print('/api/orders/8/file/next.pdf');
  await flush();
  assert.deepEqual(urls.revoked, [urls.created[0].url]);
  assert.equal(doc.body.children.length, 1);
  const secondFrame = doc.body.children[0];
  assert.notEqual(secondFrame, firstFrame);

  secondFrame.dispatch('load');
  await flush();
  clock.fire(PDF_PRINT_DELAY_MS);
  await second;
  assert.equal(firstFrame.printCalls, 1);
  assert.equal(secondFrame.printCalls, 1);

  printer.cleanup();
  assert.equal(doc.body.children.length, 0);
  assert.deepEqual(urls.revoked, [urls.created[0].url, urls.created[1].url]);
});

test('新列印取代尚未完成的舊列印，舊工作以中止結束且不影響新工作', async () => {
  const { doc, clock, printer } = createEnvironment({ responses: [pendingUntilAborted] });
  const first = printer.print(pdfUrl);
  await flush();
  const second = printer.print('/api/orders/8/file/next.pdf');

  await assert.rejects(first, (error) => isPrintAbort(error));
  await flush();
  assert.equal(doc.body.children.length, 1);
  const frame = doc.body.children[0];
  frame.dispatch('load');
  await flush();
  clock.fire(PDF_PRINT_DELAY_MS);
  await second;
  assert.equal(frame.printCalls, 1);
});
