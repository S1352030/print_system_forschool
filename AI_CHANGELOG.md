# AI Changelog

### [2026/10/25 17:00] - 修正 GitHub CI 瀏覽器測試因 Socket 路徑過長而失敗

**1. 改了哪裡 (What changed):**
- 修改的檔案路徑：`scripts/run-browser-tests.mjs`
- 具體變更：非 Windows 平台在 `/tmp/psqa-XXXXXX` 建立短暫存目錄，只給瀏覽器測試作為 `TMP`／`TEMP`／`TMPDIR`，結束後刪除；Windows 維持原行為。

- 修改的檔案路徑：`.github/workflows/quality.yml`
- 具體變更：`upload-artifact` 加上 `include-hidden-files: true`，讓 `.quality-reports/` 能上傳。

**2. 為什麼要改 (Why it changed):**
- 原始問題或動機：CI 的 `browser` 檢查失敗，Chromium 回報「Socket path too long」。`isolatedEnv()` 把 TMPDIR 指到 `/home/runner/work/.../.quality-reports/tmp`，SingletonSocket 路徑超過 Unix socket 約 108 位元組上限。
- 決策原因：只縮短瀏覽器子程序的暫存路徑；其他檢查仍使用專案內隔離暫存區，未跳過或降低任何測試。upload-artifact v4 預設略過隱藏資料夾，導致品質報告從未上傳。

**3. 後續影響與注意事項 (Impact & Watchouts):**
- 本機 Windows 無法重現此 Linux 限制；修正需以下一次 GitHub Actions 結果確認。
- 瀏覽器暫存檔改在系統 `/tmp`，仍為每次執行專屬目錄並於結束時清除。

### [2026/10/21 21:45] - 歸檔 align-m3-ui-and-admin-summary 規格變更

**1. 改了哪裡 (What changed):**
- 新增的檔案路徑：`openspec/specs/interface-design/spec.md`
- 具體變更：由歸檔建立新主規格（共用 M3 token、可用鍵盤操作的開關、行動版表單版面），並補上 Purpose。

- 修改的檔案路徑：`openspec/specs/print-orders/spec.md`
- 具體變更：併入「後台訂單統計與搜尋」需求（全庫 summary 與選填 search）。

- 新增的檔案路徑：`openspec/changes/archive/2026-10-21-align-m3-ui-and-admin-summary/`
- 具體變更：原變更移入歸檔，tasks 4.4 記錄使用者已核准 contracts.json 的 search 差異。

**2. 為什麼要改 (Why it changed):**
- 原始問題或動機：使用者審查並核准契約差異（新增選填 search 參數），變更的 12 項任務全部完成。
- 決策原因：依 AGENTS.md，契約經人工審查且驗收通過後才歸檔，讓主規格反映目前行為。

**3. 後續影響與注意事項 (Impact & Watchouts):**
- 程式碼未變更；主規格現有七份，interface-design 為新能力。
- 仍未在真實手機與正式站驗收，屬「已測試」而非 stable。

### [2026/10/21 21:33] - 後台訂單搜尋參數由 q 改名為 search

**1. 改了哪裡 (What changed):**
- 修改的檔案路徑：`main.py`
- 具體變更：`GET /api/orders` 的選填查詢參數 `q` 改名為 `search`，函式內的區域變數改為 `term`，避免和參數同名；行為不變。

- 修改的檔案路徑：`static/js/admin/orders.js`
- 具體變更：後台搜尋改送 `&search=`。

- 修改的檔案路徑：`tests/test_core_contracts.py`、`tests/browser_gift_cards_smoke.mjs`、`tests/fixtures/contracts.json`
- 具體變更：測試請求與契約基準改用 `search`。

- 修改的檔案路徑：`ARCHITECTURE.md`、`openspec/changes/align-m3-ui-and-admin-summary/`
- 具體變更：API 表、proposal、design、tasks 與 print-orders delta spec 改用 `search`，design 記錄命名理由。

**2. 為什麼要改 (Why it changed):**
- 原始問題或動機：審查契約差異時，使用者指出 `q` 不如 `user_name`、`page_size` 等既有參數明確。
- 決策原因：禮物卡搜尋 API 已使用 `search`，改名後兩個後台搜尋命名一致；參數尚未推送或部署，沒有呼叫端需要相容處理。

**3. 後續影響與注意事項 (Impact & Watchouts):**
- 上一條紀錄（2026/10/21 19:49）提到的 `q`，現在一律稱為 `search`。
- 契約差異仍需使用者最後確認，之後才歸檔 OpenSpec 變更。

### [2026/10/21 19:49] - 後台改用 Material 3 共用主題並修正統計、隱藏與手機版版面

**1. 改了哪裡 (What changed):**
- 修改的檔案路徑：`main.py`
- 具體變更：`GET /api/orders` 分頁格式新增全庫 `summary`（未付款筆數／金額、待列印筆數／頁數），新增選填 `q`（姓名包含、純數字時比對編號，萬用字元跳脫）；舊陣列格式不變。

- 修改的檔案路徑：`static/material-common.css`
- 具體變更：接收原本 style.css 的 M3 token、六組配色、`html.dark` 與 `.hidden`，成為前後台共用主題來源。

- 修改的檔案路徑：`style.css`
- 具體變更：移出共用 token；取件時間改短標籤加輔助說明；禮物卡按鈕不換行、48px；歷史 badge 與 tooltip、spinner 改用 token；新增手機版「預覽」按鈕樣式。

- 修改的檔案路徑：`admin.css`
- 具體變更：以 M3 token 重寫後台樣式（頂部應用列、統計卡、tonal／outlined／text 按鈕、可聚焦 switch、chips、snackbar、按鈕群組），跟隨深淺模式與配色；刪除與 pdf-preview.css 重複的 PDF 框樣式。

- 修改的檔案路徑：`admin.html`
- 具體變更：訂單區塊移到統計卡下方並加入搜尋欄；以 SVG 圖示取代 emoji；「待列印份數」改為「待列印頁數」；加入 `<main>` 與 section 標題。

- 修改的檔案路徑：`static/js/admin/orders.js`
- 具體變更：統計改用伺服器 summary（沒有時退回已載入資料）；新增搜尋與過期回應防護；狀態更新／刪除後重新取得 summary；開關加上 `role="switch"` 與 aria-label；「刪除」與「取消訂單」分開並移除 emoji。

- 修改的檔案路徑：`static/js/admin/app.js`、`static/js/admin/announcements.js`
- 具體變更：綁定搜尋欄（300ms debounce）；公告開關加上 switch 語意、移除 emoji。

- 修改的檔案路徑：`index.html`、`static/js/upload.js`、`static/pdf-preview.css`
- 具體變更：取件時間欄位加 aria-describedby；PDF 預覽卡加 `pdf-preview-card`；手機版檔案卡新增「預覽」按鈕並捲到預覽卡；PDF 控制列改用 M3 docked toolbar 的 surface 色。

- 修改的檔案路徑：`tests/test_core_contracts.py`、`tests/browser_gift_cards_smoke.mjs`、`tests/fixtures/contracts.json`
- 具體變更：新增跨頁統計／搜尋／萬用字元 pytest（後端 60 案例，最低門檻維持 59）；瀏覽器驗證 summary、載入更多隱藏、鍵盤切換開關、搜尋、深淺模式及手機版版面；契約手動加入選填 `q`。

- 修改的檔案路徑：`ARCHITECTURE.md`、`docs/KNOWN_ISSUES.md`
- 具體變更：記錄共用 token 來源與 `/api/orders` 的 summary／q；新增 TEST-03（手機版 placeholder 版面改動使 WebKit 崩潰）。

- 新增的檔案路徑：`openspec/changes/align-m3-ui-and-admin-summary/`
- 具體變更：proposal、design、tasks 與 print-orders／interface-design delta specs。

**2. 為什麼要改 (Why it changed):**
- 原始問題或動機：使用者要求依 Material 3 Expressive 修正不合規處。實測發現後台統計只算前 50 筆會少算未付款、`admin.css` 缺 `.hidden` 使「載入更多（還剩 0 筆）」常駐、已列印開關無法用鍵盤操作，後台也沒有跟隨主題；前台手機版預覽卡離檔案設定太遠、標籤被截斷、按鈕換行。
- 決策原因：token 集中到兩頁已 import 的共用檔，不增加請求；保留所有 JS／測試使用的 class 與 data 屬性，只換樣式，避免重寫模組；統計交給伺服器計算才能跨頁正確；不導入 @material/web（僅維護、無 Expressive 元件）。

**3. 後續影響與注意事項 (Impact & Watchouts):**
- API 為相容新增；`tests/fixtures/contracts.json` 的 `q` 參數需人工審查。
- 部署需照常重新建置與預壓縮；後台色彩會隨使用者系統深淺模式與隨機配色改變，屬刻意行為。
- 手機版 `.pdf-placeholder` 版面刻意未改：二分測試確認任何手機版尺寸改動（隱藏、單行、甚至只改 min-height）都會讓 Playwright WebKit 在 browser_preview_smoke 穩定崩潰，原因未查明，已記入 docs/KNOWN_ISSUES.md（TEST-03）。
- 未在真實 iPhone／Android 與正式站驗收。

### [2026/10/12 21:23] - 建立AI長期迭代規格、架構防護與自動回歸品質系統

**1. 改了哪裡 (What changed):**
- 新增的檔案路徑：`AGENTS.md`
- 具體變更：建立持久上下文、局部修改、授權／契約／回歸與版本狀態規則。

- 新增的檔案路徑：`ARCHITECTURE.md`
- 具體變更：記錄現行模組、API、資料模型、資料流、快取與不可破壞的邊界。

- 新增的檔案路徑：`README.md`
- 具體變更：提供開發、品質與規格文件入口。

- 新增的檔案路徑：`docs/QUALITY.md`
- 具體變更：定義工具設定、完整檢查、OpenSpec流程、CI及不丟資料的回復邊界。

- 新增的檔案路徑：`docs/CHANGELOG_REVIEW.md`
- 具體變更：核對原31條歷史的功能、替代、反覆問題及矛盾，保留原始歷史。

- 新增的檔案路徑：`docs/KNOWN_ISSUES.md`
- 具體變更：以P1至P3與具體來源證據登錄安全、資料、部署與測試債務。

- 新增的檔案路徑：`docs/INITIALIZATION_REPORT.md`
- 具體變更：記錄盤點、配置、實際驗證狀態與穩定候選限制。

- 修改的檔案路徑：`.gitignore`
- 具體變更：解除Changelog忽略，只納入生成的OpenSpec技能；忽略品質報告與測試產物。

- 修改的檔案路徑：`package.json`
- 具體變更：精確加入OpenSpec、dependency-cruiser與Playwright，新增統一檢查指令。

- 修改的檔案路徑：`package-lock.json`
- 具體變更：鎖定新增開發工具及相依套件，保留Vite版本。

- 新增的檔案路徑：`.dependency-cruiser.cjs`
- 具體變更：檢查循環、未解析引用、入口反向依賴及前後台／共用核心邊界。

- 新增的檔案路徑：`quality/python-boundaries.json`
- 具體變更：保存Python根模組允許依賴，不使用循環豁免。

- 新增的檔案路徑：`quality/test-baseline.json`
- 具體變更：保存初始化前43／37案例與新48／59最低門檻，禁止自行降標。

- 新增的檔案路徑：`scripts/test-policy.mjs`
- 具體變更：判定測試摘要完整性、數量及skip／cancel／xfail／deselect，防止退出0卻漏測。

- 新增的檔案路徑：`tests/quality_policy.test.mjs`
- 具體變更：新增5項工具回歸，驗證缺摘要、案例刪減或跳過測試不能通過。

- 新增的檔案路徑：`scripts/check_python.py`
- 具體變更：以AST檢查語法、引用、循環及重複模組，不匯入業務或開資料庫。

- 新增的檔案路徑：`scripts/check-python.mjs`
- 具體變更：提供跨平台Python架構檢查入口。

- 新增的檔案路徑：`scripts/check-source.mjs`
- 具體變更：驗證應用、測試、工具的JavaScript／Python語法與相同模組。

- 新增的檔案路徑：`scripts/check-governance.mjs`
- 具體變更：檢查必要上下文、Changelog可追蹤及本次改碼需有紀錄。

- 新增的檔案路徑：`scripts/quality-lib.mjs`
- 具體變更：統一安全子程序、隔離暫存與空LINE測試設定。

- 新增的檔案路徑：`scripts/run-backend-tests.mjs`
- 具體變更：使用唯一隔離pytest暫存路徑，執行全部後端回歸。

- 新增的檔案路徑：`scripts/run-browser-tests.mjs`
- 具體變更：依序執行三套既有瀏覽器流程，必要瀏覽器缺少即失敗。

- 新增的檔案路徑：`scripts/quality-check.mjs`
- 具體變更：建立完整／部分門檻、唯一QA建置、來源指紋與逐步日誌報告。

- 新增的檔案路徑：`scripts/compress_qa_build.py`
- 具體變更：只壓縮指定QA新產物，不清理或重寫舊release。

- 新增的檔案路徑：`tests/test_core_contracts.py`
- 具體變更：新增22項API／DB契約、管理授權、登入鎖定、公告、分頁、計價與限流回歸。

- 新增的檔案路徑：`tests/fixtures/contracts.json`
- 具體變更：固定目前OpenAPI／ORM契約，要求先更新規格及審查相容性後才變更基準。

- 修改的檔案路徑：`tests/browser_gift_cards_smoke.mjs`
- 具體變更：允許QA正式建置ID，保留獨立DB與真實收款／折抵／取消／重送流程。

- 新增的檔案路徑：`.github/workflows/quality.yml`
- 具體變更：加入PR、push、手動與每週完整回歸，失敗保存證據，不自動修改或部署。

- 修改的檔案路徑：`deploy.sh`
- 具體變更：保留部署回復，增加規格／語法／架構檢查，pytest改為涵蓋全部tests。

- 新增的檔案路徑：`openspec/config.yaml`
- 具體變更：配置繁體語言、專案架構、驗收與變更artifact規則。

- 新增的檔案路徑：`openspec/specs/architecture/spec.md`
- 具體變更：建立現行行為、錯誤處理、限制與可驗證驗收場景。

- 新增的檔案路徑：`openspec/specs/print-orders/spec.md`
- 具體變更：建立現行行為、錯誤處理、限制與可驗證驗收場景。

- 新增的檔案路徑：`openspec/specs/gift-cards/spec.md`
- 具體變更：建立現行行為、錯誤處理、限制與可驗證驗收場景。

- 新增的檔案路徑：`openspec/specs/access-announcements/spec.md`
- 具體變更：建立現行行為、錯誤處理、限制與可驗證驗收場景。

- 新增的檔案路徑：`openspec/specs/delivery-cache/spec.md`
- 具體變更：建立現行行為、錯誤處理、限制與可驗證驗收場景。

- 新增的檔案路徑：`openspec/specs/quality-workflow/spec.md`
- 具體變更：建立現行行為、錯誤處理、限制與可驗證驗收場景。

- 新增的檔案路徑：`openspec/changes/archive/2026-10-12-initialize-quality-guardrails/`
- 具體變更：保留本次proposal、design、delta與已完成的驗收tasks，使用官方流程歸檔並在gate檢查。

- 新增的檔案路徑：`.agents/skills/openspec-*/SKILL.md`
- 具體變更：由官方初始化生成六個Codex流程技能，保留原有技能。

**2. 為什麼要改 (Why it changed):**
- 原始問題或動機：長期使用Codex迭代，需要防止架構漂移、遺忘現況、破壞舊功能與失去可回復版本；現有Changelog被忽略、瀏覽器依賴未鎖定、部署漏測禮物卡。
- 決策原因：沿用現有原生ESM、FastAPI／SQLite、pytest與Node tests，漸進加入OpenSpec、精確依賴邊界、固定契約與完整gate，不改寫業務或引入額外任務平台。

**3. 後續影響與注意事項 (Impact & Watchouts):**
- 初始化前43項Node與37項pytest已實際通過；現有測試加22项核心与5項工具回歸，合計48項Node與59項pytest通過，Chromium／WebKit及正式QA建置流程亦通過，兩項既有OpenAPI operationId警告已登錄。完整結果與來源指紋見初始化報告與品質日誌。
- 原31條歷史保留；Changelog現在可納入Git，既有私有技能仍忽略，官方生成六個OpenSpec技能例外納入。未自動commit、push、tag或正式部署。
- Node需22 LTS，Python使用專案虛擬環境；新電腦執行npm ci、requirements-dev及相符Playwright瀏覽器安裝。健康檢查只產生QA報告與產物；fast模式為partial且退出非0。
- API、資料庫與原始PDF業務不變；來源已確認的姓名識別、預設帳密、刪檔／DB失敗與資料回復風險留待獨立規格修復。實機／正式環境、遠端CI與branch protection仍待驗證。

