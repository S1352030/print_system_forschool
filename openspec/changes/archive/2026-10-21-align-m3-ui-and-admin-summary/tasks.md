## 1. 規格

- [x] 1.1 建立 proposal、design、print-orders 與 interface-design delta specs

## 2. 後端

- [x] 2.1 `/api/orders` 分頁新增 `summary` 與 `search`，舊格式不變
- [x] 2.2 新增 pytest：跨頁統計、姓名／編號搜尋、萬用字元、舊格式
- [x] 2.3 人工更新 `tests/fixtures/contracts.json` 新增 `search`，於回報中列出差異

## 3. 前端

- [x] 3.1 共用 token 與 `.hidden` 移到 `static/material-common.css`
- [x] 3.2 後台 M3 樣式、版面順序、搜尋欄、switch 無障礙、移除 emoji
- [x] 3.3 後台統計改用 `summary`（沒有時退回已載入資料）
- [x] 3.4 前台手機版「預覽」按鈕、取件時間標籤、禮物卡按鈕與歷史 badge token（placeholder 尺寸因 WebKit 崩潰保留原狀，見 TEST-03）

## 4. 驗證與紀錄

- [x] 4.1 `npm run check`（Node 22）完整通過
- [x] 4.2 瀏覽器實際檢查前後台的深淺色、桌面與 375px（headless Chromium 截圖；真實手機未驗）
- [x] 4.3 更新 ARCHITECTURE.md 與 AI_CHANGELOG.md
- [x] 4.4 人工審查 contracts.json 的 `search` 差異後再 archive（2026/10/21 使用者核准）
