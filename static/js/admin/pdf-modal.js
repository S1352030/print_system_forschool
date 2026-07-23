/**
 * 後台 PDF 預覽 Modal 模組(admin.html 用)
 * 含 LRU 快取(限 8 個)與防競態 token。
 *
 * 預覽框固定為 A4 比例(直向 210×297 / 橫向 297×210),PDF 內容以
 * 「符合頁面(fit-to-page)」等比縮放、置中、留白,精確反映 A4 列印結果。
 * 非 A4 檔案顯示尺寸標籤與警告。逐頁重新偵測(支援多尺寸混合 PDF)。
 */

import { findOrder } from './orders.js';
import { ensurePdfjs } from '../pdfjs-loader.js';
import { detectPaper, computeA4Fit, computeA4Cover, safeDpr, a4LabelMm } from '../pdf-paper.js';

const API_BASE = '';
const ADMIN_PDF_CACHE_LIMIT = 8;

let adminPdfDoc = null;
let adminPdfPage = 1;
let adminPdfRenderTask = null;
let currentPreviewOrderId = null;
const adminPdfCache = new Map();
let adminPdfLoadToken = 0;
// 文件處理模式:預設從訂單 fit_mode 帶入;管理員可用 modal 切換按鈕預覽兩種效果。
let adminFitMode = 'fit';

// DOM 引用改為 lazy 取得,避免模組載入時 DOM 尚未就緒
function _els() {
  const canvas = document.getElementById('admin-pdf-canvas');
  return {
    canvas,
    ctx: canvas ? canvas.getContext('2d') : null,
    a4Frame: document.getElementById('admin-pdf-a4-frame'),
    docOutline: document.getElementById('admin-pdf-doc-outline'),
    docLabel: document.getElementById('admin-pdf-doc-label'),
    a4Label: document.getElementById('admin-pdf-a4-label'),
    paperBadge: document.getElementById('admin-pdf-paper'),
  };
}

export function bindAdminPdfNavButtons() {
  const prev = document.getElementById('admin-pdf-prev');
  const next = document.getElementById('admin-pdf-next');
  if (prev) prev.addEventListener('click', () => {
    if (adminPdfPage <= 1) return;
    adminPdfPage--;
    renderAdminPdfPage(adminPdfPage);
  });
  if (next) next.addEventListener('click', () => {
    if (!adminPdfDoc || adminPdfPage >= adminPdfDoc.numPages) return;
    adminPdfPage++;
    renderAdminPdfPage(adminPdfPage);
  });

  // 邊界標註切換(與前台同邏輯;顏色語意用 MD3 Tooltip 純 CSS hover)
  const annoBtn = document.getElementById('admin-pdf-annotate-toggle');
  if (annoBtn) annoBtn.addEventListener('click', () => {
    const { a4Frame } = _els();
    if (!a4Frame) return;
    const on = a4Frame.classList.toggle('annotated');
    annoBtn.classList.toggle('active', on);
  });
}

/**
 * 設定後台預覽的文件處理模式並更新切換按鈕 UI。
 * @param {string} mode - 'fit' 或 'cover'
 * @param {boolean} [silent=false] - true 時不重繪(用於開啟 modal 時帶入訂單設定)
 */
function setAdminFitMode(mode, silent = false) {
  adminFitMode = mode === 'cover' ? 'cover' : 'fit';
  const { a4Frame } = _els();
  if (a4Frame) a4Frame.classList.toggle('cover', adminFitMode === 'cover');
  // 同步切換按鈕的 active 態
  const fitBtn = document.getElementById('admin-fit-btn');
  const coverBtn = document.getElementById('admin-cover-btn');
  if (fitBtn) fitBtn.classList.toggle('active', adminFitMode === 'fit');
  if (coverBtn) coverBtn.classList.toggle('active', adminFitMode === 'cover');
  if (!silent && adminPdfDoc) renderAdminPdfPage(adminPdfPage);
}

/**
 * 綁定 modal 的 fit/cover 切換按鈕(讓管理員預覽兩種效果)。
 */
export function bindAdminFitToggle() {
  const fitBtn = document.getElementById('admin-fit-btn');
  const coverBtn = document.getElementById('admin-cover-btn');
  if (fitBtn) fitBtn.addEventListener('click', () => setAdminFitMode('fit'));
  if (coverBtn) coverBtn.addEventListener('click', () => setAdminFitMode('cover'));
}

