import os
import ipaddress
import shutil
import tempfile
import secrets
import hashlib
import uuid
import logging
import asyncio
import time
from collections import defaultdict
from fastapi import FastAPI, File, Form, HTTPException, UploadFile, Depends, status, Request, BackgroundTasks, Query
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse, FileResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.security import HTTPBasic, HTTPBasicCredentials
from pypdf import PdfReader
from sqlalchemy.orm import Session
from sqlalchemy import text

# 壓縮模組（Brotli 優先 + Gzip 備用）
from compression import BrotliGzipMiddleware, serve_precompressed
# Zstandard 日誌系統
from log_manager import setup_logging
# 集中式設定(取代散落的 os.getenv)
from config import settings
# Pydantic 請求模型
from schemas import AnnouncementCreate, AnnouncementUpdate, OrderStatusUpdate

# 引入資料庫模塊
from database import Order, Announcement, get_db, engine, Base, ensure_order_columns, SessionLocal
# 引入通知模塊
from notify import send_line_notification

# ── 輕量級 Rate Limiter（滑動視窗，適用免費層級，無需 Redis）─────
class RateLimiter:
    """
    基於 key 的滑動視窗速率限制器(記憶體內)。

    除了 is_allowed() 的一般限流,另提供 register_failure / is_locked / reset_failure
    三個方法,專門用於管理員暴力破解防護:連續 N 次失敗後鎖定 key 一段時間。
    """
    def __init__(self):
        # 限流計數:每個 key 維護一個 hit 時間戳清單
        self._hits: dict[str, list[float]] = defaultdict(list)
        # 失敗計數:每個 key 的連續失敗次數 + 第一次失敗的時間(用於鎖定視窗)
        self._failures: dict[str, dict] = defaultdict(dict)
        self._last_cleanup = time.monotonic()

    def is_allowed(self, key: str, max_hits: int, window_seconds: int) -> bool:
        now = time.monotonic()
        # 每 60 秒清理過期記錄,防止記憶體洩漏
        if now - self._last_cleanup > 60:
            self._cleanup(now, window_seconds)
        hits = self._hits[key]
        # 移除視窗外的舊記錄
        cutoff = now - window_seconds
        while hits and hits[0] < cutoff:
            hits.pop(0)
        if len(hits) >= max_hits:
            return False
        hits.append(now)
        return True

    # ── 暴力破解防護 API ──────────────────────────────────────
    def register_failure(self, key: str) -> int:
        """記錄一次失敗,回傳目前累計失敗次數。"""
        now = time.monotonic()
        record = self._failures[key]
        if not record:
            record["first_failure_at"] = now
        record["count"] = record.get("count", 0) + 1
        return record["count"]

    def is_locked(self, key: str, max_failures: int, lock_seconds: int) -> bool:
        """
        判斷該 key 是否仍處於鎖定期。
        鎖定邏輯:累計失敗 >= max_failures 時,從「第一次失敗 + lock_seconds」為鎖定截止。
        超過鎖定期後自動重置(下次嘗試重新計算)。
        """
        record = self._failures.get(key)
        if not record or record.get("count", 0) < max_failures:
            return False
        now = time.monotonic()
        # 鎖定視窗從第一次失敗開始算 lock_seconds
        locked_until = record["first_failure_at"] + lock_seconds
        if now >= locked_until:
            # 鎖定過期,清除此 key 讓使用者重新嘗試
            del self._failures[key]
            return False
        return True

    def reset_failure(self, key: str) -> None:
        """成功時清除失敗計數(例如登入成功)。"""
        self._failures.pop(key, None)

    def _cleanup(self, now: float, default_window: int):
        self._last_cleanup = now
        cutoff = now - default_window
        expired_keys = [k for k, v in self._hits.items() if not v or v[-1] < cutoff]
        for k in expired_keys:
            del self._hits[k]
        # 同時清理過期的失敗記錄(保守地以 1 小時為界)
        old_failure_cutoff = now - 3600
        expired_failures = [
            k for k, v in self._failures.items()
            if v.get("first_failure_at", 0) < old_failure_cutoff
        ]
        for k in expired_failures:
            del self._failures[k]

rate_limiter = RateLimiter()


# ── 客戶端 IP 偵測(信任反向代理清單)──────────────────────────
def _is_ip_trusted(ip_str: str, trusted_networks: list[str]) -> bool:
    """檢查 IP 是否落在信任的反向代理網路清單內(支援 CIDR)。"""
    if not trusted_networks:
        return False
    try:
        ip = ipaddress.ip_address(ip_str)
    except ValueError:
        return False
    for cidr in trusted_networks:
        try:
            if ip in ipaddress.ip_network(cidr, strict=False):
                return True
        except ValueError:
            continue
    return False


def _get_client_ip(request: Request) -> str:
    """
    取得真實客戶端 IP。

    安全考量:舊版無條件信任 X-Forwarded-For,直連模式下可被偽造繞過限流。
    新版只有在 request.client.host 落在 TRUSTED_PROXIES 信任清單時,
    才解析 X-Forwarded-For(取最左側,即最原始的客戶端 IP);
    否則一律以 request.client.host 為準(直連模式)。
    """
    direct_host = request.client.host if request.client else "unknown"
    trusted_networks = settings.trusted_proxy_networks

    if not trusted_networks:
        # 直連模式:完全不信任 forwarded header
        return direct_host

    if not _is_ip_trusted(direct_host, trusted_networks):
        # 連線來源不是已知反代 → 不信任其 forwarded header
        return direct_host

    # 連線來自信任的反代,可解析 X-Forwarded-For 最左側(最原始客戶端)
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        # X-Forwarded-For: client, proxy1, proxy2 → 取 client
        return forwarded.split(",")[0].strip() or direct_host
    # 反代未附加 header(例如只有 TCP 代理),退而用 X-Real-IP
    real_ip = request.headers.get("x-real-ip")
    if real_ip:
        return real_ip.strip()
    return direct_host