### [2026/09/21 22:03] - 新增實收差額自動發卡與禮物卡列印折抵系統

**1. 改了哪裡 (What changed):**
- 修改的檔案路徑：`database.py`
- 具體變更：新增禮物卡、獨立交易帳目及防重複請求紀錄；訂單新增折抵、實收、取消及財務識別欄位，提供可重複執行的舊資料遷移，並隱藏資料庫例外的參數。

- 新增的檔案路徑：`gift_cards.py`
- 具體變更：實作管理員收款自動發卡、餘額查詢、卡片搜尋與啟停、交易明細及取消退款；使用 SQLite 寫入鎖及交易確保不重扣、不重發、不超扣。

- 修改的檔案路徑：`schemas.py`
- 具體變更：新增實收金額、禮物卡查詢及管理、取消請求的型別與金額驗證。

- 修改的檔案路徑：`main.py`
- 具體變更：整合禮物卡 API，上傳成功時原子扣款，回傳原價、折抵及應付金額；保護付款／列印狀態及訂單清理，避免取消或重送造成帳目錯誤。

- 修改的檔案路徑：`notify.py`
- 具體變更：新訂單通知增加原價、禮物卡折抵及剩餘應收金額，未設定 LINE 時略過傳送。

- 修改的檔案路徑：`index.html`
- 具體變更：新增禮物卡代碼欄位、套用與移除按鈕及餘額提示。

- 修改的檔案路徑：`style.css`
- 具體變更：新增沿用現有主題的禮物卡輸入區、觸控按鈕及焦點樣式。

- 新增的檔案路徑：`static/js/gift-card.js`
- 具體變更：管理前台代碼套用、查詢及餘額狀態，防止較舊查詢回應覆蓋新輸入。

- 修改的檔案路徑：`static/js/upload.js`
- 具體變更：整合折抵試算、多檔依序扣款及上傳結果；失敗保留未完成檔案，結果不明時鎖定原請求供重試，避免再次建立訂單或扣款。

- 修改的檔案路徑：`static/js/history.js`
- 具體變更：歷史訂單顯示剩餘應付、禮物卡折抵、全額折抵及取消退回狀態。

- 修改的檔案路徑：`admin.html`
- 具體變更：新增禮物卡管理區、實收金額視窗與交易紀錄視窗。

- 修改的檔案路徑：`admin.css`
- 具體變更：新增響應式卡片列表與置中收款視窗，確保手機操作與代碼顯示不超出畫面。

- 新增的檔案路徑：`static/js/admin/gift-cards.js`
- 具體變更：提供實收差額試算、自動發卡結果與複製、卡片搜尋／啟停／明細，以及取消折抵退款操作。

- 修改的檔案路徑：`static/js/admin/orders.js`
- 具體變更：付款勾選改為收款按鈕；訂單顯示實收與折抵明細，待收款統計採剩餘應付並排除已取消訂單。

- 修改的檔案路徑：`static/js/admin/app.js`
- 具體變更：綁定收款、取消與禮物卡操作，保留舊訂單付款狀態更正入口。

- 修改的檔案路徑：`static/js/api.js`
- 具體變更：正確顯示 Pydantic 驗證錯誤，避免金額輸入錯誤顯示為物件字串。

- 新增的檔案路徑：`tests/test_gift_cards.py`
- 具體變更：新增 12 項測試，涵蓋收款差額、折抵、退款、授權、並行交易、防重複請求、失敗回滾及舊資料遷移。

- 新增的檔案路徑：`tests/browser_gift_cards_smoke.mjs`
- 具體變更：使用獨立測試伺服器驗證桌面／手機收款發卡、多檔折抵、取消退款與回應遺失後重試；支援指定 Python、瀏覽器及截圖目錄。

- 修改的檔案路徑：`package.json`
- 具體變更：新增 test:browser:gift-cards 指令，便於重跑完整禮物卡操作測試。

**2. 為什麼要改 (Why it changed):**
- 原始問題或動機：列印 3 元但收到 5 元時，希望把多付的 2 元保留，讓客人下次列印折抵。
- 決策原因：依使用者最終選擇，管理員只輸入實收金額，系統以「實收－扣除既有禮物卡後的應付」自動算差額並發卡；不建立會員，採持代碼使用、分次扣款及不設期限。交易帳目獨立保存，避免舊訂單清理影響餘額。

**3. 後續影響與注意事項 (Impact & Watchouts):**
- 後台未付款訂單改由「收款」輸入現金；實收不足時不完成收款，剛好時不發卡。已記錄現金或全額折抵的訂單不能直接改回未付款。
- 未列印訂單可取消並退回原卡折抵；現金退款另行處理，畫面提示應退現金金額，原多付款所發的新卡仍保留。一般刪除與定期清理不退款，禮物卡及交易紀錄不隨訂單刪除。
- 代碼為持有者使用憑證；公開查詢只回傳狀態與餘額，代碼查詢透過 POST，不放入網址或公開歷史；管理員可複製代碼及查看交易摘要。
- 37 項後端測試、43 項前端測試、Chromium 桌面／手機禮物卡流程及既有 PDF／Service Worker 瀏覽器測試通過；WebKit 因未有符合版本的執行檔而略過。
- 正式建置與建置驗證通過（首頁初始資源 4 個請求、24,507 Brotli 位元組），已更新來源及 local 建置的預壓縮檔。
- 本次僅修改及驗證本機程式，未部署、未操作正式訂單或發送測試通知；正式上線仍需既有部署流程。新後端啟動時會新增資料表及欄位，保留舊訂單價格與付款狀態。AI_CHANGELOG.md 沿用現有忽略設定，不自動提交。


### [2026/09/19 16:50] - 將歷史訂單改為三階段進度狀態條

**1. 改了哪裡 (What changed):**
- 修改的檔案路徑：`static/js/history.js`
- 具體變更：將付款與列印的兩個獨立標籤改為「未列印 → 已列印 → 已付款」三階段唯讀狀態條，顯示目前階段與進度數字，透過 `aria-current="step"` 標示當前狀態。

- 修改的檔案路徑：`style.css`
- 具體變更：新增三等分圓角狀態條、階段編號及目前階段的主題色塊，沿用深淺色與配色變數，移除不再使用的舊狀態標籤樣式。

**2. 為什麼要改 (Why it changed):**
- 原始問題或動機：使用者希望訂單呈現三個明確狀態，並以類似滑動切換條的外觀顯示目前進度。
- 決策原因：使用唯讀階段列表，保留既有訂單資料欄位並直接計算顯示階段，讓使用者查閱進度且不會誤以為能自行變更狀態。

**3. 後續影響與注意事項 (Impact & Watchouts):**
- 已付款優先顯示第三階段，其次依是否列印顯示第二或第一階段；即使後台只勾選付款，也會顯示已付款。未變更資料庫、API 或後台操作。
- 43 項既有前端測試、正式建置及建置驗證通過；Chromium 已確認四種付款／列印組合、唯讀呈現，以及 320／390／1280 像素的深淺色排版均無文字溢出或瀏覽器執行錯誤。
- 已更新本次修改來源與 `static/builds/local/` 建置的 Brotli／Gzip 預壓縮檔；正式上線仍需依既有部署流程重新建置及預壓縮，本次尚未部署。

### [2026/09/09 10:49] - 優化免費主機網站的導覽預載與背景快取並完成效能驗證

**1. 改了哪裡 (What changed):**
- 修改的檔案路徑：`sw.js`
- 具體變更：啟用 Navigation Preload，優先使用預載回應並在失敗時回退一般請求；快取寫入及容量清理改為透過同步登記的 `event.waitUntil()` 在背景完成。快取讀寫失敗不再破壞成功的網路回應；保留既有快取名稱與首頁網路優先策略，並明確略過認證請求、健康檢查及 Worker 腳本。

- 新增的檔案路徑：`scripts/measure-load.mjs`
- 具體變更：提供可重跑的首次／回訪瀏覽器量測，記錄每次 TTFB、FCP、LCP、資源筆數、傳輸量、Cloudflare 節點與快取標頭，輸出中位數及 P90。支援相同前端建置搭配不同 Worker 的本機比較，以及唯讀正式網址測試；本機測試隔離已知防毒注入腳本，避免污染載入時間。

- 新增的檔案路徑：`scripts/check-cdn.mjs`
- 具體變更：以唯讀請求檢查首頁、版本資源、PDF.js、公告、後台、訂單 API 及錯誤回應的快取契約，輸出 JSON 證據並在不符合預期時回傳失敗退出碼，不讀取真實訂單 PDF 或執行 purge。

- 新增的檔案路徑：`tests/service_worker_fetch.test.mjs`
- 具體變更：加入預載成功／失敗、緩慢快取、配額不足、讀取錯誤、串流回應、離線回退、版本資源重用及敏感路徑的行為測試。

- 新增的檔案路徑：`tests/browser_service_worker_smoke.mjs`
- 具體變更：在真實 Chromium 驗證 Worker 停止後的預載、單次導覽下載、離線回退、版本資源保留，以及 Worker 更新只重載一次；透過本機測試 Worker 模擬配額不足。

- 修改的檔案路徑：`tests/browser_preview_smoke.mjs`
- 具體變更：保留原有介面測試，啟用 Service Worker 執行手機版流程；補上兩份 PDF 的計價、multipart 上傳、成功訊息、冷卻狀態及 API 不進快取的驗證，上傳僅送往本機 mock。

- 修改的檔案路徑：`package.json`
- 具體變更：新增 `test:browser`、`measure:load` 與 `verify:cdn` 指令，沿用既有建置與部署依賴。

- 修改的檔案路徑：`.gitignore`
- 具體變更：忽略 `.codex-qa/`，隔離 Node 22、Python 測試環境及量測原始資料。

- 新增的檔案路徑：`PERFORMANCE.md`
- 具體變更：記錄測速條件、前後中位數／P90、CDN 驗證結果、測試涵蓋範圍、已驗證產物位置及正式部署／台灣網路驗收步驟，明確區分本機結果與尚未完成的線上驗收。

**2. 為什麼要改 (Why it changed):**
- 原始問題或動機：使用者希望在 Google Cloud 免費主機條件下加快網站開啟，並要求依規劃完成實作與驗證。
- 決策原因：既有 CDN、壓縮與 PDF 延遲載入已存在；本次優先消除已確認的 Worker 快取等待，並修復儲存故障造成錯誤離線回應的問題。沿用現有架構與版本資源，避免新增付費服務或使使用者重新下載整批資源。

**3. 後續影響與注意事項 (Impact & Watchouts):**
- 43 項 Node 前端測試、25 項 Python 測試、Chromium Worker 與 Pixel 7 上傳／預覽測試通過；WebKit 執行檔未安裝，Safari／iPhone 驗證明確略過。
- 使用 Node 22.23.2 完成正式建置及預壓縮比對，產物位於 `static/builds/perf20260908node22/`；首頁初始 JS/CSS 為 4 個請求、23,217 Brotli bytes，根目錄 Worker 的 `.br`／`.gz` 已同步更新。正式上線仍需依 `deploy.sh` 以 Git revision 重新建置、預壓縮與部署。
- 2026/09/08 本機前後各 10 次首次及 10 次回訪量測：首次 FCP 中位數均為 338 ms，回訪由 172 ms 變為 164 ms，TTFB 沒有明顯改善；這是排除本機注入干擾的合成測試，不代表台灣實際速度或正式站已加速。
- 既有正式站經 PDX 節點的 20 次 CDN 唯讀驗證通過；未調整線上 Cloudflare 規則。沒有 GCP 主機存取設定或 Cloudflare 憑證，因此本輪未提交、推送或部署，正式部署後驗收及台灣網路實測仍待執行。
- API 與資料庫格式不變；既有未提交的介面修改完整保留。

### [2026/09/08 20:44] - 合併 Material 3 動畫、焦點保留與手機介面修正

**1. 改了哪裡 (What changed):**
- 修改的檔案路徑：`static/js/upload.js`
- 具體變更：同一檔案的設定與頁數更新改為同步既有卡片 DOM，保留鍵盤焦點及裝訂文字；加入選項群組標籤，上傳與冷卻期間停用檔案欄位並將設定區設為 inert。

- 修改的檔案路徑：`static/js/app.js`
- 具體變更：分頁與主題共用動畫排程，補上主題按鈕動態標籤及 sessionStorage 不可用時的容錯。

- 新增的檔案路徑：`static/js/motion.js`
- 具體變更：依序處理狀態更新，僅播放最新請求的轉場，避免動畫清理互相干擾；提供等待實際 CSS 動畫結束的工具。

- 修改的檔案路徑：`static/dialog.js`
- 具體變更：加入對話框標題與描述關聯，關閉時等待實際動畫結束後才清理控制項與處理下一個對話框。

- 新增的檔案路徑：`static/material-common.css`
- 具體變更：集中前後台對話框樣式、進場起始樣式、鍵盤焦點及減少動態效果規則。

- 修改的檔案路徑：`style.css`
- 具體變更：引用共用樣式，修正表面混色透明度與淺色文字對比、保留檔案與 radio 欄位的鍵盤可操作性，調整手機樣式優先順序與至少 48px 觸控範圍，將分頁內容改為 300ms 淡出淡入。

- 修改的檔案路徑：`admin.css`
- 具體變更：引用共用對話框樣式，修正表面混色比例，讓載入更多按鈕的懸停色使用主題色。

- 修改的檔案路徑：`index.html`
- 具體變更：將標題與分頁導覽移出轉場容器，替 PDF 檔案欄位補上無障礙標籤。

- 修改的檔案路徑：`tests/browser_preview_smoke.mjs`
- 具體變更：加入鍵盤切換選項、焦點與卡片 DOM 保留、裝訂文字保留、手機間距與按鈕尺寸，以及減少動態效果的瀏覽器檢查。

- 新增的檔案路徑：`tests/motion.test.mjs`
- 具體變更：涵蓋快速交錯轉場、減少動態效果、不支援轉場、更新失敗後恢復，以及對話框動畫完成與取消情境。

**2. 為什麼要改 (Why it changed):**
- 原始問題或動機：使用者提供 `material3-fixes.zip`，要求檢查適用性後合併至本專案；修正包針對卡片重建造成焦點遺失、轉場競態與手機樣式覆蓋問題。
- 決策原因：工作目錄原先無未提交修改，HEAD 與修正包基準 `e81c0ae098edaf80eb8f12efc36aa027870d91a5` 完全一致；檢查差異及現有呼叫流程後，套用全部 10 個來源與測試檔案，無需改動依賴或後端。

**3. 後續影響與注意事項 (Impact & Watchouts):**
- 前端測試 14/14、Vite build、預壓縮、verify-build、瀏覽器測試語法與 git diff --check 均通過；首頁初始資源為 4 個請求、23,215 Brotli bytes。
- Chromium Pixel 7 模擬測試及 Service Worker 首次安裝檢查通過，涵蓋前後台 PDF 預覽與新增的操作檢查；本機缺少 WebKit 執行檔而略過，尚未量測實機手機 FPS。
- 本機驗證使用 Node 26.3.0；正式部署仍須使用專案指定的 Node 22 環境重跑既有部署檢查。
- 本機已重新產生建置及 Brotli/Gzip 產物；部署主機仍須依原有流程重新建置、預壓縮並切換版本。本次未提交、推送或部署。

### [2026/08/11 12:06] - 修復首次版本化前端部署遭 Python 與 build ID 環境阻斷

**1. 改了哪裡 (What changed):**
- 修改的檔案路徑：`deploy.sh`
- 具體變更：部署啟動時先驗證並將專案 `venv/bin` 放入 `PATH`，不再要求 Ubuntu 額外提供系統層級的 `python` 指令，所有部署前健康解析、測試與預壓縮都能一致使用專案虛擬環境。

- 修改的檔案路徑：`tests/test_pdf_pipeline.py`
- 具體變更：測試啟動時同時清空 `APP_BUILD_ID` 與 `BACKEND_BUILD_ID`，避免部署程序匯出的正式 release ID 污染開發模式健康檢查斷言。

- 修改的檔案路徑：`tests/csp_frontend_bindings.test.mjs`
- 具體變更：新增部署腳本必須驗證虛擬環境 Python 並優先使用 `venv/bin` 的靜態回歸檢查。

