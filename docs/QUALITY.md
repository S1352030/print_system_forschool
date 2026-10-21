# AI 修改、品質檢查與安全回復

目前規則入口為根目錄 AGENTS.md；功能真實規格在 OpenSpec，歷史只沿用 AI_CHANGELOG.md。初始化盤點在 INITIALIZATION_REPORT.md，風險登錄在 KNOWN_ISSUES.md。

## 一次設定

使用 Node 22 LTS（22.23.2）、Python 3.10+（CI 3.13）。啟用自己的 Python 虛擬環境後：

```text
npm ci
python -m pip install -r requirements-dev.txt
npx --no-install playwright install chromium webkit
npm run check
```

若虛擬環境尚未啟用，將 `TEST_PYTHON` 設為其 Python 執行檔的絕對路徑；例如 PowerShell：

```powershell
$env:TEST_PYTHON = (Resolve-Path '.venv\Scripts\python.exe').Path
npm run check
```

不要以系統預設 Node 26 執行本專案正式檢查；品質入口會拒絕不支援的版本。初始化現場使用既有 `.codex-qa/node22/node_modules/node/bin/node.exe` 22.23.2 與 `.codex-qa/venv/Scripts/python.exe` 3.13.2，此私有目錄不屬於可攜依賴，CI／新電腦按上述步驟重建。Windows 沙箱若無法在暫存目錄開 SQLite，需在允許存取的隔離目錄或一般終端重跑，不能當成業務測試已通過。

## 可重複檢查

| 指令 | 範圍與限制 |
| --- | --- |
| `npm run check`／`npm run health` | 語法、JS／Python 邊界、OpenSpec strict、紀錄檢查、全部前後端測試、唯一 QA build／預壓縮／verify-build、三套瀏覽器流程 |
| `npm run check:fast` | 省略瀏覽器，報告 partial、退出碼 1，不能當發佈門檻 |
| `npm run test:frontend` | 既有 Node tests；紙張計算、動畫、SW、CSP／事件綁定等 |
| `npm run test:backend` | 所有 pytest，用既有測試建立隔離 DB／uploads，禁止真實 LINE |
| `npm run test:browser:all` | 固定 Playwright Chromium必須存在；WebKit 缺少明確標記。`REQUIRE_WEBKIT=1` 時缺少即失敗 |
| `npm run check:architecture` | JS dependency-cruiser＋Python AST；不自動修復 |
| `npm run check:specs`／`check:governance` | 規格語法、關鍵上下文檔案、Changelog 未被忽略與變更紀錄；語意仍人工確認 |

輸出 `.quality-reports/latest.md`／`latest.json`、帶 QA ID 的 JSON／逐步日誌，以及 `static/builds/qa-*/` 唯一產物。JSON 記錄 git revision、分支、dirty 狀態、工具、每項 passed／failed／blocked／not-run、退出碼與限制。健康檢查只讀來源並生成 QA 產物、合成資料與報告，不改寫業務、不清理舊 release、不部署、不 purge。QA 產物長期保留可能佔空間，僅可人工刪除明確不再需要的 `qa-*` 目錄，先確認絕對位置在 static/builds 且非 symlink。

Chromium gate保護 SW 安装／單次更新重載、离線／配額故障、Pixel 7 PDF預覽與多檔上傳，以及真實 FastAPI收款／折抵／取消／回應遺失重試。最後一套可透過 QA_BROWSER_BUILD_ID 驗證建置版。WebKit 是 Safari 模擬器，不能替代實體 iPhone 或印表機驗收。沒有帳號登入／登出功能時不可憑空補測不存在的流程。

## 規格驅動修改

本機 devDependencies 精確鎖定 OpenSpec 1.14.1，已使用 `init --tools codex --language zh-TW --profile core` 初始化；不需全域安装，勿重複 init。官方依賴 Node >=20.19，本專案指定的 Node 22符合。Codex 整合生成六個 `.agents/skills/openspec-*`；保留原有 update-changelog／craft-commit／material-3 技能。

簡單修字／局部 bug修正可直接依 AGENTS 流程。跨模組、中大型功能、API或資料結構修改：

```text
npx --no-install openspec new change <kebab-case-name>
npx --no-install openspec status --change <name>
npx --no-install openspec instructions proposal --change <name>
npx --no-install openspec validate <name> --strict --no-interactive
```

填 proposal.md（目的與影響）、design.md（邊界、相容、安全及回復）、specs/<capability>/spec.md（ADDED／MODIFIED／REMOVED requirements、SHALL／MUST、WHEN／THEN scenarios）、tasks.md（可驗證步驟）。開始實作前要有驗收與測試映射，必要的決策詢問不能阻塞已授權的獨立工作。

可使用生成的 openspec-propose／apply-change skills。使用者已授權完整實作時，本專案規則及使用者授權優先於生成技能「提案後另開新請求」的預設流程。不得把「規格草稿完成」宣稱功能完成。測試通過後同步主規格、完成 tasks，再用官方 archive 命令歸檔；人工確認 delta已同步，避免反覆追加同項 requirement。本次初始化規格已是主基準，完成的變更在 `openspec/changes/archive/2026-10-12-initialize-quality-guardrails/` 保存，品質門檻也檢查歸檔tasks全部完成。