/**
 * 更新紙張尺寸標籤(後台 modal)。
 * A4 → 綠色 badge;非 A4 → 橘紅警告 badge +「將以 A4 縮放列印」。
 * 每頁渲染後呼叫,支援多尺寸混合 PDF。
 */
async function updateAdminPaperBadge(page) {
  const { paperBadge, a4Frame } = _els();
  if (!page) return;
  try {
    const vp = page.getViewport({ scale: 1.0 });
    const info = detectPaper(vp.width, vp.height);
    if (a4Frame) a4Frame.classList.toggle('landscape', info.isLandscape);
    // A4 尺寸標籤依方向更新
    const { a4Label } = _els();
    if (a4Label) a4Label.textContent = a4LabelMm(info.isLandscape);
    if (!paperBadge) return;
    const orient = info.isLandscape ? '橫向' : '直向';
    paperBadge.classList.toggle('paper-warn', !info.isA4);
    paperBadge.classList.toggle('paper-ok', info.isA4);
    paperBadge.textContent = info.isA4
      ? 'A4 ' + orient
      : `${info.name} ${info.wMm}×${info.hMm}mm · ⚠ 將以 A4 縮放列印`;
  } catch (e) {
    console.warn('paper detect failed', e);
  }
}

async function renderAdminPdfPage(num) {
  if (!adminPdfDoc) return;
  const { canvas, ctx, a4Frame } = _els();
  if (!canvas || !ctx || !a4Frame) return;

  // 先取消進行中的渲染,讓 resize / 快速翻頁可重來
  if (adminPdfRenderTask) {
    try { await adminPdfRenderTask.cancel(); } catch (_) { /* 靜默 */ }
    adminPdfRenderTask = null;
  }

  try {
    const page = await adminPdfDoc.getPage(num);
    await updateAdminPaperBadge(page);
    const frameW = a4Frame.clientWidth || 560;
    const frameH = a4Frame.clientHeight || (frameW * 297 / 210);

    const unscaled = page.getViewport({ scale: 1.0 });
    // 依當前模式分派:fit=留白,cover=裁切(超出由 overflow:hidden 處理)
    const compute = adminFitMode === 'cover' ? computeA4Cover : computeA4Fit;
    const { contentCssW, contentCssH, renderScale } = compute(
      unscaled.width, unscaled.height, frameW, frameH
    );
    const dpr = safeDpr();
    const viewport = page.getViewport({ scale: renderScale * dpr });

    canvas.width = Math.round(contentCssW * dpr);
    canvas.height = Math.round(contentCssH * dpr);
    canvas.style.width = `${contentCssW}px`;
    canvas.style.height = `${contentCssH}px`;

    adminPdfRenderTask = page.render({ canvasContext: ctx, viewport });
    await adminPdfRenderTask.promise;
    adminPdfRenderTask = null;
    document.getElementById('admin-pdf-num').textContent = num;

    // 原文件邊界框 + 尺寸標籤
    const { docOutline, docLabel } = _els();
    if (docOutline) {
      docOutline.style.width = `${contentCssW}px`;
      docOutline.style.height = `${contentCssH}px`;
    }
    if (docLabel) {
      const wMm = Math.round(unscaled.width * 25.4 / 72);
      const hMm = Math.round(unscaled.height * 25.4 / 72);
      docLabel.textContent = `原文件 ${wMm}×${hMm}mm`;
    }
  } catch (e) {
    adminPdfRenderTask = null;
    if (e && e.name !== 'RenderingCancelledException') {
      console.error('PDF render error:', e);
    }
  }
}

function cacheAdminPdf(orderId, pdf) {
  if (adminPdfCache.size >= ADMIN_PDF_CACHE_LIMIT) {
    const oldestKey = adminPdfCache.keys().next().value;
    const oldest = adminPdfCache.get(oldestKey);
    if (oldest) oldest.destroy();
    adminPdfCache.delete(oldestKey);
  }
  adminPdfCache.set(orderId, pdf);
}

// resize 監聯:僅 modal 開啟時生效;期間靠 CSS 拉伸 canvas 避免閃爍。
let resizeTimer = null;
let resizeBound = false;
function bindResizeIfNeeded() {
  if (resizeBound) return;
  resizeBound = true;
  window.addEventListener('resize', () => {
    if (!adminPdfDoc || !currentPreviewOrderId) return;
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      renderAdminPdfPage(adminPdfPage);
    }, 200);
  });
}