**2. 為什麼要改 (Why it changed):**
- 原始問題或動機：Ubuntu 24.04 主機僅提供 `python3`，首次部署在新版 Vite 產物建立前因找不到 `python` 終止；使用臨時 `PATH` 重試後，Python 測試又因 `BACKEND_BUILD_ID` 繼承正式 Git SHA 而錯誤失敗，正式站因缺少對應前端產物持續回傳 502。
- 決策原因：部署應使用既有且已鎖定依賴的專案虛擬環境，不應要求額外的系統 Python alias；測試則必須自行建立完整、可重現的開發模式環境，不能依賴呼叫端未設定 release 變數。

**3. 後續影響與注意事項 (Impact & Watchouts):**
- 修正提交並推送後需在主機重新執行 `bash deploy.sh`；腳本會建立 `static/builds/<Git SHA>/`、核對前後端 build ID，再恢復正式版本化前端服務。
- 若網站仍在 502，可先以空白 `APP_BUILD_ID`／`BACKEND_BUILD_ID` 重新載入 PM2，暫時使用原始前端，再部署本修正；不需安裝 `python-is-python3` 或建立系統 symlink。

### [2026/08/11 10:15] - 效能：導入版本化 Vite 前端、Cloudflare 分層快取與安全的 Service Worker 更新

**1. 改了哪裡 (What changed):**

- 建置與產物驗證：新增 `.nvmrc`、`package.json`、`package-lock.json`、`vite.config.mjs`、`scripts/verify-build.mjs`、`scripts/purge-cloudflare.mjs`，固定 Node 22.23.2 與 `vite@8.1.5`，以 `index.html`／`admin.html` 多頁入口輸出至 `static/builds/<APP_BUILD_ID>/`；檢查雜湊引用、Google Fonts、source map、PDF.js 初始依賴、4 請求／100 KiB 上限，以及 Brotli/Gzip sidecar 可完整解壓且內容一致。`.gitignore` 同步排除依賴、建置 release 與部署鎖。
- 首頁與樣式：修改 `index.html`、`admin.html`、`style.css`、`admin.css`，移除 Google Fonts、preconnect 與 noscript 字型請求，改用系統中文字型及系統等寬字型；將共用主題初始化縮小後內嵌於 `<head>`，其 SHA-256 hash 納入 CSP。
- 前端模組：修改 `static/dialog.js`、`static/js/dialog-api.js`、`static/js/app.js`、`static/js/upload.js`、`static/js/history.js`、`static/js/utils.js`、`static/js/admin/app.js`、`static/js/admin/orders.js`、`static/js/admin/announcements.js`，將對話框改為真正的 ES module，移除 inline event handler 與 `window.*` 全域函式，改用 data attributes、事件委派與非阻塞 module 載入。
- Service Worker：新增 `static/js/service-worker-registration.js` 並修改 `sw.js`；首次接管只記錄受控狀態、不重新載入，既有控制器更新時最多重載一次；首頁維持 network-first，無 query 的版本化 build／PDF.js 改為 cache-first，兩個 cache 各限制 60 項，敏感 API、後台、使用者 PDF 與 query 變體不進 Cache API。
- 後端與壓縮：修改 `.env.example`、`config.py`、`main.py`、`compression.py`、`compressed_static.py`、`precompress.py`；正式環境依 `APP_BUILD_ID` 驗證並提供同版 HTML，缺產物即拒絕啟動，`/health` 分別回報 `BACKEND_BUILD_ID` 與 `frontend_build_id`。首頁、版本資產、公告、Service Worker、後台/API 與錯誤回應套用不同瀏覽器／Cloudflare 快取契約；Brotli、Gzip、identity 均支援 q 值協商、representation-specific ETag、`If-None-Match` 304 與 `Vary: Accept-Encoding`，過期或遺失 sidecar 安全退回原檔，預壓縮範圍加入 Vite `.mjs` 與 PDF.js WASM。
- 部署與 Cloudflare：修改 `deploy.sh`、`ecosystem.config.cjs`、`CLOUDFLARE_CACHE_RULES.md`；加入 flock、Node 22 驗證、256 MB heap、隔離建置、測試／壓縮／健康檢查後才切版與 purge、前後端 build ID 核對，以及可驗證的前一 Git revision／鎖定 Python dependencies／前端 release 自動回復；另保留至少 3 版且不少於 7 天的資產，purge 失敗則維持健康新版。文件列出 5 條依序套用的 Cache Rules；`CF_ZONE_ID`／`CF_API_TOKEN` 僅由主機秘密環境提供。
- 測試：新增 `tests/csp_frontend_bindings.test.mjs`、`tests/service_worker_registration.test.mjs`，並擴充 `tests/browser_preview_smoke.mjs`、`tests/test_pdf_pipeline.py`，涵蓋首次安裝單次 navigation、Google Fonts 零請求、PDF.js 延遲載入、歷史訂單與 Range 預覽、各編碼 200／304／HEAD／ETag／Vary、過期 sidecar、錯誤 no-store、build fail-fast、健康版本與壓縮完整性。

**2. 為什麼要改 (Why it changed):**

- 首次安裝 Service Worker 會自動 reload，造成整頁跨洋下載兩次；外部中文字型另增加約 700 KB 與第三方連線，未合併的 ES modules 也放大高延遲網路下的往返成本。
- 原始 HTML／前端模組缺少穩定版本路徑，Cloudflare 難以安全長期快取；壓縮 representation 共用或缺少完整條件式請求契約，也可能讓瀏覽器與 edge 誤用 ETag。
- e2-micro 資源有限，需要把建置、測試、Brotli q11/Gzip 9 與 purge 依序執行，並在切換前後端版本時保留可驗證、可回退的舊資產。

**3. 後續影響與注意事項 (Impact & Watchouts):**

- 本機驗證結果：Node 測試 10/10、Python 測試 25/25、Chromium Pixel 7 行動版 smoke test 通過；WebKit 執行檔未安裝而明確略過。Vite production build 為 4 個初始 JS/CSS 請求，Brotli 合計 22,519 bytes，壓縮解壓比對、Bash／Node／Python 語法與 `git diff --check` 均通過。
- 正式部署前須在主機使用 Node 22.12+、設定 `APP_BUILD_ID`／`BACKEND_BUILD_ID`，並依 `CLOUDFLARE_CACHE_RULES.md` 建立 5 條規則及配置最小權限的 Cloudflare purge secrets；本次僅完成 repo 實作，尚未直接修改線上 Cloudflare 或執行正式 PM2 部署。
- 系統字型會依作業系統略有視覺差異；公告 edge 最多延遲 5 分鐘。上傳、訂單歷史與其他動態 API 仍直接往返美國 origin，無法只靠壓縮消除跨洋延遲。
- `git pull` 後若在切換 PM2 前失敗，腳本會回復原 checkout，候選版曾更新共用 venv 時也會重裝前一版鎖定依賴；切換後健康失敗則先比對部署前的健康 backend 與 Git revision，再回復該 revision、Python dependencies、上一版前端與 PM2 環境，健康後精確 purge 首頁。若舊版身分、依賴、產物或工作樹無法安全驗證，會停止服務切換並要求人工介入，禁止 Purge Everything。
- Rollback 後仍保留已完整落盤的候選 immutable build；即使 Cloudflare purge 缺少憑證或暫時失敗，edge 上尚存的候選 HTML 仍可取得其雜湊資產，不會因 origin 404 破版，後續再由 3 版／7 天 retention 安全清理。

### [2026/07/30 19:41] - 修復 PM2 遷移後無法啟動 Uvicorn 導致正式站 502

**1. 改了哪裡 (What changed):**
- 修改的檔案路徑：`ecosystem.config.cjs`
- 具體變更：PM2 改為直接執行 `venv/bin/python -m uvicorn main:app`，不再以無直譯器模式執行 Uvicorn console script；並將部署產生的 `APP_BUILD_ID` 明確寫入程序環境，確保 `/health` 能回報實際 Git 版本。

- 修改的檔案路徑：`deploy.sh`
- 具體變更：部署時比較既有 `print-system` 的 `pm_exec_path` 與預期 Python 執行檔；若偵測到舊版 Bash 型 PM2 程序，先刪除該程序定義再以新版 ecosystem 設定啟動，後續部署則維持 reload。健康檢查成功後自動執行 `pm2 save --force`，保存可在主機重啟後恢復的正確程序設定。

**2. 為什麼要改 (Why it changed):**
- 原始問題或動機：首次部署新版 ecosystem 設定時，PM2 以既有 Bash 程序執行新的參數，造成 `/usr/bin/bash: main:app: No such file or directory`、程序持續重啟、內部 8000 埠無服務，Cloudflare 對外回傳 502。
- 決策原因：直接以虛擬環境 Python 執行 `-m uvicorn` 可消除 console script 與 PM2 interpreter 判定差異；部署腳本只在偵測到舊程序時做一次性重建，完成遷移後仍可使用低中斷的 PM2 reload。

**3. 後續影響與注意事項 (Impact & Watchouts):**
- 已經依臨時恢復指令重建為 `venv/bin/python` 的伺服器，下次部署會直接 reload；尚未遷移的伺服器會在第一次部署時自動刪除舊程序定義並重新啟動。
- 此修正不修改 SQLite、上傳檔案、`.env` 或 Cloudflare Tunnel；Uvicorn 仍只監聽 `127.0.0.1:8000`。
- 部署成功後 `/health` 的 `build_id` 必須等於目前 Git commit 短雜湊，PM2 程序清單也會自動保存。

### [2026/07/30 19:06] - 重構：Material 3 共用 PDF 預覽、原子上傳與 GCP Free Tier 部署最佳化

**1. 改了哪裡 (What changed):**

- PDF 預覽核心與官方資源：
  - 移除 PDF.js 2.x、`pdfjs-loader.js`、`window.pdfjsLib`、前後台重複渲染器及完整 viewer 資源。
  - 自架官方 `pdfjs-dist` 5.7.284 的 modern/legacy ESM core、worker、CMap、標準字型、WASM 與 ICC，集中於版本化路徑 `static/pdfjs/5.7.284/`。
  - 新增 `static/js/pdf-engine.js` 與 `static/js/pdf-preview-controller.js`：延遲載入 modern build、失敗時退回同版 legacy build、API/worker 版本檢查、共用 worker、文件開啟序列化、手機 1 份／桌面 2 份 LRU、完整取消與釋放。
  - 單頁 canvas 預覽加入 400 萬像素與 DPR 2 上限、記憶體錯誤 DPR 1 重試、`ResizeObserver`、48px 滑動翻頁、頁碼輸入、鍵盤 Home/End/方向鍵、Fit/125%/150%/200%、全螢幕原生 `<dialog>` 與關閉回焦。
  - 前台本地檔案改由 PDF.js 可靠取得頁數，最多五份依序解析；只有客戶端解析失敗才呼叫 `/api/check-pages`，不再用 `/Count` 正規表示式或把錯誤頁數預設成 2。
  - 歷史訂單與後台遠端預覽改用 `disableStream + disableAutoFetch + 64 KiB Range` 按需抓取，並提供重試與原始 PDF 下載備援。

- Material 3 與可及性：
  - 新增 `static/pdf-preview.css` 共用前後台預覽元件，使用 `--md-sys-*` 色彩、shape、motion、typography 與 state tokens；保留六套前台主題、後台深色紅色品牌及既有手機右欄 View Transition。
  - 前台分頁改為完整 `tablist/tab/tabpanel` 語意與 roving tabindex；補齊圖示按鈕可讀名稱、48px 互動尺寸、ARIA live status/progress/error 與具頁碼的 canvas 標籤。
  - 後台 PDF 視窗改為原生 `<dialog>`；前後台使用相同預覽 DOM hooks 與控制器，移除預覽區 inline style。
  - 將主題初始化移至 `static/js/theme-bootstrap.js`，首頁只保留一個 `app.js` 啟動入口；新增 `dialog-api.js` 解除原本 `app.js ↔ upload.js/history.js` 的循環初始化問題。

- PDF 上傳、資料庫與儲存可靠性：
  - `/api/check-pages` 與 `/api/upload` 共用 `_write_validated_pdf()` 串流驗證，統一副檔名、空檔、20 MB、magic bytes、損壞／加密／零頁 PDF 的 `400/413/422` 行為。
  - PDF 伺服器解析由 semaphore 限制為 1；正式上傳先寫入上傳目錄 `.part`，解析成功後 `os.replace()` 原子改名，最後才 flush/commit 資料庫；錯誤會 rollback 並清除對應檔案。
  - SQLite 改為 `pool_size=3`、`max_overflow=1`、每連線約 4 MB cache，保留 WAL、5 秒 busy timeout 與 16 MB journal limit。
  - 新增每六小時磁碟記錄、80%/90% 警告、LINE 24 小時冷卻通知，以及只清除逾時 `.part` 與既有已完成舊訂單的維護流程。

- GCP、快取與部署：
  - 新增 `ecosystem.config.cjs`：單一 Uvicorn worker、32 concurrency、backlog 64、keep-alive 5 秒、450 MB 記憶體重啟、2 秒 restart delay、10 秒優雅關閉。
  - 新增 `setup_free_tier.sh`：無 swap 時建立 1 GB swap、`swappiness=10`，並設定 PM2 logrotate；不安裝常駐 Ops Agent。
  - `deploy.sh` 改用 SQLite online backup + integrity check、`git pull --ff-only`、鎖定依賴、增量預壓縮、PM2 reload，最後輪詢新版 `build_id`。
  - 新增完整 `requirements.lock`；`precompress.py` 改為只更新變更／缺少的 `.br/.gz`，並移除無來源 sidecar。
  - Service Worker 使用獨立 app/PDF engine namespace：HTML、CSS、應用模組 network-first，版本化 PDF 引擎 cache-first，API、後台、Blob／本地檔案與使用者 PDF 永不快取。
  - 版本化 PDF.js 回應一年 immutable；首頁以 `CDN-Cache-Control` 提供 edge 五分鐘、瀏覽器重新驗證；API、後台及訂單 PDF維持 private/no-cache 或 bypass。新增 `CLOUDFLARE_CACHE_RULES.md` 作為正式站規則清單。
  - 新增環境設定 `DATABASE_URL`、`UPLOAD_DIR`、`PDF_PARSE_CONCURRENCY`、`STORAGE_WARN_PERCENT`、`STORAGE_CRITICAL_PERCENT`、`APP_BUILD_ID`。

**2. 為什麼要改 (Why it changed):**

- 手機瀏覽器不能可靠使用原生 PDF viewer；舊版 PDF.js 又有全域 API、前後台重複程式、八份後台快取與不準確頁數估算，容易造成手機記憶體與渲染競態問題。
- e2-micro 只有 1 GB RAM 與共享 CPU，採瀏覽器端單頁按需渲染、Range 請求與單一伺服器解析工作，能避免伺服器逐頁轉圖和整份 PDF 傳輸的 CPU、磁碟及流量成本。
- 舊上傳流程先提交資料庫再複製檔案，若檔案寫入失敗會留下無檔案訂單；改為 `.part → 原子改名 → DB commit` 可讓失敗狀態一致且可清理。

**3. 驗證結果 (Validation):**

- Python：`tests/test_pdf_pipeline.py` 共 6 項通過，涵蓋空檔、magic、損壞、加密、20 MB 邊界、解析 semaphore、原子寫入與 rollback、Range `200/206/416`、快取/CSP、SQLite backup/integrity/WAL。
- JavaScript：語法檢查與 `tests/pdf_paper.test.mjs` 通過，涵蓋 A3/A4/A5/Letter/Legal/自訂尺寸、橫直向及 fit/cover 幾何。
- 瀏覽器：`tests/browser_preview_smoke.mjs` 已在 Chromium Pixel 7 與 WebKit iPhone 14 模擬通過，確認選檔前不載 PDF 引擎、本機不呼叫 fallback、快速切換不被舊渲染覆蓋、DOM 僅一個 canvas、全螢幕回焦、後台 Range 預覽。
- 預壓縮腳本連跑兩次：第一次只更新變更檔並移除舊 loader sidecar，第二次全部 `SKIP`。

**4. 後續影響與注意事項 (Impact & Watchouts):**

- 正式部署前先執行一次 `bash setup_free_tier.sh`，再依 `CLOUDFLARE_CACHE_RULES.md` 建立規則；程式與 PDF 引擎資源上線後才啟用 immutable。
- 本機已完成 Chromium/WebKit 行動裝置模擬；正式上線前仍需以一台實際 iPhone Safari 18+ 與一台 Android Chrome 驗證手勢、記憶體及螢幕閱讀器。
- 部署後應觀察 24 小時錯誤、RSS 與 PM2 重啟；七天後檢查 Cloudflare 命中率與 GCP 對外流量，並實測 Lighthouse 目標。

