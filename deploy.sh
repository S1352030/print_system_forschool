#!/bin/bash
set -euo pipefail
umask 027

PROJECT_DIR="${PROJECT_DIR:-$HOME/print_system_forschool}"
BACKUP_DIR="$PROJECT_DIR/backups"
BUILD_ROOT="$PROJECT_DIR/static/builds"
LOCK_FILE="${DEPLOY_LOCK_FILE:-$PROJECT_DIR/.deploy.lock}"

cd "$PROJECT_DIR"
mkdir -p "$BACKUP_DIR" "$BUILD_ROOT"

VENV_PYTHON="$PROJECT_DIR/venv/bin/python"
if [ ! -x "$VENV_PYTHON" ]; then
  echo "缺少部署必要的虛擬環境 Python：$VENV_PYTHON" >&2
  exit 1
fi
export PATH="$PROJECT_DIR/venv/bin:$PATH"

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "已有另一個部署正在執行：$LOCK_FILE" >&2
  exit 1
fi

for command_name in git node npm python sqlite3 curl pm2 flock readlink mktemp; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "缺少部署必要命令：$command_name" >&2
    exit 1
  fi
done

node -e '
const [major, minor] = process.versions.node.split(".").map(Number);
if (major !== 22 || minor < 12) {
  console.error(`部署需要 Node 22 LTS >= 22.12，目前為 ${process.versions.node}`);
  process.exit(1);
}
'

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "工作目錄有尚未提交的 tracked 變更，拒絕部署。" >&2
  exit 1
fi

STAGING_BUILD_DIR=""
FINAL_BUILD_DIR=""
PREVIOUS_APP_BUILD_ID=""
PREVIOUS_HEALTH_BUILD_ID=""
PREVIOUS_FRONTEND_LEGACY=false
PREVIOUS_GIT_REVISION="$(git rev-parse HEAD)"
PREVIOUS_GIT_BUILD_ID="$(git rev-parse --short=12 HEAD)"
CANDIDATE_BACKEND_BUILD_ID=""
PULL_ATTEMPTED=false
PYTHON_DEPENDENCIES_UPDATED=false
SWITCH_ATTEMPTED=false
HEALTH_CONFIRMED=false

