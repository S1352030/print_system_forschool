/**
 * 共用的手機優先 PDF 單頁預覽控制器。
 *
 * DOM 透過 data-pdf-* hooks 綁定，因此前台、歷史訂單與後台使用同一套
 * 渲染、手勢、鍵盤、錯誤處理及 A4 列印結果模擬。
 */

import { pdfEngine, PdfPreviewError } from './pdf-engine.js';
import {
  detectPaper,
  computeA4Fit,
  computeA4Cover,
  a4LabelMm,
} from './pdf-paper.js';

const MAX_CANVAS_PIXELS = 4_000_000;
const MAX_DPR = 2;
const SWIPE_THRESHOLD_PX = 48;
const VALID_ZOOMS = new Set(['fit', 1.25, 1.5, 2]);

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function formatLoadError(error) {
  if (error instanceof PdfPreviewError) return error.message;
  if (error?.name === 'RenderingCancelledException') return '';
  return `PDF 預覽失敗：${error?.message || error}`;
}

function isMemoryError(error) {
  const message = String(error?.message || error || '').toLowerCase();
  return error instanceof RangeError ||
    message.includes('memory') ||
    message.includes('canvas area') ||
    message.includes('allocation');
}

export class PdfPreviewController {
  constructor(root, {
    fullscreenDialog = null,
    onDocument = null,
    onError = null,
  } = {}) {
    if (!root) throw new Error('PdfPreviewController requires a root element');
    this.root = root;
    this.fullscreenDialog = fullscreenDialog;
    this.onDocument = onDocument;
    this.onError = onError;
    this.session = null;
    this.sessionKey = null;
    this.currentPage = 1;
    this.printMode = 'fit';
    this.zoom = 'fit';
    this.renderTask = null;
    this.pageProxy = null;
    this.openToken = 0;
    this.renderToken = 0;
    this.lastRequest = null;
    this.pointerStart = null;
    this.restoreMarker = null;
    this.fullscreenTrigger = null;
    this.resizeTimer = null;

    this.els = {
      viewport: root.querySelector('[data-pdf-viewport]'),
      frame: root.querySelector('[data-pdf-frame]'),
      canvas: root.querySelector('[data-pdf-canvas]'),
      docOutline: root.querySelector('[data-pdf-doc-outline]'),
      docLabel: root.querySelector('[data-pdf-doc-label]'),
      a4Label: root.querySelector('[data-pdf-a4-label]'),
      paper: root.querySelector('[data-pdf-paper]'),
      status: root.querySelector('[data-pdf-status]'),
      progress: root.querySelector('[data-pdf-progress]'),
      error: root.querySelector('[data-pdf-error]'),
      errorMessage: root.querySelector('[data-pdf-error-message]'),
      retry: root.querySelector('[data-pdf-retry]'),
      prev: root.querySelector('[data-pdf-prev]'),
      next: root.querySelector('[data-pdf-next]'),
      pageInput: root.querySelector('[data-pdf-page]'),
      pageCount: root.querySelector('[data-pdf-count]'),
      zoom: root.querySelector('[data-pdf-zoom]'),
      boundary: root.querySelector('[data-pdf-boundary]'),
      fullscreen: root.querySelector('[data-pdf-fullscreen]'),
    };

    if (!this.els.viewport || !this.els.frame || !this.els.canvas) {
      throw new Error('PDF preview markup is missing viewport/frame/canvas hooks');
    }

    this._bindEvents();
    this._bindResize();
    this._updateControls();
  }