### [2026/07/27 20:35] - 新增：MD3 規範的主題切換輻射動畫與 Tab 切換 Fade Through 動畫

**1. 改了哪裡 (What changed):**

- 修改的檔案路徑：`static/js/app.js`
- 具體變更：
  - `bindThemeToggle()` 改為 MD3 Expressive 圓形輻射揭示：點擊時以游標座標(鍵盤觸發用 `event.detail === 0` 退回按鈕中心)為原點,計算到畫面最遠角的距離作為終止半徑,寫入 `--theme-transition-x/-y/-r`,並加 `html.theme-transition` class 限定動畫範圍,`transition.finished.finally()` 清除。
  - `switchTab()` 改用 MD3 Fade Through:加 `html.tab-transition` class 限定動畫(不影響主題切換),`transition.finished.finally()` 清除。支援 View Transitions API 的退路維持直接切換。

- 新增的檔案路徑：`style.css`(主題切換輻射動畫區塊)
- 具體變更：
  - `html.theme-transition *` 禁用所有子元素獨立 `view-transition-name`(防破窗 + 低階機效能優化)。
  - `::view-transition-old(root)` 設 `animation: none` 靜止於下層,`::view-transition-new(root)` 用既有 `--md-sys-motion-easing-emphasized-decel` token 搭配 `clip-path: circle()` 從點擊點由 0 擴張到終止半徑。
  - `prefers-reduced-motion: reduce` 退回瞬切。

- 新增的檔案路徑：`style.css`(Tab 切換 Fade Through 動畫區塊)
- 具體變更：
  - 新增 `.md3-content` 容器的 `view-transition-name: panel`,讓標題+panel 一體縮放過場。
  - 兩階段錯開:舊內容 `tab-fade-through-out`(200ms,scale 1→1.05 + opacity 1→0,emphasized-accel),新內容 `tab-fade-through-in`(200ms,**delay 200ms**,scale 0.92→1 + opacity 0→1,emphasized-decel),總時長 400ms。
  - 設計上「舊完全消失後新才出現」→ 從根本杜絕重疊。
  - tab 切換時 `::view-transition-old/new(root)` 設 `animation: none` 避免疊影,`prefers-reduced-motion` 退回瞬切。

- 修改的檔案路徑：`index.html`
- 具體變更：在 `.md3-card` 內新增 `.md3-content` 容器,包住 `.header` + `#upload-panel` + `#history-panel`,`.md3-tabs` 留在容器外(導航持續可見不隨內容縮放)。

**2. 為什麼要改 (Why it changed):**
- 原始問題或動機：使用者要求將「切換日夜模式的動畫改成輻射動畫」,以及「切換檔案上傳與歷史訂單的動畫」不要再用原本的淡入淡出,且需符合 MD3 規範。
- 決策原因：
  - 主題切換採 MD3 圓形揭示(clip-path circle 擴張),是 Material 認可的表面轉換模式,搭配既有 emphasized-decel token;並採納使用者回饋補上防破窗、鍵盤觸發 `event.detail === 0` 判定、低階機效能優化等防禦性措施。
  - Tab 切換**放棄 Shared Axis 水平推擠方案**。主因:View Transitions API 的 old/new 是兩張疊在同位置的全螢幕快照,任何讓兩者同時移動的方案(滑動、推擠),中間時刻都會部分交疊 → 視覺重疊是 API 機制決定的,無法靠 CSS 完全消除(經多輪實測確認:含 `::view-transition-group` overflow、100% 位移 + opacity 等)。改採 MD3 官方 peer 導航的 Fade Through 規範,兩階段錯開,任一時刻只有一個清晰可見,從設計上杜絕重疊。

**3. 後續影響與注意事項 (Impact & Watchouts):**
- 兩處動畫皆依賴 **View Transitions API**(`document.startViewTransition`),不支援的瀏覽器會退回直接切換(無動畫),功能不受影響。
- `prefers-reduced-motion: reduce` 使用者會跳過動畫直接切換,符合無障礙。
- `index.html` 結構變更(新增 `.md3-content` 容器)不影響既有 JS 對 `#upload-panel` / `#history-panel` / `#page-title` 等元素的查詢(皆為 id 選擇器),但若有其他以 `.md3-card > *` 直接子元素為目標的 CSS/JS 需留意階層變化。
- 部署前需執行 `python precompress.py` 重新產生 `.br` / `.gz` 預壓縮檔(HTML/CSS/JS 皆有變更)。
- 主題切換輻射動畫已實測確認效果良好;Tab 切換 Fade Through 因本機 IAB 截圖功能異常未能視覺確認,需於實際頁面驗證重疊是否已消除。

### [2026/07/24] - 修復：部署後檔案上傳失效（ES module 版本錯位 × immutable 快取 × Service Worker）

**1. 改了哪裡 (What changed):**

【根因】部署到 ampaprint.systems 後，檔案上傳不顯示、切換歷史訂單無反應、按鈕全沒反應；Console 報 `app.js: Uncaught SyntaxError: The requested module './upload.js' does not provide an export named 'updateFitMode'`，連帶 `switchTab is not defined`。本地一切正常。

根因鏈：
- 前台 `app.js` 以相對路徑靜態 import `upload.js`/`preview.js`/`history.js`，**被 import 的模組 URL 沒有版本號**（只有 `index.html` 的 `<script src="app.js?v=">` 有）。
- `main.py` 的 `SecurityAndCacheMiddleware` 把 `/static/` 強制設成 `public, max-age=31536000, immutable`，**覆蓋掉 `compression.py` 刻意設計的 `no-cache + ETag`**。
- 結果：部署新版後，`app.js`（有 `?v=`）更新了，但它 import 的 `upload.js`（無版本號）被 Cloudflare CDN 與瀏覽器用舊快取、連 ETag 驗證都不做 → 新版 app.js 配舊版 upload.js → ES module 解析失敗 → `initApp()` 沒執行 → 全站按鈕無反應。
- 本地正常是因為本地直接讀 `.js` 原始檔，沒走 `.br`/`.gz` 預壓縮與 CDN 快取。

【第 1 層修復：HTTP 快取策略（根本）】
- 修改的檔案路徑：main.py（`SecurityAndCacheMiddleware` 的 `/static/` 分支，原 L386）
- 具體變更：`public, max-age=31536000, immutable` → `public, no-cache`。改回與 `compression.py` 一致的 no-cache + ETag：檔案沒變回 304（零成本），檔案變了就拿新版。從根本消除「無版本號模組被永久快取」，日後改任何前端 JS 都不再需要擔心版本號。

【第 2 層修復：Service Worker 升級（關鍵）】
- 修改的檔案路徑：sw.js（L2）
- 具體變更：`CACHE_NAME` `print-system-v7` → `print-system-v8`。即使 HTTP 標頭改 no-cache，已註冊舊 SW 的訪客，SW 仍會攔截 `/static/` 請求；只有升 CACHE_NAME 觸發 `activate` 事件（sw.js L18-29）清除舊快取，才能確保既有訪客「重新整理就吃到新版 upload.js」，不必手動 F12 清網站資料。這是覆蓋既有訪客的唯一可靠手段。

【第 2 層配套：SW 升級的頁面端自動重載】
- 修改的檔案路徑：static/js/app.js（registerServiceWorker()，原 L148-155）
- 具體變更：補上 `controllerchange` 事件監聽 —— 新版 SW（如 v8→v9）經 `skipWaiting()` 接管時，自動 `window.location.reload()`，讓訪客零手動操作就吃到新版 JS。搭配 `refreshing` 旗標防止多個 client 控制權變更導致的無限重載迴圈。註冊成功時記錄 scope、失敗用 `console.error` 提升可見度。這是 `skipWaiting()`（sw.js 端）的標準配對，補上後未來所有版本迭代（v8→v9→...）皆可無感升級。

【第 3 層修復：deploy.sh 防禦性清理舊預壓縮檔】
- 修改的檔案路徑：deploy.sh（step 3，`python precompress.py` 之前）
- 具體變更：新增 `find ./static -type f \( -name '*.br' -o -name '*.gz' \) -delete`。`-type f` 確保只刪檔案、括號分組 `-o`（OR）避免邏輯錯誤，精準清除舊壓縮檔，避免檔案重命名/刪除後舊的 `.br`/`.gz` 殘留被誤派發（幽靈快取）。

【連帶修正：CSP（Console 錯誤 + 字型載入失敗）】
- 修改的檔案路徑：main.py（`SecurityAndCacheMiddleware` 的 CSP 字串，原 L359）
- 具體變更：
  - `connect-src` 補 `https://fonts.googleapis.com`：根因不是 `style-src` 漏掉（該項已有），而是 sw.js L53-55 攔截字型時用 `fetch()`，走 `connect-src`，被擋 → 字型 503。
  - `script-src` 補 `https://static.cloudflareinsights.com`：解除 Cloudflare 自動注入的 Web Analytics beacon.min.js CSP 違規。

**2. 為什麼要改 (Why changed):**
- 原始問題：部署後全站互動失效（上傳、切換 tab、歷史訂單），但本地正常 — 典型「本地 OK、部署壞」難題。
- 決策原因：診斷確認不是跨域、不是 CORS、不是程式邏輯 bug，而是**三層快取（HTTP immutable × CDN × Service Worker）疊加 + ES module import 無版本號**的版本錯位。採用「三層保險」：no-cache+ETag（根本）+ SW 升版（覆蓋既有訪客）+ 清理舊預壓縮檔（防幽靈）。前台模組存在循環依賴（app↔upload↔preview↔history），不碰 import 語句（給所有靜態 import 補版本號在循環依賴下易版本錯位），改從快取層根治最穩。

**3. 後續影響與注意事項 (Impact & Watchouts):**
- 部署後必須：伺服器 `git pull && bash deploy.sh`；Cloudflare Dashboard → Caching → Purge Everything（清 CDN 舊 upload.js）；並到 Rules 確認沒有「Edge Cache TTL」之類強制覆寫 no-cache 的硬規則。
- SW 升至 v8，既有訪客首次造訪會自動更新；必要時可手動 Unregister（F12 → Application → Service Workers）+ 強制刷新。
- `/static/` 改 no-cache 後，PDF.js 等大檔會多一次 ETag 驗證（304，成本極低），權衡下換來「改版能正確派發」的可靠性，值得。
- 預壓縮 `.br`/`.gz` 需在部署時重新產生（deploy.sh 已自動處理）；本地開發若要測試預壓縮行為需手動跑 `python precompress.py`。
- ⚠️ **本次 v7→v8 過渡期**：本次升級瞬間「已載入頁面」的老訪客不會自動重載 —— 因為他們記憶體中執行的是舊 app.js（還沒有 controllerchange 監聽器）。即使背景抓到 sw.js v8 並 `skipWaiting()`，當前頁面沒有監聽該事件 → 不會 reload。這不是設計錯誤，而是前台 JS 更新的必經過渡：老訪客本次升級後第一次重新整理 / 重開網頁吃到新 app.js 後，監聽器才常駐，從 v8→v9 起機制才 100% 完美運作。本次部署後測試時要知道：第一波老訪客仍需一次手動重新整理或頁面導航；「全新訪客」（從未造訪過）則從第一次進站就完全正常。
- 🔮 **未來追蹤（輸入中斷風險）**：未來 v8→v9 等升級，SW 通常在開頁後 1~3 秒完成下載接管。若使用者手速極快，一開頁就拖 PDF 或填表單，恰逢 SW 接管觸發 `reload()` 會清空其輸入。對 ampaprint.systems（載入快、碰撞機率低）目前第一階段維持單純強制重載非常合適。若日後發現使用者常遇「閃退重載」，可在 controllerchange 加判斷：若正在上傳或有待處理檔案，改顯示「系統已更新，請點此重新整理」提示條而非強制 reload。本次先不做，列為未來優化項目。

### [2026/07/23 23:54] - 新增功能：邊界標註對比（紅框+留白色塊）、切換按鈕與 MD3 Tooltip

**1. 改了哪裡 (What changed):**

【邊界標註視覺化 — 原文件 vs A4 對比】
- 修改的檔案路徑：static/js/pdf-paper.js
- 具體變更：新增 `a4LabelMm(isLandscape)` helper，依方向回傳「A4 · 210×297mm」或「297×210mm」，供 A4 尺寸標籤使用。

- 修改的檔案路徑：static/js/preview.js、static/js/admin/pdf-modal.js
- 具體變更：`renderPdfPage`/`renderAdminPdfPage` 渲染完成後，將 canvas CSS 尺寸寫入 `.pdf-doc-outline`（原文件邊界框），並填入「原文件 X×Xmm」尺寸標籤（pt→mm 換算）；`updatePaperBadge` 同步更新 A4 尺寸標籤。每頁重新計算，支援多尺寸混合 PDF。

- 修改的檔案路徑：index.html、admin.html
- 具體變更：A4 框內新增 `.pdf-doc-outline`（原文件邊界框，內含 `.pdf-doc-label` 尺寸標籤）與 `.pdf-a4-label`（A4 尺寸標籤）三個疊層元素；翻頁控制列新增「📐 邊界」切換按鈕（含 MD3 Tooltip 結構）。

- 修改的檔案路徑：style.css、admin.css
- 具體變更：新增 `.pdf-doc-outline` 樣式 — 紅色實線邊框（原文件邊界）+ `box-shadow: 0 0 0 9999px` 向外延伸淺色塊（A4 上的留白區）。前台留白色塊用淺藍（`rgba(0,100,148,0.13)`），後台用半透明黑（`rgba(0,0,0,0.28)`）。新增 `.pdf-doc-label`（紅底白字尺寸標籤）與 `.pdf-a4-label`（毛玻璃 A4 標籤，MD3 label-small typography）。A4 框加 `position: relative` 供子元素絕對定位。

【按需顯示 — 切換按鈕，避免擋住白紙預覽】
- 修改的檔案路徑：static/js/preview.js、static/js/admin/pdf-modal.js
- 具體變更：標註元素預設 `display:none`，點「📐 邊界」按鈕切換 A4 框的 `.annotated` class（純 CSS class 切換，不重渲染 PDF，瞬間反應）。`resetPreview`/`closePdfModal` 重設 `.annotated` 與按鈕 active 態，切換檔案不殘留。

【顏色語意說明 — MD3 Plain Tooltip】
- 修改的檔案路徑：index.html、admin.html、style.css、admin.css
- 具體變更：邊界按鈕包進 `.md3-tooltip-wrap`，hover/focus 時彈出 MD3 Plain Tooltip（純 CSS），顯示「紅框＝原文件邊界 / 藍色區（後台：灰色區）＝A4 上的留白」。符合 MD3 規範：`inverse-surface` 底色 + `label-small` typography + 150ms opacity/transform 過渡。取代先前因「太佔空間、太醜」被移除的獨立圖例卡片。

【預壓縮與快取破壞修正】
- 修改的檔案路徑：sw.js
- 具體變更：CACHE_NAME `print-system-v6` → `v7`，讓 Service Worker 重新安裝並清除舊快取。先前幾輪改動未更新版本號，導致瀏覽器持續使用舊 SW 快取的 JS（按鈕出現但點擊無反應的元凶）。
- 具體變更（index.html / admin.html）：快取破壞版本號 `20260723b` → `20260723c`，強制瀏覽器重新抓取 JS/CSS。並已執行 `python precompress.py` 重產 21 個 `.br`/`.gz` 預壓縮檔。

**2. 為什麼要改 (Why it changed):**
- 原始問題或動機：使用者反映「看不出原文件和 A4 的差距」（標註不明顯）、「邊界標註擋住白紙預覽」、「不知道紅色藍色代表什麼」、「圖例太醜太佔空間」。先前版本用淡藍細虛線在白底上幾乎看不見，且無切換與說明機制。
- 決策原因：邊界框改用高對比紅實線 + box-shadow 留白色塊（對比最強烈，使用者選的方案）；加切換按鈕讓使用者按需顯示（平時看純白預覽，需要對比時才開啟，不擋 PDF）；顏色語意說明照 MD3 規範用 Plain Tooltip（hover 顯示，不佔預覽空間），而非獨立圖例卡片。另修正預壓縮與 SW 快取破壞版本號，確保改動能正確派發到瀏覽器。

