## MODIFIED Requirements

### Requirement: 完整門檻與誠實報告
品質入口 MUST 執行語法、JS／Python邊界、OpenSpec strict、紀錄、全部Node／pytest、build／預壓縮／verify及Chromium瀏覽器回歸，保存每項結果、revision、dirty狀態與限制。缺必要工具或省略required檢查不能回完整成功。
品質入口 MUST 檢查完整測試摘要、禁止skip／cancel／xfail／deselect，並符合經審查的最低案例數（本次Node48、pytest59）；不能因測試指令退出0而忽略未執行的測試。

#### Scenario: 快速檢查或缺瀏覽器
- **WHEN** 執行check:fast或Chromium缺少
- **THEN** 報告partial／failed及not-run／failed，退出碼非0；不宣稱完整通過或stable
