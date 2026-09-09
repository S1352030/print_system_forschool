# 網站載入效能驗證與部署

## 本次結果（2026/09/08）

已完成本機實作、正式建置及既有正式站 CDN 唯讀驗證。尚未部署此次修改：目前環境沒有 GCP 主機 SSH 設定、gcloud 或 Cloudflare API 憑證。正式站部署後驗收與台灣網路實測仍待執行。

Service Worker 現在使用 Navigation Preload，將導覽下載與 Worker 啟動並行；網路回應不再等待 Cache API 寫入及清理。儲存空間不足、快取讀取失敗或預載失敗都有回退處理，成功網路回應不會因儲存失敗變成離線錯誤。首頁維持網路優先，版本資源維持快取優先，沿用原本兩個快取名稱及容量上限。帶認證請求、健康檢查、Worker 腳本、API、後台與使用者 PDF 明確略過 Worker 快取。

API、資料庫及上傳欄位未變更；既有尚未提交的介面修改保留。本次測試兩組皆使用同一份目前工作目錄的前端建置，只替換 Worker。舊 Worker 取自 `e81c0ae098edaf80eb8f12efc36aa027870d91a5`。

## 前後量測

Node 22.23.2、Chromium 152.0.7977.76、Pixel 7 模擬、localhost 模擬每次回源等待 120 ms，gzip 回應。每版 10 個全新瀏覽器 context，各造訪兩次；每次載入後固定觀測 700 ms。FCP 為首次內容顯示，LCP 為觀測窗內的最大內容顯示。這是本機合成測試，並非台灣網路或正式站速度。

本機防毒軟體會注入額外阻塞腳本，且可重寫 CSP。測試 fixture 套用正式站 CSP，並僅在測試頁的 CDP session 阻擋已知注入來源 `*://*.scr.kaspersky-labs.com/*`；沒有更動系統防毒設定，也沒有停用 HTTP 快取。下列為排除該干擾後的完整 10 組結果；含注入干擾的早期數據不作效能結論。

| 情境／指標 | 修改前中位數 | 修改後中位數 | 修改前 P90 | 修改後 P90 |
| --- | ---: | ---: | ---: | ---: |
| 首次 TTFB | 136.35 ms | 131.85 ms | 138.60 ms | 138.40 ms |
| 首次 FCP | 338 ms | 338 ms | 360 ms | 368 ms |
| 首次 LCP | 338 ms | 338 ms | 360 ms | 368 ms |
| 回訪 TTFB | 135.60 ms | 136.30 ms | 138.40 ms | 137.20 ms |
| 回訪 FCP | 172 ms | 164 ms | 180 ms | 168 ms |
| 回訪 LCP | 172 ms | 164 ms | 180 ms | 168 ms |

兩版首次／回訪的資源時序筆數中位數與 P90 均為 9；瀏覽器 `transferSize` 加總中位數與 P90 分別為 51,256／22,572 bytes，兩版相同。這些數值含瀏覽器呈現的快取與本機代理行為，不是 GCP 流量帳單；Cache API 回應可能回報零傳輸量，Worker 背景請求也不計入頁面 Resource Timing。

fixture 實際收到的首次／回訪請求數均為 8／2，兩版相同，每次導覽均只有一次首頁下載；新版 10 次回訪皆使用預載。測試沒有顯示明顯 TTFB 改善或首次顯示改善；回訪顯示略快，但樣本小，不據此承諾線上改善百分比。可確定的行為改善是：快取寫入與 HTML 完整下載不再阻塞回應，而且儲存故障不會破壞成功請求。

原始資料保留於本機忽略目錄 `.codex-qa/load-before.json`、`.codex-qa/load-after.json`；含每次樣本、資源時序、Worker 雜湊及測試設定。

## 快取與功能驗收

正式站 `https://ampaprint.systems` 經 Cloudflare PDX 節點的 20 次唯讀請求全部通過，原始結果在 `.codex-qa/cdn-live.json`：

| 路徑 | 第二次請求結果 |
| --- | --- |
| 首頁、版本化 JS/CSS、PDF.js、公開公告 | `200`、`HIT`、有 `Age` |
| `/sw.js`、`/health` | `200`、`DYNAMIC`、無 `Age` |
| `/admin`、`/api/orders`（未認證） | `401`、`DYNAMIC`、無 `Age` |
| 不存在的版本化資源 | `404`、`BYPASS`、`no-store`、無 `Age` |

公開回應的瀏覽器 TTL 與既有契約相符。首頁 edge 一小時來自現有 origin 設定與後端測試；Cloudflare 會移除專用 CDN 控制標頭，單靠外部 `HIT` 不能證明精確 edge TTL。此次沒有調整線上快取規則，也沒有存取真實訂單 PDF；敏感 PDF 的 `no-store` 由隔離資料庫測試驗證。規則依據仍為 `CLOUDFLARE_CACHE_RULES.md`。