**3. 後續影響與注意事項 (Impact & Watchouts):**
- 修改了 HTML / CSS / JS / sw.js，已執行 `python precompress.py` 重產預壓縮檔；部署時仍需再跑一次確保同步。
- Service Worker 版本升至 v7，使用者首次造訪會自動更新；但若瀏覽器仍卡舊 SW，需手動 Unregister（F12 → Application → Service Workers）並 Ctrl+Shift+R 強制刷新。
- 快取破壞版本號現為 `20260723c`，日後每次改前端檔案需手動遞增版本號字串（index.html/admin.html 的 `?v=`）並重跑 precompress，否則改動不生效。
- box-shadow 留白色塊在 cover 模式下因邊界框 ≥ A4 框，色塊會被 overflow:hidden 裁掉（無留白顯示），符合預期。
- 測試時誤建的空殼 `orders.db`（實際 DB 為 `db.sqlite3`）維持不版控。

### [2026/07/23 13:28] - 新增功能：A4 預覽框 MD3 重設計 + fit/cover 文件處理方式（前後端）

**1. 改了哪裡 (What changed):**

【後端 — DB 與 API】
- 修改的檔案路徑：database.py
- 具體變更：Order 模型新增 `fit_mode` 欄位（default='fit', NOT NULL），`ensure_order_columns()` 新增對應 ALTER TABLE 語句。應用程式啟動時自動 migration，舊訂單補預設值 'fit'，不破壞既有資料。

- 修改的檔案路徑：main.py
- 具體變更：`/api/upload` 端點新增 `fit_mode: str = Form("fit")` 參數，加入白名單驗證（限 'fit'/'cover'），Order 建構式傳入 fit_mode。`/api/orders/history` 的 SELECT 查詢與 `_row_to_dict` 手動補上 `Order.fit_mode` 欄位（此端點為明確列舉欄位，非自動序列化，最容易漏改）。

【前端核心邏輯】
- 修改的檔案路徑：static/js/pdf-paper.js
- 具體變更：新增 `computeA4Cover()` 函式，用 `Math.max` 計算「填滿頁面」縮放比（與既有 `computeA4Fit` 的 `Math.min`「符合頁面留白」相反），canvas CSS 尺寸會大於框，靠 flexbox 置中 + overflow:hidden 四邊均等裁切。

- 修改的檔案路徑：static/js/preview.js
- 具體變更：新增模組私有 `currentFitMode` 與 export `setFitMode(mode, silent)`、`rerenderCurrent()`。`renderPdfPage()` 依 currentFitMode 分派到 fit/cover 計算函式。狀態同步：`showPreview`/`previewPastOrder` 載入時以 silent 模式帶入該檔案的 fitMode（避免切換檔案時預覽模式錯亂）；`previewPastOrder` 新增第 4 參數 fitMode；`resetPreview` 重設模式。

- 修改的檔案路徑：static/js/admin/pdf-modal.js
- 具體變更：新增 `adminFitMode` 私有變數與 `setAdminFitMode(mode, silent)`、export `bindAdminFitToggle()`。`renderAdminPdfPage` 依模式分派。`openPdfModal` 讀取訂單 `order.fit_mode` 並靜默同步（管理員預覽時自動帶入用戶選的處理方式）；modal 可手動切換 fit/cover 預覽兩種效果。

- 修改的檔案路徑：static/js/upload.js
- 具體變更：fileObj 初始值新增 `fitMode: 'fit'`；`renderFileList()` 新增「文件處理」chip-group（留白/裁切，複用既有 MD3 Filter Chip 模式，圖示用新增的 SVG symbol）；新增 export `updateFitMode(idx, value)` — 更新值後呼叫 preview 的 setFitMode 即時重繪，不觸發 renderFileList（避免卡片重渲染打斷預覽）；handleSubmit 的 formData 新增 `fit_mode`。

- 修改的檔案路徑：static/js/app.js
- 具體變更：import 並把 `updateFitMode` 接到 window（供 inline onchange 呼叫）；`window.previewPastOrder` 包裝函式新增第 3 參數 fitMode 透傳給模組版。

- 修改的檔案路徑：static/js/admin/app.js
- 具體變更：import 並於初始化呼叫 `bindAdminFitToggle()`，綁定 modal 的 fit/cover 切換按鈕。

【HTML 結構】
- 修改的檔案路徑：index.html
- 具體變更：SVG sprite 新增 `i-fit_page`（留白：框中框）與 `i-crop`（裁切：裁角）兩個 Material Symbols 圖示。

- 修改的檔案路徑：admin.html
- 具體變更：modal 的 `.modal-paper-bar` 內新增 fit/cover 切換按鈕組（`#admin-fit-btn`/`#admin-cover-btn`），讓管理員預覽時可切換兩種處理效果。

【樣式 — MD3 elevation「紙浮桌面」重設計】
- 修改的檔案路徑：style.css
- 具體變更：前台 `.pdf-a4-frame` 改為 MD3 elevation-2 雙層陰影（`0 1px 2px` + `0 2px 6px`）+ outline-variant 細邊框，白紙清楚浮於 surface-container-high tonal 灰桌面（解決先前「白壓白框隱形」問題）。新增 `.pdf-a4-frame.cover > canvas` 解除 max-width/max-height 限制（供 cover 裁切）。新增 `@media (max-width:600px)` 將 scroll 區 padding 16→8px（行動裝置把空間還給預覽框）。

- 修改的檔案路徑：admin.css
- 具體變更：後台 `.pdf-a4-frame` 加白色半透明邊框（深色背景上凸顯紙張邊界）、新增 `.cover` canvas 解除限制、`.modal-paper-bar` 改 flex 置中（容納切換按鈕）、新增 `.modal-fit-toggle` 切換按鈕樣式與 `.badge-fit-fit`（綠）/ `.badge-fit-cover`（橘）badge。

- 修改的檔案路徑：static/js/admin/orders.js
- 具體變更：`buildSettingBadges()` 在色彩/單雙面 badge 後新增文件處理 badge（留白綠/裁切橘），附 `title` tooltip 提示對應印表機設定（留白→Fit to Printable Area；裁切→Actual Size/Borderless），降低管理員列印出錯率。

- 修改的檔案路徑：static/js/history.js
- 具體變更：`renderHistoryList()` 新增文件處理 hist-badge；檔名 onclick 傳遞 `order.fit_mode` 給 previewPastOrder，使歷史訂單預覽帶入正確的處理模式。

**2. 為什麼要改 (Why it changed):**
- 原始問題或動機：使用者反映 A4 預覽框「隱形」（白底壓白底看不出紙張邊界），且非 A4 的 PDF 預覽時無法選擇文件要留白還是裁切，導致預覽無法如實反映不同處理方式的列印結果。同時希望「原文件 vs A4 列印效果」的關係一目了然。
- 決策原因：A4 框採 MD3 elevation「紙浮桌面」設計（tonal 灰桌面 + 白紙 elevation-2 陰影 + 細邊框），最 MD3 且最簡潔地呈現紙張邊界。fit/cover 選擇存進訂單 DB，符合系統既有慣例（所有列印偏好 color_mode/duplex/binding 都存 DB、後台 badge 顯示），管理員手動列印時才知道用戶要哪種處理。cover 採「置中四邊均等裁切」靠 flexbox + overflow:hidden，裁切是從中心向外對稱發生，視覺不失真。

**3. 後續影響與注意事項 (Impact & Watchouts):**
- 修改了 HTML / CSS / JS / Python，部署前需執行 `python precompress.py` 重新產生 `.br` / `.gz` 預壓縮檔。
- DB schema 變更：啟動時自動 ALTER TABLE 補 `fit_mode` 欄位，舊訂單帶預設值 'fit'，無需手動 migration；但部署後第一次啟動會對既有 DB 執行一次 ALTER TABLE。
- cover 模式靠 `overflow:hidden` + flexbox 置中裁切；若 PDF 內容貼到邊緣（滿版圖、表格），cover 會切到邊界內容，用戶需自行判斷是否適合裁切。
- 行動裝置已加 media query 壓縮 padding，但 A4 預覽框在 320px 極窄螢幕仍偏小，建議用戶橫向瀏覽較佳。
- 測試時誤建的空殼 `orders.db`（實際 DB 為 `db.sqlite3`）已從本次 commit 排除，不會進版控。

### [2026/07/23 11:42] - 新增功能：PDF 預覽 A4 化（純前端 fit-to-page 縮放與尺寸警告）

**1. 改了哪裡 (What changed):**
- 新增的檔案路徑：static/js/pdf-paper.js
- 具體變更：新增前台後台共用的純函式模組。`detectPaper()` 由 PDF.js page 原始 pt 尺寸辨識紙張規格（A4/A3/A5/Letter/Legal/自訂尺寸，容差 ±2mm）與方向（直/橫向）；`computeA4Fit()` 以「符合頁面（fit-to-page）」策略計算 PDF 內容等比縮放進 A4 框後的 CSS 顯示尺寸與渲染 scale（不裁切、留白）；`safeDpr()` 回傳 `Math.min(devicePixelRatio, 2)` 做 DPR 記憶體防護。

- 修改的檔案路徑：static/js/preview.js
- 具體變更：改寫 `renderPdfPage()`。canvas 尺寸改由 A4 框決定（fit-to-page 等比縮放、置中留白），移除原本「只縮不放、上限 1.0」邏輯；加入 DPR 上限 2 處理高 DPI 清晰度；進行中的 render task 改為先 `cancel()` 再重來（取代原本 `return`），讓 resize 與快速翻頁可重渲染；每頁渲染後呼叫 `updatePaperBadge()` 逐頁更新紙張標籤與 A4 框方向；新增 debounce 200ms 的 resize 監聽（期間靠 CSS 拉伸 canvas 避免閃爍）。

- 修改的檔案路徑：static/js/admin/pdf-modal.js
- 具體變更：同步改寫 `renderAdminPdfPage()` 為 A4 fit + DPR 上限 2 + cancel 重渲染 + 每頁 badge 更新。canvas/ctx 等 DOM 引用改為 lazy 取得（原本在模組載入時即取，modal 未渲染會取不到）。

- 修改的檔案路徑：index.html
- 具體變更：`#pdf-preview-container` 內 scroll 層的 `<canvas>` 外包一層 `<div id="pdf-a4-frame" class="pdf-a4-frame">`（A4 紙張框）；canvas 移除 inline 的 `background:white; box-shadow`。`#preview-meta` 新增 `<span id="meta-paper" class="paper-badge">` 顯示紙張尺寸標籤。

- 修改的檔案路徑：admin.html
- 具體變更：`.modal-pdf-wrap` 內 canvas 外包 `<div id="admin-pdf-a4-frame" class="pdf-a4-frame">`；`#modal-settings` 後新增 `<div class="modal-paper-bar">` 含 `<span id="admin-pdf-paper" class="paper-badge">` 顯示紙張標籤。

- 修改的檔案路徑：style.css
- 具體變更：新增 `.pdf-a4-frame`（`aspect-ratio:210/297`、白底、圓角、陰影、flex 置中）與 `.landscape`（`aspect-ratio:297/210`）；canvas 改透明無陰影、隨框拉伸；新增 `.paper-badge` 樣式（`.paper-ok` 綠 / `.paper-warn` 橘紅警告，沿用 MD3 status token）；刪除死碼 `#pdf-preview-iframe` 樣式。

- 修改的檔案路徑：admin.css
- 具體變更：同步新增 `.pdf-a4-frame`/`.landscape`（後台深色背景 `#525659` 配白底框更凸顯紙張）、`.modal-paper-bar` 與 `.paper-badge`（用 `--success`/`--warning` token）；canvas 改透明；刪除死碼 `.modal-pdf-wrap iframe` 樣式。

**2. 為什麼要改 (Why it changed):**
- 原始問題或動機：使用者反映 PDF 預覽尺寸完全跟著 PDF 原始頁面走，上傳 Letter、A3 等非 A4 檔案時預覽就顯示該尺寸，但實際列印紙永遠是 A4，導致預覽無法如實反映「印出來會長怎樣」。
- 決策原因：採純前端方案（不動後端 main.py、DB、計價、原始檔），因系統是「原檔透傳」架構。預覽框固定 A4 比例、內容 fit-to-page 等比縮放留白，留白處露出框白底即視覺上的「白紙留白」，精確模擬 A4 列印結果。橫向 PDF 採「框跟著轉橫向」策略，符合 PDF 閱讀器與印表機驅動「保留原方向」的預設行為。

**3. 後續影響與注意事項 (Impact & Watchouts):**
- 修改了 HTML / CSS / JS，部署前需執行 `python precompress.py` 重新產生 `.br` / `.gz` 預壓縮檔。
- `aspect-ratio` 屬性需現代瀏覽器支援（Chrome 88+ / Firefox 89+ / Safari 15+），舊版瀏覽器預覽框比例會失效（退化為由內容撐開）。
- `devicePixelRatio` 上限設為 2：視網膜清晰度足夠，同時避免高 DPR（3~4）行動裝置 canvas 像素爆量導致卡頓。
- resize 重渲染靠 `RenderingCancelledException` 靜默處理，快速縮放視窗時不會噴錯但 console 可能有 cancel 訊息（屬正常行為）。

### [2026/07/22 18:49] - 效能優化：PDF.js 預壓縮派發、延遲載入與阻塞點修復

**1. 改了哪裡 (What changed):**
- 修改的檔案路徑：precompress.py
- 具體變更：`_GLOB_PATTERNS` 新增 `"static/pdfjs/**/*.js"`，讓部署時自動為 PDF.js 函式庫(pdf.worker.js 1.9MB、pdf.js 515KB、pdf.sandbox.js 631KB)產生 `.br`(Brotli Lv11)與 `.gz`(Gzip Lv9)預壓縮檔。

- 新增的檔案路徑：compressed_static.py
- 具體變更：新增 `PrecompressedStaticFiles` 子類別(繼承 Starlette `StaticFiles`),覆寫 `get_response` 以依 Accept-Encoding 派發 `.br`/`.gz` 預壓縮檔。Content-Type 一律取自原始檔名(用 `mimetypes.guess_type`,絕不從 `.br`/`.gz` 推斷),避免 JS 被誤判為 brotli/octet-stream 而拒絕執行;回應帶上 `Content-Encoding` 讓外層 `BrotliGzipMiddleware` 自動 pass-through(不二次壓縮);無預壓縮檔或不支援壓縮時降級為原生 StaticFiles。

- 修改的檔案路徑：main.py
- 具體變更：`/static` mount 由 `StaticFiles` 改為 `PrecompressedStaticFiles`;`/api/check-pages` 將同步 `shutil.copyfileobj(file.file, tmp)` 改為 async 串流(`await file.read(8192)` 逐塊寫入),避免大 PDF 阻塞事件循環;`/api/upload` 將已棄用的 `asyncio.get_event_loop().run_in_executor(None, shutil.copy2, ...)` 改為 `await asyncio.to_thread(shutil.copy2, ...)`(與檔內其他地方一致)。

- 新增的檔案路徑：static/js/pdfjs-loader.js
- 具體變更：新增共用 `ensurePdfjs()` 載入器(ES module),回傳 Promise,內部以 `document.createElement('script')` 動態注入 PDF.js 主程式,載入完成後立即設定 `GlobalWorkerOptions.workerSrc` 為絕對路徑(避免動態載入後 worker 路徑迷航),並快取 Promise 避免重複注入。

- 修改的檔案路徑：index.html、admin.html
- 具體變更：移除兩處同步 `<script src="/static/pdfjs/build/pdf.js">` 與緊接的 `workerSrc` 內聯腳本,改為延遲載入——PDF.js 只在使用者實際點「預覽」時才透過 `ensurePdfjs()` 動態載入,首屏不再被 515KB 的 pdf.js 同步阻塞。

- 修改的檔案路徑：static/js/preview.js、static/js/admin/pdf-modal.js
- 具體變更：在所有 `pdfjsLib.getDocument()` 呼叫前加入 `await ensurePdfjs()`,確保動態載入完成才使用。

- 刪除的檔案路徑：static/pdfjs/build/{pdf.js.map, pdf.sandbox.js.map, pdf.worker.js.map}、static/pdfjs/web/{viewer.js.map, viewer.html, viewer.js, viewer.css, debugger.css, debugger.js, compressed.tracemonkey-pldi-09.pdf}
- 具體變更：以 `git rm` 移除 10 個無用檔案(共約 9.1MB)。3 個 `.js.map` 是除錯用 source map(生產環境不需要);viewer.* / debugger.* 是 PDF.js 官方完整預覽器(本系統用自製介面,經 grep 確認無引用);compressed.tracemonkey PDF 是官方展示檔。保留 `cmaps/`、`standard_fonts/`、`locale/`、`images/`(渲染 CJK 字型與在地化所需)。