safe_remove_build_dir() {
  local candidate="$1"
  local candidate_name
  local build_root_real
  local candidate_real

  [ -n "$candidate" ] || return 0
  [ -e "$candidate" ] || return 0
  [ ! -L "$candidate" ] || {
    echo "拒絕遞迴刪除 build symlink：$candidate" >&2
    return 1
  }

  build_root_real="$(readlink -f "$BUILD_ROOT")"
  candidate_real="$(readlink -f "$candidate")"
  candidate_name="$(basename "$candidate_real")"

  case "$candidate_real" in
    "$build_root_real"/*) ;;
    *)
      echo "Build 清理目標逃逸 static/builds：$candidate_real" >&2
      return 1
      ;;
  esac

  if [[ ! "$candidate_name" =~ ^[A-Za-z0-9._-]+$ ]]; then
    echo "Build 清理目標名稱不安全：$candidate_name" >&2
    return 1
  fi

  rm -rf -- "$candidate_real"
}

restore_previous_python_dependencies() {
  local requirements_file
  local venv_python="$PROJECT_DIR/venv/bin/python"

  if [ "$PYTHON_DEPENDENCIES_UPDATED" != true ]; then
    return 0
  fi
  if [ ! -x "$venv_python" ]; then
    echo "找不到 rollback 所需的 Python：$venv_python" >&2
    return 1
  fi
  if [ -f requirements-dev.txt ]; then
    requirements_file="requirements-dev.txt"
  elif [ -f requirements.lock ]; then
    requirements_file="requirements.lock"
  elif [ -f requirements.txt ]; then
    requirements_file="requirements.txt"
  else
    echo "前一 Git revision 沒有可用的 Python requirements。" >&2
    return 1
  fi

  echo "恢復前一版鎖定的 Python dependencies：$requirements_file" >&2
  if ! nice -n 10 "$venv_python" -m pip install --quiet -r "$requirements_file"; then
    return 1
  fi
  if ! "$venv_python" -m pip check >/dev/null; then
    return 1
  fi
  PYTHON_DEPENDENCIES_UPDATED=false
}

restore_previous_release() {
  local rollback_deadline
  local rollback_fields
  local rollback_health
  local rollback_backend
  local rollback_frontend
  local rollback_purge_helper=""
  local rollback_zone
  local rollback_token
  local rollback_origin
  local legacy_frontend=false
  local rollback_healthy=false

  if [ "$HEALTH_CONFIRMED" = true ] || [ "$PULL_ATTEMPTED" != true ]; then
    return 0
  fi
  if [ "$SWITCH_ATTEMPTED" != true ]; then
    if [[ ! "$PREVIOUS_GIT_REVISION" =~ ^[0-9a-f]{40}$ ]]; then
      echo "候選版尚未切換，但前一 Git revision 無法驗證，需人工恢復 checkout。" >&2
      return 0
    fi
    echo "候選版在切換 PM2 前失敗，恢復 checkout 至 $PREVIOUS_GIT_BUILD_ID。" >&2
    if ! git reset --keep "$PREVIOUS_GIT_REVISION"; then
      echo "Git 工作樹無法安全回復，拒絕強制覆寫。" >&2
      return 0
    fi
    if ! restore_previous_python_dependencies; then
      echo "Git 已回復，但 Python dependencies 未能完整還原，需人工介入。" >&2
    fi
    PULL_ATTEMPTED=false
    return 0
  fi
  if [[ ! "$PREVIOUS_GIT_REVISION" =~ ^[0-9a-f]{40}$ ]] \
    || [[ ! "$PREVIOUS_GIT_BUILD_ID" =~ ^[0-9a-f]{12}$ ]] \
    || [ "$PREVIOUS_HEALTH_BUILD_ID" != "$PREVIOUS_GIT_BUILD_ID" ]; then
    echo "健康檢查未通過，且部署前的健康 backend/Git revision 無法互相驗證。" >&2
    return 0
  fi

  if [ "$PREVIOUS_FRONTEND_LEGACY" = true ]; then
    # 相容尚未提供 frontend_build_id 的舊版；舊程式仍直接提供 source HTML。
    PREVIOUS_APP_BUILD_ID="$PREVIOUS_GIT_BUILD_ID"
    legacy_frontend=true
  elif [[ ! "$PREVIOUS_APP_BUILD_ID" =~ ^[0-9a-f]{12}$ ]] \
    || [ ! -d "$BUILD_ROOT/$PREVIOUS_APP_BUILD_ID" ]; then
    echo "健康檢查未通過，且前一版 frontend release 不完整。" >&2
    return 0
  fi

  if [ -f scripts/purge-cloudflare.mjs ]; then
    if rollback_purge_helper="$(mktemp "${TMPDIR:-/tmp}/print-system-purge.XXXXXX.mjs")"; then
      if ! cp scripts/purge-cloudflare.mjs "$rollback_purge_helper"; then
        rm -f -- "$rollback_purge_helper"
        rollback_purge_helper=""
      fi
    fi
  fi

  echo "健康檢查未通過，回復 Git $PREVIOUS_GIT_BUILD_ID 與 frontend $PREVIOUS_APP_BUILD_ID。" >&2
  if ! git reset --keep "$PREVIOUS_GIT_REVISION"; then
    echo "Git 工作樹無法安全回到前一版，拒絕強制覆寫，需人工介入。" >&2
    if [ -n "$rollback_purge_helper" ]; then
      rm -f -- "$rollback_purge_helper"
    fi
    return 0
  fi
  if pm2 describe print-system >/dev/null 2>&1; then
    pm2 stop print-system >/dev/null
  fi
  if ! restore_previous_python_dependencies; then
    echo "Git 已回復，但前一版 Python dependencies 安裝失敗，暫不重啟 PM2。" >&2
    if [ -n "$rollback_purge_helper" ]; then
      rm -f -- "$rollback_purge_helper"
    fi
    return 0
  fi
  export APP_BUILD_ID="$PREVIOUS_APP_BUILD_ID"
  export BUILD_ID="$PREVIOUS_APP_BUILD_ID"
  export BACKEND_BUILD_ID="$PREVIOUS_GIT_BUILD_ID"
  if pm2 describe print-system >/dev/null 2>&1; then
    pm2 restart ecosystem.config.cjs --only print-system --update-env >/dev/null
  else
    pm2 start ecosystem.config.cjs --only print-system --update-env >/dev/null
  fi

  rollback_deadline=$((SECONDS + 60))
  while (( SECONDS < rollback_deadline )); do
    rollback_health="$(
      curl \
        --silent \
        --fail \
        --connect-timeout 1 \
        --max-time 2 \
        http://127.0.0.1:8000/health 2>/dev/null || true
    )"
    rollback_fields="$(
      printf '%s' "$rollback_health" | python -c '
import json
import sys

try:
    payload = json.load(sys.stdin)
except Exception:
    payload = {}
print("{}|{}".format(
    payload.get("build_id", ""),
    payload.get("frontend_build_id", ""),
))
' 2>/dev/null || true
    )"
    rollback_backend="${rollback_fields%%|*}"
    rollback_frontend="${rollback_fields#*|}"
    if [ "$rollback_backend" = "$PREVIOUS_GIT_BUILD_ID" ] \
      && { [ "$rollback_frontend" = "$PREVIOUS_APP_BUILD_ID" ] \
        || { [ "$legacy_frontend" = true ] && [ -z "$rollback_frontend" ]; }; }; then
      rollback_healthy=true
      pm2 save --force >/dev/null
      break
    fi
    sleep 1
  done

  if [ "$rollback_healthy" = true ]; then
    echo "前一版 backend/frontend 已恢復並通過健康檢查。" >&2
    rollback_zone="${CF_ZONE_ID:-${CLOUDFLARE_ZONE_ID:-}}"
    rollback_token="${CF_API_TOKEN:-${CLOUDFLARE_API_TOKEN:-}}"
    rollback_origin="${PUBLIC_ORIGIN:-https://ampaprint.systems}"
    if [ -n "$rollback_purge_helper" ] \
      && [ -n "$rollback_zone" ] \
      && [ -n "$rollback_token" ]; then
      if ! CF_ZONE_ID="$rollback_zone" CF_API_TOKEN="$rollback_token" \
        CF_PURGE_MODE=urls PUBLIC_ORIGIN="$rollback_origin" \
        node "$rollback_purge_helper"; then
        echo "回滾已健康，但首頁 Cloudflare URL purge 仍待重試。" >&2
      fi
    fi
  else
    echo "前一版 release 回切後仍未通過健康檢查，需人工介入。" >&2
  fi
  if [ -n "$rollback_purge_helper" ]; then
    rm -f -- "$rollback_purge_helper"
  fi
  SWITCH_ATTEMPTED=false
}

cleanup_on_exit() {
  local status=$?
  set +e
  restore_previous_release
  if [ -n "$STAGING_BUILD_DIR" ] && [ -d "$STAGING_BUILD_DIR" ]; then
    safe_remove_build_dir "$STAGING_BUILD_DIR"
  fi
  return "$status"
}
trap cleanup_on_exit EXIT

PREVIOUS_HEALTH_JSON="$(
  curl \
    --silent \
    --fail \
    --connect-timeout 1 \
    --max-time 2 \
    http://127.0.0.1:8000/health 2>/dev/null || true
)"
PREVIOUS_HEALTH_FIELDS="$(
  printf '%s' "$PREVIOUS_HEALTH_JSON" | python -c '
import json
import sys

try:
    payload = json.load(sys.stdin)
except Exception:
    payload = {}
print("{}|{}".format(
    payload.get("build_id", "") or "",
    payload.get("frontend_build_id", "") or "",
))
' 2>/dev/null || true
)"
PREVIOUS_HEALTH_BUILD_ID="${PREVIOUS_HEALTH_FIELDS%%|*}"
PREVIOUS_APP_BUILD_ID="${PREVIOUS_HEALTH_FIELDS#*|}"
if [ -z "$PREVIOUS_APP_BUILD_ID" ]; then
  PREVIOUS_FRONTEND_LEGACY=true
fi

echo "[1/10] 建立 SQLite online backup 並檢查完整性"
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

echo "[2/10] 以 fast-forward 模式更新程式"
PULL_ATTEMPTED=true
git pull --ff-only origin main
export APP_BUILD_ID
APP_BUILD_ID="$(git rev-parse --short=12 HEAD)"
export BUILD_ID="$APP_BUILD_ID"
export BACKEND_BUILD_ID="$APP_BUILD_ID"
CANDIDATE_BACKEND_BUILD_ID="$APP_BUILD_ID"

if [[ ! "$APP_BUILD_ID" =~ ^[0-9a-f]{12}$ ]]; then
  echo "Git build ID 格式不安全：$APP_BUILD_ID" >&2
  exit 1
fi

STAGING_BUILD_DIR="$BUILD_ROOT/_staging-${APP_BUILD_ID}-$$"
FINAL_BUILD_DIR="$BUILD_ROOT/$APP_BUILD_ID"
export BUILD_OUTPUT_DIR="$STAGING_BUILD_DIR"
export NODE_OPTIONS="--max-old-space-size=256"

echo "[3/10] 安裝鎖定的 Node 依賴並建立隔離前端產物"
nice -n 10 npm ci --no-audit --no-fund --prefer-offline
nice -n 10 npm run build

echo "[4/10] 執行前端測試"
npm run test:frontend

echo "[5/10] 安裝鎖定的 Python 依賴並執行既有檢查"
source venv/bin/activate
PYTHON_DEPENDENCIES_UPDATED=true
if [ -f requirements-dev.txt ]; then
  python -m pip install --quiet -r requirements-dev.txt
elif [ -f requirements.lock ]; then
  python -m pip install --quiet -r requirements.lock
else
  python -m pip install --quiet -r requirements.txt
fi
if [ -f requirements-dev.txt ]; then
  python -m pytest -q tests/test_pdf_pipeline.py
fi
python -c "from main import app; print('匯入檢查通過')"
sqlite3 db.sqlite3 "PRAGMA integrity_check;" | grep -qx "ok"

echo "[6/10] 增量預壓縮並驗證候選前端產物"
nice -n 10 python precompress.py
npm run verify-build

if [ -d "$FINAL_BUILD_DIR" ]; then
  if ! diff -qr -- "$STAGING_BUILD_DIR" "$FINAL_BUILD_DIR" >/dev/null; then
    echo "相同 build ID 已存在但內容不同，拒絕覆寫 immutable release：$APP_BUILD_ID" >&2
    exit 1
  fi
  safe_remove_build_dir "$STAGING_BUILD_DIR"
  STAGING_BUILD_DIR=""
else
  mv -- "$STAGING_BUILD_DIR" "$FINAL_BUILD_DIR"
  STAGING_BUILD_DIR=""
fi

export BUILD_OUTPUT_DIR="$FINAL_BUILD_DIR"
npm run verify-build

echo "[7/10] 啟用已完整落盤的 immutable frontend release 並重新載入 Uvicorn"
SWITCH_ATTEMPTED=true

EXPECTED_EXEC="$(readlink -f "$PROJECT_DIR/venv/bin/python")"
CURRENT_EXEC="$(
  pm2 jlist | python -c '
import json
import sys

processes = json.load(sys.stdin)
print(next((
    item.get("pm2_env", {}).get("pm_exec_path", "")
    for item in processes
    if item.get("name") == "print-system"
), ""))
'
)"

if [ -n "$CURRENT_EXEC" ] && [ "$CURRENT_EXEC" != "$EXPECTED_EXEC" ]; then
  echo "偵測到舊版 PM2 啟動方式，執行一次性安全遷移"
  pm2 delete print-system
fi

if pm2 describe print-system >/dev/null 2>&1; then
  pm2 reload ecosystem.config.cjs --only print-system --update-env
else
  pm2 start ecosystem.config.cjs --only print-system --update-env
fi

echo "[8/10] 最多輪詢 75 秒，同時核對 backend/frontend build ID"
HEALTH_DEADLINE=$((SECONDS + 75))
while (( SECONDS < HEALTH_DEADLINE )); do
  HEALTH_JSON="$(
    curl \
      --silent \
      --show-error \
      --fail \
      --connect-timeout 1 \
      --max-time 2 \
      http://127.0.0.1:8000/health 2>/dev/null || true
  )"
  HEALTH_FIELDS="$(
    printf '%s' "$HEALTH_JSON" | python -c '
import json
import sys

try:
    payload = json.load(sys.stdin)
except Exception:
    payload = {}
print("{}|{}".format(
    payload.get("build_id", ""),
    payload.get("frontend_build_id", ""),
))
' 2>/dev/null || true
  )"
  HEALTH_BUILD="${HEALTH_FIELDS%%|*}"
  HEALTH_FRONTEND_BUILD="${HEALTH_FIELDS#*|}"

  if [ "$HEALTH_BUILD" = "$APP_BUILD_ID" ] && [ "$HEALTH_FRONTEND_BUILD" = "$APP_BUILD_ID" ]; then
    HEALTH_CONFIRMED=true
    pm2 save --force >/dev/null
    break
  fi
  sleep 1
done

if [ "$HEALTH_CONFIRMED" != true ]; then
  echo "健康檢查未回報 backend/frontend build_id=$APP_BUILD_ID" >&2
  exit 1
fi

echo "[9/10] 健康 origin 上線後執行選擇性 Cloudflare purge"
PURGE_STATUS="skipped"
PURGE_MARKER="$BUILD_ROOT/.cache-tag-purge-ready"
CF_ZONE_VALUE="${CF_ZONE_ID:-${CLOUDFLARE_ZONE_ID:-}}"
CF_TOKEN_VALUE="${CF_API_TOKEN:-${CLOUDFLARE_API_TOKEN:-}}"
CF_PURGE_MODE_VALUE="${CF_PURGE_MODE:-${CLOUDFLARE_PURGE_MODE:-}}"
if [ -z "$CF_PURGE_MODE_VALUE" ]; then
  if [ -f "$PURGE_MARKER" ]; then
    CF_PURGE_MODE_VALUE="tag"
  else
    CF_PURGE_MODE_VALUE="urls"
  fi
fi
if [ -n "$CF_ZONE_VALUE" ] || [ -n "$CF_TOKEN_VALUE" ]; then
  if [ -z "$CF_ZONE_VALUE" ] || [ -z "$CF_TOKEN_VALUE" ]; then
    PURGE_STATUS="pending"
    echo "Cloudflare purge pending：Zone ID/API Token 只設定了一項。" >&2
  elif CF_ZONE_ID="$CF_ZONE_VALUE" CF_API_TOKEN="$CF_TOKEN_VALUE" \
    CF_PURGE_MODE="$CF_PURGE_MODE_VALUE" \
    PUBLIC_ORIGIN="${PUBLIC_ORIGIN:-https://ampaprint.systems}" \
    node scripts/purge-cloudflare.mjs; then
    PURGE_STATUS="complete"
    if [ "$CF_PURGE_MODE_VALUE" = "urls" ]; then
      touch "$PURGE_MARKER"
    fi
  else
    PURGE_STATUS="pending"
    echo "Cloudflare purge pending：健康 origin 保持上線，不自動回滾。" >&2
  fi
fi

echo "[10/10] 保留至少最近 3 版，且不刪除 7 天內 release"
mapfile -t RELEASE_NAMES < <(
  find "$BUILD_ROOT" \
    -mindepth 1 \
    -maxdepth 1 \
    -type d \
    ! -name '_staging-*' \
    -printf '%T@ %f\n' \
    | sort -nr \
    | cut -d' ' -f2-
)

for index in "${!RELEASE_NAMES[@]}"; do
  release_name="${RELEASE_NAMES[$index]}"
  release_dir="$BUILD_ROOT/$release_name"
  if [ "$index" -lt 3 ] \
    || [ "$release_name" = "$APP_BUILD_ID" ] \
    || [ "$release_name" = "$PREVIOUS_APP_BUILD_ID" ]; then
    continue
  fi
  if find "$release_dir" -maxdepth 0 -type d -mtime +7 -print -quit | grep -q .; then
    safe_remove_build_dir "$release_dir"
  fi
done

if [ "$PURGE_STATUS" = "pending" ]; then
  if [ "$CF_PURGE_MODE_VALUE" = "urls" ]; then
    echo "部署完成：$APP_BUILD_ID；Cloudflare purge=pending。請以 CF_PURGE_MODE=urls PUBLIC_ORIGIN=${PUBLIC_ORIGIN:-https://ampaprint.systems} npm run purge:cloudflare 重試。" >&2
  else
    echo "部署完成：$APP_BUILD_ID；Cloudflare purge=pending。請以 CF_PURGE_MODE=tag npm run purge:cloudflare 重試。" >&2
  fi
  exit 2
fi

echo "部署完成：$APP_BUILD_ID；Cloudflare purge=$PURGE_STATUS"
