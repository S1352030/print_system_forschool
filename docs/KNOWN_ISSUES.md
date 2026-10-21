# 風險、技術債與待辦

盤點日期2026/10/12；P0=資料遺失／安全漏洞／核心無法使用，P1=重要功能或安全高風險，P2=架構／測試／長期可靠性，P3=小型維護。下列區分已確認來源行為與尚未確認正式故障；未證實的風險不標為正式事故。初始化不以大規模重構處理。

| ID／級別 | 證據、影響及狀態 | 建議與驗收 |
| --- | --- | --- |
| SEC-01 P1 | main preview只比對姓名；history以姓名公開查詢。來源已確認，姓名可猜且非登入。是否曾發生未授權存取未知 | 另提不可猜的訂單取件／預覽憑證及相容期，保護舊資料；驗收不同持有人／猜測姓名不可讀PDF，不在初始化擅改API |
| SEC-02 P1 | config.py預設admin／admin123，無正式模式fail-fast。來源已確認，正式.env是否覆寫未知，不能宣稱正式弱密碼漏洞 | 部署前確認非預設帳密；獨立任務設生產必要秘密及啟動保護，不記錄真实密碼 |
| DATA-01 P1 | main.delete_order與cleanup先移除PDF再commitDB，commit失敗無法恢復已刪PDF；cleanup刪檔失敗仍刪DB。來源已確認，尚無真實遺失證據 | 另提隔離刪除／可復原tombstone及重試，加入故障注入，帳目保留仍為硬約束；勿以恢復舊DB直接覆蓋現金帳 |
| DATA-02 P2 | 上傳雖可處理rollback，os.replace與DB commit跨兩種儲存，崩潰間隙可留孤兒PDF；現有清理只.part／已完成訂單 | 先做只讀檔案對帳報告，後提有證據的保留與修復策略；禁止自動猜孤兒刪除 |
| OPS-01 P1 | 增量遷移只有upgrade；deploy回程式／依賴不回DB。初始化未災難還原演練 | 在隔離備份驗integrity、餘額與uploads對帳，定義新舊版相容與停寫／恢復；正式資料還原另需授權 |
| SEC-03 P2 | main只在可信TCP來源解析最左XFF；Uvicorn可能預先解析代理標頭，正式proxy chain與strip策略未知 | 別以單元直連測試推定反代安全；獨立審查Uvicorn forwarded-allow-ips、nginx／Cloudflare鏈及偽造IP實測 |
| ARCH-01 P2 | notify.py自行dotenv／env、log_manager自行讀LOG_LEVEL，與集中Settings歷史敘述有差異；async通知wrapper目前無呼叫 | 小型另案統一來源／查明未用wrapper，保留LINE空設定安全略過与notification失敗不阻擋訂單；不為整潔立即刪除 |
| API-01 P2 | main GET／HEAD共用api_route使FastAPI生成重複operation ID warning。已在契約捕捉時重現，HTTP功能仍通過 | 若生成SDK，先另提operation ID穩定化；本基準忽略operationId及文案但保護security／參數／schemas |
| CI-01 P2 | 原先无CI；本輪已配置但未推送，遠端workflow／branch protection尚未驗證 | 推送經授權後執行CI，儲存庫管理員設定必需job；CI檔案存在不等於合併強制受保護 |
| TEST-01 P2 | pytest共用test_pdf_pipeline的import-time隔離、單一測試DB；gift與core引用該模組，不適合pytest-xdist平行 | 先維持單進程；後提conftest fixtures隔離、測試後清理。勿並行跑多個會共享來源sidecar的pytest |
| TEST-02 P2 | 實機iPhone／Android、真人無障礙、LINE正式傳達、印表機設定及正式台灣測速未驗證 | 採部署後人工验收清單，browser模擬只证明本機行為 |
| TEST-03 P2 | 2026/10/21 二分確認：只改手機版（≤680px）`.pdf-placeholder` 尺寸（display:none、單行、或只把 min-height 改 120px），Playwright WebKit（iPhone 14）在 browser_preview_smoke 切到歷史訂單或開始繪製 PDF 時穩定 Page/Target crashed；還原即通過，Chromium 不受影響。原因未知，是否影響真實 iOS Safari 未驗證 | 改手機版預覽區版面前先在真實 iPhone 與較新 WebKit 重現並縮小範圍；修正前保持 placeholder 原狀，不以跳過 WebKit 讓檢查變綠 |
| MAINT-01 P2 | 無全面lint／型別檢查、相似邏輯／未用export語意掃描；此輪語法／依賴／整份相同模組檢查有界限 | 後續按高風險模組逐步引入，不為全域規則大改穩定來源；孤立模組警告需人工核實 |
| MAINT-02 P3 | git追蹤orders.db但檔案0bytes；有效DB是db.sqlite3，歷史誤稱排除 | 記錄並待使用者同意後另案移出Git，初始化保留 |
| MAINT-03 P3 | QA唯一build／報告／合成temp長期執行會占空間 | 依QUALITY.md人工確認安全路徑後清理過期qa產物；不能刪正式release或他人未提交檔 |

沒有可靠證據顯示當前正式P0事故，不能由程式盤點宣稱正式站穩定或無安全漏洞。已完成的流程修補：Changelog解除忽略、Playwright入鎖、部署pytest涵蓋全部測試、OpenSpec／架構／契約／CI與上下文文件。

後續優先：SEC-01／SEC-02與DATA-01／OPS-01需獨立需求與規格；確認正式設定及還原方案後再局部修補。每項修復保留復現、驗收測試與Changelog；未驗證項不得標完成。
