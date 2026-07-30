# Cloudflare 快取規則

依序建立下列 Cache Rules，順序不可互換：

1. `URI Path starts with /api/` 或 `URI Path starts with /admin`：Bypass cache。
2. `URI Path matches ^/api/orders/.+/(file|preview)(/.*)?$`：Bypass cache。
3. `URI Path starts with /static/pdfjs/5.7.284/`：Eligible for cache，Edge TTL 與 Browser TTL 均為一年。
4. `URI Path equals /` 且 method 為 GET/HEAD：Eligible for cache，Edge TTL 五分鐘；Browser TTL 依 origin 的 `public, no-cache`。

套用後以回應標頭確認：

- 第二次取得 `/static/pdfjs/5.7.284/build/pdf.min.mjs` 應為 `CF-Cache-Status: HIT`。
- `/api/*`、`/admin*` 與訂單 PDF 應維持 `DYNAMIC` 或 `BYPASS`。
- 首頁可由 edge 命中，但瀏覽器仍會重新驗證。
