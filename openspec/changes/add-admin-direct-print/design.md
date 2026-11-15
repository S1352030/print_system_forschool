# Design

## Context

動機見 proposal.md「Why」，行為要求見 `specs/print-orders/spec.md`。

現況與限制：
- `static/js/admin/pdf-modal.js` 的 `downloadCurrentPdf()` 以 `fetch('/api/orders/{id}/file/{name}')` 取得 blob，再用 `<a download>` 存檔。管理員授權靠瀏覽器自動帶上的 Basic Auth，沒有前端登入。
- 主程式 CSP 已有 `frame-src 'self' blob: data:` 與 `object-src 'self' blob: data:`。PDF 回應為 `Content-Disposition: inline`、`Cache-Control: private, no-cache`，且不加 `frame-ancestors`。
- 預覽由共用 `PdfPreviewController`／`pdf-engine.js` 以 Range 延遲載入。AGENTS 禁止前後台重複 PDF 渲染器，也不得降低 CSP 或新增 inline handler／`window.*` 橋接。
- 實際使用環境：Windows、Edge、Epson L3550（Wi-Fi，驅動只有手動雙面）。2026-11-15 管理員在 Edge 後台主控台實測「同源 blob、畫面外 1px iframe、`load` 後約 300ms 呼叫 `contentWindow.print()`」，成功叫出 Edge 列印對話框，預覽 28 張、A4、「調整成可列印區域大小」。實際出紙尚未驗證。
- 瀏覽器測試以 Playwright Chromium（Pixel 7 模擬）與 WebKit 執行。headless Chromium 沒有 PDF 檢視器，無法驗證真實列印對話框。

## Goals / Non-Goals

**Goals:**
- 列印流程只依賴瀏覽器原生 PDF 檢視器，原始 PDF 以向量交給列印，不經 PDF.js 重繪。
- 列印邏輯放在可注入依賴的獨立模組，能用 Node 單元測試驗證列印呼叫與清理，不需要真實瀏覽器。
- 失敗、重複點擊、中途關閉或換訂單時行為確定，不殘留 iframe 或 blob URL。

**Non-Goals:**
- 不偵測使用者是否真的列印成功，也不在 `afterprint` 後詢問或自動標記已列印。
- 不處理 Edge 會沿用上次列印設定的問題。預覽視窗既有的設定 badge 就是提醒。
- 不改 Edge 原則（如 `UseSystemPrintDialog`）、不寫列印電腦設定文件、不做批次列印。
- 不重構既有下載流程。

## Decisions

### D1：隱藏 iframe 載入同源 blob，再呼叫 `contentWindow.print()`
- **選擇原因**：已在目標 Edge 實測成功，不需改 CSP、API 或依賴，原檔不轉圖。
- **替代方案**：
  - 新分頁開啟 PDF：多一步，還會留下分頁。
  - 以 PDF.js 渲染成圖片再 `window.print()`：點陣化、吃記憶體，且可能形成第二個渲染流程。
  - 本機列印代理／kiosk 列印：要安裝常駐程式或改瀏覽器啟動參數，超出「叫出列印畫面」的範圍。

### D2：先 `fetch` 成 blob，不直接把檔案網址設為 iframe `src`
- **選擇原因**：可以先檢查 HTTP 狀態，401／404 時顯示錯誤，不會把錯誤頁送去列印。也能用 `AbortController` 中止，並與下載使用同一個管理員原檔端點與授權。
- **替代方案**：
  - 直接設 iframe `src`：無法可靠得知失敗。
  - 重用 PDF.js 已載入資料（`getData()`）：會讓後台列印依賴共用引擎內部狀態，Range 載入時也不一定完整。多下載一次（預設上限 20MB）可接受。

### D3：iframe 放在畫面外，不使用 `display:none`
- **做法**：`position:fixed`、1px、`opacity:0`、`border:0`、`pointer-events:none`，並設 `aria-hidden="true"` 與 `tabindex="-1"`，加上 `data-admin-print-frame` 供測試辨識。
- **選擇原因**：Chromium 不會在 `display:none` 的 frame 初始化 PDF 檢視器，實測樣式就是畫面外 1px。
- **呼叫時機**：`load` 後等一小段固定延遲（初值 300ms，定義為模組常數）再呼叫 `print()`，讓檢視器完成初始化。`print()` 拋出例外時視同失敗，顯示建議下載的提示。

### D4：列印 frame 的生命週期以「一次列印」為單位
- **清理時機**：每次按「列印」先清理上一次的 frame 與 blob URL，再建立新的；關閉預覽或開啟另一筆訂單時中止 fetch 並清理。
- **為什麼不在 `afterprint` 清理**：PDF 檢視器 frame 的 `afterprint` 不可靠，列印對話框開著時也不能移除 frame。代價是 blob 會保留到下一次列印或關閉預覽，記憶體可接受。
- **過期回應**：每次準備帶遞增的 token；fetch 完成時 token 已過期（例如已換訂單）就丟棄結果，不叫出對話框。

