# Tasks

## 1. 規格審查

- [x] 1.1 對照 proposal.md、design.md 與 `specs/print-orders/spec.md`，確認範圍只到叫出列印對話框，且不改 API、資料庫、CSP 與 `tests/fixtures/contracts.json`。以 `npx --no-install openspec validate add-admin-direct-print --strict` 通過為準。

## 2. 列印模組

- [x] 2.1 新增 `static/js/admin/pdf-print.js`，依 design D1–D5 實作：
  - 可注入依賴；以 fetch 取得 blob；畫面外 iframe 不用 `display:none`；`load` 後依延遲常數呼叫 `print()`。
  - 遞增 token 加 `AbortController`；提供清理函式（移除 frame、`revokeObjectURL`）。
  - 不 import 入口或 `pdf-engine.js`。
  - 以 `npm run check:syntax` 通過為準。
- [x] 2.2 新增 `tests/admin_pdf_print.test.mjs`（假 DOM／fetch／計時器）。以 `node --test tests/admin_pdf_print.test.mjs` 全部通過為準，涵蓋：
  - 請求網址正確；frame 樣式與 blob `src`；延遲後只呼叫一次 `print()`。
  - 非 2xx、網路錯誤、`print()` 拋錯都會拋出錯誤並完成清理。
  - 中止或過期 token 時不呼叫 `print()`。
  - 再次列印與清理時會移除舊 frame 並撤銷 URL。

## 3. 後台整合

- [x] 3.1 在 `admin.html` 預覽標頭「下載 PDF」旁新增「列印」按鈕：沿用 `#i-print`、預設 `hidden`、帶 `data-admin-pdf-print`，不寫 inline handler。`admin.css` 只用 M3 token。以 `node --test tests/csp_frontend_bindings.test.mjs` 通過為準。
- [x] 3.2 修改 `static/js/admin/pdf-modal.js`。`downloadCurrentPdf()` 不修改，以第 3.3 項測試通過為準：
  - 開啟訂單時，只在 `navigator.pdfViewerEnabled === true` 時顯示列印按鈕。
  - 點擊後停用按鈕、設 `aria-busy`、文字改為「準備列印…」。
  - 失敗時以既有 toast 顯示原因與「可改用下載 PDF」，按鈕恢復可用。
  - 關閉預覽或開啟其他訂單時中止並清理。
- [x] 3.3 擴充 `tests/browser_preview_smoke.mjs` 後台段落。以 `npm run test:browser` 通過為準：
  - 以 `addInitScript` 模擬 `pdfViewerEnabled=true`，並註明這是測試用模擬。
  - 驗證按鈕顯示、點擊後只發出一次原檔請求、出現 `[data-admin-print-frame]`、關閉預覽後 frame 被移除。
  - 另驗證未模擬時按鈕隱藏，且 `pageErrors` 為空。
- [x] 3.4 執行 `npm run check:architecture`，確認沒有新的循環依賴、未解析引用或孤立模組警告，也沒有新增豁免。

## 4. 文件與紀錄

- [x] 4.1 更新 `ARCHITECTURE.md`：說明後台可用瀏覽器列印對話框列印原檔，系統仍沒有印表機驅動或自動出紙，並在目錄責任中加入 `static/js/admin/pdf-print.js`。以 `npm run check:governance` 通過為準。
- [x] 4.2 在 `AI_CHANGELOG.md` 最上方依三區塊繁體中文格式新增本次紀錄，不覆寫歷史。內容要含實際通過、失敗與未執行的檢查，以及「實際出紙未經自動測試」的限制，以檔案頂端出現新條目且格式與既有條目一致為準。

## 5. 整合驗收

- [x] 5.1 執行完整 `npm run check`（不可用 `check:fast` 代替）並全部通過。記錄 `.quality-reports/latest.json` 結果，若有失敗則如實回報並修正，不得跳過或降低測試。
- [ ] 5.2 管理員以 Windows Edge 人工驗收，並把結果與日期記入 `AI_CHANGELOG.md`。驗收前此功能只能標示為「已測試」，不得標為 stable：
  - 「列印」能叫出對話框且預覽為該訂單 PDF。
  - 留白與裁切訂單各印一份，經 L3550 出紙正確。
  - 準備中關閉預覽不會叫出對話框。
  - 下載 PDF 仍正常。

## Workflow follow-up

- 人工驗收（5.2）完成且審查通過後，以 `/opsx:archive` 歸檔此變更並同步 `openspec/specs/print-orders/spec.md`。
- 歸檔後再次執行 `npm run check:specs`，確認主規格與封存規格都通過嚴格驗證。