# ── Rate Limit FastAPI Dependency 工廠 ────────────────────────
def rate_limit(key_prefix: str, max_hits: int | None = None, window_seconds: int = 60):
    """
    產生一個 FastAPI dependency,用於對路由套用限流。

    用法:
        @app.get("/api/foo", dependencies=[Depends(rate_limit("foo"))])
        或
        def handler(_: None = Depends(rate_limit("upload", 5))):
            ...

    max_hits 若不指定,自動從 settings 取對應 key_prefix 的預設值。
    """
    # key_prefix → 預設限流的對照表
    _defaults = {
        "api": settings.RATE_LIMIT_API_PER_MIN,
        "upload": settings.RATE_LIMIT_UPLOAD_PER_MIN,
        "admin": settings.RATE_LIMIT_ADMIN_PER_MIN,
        "file": settings.RATE_LIMIT_FILE_PER_MIN,
    }
    if max_hits is None:
        max_hits = _defaults.get(key_prefix, settings.RATE_LIMIT_API_PER_MIN)

    def _check(request: Request) -> None:
        client_ip = _get_client_ip(request)
        if not rate_limiter.is_allowed(f"{key_prefix}:{client_ip}", max_hits, window_seconds):
            raise HTTPException(
                status_code=429,
                detail="請求過於頻繁,請稍後再試。",
                headers={"Retry-After": str(window_seconds)},
            )

    return _check

# ── 上傳檔案限制常數 ─────────────────────────────────────────
# 改由 settings 動態提供,方便透過環境變數調整
MAX_UPLOAD_SIZE = settings.max_upload_bytes
PDF_MAGIC_BYTES = b"%PDF-"

# 啟動時自動建立資料表
Base.metadata.create_all(bind=engine)
ensure_order_columns()

# ── 應用程式啟動時間(供 /health 計算 uptime)────────────────────
import time as _time
_APP_START_TIME = _time.monotonic()

# ── 舊訂單清理(啟動執行一次 + APScheduler 定期執行)──────────────
def _cleanup_old_orders_once() -> int:
    """
    清理超過 ORDER_RETENTION_DAYS 的「已付款且已列印」訂單及其 PDF 檔案,
    回傳刪除筆數。可在啟動時與排程中重複呼叫。

    注意:本函式為同步,由 APScheduler 的執行緒池或 asyncio.to_thread 呼叫,
    不會阻塞事件循環。
    """
    from database import get_taipei_now
    from datetime import timedelta as td
    cutoff = get_taipei_now() - td(days=settings.ORDER_RETENTION_DAYS)
    db = SessionLocal()
    try:
        old_orders = db.query(Order).filter(
            Order.is_paid == True,
            Order.is_printed == True,
            Order.created_at < cutoff
        ).all()
        deleted_count = 0
        for order in old_orders:
            physical_filename = order.physical_path if order.physical_path else f"order_{order.id}.pdf"
            file_path = os.path.join(UPLOAD_DIR, physical_filename)
            if os.path.exists(file_path):
                try:
                    os.remove(file_path)
                except Exception as exc:
                    log.error("清理舊訂單時無法刪除檔案 %s: %s", file_path, exc)
            db.delete(order)
            deleted_count += 1
        if deleted_count > 0:
            db.commit()
            log.info(
                "清理完成:已刪除 %d 筆超過 %d 天的已完成訂單",
                deleted_count, settings.ORDER_RETENTION_DAYS,
            )
        return deleted_count
    except Exception as exc:
        log.error("清理舊訂單失敗:%s", exc)
        db.rollback()
        return 0
    finally:
        db.close()


def _scheduled_cleanup() -> None:
    """APScheduler 排程的包裝器,捕捉所有例外避免排程中斷。"""
    try:
        _cleanup_old_orders_once()
    except Exception as exc:
        log.error("排程清理任務發生未預期錯誤:%s", exc)


# ── Lifespan:啟動/關閉事件(取代棄用的 @app.on_event)────────────
from contextlib import asynccontextmanager
from apscheduler.schedulers.background import BackgroundScheduler