- 修改的檔案路徑：database.py
- 具體變更：移除 `pool_pre_ping=True`(SQLite 為本地檔案不會斷線,每次借連線先 `SELECT 1` 探活是純 overhead);`ensure_order_columns` 新增複合 index `(is_paid, is_printed, created_at)`,加速清理任務查詢(未來訂單累積後不再全表掃描)。

- 修改的檔案路徑：.gitignore
- 具體變更：補充 `*.br`/`*.gz` 註解,說明涵蓋 PDF.js 函式庫、由 `PrecompressedStaticFiles` 派發。

**2. 為什麼要改 (Why it changed):**
- 原始問題或動機：使用者反映部署在 GCP 免費層 e2-micro(1GB RAM、CPU 長時間被節流)的系統「連線變慢」,尤其「首次開網頁很慢」。
- 決策原因：經診斷,根因是 PDF.js 大檔從未被預壓縮(`precompress.py` glob 漏掉 `static/pdfjs/`),卻透過 `StaticFiles` 提供而落入 `BrotliGzipMiddleware`,每次未命中快取的請求都要把整個 1.9MB worker 累積進記憶體再一次即時壓縮,在低 RAM/CPU 環境吃滿資源並讓並發請求排隊;加上 `index.html` 用同步 `<script>` 在首頁就載入 515KB 的 pdf.js 阻塞首屏。採用「預壓縮 + StaticFiles 子類別派發 + 延遲載入」三層組合,徹底消除即時壓縮 CPU 並解除首屏阻塞,而非僅調整 middleware 參數。子類別方案選擇(而非裸 middleware)是為複用 Starlette 內建 MIME 推斷從根本上避開 Content-Type 陷阱。

**3. 後續影響與注意事項 (Impact & Watchouts):**
- 部署後 `deploy.sh` 第 3 步 `python precompress.py` 會自動為 PDF.js 產生預壓縮檔,不需額外手動步驟。
- `pdf.worker.js` 傳輸量從 1.9MB 降至約 283KB(br),降 85.6%;首頁不再載入同步 pdf.js。已用 TestClient 端對端驗證:br/gzip/identity 降階、MIME 為 `application/javascript`、immutable 快取、404 皆正常。
- 移除 source map 後,開發者開啟瀏覽器 DevTools Console 可能看到「找不到 pdf.js.map」警告——這是 PDF.js 官方檔末尾 `//# sourceMappingURL` 註解所致,僅影響除錯、不影響使用者(未開 DevTools 不會觸發),屬預期行為,無需處理。
- 預覽功能首次點擊時會動態載入 PDF.js(有短暫載入時間),之後走瀏覽器 immutable 快取;`workerSrc` 已設為絕對路徑確保 worker 正常。
- 資料庫新增複合 index 會在下次啟動時由 `ensure_order_columns` 自動建立(`CREATE INDEX IF NOT EXISTS`),無需手動 migration。

### [2026/07/22 11:51] - MD3 合規修復：Elevation token 落實、color-scheme、State Layer、樣式去重

**1. 改了哪裡 (What changed):**
- 修改的檔案路徑：style.css
- 具體變更：補上 CSS `color-scheme: light`（`:root`）與 `color-scheme: dark`（`html.dark`），讓原生捲軸、`<dialog>` backdrop、表單控制項隨主題正確切換。新增語意別名 `--md-sys-elevation-card`（=level 1）與 `--md-sys-elevation-raised`（=level 2），將 `.md3-card/.preview-card` 與 `.history-item:hover` 原本手寫的 `box-shadow` 改為 tonal surface token（符合 MD3「elevation 由表面色表達」原則），並移除 `.md3-btn-filled:hover` 多餘的 shadow（改由 state layer 表達）。新增共用 state layer 變數 `--md-sys-state-layer-hover/focus/pressed`（基於 `--on-surface-rgb`，標準透明度 0.08/0.12），為 6 個元件（`.md3-btn-filled`、`.md3-tab`、`.file-item-remove-btn`、`.theme-toggle-btn`、`.chip-group label`、`.m3-dialog-btn`）加上 `::before` 疊加狀態層與全新的 `:focus-visible` 鍵盤焦點回饋。刪除兩段整段重複的樣式定義（`.file-item-card` 系列 77 行 + `.m3-dialog` 全段 125 行，已 diff 驗證位元組級相同），刪除前先將第二份 m3-dialog 獨有的 `:hover`/`:active` 狀態遷移至第一份。淨減 128 行。

- 修改的檔案路徑：admin.css
- 具體變更：於 `:root` 加上 `color-scheme: dark`（後台固定深色配色）。

**2. 為什麼要改 (Why it changed):**
- 原始問題或動機：依據 `material-3` skill 執行 MD3 合規審計，報告得分 64/100。發現四大缺口：(1) `--md-sys-elevation-*` token 定義了卻從未被引用，實際深度全靠手寫 box-shadow；(2) 全專案無任何 CSS `color-scheme` 宣告，原生控制項不隨深色主題切換；(3) 完全沒有 MD3 state layer（hover/focus/pressed 疊加層），互動回饋改用 `filter: brightness()` 等非標準手法；(4) `.file-item-card` 與 `.m3-dialog` 各有整段重複定義（疑為合併遺留）。
- 決策原因：依 MD3 規範「elevation 以 tonal surface color 為主，shadow 僅用於浮動元素的 busy background protection」原則，逐 box-shadow 判斷去留——卡片/歷史項/按鈕改用 token，theme-toggle/dialog/admin switch/modal 因屬浮動元素保留 shadow。state layer 採 `::before` 偽元素疊加層實作（`position:relative` + `overflow:hidden` + `isolation:isolate`），保留既有 hover 視覺作為降級備援。去重前以 `diff` 驗證兩段位元組級相同才刪除，並先遷移第二份獨有的狀態規則。所有變更為「無損附加/等價替換」，不改動任何 HTML 結構與 JS 綁定。預期合規分數 64 → ~78/100。

**3. 後續影響與注意事項 (Impact & Watchouts):**
- 部署前需執行 `python precompress.py` 重新產生 `style.css` / `admin.css` 的 `.br` / `.gz` 預壓縮檔。
- `color-scheme`、`color-mix()`、`:focus-visible`、`:has()` 均需現代瀏覽器（Chrome 111+ / Firefox 113+ / Safari 16.4+），本專案目標瀏覽器已涵蓋。
- state layer 的 `::before` 使用 `z-index: -1` + `isolation: isolate` 隔離，不影響既有 DOM 層疊行為；但建議以瀏覽器實際切換深色/淺色 + 7 種主題，並用 Tab 鍵測試 focus-visible 回饋，確認視覺無退化。
- 本次僅處理使用者端 style.css 的 P0+P1 缺口；後台 admin.css 的 typescale token 補齊、Display/Headline 字級、Navigation Bar/FAB 等導覽元件留待 P2/P3。

### [2026/07/21 23:55] - 里程碑 3(M3):前端 ES Modules 重構 + UX 優化

**1. 改了哪裡 (What changed):**
- 修改的檔案路徑:index.html
- 具體變更:從 1367 行縮減至 273 行。移除全部內嵌 `<script>`,改用 `<script type="module">` 載入外部 ES module。head 的 style.css 版本號更新為 `v=20260721a` 以破壞快取。表單新增上傳進度條元素(`#upload-progress-bar`)。

- 修改的檔案路徑:admin.html
- 具體變更:從 593 行縮減至 137 行。同樣移除內嵌 `<script>`,改用 `<script type="module" src="/static/js/admin/app.js">`。admin.css 版本號更新為 `v=20260721a`。

- 新增的檔案路徑:static/js/utils.js
- 具體變更:共用工具(escHtml、escJsString、formatDate、debounce),供所有模組 import。

- 新增的檔案路徑:static/js/api.js
- 具體變更:API 存取層,封裝 apiGet/apiPost/apiPut/apiDelete 與 apiPostWithProgress(用 XMLHttpRequest 提供上傳進度)。統一錯誤處理:ApiError 類別承載 status/error/detail,自動解析後端制式錯誤格式與 Pydantic 422 驗證錯誤。

- 新增的檔案路徑:static/js/preview.js
- 具體變更:使用者端 PDF 預覽模組,含預覽 token 防競態機制、pdfDoc 快取(切換檔案瞬間顯示)、本地 ArrayBuffer 讀取跳過 blob URL 網路層。

- 新增的檔案路徑:static/js/upload.js
- 具體變更:檔案上傳模組(狀態管理、頁數本地解析優先、設定檔、防呆、上傳後 7 秒冷卻)。M3.4 改用 apiPostWithProgress 顯示即時上傳進度條。

- 新增的檔案路徑:static/js/history.js
- 具體變更:歷史訂單模組,對齊 M2.2 分頁 API:採「載入更多」模式,首次載 50 筆,使用者可點按鈕累積載入下一頁。保留 SWR 快取(sessionStorage)。

- 新增的檔案路徑:static/js/app.js
- 具體變更:使用者端主模組,協調所有子模組。負責 Tab 切換(View Transitions)、主題切換、公告載入(M3.3 加 localStorage 快取 + SWR)、Service Worker 註冊、離線偵測。把 inline onclick 用到的函式(updateFileSetting/removeFile/previewPastOrder 等)掛到 window。

- 新增的檔案路徑:static/js/admin/orders.js、pdf-modal.js、announcements.js、app.js
- 具體變更:後台模組拆分。orders.js 對齊分頁 API(首次載 50 筆 + 載入更多按鈕);pdf-modal.js 含 LRU 快取(8 個)與防競態 token;announcements.js 改用 api.js 統一錯誤處理;app.js 負責模組協調與 window 掛載。

- 修改的檔案路徑:style.css
- 具體變更:新增 `.upload-progress-bar`、`.upload-progress-fill`、`.load-more-btn` 樣式(MD3 規範)。

- 修改的檔案路徑:admin.css
- 具體變更:新增 `.admin-load-more-btn` 樣式。

- 修改的檔案路徑:precompress.py
- 具體變更:`STATIC_FILES` 改用 glob 自動掃描(`*.html`、`*.css`、`sw.js`、`static/js/**/*.js`),新增 JS 模組不必手動維護清單。

- 修改的檔案路徑:sw.js
- 具體變更:快取版本升級至 `print-system-v4`。

- 修改的檔案路徑:deploy.sh
- 具體變更:健康檢查步驟新增 `curl /health`(若伺服器有 curl),驗證回應 200。

**2. 為什麼要改 (Why it changed):**
- 原始問題或動機:index.html(1367 行)與 admin.html(593 行)的 JS 全內嵌在單一 `<script>` 中,難以維護、無法重用、IDE 補全與型別檢查失效。前端公告每次載入都重新 fetch 無快取;上傳無進度條,大檔案時使用者不知進度;後台訂單列表一次回全量,訂單量大時浪費頻寬;錯誤處理散落各處 fetch 呼叫,訊息格式不一致。
- 決策原因:
  - **ES Modules 而非框架**:使用者選擇「原生 JS + 模組化重構」。ES module 提供關注點分離、重用、IDE 支援,但不引入 build tool,部署流程不變。inline onclick 的函式透過 `window.xxx = xxx` 橋接,保留 HTML 結構不動。
  - **分頁採「載入更多」而非頁碼**:這套系統是學校影印訂單,單一使用者訂單量有限,「載入更多」比頁碼切換更直覺,且向後相容舊 API(無 page 參數時)。後台同理,管理員可滾動累積查看。
  - **上傳進度用 XMLHttpRequest**:fetch API 沒有原生 upload progress,XHR 的 upload.onprogress 是唯一選擇,且相容性最好。
  - **公告 localStorage 快取**:公告變動頻率極低(管理員手動發布),5 分鐘 TTL + SWR(先顯示快取、背景更新)能避免每次載入頁面都閃一下空白。
  - **api.js 統一錯誤處理**:對齊 M2.7 後端的全域 exception handler 制式格式 `{error, detail}`,前端不再各處手寫 `if (!res.ok) throw new Error('HTTP ' + res.status)`。

**3. 後續影響與注意事項 (Impact & Watchouts):**
- **部署前必須執行 `python precompress.py`**:precompress.py 已改用 glob 自動掃描 JS 模組,deploy.sh 會自動執行。若手動部署漏掉,JS 模組仍可載入(後端會降級回傳未壓縮原始檔),但首次載入會較慢。
- **Service Worker 快取升級至 v4**:使用者首次造訪後,舊 v3 快取會在 activate 階段自動清除。但因 ES module 的 import 路徑內含 `?v=20260721a` query string,即使快取命中也不會用到舊版模組(cache-busting)。
- **ES module 的嚴格模式**:所有模組自動啟用 strict mode,部分舊寫法(如未宣告變數)會報錯。已全部通過 `node --check` 語法驗證。
- **inline onclick 仍可用**:`updateFileSetting`、`removeFile`、`openPdfModal` 等透過 `window.xxx = xxx` 橋接,HTML 結構完全不動,降低回歸風險。
- **dialog.js 仍是傳統腳本**(非 module),因為它在兩個頁面都用、且不需要 import。app.js 透過 `window.showAlert` 橋接給其他 ES module 使用,並用 bootstrap 輪詢確保 dialog.js 已就緒才初始化。
- **未對齊的舊 API 呼叫**:目前前後台都已改用 `?page=1&page_size=50` 分頁呼叫,不再收到 `X-Deprecation-Warning` header。
- 本輪為「3 個里程碑現代化計畫」的 M3(前端重構 + UX),整套計畫至此完成。

### [2026/07/21 23:25] - 里程碑 2(M2):核心效能 + 可觀測性現代化

**1. 改了哪裡 (What changed):**
- 修改的檔案路徑：main.py
- 具體變更:
  1. **Lifespan 改寫(M2.1)**:移除棄用的 `@app.on_event("startup")`,改用 `@asynccontextmanager lifespan(app)` + `FastAPI(lifespan=lifespan)`。啟動時立即執行首次清理 + 啟動 APScheduler 排程;`yield` 後呼叫 `scheduler.shutdown(wait=False)` 實現優雅停機(供 GCP 搶佔/重新部署快速回應 SIGTERM)。APS 採 `max_instances=1, coalesce=True` 避免任務重疊。舊的 `cleanup_old_orders` 抽出為可重用的 `_cleanup_old_orders_once()` + `_scheduled_cleanup()` 包裝器。
  2. **訂單 API 分頁(M2.2)**:`/api/orders` 與 `/api/orders/history` 新增 `?page=N&page_size=M`。向後相容設計:無 `page` 參數時回舊版純陣列(但加上 `ORDERS_MAX_PAGE_SIZE=200` 安全上限 + `X-Deprecation-Warning` 英文 header),有 `page` 時回 `{items, total, page, page_size, total_pages}`。`page_size` 自動截到上限。DB 層 `LIMIT/OFFSET`。
  3. **PDF Range Request(M2.3)**:新增 `_parse_range_header()` + `serve_pdf_with_range()` 工具,支援 HTTP 206 Partial Content 與 416 Range Not Satisfiable。用 `aiofiles` 非同步分塊讀取(64KB chunks),`async with` 確保連線中斷時 fd 正確釋放,**避免一次讀進 RAM**。套用到 `/api/orders/{id}/file` 與 `/api/orders/{id}/preview`,取代舊版 `FileResponse`。
  4. **asyncio 升級(M2.4)**:`count_pdf_pages` 從棄用的 `get_event_loop().run_in_executor` 改為 `asyncio.to_thread`(Python 3.9+)。lifespan 內首次清理也用 `asyncio.to_thread`。
  5. **Request Logging Middleware(M2.5)**:新增 `RequestLoggingMiddleware`,記錄每個 HTTP 請求的 method/path/status/耗時/IP/user_agent,4xx→warning、5xx→error、2xx→info。跳過 `/health`、`/static/`、`/sw.js` 避免雜訊。
  6. **`/health` 端點(M2.6)**:新增健康檢查,回 `{status, db, uptime_seconds, version}`,不要求認證、不限流,DB 用 `SELECT 1` 驗證。`Cache-Control: no-store`(配合修正 middleware 不再誤刪 no-store)。
  7. **全域 exception handler(M2.7)**:`@app.exception_handler(Exception)` 攔截未預期例外,回 500 + 制式 `{error, detail}` 格式,完整堆疊寫進 log,避免暴露給前端。
  8. **快取 header 修正**:SecurityAndCacheMiddleware 原本會把所有 `no-store` 當「不推薦」刪除,現已保留(健康檢查、敏感動態回應需要),只清 `must-revalidate`。

