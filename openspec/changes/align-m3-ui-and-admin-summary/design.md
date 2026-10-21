## Context

前台 `style.css` 定義了 `--md-sys-*` 別名、六組配色（blue／green／purple／teal／rose／orange）與 `html.dark`。前後台 HTML 都有同一段主題啟動腳本，會設定 `dark` 與配色 class。後台 `admin.css` 卻自行定義 `--primary:#1a1a2e` 等舊變數，並把 `color-scheme` 固定為 dark，所以主題 class 對後台沒有作用。

## Decisions

1. **token 單一來源**：把 `style.css` 的 `:root`、`html.dark` 與六組配色區塊原樣移到 `static/material-common.css` 開頭。兩頁原本就 `@import` 這個檔案，開發模式不增加請求，Vite 建置也會內聯。`.hidden` 一併移入共用檔。
2. **後台沿用既有 class 名稱**：`btn-view-pdf`、`btn-delete`、`toggle`、`badge-chip`、`data-*` 都由 JS 與 Playwright 使用，因此保留名稱，只改 CSS 對應的 M3 樣式。這樣不改事件綁定，也不重寫模組。
3. **開關無障礙**：保留 `<label class="toggle"><input type="checkbox">…` 結構，input 改為覆蓋整個開關的透明元素（不用 `display:none`），加上 `role="switch"`，以 `:focus-visible` 顯示焦點環。
4. **統計交由伺服器計算**：`summary` 以同一個 session 在分頁查詢前讀取未取消訂單的必要欄位後加總；應付金額沿用 `max(0, total_price - gift_card_discount)`。前端沒有 `summary`（例如舊伺服器）時退回原本的已載入資料計算。
5. **搜尋**：`q` 去除前後空白後最多 64 字。純數字時比對 `id` 或姓名包含；其他情況只比對姓名包含，以 `contains(..., autoescape=True)` 避免 `%`／`_` 萬用字元。空字串等於沒有篩選。
6. **手機預覽卡**：原計畫在窄螢幕隱藏或縮小空白預覽卡，但逐一二分後確認：只要改動手機版 `.pdf-placeholder` 的版面（`:has()` 隱藏、JS class 隱藏、改為單行、甚至只把 `min-height` 改成 120px），Playwright WebKit（iPhone 14）在 `browser_preview_smoke.mjs` 都穩定 Page/Target crashed；還原後即通過。這是與版面位置相關的 WebKit 崩潰，原因未查明，所以 placeholder 維持原狀。改為在檔案卡加「預覽」按鈕捲到預覽卡；PDF 預覽卡加上 `pdf-preview-card` class 供定位。

## Compatibility and Rollback

- API 只新增欄位與選填參數；舊前端忽略 `summary`，不帶 `q` 時行為與現在相同。
- 純 CSS／HTML／前端改動可直接 revert 回復；沒有資料遷移。
- 契約 fixture 只新增 `q` 參數定義，需人工審查 diff。

## Non-goals

不改 PDF 預覽引擎、計價、財務交易、授權、快取，也不導入 `@material/web` 或其他新依賴（Material Web 已只做維護，Expressive 沒有 Web 版元件）；動態效果維持 CSS easing token。
