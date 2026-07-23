/**
 * PDF 預覽模組(使用者端 index.html 用)
 * 負責本地檔案與歷史訂單的 PDF 預覽。
 *
 * 預覽框固定為 A4 比例(直向 210×297 / 橫向 297×210),PDF 內容以
 * 「符合頁面(fit-to-page)」等比縮放、置中、留白,精確反映 A4 列印結果。
 * 非 A4 檔案顯示尺寸標籤與警告。逐頁重新偵測(支援多尺寸混合 PDF)。
 *
 * 含有「預覽 token」防競態機制:使用者快速切換檔案時,
 * 舊的非同步載入完成後不會覆蓋目前正在看的預覽。
 */

import { showAlert } from './app.js';
import { ensurePdfjs } from './pdfjs-loader.js';
import { detectPaper, computeA4Fit, computeA4Cover, safeDpr, a4LabelMm } from './pdf-paper.js';

let currentPdfDoc = null;
let currentPdfPage = 1;
let pdfRenderTask = null;
// 文件處理模式:'fit'(留白,預設) / 'cover'(裁切)。
// 由 setFitMode() 統一管理;切換預覽檔案時由呼叫端靜默同步,
// 確保預覽模式永遠吻合當前檔案的 fitMode 設定(多檔案狀態同步)。
let currentFitMode = 'fit';

// DOM 引用(lazy 取得,避免模組載入時 DOM 尚未就緒)
function _els() {
  return {
    canvas: document.getElementById('pdf-canvas'),
    a4Frame: document.getElementById('pdf-a4-frame'),
    docOutline: document.getElementById('pdf-doc-outline'),
    docLabel: document.getElementById('pdf-doc-label'),
    a4Label: document.getElementById('pdf-a4-label'),
    container: document.getElementById('pdf-preview-container'),
    placeholder: document.getElementById('pdf-placeholder'),
    meta: document.getElementById('preview-meta'),
    paperBadge: document.getElementById('meta-paper'),
  };
}

/**
 * 更新紙張尺寸標籤。
 * A4 → 綠色 badge;非 A4 → 橘紅警告 badge +「將以 A4 縮放列印」提示。
 * 每頁渲染後呼叫,支援同一份檔案內多種尺寸混合的及時切換。
 *
 * @param {import('pdfjs-dist').PDFPageProxy} page
 */
async function updatePaperBadge(page) {
  const { paperBadge, a4Frame } = _els();
  if (!paperBadge || !page) return;
  try {
    const vp = page.getViewport({ scale: 1.0 });
    const info = detectPaper(vp.width, vp.height);
    const orient = info.isLandscape ? '橫向' : '直向';
    paperBadge.classList.toggle('paper-warn', !info.isA4);
    paperBadge.classList.toggle('paper-ok', info.isA4);
    if (info.isA4) {
      paperBadge.textContent = 'A4 ' + orient;
    } else {
      paperBadge.textContent = `${info.name} ${info.wMm}×${info.hMm}mm · ⚠ 將以 A4 縮放列印`;
    }
    // A4 框方向逐頁同步(橫向頁 → 框轉橫向)
    if (a4Frame) a4Frame.classList.toggle('landscape', info.isLandscape);
    // A4 尺寸標籤依方向更新
    const { a4Label } = _els();
    if (a4Label) a4Label.textContent = a4LabelMm(info.isLandscape);
  } catch (e) {
    // 偵測失敗不阻斷預覽
    console.warn('paper detect failed', e);
  }
}

/**
 * 設定文件處理模式(fit 留白 / cover 裁切)。
 *
 * @param {string} mode - 'fit' 或 'cover'
 * @param {boolean} [silent=false] - true 時只更新狀態與 A4 框 class,
 *   不立即重繪。用於「切換到另一個檔案」時先把模式同步成該檔案的設定,
 *   後續的 render 自然就會用對的模式(silent=true 時 currentPdfDoc 尚未換好)。
 */
export function setFitMode(mode, silent = false) {
  currentFitMode = mode === 'cover' ? 'cover' : 'fit';
  const { a4Frame } = _els();
  if (a4Frame) a4Frame.classList.toggle('cover', currentFitMode === 'cover');
  if (!silent && currentPdfDoc) {
    renderPdfPage(currentPdfPage);
  }
}

/**
 * 以當前 PDF 文件與頁碼重新渲染(供 resize / 外部觸發用)。
 */
export function rerenderCurrent() {
  if (currentPdfDoc) renderPdfPage(currentPdfPage);
}

/**
 * 渲染指定頁碼到 canvas。
 * 內容依 currentFitMode 以 fit(留白)或 cover(裁切)縮放進 A4 框;含 DPR 上限防護。
 */
