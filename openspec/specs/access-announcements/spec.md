# access-announcements Specification

## Purpose

保護既有原生Basic Auth、限流、姓名識別與公告CRUD，不虛構會員／登入登出。依賴main、schemas、database、admin/announcements；驗收test_core_contracts。

## Requirements

### Requirement: 管理操作授權與失敗鎖定
系統 MUST 對後台、訂單管理與原檔、公告寫入、禮物卡管理／收款／取消要求HTTP Basic Auth並constant-time比對；同IP＋username連續失敗預設5次鎖15分鐘，回423及Retry-After。不能恢復前端第二次登入彈窗。

#### Scenario: 未提供憑證
- **WHEN** 存取任一管理讀寫操作
- **THEN** 回401及WWW-Authenticate Basic，回應no-store

#### Scenario: 鎖定與到期
- **WHEN** 同帳號連續失敗到門檻後使用正確帳密，並在鎖定到期後再試
- **THEN** 鎖定期間仍423，到期正確帳密可成功

### Requirement: IP限流與反代邊界
系統 SHALL 依端點類型及Settings限制滑動視窗請求，超限回429與Retry-After；只在TCP來源符合可信代理CIDR時信任轉送IP。單worker是目前前提，反代完整鏈仍需正式設定審查。

#### Scenario: 未可信來源偽造XFF
- **WHEN** 直連來源203.0.113.42帶X-Forwarded-For=1.2.3.4
- **THEN** 仍使用203.0.113.42限流，不以偽造IP繞過

### Requirement: 公告CRUD與可見性
系統 SHALL 公開只回啟用公告；管理員可新增、修改內容／啟停、刪除。內容trim後不可空、長度最多1000；無效422、不存在404。公開無query讀取五分鐘快取，管理／寫入no-store。

#### Scenario: 停用公告
- **WHEN** 管理員新增公告再is_active=false
- **THEN** 公開列表不顯示、管理列表仍可查看，刪除後查／改不存在回404

#### Scenario: 空白內容
- **WHEN** 新增或修改只含空白的公告
- **THEN** 回422且保留原資料