- 修改的檔案路徑:(無新增檔案,M2 全在 main.py 完成)

**2. 為什麼要改 (Why it changed):**
- 原始問題或動機:GCP e2-micro 僅 1GB RAM,舊版有三個風險點 — (a) 訂單 API 一次回全量,訂單累積後會吃 RAM 與外送流量;(b) `FileResponse` 不支援 Range,大 PDF 預覽無法跳頁串流;(c) `@app.on_event` 只在啟動清一次,長期不重啟磁碟不會釋放。此外缺乏 request logging 與健康檢查,運維盲點多。
- 決策原因:
  - **分頁採向後相容**:避免破壞既有 admin.html 與未知外部呼叫者。沒帶 page 仍可用(但加上限保護 + 預警 header),前後端可漸進遷移。
  - **Range Request 用 aiofiles 而非同步 read()**:免費層 RAM 珍貴,分塊串流確保 10MB PDF 也不會一次吃 10MB RAM;`async with` 確保 fd 不洩漏(回应 review 提到的踩坑點)。
  - **APScheduler 而非 asyncio 迴圈**:APS 原生支援 `max_instances`/`coalesce`/時區/優雅關閉,比手寫 asyncio.create_task 穩健。`shutdown(wait=False)` 確保 GCP 搶佔能快速停機。
  - **lifespan 而非 on_event**:後者在 FastAPI 已棄用,新版強烈建議改 lifespan;順帶把 scheduler 啟動/關閉成對包在 lifespan 內,避免舊版「只啟動不關閉」的隱患。

**3. 後續影響與注意事項 (Impact & Watchouts):**
- 本輪**未改前端**;admin.html / index.html 目前仍用舊版(無分頁)呼叫 API,仍可運作,但會收到 `X-Deprecation-Warning` header。M3 會把前端改為分頁 + 「載入更多」UI。
- APScheduler 為 in-process 排程,若未來有多個 uvicorn worker,每個 worker 各自排程(可能重複清理);目前 pm2 推測為單 worker,影響有限。清理任務本身是冪等的(刪除符合條件的舊訂單,重複執行無害)。
- `/health` 適合接到 GCP Load Balancer 健康檢查或 Uptime Monitoring;若部署在 nginx 後,記得允許 `/health` 不需認證通過。
- Range Request 對現有 PDF.js 預覽體驗是「免費升級」:瀏覽器會自動在跳頁時發 Range 請求,大檔案開啟速度明顯改善。
- 全域 exception handler 只攔截 `Exception` 子類;`HTTPException`(已由 FastAPI 處理)與 `asyncio.CancelledError` 不受影響。
- 本輪無新增環境變數,部署只要 `bash deploy.sh` 即可(pip install 會裝上 M1 已加入的 apscheduler/aiofiles)。
- 為 3 個里程碑現代化計畫的 M2(核心效能 + 可觀測性);M3 將處理前端 ES Modules 重構與 UI 對齊分頁 API。

### [2026/07/21 22:44] - 里程碑 1(M1):集中式設定 + 安全底層現代化

**1. 改了哪裡 (What changed):**
- 新增的檔案路徑：config.py
- 具體變更：以 `pydantic-settings` 建立集中式 `Settings` 類別,涵蓋 ADMIN 帳密、LINE Token、TRUSTED_PROXIES、上傳/限流/清理/分頁/日誌等所有環境變數。提供 `@lru_cache` 全域實例 `settings` 與衍生屬性 `max_upload_bytes`、`trusted_proxy_networks`,取代散落各檔的 `os.getenv`。

- 新增的檔案路徑：schemas.py
- 具體變更：為寫入端點定義 Pydantic `BaseModel`(AnnouncementCreate、AnnouncementUpdate、OrderStatusUpdate),含 field_validator 自動 strip 空白與非空檢查,取代 main.py 中裸 dict 接收 payload 的舊寫法。

- 修改的檔案路徑：main.py
- 具體變更：
  1. 移除 `dotenv.load_dotenv()`,改統一由 config.py 載入 .env
  2. 擴充 `RateLimiter` 類別,新增 `register_failure` / `is_locked` / `reset_failure` 三個方法支援暴力破解鎖定語意;`_cleanup` 同時清理過期失敗記錄
  3. 重寫 `_get_client_ip`:新增 `_is_ip_trusted()` 用 `ipaddress` 做 CIDR 比對,只有當 TCP 連線來源落在 `TRUSTED_PROXIES` 時才解析 `X-Forwarded-For` 最左側節點,否則一律用 `request.client.host`(直連模式),修補無條件信任 XFF 可被偽造的漏洞
  4. 新增 `rate_limit(key_prefix, max_hits, window)` FastAPI dependency 工廠,依 key_prefix 自動對應 settings 中的預設限流值,回 429 並附 `Retry-After` header
  5. 重寫 `authenticate_admin`:加入 `request: Request` 參數,以 `hashlib.sha256(IP:Username)` 為鎖定 key(NAT 隔離),連續失敗達 `ADMIN_MAX_LOGIN_FAILURES` 次後回 423 Locked 並鎖定 `ADMIN_LOCK_DURATION_MIN` 分鐘;成功登入立即清除失敗計數
  6. 將所有 API 端點的限流從手寫 `if not rate_limiter.is_allowed(...)` 改為 `Depends(rate_limit(...))`,並補齊原本完全沒限流的 `/api/announcements`、`/api/orders/{id}/preview`、`/api/orders/{id}/file`、管理員 CRUD 端點
  7. 寫入端點改用 `schemas.py` 的 Pydantic 模型取代 `payload: dict`
  8. `MAX_UPLOAD_SIZE` 改由 `settings.max_upload_bytes` 動態提供

- 修改的檔案路徑：requirements.txt
- 具體變更：重新分組並加註解。新增 `python-multipart>=0.0.6`(FastAPI 上傳明確依賴)、`pydantic-settings>=2.0.0`、`aiofiles>=23.0.0`(M2 PDF 串流用)、`apscheduler>=3.10.0`(M2 定期清理用)。`pypdf` 下限升至 4.0.0。

- 修改的檔案路徑：.env.example
- 具體變更：補齊所有新環境變數(TRUSTED_PROXIES、RATE_LIMIT_*、ADMIN_MAX_LOGIN_FAILURES、ADMIN_LOCK_DURATION_MIN、ORDER_RETENTION_DAYS、CLEANUP_INTERVAL_HOURS、ORDERS_DEFAULT_PAGE_SIZE、ORDERS_MAX_PAGE_SIZE、LOG_LEVEL、APP_VERSION),每項都加上用途說明與安全性提醒。

**2. 為什麼要改 (Why it changed):**
- 原始問題或動機：這套系統架在 GCP 免費層,長期累積多輪修改後,設定散落於 main.py、notify.py 各處的 `os.getenv`,難以維護;同時存在多項安全漏洞:`_get_client_ip` 無條件信任 `X-Forwarded-For`(直連模式下攻擊者可偽造 IP 繞過限流)、部分 API 端點完全無限流、管理員 Basic Auth 無失敗鎖定可被暴力破解、寫入端點用裸 dict 無型別驗證。
- 決策原因：採「不破壞現有業務邏輯」原則,先把地基與底層安全補穩。選 `pydantic-settings` 是因為它已內建在 FastAPI 生態,提供型別驗證與文件化,無額外學習成本。IP 偵測用 `TRUSTED_PROXIES` 環境變數控制,同時支援「直連」與「反代」兩種部署模式,比硬編碼任一邊更安全。鎖定 key 用 `hash(IP+Username)` 而非單純 IP,可避免 NAT 環境下單一使用者連累整個網段。

**3. 後續影響與注意事項 (Impact & Watchouts):**
- 部署前務必在 `.env` 設定 `TRUSTED_PROXIES`。**直連 uvicorn(如 pm2 直接跑)請留空**;若伺服器前方有 nginx/Caddy/CloudFlare,才填入反代的 CIDR(如 `127.0.0.1/32`)。設定錯誤會導致所有請求被當作同一 IP,影響限流準確度。
- 管理員連續登入失敗 5 次會被鎖定 15 分鐘(可由 `ADMIN_MAX_LOGIN_FAILURES`、`ADMIN_LOCK_DURATION_MIN` 調整)。鎖定期間即使輸入正確密碼仍會被拒。
- RateLimiter 與鎖定計數為 in-memory,重啟後歸零;若未來有多 worker 進程,各 worker 有獨立計數器。
- 本輪未改動任何前端檔案(HTML/CSS/JS),無需重新執行 `precompress.py`,但伺服器需 `pip install -r requirements.txt` 安裝新依賴。
- 本輪為「3 個里程碑現代化計畫」的 M1(配置 + 底層 + 安全);M2 將處理核心效能(分頁、PDF Range Request、排程清理),M3 處理前端重構。

### 2026/07/05 13:14 - 前端安全性與效能優化：Admin 認證流程、cMap 路徑修正、Service Worker 升級
**1. 改了哪裡 (What changed):**
- 修改的檔案路徑：admin.html
- 具體變更：新增前端認證管理模組（`adminCredentials`、`getAuthHeaders`、`showLoginPrompt`、`authFetch`），將所有 9 處 `fetch()` 呼叫替換為 `authFetch()`，並在 `pdfjsLib.getDocument()` 加入 `httpHeaders` 以傳遞 Basic Auth 憑證。

- 修改的檔案路徑：index.html
- 具體變更：將 `previewPastOrder` 函數中的 `cMapUrl` 從 CDN 路徑 (`cdnjs.cloudflare.com`) 改為本地路徑 (`/static/pdfjs/web/cmaps/`)。

- 修改的檔案路徑：sw.js
- 具體變更：升級快取版本至 `print-system-v3`，擴充預快取清單（加入 `style.css`、`admin.css`），新增 `MAX_CACHE_ENTRIES = 50` 上限與 `trimCache()` 函數進行 LRU 淘汰。

**2. 為什麼要改 (Why it changed):**
- 原始問題或動機：admin.html 的 API 請求依賴瀏覽器原生 HTTP Basic Auth 對話框，使用者體驗差且容易困惑；index.html 的 cMap 使用外部 CDN 與其他頁面不一致；sw.js 快取項目數量沒有上限，長期使用可能無限增長。
- 決策原因：使用 `sessionStorage` 存放 Base64 編碼的憑證，透過 `authFetch` wrapper 自動附加 `Authorization` header 並處理 401 重新登入，避免瀏覽器原生彈窗。cMap 統一使用本地資源減少外部依賴。Service Worker 加入 `trimCache` 以 FIFO 方式淘汰舊快取。

**3. 後續影響與注意事項 (Impact & Watchouts):**
- `sessionStorage` 的憑證在分頁關閉後會自動清除，管理員需重新登入。
- `authFetch` 在收到 401 時只會重試一次，若再次失敗則拋出錯誤。
- Service Worker 快取版本已更新為 v3，舊版快取會在 activate 階段自動清除，使用者需重新載入頁面。
- `pdfjsLib.getDocument` 的 `httpHeaders` 選項需要 PDF.js 2.x+ 版本支援。

### 2026/07/06 10:20 - 後端安全性與性能優化：Rate Limiting、上傳限制、SQLite WAL、非同步 I/O、自動清理
**1. 改了哪裡 (What changed):**
- 修改的檔案路徑：main.py
- 具體變更：新增 RateLimiter 類別（滑動視窗，in-memory）、_get_client_ip 輔助函式。上傳端點加入 5次/分/IP 限制、20MB 大小限制、PDF magic bytes 驗證。API 查詢端點加入 30次/分/IP 限制。count_pdf_pages 改為 async (run_in_executor)。shutil.copy2 改為非同步執行。新增安全 Headers (Referrer-Policy, Permissions-Policy)。新增啟動時自動清理 30 天前已完成訂單。修復 SecurityAndCacheMiddleware 被截斷的快取策略邏輯。

- 修改的檔案路徑：database.py
- 具體變更：快取 _TZ_TAIPEI 物件。新增 SQLite PRAGMA 優化（WAL 模式、synchronous=NORMAL、8MB cache_size、busy_timeout=5s）。新增複合索引 (user_name, created_at DESC)。設定 pool_size=5, max_overflow=10。

- 修改的檔案路徑：notify.py
- 具體變更：新增 send_line_notification_async 函式，使用 run_in_executor 包裝阻塞式 requests.post，避免 10 秒超時阻塞事件循環。

- 修改的檔案路徑：compression.py
- 具體變更：新增 _static_file_cache 與 _get_file_meta 函式，快取靜態檔案的 os.stat 結果與預壓縮檔存在狀態，避免每次請求重複系統呼叫。

- 修改的檔案路徑：deploy.sh
- 具體變更：新增部署前 SQLite 備份（保留最近 5 份）、明確指定 git pull origin main、改用 requirements.txt 安裝套件、新增健康檢查步驟。

- 新增的檔案路徑：requirements.txt
- 具體變更：明確列出所有 Python 依賴（fastapi, uvicorn, sqlalchemy, pypdf, python-dotenv, requests, brotli, zstandard）。

- 修改的檔案路徑：.gitignore
- 具體變更：新增 backups/ 目錄排除。

**2. 為什麼要改 (Why it changed):**
- 原始問題或動機：系統部署在 GCP 免費層級（f1-micro/e2-micro），受限於 CPU、記憶體、磁碟空間。原始碼存在多項安全漏洞（無速率限制、無上傳大小限制、無檔案驗證）和性能瓶頸（同步 PDF 解析阻塞事件循環、SQLite 預設日誌模式鎖競爭、每次請求重複 os.stat）。
- 決策原因：使用 in-memory Rate Limiter 而非 Redis，是因為免費層級不適合增加外部依賴。選擇 WAL 模式是因為它允許讀寫併發，適合 Web 應用場景。run_in_executor 使用預設線程池，對免費層級的 CPU 限制影響最小。自動清理 30 天舊訂單可持續釋放有限的磁碟空間。

**3. 後續影響與注意事項 (Impact & Watchouts):**
- Rate Limiter 是 in-memory 的，重啟後計數器歸零。若有多個 worker 進程，每個 worker 有獨立的計數器。
- WAL 模式會在資料庫旁產生 -wal 和 -shm 檔案，這是正常的。
- 自動清理只在伺服器啟動時執行一次，不是定期任務。若需要更頻繁的清理，可改用 cron。
- 部署腳本現在會在 backups/ 目錄建立 SQLite 備份，保留最近 5 份。

### 2026/07/06 11:24 - 認證優化：移除 admin.html 重複的前端彈窗登入
**1. 改了哪裡 (What changed):**
- 修改的檔案路徑：admin.html
- 具體變更：移除手寫的 `showLoginPrompt`、`authFetch` 認證程式碼，將所有 API 請求還原為原生 `fetch()` 呼叫，並移除載入 PDF 時的 `httpHeaders` 自訂設定。

**2. 為什麼要改 (Why it changed):**
- 原始問題或動機：使用者反映一開始進入後台需要輸入一次帳密（瀏覽器原生 HTTP Basic Auth），隨後網頁 JS 又跳出第二次彈窗要求輸入。
- 決策原因：瀏覽器在通過第一次 Basic Auth 驗證後，會自動在後續同網域的 AJAX/fetch 請求中附加 `Authorization` header。因此完全不需要前端手動實作二次彈窗。

**3. 後續影響與注意事項 (Impact & Watchouts):**
- 管理員現在只需在載入頁面時輸入一次帳密即可正常操作所有功能，體驗更佳。
- 密碼設定依然透過後端的 `.env` 配置。

### 2026/07/06 12:50 - 使用者體驗優化：升級原生對話框為 Material 3 自訂對話框