async function renderPdfPage(num) {
  if (!currentPdfDoc) return;
  const { canvas, a4Frame } = _els();
  if (!canvas || !a4Frame) return;

  // 若有進行中的渲染,先取消再重來(resize / 快速翻頁可重渲染)
  if (pdfRenderTask) {
    try { await pdfRenderTask.cancel(); } catch (_) { /* RenderingCancelledException 靜默 */ }
    pdfRenderTask = null;
  }

  const ctx = canvas.getContext('2d');
  try {
    const page = await currentPdfDoc.getPage(num);

    // 先依當頁方向更新 A4 框(橫向頁 → aspect-ratio 切橫向),再讀框尺寸
    await updatePaperBadge(page);
    const frameW = a4Frame.clientWidth || 380;
    const frameH = a4Frame.clientHeight || (frameW * 297 / 210);

    const unscaled = page.getViewport({ scale: 1.0 });
    // 依當前模式分派:fit=留白(放進框),cover=裁切(填滿框,超出由 overflow:hidden 裁)
    const compute = currentFitMode === 'cover' ? computeA4Cover : computeA4Fit;
    const { contentCssW, contentCssH, renderScale } = compute(
      unscaled.width, unscaled.height, frameW, frameH
    );
    const dpr = safeDpr();
    const viewport = page.getViewport({ scale: renderScale * dpr });

    // canvas 實體像素 = 內容 CSS 尺寸 × DPR;CSS 顯示尺寸 = 內容尺寸
    canvas.width = Math.round(contentCssW * dpr);
    canvas.height = Math.round(contentCssH * dpr);
    canvas.style.width = `${contentCssW}px`;
    canvas.style.height = `${contentCssH}px`;

    pdfRenderTask = page.render({ canvasContext: ctx, viewport });
    await pdfRenderTask.promise;
    pdfRenderTask = null;
    const pageNumEl = document.getElementById('pdf-page-num');
    if (pageNumEl) pageNumEl.textContent = num;

    // 原文件邊界框:尺寸 = canvas CSS 尺寸(即原文件 fit/cover 後的邊界)。
    // fit 時小於 A4 框(框內留白區被 box-shadow 色塊標示);
    // cover 時 ≥ A4 框(box-shadow 色塊被 overflow:hidden 裁掉,無留白顯示)。
    const { docOutline, docLabel } = _els();
    if (docOutline) {
      docOutline.style.width = `${contentCssW}px`;
      docOutline.style.height = `${contentCssH}px`;
    }
    // 原文件尺寸標籤(pt → mm)
    if (docLabel) {
      const wMm = Math.round(unscaled.width * 25.4 / 72);
      const hMm = Math.round(unscaled.height * 25.4 / 72);
      docLabel.textContent = `原文件 ${wMm}×${hMm}mm`;
    }
  } catch (e) {
    pdfRenderTask = null;
    // 取消造成的例外靜默;真正錯誤才記錄
    if (e && e.name !== 'RenderingCancelledException') {
      console.error('PDF rendering error', e);
    }
  }
}

// 遞增版本號,用來判斷「使用者是否已經切到別的檔案」,
// 避免上一份還沒解析完的 PDF 在解析完成後蓋掉目前預覽(競態問題)。
let previewToken = 0;

// resize 監聽:debounce 200ms,期間靠 CSS 拉伸 canvas(不重渲染避免閃爍),
// 倒數結束後才悄悄重渲染高解析畫面覆蓋。
let resizeTimer = null;
let resizeBound = false;
function bindResizeIfNeeded() {
  if (resizeBound) return;
  resizeBound = true;
  window.addEventListener('resize', () => {
    if (!currentPdfDoc) return;
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      renderPdfPage(currentPdfPage);
    }, 200);
  });
}

/**
 * 預覽本地選取的檔案。
 * 已解析過的檔案會快取在 fileObj.pdfDoc,切換時瞬間顯示。
 */
