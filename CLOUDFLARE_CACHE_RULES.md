# Cloudflare 快取規則

正式站 hostname 為 `ampaprint.systems`。Cache Rules 會依序疊加，若多條規則修改同一設定，**最後一條命中規則優先**；因此敏感路徑 bypass 必須固定放在最後。

所有 Eligible 規則共用下列設定：

- Cache eligibility：`Eligible for cache`
- Edge TTL：`Use cache-control header if present, bypass cache if not`
- Browser TTL：`Respect origin`
- Cache key：保留完整 query string，不可啟用 Ignore Query String
- Cache Deception Armor：啟用
- 不設定 Status Code TTL；由 origin 的 `Cloudflare-CDN-Cache-Control` 控制，錯誤回應一律 `no-store`

## 規則 1：不可變前端建置

```text
http.host eq "ampaprint.systems"
and http.request.method in {"GET" "HEAD"}
and starts_with(http.request.uri.path, "/static/builds/")
and http.request.uri.query eq ""
```

套用共用 Eligible 設定。建置路徑含已驗證的 `APP_BUILD_ID`，origin 對成功回應提供一年 immutable。

## 規則 2：版本化 PDF.js

```text
http.host eq "ampaprint.systems"
and http.request.method in {"GET" "HEAD"}
and starts_with(http.request.uri.path, "/static/pdfjs/5.7.284/")
and http.request.uri.query eq ""
```

套用共用 Eligible 設定。升級 PDF.js 時應建立新版本目錄，不可覆寫既有版本內容。

## 規則 3：首頁 HTML

```text
http.host eq "ampaprint.systems"
and http.request.method in {"GET" "HEAD"}
and http.request.uri.path eq "/"
and http.request.uri.query eq ""
and not any(http.request.headers["authorization"][*] ne "")
```

套用共用 Eligible 設定。Origin 契約為：

```text
Cache-Control: public, no-cache
Cloudflare-CDN-Cache-Control: public, max-age=3600, stale-while-revalidate=60, stale-if-error=86400
Cache-Tag: print-app
```

## 規則 4：公開公告 API

```text
http.host eq "ampaprint.systems"
and http.request.method in {"GET" "HEAD"}
and http.request.uri.path eq "/api/announcements"
and http.request.uri.query eq ""
and not any(http.request.headers["authorization"][*] ne "")
```

套用共用 Eligible 設定。Origin 對瀏覽器與 Cloudflare 均設定 300 秒，並回傳 `Cache-Tag: print-announcements`。

## 規則 5：敏感與非唯讀請求 bypass（必須最後）

```text
http.host eq "ampaprint.systems"
and (
  not (http.request.method in {"GET" "HEAD"})
  or starts_with(http.request.uri.path, "/admin")
  or http.request.uri.path eq "/health"
  or http.request.uri.path eq "/sw.js"
  or (
    starts_with(http.request.uri.path, "/api/")
    and http.request.uri.path ne "/api/announcements"
  )
  or (
    http.request.uri.path eq "/api/announcements"
    and http.request.uri.query ne ""
  )
  or (
    (
      starts_with(http.request.uri.path, "/static/builds/")
      or starts_with(http.request.uri.path, "/static/pdfjs/5.7.284/")
    )
    and http.request.uri.query ne ""
  )
  or any(http.request.headers["authorization"][*] ne "")
)
```

設定 `Cache eligibility: Bypass cache`，不要設定任何 TTL。這條規則保護後台、健康檢查、Service Worker、上傳、訂單歷史、PDF 下載/預覽及所有帶認證請求。

## 部署與 purge

- 使用主機秘密環境變數 `CF_ZONE_ID`、`CF_API_TOKEN`；Token 只授予該 Zone 的 Cache Purge 權限，不寫入 repo 或 PM2 app 環境。
- 前端建置使用新 `APP_BUILD_ID` 路徑，因此建置資源不需 purge；舊版本由一年 TTL 自然淘汰。
- 首頁更新後只 purge cache tag `print-app`；公告資料需要立即生效時 purge `print-announcements`。
- 首次啟用 Cache-Tag 時，既有物件尚未帶 tag；部署腳本會自動以 URL 模式 purge `https://ampaprint.systems/` 與 `/sw.js`，成功後寫入本機 marker，後續才改用 `print-app` tag。需要重做 bootstrap 時可移除 `static/builds/.cache-tag-purge-ready`，或明確設定 `CF_PURGE_MODE=urls`。
- 若首次 URL purge 經重試仍失敗，marker 不會建立；應保留 `CF_PURGE_MODE=urls` 與 `PUBLIC_ORIGIN=https://ampaprint.systems` 重跑 `npm run purge:cloudflare`，不可直接使用預設 tag 模式。後續 tag purge 失敗才以 `CF_PURGE_MODE=tag` 重試。
- 不使用 Purge Everything，避免清掉已命中的 PDF.js 大型資源並瞬間增加 GCP origin 負載。
- 即使健康檢查觸發 rollback，也保留已完整落盤的候選 immutable build，避免 purge 缺少憑證或暫時失敗時，舊 edge HTML 引用的雜湊資產在 origin 變成 404；後續只由「至少 3 版且 7 天內不刪」的 retention 規則清理。
- `/health` 的 `build_id` 取自 `BACKEND_BUILD_ID`，`frontend_build_id` 取自 `APP_BUILD_ID`；正常部署兩者相同。`git pull` 後、切換 PM2 前的任一步驟失敗會先以 `git reset --keep` 回復原 checkout，若候選版已碰觸共用 venv 也會重裝前一版鎖定 requirements。切換後健康失敗時，腳本只在部署前健康 build 與原 Git revision 可互相驗證時回復 Git、Python dependencies 與前端 release，再重啟 PM2、核對舊版健康資訊並精確 purge 首頁；若工作樹、依賴或舊產物無法安全驗證，會拒絕強制啟動並要求人工介入。

## 驗收

- `/`：第一次 `MISS` 或 `EXPIRED`，第二次 `HIT` 且出現 `Age`。
- `/static/builds/<APP_BUILD_ID>/...` 與 `/static/pdfjs/5.7.284/...`：第二次為 `HIT`，Browser Cache-Control 含一年 `immutable`。
- `/api/announcements`：第一次 `MISS`，第二次 `HIT`，最多快取 300 秒。
- `/admin*`、`/health`、其餘 `/api/*`、訂單 PDF、`/sw.js`：維持 `DYNAMIC` 或 `BYPASS`，不可出現 `Age`。
- 任一 `4xx/5xx`：origin 的 `Cache-Control` 與 `Cloudflare-CDN-Cache-Control` 都必須是 `no-store`。
