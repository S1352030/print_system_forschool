## ADDED Requirements

### Requirement: 共用 Material 3 主題 token
前台與後台 MUST 從同一個 `static/material-common.css` 取得 `--md-sys-*` 色彩、字級、形狀、動態與狀態 token，並套用相同的 `html.dark` 與配色 class。後台元件不得再定義獨立的舊配色；新增樣式 SHALL 使用 token，而不是任意 hex 顏色。

#### Scenario: 後台跟隨深淺模式
- **WHEN** 系統偏好為淺色，或 sessionStorage 主題為 light 時開啟後台
- **THEN** 後台背景與文字使用淺色 surface／on-surface token，切換為 dark 時改用深色 token

### Requirement: 可用鍵盤操作的後台開關
後台「已列印」與公告「顯示」開關 MUST 是可聚焦的 checkbox 並帶 `role="switch"`；鍵盤 Tab 可以聚焦、空白鍵可以切換，聚焦時要顯示焦點環。隱藏元素 MUST 在不需要時真的不顯示。

#### Scenario: 鍵盤切換列印狀態
- **WHEN** 管理員以 Tab 聚焦某筆訂單的已列印開關並按空白鍵
- **THEN** 送出狀態更新，畫面上開關狀態同步

#### Scenario: 已全部載入
- **WHEN** 訂單已經全部載入
- **THEN** 「載入更多」按鈕不顯示

### Requirement: 行動版表單版面
在 680px 以下寬度，前台 SHALL 在檔案卡提供「預覽」按鈕捲到下方的 PDF 預覽卡；取件時間欄位的標籤 SHALL 完整可見，範例與字數限制改放在輔助說明；禮物卡代碼輸入框與「套用」「移除」按鈕 SHALL 在 320px 以上寬度維持同一列，觸控目標至少 48px。PDF placeholder 的手機版尺寸 MUST 維持原狀，直到 WebKit 版面相關崩潰查明為止。

#### Scenario: 手機開啟頁面尚未選檔
- **WHEN** 390px 寬度開啟前台
- **THEN** 取件時間標籤沒有被截斷，頁面沒有水平捲動

#### Scenario: 手機選檔後查看預覽
- **WHEN** 選擇 PDF 後按檔案卡的「預覽」
- **THEN** 頁面捲到 PDF 預覽卡
