/**
 * PDF 預覽底層引擎。
 *
 * - 延遲載入自架的 PDF.js 5.7.284 ESM build。
 * - modern build 無法載入時自動退回同版本 legacy build。
 * - 所有新文件依序開啟，並共用一個 PDF worker。
 * - 手機快取 1 份文件、桌面快取 2 份；淘汰時完整釋放文件資源。
 */

export const PDFJS_VERSION = '5.7.284';
export const PDFJS_BASE = `/static/pdfjs/${PDFJS_VERSION}`;

const MODERN_MODULE = `${PDFJS_BASE}/build/pdf.min.mjs`;
const MODERN_WORKER = `${PDFJS_BASE}/build/pdf.worker.min.mjs`;
const LEGACY_MODULE = `${PDFJS_BASE}/legacy/build/pdf.min.mjs`;
const LEGACY_WORKER = `${PDFJS_BASE}/legacy/build/pdf.worker.min.mjs`;

export class PdfPreviewError extends Error {
  constructor(code, message, cause = null) {
    super(message, cause ? { cause } : undefined);
    this.name = 'PdfPreviewError';
    this.code = code;
  }
}

class PdfDocumentSession {
  constructor({ key, source, loadingTask, pdf }) {
    this.key = key;
    this.source = source;
    this.loadingTask = loadingTask;
    this.pdf = pdf;
    this.numPages = pdf.numPages;
    this.closed = false;
    this.lastUsedAt = performance.now();
  }

  touch() {
    this.lastUsedAt = performance.now();
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    try {
      await this.loadingTask.destroy();
    } catch (error) {
      // AbortException during teardown is expected and must not block cleanup.
      if (error?.name !== 'AbortException') {
        console.warn('[PDF] document cleanup failed', error);
      }
    }
  }
}

function sourceKey(source) {
  if (source?.cacheKey !== undefined) return source.cacheKey;
  if (source?.kind === 'file' && source.file instanceof File) return source.file;
  if (source?.kind === 'url' && source.url) return source.url;
  throw new PdfPreviewError('invalid-source', '無法辨識 PDF 來源。');
}

function normalizeSource(source) {
  if (source instanceof File) {
    return { kind: 'file', file: source, fileName: source.name };
  }
  if (typeof source === 'string') {
    return { kind: 'url', url: source };
  }
  if (source?.kind === 'file' && source.file instanceof File) return source;
  if (source?.kind === 'url' && typeof source.url === 'string') return source;
  throw new PdfPreviewError('invalid-source', '無法辨識 PDF 來源。');
}

function isCoarsePointer() {
  return Boolean(window.matchMedia?.('(pointer: coarse)').matches);
}

class PdfEngine {
  constructor() {
    this._pdfjsPromise = null;
    this._workerUrl = null;
    this._worker = null;
    this._loadQueue = Promise.resolve();
    this._cache = new Map();
    this._pinned = new Set();
    this._cacheLimit = isCoarsePointer() ? 1 : 2;
  }

  async _loadPdfjs() {
    if (this._pdfjsPromise) return this._pdfjsPromise;

    this._pdfjsPromise = (async () => {
      let pdfjs;
      try {
        pdfjs = await import(MODERN_MODULE);
        this._workerUrl = MODERN_WORKER;
      } catch (modernError) {
        console.info('[PDF] modern build unavailable; using legacy build', modernError);
        try {
          pdfjs = await import(LEGACY_MODULE);
          this._workerUrl = LEGACY_WORKER;
        } catch (legacyError) {
          throw new PdfPreviewError(
            'unsupported-browser',
            '此瀏覽器無法啟動 PDF 預覽，請更新瀏覽器或下載原始 PDF。',
            legacyError,
          );
        }
      }

      if (pdfjs.version !== PDFJS_VERSION) {
        throw new PdfPreviewError(
          'version-mismatch',
          `PDF 預覽元件版本不一致（API ${pdfjs.version} / Worker ${PDFJS_VERSION}）。`,
        );
      }
      pdfjs.GlobalWorkerOptions.workerSrc = this._workerUrl;
      this._worker = new pdfjs.PDFWorker({ name: 'print-system-pdf-worker' });
      await this._worker.promise;
      return pdfjs;
    })();

    try {
      return await this._pdfjsPromise;
    } catch (error) {
      this._pdfjsPromise = null;
      throw error;
    }
  }

  _serialize(task) {
    const run = this._loadQueue.then(task, task);
    this._loadQueue = run.catch(() => undefined);
    return run;
  }

