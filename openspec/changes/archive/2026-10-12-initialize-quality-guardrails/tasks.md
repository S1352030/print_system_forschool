## 1. 盤點與規格
- [x] 1.1 完整盤點来源／API／DB／授權／部署／Git及31條Changelog，交叉核對矛盾。
- [x] 1.2 建立ARCHITECTURE及六份現況規格、AGENTS、品質／回復文件与風險登錄。
- [x] 1.3 查核官方OpenSpec／Codex相容性、精確鎖定工具与完成唯一初始化。

## 2. 防護實作
- [x] 2.1 保留既有測試，建立API／DB固定契約与核心授權／公告／分頁／計價／限流案例。
- [x] 2.2 建立JS／Python依賴邊界、語法／紀錄检查、完整gate与逐步報告。
- [x] 2.3 建立CI／每週檢查，部署pytest改全部tests，不改業務／正式環境。

## 3. 驗收與證據
- [x] 3.1 完整gate實際執行，記錄Node／pytest／OpenSpec／架構／build／壓縮結果。
- [x] 3.2 Chromium與WebKit瀏覽器流程驗證，確認QA正式建置禮物卡／重送／取消。
- [x] 3.3 驗證負向架構probe與不支援runtime不会回綠，確認原始DB及歷史保留。
- [x] 3.4 在現有Changelog新增三區塊紀錄，完成初始化報告；區分候選与stable，不自動提交／部署。
