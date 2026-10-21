# AI長期迭代防護初始化報告

日期2026/10/12（Asia/Taipei）。初始化前來源HEAD `8371b83687c4e69c2dbefdc1017ad838c99a1eda`、main工作目錄乾淨；本次分支 `codex/ai-quality-guardrails`。完整需求按使用者附件執行，未覆蓋未提交工作或改寫業務。

## 架構與歷史整合

原生HTML／CSS／ES Modules＋Vite8.1.5，多頁前後台与自架PDF.js5.7.284；FastAPI／Pydantic／SQLAlchemy／SQLite WAL，单workerPM2＋APScheduler＋Cloudflare分層快取。核心為PDF收件／頁數計價／Range預覽／歷史、管理公告与狀態、禮物卡實收差額／折抵／取消／獨立帳目，沒有會員或自動出紙。

原31條Changelog完整保留，解除Git忽略，新增本次記錄；交叉分析與舊設計替代見CHANGELOG_REVIEW.md。已有的core、PDFengine、API與資料模型基準在ARCHITECTURE與六份OpenSpec主規格。明確禁止無需求恢復二次登入、舊loader／window橋接、inline事件、外部字型与舊快取流程。

## 已配置防護

OpenSpec1.14.1專案初始化與六個Codexskills；AGENTS／局部標準流程；dependency-cruiser18.6.0＋PythonAST；Playwright1.64.0鎖定；API／ORM契約；統一quality／health報告；PR／push／每週CI及Changelog檢查；deploy保留回復並補齊全部pytest。沒有新增Beads、全域lint或型別重構。

## 驗證狀態

初始化前既有43Node與37pytest已實際通過。新增22個核心回歸涵蓋管理端點未授權、鎖定／恢復、公告CRUD／驗證、分頁新舊格式／隱私、兩色實際計價與Range、限流／IP與契約；新增5項工具測試保護測試摘要與跳過判定。

| 實際檢查 | 結果及證據 |
| --- | --- |
| Node前端／工具回歸 | 48通過，0失敗／skip／cancel；包含原43案例 |
| pytest後端 | 59通過，0失敗／skip，兩項既有OpenAPI operationId警告已登錄 |
| JavaScript／Python語法 | 全部通過；Python只AST解析，不import正式應用 |
| dependency-cruiser | 20模組、41依賴，0違規；Python10根模組0違規 |
| OpenSpec strict | 六份主規格通過；初始化tasks完成並於`openspec/changes/archive/2026-10-12-initialize-quality-guardrails/`歸檔 |
| Vite／sidecar／verify-build | Node22.23.2正式QA產物通過；首頁4請求、24,530 Brotli bytes，小於100KiB |
| Chromium | 真實SW預載／单次更新／离線／配額、Pixel7預覽與上傳通過 |
| WebKit | iPhone14模擬的前後台預覽／操作通過，沒有略過 |
| 禮物卡真實FastAPI＋建置前端 | 桌面／手機收款發卡、多檔折抵、取消退款與遺失回應後重送通過 |
| 負向防護 | 刻意JS／Python循環、前台／共用核心跨後台引用被拒絕；Node26為blocked；fast模式partial且非0 |
| 歷史／原資料保留 | 原31條歷史逐位元組相同；db.sqlite3 SHA-256保持`da8e4633d1d5f205bc8632076867c8e4c57e4dc50eadfa1dae96878e1a844975` |

完整gate原始證據：`.quality-reports/latest.json`／`latest.md`與各QA ID日誌。初次全套成功run為`qa-1791811430446-2f37d71f`；完成文件與狀態後再次執行完整gate，最新來源指紋以latest為準。負向證據在`guardrail-probes.json`、`unsupported-runtime.json`、`fast-mode.json`。規格／文件語意、相似邏輯与未用export仍需人工審查。

首次沙箱pytest／OpenSpec遇到Windows目錄存取限制，後端改在允許的隔離環境重跑；新增限流測試初稿誤把啟動时捕捉的Settings視為動態值，已修正測試以實際門檻驗證，未改業務或降低預期。所有中途失敗需與最終結果分開記錄。

## 穩定性、債務及尚未建立驗收

目前具體問題与優先順序見KNOWN_ISSUES.md：姓名弱識別、預設帳密無生產防呆、刪檔／commit復原缺口、資料回復尚未演練；另有設定來源分散、重複OpenAPIoperationId、測試fixture耦合與空殼orders.db。這是來源證據與風險，沒有本輪證據指向正式P0事故。

未建立／未完成：真實手機与印表機、正式LINE傳達、正式台灣效能／Cloudflare規則確認、災難恢復對帳、全面lint／型別与相似邏輯語意掃描。CI檔案已建立但未推送／未跑遠端CI，branch protection未配置。

## 版本結論與後續規範

本次未自動commit／push／tag／部署。已建立可重跑的功能／架構／契約基準與「已測試工作目錄候選」；未建立已知正式穩定tag，原HEAD不因此成為stable。持久穩定基準還需授權提交、乾淨commit完整gate與CI、必要正式／實機驗收及回復證據。後續AI按AGENTS→相關主規格→影響分析→局部實作→完整回歸→原Changelog／tasks／報告流程。
