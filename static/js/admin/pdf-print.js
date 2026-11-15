/**
 * 後台直接列印原始 PDF。
 *
 * 以同源 fetch 取得原檔 blob，放進畫面外的 iframe，交給瀏覽器內建 PDF
 * 檢視器叫出列印對話框；不經 PDF.js 重繪、不改寫原檔。色彩、雙面、縮放
 * 由管理員在列印對話框中選擇。依賴皆可注入，方便以假 DOM 做單元測試。
 */

/** iframe 載入後等待 PDF 檢視器初始化的時間（Edge 實測值）。 */
export const PDF_PRINT_DELAY_MS = 300;
/** iframe 一直沒有 load 時視為失敗，避免按鈕永遠停在準備中。 */
export const PDF_PRINT_LOAD_TIMEOUT_MS = 15000;

const PDF_TYPE = 'application/pdf';

function abortError() {
  return new DOMException('列印已取消', 'AbortError');
}

/** 是否為「準備中被取消」造成的錯誤，呼叫端應安靜忽略。 */
export function isPrintAbort(error) {
  return error?.name === 'AbortError';
}

/** 瀏覽器明確回報有內建 PDF 檢視器時才提供列印。 */
export function canPrintPdf(navigatorLike = globalThis.navigator) {
  return navigatorLike?.pdfViewerEnabled === true;
}

/**
 * 等待由 setup 決定何時完成的事件；signal 中止時立即以 AbortError 結束。
 * setup(done, fail) 可回傳中止時要執行的清理函式。
 */
function waitFor(signal, setup) {
  return new Promise((resolve, reject) => {
    let teardown = () => {};
    const onAbort = () => {
      teardown();
      reject(abortError());
    };
    if (signal.aborted) {
      reject(abortError());
      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });
    teardown = setup(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    ) ?? teardown;
  });
}

function createFrame(doc) {
  const frame = doc.createElement('iframe');
  frame.setAttribute('data-admin-print-frame', '');
  frame.setAttribute('aria-hidden', 'true');
  frame.setAttribute('tabindex', '-1');
  frame.title = 'PDF 列印暫存框架';
  // Chromium 不會在 display:none 的 frame 初始化 PDF 檢視器，改放到畫面外。
  Object.assign(frame.style, {
    position: 'fixed',
    right: '0',
    bottom: '0',
    width: '1px',
    height: '1px',
    border: '0',
    opacity: '0',
    pointerEvents: 'none',
  });
  return frame;
}

/**
 * 建立列印器。同一時間只保留一個列印工作：再次列印或 cleanup() 會中止
 * 尚未完成的工作，並移除上一個 iframe、撤銷 blob URL。
 */
export function createPdfPrinter(options = {}) {
  const doc = options.document ?? globalThis.document;
  const fetchImpl = options.fetch ?? ((...args) => globalThis.fetch(...args));
  const urlApi = options.URL ?? globalThis.URL;
  const setTimer = options.setTimeout ?? ((fn, ms) => globalThis.setTimeout(fn, ms));
  const clearTimer = options.clearTimeout ?? ((id) => globalThis.clearTimeout(id));
  const delayMs = options.delayMs ?? PDF_PRINT_DELAY_MS;
  const loadTimeoutMs = options.loadTimeoutMs ?? PDF_PRINT_LOAD_TIMEOUT_MS;

  let token = 0;
  let controller = null;
  let frame = null;
  let blobUrl = null;

  function cleanup() {
    token += 1;
    controller?.abort();
    controller = null;
    frame?.remove();
    frame = null;
    if (blobUrl) urlApi.revokeObjectURL(blobUrl);
    blobUrl = null;
  }

  /**
   * 取得 url 的 PDF 並叫出列印對話框。叫出後 resolve；失敗時清理並拋出
   * 錯誤；被 cleanup() 或下一次列印中止時拋出 AbortError。
   */
  async function print(url) {
    cleanup();
    const job = token;
    const abort = new AbortController();
    controller = abort;
    const { signal } = abort;
    const ensureCurrent = () => {
      if (job !== token) throw abortError();
    };

    try {
      const response = await fetchImpl(url, { signal });
      ensureCurrent();
      if (!response.ok) throw new Error(`取得 PDF 失敗（HTTP ${response.status}）`);
      const blob = await response.blob();
      ensureCurrent();

      blobUrl = urlApi.createObjectURL(
        blob.type === PDF_TYPE ? blob : blob.slice(0, blob.size, PDF_TYPE),
      );
      const printFrame = createFrame(doc);
      frame = printFrame;

      await waitFor(signal, (done, fail) => {
        const timeoutId = setTimer(
          () => fail(new Error('PDF 載入逾時')),
          loadTimeoutMs,
        );
        const onLoad = () => {
          clearTimer(timeoutId);
          done();
        };
        printFrame.addEventListener('load', onLoad, { once: true });
        printFrame.src = blobUrl;
        doc.body.appendChild(printFrame);
        return () => {
          clearTimer(timeoutId);
          printFrame.removeEventListener('load', onLoad);
        };
      });
      ensureCurrent();

      await waitFor(signal, (done) => {
        const timeoutId = setTimer(done, delayMs);
        return () => clearTimer(timeoutId);
      });
      ensureCurrent();

      const view = printFrame.contentWindow;
      if (typeof view?.print !== 'function') throw new Error('瀏覽器無法列印此 PDF');
      view.print();
      controller = null;
    } catch (error) {
      if (job !== token) throw abortError();
      cleanup();
      throw error;
    }
  }

  return { print, cleanup };
}
