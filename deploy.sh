#!/bin/bash
# ═══════════════════════════════════════════════════════
#  一鍵部署腳本 — print_system_forschool
#  用法：在伺服器上執行 bash deploy.sh 或 ./deploy.sh
# ═══════════════════════════════════════════════════════

set -e  # 任何指令出錯就立刻停止

# ── 專案路徑 ──────────────────────────────────────────
PROJECT_DIR="$HOME/print_system_forschool"
cd "$PROJECT_DIR"

echo "===================================="
echo "  print_system 自動部署"
echo "===================================="
echo ""

# ── 0. 部署前備份 SQLite 資料庫 ───────────────────────
BACKUP_DIR="$PROJECT_DIR/backups"
mkdir -p "$BACKUP_DIR"
if [ -f "db.sqlite3" ]; then
  BACKUP_NAME="db_$(date +%Y%m%d_%H%M%S).sqlite3"
  cp db.sqlite3 "$BACKUP_DIR/$BACKUP_NAME"
  echo "[0/5] 資料庫備份完成 → backups/$BACKUP_NAME"
  # 只保留最近 5 份備份，刪除舊的
  ls -t "$BACKUP_DIR"/db_*.sqlite3 2>/dev/null | tail -n +6 | xargs -r rm --
  echo ""
fi

# ── 1. 拉取最新程式碼 ────────────────────────────────
echo "[1/5] git pull origin main ..."
git pull origin main
echo ""

# ── 2. 啟用虛擬環境 + 安裝套件 ───────────────────────
echo "[2/5] 安裝 Python 套件 ..."
source venv/bin/activate
pip install --quiet -r requirements.txt
echo "     套件確認完成"
echo ""

# ── 3. 重新產生靜態資源預壓縮檔 (.br / .gz) ──────────
echo "[3/5] 預壓縮靜態資源 ..."
# 先清除舊的預壓縮檔,避免檔案重命名/刪除後舊的 .br/.gz 殘留被誤派發。
# -type f 確保只刪檔案;括號分組 -o (OR) 避免邏輯錯誤。
find ./static -type f \( -name '*.br' -o -name '*.gz' \) -delete
python precompress.py
echo ""

# ── 4. 健康檢查 (驗證 Python 匯入 + /health 端點) ───────
echo "[4/5] 執行健康檢查 ..."
python -c "from main import app; print('     ✅ 匯入檢查通過')"
# 部署後可用 curl 驗證服務狀態(若伺服器有 curl)
if command -v curl >/dev/null 2>&1; then
  HEALTH=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8000/health 2>/dev/null || echo "000")
  if [ "$HEALTH" = "200" ]; then
    echo "     ✅ /health 回應 200"
  else
    echo "     ⚠️  /health 回應 $HEALTH(服務可能尚未啟動或不在 8000 埠)"
  fi
fi
echo ""

# ── 5. 重啟服務 ──────────────────────────────────────
echo "[5/5] pm2 reload ..."
pm2 reload print-system
echo ""

echo "===================================="
echo "  ✅ 部署完成！"
echo "===================================="
