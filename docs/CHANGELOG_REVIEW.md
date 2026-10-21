# 現有Changelog交叉核對

2026/10/12完整閱讀原有AI_CHANGELOG.md，共31條歷史（涵蓋2026/07/05至09/21；日期順序並非完全排序）。保留原文字、順序與當時驗證聲明；新增紀錄放最上方。歷史原檔SHA-256於初始化前保存供比對，新流程不刪除或另建Changelog。

## 功能與架構演進

| 歷史階段 | 主要新增／修正 | 目前交叉證據 |
| --- | --- | --- |
| 07/05–07/06 | 認證、CMap本地化、SW容量；限流、20MB、WAL、非同步解析、備份與清理；自訂對話框 | main／database／dialog及回歸測試保留核心；認證方式其後再次更正 |
| 07/20–07/22 | Material 3tokens、動畫／焦點／破窗修復；設定／schema／trusted proxies／鎖定；lifespan、分頁、Range、log／health；ES Modules拆分與PDF預壓縮 | 原生HTML與token、main Settings／Pydantic／lifespan、api／各功能模組。舊全域橋接不再存在 |
| 07/23–07/24 | A4fit／cover、紙張警告與邊界標註；部署ES module版本錯配、immutable／SW／sidecar修复 | pdf-paper／共用controller與cache測試；快取其後由Vite版本路徑取代手動query |
| 07/27–07/30 | 主題輻射／Fade Through、共用PDF核心、PDF.js5.7.284、可靠頁數、原子上傳、單worker／儲存維護、鎖定Python及online backup | pdf-engine／controller、main validated PDF與transactions、ecosystem、requirements.lock |
| 08/11 | Vite不可變release、CSP hash、ESM dialog／事件委派、壓縮ETag與q值、Cloudflare規則／回復；修venv Python與build ID測試污染 | vite.config、verify-build、deploy、SW與前後端測試 |
| 09/08–09/19 | 快速轉場競態、表單焦點／裝訂保留、48px手機、SW預載／背景快取故障、效能證據；歷史三階段唯讀進度 | motion tests、browser preview、SW fetch與registration tests、history |
| 09/21 | 實收多付自動發卡、持代碼多檔折抵、冪等、並行寫入、取消退款、独立帳目 | gift_cards、database、upload/admin UI；初始化前37後端／43前端本次已重跑 |

## 已移除或被替代：不可無需求恢復

- 07/05前端showLoginPrompt／authFetch／sessionStorage Basic憑證 → 07/06移除二次登入，現有瀏覽器原生Basic Auth；沒有登入／登出API。
- 07/20 22:06嘗試@material/web CDN、Shadow DOM、Material字型 → 22:14明確記錄損壞後改安全token aliases。現行原生HTML、SVG sprite、自訂樣式；不可將嘗試紀錄當已採用框架。
- 07/22 pdfjs-loader、動態classic script、window.pdfjsLib、PDF.js2.x及完整viewer → 07/30共用ESM engine／controller與5.7.284。舊不可靠頁數正則／預設2、前後台重複renderer不再使用。
- 07/21 ES module改造時的window函式橋接／inline handlers／classic dialog → 08/11真正ESM dialog＋data attributes事件委派；已加回歸保護。
- 07/23/24 `?v=`人工版本、v7/v8整包SW、全面purge舊快取指示 → 08/11版本化Vitehash路徑、專用app／pdf namespace、選擇性purge。現行無query不可變產物才immutable，未版本化來源no-cache。
- 07/06啟動時一次清理 → 07/21／07/30lifespan＋六小時維護，保留有效PDF／財務紀錄；不能恢復只啟動清理。
- 09/19獨立付款／列印badge → 三階段唯讀progress；09/21再新增全額折抵／取消狀態，不能忽略其優先呈現。

## 反覆問題與描述差異

| 證據 | 分析與目前處理 |
| --- | --- |
| MD3token／轉場／破窗／焦點多次修正 | 確認反覆迭代；目前用有序motion與DOM保留測試，避免再改成整卡重建或多個轉場擁有同class |
| 07/23–08/11多次快取部署失效 | 確認重複風險；目前版本化assets＋CSP／sidecar／SW／build ID驗證，初始化不再次重寫快取 |
| 07/20 22:06聲稱完整@material/web但22:14記錄造成損壞 | 歷史試驗被替代；現碼交叉驗證不使用該CDN，保留歷史不更改聲明 |
| 07/21聲稱全部env集中Settings | notify.py仍load_dotenv／os.getenv，log_manager也讀LOG_LEVEL；確認為集中化未完全完成，登錄P2 |
| 07/30首頁edge五分鐘；08/11／現碼一小時 | 目前main middleware為3600秒，正式Cloudflare精確規則本輪未驗證；舊值屬當時狀態 |
| 07/30WebKit通過、09月WebKit略過 | 不同環境／工具版本；不能繼承歷史成功。此次重新安裝相符版本後實測並另記結果 |
| 「orders.db未版控」兩處紀錄 | `git ls-files orders.db`實際已追蹤，0 bytes空殼；非有效DB，保留並登錄P3，不擅自刪除 |
| Changelog長期被.gitignore忽略 | 確認無法在新clone取回。移除這項忽略但保留歷史；未自動commit，正式納入歷史仍待提交 |
| 早期日期無方括號／時分、檔名與反斜線控制字、未嚴格倒序 | 歷史格式缺陷。新條目按技能格式撰寫，核對來源，不全面重排／修正文案 |
| 「整套現代化完成」／正式部署／實機驗收聲明 | 只代表當時範圍；未包含後來禮物卡／CI，也不代表當前正式站或災難回復已驗證 |

## 尚未确认

本輪未存取正式站／主機／Cloudflare帳戶，無法確認實際部署revision、.env帳密、proxy chain、LINE傳達、DB備份還原、實體手機／印表機。PERFORMANCE.md保留09月量測的樣本與節點限制，不用本輪初始化推論線上速度。歷史測試數以本次實際結果為準。