**1. 改了哪裡 (What changed):**
- 新增的檔案路徑：[dialog.js](file:///d:/data/%E5%BD%B0%E5%B8%AB%E5%A4%A7/AI%20vibecoding/print_system/static/dialog.js)
- 具體變更：新增自訂對話框核心模組，包含 `showM3Dialog`、`showAlert`、`showConfirm`。實作 Promise-based 對話框佇列 (Queue)，防止多個對話框重疊；支援自動偵測文字中的 Emoji（⚠️、❌、✅）以映射到對應的精美 SVG 圖示與主題色，並自定標題。支援鍵盤焦點鎖定（`Enter` 確認、`Esc` 取消）。

- 修改的檔案路徑：[style.css](file:///d:/data/%E5%BD%B0%E5%B8%AB%E5%A4%A7/AI%20vibecoding/print_system/style.css)
- 具體變更：新增 `.m3-dialog` 及其子元素（圓角 `28px`、毛玻璃 `backdrop-filter: blur(4px)`、陰影、SVG 圖示配色、無邊框 Text Button 藥丸圓角 `100px`）的樣式與縮放淡入/淡出動畫。

- 修改的檔案路徑：[admin.css](file:///d:/data/%E5%BD%B0%E5%B8%AB%E5%A4%A7/AI%20vibecoding/print_system/admin.css)
- 具體變更：新增後台相應的 `.m3-dialog` 及其子元素樣式，調適顏色變數（如 `--card` 作為背景、`--text` 作為文字、`--accent` 作為按鈕點綴色）。

- 修改的檔案路徑：[index.html](file:///d:/data/%E5%BD%B0%E5%B8%AB%E5%A4%A7/AI%20vibecoding/print_system/index.html)
- 具體變更：引入 `/static/dialog.js`，將 `addFiles` 改為 `async` 函數並以 `await showConfirm` 確認重名處理，將其他 10 處 `alert(...)` 全數替換為 `await showAlert(...)`。

- 修改的檔案路徑：[admin.html](file:///d:/data/%E5%BD%B0%E5%B8%AB%E5%A4%A7/AI%20vibecoding/print_system/admin.html)
- 具體變更：引入 `/static/dialog.js`，將刪除訂單與刪除公告時的確認對話框改為 `await showConfirm(...)`。

- 壓縮產生的檔案：index.html.br, index.html.gz, admin.html.br, admin.html.gz, style.css.br, style.css.gz, admin.css.br, admin.css.gz
- 具體變更：執行 `python precompress.py` 重新產生最新的預壓縮檔案，以確保伺服器分發最新的對話框程式碼。

**2. 為什麼要改 (Why it changed):**
- 原始問題或動機：原生的瀏覽器 `alert()` 與 `confirm()` 對話框樣式與網頁整體精緻設計割裂，影響用戶體驗。且在部分情況下同時彈出多個 Alert 會產生 UI 衝突。
- 決策原因：將對話框抽象成單一靜態檔符合 DRY 原則。採用 HTML5 原生 `<dialog>` 標籤並結合 CSS 樣式，可透過瀏覽器底層管理層級 (Top-layer) 與 Focus Trapping。引入 Promise-based 佇列以 FIFO 順序顯示對話框，優化鍵盤 Enter/Esc 操控。

**3. 後續影響與注意事項 (Impact & Watchouts):**
- 呼叫對話框的函數均變更為非同步，未來若要在其他位置使用必須配合 `async/await`。
- 修改 CSS/HTML 後，若手動編輯專案檔案，部署或測試前務必執行 `python precompress.py` 重新壓縮靜態資源，否則伺服器端會繼續向瀏覽器傳送舊的壓縮快取。

### 2026/07/20 21:52 - 環境配置：建立 Antigravity 專屬技能資料夾並下載 material-3-skill
**1. 改了哪裡 (What changed):**
- 新增的檔案目錄：`.agents/skills/material-3-skill`
- 具體變更：在專案根目錄下建立了 `.agents/skills` 資料夾，並成功將 `material-3-skill` 專案 (https://github.com/hamen/material-3-skill.git) git clone 到該資料夾中。

**2. 為什麼要改 (Why it changed):**
- 原始問題或動機：使用者要求在專案根目錄下建立 Antigravity 專屬的技能資料夾，並下載 `material-3-skill` 專案，以擴充 AI 助理的技能庫。
- 決策原因：遵守使用者指示與客製化規則，讓 Antigravity 在此專案中可自動載入並使用 Material 3 技能。

**3. 後續影響與注意事項 (Impact & Watchouts):**
- `.agents/skills/material-3-skill` 資料夾中包含 `SKILL.md`，Antigravity 可於後續對話中自動載入其定義的技能與規則。

### [2026/07/20 22:06] - 全面升級至 Material Design 3 (MD3) 規範
**1. 改了哪裡 (What changed):**
- 修改的檔案路徑：style.css,  dmin.css, index.html,  dmin.html
- 具體變更：
  - 將自訂的顏色變數全面替換為 --md-sys-color-* 系列。
  - 移除了舊有的 md3-* 假元件類別，並在 HTML 中透過 ESM CDN 引入真正的 @material/web 元件 (md-filled-button, md-outlined-text-field, md-tabs, md-switch)。
  - 移除了隱藏的 SVG Sprite，改用官方 Material Symbols 字體與 <md-icon>。
  - 在 CSS 頂部加入了 :not(:defined) 以防止 FOUC (未設樣式內容閃爍)。
  - 更新了與 Web Components 互動的 JavaScript (例如使用 	his.selected 取代 	his.checked)。

**2. 為什麼要改 (Why it changed):**
- 原始問題或動機：使用者要求進行 MD3 Compliance Audit，並指示將專案的 UI 完全升級為 Material Design 3 最佳規範。
- 決策原因：改用 @material/web 官方 Web Components 與標準 Design Tokens，能夠獲得最正確的視覺表現 (如 Tonal Elevation)、無障礙設計 (a11y) 與互動回饋 (如 Ripple effect)，並使程式碼更加現代化與易維護。

**3. 後續影響與注意事項 (Impact & Watchouts):**
- **Shadow DOM 影響**：後續如果有其他 JS 需要修改元件內部的原生 HTML (例如 <input>)，請注意無法直接使用 querySelector 穿透 Shadow DOM，必須操作 Custom Element 暴露出來的 API (如 .value, .selected)。
- **CDN 依賴**：現在前端重度依賴 https://esm.run/@material/web/...，這意味著客戶端必須有網路連線才能渲染 UI 元件。若有離線需求，未來需考慮透過 npm 安裝並打包。

### [2026/07/20 22:12] - style.css 加入 MD3 Design Token Aliases 與 Motion Token 升級
**1. 改了哪裡 (What changed):**
- 修改的檔案路徑：style.css
- 具體變更：
  - 在 `:root` 頂部加入 `--md-sys-color-*`、`--md-sys-shape-corner-*`、`--md-sys-motion-*`、`--md-sys-elevation-*` 等 MD3 標準 token aliases，全部指向既有的 `--primary`、`--surface` 等自訂屬性。
  - 將 7 處硬編碼的 transition 時間/曲線 (如 `.2s`、`0.3s cubic-bezier(0.4,0,0.2,1)`) 改用 `var(--md-sys-motion-duration-short)` / `var(--md-sys-motion-easing-emphasized)` 等 token。
  - 將 `.md3-card, .preview-card` 的 box-shadow 從單層陰影改為 MD3 Level 1 雙層陰影。

**2. 為什麼要改 (Why it changed):**
- 原始問題或動機：現有 CSS 已是 MD3 風格，但缺少標準 `--md-sys-*` token 命名空間，且動畫參數分散硬編碼，不利於全局調整。
- 決策原因：採用純加法 (additive) 策略——所有新 token 都是 alias（`var(--primary)` 等），不修改也不移除原有變數，確保 HTML/JS 不受影響。統一 motion token 可未來一處修改、全站生效。

**3. 後續影響與注意事項 (Impact & Watchouts):**
- 所有原有的 `--primary`、`--surface` 等自訂屬性保持不變，HTML/JS 不需修改。
- 新增的 `color-mix()` 函數需要現代瀏覽器支援 (Chrome 111+, Firefox 113+, Safari 16.2+)。
- 修改 CSS 後，部署前記得執行 `python precompress.py` 重新產生壓縮檔。

### [2026/07/20 22:14] - 安全升級 CSS 至 Material Design 3 Token 系統
**1. 改了哪裡 (What changed):**
- 修改的檔案路徑：style.css, admin.css
- 具體變更：
  - 在 :root 中新增了完整的 MD3 Design Token 別名 (--md-sys-color-*, --md-sys-shape-corner-*, --md-sys-motion-*, --md-sys-elevation-*)
  - 所有 transition 動畫改用 MD3 標準的 Easing 曲線 (Emphasized / Standard)
  - 卡片陰影改為 MD3 Level 1 Elevation 標準值
  - 新增 Tonal Elevation 色階 (elevation-1/2/3) 與 surface-container 層級

**2. 為什麼要改 (Why it changed):**
- 原始問題或動機：使用者要求依照 material-3-skill 規範進行 compliance audit 並全面升級
- 決策原因：上一次嘗試同時替換 HTML 元件 + CSS 變數 + JS 邏輯導致頁面完全損壞。這次改採「只加不刪」的安全策略，僅在 CSS 層新增 MD3 Token 別名指向既有變數，確保現有 HTML/JS 完全不受影響

**3. 後續影響與注意事項 (Impact & Watchouts):**
- 所有原始變數名 (--primary, --surface 等) 完全保留，不影響現有程式碼
- 新增的 --md-sys-* Token 可供未來漸進式遷移使用
- color-mix() 函式需要現代瀏覽器支援 (Chrome 111+, Firefox 113+, Safari 16.2+)

### [2026/07/20 23:42] - 將 MD3 Token 真正套用到所有 CSS 規則
**1. 改了哪裡 (What changed):**
- 修改的檔案路徑：style.css, admin.css
- 具體變更：
  - 新增 30 個 Typography Token (Title Large/Medium/Small, Body Large/Medium, Label Large/Small)
  - 替換 18 處硬編碼 border-radius 為 var(--md-sys-shape-corner-*) Token
  - 替換 6 處裝飾性 border 顏色為 var(--md-sys-color-outline-variant)
  - 標題 (.header h1) 套用 Title Large type scale
  - 副標題 (.header p) 套用 Body Medium type scale
  - 按鈕 (.md3-btn-filled) 套用 Label Large type scale
  - 分頁標籤 (.md3-tab) 套用 Title Small type scale
  - 區段標籤 (.section-label) 套用 Label Small type scale

**2. 為什麼要改 (Why it changed):**
- 原始問題或動機：上一步雖然定義了 MD3 Token 別名，但沒有真正使用它們，等於虛設
- 決策原因：依照 material-3-skill Anti-Patterns 規範，不應該硬編碼 border-radius 和 font-size，必須透過 Token 控制以維持主題一致性

**3. 後續影響與注意事項 (Impact & Watchouts):**
- 純 CSS 修改，HTML/JS 完全沒動，不會有上次破壞頁面的風險
- 所有 shape token 都帶有 fallback 值，瀏覽器相容性有保障
- Typography 的 weight 值從 700 改為 MD3 標準的 400 (Title Large)，標題視覺會稍微變細

### [2026/07/20 23:48] - 加入 MD3 Expressive Tab 切換過渡動畫
**1. 改了哪裡 (What changed):**
- 修改的檔案路徑：index.html, style.css
- 具體變更：
  - 在 JS 中的 \switchTab\ 函式導入了原生的 \document.startViewTransition\ API。
  - 在 CSS 中針對 \::view-transition-old\ 與 \::view-transition-new\ 定義了 MD3 規範的「Fade Through」動畫。
  - 為標題 (\.header\) 與面板 (\#upload-panel\, \#history-panel\) 分別設定了獨立的 \iew-transition-name\。

**2. 為什麼要改 (Why it changed):**
- 原始問題或動機：使用者反映在「檔案上傳」與「歷史訂單」之間切換時是直接生硬的切換，缺乏動態回饋。
- 決策原因：根據 Material Design 3 Expressive 規範，視圖切換應使用滑順的過渡動畫 (如 Fade Through 或 Shared Axis)。使用現代的 View Transitions API 能在不破壞現有 DOM 結構且程式碼變動極小的情況下，實現極具原生 App 質感的跨元件過渡動畫 (交叉淡出淡入 + 輕微縮放)。

**3. 後續影響與注意事項 (Impact & Watchouts):**
- View Transitions API 是現代瀏覽器功能。若使用者的瀏覽器不支援，會自動退回 (graceful degradation) 原本的瞬間切換模式，不會導致頁面損壞。

### [2026/07/20 23:52] - 為亮暗模式切換加入 MD3 View Transitions 動畫
**1. 改了哪裡 (What changed):**
- 修改的檔案路徑：index.html, style.css
- 具體變更：
  - 在 \index.html\ 的 \	hemeToggleBtn\ 點擊事件中導入 \document.startViewTransition\ API，包裹了 \classList.toggle('dark')\ 的切換邏輯。
  - 在 \style.css\ 中，將 \::view-transition-old(root)\ 與 \::view-transition-new(root)\ 的基礎動畫時長設定為 \ar(--md-sys-motion-duration-long, 500ms)\。

**2. 為什麼要改 (Why it changed):**
- 原始問題或動機：使用者希望亮暗模式 (Dark Mode) 切換時也能有滑順的動畫，而非生硬的瞬間變色。
- 決策原因：既然已經為 Tab 實作了 View Transitions API，最優雅且無副作用的解法就是直接將主題切換也包進 View Transition 中。瀏覽器會自動為整頁 (root) 進行完美的截圖與交叉淡出淡入 (Cross-fade) 處理，帶來極具質感的 MD3 體驗。

**3. 後續影響與注意事項 (Impact & Watchouts):**
- 由於共用 View Transitions 機制，這會讓所有的主題切換都自動帶有 500ms 的滑順淡入淡出效果。支援程度取決於現代瀏覽器，舊版瀏覽器依然能瞬間切換，不影響功能。

### [2026/07/20 23:56] - 修復文字輸入框 (Text Field) 切換焦點時的跳動與動畫問題
**1. 改了哪裡 (What changed):**
- 修改的檔案路徑：style.css
- 具體變更：
  - 將輸入框 (\.md3-text-field input\) 的 focus 狀態從 \order-bottom: 2px\ 改為使用 \ox-shadow: 0 1px 0 0\ 來增加底線厚度。
  - 將浮動標籤 (\.md3-text-field label\) 的浮動動畫，從改變 \	op\ 與 \ont-size\ 改為使用硬體加速的 \	ransform: translateY() scale()\。
  - 修正了當輸入框內有文字但未獲得焦點時，標籤顏色錯誤顯示為 primary 色 (應為灰色) 的問題。

**2. 為什麼要改 (Why it changed):**
- 原始問題或動機：使用者反映在切換兩個文字輸入框 (姓名、取件時間) 時，會發生不符合動畫的「跳動」(Jitter)。
- 決策原因：
  1. **1px 版面跳動**：原先 focus 時將 border 變粗 1px，導致整個輸入框高度增加 1px，進而推擠下方所有元素，造成明顯的排版跳動。改用 box-shadow 可在不改變元素實際尺寸的前提下增加視覺厚度。
  2. **文字縮放抖動**：CSS 中直接以動畫改變 font-size 會觸發瀏覽器極密集的排版重算 (Reflow)，導致動畫非常生硬與抖動。改用 MD3 標準的 transform (scale) 則可交由 GPU 渲染，極度滑順。

**3. 後續影響與注意事項 (Impact & Watchouts):**
- 這些 CSS 調整完全針對 \.md3-text-field\，提升了效能與視覺順暢度，未動到 HTML 結構。

### [2026/07/21 00:02] - 修復 View Transitions 切換時出現底色破圖 (透明破洞) 的問題
**1. 改了哪裡 (What changed):**
- 修改的檔案路徑：style.css
- 具體變更：
  - 移除了 \#upload-panel\, \#history-panel\ 以及 \.header\ 身上的 \iew-transition-name\ 屬性。
  - 將所有過渡動畫統一交給整頁的 oot\ 層級處理 (維持 500ms 交叉淡出淡入)。

**2. 為什麼要改 (Why it changed):**
- 原始問題或動機：使用者發現在切換主題或分頁時，輸入框周圍的背景顏色會突然變得比預期還深 (露出灰色的 Body 底色)，產生明顯的顏色差異跳動。
- 決策原因：這是 View Transitions API 繪製機制所導致的經典現象。當我們為沒有設定實體背景顏色的 \#upload-panel\ 獨立設定 \iew-transition-name\ 時，它會在父層 (\.md3-card\) 的快照中挖出一個「透明破洞」。在動畫交叉淡入淡出期間，這層透明破洞會直接透出最底層的 \ody\ 灰色背景，導致使用者看到突兀的顏色閃爍。
- 解決方案：取消區域性的獨立 View Transition 命名，讓瀏覽器對整個畫面 (包含白色的 Card 背景與內部的所有輸入框) 進行單一、完整的全域快照截取。這樣就能保證快照在互相淡出淡入時，絕對不會有透明度錯亂的問題。

**3. 後續影響與注意事項 (Impact & Watchouts):**
- 犧牲了特定面板獨立縮放的微動畫，換取了視覺上絕對平順、無破圖的全螢幕 MD3 Fade Through 主題/分頁切換效果。
