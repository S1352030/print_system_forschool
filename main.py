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
from fastapi import FastAPI, File, Form, HTTPException, UploadFile, Depends, status, Request, BackgroundTasks
from fastapi.responses import JSONResponse, FileResponse, Response
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

app = FastAPI(title="影印計價與通知系統")

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
                
                # 清除不推薦的快取指令
                if cache_control:
                    if "must-revalidate" in cache_control.lower() or "no-store" in cache_control.lower():
                        directives = [d.strip() for d in cache_control.split(",") if d.strip()]
                        cleaned = [
                            d for d in directives 
                            if "must-revalidate" not in d.lower() and "no-store" not in d.lower()
                        ]
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

async def count_pdf_pages(file_path: str) -> int:
    """非同步版本：在線程池中執行 PDF 解析，避免阻塞事件循環"""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _count_pdf_pages_sync, file_path)

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
    db: Session = Depends(get_db),
    _rl: None = Depends(rate_limit("api")),
):
    """取得特定使用者的訂單歷史（精簡欄位 + 短快取）"""
    if not user_name or not user_name.strip():
        raise HTTPException(status_code=400, detail="請提供姓名或學號以供查詢")
    rows = (
        db.query(
            Order.id, Order.file_name, Order.total_pages, Order.total_price,
            Order.color_mode, Order.duplex, Order.binding, Order.pickup_location,
            Order.is_paid, Order.is_printed, Order.created_at,
        )
        .filter(Order.user_name == user_name.strip())
        .order_by(Order.id.desc())
        .all()
    )
    result = [
        {
            "id": r.id, "file_name": r.file_name,
            "total_pages": r.total_pages, "total_price": r.total_price,
            "color_mode": r.color_mode, "duplex": r.duplex,
            "binding": r.binding, "pickup_location": r.pickup_location,
            "is_paid": r.is_paid, "is_printed": r.is_printed,
            "created_at": str(r.created_at) if r.created_at else None,
        }
        for r in rows
    ]
    return JSONResponse(
        content=result,
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
    db: Session = Depends(get_db),
    username: str = Depends(authenticate_admin),
    _rl: None = Depends(rate_limit("admin")),
):
    """給後台用的 API：取得所有訂單"""
    orders = db.query(Order).order_by(Order.id.desc()).all()
    return orders

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
    file_name: str | None = None,
    db: Session = Depends(get_db),
    username: str = Depends(authenticate_admin),
    _rl: None = Depends(rate_limit("file")),
):
    """給後台用的 API：串流 PDF 檔案以供下載或預覽"""
    order = db.query(Order).filter(Order.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="找不到該訂單")

    physical_filename = order.physical_path if order.physical_path else f"order_{order_id}.pdf"
    file_path = os.path.join(UPLOAD_DIR, physical_filename)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="找不到該訂單的 PDF 檔案")

    return FileResponse(
        file_path,
        media_type="application/pdf",
        filename=order.display_name if order.display_name else order.file_name,
        content_disposition_type="inline"
    )

@app.get("/api/orders/{order_id}/preview")
@app.get("/api/orders/{order_id}/preview/{file_name}")
async def preview_order_file(
    order_id: int,
    user_name: str,
    file_name: str | None = None,
    db: Session = Depends(get_db),
    _rl: None = Depends(rate_limit("file")),
):
    """前台使用者預覽 PDF 檔案，需提供正確的 user_name"""
    if not user_name or not user_name.strip():
        raise HTTPException(status_code=400, detail="請提供姓名或學號以供驗證")

    order = db.query(Order).filter(Order.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="找不到該訂單")

    if order.user_name.strip() != user_name.strip():
        raise HTTPException(status_code=403, detail="無權存取此訂單的檔案")

    physical_filename = order.physical_path if order.physical_path else f"order_{order_id}.pdf"
    file_path = os.path.join(UPLOAD_DIR, physical_filename)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="找不到該訂單的 PDF 檔案")

    return FileResponse(
        file_path,
        media_type="application/pdf",
        filename=order.display_name if order.display_name else order.file_name,
        content_disposition_type="inline"
    )


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

# ── 啟動時自動清理舊訂單（30 天前已完成的訂單）──────────────────
@app.on_event("startup")
async def cleanup_old_orders():
    """刪除 30 天前已付款且已列印的訂單及其 PDF 檔案，釋放磁碟空間"""
    from database import get_taipei_now
    from datetime import timedelta as td
    cutoff = get_taipei_now() - td(days=30)
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
            log.info("啟動清理：已刪除 %d 筆 30 天前的已完成訂單", deleted_count)
    except Exception as exc:
        log.error("啟動清理失敗：%s", exc)
        db.rollback()
    finally:
        db.close()