### D5：模組邊界
- **新模組**：`static/js/admin/pdf-print.js` 匯出建立列印工作的函式，接收 `document`、`fetch`、`URL`、計時器等依賴（預設用全域），只回傳成功或拋錯，不自行顯示 toast。
- **呼叫端**：只有 `pdf-modal.js` import 它。`pdf-modal.js` 負責按鈕狀態、toast，以及在關閉或換訂單時呼叫清理。
- **依賴規則**：不 import 入口與 `pdf-engine.js`，符合 dependency-cruiser 規則，也不影響 PDF 引擎延遲載入與初始 bundle 預算。

### D6：按鈕與顯示條件
- **按鈕**：放在 `admin.html` 預覽視窗標頭「下載 PDF」旁，沿用 `#i-print` 圖示與 M3 token 樣式，以 `data-admin-pdf-print` 用 JS 綁定。開啟訂單時顯示、關閉時隱藏，與下載按鈕一致。
- **準備中**：`disabled` 加 `aria-busy="true"`，文字改為「準備列印…」。
- **顯示條件**：只在 `navigator.pdfViewerEnabled === true` 時顯示。Android 或沒有檢視器的環境只保留下載，避免印到空白頁或整個後台畫面。實作時以 Playwright 實測：headless Chromium（Pixel 7）回報 false，WebKit（iPhone 14 模擬）回報 true，所以 iPhone Safari 仍會顯示按鈕，見 Risks。已取消訂單與下載一致，仍可列印，假設管理員會依列表的「已取消」標示判斷。
- **下載**：`downloadCurrentPdf()` 不修改，降低回歸風險。兩者重複的 fetch→blob 只有數行，暫不抽共用。

### D7：測試策略
- **Node 單元測試**（`tests/admin_pdf_print.test.mjs`，假 DOM／fetch／計時器），驗證：
  - 請求網址正確。
  - frame 不是 `display:none`，`src` 為 blob。
  - `load` 加延遲後呼叫一次 `print()`。
  - 非 2xx、網路錯誤、`print()` 拋錯時拋出錯誤並清理。
  - 中止與過期 token 時不呼叫 `print()`。
  - 再次列印與清理會移除 frame 並 `revokeObjectURL`。
- **擴充 `tests/browser_preview_smoke.mjs` 後台段落**：
  - 用 `addInitScript` 依測試網址 `/admin?pdf-viewer=0|1` 固定 `pdfViewerEnabled`，讓兩種情況在 Chromium 與 WebKit 都可重現。這只是測試用的模擬，正式程式不讀這個參數。
  - `pdf-viewer=0` 時驗證按鈕隱藏、下載可見。
  - `pdf-viewer=1` 時驗證按鈕出現、點擊後只多一次不帶 Range 的原檔請求、準備中再次點擊不會重送、產生 `data-admin-print-frame`，關閉預覽後 frame 移除、按鈕重設，且沒有 page error。
  - headless 瀏覽器的 PDF iframe 不會觸發 `load`，所以測試不會真的呼叫 `print()`。
- **人工驗收**：Edge 叫出真實對話框與 Wi-Fi 出紙，結果記入 tasks。

## Risks / Trade-offs

- [Edge 更新 PDF 檢視器後 iframe 列印失效或印出空白] → 「下載 PDF」保留作備案。Edge 大版本更新後依人工驗收清單重測，延遲常數可調整。
- [headless 瀏覽器測試無法證明真實對話框與出紙] → 單元測試驗證呼叫契約，瀏覽器測試驗證整合與清理，真實行為由人工驗收。不得把自動測試結果宣稱為「已驗證出紙」。
- [300ms 延遲對大型 PDF 可能不足，導致預覽空白] → 以 28 張實檔驗收，必要時調整常數。真實檔案問題由管理員回報。
- [Edge 會沿用上次的色彩與雙面設定，可能印錯] → 預覽視窗已顯示訂單設定 badge。更強的提醒列為後續需求，不在本次範圍。
- [`pdfViewerEnabled` 在部分瀏覽器為 true，但 iframe 列印不支援或行為不同（Firefox、桌面 Safari、iPhone Safari）] → 規格只保證 Edge／Chromium。其他瀏覽器若 iframe 不載入，15 秒後顯示逾時錯誤並建議下載；若印出內容不對，由管理員改用下載。日後若要在觸控裝置隱藏按鈕，需另提規格變更。
- [blob 保留到下一次列印或關閉預覽，最多約 20MB] → 關閉預覽必定清理。後台一次只開一個預覽。

## Migration Plan

- 只改前端靜態資源，依既有 Vite 版本化建置與 `deploy.sh` 流程發布，沒有資料或 API 遷移。
- 回復：還原此 change 的提交並重新建置部署即可。資料庫、上傳檔與契約都不受影響。

## Open Questions

- Firefox 在 iframe 呼叫 PDF `print()` 是否可用：不影響 Edge 目標與任務拆分，日後若有需求再實測。
