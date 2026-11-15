/**
 * 後台 PDF 預覽整合。
 *
 * PDF 載入、單頁渲染、Range、鍵盤與手勢皆由共用
 * PdfPreviewController 處理；本模組只負責訂單資料與 dialog。
 * 「列印」交給 pdf-print.js 以瀏覽器內建 PDF 檢視器叫出列印對話框。
 */

import { findOrder, buildSettingBadges } from './orders.js';
import { PdfPreviewController } from '../pdf-preview-controller.js';
import { canPrintPdf, createPdfPrinter, isPrintAbort } from './pdf-print.js';

let controller = null;
let currentPreviewOrderId = null;
let currentOrder = null;
let printer = null;
let printAttempt = 0;

function dialog() {
  return document.getElementById('pdf-modal');
}

function printButton() {
  return document.getElementById('btn-print-pdf');
}

function setPrintBusy(busy) {
  const button = printButton();
  if (!button) return;
  button.disabled = busy;
  if (busy) button.setAttribute('aria-busy', 'true');
  else button.removeAttribute('aria-busy');
  const label = button.querySelector('[data-admin-pdf-print-label]');
  if (label) label.textContent = busy ? '準備列印…' : '列印';
}

/** 放棄尚未完成的列印準備，並移除暫存 iframe 與 blob URL。 */
function cancelPrint() {
  printAttempt += 1;
  printer?.cleanup();
  setPrintBusy(false);
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
  document.querySelector('[data-admin-pdf-print]')?.addEventListener(
    'click',
    () => void printCurrentPdf(),
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

  cancelPrint();
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
  const print = printButton();
  if (print) print.hidden = !canPrintPdf();

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
  cancelPrint();
  controller?.reset();
  currentPreviewOrderId = null;
  currentOrder = null;
  const downloadButton = document.getElementById('btn-download-pdf');
  if (downloadButton) downloadButton.hidden = true;
  const print = printButton();
  if (print) print.hidden = true;
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

/**
 * 以原始 PDF 叫出瀏覽器列印對話框。色彩、雙面與縮放由管理員在對話框
 * 選擇；不改變訂單付款或列印狀態。
 */
export async function printCurrentPdf() {
  if (!currentPreviewOrderId || !currentOrder) return;
  if (printButton()?.disabled) return;
  const url = `/api/orders/${currentPreviewOrderId}/file/` +
    encodeURIComponent(currentOrder.file_name);
  if (!printer) printer = createPdfPrinter();
  const attempt = ++printAttempt;
  setPrintBusy(true);
  try {
    await printer.print(url);
  } catch (error) {
    if (!isPrintAbort(error) && attempt === printAttempt) {
      showToastAdmin(`列印失敗：${error.message}，可改用「下載 PDF」`, true);
    }
  } finally {
    if (attempt === printAttempt) setPrintBusy(false);
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
