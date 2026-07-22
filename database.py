from sqlalchemy import create_engine, Column, Integer, String, Boolean, DateTime, Index, text, event
from sqlalchemy.orm import declarative_base, sessionmaker
from datetime import datetime, timezone, timedelta

# 快取 TZ 物件，避免每次呼叫都重新建立
_TZ_TAIPEI = timezone(timedelta(hours=8))

def get_taipei_now():
    # 取得台北時間 (UTC+8) 的 Naive Datetime，確保儲存於資料庫的為台北當地時間
    return datetime.now(_TZ_TAIPEI).replace(tzinfo=None)

# ── 連線設定 ──────────────────────────────────────────────
# SQLite 資料庫檔案會建立在同一資料夾下的 db.sqlite3
DATABASE_URL = "sqlite:///./db.sqlite3"

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False},  # SQLite 多執行緒需加此參數
    pool_size=5,
    max_overflow=10,
    # 不設 pool_pre_ping:SQLite 為本地檔案,不像 PG/MySQL 會斷線,
    # 每次借出連線都先跑 SELECT 1 探活是純 overhead,在高頻請求下累積成無謂的 DB 往返。
)

# ── SQLite 性能優化 PRAGMA（每個連線建立時自動套用）──────────────
@event.listens_for(engine, "connect")
def _set_sqlite_pragma(dbapi_conn, connection_record):
    cursor = dbapi_conn.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")        # WAL 模式：允許讀寫併發
    cursor.execute("PRAGMA synchronous=NORMAL")      # 平衡安全性與寫入速度
    cursor.execute("PRAGMA cache_size=-8000")         # 8MB 頁面快取
    cursor.execute("PRAGMA journal_size_limit=16777216")  # WAL 日誌上限 16MB
    cursor.execute("PRAGMA busy_timeout=5000")        # 鎖定等待 5 秒
    cursor.close()

# 每次需要操作資料庫時，透過 SessionLocal() 取得一個 Session
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# 所有 Model 的基底類別
Base = declarative_base()


# ── 資料表模型 ────────────────────────────────────────────
class Order(Base):
    __tablename__ = "orders"

    id          = Column(Integer, primary_key=True, autoincrement=True)
    user_name   = Column(String,  nullable=False, index=True)   # 上傳者姓名（建立索引加速查詢）
    file_name   = Column(String,  nullable=False)               # PDF 檔名
    total_pages = Column(Integer, nullable=False)               # 總頁數
    total_price = Column(Integer, nullable=False)               # 總金額（元）
    color_mode  = Column(String,  default="bw", nullable=False) # 色彩模式: bw/color
    duplex      = Column(String,  default="single", nullable=False) # 列印方式: single/double
    binding     = Column(String,  nullable=True)                # 裝訂位置
    pickup_location = Column(String, nullable=True)             # 取件地點
    is_paid     = Column(Boolean, default=False, nullable=False)    # 是否已付款
    is_printed  = Column(Boolean, default=False, nullable=False)    # 是否已列印
    display_name  = Column(String,  nullable=True)               # 顯示用檔名
    physical_path = Column(String,  nullable=True)               # 系統實體檔名
    created_at  = Column(DateTime, default=get_taipei_now)        # 訂單建立時間


class Announcement(Base):
    __tablename__ = "announcements"

    id          = Column(Integer, primary_key=True, autoincrement=True)
    content     = Column(String, nullable=False)                # 公告內容
    is_active   = Column(Boolean, default=True, nullable=False) # 是否啟用
    created_at  = Column(DateTime, default=get_taipei_now)        # 建立時間


# ── FastAPI 用的 Dependency ───────────────────────────────
def get_db():
    """
    在 FastAPI 路由中以 Depends(get_db) 注入，
    確保每個請求結束後自動關閉 Session。
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def ensure_order_columns():
    required_columns = {
        "color_mode": "ALTER TABLE orders ADD COLUMN color_mode VARCHAR NOT NULL DEFAULT 'bw'",
        "duplex": "ALTER TABLE orders ADD COLUMN duplex VARCHAR NOT NULL DEFAULT 'single'",
        "binding": "ALTER TABLE orders ADD COLUMN binding VARCHAR",
        "pickup_location": "ALTER TABLE orders ADD COLUMN pickup_location VARCHAR",
        "display_name": "ALTER TABLE orders ADD COLUMN display_name VARCHAR",
        "physical_path": "ALTER TABLE orders ADD COLUMN physical_path VARCHAR",
    }

    with engine.begin() as conn:
        existing_columns = {
            row[1] for row in conn.execute(text("PRAGMA table_info(orders)"))
        }

        for column_name, statement in required_columns.items():
            if column_name not in existing_columns:
                conn.execute(text(statement))

        # 確保 user_name 索引存在（加速歷史訂單查詢）
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_orders_user_name ON orders (user_name)"))
        # 複合索引：加速按使用者 + 建立時間排序的歷史訂單查詢
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_orders_user_created ON orders (user_name, created_at DESC)"))
        # 複合索引：加速清理任務的「已付款 + 已列印 + 超過保留天數」查詢,
        # 避免訂單累積後每次清理都要全表掃描。
        conn.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_orders_cleanup "
            "ON orders (is_paid, is_printed, created_at)"
        ))


# ── 初始化：直接執行此檔案時建立資料表 ───────────────────
if __name__ == "__main__":
    Base.metadata.create_all(bind=engine)
    print("✅ 資料表建立完成，db.sqlite3 已產生於當前目錄。")
