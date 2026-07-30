/** 將同步載入的 dialog.js 全域 API 提供給 ES modules，避免模組循環相依。 */
export const showAlert = (message, type, title) =>
  window.showAlert(message, type, title);

export const showConfirm = (message, type, title) =>
  window.showConfirm(message, type, title);
