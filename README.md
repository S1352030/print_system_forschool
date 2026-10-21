# 學校PDF列印系統

原生網頁＋FastAPI／SQLite，支援PDF收件與計價、歷史進度、管理收款與禮物卡折抵。實際列印由管理員操作，無會員系統。

- [架構及資料流](ARCHITECTURE.md)
- [開發規則](AGENTS.md)
- [品質檢查與安全回復](docs/QUALITY.md)
- [風險及待辦](docs/KNOWN_ISSUES.md)
- [初始化報告](docs/INITIALIZATION_REPORT.md)
- [目前功能規格](openspec/specs/)
- [現有歷史](AI_CHANGELOG.md)與[交叉核對](docs/CHANGELOG_REVIEW.md)

使用Node22（.nvmrc）與Python3.10+虛擬環境。安装及完整檢查：

```text
npm ci
python -m pip install -r requirements-dev.txt
npx --no-install playwright install chromium webkit
npm run check
```

本機開發先複製.env.example為.env，設定自己的管理帳密、空LINE金鑰與獨立DB／uploads，再啟動`python -m uvicorn main:app --host 127.0.0.1 --port 8000`。main匯入會初始化資料表，啟動會清理符合保留政策的舊訂單，請勿用正式DB做開發。

正式部署說明仍以[deploy.sh](deploy.sh)、[Cloudflare規則](CLOUDFLARE_CACHE_RULES.md)與[效能驗收](PERFORMANCE.md)為準，未取得部署授權不執行。品質檢查只建立隔離QA產物與報告，不操作正式資料。
