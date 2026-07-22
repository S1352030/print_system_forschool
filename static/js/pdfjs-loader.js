/**
 * PDF.js 延遲載入器
 *
 * 將 PDF.js 主程式的載入從「首頁同步 <script>」改為「首次預覽時才動態載入」,
 * 避免首屏被 515KB 的 pdf.js 阻塞。PDF.js 只在使用者實際預覽 PDF 時才需要。
 *
 * 使用方式(在呼叫 pdfjsLib.getDocument() 之前):
 *   import { ensurePdfjs } from './pdfjs-loader.js';
 *   await ensurePdfjs();
 *
 * Worker 路徑防護:載入完成、resolve 之前,會明確設定 worker 的絕對路徑,
 * 避免動態注入 <script> 後 PDF.js 找不到 worker 而轉圈卡死。
 */

// PDF.js 主程式與 worker 的絕對路徑(版本固定,走預壓縮 + immutable 快取)
const PDFJS_MAIN = '/static/pdfjs/build/pdf.js';
const PDFJS_WORKER = '/static/pdfjs/build/pdf.worker.js';

// 快取已載入的 Promise,確保只注入一次 <script>
let _loadPromise = null;

/**
 * 確保 PDF.js 已載入並完成 worker 路徑設定。
 * @returns {Promise<void>} 載入完成後 resolve;若已載入則立即 resolve。
 */
export function ensurePdfjs() {
  if (window.pdfjsLib) {
    // 已載入(含舊版同步載入的相容情境)
    if (!window.pdfjsLib.GlobalWorkerOptions.workerSrc) {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
    }
    return Promise.resolve();
  }

  if (_loadPromise) return _loadPromise;

  _loadPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = PDFJS_MAIN;
    script.async = true;
    script.onload = () => {
      if (!window.pdfjsLib) {
        _loadPromise = null; // 允許重試
        reject(new Error('PDF.js 載入後找不到 window.pdfjsLib'));
        return;
      }
      // Worker 路徑防護:明確設定絕對路徑,避免動態載入後相對路徑迷航
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
      resolve();
    };
    script.onerror = () => {
      _loadPromise = null; // 允許重試
      reject(new Error('PDF.js 主程式載入失敗:' + PDFJS_MAIN));
    };
    document.head.appendChild(script);
  });

  return _loadPromise;
}
