/**
 * 前台 PDF 預覽整合層。
 *
 * 保留既有應用程式呼叫名稱，內部統一轉交 PdfPreviewController。
 */

import { pdfEngine } from './pdf-engine.js';
import { PdfPreviewController } from './pdf-preview-controller.js';

let controller = null;

function els() {
  return {
    container: document.getElementById('pdf-preview-container'),
    placeholder: document.getElementById('pdf-placeholder'),
    meta: document.getElementById('preview-meta'),
    name: document.getElementById('meta-name'),
    size: document.getElementById('meta-size'),
    download: document.querySelector('#pdf-preview-container [data-pdf-download]'),
  };
}

function ensureController() {
  if (controller) return controller;
  const root = document.getElementById('pdf-preview-container');
  if (!root) return null;
  controller = new PdfPreviewController(root, {
    fullscreenDialog: document.getElementById('pdf-fullscreen-dialog'),
  });
  return controller;
}

function showShell(fileName, sizeLabel) {
  const { container, placeholder, meta, name, size } = els();
  placeholder?.classList.add('hidden');
  container?.classList.remove('hidden');
  meta?.classList.remove('hidden');
  if (name) name.textContent = fileName;
  if (size) size.textContent = sizeLabel;
}

function setDownloadFallback(url, fileName = 'document.pdf') {
  const { download } = els();
  if (!download) return;
  download.hidden = !url;
  download.href = url || '#';
  download.download = fileName;
}

export async function showPreview(fileObj) {
  const preview = ensureController();
  if (!preview || !fileObj?.file) return null;
  const file = fileObj.file;
  showShell(file.name, `${Math.round(file.size / 1024)} KB`);
  setDownloadFallback(null);
  const session = await preview.open(
    { kind: 'file', file, cacheKey: file },
    {
      fileName: file.name,
      printMode: fileObj.fitMode || 'fit',
      page: 1,
    },
  );
  if (session) fileObj.pages = session.numPages;
  return session;
}

export async function inspectPdfFile(file) {
  return pdfEngine.inspect({ kind: 'file', file, cacheKey: file });
}

export async function releasePdfFile(file) {
  if (!file) return;
  await pdfEngine.evict({ kind: 'file', file, cacheKey: file });
}

export function resetPreview() {
  const { container, placeholder, meta } = els();
  ensureController()?.reset();
  placeholder?.classList.remove('hidden');
  container?.classList.add('hidden');
  meta?.classList.add('hidden');
  setDownloadFallback(null);
}

export function setFitMode(mode, silent = false) {
  const preview = ensureController();
  if (!preview) return;
  preview.printMode = mode === 'cover' ? 'cover' : 'fit';
  preview.els.frame.classList.toggle('cover', preview.printMode === 'cover');
  if (!silent && preview.session) void preview.setPrintMode(preview.printMode);
}

export function rerenderCurrent() {
  const preview = ensureController();
  if (preview?.session) void preview.setZoom(preview.zoom);
}

export async function previewPastOrder(orderId, fileName, searchName, fitMode) {
  const preview = ensureController();
  if (!preview) return;
  const url = `/api/orders/${orderId}/preview/${encodeURIComponent(fileName)}` +
    `?user_name=${encodeURIComponent(searchName)}`;
  showShell(fileName, `歷史訂單 #${orderId}`);
  setDownloadFallback(url, fileName);
  await preview.open(
    { kind: 'url', url, cacheKey: `history:${orderId}:${searchName}` },
    {
      fileName,
      printMode: fitMode || 'fit',
      page: 1,
    },
  );
}

export function pdfNavigate(delta) {
  const preview = ensureController();
  if (preview?.session) void preview.goToPage(preview.currentPage + delta);
}

export function bindPdfNavButtons() {
  ensureController();
}

window.addEventListener('beforeunload', () => {
  void pdfEngine.destroy();
});