export async function showPreview(fileObj) {
  const { container, placeholder, meta } = _els();
  if (!container || !placeholder || !meta) return;
  const file = fileObj.file;
  const myToken = ++previewToken;

  placeholder.classList.add('hidden');
  container.classList.remove('hidden');
  meta.classList.remove('hidden');
  document.getElementById('meta-name').textContent = file.name;
  document.getElementById('meta-size').textContent = (file.size / 1024).toFixed(0) + ' KB';

  try {
    if (fileObj.pdfDoc) {
      currentPdfDoc = fileObj.pdfDoc;
    } else {
      // 直接把本地檔案讀成 ArrayBuffer 餵給 PDF.js(data 模式),
      // 跳過 blob URL 的網路層開銷,本地檔案一次讀取、一次剖析。
      const arrayBuffer = await file.arrayBuffer();
      if (myToken !== previewToken) return; // 已切換到其他檔案

      await ensurePdfjs();
      const loadingTask = pdfjsLib.getDocument({
        data: arrayBuffer,
        cMapUrl: '/static/pdfjs/web/cmaps/',
        cMapPacked: true,
      });
      const pdfDoc = await loadingTask.promise;
      if (myToken !== previewToken) {
        // 使用者已切走,這份文件用不到,釋放避免浪費記憶體
        pdfDoc.destroy();
        return;
      }
      fileObj.pdfDoc = pdfDoc;
      currentPdfDoc = pdfDoc;
    }

    document.getElementById('pdf-page-count').textContent = currentPdfDoc.numPages;
    currentPdfPage = 1;
    // 切換檔案時同步該檔案的處理模式(silent:不立即重繪,下一行 render 會用新模式)
    setFitMode(fileObj.fitMode || 'fit', true);
    bindResizeIfNeeded();
    await renderPdfPage(currentPdfPage);
  } catch (e) {
    if (myToken !== previewToken) return;
    console.error('PDF Load Error', e);
    await showAlert('PDF 載入失敗:' + (e.message || e), 'error');
  }
}

/**
 * 重設預覽區為初始狀態(顯示 placeholder)。
 */
export function resetPreview() {
  previewToken++; // 讓所有還在進行中的載入工作失效
  currentPdfDoc = null;
  currentFitMode = 'fit'; // 重設為預設模式
  const { canvas, a4Frame, container, placeholder, meta, paperBadge } = _els();
  if (!canvas || !a4Frame || !container || !placeholder || !meta) return;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  a4Frame.classList.remove('landscape', 'cover', 'annotated');
  const annoBtn = document.getElementById('pdf-annotate-toggle');
  if (annoBtn) annoBtn.classList.remove('active');
  if (paperBadge) {
    paperBadge.classList.remove('paper-warn', 'paper-ok');
    paperBadge.textContent = '—';
  }
  placeholder.classList.remove('hidden');
  container.classList.add('hidden');
  meta.classList.add('hidden');
}

/**
 * 預覽歷史訂單的 PDF(透過 API 下載)。
 *
 * @param {string} fitMode - 該訂單的文件處理模式('fit'/'cover'),用於同步預覽。
 */
export async function previewPastOrder(orderId, fileName, searchName, fitMode) {
  const { container, placeholder, meta } = _els();
  placeholder.classList.add('hidden');
  container.classList.remove('hidden');
  meta.classList.remove('hidden');
  document.getElementById('meta-name').textContent = fileName;
  document.getElementById('meta-size').textContent = '歷史訂單 #' + orderId;

  const url = '/api/orders/' + orderId + '/preview/' + encodeURIComponent(fileName) + '?user_name=' + encodeURIComponent(searchName);

  const myToken = ++previewToken;
  try {
    await ensurePdfjs();
    const pdf = await pdfjsLib.getDocument({
      url,
      cMapUrl: '/static/pdfjs/web/cmaps/',
      cMapPacked: true,
    }).promise;
    if (myToken !== previewToken) {
      pdf.destroy();
      return;
    }
    currentPdfDoc = pdf;
    document.getElementById('pdf-page-count').textContent = currentPdfDoc.numPages;
    currentPdfPage = 1;
    setFitMode(fitMode || 'fit', true);
    bindResizeIfNeeded();
    await renderPdfPage(currentPdfPage);
  } catch (e) {
    if (myToken !== previewToken) return;
    console.error('PDF Load Error', e);
    await showAlert('PDF 載入失敗:' + (e.message || e), 'error');
  }
}

/**
 * 翻頁控制(+1 / -1)。
 */
export function pdfNavigate(delta) {
  if (!currentPdfDoc) return;
  const newPage = currentPdfPage + delta;
  if (newPage < 1 || newPage > currentPdfDoc.numPages) return;
  currentPdfPage = newPage;
  renderPdfPage(currentPdfPage);
}

/**
 * 綁定翻頁按鈕事件(在 DOMContentLoaded 後呼叫)。
 */
export function bindPdfNavButtons() {
  const prev = document.getElementById('pdf-prev');
  const next = document.getElementById('pdf-next');
  if (prev) prev.addEventListener('click', () => pdfNavigate(-1));
  if (next) next.addEventListener('click', () => pdfNavigate(1));

  // 邊界標註切換:點擊切換 .annotated,只動 CSS class 不重渲染 PDF(瞬間反應)。
  // 顏色語意說明改用 MD3 Tooltip(純 CSS hover,不需 JS)。
  const annoBtn = document.getElementById('pdf-annotate-toggle');
  if (annoBtn) annoBtn.addEventListener('click', () => {
    const { a4Frame } = _els();
    if (!a4Frame) return;
    const on = a4Frame.classList.toggle('annotated');
    annoBtn.classList.toggle('active', on);
  });
}
