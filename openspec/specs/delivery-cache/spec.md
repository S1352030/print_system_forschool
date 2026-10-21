# delivery-cache Specification

## Purpose

保護版本化建置、壓縮、快取與低資源部署。依賴Vite、main、compression、SW、deploy；驗收Node SW tests、test_pdf_pipeline、browser_service_worker_smoke、verify-build。

## Requirements

### Requirement: 前後端版本與資源預算
系統 MUST 依APP_BUILD_ID提供匹配HTML及雜湊assets，缺產物fail fast；health分別回build_id與frontend_build_id。初始PDF.js不進bundle，首頁初始JS／CSS最多4請求、100KiB Brotli，無外部Google Fonts或source maps。

#### Scenario: 正式release驗證
- **WHEN** 建立版本產物並生成Brotli／Gzip
- **THEN** verify-build驗證引用／sidecar解壓／metadata／資源預算，錯誤即失敗

### Requirement: 敏感回應禁止快取
系統 MUST 對Authorization請求、HTTP錯誤、後台、訂單／卡API及PDF／health套用no-store；無query版本build／PDF.js才immutable，首頁瀏覽器no-cache／edge一小時，公開公告五分鐘，SW本體no-cache／edge no-store。

#### Scenario: 敏感與query變體
- **WHEN** SW遇到API／後台／認證或版本資源query，或origin回錯誤
- **THEN** 不寫Cache API，錯誤／敏感origin回no-store

### Requirement: 壓縮協商及可靠更新
系統 SHALL 正確處理br／gzip／identity及q值、representation ETag／304／Vary；過期sidecar退回原檔。SW首次接管不reload、後續更新同頁最多一次；navigation preload／背景快取失敗不得破壞成功網路回應。

#### Scenario: 快取故障及离線
- **WHEN** Cache API配額不足、讀寫失敗或網路不可用
- **THEN** 成功網路回應仍可用，离線有可用首頁則回快取，無快取回503

### Requirement: 部署與回復證據
系統 SHALL 保留單worker、鎖定依賴、SQLite online backup／integrity、隔離建置、全部後端回歸與版本健康檢查後切版；回復程式／依賴不等於資料庫回復。正式部署／資料還原需明確授權。

#### Scenario: 本機品質初始化
- **WHEN** 執行health檢查
- **THEN** 只產生QA產物與報告，不執行正式部署／purge／資料還原
