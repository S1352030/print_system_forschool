/**
 * 後台 PDF 預覽整合。
 *
 * PDF 載入、單頁渲染、Range、鍵盤與手勢皆由共用
 * PdfPreviewController 處理；本模組只負責訂單資料與 dialog。
 */

import { findOrder, buildSettingBadges } from './orders.js';
import { PdfPreviewController } from '../pdf-preview-controller.js';

let controller = null;
let currentPreviewOrderId = null;
let currentOrder = null;

function dialog() {
  return document.getElementById('pdf-modal');
}

function ensureController() {
  if (controller) return controller;
  const root = document.getElementById('admin-pdf-preview');
  if (!root) return null;
  controller = new PdfPreviewController(root);
  return controller;
}

function syncFitButtons(mode) {
  const fit = document.getElementById('admin-fit-btn');
  const cover = document.getElementById('admin-cover-btn');
  const isFit = mode !== 'cover';
  fit?.classList.toggle('active', isFit);
  cover?.classList.toggle('active', !isFit);
  fit?.setAttribute('aria-pressed', String(isFit));
  cover?.setAttribute('aria-pressed', String(!isFit));
}

export function bindAdminPdfNavButtons() {
  ensureController();
}

export function bindAdminFitToggle() {
  const preview = ensureController();
  document.querySelector('[data-admin-pdf-close]')?.addEventListener('click', closePdfModal);
  document.querySelector('[data-admin-pdf-download]')?.addEventListener(
    'click',
    () => void downloadCurrentPdf(),
  );
  document.getElementById('admin-fit-btn')?.addEventListener('click', () => {
    syncFitButtons('fit');
    void preview?.setPrintMode('fit');
  });
  document.getElementById('admin-cover-btn')?.addEventListener('click', () => {
    syncFitButtons('cover');
    void preview?.setPrintMode('cover');
  });

  const modal = dialog();
  modal?.addEventListener('cancel', (event) => {
    event.preventDefault();
    closePdfModal();
  });
  modal?.addEventListener('click', (event) => {
    if (event.target === modal) closePdfModal();
  });
}

export async function openPdfModal(orderId) {
  const order = findOrder(orderId);
  const preview = ensureController();
  const modal = dialog();
  if (!order || !preview || !modal) return;

  currentPreviewOrderId = orderId;
  currentOrder = order;
  document.getElementById('modal-title').textContent = order.file_name;
  document.getElementById('modal-meta').textContent =
    `訂單 #${order.id}　姓名：${order.user_name}　頁數：${order.total_pages} 頁`;
  document.getElementById('modal-settings').innerHTML = buildSettingBadges(order);

  const url = `/api/orders/${orderId}/file/${encodeURIComponent(order.file_name)}`;
  const download = document.querySelector('#admin-pdf-preview [data-pdf-download]');
  if (download) {
    download.href = url;
    download.download = order.file_name;
    download.hidden = false;
  }
  const downloadButton = document.getElementById('btn-download-pdf');
  if (downloadButton) downloadButton.hidden = false;

  syncFitButtons(order.fit_mode || 'fit');
  if (!modal.open) modal.showModal();
  await preview.open(
    { kind: 'url', url, cacheKey: `admin:${orderId}` },
    {
      fileName: order.file_name,
      printMode: order.fit_mode || 'fit',
      page: 1,
    },
  );
}

export function closePdfModal() {
  controller?.reset();
  currentPreviewOrderId = null;
  currentOrder = null;
  const downloadButton = document.getElementById('btn-download-pdf');
  if (downloadButton) downloadButton.hidden = true;
  const modal = dialog();
  if (modal?.open) modal.close();
}

export function closeModal(event) {
  if (event?.target === dialog()) closePdfModal();
}

export async function downloadCurrentPdf() {
  if (!currentPreviewOrderId || !currentOrder) return;
  const url = `/api/orders/${currentPreviewOrderId}/file/` +
    encodeURIComponent(currentOrder.file_name);
  try {
    showToastAdmin('準備下載 PDF…');
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = blobUrl;
    anchor.download = currentOrder.file_name;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(blobUrl);
    showToastAdmin('下載成功');
  } catch (error) {
    showToastAdmin(`下載失敗：${error.message}`, true);
  }
}

function showToastAdmin(message, isError = false) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast-msg${isError ? ' error' : ''}`;
  toast.setAttribute('role', isError ? 'alert' : 'status');
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}