  _bindEvents() {
    this.els.prev?.addEventListener('click', () => void this.goToPage(this.currentPage - 1));
    this.els.next?.addEventListener('click', () => void this.goToPage(this.currentPage + 1));
    this.els.retry?.addEventListener('click', () => {
      if (this.lastRequest) void this.open(this.lastRequest.source, this.lastRequest.options);
    });
    this.els.pageInput?.addEventListener('change', () => {
      void this.goToPage(Number.parseInt(this.els.pageInput.value, 10));
    });
    this.els.pageInput?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        this.els.pageInput.blur();
        void this.goToPage(Number.parseInt(this.els.pageInput.value, 10));
      }
    });
    this.els.zoom?.addEventListener('change', () => {
      const value = this.els.zoom.value === 'fit'
        ? 'fit'
        : Number.parseFloat(this.els.zoom.value);
      void this.setZoom(value);
    });
    this.els.boundary?.addEventListener('click', () => {
      const active = this.els.frame.classList.toggle('annotated');
      this.els.boundary.setAttribute('aria-pressed', String(active));
    });
    this.els.fullscreen?.addEventListener('click', (event) => {
      this._openFullscreen(event.currentTarget);
    });

    this.els.viewport.addEventListener('keydown', (event) => {
      if (!this.session) return;
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        void this.goToPage(this.currentPage - 1);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        void this.goToPage(this.currentPage + 1);
      } else if (event.key === 'Home') {
        event.preventDefault();
        void this.goToPage(1);
      } else if (event.key === 'End') {
        event.preventDefault();
        void this.goToPage(this.session.numPages);
      }
    });

    this.els.viewport.addEventListener('pointerdown', (event) => {
      if (this.zoom !== 'fit' || !event.isPrimary) return;
      this.pointerStart = { x: event.clientX, y: event.clientY };
    });
    this.els.viewport.addEventListener('pointerup', (event) => {
      if (!this.pointerStart || this.zoom !== 'fit' || !event.isPrimary) return;
      const dx = event.clientX - this.pointerStart.x;
      const dy = event.clientY - this.pointerStart.y;
      this.pointerStart = null;
      if (Math.abs(dx) < SWIPE_THRESHOLD_PX || Math.abs(dx) <= Math.abs(dy)) return;
      void this.goToPage(this.currentPage + (dx < 0 ? 1 : -1));
    });
    this.els.viewport.addEventListener('pointercancel', () => {
      this.pointerStart = null;
    });

    if (this.fullscreenDialog) {
      this.fullscreenDialog.addEventListener('close', () => this._restoreFromFullscreen());
      this.fullscreenDialog.addEventListener('click', (event) => {
        if (event.target === this.fullscreenDialog) this.fullscreenDialog.close();
      });
    }
  }

  _bindResize() {
    const rerender = () => {
      if (!this.session) return;
      clearTimeout(this.resizeTimer);
      this.resizeTimer = setTimeout(() => void this._renderCurrentPage(), 160);
    };
    if ('ResizeObserver' in window) {
      this.resizeObserver = new ResizeObserver(rerender);
      this.resizeObserver.observe(this.els.viewport);
    } else {
      this.windowResizeHandler = rerender;
      window.addEventListener('resize', rerender);
    }
  }

  async open(source, options = {}) {
    const token = ++this.openToken;
    this.lastRequest = { source, options: { ...options } };
    this._cancelRender();
    if (this.sessionKey !== null) pdfEngine.unpin(this.sessionKey);
    this.session = null;
    this.sessionKey = null;
    this.currentPage = 1;
    this.printMode = options.printMode === 'cover' ? 'cover' : 'fit';
    this.zoom = VALID_ZOOMS.has(options.zoom) ? options.zoom : 'fit';
    this.els.frame.classList.toggle('cover', this.printMode === 'cover');
    if (this.els.zoom) this.els.zoom.value = String(this.zoom);
    this.root.classList.remove('hidden');
    this._setLoading(true, '正在讀取 PDF…');
    this._clearError();

    try {
      const session = await pdfEngine.open(source, {
        pin: true,
        onProgress: ({ loaded, total }) => {
          if (token !== this.openToken) return;
          this._updateProgress(loaded, total);
        },
      });
      if (token !== this.openToken) {
        pdfEngine.unpin(session.key);
        return null;
      }

      this.session = session;
      this.sessionKey = session.key;
      this.currentPage = clamp(Number(options.page) || 1, 1, session.numPages);
      this._setLoading(false, '');
      this._updateControls();
      this.onDocument?.({
        numPages: session.numPages,
        source,
        session,
      });
      await this._renderCurrentPage();
      return session;
    } catch (error) {
      if (token !== this.openToken || error?.code === 'aborted') return null;
      this._showError(formatLoadError(error));
      this.onError?.(error);
      return null;
    }
  }

  async goToPage(page) {
    if (!this.session) return;
    const parsed = Number.parseInt(page, 10);
    if (!Number.isFinite(parsed)) {
      this._updateControls();
      return;
    }
    const nextPage = clamp(parsed, 1, this.session.numPages);
    if (nextPage === this.currentPage && this.pageProxy) {
      this._updateControls();
      return;
    }
    this.currentPage = nextPage;
    this._updateControls();
    await this._renderCurrentPage();
  }

  async setPrintMode(mode) {
    this.printMode = mode === 'cover' ? 'cover' : 'fit';
    this.els.frame.classList.toggle('cover', this.printMode === 'cover');
    if (this.session) await this._renderCurrentPage();
  }

  async setZoom(value) {
    const normalized = value === 'fit' ? 'fit' : Number(value);
    if (!VALID_ZOOMS.has(normalized)) return;
    this.zoom = normalized;
    if (this.els.zoom) this.els.zoom.value = String(normalized);
    this.root.classList.toggle('is-zoomed', normalized !== 'fit');
    if (this.session) await this._renderCurrentPage();
  }

  async _renderCurrentPage(forceDpr = null) {
    if (!this.session) return;
    this._cancelRender();
    const token = ++this.renderToken;
    this._setLoading(true, `正在產生第 ${this.currentPage} 頁預覽…`, false);

    try {
      this.pageProxy?.cleanup?.();
      const page = await this.session.pdf.getPage(this.currentPage);
      if (token !== this.renderToken) return;
      this.pageProxy = page;

      const unscaled = page.getViewport({ scale: 1 });
      const paper = detectPaper(unscaled.width, unscaled.height);
      this._updatePaper(paper);

      const availableWidth = Math.max(220, this.els.viewport.clientWidth - 32);
      const baseMaxWidth = paper.isLandscape ? 760 : 560;
      const zoomFactor = this.zoom === 'fit' ? 1 : this.zoom;
      const frameWidth = Math.min(availableWidth, baseMaxWidth) * zoomFactor;
      const frameHeight = frameWidth * (paper.isLandscape ? 210 / 297 : 297 / 210);
      this.els.frame.style.width = `${Math.round(frameWidth)}px`;
      this.els.frame.style.height = `${Math.round(frameHeight)}px`;

      const compute = this.printMode === 'cover' ? computeA4Cover : computeA4Fit;
      const geometry = compute(
        unscaled.width,
        unscaled.height,
        frameWidth,
        frameHeight,
      );

      let pixelRatio = forceDpr || Math.min(window.devicePixelRatio || 1, MAX_DPR);
      const requestedPixels = geometry.contentCssW * geometry.contentCssH * pixelRatio ** 2;
      if (requestedPixels > MAX_CANVAS_PIXELS) {
        pixelRatio *= Math.sqrt(MAX_CANVAS_PIXELS / requestedPixels);
      }
      pixelRatio = Math.max(0.5, pixelRatio);

      const viewport = page.getViewport({ scale: geometry.renderScale * pixelRatio });
      const canvas = this.els.canvas;
      const context = canvas.getContext('2d', { alpha: false });
      canvas.width = Math.max(1, Math.round(viewport.width));
      canvas.height = Math.max(1, Math.round(viewport.height));
      canvas.style.width = `${geometry.contentCssW}px`;
      canvas.style.height = `${geometry.contentCssH}px`;
      context.clearRect(0, 0, canvas.width, canvas.height);

      if (this.els.docOutline) {
        this.els.docOutline.style.width = `${geometry.contentCssW}px`;
        this.els.docOutline.style.height = `${geometry.contentCssH}px`;
      }
      if (this.els.docLabel) {
        this.els.docLabel.textContent =
          `原文件 ${Math.round(unscaled.width * 25.4 / 72)}×${Math.round(unscaled.height * 25.4 / 72)}mm`;
      }

      this.renderTask = page.render({ canvasContext: context, viewport });
      await this.renderTask.promise;
      if (token !== this.renderToken) return;
      this.renderTask = null;
      const fileName = this.lastRequest?.options?.fileName || 'PDF';
      canvas.setAttribute(
        'aria-label',
        `${fileName}，第 ${this.currentPage} 頁，共 ${this.session.numPages} 頁`,
      );
      this._setLoading(false, `已顯示第 ${this.currentPage} 頁`);
      this._updateControls();
    } catch (error) {
      this.renderTask = null;
      if (error?.name === 'RenderingCancelledException' || token !== this.renderToken) return;
      if (forceDpr === null && isMemoryError(error)) {
        await this._renderCurrentPage(1);
        return;
      }
      this._showError(formatLoadError(error));
      this.onError?.(error);
    }
  }

  _cancelRender() {
    this.renderToken++;
    if (this.renderTask) {
      try {
        this.renderTask.cancel();
      } catch {
        // Cancellation is best-effort.
      }
      this.renderTask = null;
    }
  }

  _updatePaper(info) {
    this.els.frame.classList.toggle('landscape', info.isLandscape);
    if (this.els.a4Label) this.els.a4Label.textContent = a4LabelMm(info.isLandscape);
    if (!this.els.paper) return;
    this.els.paper.classList.toggle('paper-ok', info.isA4);
    this.els.paper.classList.toggle('paper-warn', !info.isA4);
    const orientation = info.isLandscape ? '橫向' : '直向';
    this.els.paper.textContent = info.isA4
      ? `A4 ${orientation}`
      : `${info.name} ${info.wMm}×${info.hMm}mm · 將以 A4 縮放列印`;
  }

  _updateControls() {
    const pageCount = this.session?.numPages || 1;
    if (this.els.pageInput) {
      this.els.pageInput.value = String(this.currentPage);
      this.els.pageInput.max = String(pageCount);
      this.els.pageInput.disabled = !this.session;
    }
    if (this.els.pageCount) this.els.pageCount.textContent = String(pageCount);
    if (this.els.prev) this.els.prev.disabled = !this.session || this.currentPage <= 1;
    if (this.els.next) {
      this.els.next.disabled = !this.session || this.currentPage >= pageCount;
    }
  }

  _updateProgress(loaded, total) {
    if (!this.els.progress) return;
    this.els.progress.hidden = false;
    if (total > 0) {
      this.els.progress.max = total;
      this.els.progress.value = loaded;
    } else {
      this.els.progress.removeAttribute('value');
    }
  }

  _setLoading(active, message, announce = true) {
    this.root.classList.toggle('is-loading', active);
    if (this.els.progress) {
      this.els.progress.hidden = !active;
      if (!active) this.els.progress.removeAttribute('value');
    }
    if (announce && this.els.status) this.els.status.textContent = message;
  }

  _showError(message) {
    this._setLoading(false, '');
    if (this.els.error) this.els.error.hidden = false;
    if (this.els.errorMessage) this.els.errorMessage.textContent = message;
    if (this.els.status) this.els.status.textContent = message;
    this.root.classList.add('has-error');
  }

  _clearError() {
    if (this.els.error) this.els.error.hidden = true;
    if (this.els.errorMessage) this.els.errorMessage.textContent = '';
    this.root.classList.remove('has-error');
  }

  _openFullscreen(trigger) {
    if (!this.fullscreenDialog || typeof this.fullscreenDialog.showModal !== 'function') return;
    const mount = this.fullscreenDialog.querySelector('[data-pdf-fullscreen-mount]');
    if (!mount || this.fullscreenDialog.open) return;
    this.fullscreenTrigger = trigger;
    this.restoreMarker = document.createComment('pdf-preview-restore');
    this.root.before(this.restoreMarker);
    mount.append(this.root);
    this.root.classList.add('is-fullscreen');
    this.fullscreenDialog.showModal();
    requestAnimationFrame(() => void this._renderCurrentPage());
  }

  _restoreFromFullscreen() {
    if (!this.restoreMarker?.parentNode) return;
    this.restoreMarker.parentNode.insertBefore(this.root, this.restoreMarker);
    this.restoreMarker.remove();
    this.restoreMarker = null;
    this.root.classList.remove('is-fullscreen');
    const trigger = this.fullscreenTrigger;
    this.fullscreenTrigger = null;
    requestAnimationFrame(() => {
      void this._renderCurrentPage();
      trigger?.focus();
    });
  }

  reset() {
    this.openToken++;
    this._cancelRender();
    if (this.sessionKey !== null) pdfEngine.unpin(this.sessionKey);
    this.session = null;
    this.sessionKey = null;
    this.pageProxy?.cleanup?.();
    this.pageProxy = null;
    this.currentPage = 1;
    this.printMode = 'fit';
    this.zoom = 'fit';
    this.lastRequest = null;
    this.els.canvas.width = 1;
    this.els.canvas.height = 1;
    this.els.canvas.removeAttribute('style');
    this.els.frame.removeAttribute('style');
    this.els.frame.classList.remove('landscape', 'cover', 'annotated');
    this.root.classList.remove('is-loading', 'has-error', 'is-zoomed');
    if (this.els.boundary) this.els.boundary.setAttribute('aria-pressed', 'false');
    if (this.els.paper) {
      this.els.paper.classList.remove('paper-ok', 'paper-warn');
      this.els.paper.textContent = '—';
    }
    this._clearError();
    this._setLoading(false, '');
    this._updateControls();
  }

  async destroy() {
    this.reset();
    this.resizeObserver?.disconnect();
    if (this.windowResizeHandler) {
      window.removeEventListener('resize', this.windowResizeHandler);
    }
    clearTimeout(this.resizeTimer);
  }
}
