/**
 * 通用工具函式模組
 * 提供 HTML 跳脫、日期格式化等跨模組共用功能。
 */

/**
 * 跳脫 HTML 特殊字元,防止 XSS。
 * 用於將使用者輸入安全插入 innerHTML。
 */
export function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 將 ISO 或 datetime 字串格式化為「YYYY-MM-DD HH:MM」。
 * 無法解析時原樣回傳。
 */
export function formatDate(dateStr) {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}`;
  } catch (e) {
    return dateStr;
  }
}

/**
 * 簡易防抖:延遲執行函式,在期間內再次呼叫會重設計時器。
 */
export function debounce(fn, delayMs = 200) {
  let timer = null;
  return function (...args) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delayMs);
  };
}