_scheduler: BackgroundScheduler | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    應用程式生命週期管理。

    啟動時:
    1. 立即執行一次舊訂單清理(同步於執行緒池,不阻塞)
    2. 啟動 APScheduler,每 CLEANUP_INTERVAL_HOURS 定期清理

    關閉時:
    - scheduler.shutdown(wait=False) 立即停止,不等待執行中任務
      (GCP 搶佔/重新部署收到 SIGTERM 時能快速回應)
    """
    global _scheduler

    # 啟動:首次清理(放執行緒池避免阻塞 lifespan)
    log.info("應用程式啟動,執行首次舊訂單清理...")
    await asyncio.to_thread(_cleanup_old_orders_once)

    # 啟動 APScheduler(背景執行緒,獨立於事件循環)
    _scheduler = BackgroundScheduler(timezone="Asia/Taipei")
    _scheduler.add_job(
        _scheduled_cleanup,
        trigger="interval",
        hours=settings.CLEANUP_INTERVAL_HOURS,
        id="cleanup_old_orders",
        replace_existing=True,
        max_instances=1,        # 避免重疊執行
        coalesce=True,          # 多次錯過的觸發合併為一次
    )
    _scheduler.start()
    log.info(
        "APScheduler 已啟動:每 %d 小時清理一次超過 %d 天的舊訂單",
        settings.CLEANUP_INTERVAL_HOURS, settings.ORDER_RETENTION_DAYS,
    )

    try:
        yield
    finally:
        # 關閉:立即停止排程器,不等待執行中的任務(優雅停機)
        if _scheduler is not None:
            _scheduler.shutdown(wait=False)
            log.info("APScheduler 已關閉")


app = FastAPI(title="影印計價與通知系統", lifespan=lifespan)

# 提供靜態檔案服務 (用於 PDF.js 等)
app.mount("/static", StaticFiles(directory="static"), name="static")

# ── 初始化結構化日誌系統（Zstd 壓縮輪替）────────────────────────
setup_logging()
log = logging.getLogger("print_system")

# ── Brotli/Gzip 壓縮中介軟體 ─────────────────────────────────────
# API 動態回應：Brotli Lv4 優先、Gzip Lv6 備用
# 二進位檔案（PDF/Image/Video）：自動跳過，零壓縮直傳
app.add_middleware(BrotliGzipMiddleware, minimum_size=500)

from starlette.datastructures import MutableHeaders

class SecurityAndCacheMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        path = scope.get("path", "")

        async def send_wrapper(message):
            if message["type"] == "http.response.start":
                headers = MutableHeaders(raw=message["headers"])
                
                # 1. 安全 Headers
                headers["X-Content-Type-Options"] = "nosniff"
                headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
                headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
                
                # 2. Content-Security-Policy (強化防護，攔截外部腳本注入如卡巴斯基)
                content_type = headers.get("content-type", "")
                csp = "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self' https://cdnjs.cloudflare.com blob:; worker-src 'self' blob:; frame-src 'self' blob: data:; object-src 'self' blob: data:"
                if "application/pdf" not in content_type.lower():
                    csp += "; frame-ancestors 'self'"
                headers["Content-Security-Policy"] = csp
                
                # 3. 清理過期或不推薦的標頭
                for h in ["Expires", "Pragma", "X-Frame-Options", "X-XSS-Protection"]:
                    if h in headers:
                        del headers[h]
                    h_lower = h.lower()
                    if h_lower in headers:
                        del headers[h_lower]
                        
                # 4. 快取原則處理
                cache_control = headers.get("Cache-Control", "")
                
                # 清除不推薦的快取指令(must-revalidate 與上游框架誤加的過時指令)
                # 注意:保留 no-store — 健康檢查、動態敏感回應需要它
                if cache_control and "must-revalidate" in cache_control.lower():
                    directives = [d.strip() for d in cache_control.split(",") if d.strip()]
                    cleaned = [d for d in directives if "must-revalidate" not in d.lower()]
                    cache_control = ", ".join(cleaned)
                        
                if path.startswith("/static/"):
                    # /static/ 底下是 PDF.js 函式庫本體、worker 與 cmaps 等版本固定的靜態資源，
                    # 內容不會變動，設定長效快取（1 年 + immutable）讓瀏覽器直接使用本地快取，
                    # 不必每次開啟 PDF 預覽都重新走一次 304 驗證流程，可明顯縮短 PDF.js 的載入時間。
                    cache_control = "public, max-age=31536000, immutable"
                elif path.startswith("/api/"):
                    if not cache_control:
                        cache_control = "private, no-cache"
                    else:
                        has_low_max_age = False
                        for directive in cache_control.split(","):
                            d = directive.strip().lower()
                            if d.startswith("max-age="):
                                try:
                                    age = int(d.split("=")[1])
                                    if age <= 180:
                                        has_low_max_age = True
                                except ValueError:
                                    pass
                        if has_low_max_age:
                            directives = [
                                d.strip() for d in cache_control.split(",") 
                                if not d.strip().lower().startswith("max-age=")
                            ]
                            if "no-cache" not in [d.lower() for d in directives]:
                                directives.append("no-cache")
                            cache_control = ", ".join(directives)
                else:
                    if not cache_control:
                        cache_control = "no-cache"
                        
                headers["Cache-Control"] = cache_control
                
                # 5. 強制 charset=utf-8 (文字、JSON、JS、CSS 等)
                content_type = headers.get("content-type", "")
                if content_type:
                    ct_lower = content_type.lower()
                    if ("text/" in ct_lower or "json" in ct_lower or "javascript" in ct_lower) and "charset=" not in ct_lower:
                        headers["content-type"] = f"{content_type}; charset=utf-8"
                        
                message["headers"] = headers.raw
                
            await send(message)

        await self.app(scope, receive, send_wrapper)

app.add_middleware(SecurityAndCacheMiddleware)


# ── Request Logging Middleware(結構化記錄每個請求)──────────────
# 記錄 method、path、status、耗時、IP、user_agent。
# 4xx/5xx 用 log.warning,2xx/3xx 用 log.info。
# 排除 /health 與 /static/ 避免雜訊(這兩類是監控與函式庫,量很大)。

# 不記錄 log 的路徑前綴(高頻或無意義的請求)
_LOG_SKIP_PATHS = ("/health", "/static/", "/sw.js")
# 哪些 IP 視為本地(避免在本機開發時被自己的請求洗版,但仍記錄)
_LOCAL_IP_PREFIXES = ("127.", "10.", "192.168.", "172.")


class RequestLoggingMiddleware:
    """ASGI middleware:結構化記錄每個 HTTP 請求的方法、路徑、狀態與耗時。"""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        path = scope.get("path", "")
        method = scope.get("method", "")

        # 跳過高頻/無意義路徑
        if any(path.startswith(p) for p in _LOG_SKIP_PATHS):
            await self.app(scope, receive, send)
            return

        # 取 IP(信任清單感知)
        direct_host = "unknown"
        client = scope.get("client")
        if client:
            direct_host = client[0]
        # 解析 headers(輕量版,只取需要的)
        forwarded = user_agent = ""
        for name, value in scope.get("headers", []):
            if name == b"x-forwarded-for":
                forwarded = value.decode("latin-1", errors="replace")
            elif name == b"user-agent":
                user_agent = value.decode("latin-1", errors="replace")
        # 委派給 _get_client_ip 的邏輯(避免重複,但 middleware 在 Request 物件建立前執行,
        # 此處簡化:若信任反代就用 XFF,否則用 direct_host)
        if settings.trusted_proxy_networks and _is_ip_trusted(direct_host, settings.trusted_proxy_networks) and forwarded:
            client_ip = forwarded.split(",")[0].strip()
        else:
            client_ip = direct_host

        start_time = time.monotonic()
        status_code_holder = {"code": 0}

        async def send_wrapper(message):
            if message["type"] == "http.response.start":
                status_code_holder["code"] = message.get("status", 0)
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        except Exception:
            # 例外會由全域 exception handler 接手;此處只記錄耗時與 500
            duration_ms = (time.monotonic() - start_time) * 1000
            log.error(
                "%s %s 500 %.0fms ip=%s ua=%r(未攔截例外)",
                method, path, duration_ms, client_ip, user_agent[:80],
            )
            raise

        status_code = status_code_holder["code"]
        duration_ms = (time.monotonic() - start_time) * 1000

        # 依狀態碼選日誌等級
        if status_code >= 500:
            log.error("%s %s %d %.0fms ip=%s ua=%r", method, path, status_code, duration_ms, client_ip, user_agent[:80])
        elif status_code >= 400:
            log.warning("%s %s %d %.0fms ip=%s ua=%r", method, path, status_code, duration_ms, client_ip, user_agent[:80])
        else:
            log.info("%s %s %d %.0fms ip=%s", method, path, status_code, duration_ms, client_ip)


app.add_middleware(RequestLoggingMiddleware)

# ── Service Worker 路由（必須在最前面，從根目錄提供）────────────
@app.get("/sw.js")
async def serve_service_worker(request: Request):
    """提供 Service Worker（必須從根目錄提供以獲得完整 scope）"""
    return serve_precompressed(
        "sw.js",
        request,
        media_type="text/javascript; charset=utf-8",
        extra_headers={"Cache-Control": "no-cache", "Service-Worker-Allowed": "/"},
    )

# ── 後台管理帳密與驗證設定 ──────────────────────────────────────
# 帳密改由 settings 統一管理(來自 .env 或環境變數)。
# 暴力破解防護:以 hash(IP + 帳號) 為 key,連續失敗 N 次後鎖定該組合 15 分鐘。
ADMIN_USERNAME = settings.ADMIN_USERNAME
ADMIN_PASSWORD = settings.ADMIN_PASSWORD

security = HTTPBasic()


def _admin_lock_key(ip: str, username: str) -> str:
    """
    產生管理員鎖定的复合 key。
    使用 SHA256(IP + Username) 避免明文儲存,且能區分不同 IP 的同一帳號,
    防止 NAT 環境下單一使用者被鎖定影響整個網段。
    """
    raw = f"{ip}:{username}".encode("utf-8")
    return "admin_login:" + hashlib.sha256(raw).hexdigest()


def authenticate_admin(request: Request, credentials: HTTPBasicCredentials = Depends(security)):
    """
    驗證後台管理員身分,內建暴力破解鎖定。

    鎖定策略:
    - 同一 (IP, 帳號) 組合連續失敗達 ADMIN_MAX_LOGIN_FAILURES 次 → 鎖定 ADMIN_LOCK_DURATION_MIN 分鐘
    - 鎖定期間即使輸入正確密碼仍回 423 Locked
    - 成功登入立即清除失敗計數
    """
    client_ip = _get_client_ip(request)
    lock_key = _admin_lock_key(client_ip, credentials.username)

    # 先檢查是否已鎖定
    if rate_limiter.is_locked(
        lock_key,
        max_failures=settings.ADMIN_MAX_LOGIN_FAILURES,
        lock_seconds=settings.ADMIN_LOCK_DURATION_MIN * 60,
    ):
        log.warning("管理員登入被封鎖:IP=%s, username=%s", client_ip, credentials.username)
        raise HTTPException(
            status_code=status.HTTP_423_LOCKED,
            detail=f"連續登入失敗次數過多,已鎖定 {settings.ADMIN_LOCK_DURATION_MIN} 分鐘,請稍後再試。",
            headers={"Retry-After": str(settings.ADMIN_LOCK_DURATION_MIN * 60)},
        )

    correct_username = secrets.compare_digest(credentials.username, ADMIN_USERNAME)
    correct_password = secrets.compare_digest(credentials.password, ADMIN_PASSWORD)

    if not (correct_username and correct_password):
        # 記錄失敗
        failures = rate_limiter.register_failure(lock_key)
        log.warning(
            "管理員登入失敗:IP=%s, username=%s, 累計失敗=%d/%d",
            client_ip, credentials.username, failures, settings.ADMIN_MAX_LOGIN_FAILURES,
        )
        # 若此次失敗剛觸發鎖定,回 423 讓前端知道;否則回 401
        if failures >= settings.ADMIN_MAX_LOGIN_FAILURES:
            raise HTTPException(
                status_code=status.HTTP_423_LOCKED,
                detail=f"登入失敗次數過多,已鎖定 {settings.ADMIN_LOCK_DURATION_MIN} 分鐘。",
                headers={"Retry-After": str(settings.ADMIN_LOCK_DURATION_MIN * 60)},
            )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="帳號或密碼錯誤",
            headers={"WWW-Authenticate": "Basic"},
        )

    # 登入成功,清除失敗計數
    rate_limiter.reset_failure(lock_key)
    return credentials.username

PRICE_PER_PAGE_BY_COLOR: dict[str, int] = {
    "bw": 1,
    "color": 2,
}

UPLOAD_DIR = "uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)

# ── 網頁畫面路由（預壓縮靜態派發 + ETag 條件式快取）──────────────
@app.get("/")
async def serve_frontend(request: Request):
    """提供使用者上傳頁面（優先派發 .br → .gz → 原始檔）"""
    return serve_precompressed("index.html", request, media_type="text/html; charset=utf-8")

@app.get("/admin")
async def serve_admin(request: Request, username: str = Depends(authenticate_admin)):
    """提供後台管理頁面（優先派發 .br → .gz → 原始檔）"""
    return serve_precompressed("admin.html", request, media_type="text/html; charset=utf-8")

@app.get("/style.css")
async def serve_style(request: Request):
    """提供首頁樣式表"""
    return serve_precompressed("style.css", request, media_type="text/css; charset=utf-8")

@app.get("/admin.css")
async def serve_admin_style(request: Request):
    """提供後台樣式表"""
    return serve_precompressed("admin.css", request, media_type="text/css; charset=utf-8")

# ── 工具函式 ──────────────────────────────────────────────
def _count_pdf_pages_sync(file_path: str) -> int:
    """同步版本的 PDF 頁數計算（CPU 密集型，應在線程池中執行）"""
    try:
        reader = PdfReader(file_path)
        return len(reader.pages)
    except Exception as exc:
        raise ValueError(f"無法讀取 PDF 頁數：{exc}") from exc


# ── PDF Range Request 串流(避免一次讀進 RAM)─────────────────────
# GCP 免費層(e2-micro,1GB RAM)上,舊版 FileResponse 不支援 Range,
# 瀏覽器 PDF 預覽無法跳頁串流,且大檔案會浪費頻寬。此函式實作 HTTP 206
# Partial Content,使用 aiofiles 分塊非同步讀取,即使中斷也能正確釋放 fd。

# 每次讀取的分塊大小(64KB,平衡 syscall 次數與記憶體佔用)
_PDF_CHUNK_SIZE = 64 * 1024


def _parse_range_header(range_header: str, file_size: int) -> tuple[int, int] | None:
    """
    解析 HTTP Range header,回傳 (start, end) 含頭尾的位元組區間(閉區間)。

    支援格式:
      bytes=0-1023      → (0, 1023)
      bytes=500-        → (500, file_size-1)
      bytes=-500        → (file_size-500, file_size-1)

    不合法或多重範圍(bytes=a-b,c-d)回傳 None(呼叫端應回 416)。
    """
    if not range_header.startswith("bytes="):
        return None
    range_spec = range_header[6:].strip()
    # 不支援多重範圍
    if "," in range_spec:
        return None
    if "-" not in range_spec:
        return None
    start_str, end_str = range_spec.split("-", 1)
    try:
        if start_str == "":
            # suffix range:bytes=-500 → 最後 500 bytes
            length = int(end_str)
            if length <= 0:
                return None
            start = max(0, file_size - length)
            end = file_size - 1
        elif end_str == "":
            # open range:bytes=500- → 從 500 到檔尾
            start = int(start_str)
            end = file_size - 1
        else:
            start = int(start_str)
            end = int(end_str)
            if end >= file_size:
                end = file_size - 1
        if start < 0 or start >= file_size or start > end:
            return None
        return (start, end)
    except ValueError:
        return None


async def serve_pdf_with_range(
    file_path: str,
    request: Request,
    download_filename: str,
) -> Response:
    """
    以 HTTP 206 Partial Content 串流 PDF 檔案。

    - 無 Range header → 回 200 + 完整檔案(仍用串流,不一次讀進 RAM)
    - 有合法 Range → 回 206 + Content-Range
    - Range 不合法 → 回 416 Range Not Satisfiable

    使用 aiofiles 非同步分塊讀取,連線中斷時自動釋放 file descriptor。
    """
    import aiofiles
    import os as _os

    if not _os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="找不到該訂單的 PDF 檔案")

    file_size = _os.path.getsize(file_path)
    range_header = request.headers.get("range")

    # ── 處理 Range header ─────────────────────────────────
    if range_header:
        parsed = _parse_range_header(range_header, file_size)
        if parsed is None:
            # 不合法範圍 → 416
            return Response(
                status_code=416,
                headers={
                    "Content-Range": f"bytes */{file_size}",
                },
            )
        start, end = parsed
        status_code = 206
        content_length = end - start + 1
        content_range = f"bytes {start}-{end}/{file_size}"
    else:
        # 無 Range → 完整檔案
        start, end = 0, file_size - 1
        status_code = 200
        content_length = file_size
        content_range = None

    # ── 非同步分塊讀取 generator ──────────────────────────
    async def _stream():
        # 使用 async with 確保連線中斷時 fd 也會正確釋放
        async with aiofiles.open(file_path, "rb") as f:
            await f.seek(start)
            remaining = content_length
            while remaining > 0:
                chunk_size = min(_PDF_CHUNK_SIZE, remaining)
                chunk = await f.read(chunk_size)
                if not chunk:
                    break
                remaining -= len(chunk)
                yield chunk

    headers = {
        "Content-Type": "application/pdf",
        "Content-Length": str(content_length),
        "Content-Disposition": f'inline; filename="{download_filename}"',
        "Accept-Ranges": "bytes",
        "Cache-Control": "private, no-cache",
    }
    if content_range is not None:
        headers["Content-Range"] = content_range

    return StreamingResponse(
        content=_stream(),
        status_code=status_code,
        headers=headers,
        media_type="application/pdf",
    )

async def count_pdf_pages(file_path: str) -> int:
    """非同步版本:在線程池中執行 PDF 解析,避免阻塞事件循環。
    使用 asyncio.to_thread(Python 3.9+)取代棄用的 get_event_loop()。
    """
    return await asyncio.to_thread(_count_pdf_pages_sync, file_path)

# ── API 路由 ──────────────────────────────────────────────
@app.post("/api/check-pages", dependencies=[Depends(rate_limit("api"))])
async def check_pdf_pages(file: UploadFile = File(...)):
    """臨時解析 PDF 檔並返回頁數"""
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="僅接受 PDF 格式的檔案。")
    
    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as tmp:
            shutil.copyfileobj(file.file, tmp)
            tmp_path = tmp.name
        
        try:
            total_pages = await count_pdf_pages(tmp_path)
            return {"status": "success", "pages": total_pages}
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc))
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.remove(tmp_path)

def _send_line_notification_bg(user_name: str, file_name: str, total_pages: int, total_price: float):
    notify_result = send_line_notification(
        user_name=user_name,
        file_name=file_name,
        total_pages=total_pages,
        total_price=total_price,
    )
    if "error" in notify_result:
        log.error("LINE 通知發送失敗：%s", notify_result["error"])
    else:
        log.info("LINE 通知發送成功（使用者: %s, 檔案: %s）", user_name, file_name)

@app.post("/api/upload")
async def upload_order(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    user_name: str = Form(...),
    color_mode: str = Form("bw"),
    duplex: str = Form("single"),
    binding: str | None = Form(None),
    pickup_location: str | None = Form(None),
    db: Session = Depends(get_db),  # 注入資料庫 Session
    _rl: None = Depends(rate_limit("upload")),  # 上傳限流(較嚴格)
) -> JSONResponse:
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="僅接受 PDF 格式的檔案。")

    if color_mode not in PRICE_PER_PAGE_BY_COLOR:
        raise HTTPException(status_code=400, detail="Invalid color mode")
    if duplex not in {"single", "double"}:
        raise HTTPException(status_code=400, detail="Invalid duplex mode")
    if pickup_location and len(pickup_location) > 20:
        raise HTTPException(status_code=400, detail="取件時間長度不能超過 20 個字元。")

    tmp_path = None
    try:
        # 暫存檔案來計算頁數（含大小限制與 PDF 驗證）
        with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as tmp:
            total_size = 0
            first_chunk = True
            while True:
                chunk = await file.read(8192)
                if not chunk:
                    break
                # 驗證 PDF magic bytes（僅檢查第一個 chunk）
                if first_chunk:
                    if not chunk[:5].startswith(PDF_MAGIC_BYTES):
                        raise HTTPException(status_code=400, detail="檔案內容不是有效的 PDF 格式。")
                    first_chunk = False
                total_size += len(chunk)
                if total_size > MAX_UPLOAD_SIZE:
                    raise HTTPException(
                        status_code=413,
                        detail=f"檔案大小超過上限 {MAX_UPLOAD_SIZE // (1024*1024)} MB。"
                    )
                tmp.write(chunk)
            tmp_path = tmp.name

        try:
            total_pages = await count_pdf_pages(tmp_path)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc))
            
        total_price = total_pages * PRICE_PER_PAGE_BY_COLOR[color_mode]

        # 生成 UUID 實體檔名
        physical_filename = f"{uuid.uuid4()}.pdf"

        # 寫入資料庫
        new_order = Order(
            user_name=user_name,
            file_name=file.filename,
            display_name=file.filename,
            physical_path=physical_filename,
            total_pages=total_pages,
            total_price=total_price,
            color_mode=color_mode,
            duplex=duplex,
            binding=binding,
            pickup_location=pickup_location
        )
        db.add(new_order)
        db.commit()
        db.refresh(new_order) # 取得產生的 id

        # 儲存上傳的 PDF 檔案以供後台下載/預覽
        file_path = os.path.join(UPLOAD_DIR, physical_filename)
        await asyncio.get_event_loop().run_in_executor(None, shutil.copy2, tmp_path, file_path)

        # 觸發 LINE 通知（非同步背景任務，避免阻塞前端上傳響應）
        background_tasks.add_task(
            _send_line_notification_bg,
            user_name=user_name,
            file_name=file.filename,
            total_pages=total_pages,
            total_price=total_price,
        )

        return JSONResponse(
            content={"status": "success", "order_id": new_order.id, "total_price": total_price},
            status_code=201,
        )
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.remove(tmp_path)

@app.get("/api/orders/history")
async def get_user_orders(
    user_name: str,
    page: int | None = Query(default=None, ge=1, description="頁碼(從 1 開始);不帶則回傳舊版全量格式"),
    page_size: int | None = Query(default=None, ge=1, description="每頁筆數"),
    db: Session = Depends(get_db),
    _rl: None = Depends(rate_limit("api")),
):
    """
    取得特定使用者的訂單歷史(精簡欄位 + 短快取)。

    向後相容設計:
    - 不帶 page 參數 → 舊版純陣列(但加 ORDERS_MAX_PAGE_SIZE 安全上限)。
    - 帶 page 參數 → {items, total, page, page_size, total_pages}。
    """
    if not user_name or not user_name.strip():
        raise HTTPException(status_code=400, detail="請提供姓名或學號以供查詢")

    effective_page_size = (
        min(page_size or settings.ORDERS_DEFAULT_PAGE_SIZE,
            settings.ORDERS_MAX_PAGE_SIZE)
    )

    base_query = (
        db.query(
            Order.id, Order.file_name, Order.total_pages, Order.total_price,
            Order.color_mode, Order.duplex, Order.binding, Order.pickup_location,
            Order.is_paid, Order.is_printed, Order.created_at,
        )
        .filter(Order.user_name == user_name.strip())
        .order_by(Order.id.desc())
    )

    def _row_to_dict(r) -> dict:
        return {
            "id": r.id, "file_name": r.file_name,
            "total_pages": r.total_pages, "total_price": r.total_price,
            "color_mode": r.color_mode, "duplex": r.duplex,
            "binding": r.binding, "pickup_location": r.pickup_location,
            "is_paid": r.is_paid, "is_printed": r.is_printed,
            "created_at": str(r.created_at) if r.created_at else None,
        }

    if page is None:
        rows = base_query.limit(settings.ORDERS_MAX_PAGE_SIZE).all()
        result = [_row_to_dict(r) for r in rows]
        return JSONResponse(
            content=result,
            headers={
                "Cache-Control": "private, no-cache",
                "X-Deprecation-Warning": (
                    f"Unpaginated calls are deprecated and capped at "
                    f"{settings.ORDERS_MAX_PAGE_SIZE} results. Use ?page=1&page_size={settings.ORDERS_DEFAULT_PAGE_SIZE}"
                ),
            },
        )

    total = base_query.count()
    total_pages = (total + effective_page_size - 1) // effective_page_size if total > 0 else 0
    rows = base_query.offset((page - 1) * effective_page_size).limit(effective_page_size).all()
    return JSONResponse(
        content={
            "items": [_row_to_dict(r) for r in rows],
            "total": total,
            "page": page,
            "page_size": effective_page_size,
            "total_pages": total_pages,
        },
        headers={"Cache-Control": "private, no-cache"},
    )

@app.get("/api/announcements")
async def get_active_announcements(
    db: Session = Depends(get_db),
    _rl: None = Depends(rate_limit("api")),
):
    """前台 API：取得啟用中公告（5 分鐘快取，公告不需要即時性）"""
    announcements = db.query(Announcement).filter(Announcement.is_active == True).order_by(Announcement.id.desc()).all()
    return JSONResponse(
        content=[{"id": a.id, "content": a.content, "is_active": a.is_active, "created_at": str(a.created_at) if a.created_at else None} for a in announcements],
        headers={"Cache-Control": "public, max-age=300"},
    )

@app.get("/api/admin/announcements")
async def get_all_announcements(
    db: Session = Depends(get_db),
    username: str = Depends(authenticate_admin),
    _rl: None = Depends(rate_limit("admin")),
):
    """後台 API：取得所有公告列表"""
    announcements = db.query(Announcement).order_by(Announcement.id.desc()).all()
    return announcements

@app.post("/api/announcements")
async def create_announcement(
    payload: AnnouncementCreate,
    db: Session = Depends(get_db),
    username: str = Depends(authenticate_admin),
    _rl: None = Depends(rate_limit("admin")),
):
    """後台 API：新增公告(content 由 schema 自動驗證非空)"""
    new_announce = Announcement(content=payload.content)
    db.add(new_announce)
    db.commit()
    db.refresh(new_announce)
    return new_announce

@app.put("/api/announcements/{announcement_id}")
async def update_announcement_status(
    announcement_id: int,
    payload: AnnouncementUpdate,
    db: Session = Depends(get_db),
    username: str = Depends(authenticate_admin),
    _rl: None = Depends(rate_limit("admin")),
):
    """後台 API：更新公告內容或啟用狀態"""
    announcement = db.query(Announcement).filter(Announcement.id == announcement_id).first()
    if not announcement:
        raise HTTPException(status_code=404, detail="找不到該公告")

    if payload.is_active is not None:
        announcement.is_active = payload.is_active
    if payload.content is not None:
        announcement.content = payload.content

    db.commit()
    return {"status": "success"}

@app.delete("/api/announcements/{announcement_id}")
async def delete_announcement(
    announcement_id: int,
    db: Session = Depends(get_db),
    username: str = Depends(authenticate_admin),
    _rl: None = Depends(rate_limit("admin")),
):
    """後台 API：刪除公告"""
    announcement = db.query(Announcement).filter(Announcement.id == announcement_id).first()
    if not announcement:
        raise HTTPException(status_code=404, detail="找不到該公告")

    db.delete(announcement)
    db.commit()
    return {"status": "success"}

@app.get("/api/orders")
async def get_all_orders(
    request: Request,
    page: int | None = Query(default=None, ge=1, description="頁碼(從 1 開始);不帶則回傳舊版全量格式"),
    page_size: int | None = Query(default=None, ge=1, description="每頁筆數(上限由 ORDERS_MAX_PAGE_SIZE 控制)"),
    db: Session = Depends(get_db),
    username: str = Depends(authenticate_admin),
    _rl: None = Depends(rate_limit("admin")),
):
    """
    給後台用的 API:取得所有訂單。

    向後相容設計:
    - 不帶 page 參數 → 回傳舊版純陣列(但加安全上限 ORDERS_MAX_PAGE_SIZE,
      並附 X-Deprecation-Warning header 提示未來將淘汰)。
    - 帶 page 參數 → 回傳分頁結構 {items, total, page, page_size, total_pages}。
    """
    # 釐清有效 page_size(不論哪種模式都套用上限保護)
    effective_page_size = (
        min(page_size or settings.ORDERS_DEFAULT_PAGE_SIZE,
            settings.ORDERS_MAX_PAGE_SIZE)
    )

    base_query = db.query(Order).order_by(Order.id.desc())

    if page is None:
        # 舊版相容模式:回純陣列,但限制最大筆數保護伺服器
        orders = base_query.limit(settings.ORDERS_MAX_PAGE_SIZE).all()
        # HTTP header 只能 latin-1,用英文訊息避免 UnicodeEncodeError
        response = JSONResponse(
            content=jsonable_encoder(orders),
            headers={
                "X-Deprecation-Warning": (
                    f"Unpaginated calls are deprecated and capped at "
                    f"{settings.ORDERS_MAX_PAGE_SIZE} results. Use ?page=1&page_size={settings.ORDERS_DEFAULT_PAGE_SIZE}"
                ),
            },
        )
        return response

    # 分頁模式
    total = base_query.count()
    total_pages = (total + effective_page_size - 1) // effective_page_size if total > 0 else 0
    items = base_query.offset((page - 1) * effective_page_size).limit(effective_page_size).all()
    return {
        "items": jsonable_encoder(items),
        "total": total,
        "page": page,
        "page_size": effective_page_size,
        "total_pages": total_pages,
    }

@app.put("/api/orders/{order_id}")
async def update_order_status(
    order_id: int,
    payload: OrderStatusUpdate,
    db: Session = Depends(get_db),
    username: str = Depends(authenticate_admin),
    _rl: None = Depends(rate_limit("admin")),
):
    """給後台用的 API：更新付款或列印狀態"""
    order = db.query(Order).filter(Order.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="找不到該訂單")

    if payload.is_paid is not None:
        order.is_paid = payload.is_paid
    if payload.is_printed is not None:
        order.is_printed = payload.is_printed

    db.commit()
    return {"status": "success"}

@app.get("/api/orders/{order_id}/file")
@app.get("/api/orders/{order_id}/file/{file_name}")
async def get_order_file(
    order_id: int,
    request: Request,
    file_name: str | None = None,
    db: Session = Depends(get_db),
    username: str = Depends(authenticate_admin),
    _rl: None = Depends(rate_limit("file")),
):
    """給後台用的 API:串流 PDF 檔案以供下載或預覽(支援 HTTP Range)"""
    order = db.query(Order).filter(Order.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="找不到該訂單")

    physical_filename = order.physical_path if order.physical_path else f"order_{order_id}.pdf"
    file_path = os.path.join(UPLOAD_DIR, physical_filename)
    download_name = order.display_name if order.display_name else order.file_name
    return await serve_pdf_with_range(file_path, request, download_name)

@app.get("/api/orders/{order_id}/preview")
@app.get("/api/orders/{order_id}/preview/{file_name}")
async def preview_order_file(
    order_id: int,
    request: Request,
    user_name: str,
    file_name: str | None = None,
    db: Session = Depends(get_db),
    _rl: None = Depends(rate_limit("file")),
):
    """前台使用者預覽 PDF 檔案,需提供正確的 user_name(支援 HTTP Range)"""
    if not user_name or not user_name.strip():
        raise HTTPException(status_code=400, detail="請提供姓名或學號以供驗證")

    order = db.query(Order).filter(Order.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="找不到該訂單")

    if order.user_name.strip() != user_name.strip():
        raise HTTPException(status_code=403, detail="無權存取此訂單的檔案")

    physical_filename = order.physical_path if order.physical_path else f"order_{order_id}.pdf"
    file_path = os.path.join(UPLOAD_DIR, physical_filename)
    download_name = order.display_name if order.display_name else order.file_name
    return await serve_pdf_with_range(file_path, request, download_name)


@app.delete("/api/orders/{order_id}")
async def delete_order(
    order_id: int,
    db: Session = Depends(get_db),
    username: str = Depends(authenticate_admin),
    _rl: None = Depends(rate_limit("admin")),
):
    """給後台用的 API：刪除訂單及其實體 PDF 檔案"""
    order = db.query(Order).filter(Order.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="找不到該訂單")
    
    # 刪除實體檔案
    physical_filename = order.physical_path if order.physical_path else f"order_{order_id}.pdf"
    file_path = os.path.join(UPLOAD_DIR, physical_filename)
    if os.path.exists(file_path):
        try:
            os.remove(file_path)
        except Exception as exc:
            log.error("無法刪除檔案 %s: %s", file_path, exc)
            
    db.delete(order)
    db.commit()
    return {"status": "success"}


# ── 健康檢查端點(必須在 app 定義後,放檔尾方便維護)──────────────
# 不要求認證、不限流(讓監控程式/GCP LB 可定期打)
@app.get("/health")
async def health_check(db: Session = Depends(get_db)):
    """健康檢查:回傳服務狀態、DB 連通性、uptime、版本。"""
    db_ok = True
    try:
        db.execute(text("SELECT 1"))
    except Exception as exc:
        db_ok = False
        log.error("/health 資料庫檢查失敗:%s", exc)

    uptime_seconds = int(_time.monotonic() - _APP_START_TIME)
    status_code = 200 if db_ok else 503
    return JSONResponse(
        status_code=status_code,
        content={
            "status": "ok" if db_ok else "degraded",
            "db": db_ok,
            "uptime_seconds": uptime_seconds,
            "version": settings.APP_VERSION,
        },
        headers={"Cache-Control": "no-store"},
    )


# ── 全域 exception handler(攔截未預期錯誤,避免暴露堆疊給前端)────
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    """攔截所有未處理的例外,回 500 + 制式錯誤格式,並記錄完整堆疊。"""
    log.exception("未預期的例外:path=%s, exception=%r", request.url.path, exc)
    return JSONResponse(
        status_code=500,
        content={"error": "internal_server_error", "detail": "伺服器發生內部錯誤,請稍後再試。"},
        headers={"Cache-Control": "no-store"},
    )
