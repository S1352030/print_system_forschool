import os
import shutil
import tempfile
import secrets
import hashlib
import uuid
import logging
from fastapi import FastAPI, File, Form, HTTPException, UploadFile, Depends, status, Request, BackgroundTasks
from fastapi.responses import JSONResponse, FileResponse, Response
from fastapi.security import HTTPBasic, HTTPBasicCredentials
from pypdf import PdfReader
from sqlalchemy.orm import Session
from dotenv import load_dotenv

# 壓縮模組（Brotli 優先 + Gzip 備用）
from compression import BrotliGzipMiddleware, serve_precompressed
# Zstandard 日誌系統
from log_manager import setup_logging

# 載入 .env 檔案設定
load_dotenv()

# 引入資料庫模塊
from database import Order, Announcement, get_db, engine, Base, ensure_order_columns
# 引入通知模塊
from notify import send_line_notification

# 啟動時自動建立資料表
Base.metadata.create_all(bind=engine)
ensure_order_columns()

app = FastAPI(title="影印計價與通知系統")

# ── 初始化結構化日誌系統（Zstd 壓縮輪替）────────────────────────
setup_logging()
log = logging.getLogger("print_system")

# ── Brotli/Gzip 壓縮中介軟體 ─────────────────────────────────────
# API 動態回應：Brotli Lv4 優先、Gzip Lv6 備用
# 二進位檔案（PDF/Image/Video）：自動跳過，零壓縮直傳
app.add_middleware(BrotliGzipMiddleware, minimum_size=500)

# ── 安全與快取中介軟體 ──────────────────────────────────────
@app.middleware("http")
async def add_security_and_cache_headers(request: Request, call_next):
    response = await call_next(request)
    
    # 1. X-Content-Type-Options
    response.headers["X-Content-Type-Options"] = "nosniff"
    
    # 2. Content-Security-Policy (取代 X-Frame-Options)
    response.headers["Content-Security-Policy"] = "frame-ancestors 'self'"
    
    # 3. 清理過期或不推薦的標頭
    for h in ["Expires", "expires", "Pragma", "pragma", "X-Frame-Options", "x-frame-options", "X-XSS-Protection", "x-xss-protection"]:
        if h in response.headers:
            del response.headers[h]
            
    # 4. 快取原則處理
    cache_control = response.headers.get("Cache-Control", "")
    
    # 清除不推薦的快取指令
    if "must-revalidate" in cache_control or "no-store" in cache_control:
        directives = [d.strip() for d in cache_control.split(",") if d.strip()]
        cleaned = [d for d in directives if "must-revalidate" not in d and "no-store" not in d]
        cache_control = ", ".join(cleaned)
        
    if request.url.path.startswith("/api/"):
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
                directives = [d.strip() for d in cache_control.split(",") if not d.strip().lower().startswith("max-age=")]
                if "no-cache" not in directives:
                    directives.append("no-cache")
                cache_control = ", ".join(directives)
    else:
        if not cache_control:
            cache_control = "no-cache"
            
    response.headers["Cache-Control"] = cache_control
    return response

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
# 建議於生產環境使用環境變數設定帳密。
# 例如在 Windows PowerShell 啟動：
#   $env:ADMIN_USERNAME="myadmin"; $env:ADMIN_PASSWORD="mypassword"; uvicorn main:app --reload
ADMIN_USERNAME = os.getenv("ADMIN_USERNAME", "admin")
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "admin123")  # 預設密碼，請務必修改！

security = HTTPBasic()

def authenticate_admin(credentials: HTTPBasicCredentials = Depends(security)):
    correct_username = secrets.compare_digest(credentials.username, ADMIN_USERNAME)
    correct_password = secrets.compare_digest(credentials.password, ADMIN_PASSWORD)
    if not (correct_username and correct_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="帳號或密碼錯誤",
            headers={"WWW-Authenticate": "Basic"},
        )
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
def count_pdf_pages(file_path: str) -> int:
    try:
        reader = PdfReader(file_path)
        return len(reader.pages)
    except Exception as exc:
        raise ValueError(f"無法讀取 PDF 頁數：{exc}") from exc

