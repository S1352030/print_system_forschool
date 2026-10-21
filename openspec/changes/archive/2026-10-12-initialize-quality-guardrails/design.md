## Context

單workerFastAPI／SQLite與原生ESM前端，在免費GCP使用PM2／Cloudflare；既有測試與回復腳本保留。使用者明確授權安全初始化與驗證，禁止重寫業務或正式高風險操作。

## Goals / Non-Goals

建立可攜規格、局部開發規則、重複品質門檻及資料／權限回歸；不新增會員、重寫前端框架、改資料庫產品或執行正式部署。Beads及全域lint／型別重構延後，避免引入不必要工具。

## Decisions

- OpenSpec使用本機精確devDependency及Codex生成技能，沒有重複init；保留既有.skills，僅將OpenSpec生成技能從忽略中例外纳入。
- dependency-cruiser檢查ESM引用／循環／層級；Python AST讀根模組包含函式內imports，不import會建表的main。無隱藏違規baseline。
- pytest與Node既有框架保留；加22個核心案例与固定API／DB契約。文案與operationId不屬相容結構，保留參數／security／schema／表欄位與constraint。
- 完整gate使用唯一qa build、僅壓縮該目錄、不清理正式release；捕捉來源fingerprint、Gitdirty、步驟日誌。省略required檢查為partial且非零退出。
- 瀏覽器existing三套腳本保留；Chromium固定必備，CIWebKit必備，禮物卡流程驗證實際qa建置與隔離FastAPI。正式VM不啟動瀏覽器。
- CIPR／push比較base要求Changelog更新；定期只報告，不自動修正。遠端保護與實際CI仍需推送後驗證。

## Risks / Trade-offs

姓名識別、預設帳密、刪檔／DB失敗、資料還原与代理鏈為另案，證據見KNOWN_ISSUES.md。API完整相容需要語意与整合測試，schema快照非充分證明。AST不解析動態Pythonimports，JS變數動態PDFimports另由build及瀏覽器檢查。QA產物可能累積，文件規定人工安全清理。

## Migration Plan

只改开发依賴／tests／文件／CI。npm ci與requirements-dev可重建；不變動DB或uploads。回復此次配置需審查Gitdiff或已提交後revert，保留使用者資料與歷史。正式deploy既有online backup／程式回復未等同資料回復。

## Open Questions

正式站revision、帳密覆寫、proxy chain、LINE傳達、資料還原演練、實機驗收、遠端branch protection未知。這些不阻塞本機品質系統，但阻塞宣稱正式已知穩定。
