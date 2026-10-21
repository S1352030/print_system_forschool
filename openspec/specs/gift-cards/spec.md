# gift-cards Specification

## Purpose

保護實收差額、持代碼折抵、取消退款與獨立帳目。輸入採整數新台幣及UUID，依賴gift_cards、main、database、schemas、前後台gift-card模組。驗收在test_gift_cards及browser_gift_cards_smoke。

## Requirements

### Requirement: 實收差額自動發卡
系統 MUST 由管理員輸入cash_received，實收不足拒絕、剛好不發卡、多付金額减amount_due自動發不設期限的禮物卡。金額限0至1000000整數，不接受布林／字串／小數；重複收款拒絕。

#### Scenario: 三元收到五元
- **WHEN** 應付3元的未收款訂單實收5元
- **THEN** 訂單已付款、實收5、發卡2元；相同UUID與内容重送回相同結果

#### Scenario: 不足與變更重送
- **WHEN** 應付3元只收2元，或同一UUID換成不同實收
- **THEN** 不足回400，內容變更回409，不發新卡

### Requirement: 折抵與並行冪等
系統 MUST 在讀取餘額前取得SQLite BEGIN IMMEDIATE鎖，以min(balance,total_price)折抵並比對expected_discount；訂單、扣卡、交易帳與OperationReceipt同一transaction提交，不能重扣或超扣。全額折抵直接已付款。

#### Scenario: 五元訂單折抵兩元
- **WHEN** 有效卡餘額2，上傳原價5且expected_discount=2
- **THEN** 應付3、餘額0；同UUID同PDF重試回原訂單不再扣款

#### Scenario: 過期試算與競爭
- **WHEN** 餘額不同於預期、卡停用、並行請求使用同一餘額或commit失敗
- **THEN** 回409或相應失敗，不超扣、不留下失敗訂單／PDF／帳目

### Requirement: 取消與獨立帳目
系統 SHALL 只允許管理員取消未列印訂單，折抵退回原卡一次，即使卡停用；回cash_refund_due供人工退款，原多付款所發卡保留。一般刪除及逾期清理不退款且保留卡／帳目／收據。

#### Scenario: 重複取消
- **WHEN** 折抵2元訂單取消及重送
- **THEN** 原卡最多退2元；相同UUID回原結果，不產生第二筆refund

#### Scenario: 已列印或清理
- **WHEN** 取消已列印訂單，或刪除／清理舊訂單
- **THEN** 已列印取消回409；刪除／清理不連帶刪除財務紀錄、不改卡餘額

### Requirement: 代碼與交易資料保密
系統 MUST 以POST body公開查卡，只回balance及is_active；管理搜尋／啟停／詳細帳目要求Basic Auth，代碼不進URL、公開歷史或SQL參數日誌；所有卡回應no-store。

#### Scenario: 公開與管理查詢
- **WHEN** 公開持有效代碼查餘額或未授權存取管理明細
- **THEN** 公開只得餘額與狀態；管理回401，不洩漏完整帳目
