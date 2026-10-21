## ADDED Requirements

### Requirement: 後台訂單統計與搜尋
後台 `GET /api/orders` 分頁格式 MUST 回傳 `summary`，內容為全庫未取消訂單的 `unpaid_count`、`unpaid_amount`、`unprinted_count`、`unprinted_pages`，不受分頁與 `q` 影響；`unpaid_amount` 依 `max(0, total_price - gift_card_discount)` 加總。系統 SHALL 接受選填 `q`（最多 64 字），以姓名包含比對；`q` 為純數字時也比對訂單編號。萬用字元必須當成一般文字。不帶 page 的舊陣列格式 MUST 維持不變。

#### Scenario: 超過一頁的統計
- **WHEN** 有 60 筆未付款、未列印的訂單，管理員以 page=1、page_size=50 查詢
- **THEN** items 只有 50 筆，但 summary.unpaid_count=60，unpaid_amount 與 unprinted_pages 為 60 筆的總和

#### Scenario: 搜尋姓名或編號
- **WHEN** 管理員以 page=1 與 q=王 或 q 等於某訂單編號查詢
- **THEN** 只回傳姓名包含「王」或編號相符的訂單，total 為篩選後筆數，summary 仍為全庫統計

#### Scenario: 萬用字元不擴大結果
- **WHEN** q=%
- **THEN** 只回傳姓名真的含有「%」的訂單
