#!/bin/bash
set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-$HOME/print_system_forschool}"
BACKUP_DIR="$PROJECT_DIR/backups"
cd "$PROJECT_DIR"
mkdir -p "$BACKUP_DIR"

echo "[1/7] 建立 SQLite online backup 並檢查完整性"
if [ -f db.sqlite3 ]; then
  BACKUP_PATH="$BACKUP_DIR/db_$(date +%Y%m%d_%H%M%S).sqlite3"
  sqlite3 db.sqlite3 ".backup '$BACKUP_PATH'"
  INTEGRITY="$(sqlite3 "$BACKUP_PATH" "PRAGMA integrity_check;")"
  if [ "$INTEGRITY" != "ok" ]; then
    echo "備份完整性檢查失敗：$INTEGRITY" >&2
    exit 1
  fi
  find "$BACKUP_DIR" -maxdepth 1 -type f -name 'db_*.sqlite3' -mtime +14 -delete
fi

echo "[2/7] 以 fast-forward 模式更新程式"
git pull --ff-only origin main
export APP_BUILD_ID
APP_BUILD_ID="$(git rev-parse --short=12 HEAD)"

echo "[3/7] 安裝鎖定的 Python 依賴"
source venv/bin/activate
if [ -f requirements.lock ]; then
  python -m pip install --quiet -r requirements.lock
else
  python -m pip install --quiet -r requirements.txt
fi

echo "[4/7] 執行資料庫與匯入檢查"
python -c "from main import app; print('匯入檢查通過')"
sqlite3 db.sqlite3 "PRAGMA integrity_check;" | grep -qx "ok"

echo "[5/7] 增量預壓縮靜態資源"
python precompress.py

echo "[6/7] 以單一程序重新載入服務"
pm2 reload ecosystem.config.cjs --only print-system --update-env

echo "[7/7] 輪詢新版本健康狀態"
for attempt in $(seq 1 20); do
  HEALTH_JSON="$(curl --silent --show-error --fail http://127.0.0.1:8000/health 2>/dev/null || true)"
  HEALTH_BUILD="$(printf '%s' "$HEALTH_JSON" | python -c "import json,sys; print(json.load(sys.stdin).get('build_id',''))" 2>/dev/null || true)"
  if [ "$HEALTH_BUILD" = "$APP_BUILD_ID" ]; then
    echo "部署完成：$APP_BUILD_ID"
    exit 0
  fi
  sleep 1
done

echo "健康檢查未在期限內回報新版 build_id=$APP_BUILD_ID" >&2
exit 1
