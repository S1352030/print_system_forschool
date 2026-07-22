/**
 * PDF 預覽模組(使用者端 index.html 用)
 * 負責本地檔案與歷史訂單的 PDF 預覽。
 *
 * 含有「預覽 token」防競態機制:使用者快速切換檔案時,
 * 舊的非同步載入完成後不會覆蓋目前正在看的預覽。
 */

import { showAlert } from './app.js';

let currentPdfDoc = null;
let currentPdfPage = 1;
let pdfRenderTask = null;

// DOM 引用(lazy 取得,避免模組載入時 DOM 尚未就緒)
function _els() {
  return {
    canvas: document.getElementById('pdf-canvas'),
    container: document.getElementById('pdf-preview-container'),
    placeholder: document.getElementById('pdf-placeholder'),
    meta: document.getElementById('preview-meta'),
  };
}

/**
 * 渲染指定頁碼到 canvas。
 */
async function renderPdfPage(num) {
  if (!currentPdfDoc) return;
  if (pdfRenderTask) return; // 避免重複渲染
  const { canvas, container } = _els();
  if (!canvas || !container) return;
  const ctx = canvas.getContext('2d');
  try {
    const page = await currentPdfDoc.getPage(num);
    // 動態計算縮放比例,最高限制在 1.0 以大幅提升預覽載入速度
    const containerWidth = container.clientWidth || 400;
    const unscaledViewport = page.getViewport({ scale: 1.0 });
    const scale = Math.min(containerWidth / unscaledViewport.width, 1.0);
    const viewport = page.getViewport({ scale });
    canvas.height = viewport.height;
    canvas.width = viewport.width;
    canvas.style.width = '100%';
    canvas.style.maxWidth = `${unscaledViewport.width}px`;
    pdfRenderTask = page.render({ canvasContext: ctx, viewport });
    await pdfRenderTask.promise;
    pdfRenderTask = null;
    const pageNumEl = document.getElementById('pdf-page-num');
    if (pageNumEl) pageNumEl.textContent = num;
  } catch (e) {
    console.error('PDF rendering error', e);
    pdfRenderTask = null;
  }
}

// 遞增版本號,用來判斷「使用者是否已經切到別的檔案」,
// 避免上一份還沒解析完的 PDF 在解析完成後蓋掉目前預覽(競態問題)。
let previewToken = 0;

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
  const { canvas, container, placeholder, meta } = _els();
  if (!canvas || !container || !placeholder || !meta) return;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  placeholder.classList.remove('hidden');
  container.classList.add('hidden');
  meta.classList.add('hidden');
}

/**
 * 預覽歷史訂單的 PDF(透過 API 下載)。
 */
export async function previewPastOrder(orderId, fileName, searchName) {
  const { container, placeholder, meta } = _els();
  placeholder.classList.add('hidden');
  container.classList.remove('hidden');
  meta.classList.remove('hidden');
  document.getElementById('meta-name').textContent = fileName;
  document.getElementById('meta-size').textContent = '歷史訂單 #' + orderId;

  const url = '/api/orders/' + orderId + '/preview/' + encodeURIComponent(fileName) + '?user_name=' + encodeURIComponent(searchName);

  const myToken = ++previewToken;
  try {
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
}
