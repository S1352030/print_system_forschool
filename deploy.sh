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

# ── 1. 拉取最新程式碼 ────────────────────────────────
echo "[1/4] git pull ..."
git pull
echo ""

# ── 2. 啟用虛擬環境 + 安裝套件 ───────────────────────
echo "[2/4] 檢查 Python 套件 ..."
source venv/bin/activate
pip install --quiet brotli zstandard
echo "     套件確認完成"
echo ""

# ── 3. 重新產生靜態資源預壓縮檔 (.br / .gz) ──────────
echo "[3/4] 預壓縮靜態資源 ..."
python precompress.py
echo ""

# ── 4. 重啟服務 ──────────────────────────────────────
echo "[4/4] pm2 reload ..."
pm2 reload print-system
echo ""

echo "===================================="
echo "  部署完成！"
echo "===================================="