  async _createSession(source, key, onProgress) {
    const pdfjs = await this._loadPdfjs();
    const params = {
      cMapUrl: `${PDFJS_BASE}/cmaps/`,
      cMapPacked: true,
      standardFontDataUrl: `${PDFJS_BASE}/standard_fonts/`,
      wasmUrl: `${PDFJS_BASE}/wasm/`,
      iccUrl: `${PDFJS_BASE}/iccs/`,
      isEvalSupported: false,
      enableXfa: false,
      rangeChunkSize: 64 * 1024,
      worker: this._worker,
    };

    if (source.kind === 'file') {
      params.data = new Uint8Array(await source.file.arrayBuffer());
    } else {
      params.url = source.url;
      // 遠端訂單只按需抓取目前頁面所需區段，避免背景自動下載整份 PDF。
      params.disableStream = true;
      params.disableAutoFetch = true;
      if (source.httpHeaders) params.httpHeaders = source.httpHeaders;
      if (source.withCredentials) params.withCredentials = true;
    }

    const loadingTask = pdfjs.getDocument(params);
    let passwordRequired = false;
    loadingTask.onProgress = ({ loaded, total }) => {
      onProgress?.({ loaded, total: Number.isFinite(total) ? total : 0 });
    };
    loadingTask.onPassword = () => {
      passwordRequired = true;
      void loadingTask.destroy();
    };

    try {
      const pdf = await loadingTask.promise;
      if (!Number.isInteger(pdf.numPages) || pdf.numPages < 1) {
        await loadingTask.destroy();
        throw new PdfPreviewError('empty-document', 'PDF 沒有可預覽的頁面。');
      }
      return new PdfDocumentSession({ key, source, loadingTask, pdf });
    } catch (error) {
      if (passwordRequired || error?.name === 'PasswordException') {
        throw new PdfPreviewError('password', '不支援加密或需要密碼的 PDF。', error);
      }
      if (error instanceof PdfPreviewError) throw error;
      if (error?.name === 'InvalidPDFException' || error?.name === 'FormatError') {
        throw new PdfPreviewError('invalid-pdf', 'PDF 已損壞或格式不受支援。', error);
      }
      if (error?.name === 'MissingPDFException') {
        throw new PdfPreviewError('missing-pdf', '找不到 PDF 檔案。', error);
      }
      if (error?.name === 'AbortException') {
        throw new PdfPreviewError('aborted', 'PDF 載入已取消。', error);
      }
      throw new PdfPreviewError('load-failed', `PDF 載入失敗：${error?.message || error}`, error);
    }
  }

  async open(rawSource, { onProgress, pin = true } = {}) {
    const source = normalizeSource(rawSource);
    const key = sourceKey(source);
    const cached = this._cache.get(key);
    if (cached && !cached.closed) {
      cached.touch();
      this._cache.delete(key);
      this._cache.set(key, cached);
      if (pin) this._pinned.add(key);
      return cached;
    }

    return this._serialize(async () => {
      const queuedCached = this._cache.get(key);
      if (queuedCached && !queuedCached.closed) {
        queuedCached.touch();
        if (pin) this._pinned.add(key);
        return queuedCached;
      }

      const session = await this._createSession(source, key, onProgress);
      this._cache.set(key, session);
      if (pin) this._pinned.add(key);
      await this._trimCache();
      return session;
    });
  }

  async inspect(rawSource, { onProgress } = {}) {
    const source = normalizeSource(rawSource);
    const key = sourceKey(source);
    const cached = this._cache.get(key);
    if (cached && !cached.closed) {
      cached.touch();
      return cached.numPages;
    }

    return this._serialize(async () => {
      const queuedCached = this._cache.get(key);
      if (queuedCached && !queuedCached.closed) {
        queuedCached.touch();
        return queuedCached.numPages;
      }
      const session = await this._createSession(source, key, onProgress);
      try {
        return session.numPages;
      } finally {
        await session.close();
      }
    });
  }

  unpin(rawSourceOrKey) {
    let key = rawSourceOrKey;
    if (
      rawSourceOrKey instanceof File ||
      typeof rawSourceOrKey === 'string' ||
      rawSourceOrKey?.kind
    ) {
      key = sourceKey(normalizeSource(rawSourceOrKey));
    }
    this._pinned.delete(key);
    void this._trimCache();
  }

  async evict(rawSourceOrKey) {
    let key = rawSourceOrKey;
    if (
      rawSourceOrKey instanceof File ||
      typeof rawSourceOrKey === 'string' ||
      rawSourceOrKey?.kind
    ) {
      key = sourceKey(normalizeSource(rawSourceOrKey));
    }
    this._pinned.delete(key);
    const session = this._cache.get(key);
    this._cache.delete(key);
    await session?.close();
  }

  async _trimCache() {
    while (this._cache.size > this._cacheLimit) {
      const candidate = [...this._cache.entries()]
        .find(([key]) => !this._pinned.has(key));
      if (!candidate) return;
      const [key, session] = candidate;
      this._cache.delete(key);
      await session.close();
    }
  }

  async destroy() {
    this._pinned.clear();
    const sessions = [...this._cache.values()];
    this._cache.clear();
    await Promise.allSettled(sessions.map((session) => session.close()));
    await this._worker?.destroy();
    this._worker = null;
    this._pdfjsPromise = null;
  }
}

export const pdfEngine = new PdfEngine();
