/**
 * 後台 PDF 預覽 Modal 模組(admin.html 用)
 * 含 LRU 快取(限 8 個)與防競態 token。
 */

import { findOrder } from './orders.js';

const API_BASE = '';
const ADMIN_PDF_CACHE_LIMIT = 8;

let adminPdfDoc = null;
let adminPdfPage = 1;
let adminPdfRenderTask = null;
let currentPreviewOrderId = null;
const adminPdfCache = new Map();
let adminPdfLoadToken = 0;

const adminPdfCanvas = document.getElementById('admin-pdf-canvas');
const adminPdfCtx = adminPdfCanvas ? adminPdfCanvas.getContext('2d') : null;

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
}

async function renderAdminPdfPage(num) {
  if (!adminPdfDoc) return;
  if (adminPdfRenderTask) return;
  try {
    const page = await adminPdfDoc.getPage(num);
    const containerWidth = document.querySelector('.modal-pdf-wrap')?.clientWidth || 600;
    const unscaledViewport = page.getViewport({ scale: 1.0 });
    const scale = Math.min(containerWidth / unscaledViewport.width, 1.0);
    const viewport = page.getViewport({ scale });
    adminPdfCanvas.height = viewport.height;
    adminPdfCanvas.width = viewport.width;
    adminPdfCanvas.style.width = '100%';
    adminPdfCanvas.style.maxWidth = `${unscaledViewport.width}px`;
    adminPdfRenderTask = page.render({ canvasContext: adminPdfCtx, viewport });
    await adminPdfRenderTask.promise;
    adminPdfRenderTask = null;
    document.getElementById('admin-pdf-num').textContent = num;
  } catch (e) {
    console.error('PDF render error:', e);
    adminPdfRenderTask = null;
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

  if (adminPdfCtx) adminPdfCtx.clearRect(0, 0, adminPdfCanvas.width, adminPdfCanvas.height);
  adminPdfDoc = null;

  const cached = adminPdfCache.get(orderId);
  if (cached) {
    adminPdfDoc = cached;
    document.getElementById('admin-pdf-count').textContent = cached.numPages;
    adminPdfPage = 1;
    renderAdminPdfPage(adminPdfPage);
    document.getElementById('pdf-modal').classList.add('open');
    return;
  }

  try {
    showToastAdmin('正在載入 PDF 檔案...');
    const url = API_BASE + '/api/orders/' + orderId + '/file/' + encodeURIComponent(order.file_name);
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
    renderAdminPdfPage(adminPdfPage);
    document.getElementById('pdf-modal').classList.add('open');
  } catch (err) {
    if (myToken !== adminPdfLoadToken) return;
    showToastAdmin('PDF 解析失敗:' + err.message, true);
  }
}

export function closePdfModal() {
  document.getElementById('pdf-modal').classList.remove('open');
  if (adminPdfCtx) adminPdfCtx.clearRect(0, 0, adminPdfCanvas.width, adminPdfCanvas.height);
  adminPdfDoc = null;
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
