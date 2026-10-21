# quality-workflow Specification

## Purpose

讓每輪AI修改可驗證、可追蹤及可安全回復。流程與指令見AGENTS.md及docs/QUALITY.md；初始化風險登錄見KNOWN_ISSUES.md。

## Requirements

### Requirement: 每輪修改與持久上下文
開發流程 MUST 修改前檢查Git與相關模組，先影響分析，中大型修改先OpenSpec規格；局部實作、禁止無關重寫與重複功能。完成後更新相關規格、架構及原Changelog，不覆蓋歷史／使用者修改。

#### Scenario: 新對話接續
- **WHEN** AI恢復或開始新對話
- **THEN** 從AGENTS、相关spec、来源、测试及风险登錄了解目前狀態，不依賴對話記憶猜測

### Requirement: 完整門檻與誠實報告
品質入口 MUST 執行語法、JS／Python邊界、OpenSpec strict、紀錄、全部Node／pytest、build／預壓縮／verify及Chromium瀏覽器回歸，保存每項結果、revision、dirty狀態與限制。缺必要工具或省略required檢查不能回完整成功。
品質入口 MUST 檢查完整測試摘要、禁止skip／cancel／xfail／deselect，並符合經審查的最低案例數（本次Node48、pytest59）；不能因測試指令退出0而忽略未執行的測試。

#### Scenario: 快速檢查或缺瀏覽器
- **WHEN** 執行check:fast或Chromium缺少
- **THEN** 報告partial／failed及not-run／failed，退出碼非0；不宣稱完整通過或stable

### Requirement: 契約基準與測試品質
流程 MUST 比對實際OpenAPI與ORM結構基準，需求改變先規格與相容審查再修改基準；不得刪除正確測試、降低預期或停用授權讓檢查通過。

#### Scenario: 公開API或資料結構漂移
- **WHEN** 未經確認改變參數／request schema／security或資料欄位
- **THEN** 契約回歸失敗，要求檢查規格與資料相容方案

### Requirement: 開發候選與已知穩定區分
流程 SHALL 保留Git歷史、用codex分支處理重大修改；測試通過仍為候選，乾淨提交、CI及必要正式／實機验收與回復證據確認才經授權標stable。禁止hard reset、未授權force push／部署／破壞性遷移。

#### Scenario: 初始化完成但未提交
- **WHEN** 全部本機檢查通過但工作目錄仍dirty
- **THEN** 記錄來源HEAD與差異為已測試工作目錄候選，不對原HEAD建立stable tag

### Requirement: 定期發現問題
健康檢查 MUST 只產生證據與報告，不自動大規模重寫；CI每週及PR／push執行，P0至P3以可靠證據登錄，推測不得宣稱已確認故障。

#### Scenario: CI發現退化
- **WHEN** 排程或PR檢查失敗
- **THEN** 保存日誌供定位，按具體修改任務修復，不自動部署或降低門檻
