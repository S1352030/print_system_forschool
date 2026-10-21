# print-orders Specification

## Purpose

保護PDF收件、頁數與價格、設定保存、歷史查詢與管理流程。依賴upload／history／preview、main、database、gift_cards；測試test_pdf_pipeline、test_core_contracts及瀏覽器preview／gift-cards。

## Requirements

### Requirement: PDF驗證及原子上傳
系統 SHALL 支援前台最多5份依序PDF，後端每檔預設20MB、驗證副檔名／非空／magic／可解析／未加密／非零頁。先寫.part，解析成功原子改名，最後交易commit；可處理的失敗必須rollback並清理相應檔案。

#### Scenario: 正常收件
- **WHEN** multipart上傳合法PDF、姓名及合法列印設定
- **THEN** 回201及order_id、total_price、gift_card_discount、amount_due、gift_card_balance，訂單與原PDF可查閱

#### Scenario: 拒絕無效PDF
- **WHEN** 空檔／錯誤副檔名／magic、超限、損壞或加密PDF上傳
- **THEN** 分別回400／413／422，不新增訂單或扣卡

### Requirement: 伺服器頁數及設定計價
系統 MUST 依pypdf實際頁數以黑白1元／彩色2元逐頁計價；duplex single／double與fit／cover、binding、pickup_location保留在訂單。前端只試算，不可猜頁數或信任客戶端金額。

#### Scenario: 三頁彩色雙面裁切
- **WHEN** 上傳三頁PDF，color_mode=color、duplex=double、fit_mode=cover
- **THEN** 原價6元，歷史保存3頁與原設定，未使用卡時應付6元

#### Scenario: 無效設定
- **WHEN** 傳入未知color_mode／duplex／fit_mode或超過20字取件時間
- **THEN** 回400，不能建立訂單

### Requirement: 分頁歷史與相容格式
系統 SHALL 依trim後姓名查詢、最新id優先；帶page回items／total／page／page_size／total_pages，page_size上限預設200；不帶page保留陣列與棄用標頭、上限200。公開歷史不得包含卡代碼、finance_key、physical_path或現金備註。

#### Scenario: 分頁與舊呼叫
- **WHEN** 同一姓名有205筆訂單，以page=2、page_size=50及無page查詢
- **THEN** 新格式回50筆、total=205、total_pages=5；舊格式只回200筆且有X-Deprecation-Warning

### Requirement: 檔案存取及訂單狀態
系統 MUST 對管理原檔與狀態操作要求Basic Auth；前台預覽必須符合訂單姓名。PDF支援200／206／416；歷史狀態唯讀且已付款優先。取消訂單不能再更新狀態；已有實收或全額折抵不可直接改回未付款。

#### Scenario: 姓名不符合
- **WHEN** 預覽存在訂單而user_name不同
- **THEN** 回403，不提供PDF

#### Scenario: Range與狀態
- **WHEN** 正確姓名要求前10 bytes，或管理員更正正常訂單列印狀態
- **THEN** Range回206及原bytes，狀態修改持久化；前台不可自行更正

### Requirement: 後台訂單統計與搜尋
後台 `GET /api/orders` 分頁格式 MUST 回傳 `summary`，內容為全庫未取消訂單的 `unpaid_count`、`unpaid_amount`、`unprinted_count`、`unprinted_pages`，不受分頁與 `search` 影響；`unpaid_amount` 依 `max(0, total_price - gift_card_discount)` 加總。系統 SHALL 接受選填 `search`（最多 64 字），以姓名包含比對；`search` 為純數字時也比對訂單編號。萬用字元必須當成一般文字。不帶 page 的舊陣列格式 MUST 維持不變。

#### Scenario: 超過一頁的統計
- **WHEN** 有 60 筆未付款、未列印的訂單，管理員以 page=1、page_size=50 查詢
- **THEN** items 只有 50 筆，但 summary.unpaid_count=60，unpaid_amount 與 unprinted_pages 為 60 筆的總和

#### Scenario: 搜尋姓名或編號
- **WHEN** 管理員以 page=1 與 search=王 或 search 等於某訂單編號查詢
- **THEN** 只回傳姓名包含「王」或編號相符的訂單，total 為篩選後筆數，summary 仍為全庫統計

#### Scenario: 萬用字元不擴大結果
- **WHEN** search=%
- **THEN** 只回傳姓名真的含有「%」的訂單