- Node 前端測試：43 項通過，含預載成功／失敗、快取緩慢／失敗、串流回應、離線回退、敏感路徑與更新重載。
- Python 測試：25 項通過，使用隔離 SQLite 與上傳目錄，覆蓋實際上傳、原子寫入、PDF Range 與快取標頭。
- Chromium 原生 Worker 測試：停止 Worker 後導覽預載、單次下載、快取重用、離線頁面、更新只重載一次，以及模擬配額不足均通過。
- Chromium Pixel 7：啟用 Worker，驗證兩份 PDF 預覽、切頁、計價、multipart 上傳、成功訊息、冷卻、歷史訂單和後台 PDF Range。上傳使用本機 mock，不會產生正式訂單或發送通知。
- WebKit 執行檔未安裝，因此 Safari/iPhone 瀏覽器驗證略過，未宣稱通過。
- Node 22 正式建置、預壓縮解壓比對及資源預算通過；首頁初始 JS/CSS 為 4 個請求、23,217 Brotli bytes。

已驗證的前端產物在 `static/builds/perf20260908node22/`。根目錄 `sw.js.br`／`sw.js.gz` 也已重新產生；Worker 仍透過根路徑提供，不放入不可變前端 release。這個測試 build ID 用於本機驗證；正式部署仍使用 Git revision 作為 build ID。

## 重跑與正式部署

使用 Node 22.12+（22 LTS）、專案 Python venv；瀏覽器測試需可由 `require('playwright')` 找到 Playwright 與 Chromium。本次使用 Codex 隨附 Playwright，透過 `NODE_PATH` 指向其套件目錄。一般開發機可在獨立測試目錄安裝：

```bash
npm install --prefix .codex-qa/browser --no-save playwright
export NODE_PATH="$PWD/.codex-qa/browser/node_modules"
node .codex-qa/browser/node_modules/playwright/cli.js install chromium
npm run test:frontend
npm run test:browser
python -m pytest -q tests/test_pdf_pipeline.py
```

下面是 Bash 的前後比較流程；請在開發機執行測速，不在免費 VM 上啟動瀏覽器。`LOAD_TEST_OUTPUT` 指定 JSON 輸出，省略時只印摘要。localhost 模式的公告為固定空陣列，沒有資料庫寫入。

```bash
mkdir -p .codex-qa
git show e81c0ae098edaf80eb8f12efc36aa027870d91a5:sw.js > .codex-qa/sw-before.js
export APP_BUILD_ID="perf-local"
npm run build
python precompress.py
npm run verify-build
LOAD_TEST_SW_PATH=.codex-qa/sw-before.js LOAD_TEST_OUTPUT=.codex-qa/load-before.json npm run measure:load
LOAD_TEST_SW_PATH=sw.js LOAD_TEST_OUTPUT=.codex-qa/load-after.json npm run measure:load
```

正式部署步驟：

1. 將本次修改及預定上線的介面修改審查後提交至 `origin/main`。本輪沒有自動提交或推送；部署腳本需要主機 checkout 乾淨。
2. 在 GCP 主機確認 Node 22、現有 `venv`、PM2，以及既有 `CF_ZONE_ID`／`CF_API_TOKEN` 秘密環境變數可用。Token 不寫入專案或測速輸出。
3. 在專案目錄執行現有部署流程：

```bash
cd "$HOME/print_system_forschool"
bash deploy.sh
```

4. 腳本會備份 SQLite、建立 Git build ID 的不可變產物、測試、預壓縮、重新載入 PM2、核對 backend/frontend build ID，再精確 purge 首頁。健康失敗沿用既有回復流程；purge 失敗依腳本輸出的原模式重試，不使用 Purge Everything。
5. 部署後執行 `CDN_CHECK_OUTPUT=.codex-qa/cdn-after-deploy.json npm run verify:cdn`。這是唯讀檢查；遇到標頭、狀態或快取命中不符時退出碼為 1。
6. 在台灣網路的開發機，以 `LOAD_TEST_ORIGIN=https://ampaprint.systems LOAD_TEST_OUTPUT=.codex-qa/taiwan-after.json npm run measure:load` 收集首次與回訪各 10 次數據。正式網址模式不阻擋注入腳本、不修改正式資源，報告記錄 `CF-Ray`、`CF-Cache-Status` 與 `Age`；節點位置不能代替使用者所在地。

目前待完成的線上驗收為：正式部署、部署後的快取與 Worker 更新確認，以及台灣 Wi-Fi／手機網路的同條件比較。
