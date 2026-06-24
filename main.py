import os
import shutil
import tempfile
import secrets
from fastapi import FastAPI, File, Form, HTTPException, UploadFile, Depends, status
from fastapi.responses import JSONResponse, FileResponse
from fastapi.security import HTTPBasic, HTTPBasicCredentials
from pypdf import PdfReader
from sqlalchemy.orm import Session
from dotenv import load_dotenv

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

# ── 網頁畫面路由 ──────────────────────────────────────────
@app.get("/")
async def serve_frontend():
    """提供使用者上傳頁面"""
    return FileResponse("index.html", headers={"Cache-Control": "no-cache"})

@app.get("/admin")
async def serve_admin(username: str = Depends(authenticate_admin)):
    """提供後台管理頁面"""
    return FileResponse("admin.html", headers={"Cache-Control": "no-cache"})

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

@app.post("/api/upload")
async def upload_order(
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

        # 寫入資料庫
        new_order = Order(
            user_name=user_name,
            file_name=file.filename,
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
        file_path = os.path.join(UPLOAD_DIR, f"order_{new_order.id}.pdf")
        shutil.copy2(tmp_path, file_path)

        # 觸發 LINE 通知
        notify_result = send_line_notification(
            user_name=user_name,
            file_name=file.filename,
            total_pages=total_pages,
            total_price=total_price,
        )
        if "error" in notify_result:
            print(f"[LINE Notify Error] LINE 通知發送失敗：{notify_result['error']}")
        else:
            print("[LINE Notify Success] LINE 通知發送成功！")

        return JSONResponse(
            content={"status": "success", "order_id": new_order.id, "total_price": total_price},
            status_code=201,
        )
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.remove(tmp_path)

@app.get("/api/orders/history")
async def get_user_orders(user_name: str, db: Session = Depends(get_db)):
    """取得特定使用者的訂單歷史"""
    if not user_name or not user_name.strip():
        raise HTTPException(status_code=400, detail="請提供姓名或學號以供查詢")
    orders = db.query(Order).filter(Order.user_name == user_name.strip()).order_by(Order.id.desc()).all()
    return orders

@app.get("/api/announcements")
async def get_active_announcements(db: Session = Depends(get_db)):
    """前台 API：取得啟用中公告"""
    announcements = db.query(Announcement).filter(Announcement.is_active == True).order_by(Announcement.id.desc()).all()
    return announcements

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
async def get_order_file(order_id: int, db: Session = Depends(get_db), username: str = Depends(authenticate_admin)):
    """給後台用的 API：串流 PDF 檔案以供下載或預覽"""
    order = db.query(Order).filter(Order.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="找不到該訂單")
    
    file_path = os.path.join(UPLOAD_DIR, f"order_{order_id}.pdf")
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="找不到該訂單的 PDF 檔案")
    
    return FileResponse(
        file_path,
        media_type="application/pdf",
        filename=order.file_name
    )

@app.get("/api/orders/{order_id}/preview")
async def preview_order_file(order_id: int, user_name: str, db: Session = Depends(get_db)):
    """前台使用者預覽 PDF 檔案，需提供正確的 user_name"""
    if not user_name or not user_name.strip():
        raise HTTPException(status_code=400, detail="請提供姓名或學號以供驗證")
    
    order = db.query(Order).filter(Order.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="找不到該訂單")
        
    if order.user_name.strip() != user_name.strip():
        raise HTTPException(status_code=403, detail="無權存取此訂單的檔案")
        
    file_path = os.path.join(UPLOAD_DIR, f"order_{order_id}.pdf")
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="找不到該訂單的 PDF 檔案")
        
    return FileResponse(
        file_path,
        media_type="application/pdf",
        filename=order.file_name,
        content_disposition_type="inline"
    )


@app.delete("/api/orders/{order_id}")
async def delete_order(order_id: int, db: Session = Depends(get_db), username: str = Depends(authenticate_admin)):
    """給後台用的 API：刪除訂單及其實體 PDF 檔案"""
    order = db.query(Order).filter(Order.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="找不到該訂單")
    
    # 刪除實體檔案
    file_path = os.path.join(UPLOAD_DIR, f"order_{order_id}.pdf")
    if os.path.exists(file_path):
        try:
            os.remove(file_path)
        except Exception as exc:
            print(f"[Error] 無法刪除檔案 {file_path}: {exc}")
            
    db.delete(order)
    db.commit()
    return {"status": "success"}