## 契約與文件一致性

`quality/test-baseline.json`固定最低48個Node案例與59個pytest案例（初始化前為43／37）。品質入口解析真實測試摘要；缺摘要、案例數不足、skip／cancel／xfail／deselect皆不能通過，5項工具回歸保護這項判定。案例數只是最低防護，不能證明新測試取代舊測試具有同等覆蓋；測試移除仍需規格與人工審查。

`tests/fixtures/contracts.json` 保存當前 OpenAPI與資料表欄位／索引／約束。測試讀實際應用模型比較，新增／移除／修改 API、授權 schema或資料結構時會失敗。只描述機器契約，不能替代實際退款／金額／並行整合測試。

契約不提供自动 update snapshot指令。若需求確實改變：先更新對應 spec，提出 migration與消費者相容策略，審查舊／新契約diff後才改 fixture及相關測試預期。檢查Changelog相關舊紀錄不代表重新啟用舊功能。

每次完成改碼在既有Changelog新增三區塊繁體紀錄。CI比較PR base…HEAD或push前一版本；若有來源／配置變更未改Changelog即失敗。不要替歷史排序、改寫不清晰內容或建立第二份Changelog。歷史矛盾記錄於CHANGELOG_REVIEW.md。

## CI與定期健康檢查

`.github/workflows/quality.yml` 在PR、push、手動執行及每週一台北09:00運行；鎖定Node、Python與套件，安装Chromium／WebKit，執行完整gate，失敗仍上傳報告。CI只檢查，不自動提交、修復或部署。push／PR出現紅燈需定位故障，不允許以關閉job或刪測試處理。

本次只建立workflow檔案，未推送也未實際執行遠端CI。GitHub branch protection需儲存庫管理員在遠端啟用並指定品質job為必須通過，檔案本身不能強制防止合併；見風險登錄。每週人工檢視高風險事項與孤立模組警告、相似程式／死碼、文件與UI行為，發現問題提出證據及修復任务。

正式 deploy.sh 保留原有備份／回復，增加specs、syntax、architecture並將pytest範圍由PDF單檔改為全部tests。GCP免費VM不安裝瀏覽器，瀏覽器完整gate應在CI／開發機先通過，部署僅進行主機適合的檢查。

## 版本狀態與安全回復

| 狀態 | 必要證據 |
| --- | --- |
| 開發中 | 工作分支／dirty工作目錄，尚有required failed或not-run |
| 已測試候選 | 完整gate通過、報告識別確切commit或dirty差異，規格驗收成立 |
| 已知穩定 | 乾淨已提交候選、CI成功、正式／實機必要驗收、健康版本與資料相容確認、可回復證據；再經授權建立stable tag |

初始化前HEAD雖有歷史測試紀錄，但不因此標為stable；本次驗證含新工具的未提交候選，也不能對原HEAD打stable標籤。只有獲得commit授權後提交、重跑確切版本，才可建立持久基準。保留每個報告及Changelog。

**本機恢復不丟工作：** 先查看status、diff並保存未提交／未追蹤檔案，再以隔離worktree查看已知候選，禁止hard reset：

```text
git status --short
git diff
git worktree add --detach ../print-system-recovery <verified-commit-or-tag>
```

在隔離目錄重新安裝鎖定依賴、重跑gate。確認後，對已提交的錯誤變更優先用`git revert <commit>`保留歷史；避免把未提交內容混入回復。上述是手動選擇，品質腳本不執行Git mutation。

**正式回復：** 需明確部署授權；既有deploy.sh在切版失敗時以`git reset --keep`恢復前一Git revision、Python依賴與前端release，健康檢查核對版本。這是部署腳本既有的受控流程，不能照抄為日常清除使用者工作目錄的命令。SQLite online backup有integrity check；目前自動回復不回復schema／資料，也不證明備份可災難復原。

禁止用舊備份直接覆寫持續交易中的DB：會遺失新訂單／禮物卡帳目。資料回復需另提方案、停寫、先備份當下DB及uploads、隔離還原＋integrity／餘額對帳、取得授權、再核對檔案與資料。沒有downgrade設計時禁止宣稱可任意回復到舊功能版本。

## 工具官方依據（2026/10/12查核）

- [OpenSpec安裝與Node前提](https://openspec.dev/docs/installation)、[官方Codex支援](https://github.com/Fission-AI/OpenSpec/blob/main/docs/supported-tools.md)。本專案採本機鎖定依賴，避免變動全域工具。
- [Codex AGENTS.md載入規則](https://developers.openai.com/codex/guides/agents-md)：根目錄指令隨專案保存，細節以按需文件連結管理。
- [dependency-cruiser規則](https://github.com/sverweij/dependency-cruiser/blob/main/doc/rules-reference.md)。此輪未建立忽略baseline；既有違規不應擴大豁免。
