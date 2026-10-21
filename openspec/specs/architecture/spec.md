# architecture Specification

## Purpose

保護原生前端、FastAPI／SQLite及共用PDF核心的責任邊界。現況與資料流見ARCHITECTURE.md；不得因工具初始化改寫業務。

## Requirements

### Requirement: 明確模組邊界與無循環
系統 MUST 保持功能模組不依賴入口、前台不依賴管理UI、共用核心不依賴業務UI；Python下層不得反向依賴main，新增模組需同步邊界與規格。

#### Scenario: 新增反向依賴
- **WHEN** upload import app、共用API import後台，或gift_cards import main
- **THEN** dependency-cruiser或Python AST檢查失敗，提供具體引用證據

#### Scenario: 正常既有依賴
- **WHEN** 檢查現有來源
- **THEN** JS與Python依賴檢查通過，不以基準豁免掩蓋循環

### Requirement: 共用PDF核心與原檔保存
系統 SHALL 由pdf-engine／pdf-preview-controller／pdf-paper提供前後台預覽，保存上傳原始PDF，fit／cover僅為預覽與列印偏好；不得重建舊loader、全域PDF API或伺服器逐頁轉圖。

#### Scenario: 預覽同一文件
- **WHEN** 前台或後台開啟PDF、翻頁、變更縮放或關閉
- **THEN** 同一套控制器處理取消與釋放、單canvas及記憶體上限，原檔內容保持一致

### Requirement: 文件與來源交叉驗證
開發流程 MUST 把主規格視為目前有效要求，Changelog視為歷史；機器契約變更需需求與相容性審查，語意一致性仍人工確認。

#### Scenario: 舊紀錄與目前行為不同
- **WHEN** 舊紀錄提到inline handlers、二次登入或舊PDF.js
- **THEN** 查核現有來源與測試並記錄替代，不自動恢復舊設計
