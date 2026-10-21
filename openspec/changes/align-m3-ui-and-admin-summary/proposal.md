## Why

前台已採用 Material 3 Expressive 風格與 `--md-sys-*` 設計 token，但後台仍是舊的深藍／紅色自訂配色，加上 M2 風格的大寫字距標題、等寬數字與 emoji 圖示。後台頁面其實已經載入主題啟動腳本，卻沒有跟著深淺模式切換。實際操作時也確認了兩個後台錯誤：統計卡只計算已載入的前 50 筆訂單，未付款金額會少算；`admin.css` 缺少 `.hidden` 規則，「載入更多（還剩 0 筆）」無法隱藏。另外，「已列印」開關的 input 以 `display:none` 隱藏，鍵盤無法操作。前台手機版則有預覽卡離檔案設定太遠、取件時間標籤被截斷、禮物卡按鈕換行等問題。

## What Changes

- `GET /api/orders` 分頁格式新增 `summary`（全庫未付款筆數／金額、待列印筆數／頁數），並新增選填查詢參數 `q`（姓名包含，或純數字時比對訂單編號）。統計不受 `q` 與分頁影響。不帶 page 的舊陣列格式不變。
- 共用 M3 色彩、字級、形狀、動態與狀態 token 移到 `static/material-common.css`，前後台共用同一套主題、深淺模式與配色。
- 後台改用 M3 token 與元件樣式：頂部應用列、統計卡、tonal／outlined／text 按鈕、可用鍵盤操作的 switch、chips；訂單區塊移到統計卡下方，加入訂單搜尋欄；刪除與取消訂單在視覺上和一般操作分開；移除 emoji 圖示。
- 前台手機版：檔案卡加「預覽」按鈕捲到下方的預覽卡；取件時間改用短標籤加輔助說明；禮物卡按鈕不換行；歷史訂單 badge 改用主題 token。

## Capabilities

### New Capabilities
- `interface-design`：前後台共用 M3 token、主題、無障礙開關與行動版版面基準。

### Modified Capabilities
- `print-orders`：後台訂單分頁新增全庫統計與搜尋。

## Impact

- 檔案：`main.py`（僅 `/api/orders`）、`static/material-common.css`、`style.css`、`admin.css`、`admin.html`、`index.html`、`static/js/admin/orders.js`、`static/js/admin/announcements.js`、`static/js/admin/app.js`、`static/js/admin/pdf-modal.js`、`static/js/admin/gift-cards.js`、tests、`tests/fixtures/contracts.json`（新增選填 `q` 參數，需人工審查）。
- API：只做相容的新增，沒有移除或改名欄位；資料庫、計價、授權、限流、快取、財務流程不變。
- 安全：`q` 只在 Basic Auth 後台使用，以 SQLAlchemy 參數化 LIKE（autoescape）查詢。
- 驗收：新增 pytest（summary 全庫統計、q 搜尋、舊格式不變）、Node／Playwright 回歸，`npm run check` 完整通過，並以瀏覽器實際檢查前後台深淺色與手機寬度。