export async function openPdfModal(orderId) {
  const order = findOrder(orderId);
  if (!order) return;

  currentPreviewOrderId = orderId;
  const dlBtn = document.getElementById('btn-download-pdf');
  if (dlBtn) dlBtn.style.display = 'inline-flex';

  const myToken = ++adminPdfLoadToken;
  document.getElementById('modal-title').textContent = order.file_name;
  document.getElementById('modal-meta').textContent =
    '訂單 #' + order.id + ' 姓名:' + order.user_name + ' 頁數:' + order.total_pages + ' 頁';
  document.getElementById('modal-settings').innerHTML = order.buildSettingBadges
    ? '' : ''; // buildSettingBadges 已在 orders 模組,這裡重建
  // 重新呼叫 orders 模組的 buildSettingBadges
  const { buildSettingBadges } = await import('./orders.js');
  document.getElementById('modal-settings').innerHTML = buildSettingBadges(order);

  const { canvas, ctx, a4Frame } = _els();
  if (ctx && canvas) ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (a4Frame) a4Frame.classList.remove('landscape', 'cover');
  adminPdfDoc = null;

  const cached = adminPdfCache.get(orderId);
  if (cached) {
    adminPdfDoc = cached;
    document.getElementById('admin-pdf-count').textContent = cached.numPages;
    adminPdfPage = 1;
    setAdminFitMode(order.fit_mode || 'fit', true);
    bindResizeIfNeeded();
    renderAdminPdfPage(adminPdfPage);
    document.getElementById('pdf-modal').classList.add('open');
    return;
  }

  try {
    showToastAdmin('正在載入 PDF 檔案...');
    const url = API_BASE + '/api/orders/' + orderId + '/file/' + encodeURIComponent(order.file_name);
    await ensurePdfjs();
    const pdf = await pdfjsLib.getDocument({
      url,
      cMapUrl: '/static/pdfjs/web/cmaps/',
      cMapPacked: true,
    }).promise;
    if (myToken !== adminPdfLoadToken) {
      cacheAdminPdf(orderId, pdf);
      return;
    }
    cacheAdminPdf(orderId, pdf);
    adminPdfDoc = pdf;
    document.getElementById('admin-pdf-count').textContent = pdf.numPages;
    adminPdfPage = 1;
    setAdminFitMode(order.fit_mode || 'fit', true);
    bindResizeIfNeeded();
    renderAdminPdfPage(adminPdfPage);
    document.getElementById('pdf-modal').classList.add('open');
  } catch (err) {
    if (myToken !== adminPdfLoadToken) return;
    showToastAdmin('PDF 解析失敗:' + err.message, true);
  }
}

export function closePdfModal() {
  document.getElementById('pdf-modal').classList.remove('open');
  const { canvas, ctx, a4Frame } = _els();
  if (ctx && canvas) ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (a4Frame) a4Frame.classList.remove('landscape', 'cover', 'annotated');
  const annoBtn = document.getElementById('admin-pdf-annotate-toggle');
  if (annoBtn) annoBtn.classList.remove('active');
  adminPdfDoc = null;
  adminFitMode = 'fit';
  currentPreviewOrderId = null;
  const dlBtn = document.getElementById('btn-download-pdf');
  if (dlBtn) dlBtn.style.display = 'none';
}

export function closeModal(e) {
  if (e.target.id === 'pdf-modal') closePdfModal();
}

export async function downloadCurrentPdf() {
  if (!currentPreviewOrderId) return;
  const order = findOrder(currentPreviewOrderId);
  if (!order) return;
  try {
    showToastAdmin('準備下載 PDF...');
    const url = API_BASE + '/api/orders/' + currentPreviewOrderId + '/file/' + encodeURIComponent(order.file_name);
    const res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = order.file_name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(blobUrl);
    showToastAdmin('下載成功');
  } catch (e) {
    showToastAdmin('下載失敗:' + e.message, true);
  }
}

function showToastAdmin(msg, isError = false) {
  const c = document.getElementById('toast-container');
  if (!c) return;
  const el = document.createElement('div');
  el.className = 'toast-msg' + (isError ? ' error' : '');
  el.textContent = msg;
  c.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}
