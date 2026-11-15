# Proposal

## Why

管理員現在列印訂單要先在後台「下載 PDF」，再到下載資料夾找檔、用本機閱讀器開啟後才能列印，步驟多又容易開錯檔案。2026-11-15 管理員已在 Edge 後台以主控台實測：同源 blob 加畫面外 iframe 再呼叫 `print()`，可直接叫出 Edge 列印對話框並正確預覽原檔。因此後台可以省掉下載與開檔的步驟。

## What Changes

- 後台 PDF 預覽視窗的「下載 PDF」旁新增「列印」按鈕。按下後以管理員已通過的 Basic Auth 取得原始 PDF，放進畫面外的隱藏 iframe，再叫出瀏覽器列印對話框。
- 彩色／黑白、雙面、縮放等設定仍由管理員在 Edge 對話框或「使用系統對話方塊列印」的印表機驅動設定中選擇。系統不嘗試預設或覆寫這些設定。
- 準備中停用按鈕並提示；取得原檔失敗時顯示錯誤並建議改用「下載 PDF」。切換訂單或關閉預覽時放棄尚未完成的列印準備並清理 iframe 與 blob URL。
- 保留現有「下載 PDF」功能作為備案，行為不變。
- 不自動標記「已列印」、不做本機列印代理或無對話框列印、不改後端。
- 無 **BREAKING** 變更。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `print-orders`：新增「後台直接列印原檔」需求，規範列印按鈕、原檔來源、失敗處理與不改變訂單狀態。

## Impact

- **前端（後台）**：`admin.html`（預覽視窗新增按鈕，沿用既有 `#i-print` 圖示）、`static/js/admin/pdf-modal.js`（綁定按鈕、切換訂單與關閉時清理）、新增 `static/js/admin/pdf-print.js`（取得原檔、iframe 生命週期、呼叫列印）、`admin.css`（按鈕樣式沿用 M3 token）。
- **公開 API／資料格式／資料庫**：不變。沿用既有 `GET /api/orders/{id}/file/{file_name}`，`tests/fixtures/contracts.json` 不需更新。
- **安全性**：不改 CSP。既有 `frame-src 'self' blob:` 已允許同源 blob iframe，PDF 回應維持 `no-store`／`private` 與 Basic Auth。不新增外部來源、inline handler 或 `window.*` 橋接，也不新增依賴。
- **瀏覽器支援**：以 Windows 桌面 Edge（Chromium）為目標，其他瀏覽器不保證能叫出對話框，下載仍可用。
- **文件**：`ARCHITECTURE.md` 補充列印由瀏覽器對話框觸發，仍無印表機驅動或自動出紙；`AI_CHANGELOG.md` 新增紀錄。
- **驗收**：新增 Node 單元測試（列印模組，假 DOM／fetch）、擴充 `tests/browser_preview_smoke.mjs` 後台段落、`npm run check` 全部通過；Edge 實際叫出對話框與 Wi-Fi 印表機出紙由管理員人工驗收。
