/**
 * PDF 紙張尺寸共用模組(前台 index.html 與後台 admin.html 共用)
 *
 * 用途:
 *  - detectPaper():由 PDF.js page 的原始 pt 尺寸,辨識紙張規格
 *    (A4 / A3 / A5 / Letter / Legal / 自訂尺寸)與方向(直/橫向)。
 *  - computeA4Fit():把 PDF 內容以「符合頁面(fit-to-page)」等比縮放
 *    進 A4 預覽框,不裁切、留白,精確反映 A4 列印結果。
 *
 * 設計原則:純函式、無副作用、不碰 DOM,方便兩端共用與測試。
 */

/** A4 尺寸(mm)。列印系統實際紙張永遠是 A4。 */
export const A4 = { wMm: 210, hMm: 297 };

/** 1 pt = 1/72 inch;1 inch = 25.4 mm。PDF 座標單位是 pt。 */
export const PT_TO_MM = 25.4 / 72;

/** 紙張辨識容差(mm)。PDF 軟體產生的尺寸常有微小誤差,±2mm 視為相符。 */
export const PAPER_TOLERANCE_MM = 2;

/**
 * 常見紙張尺寸表(皆為「直向」基準尺寸,寬<高)。
 * 辨識時會先將傳入尺寸正規化為直向(取 min 為寬、max 為高)再比對,
 * 並另以 isLandscape 標記原始方向。
 */
export const PAPER_TABLE = [
  { name: 'A4', wMm: 210, hMm: 297 },
  { name: 'A3', wMm: 297, hMm: 420 },
  { name: 'A5', wMm: 148, hMm: 210 },
  { name: 'Letter', wMm: 215.9, hMm: 279.4 },
  { name: 'Legal', wMm: 215.9, hMm: 355.6 },
];

/**
 * 由原始 pt 尺寸辨識紙張規格。
 *
 * @param {number} wPt - 頁面寬(pt),來自 page.getViewport({scale:1}).width
 * @param {number} hPt - 頁面高(pt)
 * @returns {{name:string, wMm:number, hMm:number, isA4:boolean, isLandscape:boolean}}
 *   name:紙張名稱(如 'A4'、'Letter');不符標準時為 '自訂尺寸'。
 *   isA4:是否為 A4(含直/橫向皆視為 A4)。
 *   isLandscape:原始方向是否為橫向(寬>高)。
 */
export function detectPaper(wPt, hPt) {
  const wMmRaw = wPt * PT_TO_MM;
  const hMmRaw = hPt * PT_TO_MM;
  const isLandscape = wMmRaw > hMmRaw;

  // 正規化為直向基準以比對尺寸表
  const wMm = Math.min(wMmRaw, hMmRaw);
  const hMm = Math.max(wMmRaw, hMmRaw);

  for (const p of PAPER_TABLE) {
    if (
      Math.abs(wMm - p.wMm) <= PAPER_TOLERANCE_MM &&
      Math.abs(hMm - p.hMm) <= PAPER_TOLERANCE_MM
    ) {
      return { name: p.name, wMm: p.wMm, hMm: p.hMm, isA4: p.name === 'A4', isLandscape };
    }
  }
  return { name: '自訂尺寸', wMm: Math.round(wMmRaw), hMm: Math.round(hMmRaw), isA4: false, isLandscape };
}

/**
 * 計算 PDF 內容 fit 進 A4 預覽框後的 CSS 顯示尺寸與渲染縮放比。
 *
 * 採「符合頁面(fit-to-page)」策略:等比縮放到完整放進框內,不裁切,
 * 比例不符時留白。留白處露出 A4 框白底,視覺上即為「白紙留白」。
 *
 * @param {number} pageWPt - PDF 原始頁寬(pt)
 * @param {number} pageHPt - PDF 原始頁高(pt)
 * @param {number} frameCssW - A4 框 CSS 寬度(px)
 * @param {number} frameCssH - A4 框 CSS 高度(px)
 * @returns {{contentCssW:number, contentCssH:number, renderScale:number}}
 *   contentCssW/H:canvas 的 CSS 顯示尺寸(px)。
 *   renderScale:餵給 PDF.js viewport 的縮放比(=fitScale,未含 DPR,
 *     DPR 由呼叫端自行乘入 viewport,以便集中控制上限)。
 */
export function computeA4Fit(pageWPt, pageHPt, frameCssW, frameCssH) {
  // fitScale:讓 PDF 原始 pt 尺寸縮放後「剛好放進」框的 CSS px 尺寸
  const fitScale = Math.min(frameCssW / pageWPt, frameCssH / pageHPt);
  return {
    contentCssW: pageWPt * fitScale,
    contentCssH: pageHPt * fitScale,
    renderScale: fitScale,
  };
}

/**
 * 「填滿頁面(cover)」策略:PDF 內容縮放到完全覆蓋 A4 框,超出邊緣被裁切。
 *
 * 與 fit 相反,這裡用 Math.max:取「能填滿較短邊」的縮放比,
 * 使內容覆蓋整個框,另一軸必然超出。canvas CSS 尺寸因此大於框,
 * 靠 A4 框的 flexbox 置中 + overflow:hidden 從中心向外四邊均等裁切。
 *
 * @param {number} pageWPt - PDF 原始頁寬(pt)
 * @param {number} pageHPt - PDF 原始頁高(pt)
 * @param {number} frameCssW - A4 框 CSS 寬度(px)
 * @param {number} frameCssH - A4 框 CSS 高度(px)
 * @returns {{contentCssW:number, contentCssH:number, renderScale:number}}
 *   contentCssW/H 通常會有一軸大於框(被裁切),另一軸等於框。
 */
export function computeA4Cover(pageWPt, pageHPt, frameCssW, frameCssH) {
  const coverScale = Math.max(frameCssW / pageWPt, frameCssH / pageHPt);
  return {
    contentCssW: pageWPt * coverScale,
    contentCssH: pageHPt * coverScale,
    renderScale: coverScale,
  };
}

/**
 * DPR(裝置像素比),含記憶體防護。
 * 上限設 2:視網膜螢幕清晰度已足夠,同時避免高 DPR(3~4)行動裝置
 * canvas 實體像素爆量導致卡頓或崩潰。
 */
export function safeDpr() {
  return Math.min(window.devicePixelRatio || 1, 2);
}

/**
 * A4 尺寸標籤文字(依方向)。
 * @param {boolean} isLandscape - 是否橫向
 * @returns {string} 'A4 · 210×297mm' 或 'A4 · 297×210mm'
 */
export function a4LabelMm(isLandscape) {
  return isLandscape ? 'A4 · 297×210mm' : 'A4 · 210×297mm';
}