# ── API 路由 ──────────────────────────────────────────────
@app.post("/api/check-pages")
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
            total_pages = count_pdf_pages(tmp_path)
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
    db: Session = Depends(get_db)  # 注入資料庫 Session
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
        # 暫存檔案來計算頁數
        with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as tmp:
            shutil.copyfileobj(file.file, tmp)
            tmp_path = tmp.name

        try:
            total_pages = count_pdf_pages(tmp_path)
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
        shutil.copy2(tmp_path, file_path)

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
async def get_user_orders(user_name: str, db: Session = Depends(get_db)):
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
async def get_active_announcements(db: Session = Depends(get_db)):
    """前台 API：取得啟用中公告（5 分鐘快取，公告不需要即時性）"""
    announcements = db.query(Announcement).filter(Announcement.is_active == True).order_by(Announcement.id.desc()).all()
    return JSONResponse(
        content=[{"id": a.id, "content": a.content, "is_active": a.is_active, "created_at": str(a.created_at) if a.created_at else None} for a in announcements],
        headers={"Cache-Control": "public, max-age=300"},
    )

@app.get("/api/admin/announcements")
async def get_all_announcements(db: Session = Depends(get_db), username: str = Depends(authenticate_admin)):
    """後台 API：取得所有公告列表"""
    announcements = db.query(Announcement).order_by(Announcement.id.desc()).all()
    return announcements

@app.post("/api/announcements")
async def create_announcement(payload: dict, db: Session = Depends(get_db), username: str = Depends(authenticate_admin)):
    """後台 API：新增公告"""
    content = payload.get("content")
    if not content or not content.strip():
        raise HTTPException(status_code=400, detail="公告內容不能為空")
    new_announce = Announcement(content=content.strip())
    db.add(new_announce)
    db.commit()
    db.refresh(new_announce)
    return new_announce

@app.put("/api/announcements/{announcement_id}")
async def update_announcement_status(announcement_id: int, payload: dict, db: Session = Depends(get_db), username: str = Depends(authenticate_admin)):
    """後台 API：更新公告內容或啟用狀態"""
    announcement = db.query(Announcement).filter(Announcement.id == announcement_id).first()
    if not announcement:
        raise HTTPException(status_code=404, detail="找不到該公告")
    
    if "is_active" in payload:
        announcement.is_active = payload["is_active"]
    if "content" in payload:
        announcement.content = payload["content"].strip()
        
    db.commit()
    return {"status": "success"}

@app.delete("/api/announcements/{announcement_id}")
async def delete_announcement(announcement_id: int, db: Session = Depends(get_db), username: str = Depends(authenticate_admin)):
    """後台 API：刪除公告"""
    announcement = db.query(Announcement).filter(Announcement.id == announcement_id).first()
    if not announcement:
        raise HTTPException(status_code=404, detail="找不到該公告")
    
    db.delete(announcement)
    db.commit()
    return {"status": "success"}

@app.get("/api/orders")
async def get_all_orders(db: Session = Depends(get_db), username: str = Depends(authenticate_admin)):
    """給後台用的 API：取得所有訂單"""
    orders = db.query(Order).order_by(Order.id.desc()).all()
    return orders

@app.put("/api/orders/{order_id}")
async def update_order_status(order_id: int, payload: dict, db: Session = Depends(get_db), username: str = Depends(authenticate_admin)):
    """給後台用的 API：更新付款或列印狀態"""
    order = db.query(Order).filter(Order.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="找不到該訂單")
    
    if "is_paid" in payload:
        order.is_paid = payload["is_paid"]
    if "is_printed" in payload:
        order.is_printed = payload["is_printed"]
        
    db.commit()
    return {"status": "success"}

@app.get("/api/orders/{order_id}/file")
@app.get("/api/orders/{order_id}/file/{file_name}")
async def get_order_file(order_id: int, file_name: str | None = None, db: Session = Depends(get_db), username: str = Depends(authenticate_admin)):
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
async def preview_order_file(order_id: int, user_name: str, file_name: str | None = None, db: Session = Depends(get_db)):
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
async def delete_order(order_id: int, db: Session = Depends(get_db), username: str = Depends(authenticate_admin)):
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
