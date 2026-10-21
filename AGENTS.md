# print_system 開發規則

最高原則：保護既有功能、架構一致性與可回復性。規格及歷史紀錄需與程式碼、實際測試交叉驗證。

## 新對話與上下文恢復

- 先查看 `git status --short`、目前分支及相關來源。尊重並保留使用者未提交的修改。
- 系統邊界查 `ARCHITECTURE.md`；相關功能查 `openspec/specs/*/spec.md`；檢查方式查 `docs/QUALITY.md`；未完成事項查 `docs/KNOWN_ISSUES.md`。
- 歷史查現有 `AI_CHANGELOG.md`，必要時查 `docs/CHANGELOG_REVIEW.md`。不要將 Changelog 當成現況，或把整份歷史複製到此檔。
- `docs/INITIALIZATION_REPORT.md` 是一次盤點；`.quality-reports/latest.json` 是最近一次本機證據。以目前來源與本次測試為準。

## 修改流程

1. 理解目的、相關模組與限制，搜尋是否已有同類功能。小型修正只讀必要內容。
2. 實作前簡述影響檔案、API／資料格式／資料庫／安全性、退化風險與驗證方式。
3. 中大型功能、跨模組重構、API 或資料庫變更先在 OpenSpec 建立 proposal、design、delta specs、tasks。本次使用者已授權實作時可直接繼續，不因產生規格重複要求批准。
4. 局部實作最小必要修改；不得無故重寫不相關模組、擴張需求、建立重複功能或任意增加依賴。
5. 執行受影響測試及既有回歸；完成前執行 `npm run check`。`check:fast` 僅為部分檢查，不能稱完整通過。
6. 更新相關規格、必要架構文件、測試、現有 Changelog 與 OpenSpec tasks；驗證符合驗收條件後才標記完成／歸檔。
7. 回報改了什麼、影響模組、實際通過／失敗／未執行的檢查與未解決限制。不可把閱讀程式碼當成測試成功。

## 不可任意改變的約束

- 保留公開 API 與資料格式；契約基準在 `tests/fixtures/contracts.json`。需求改變需先更新規格、說明相容策略，再人工審查契約與测试差異。不可自動刷新預期來消除失敗。
- 不得刪除、跳過正確測試或降低預期來讓檢查變綠；不得降低 CSP、關閉授權或限流。測試內模擬與正式行為必須清楚分開。
- 保留 PDF 原檔、伺服器實際頁數計價、原子上傳、禮物卡交易鎖／冪等、獨立帳目及敏感資料不快取。
- 不恢復舊 PDF.js loader／`window.pdfjsLib`、inline handlers／`window.*` 橋接、重複登入彈窗、Google Fonts、舊 `?v=` 部署流程或前後台重複 PDF 渲染器。若需求確實要改，先提出新規格與理由。
- 架構檢查不允許新循環依賴；不得透過豁免清單掩蓋新違規。已知技術債用具體證據記錄，避免全專案重構。
- 測試只用隔離 SQLite／uploads、合成 PDF、空 LINE 金鑰；不可以 import 正式 `main` 做唯讀盤點，因其會建表／遷移，啟動還會清理舊訂單。

## 工具與版本

- Node 22 LTS（`.nvmrc` 22.23.2，至少 22.12）；Python 3.10+，CI 使用 3.13。用 `npm ci`、`python -m pip install -r requirements-dev.txt`。
- OpenSpec 鎖定本機開發依賴：`npx --no-install openspec ...`。已初始化，勿再次 init；使用生成的 Codex skills 或 CLI，詳見 `docs/QUALITY.md`。
- 現有 `update-changelog` 技能若可用，依其三區塊繁體中文格式在歷史最上方新增紀錄，不覆寫歷史。現有 `craft-commit` 用於要求提交訊息時；不因完成修改自動 commit。
- 重大工作用 `codex/` 分支；不覆蓋使用者修改，不執行 `reset --hard`、force push、刪除遠端分支。提交、推送、正式部署與資料庫回復遵守本次明確授權範圍。
- 「開發中」「已測試」「已知穩定」需區分。品質門檻通過仍只是候選；正式健康、真人／實機驗收、資料相容與回復證據確認後才能標 stable。
- 健康檢查只產生報告，不自動修正、部署或回復。新高風險問題先提供位置、證據、影響及修復建議。
