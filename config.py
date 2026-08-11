"""
集中式應用程式設定 (Pydantic Settings)
=====================================
取代散落各處的 os.getenv 呼叫,提供型別安全、預設值與文件化的設定管理。

載入順序:
1. 系統環境變數 (最高優先)
2. 專案根目錄的 .env 檔案
3. 本檔案中定義的預設值

使用方式:
    from config import settings
    print(settings.ADMIN_USERNAME)
"""

import re
from functools import lru_cache
from typing import List
from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


_APP_BUILD_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")


def normalize_app_build_id(value: str) -> str:
    """正規化並驗證可安全用於 ``static/builds/<id>`` 的建置識別碼。"""
    normalized = value.strip()
    if normalized and not _APP_BUILD_ID_PATTERN.fullmatch(normalized):
        raise ValueError(
            "APP_BUILD_ID 僅可包含英數字、底線與連字號，且長度不可超過 64 字元"
        )
    return normalized


class Settings(BaseSettings):
    """應用程式設定,欄位名即環境變數名(大小寫不敏感)。"""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",  # 忽略 .env 中未定義的變數,避免啟動失敗
    )

    # ── 後台管理帳密 ──────────────────────────────────────────────
    ADMIN_USERNAME: str = Field(default="admin", description="後台管理員帳號")
    ADMIN_PASSWORD: str = Field(default="admin123", description="後台管理員密碼(生產環境務必經由環境變數覆寫)")

    # ── LINE Messaging API ────────────────────────────────────────
    LINE_CHANNEL_ACCESS_TOKEN: str = Field(default="", description="LINE Channel Access Token")
    LINE_RECEIVER_ID: str = Field(default="", description="LINE 接收者 User ID 或 Group ID")

    # ── 反向代理與 IP 偵測 ────────────────────────────────────────
    # 信任的反向代理 CIDR 清單(逗號分隔),例如 "127.0.0.1/32,10.0.0.0/8"
    # 空字串 = 直連模式(不信任任何 X-Forwarded-For),一律以 request.client.host 為準
    TRUSTED_PROXIES: str = Field(
        default="",
        description="信任的反向代理 CIDR 清單;留空表示直連模式",
    )

    # ── 上傳限制 ──────────────────────────────────────────────────
    MAX_UPLOAD_MB: int = Field(default=20, ge=1, le=100, description="單一檔案上傳大小上限(MB)")
    UPLOAD_DIR: str = Field(default="./uploads", description="PDF 上傳目錄")
    PDF_PARSE_CONCURRENCY: int = Field(default=1, ge=1, le=4, description="伺服器同時解析 PDF 的數量")

    # ── 資料庫 ────────────────────────────────────────────────────
    DATABASE_URL: str = Field(default="sqlite:///./db.sqlite3", description="SQLAlchemy 資料庫連線字串")

    # ── 儲存空間監控 ──────────────────────────────────────────────
    STORAGE_WARN_PERCENT: int = Field(default=80, ge=1, le=99, description="磁碟警告門檻")
    STORAGE_CRITICAL_PERCENT: int = Field(default=90, ge=2, le=100, description="磁碟嚴重警告門檻")

    # ── Rate Limiting(每 IP 每分鐘)──────────────────────────────
    RATE_LIMIT_API_PER_MIN: int = Field(default=30, ge=1, description="一般 API 端點每分鐘請求數上限")
    RATE_LIMIT_UPLOAD_PER_MIN: int = Field(default=5, ge=1, description="上傳端點每分鐘請求數上限")
    RATE_LIMIT_ADMIN_PER_MIN: int = Field(default=120, ge=1, description="管理員 API 每分鐘請求數上限(較寬鬆)")
    RATE_LIMIT_FILE_PER_MIN: int = Field(default=30, ge=1, description="檔案下載/預覽每分鐘請求數上限")

    # ── 管理員暴力破解防護 ────────────────────────────────────────
    ADMIN_MAX_LOGIN_FAILURES: int = Field(default=5, ge=1, description="連續登入失敗上限")
    ADMIN_LOCK_DURATION_MIN: int = Field(default=15, ge=1, description="鎖定持續時間(分鐘)")

    # ── 訂單清理排程 ──────────────────────────────────────────────
    ORDER_RETENTION_DAYS: int = Field(default=30, ge=1, description="已完成訂單保留天數,逾期自動清理")
    CLEANUP_INTERVAL_HOURS: int = Field(default=6, ge=1, description="自動清理排程間隔(小時)")

    # ── 分頁(預設值,可在 M2 調整)──────────────────────────────
    ORDERS_DEFAULT_PAGE_SIZE: int = Field(default=50, ge=1, le=200, description="訂單列表預設每頁筆數")
    ORDERS_MAX_PAGE_SIZE: int = Field(default=200, ge=1, description="訂單列表每頁最大筆數")

    # ── 日誌 ──────────────────────────────────────────────────────
    LOG_LEVEL: str = Field(default="INFO", description="日誌等級(DEBUG/INFO/WARNING/ERROR)")

    # ── 應用程式元資料 ────────────────────────────────────────────
    APP_VERSION: str = Field(default="2.0.0", description="應用程式版本號")
    APP_BUILD_ID: str = Field(default="", description="目前啟用的前端建置識別碼")
    BACKEND_BUILD_ID: str = Field(default="", description="實際執行中的後端 Git 建置識別碼")

    # ────────────────────────────────────────────────────────────
    #  衍生屬性(透過 property 計算,不直接來自環境變數)
    # ────────────────────────────────────────────────────────────
    @property
    def max_upload_bytes(self) -> int:
        """上傳大小上限(bytes),供 main.py 使用。"""
        return self.MAX_UPLOAD_MB * 1024 * 1024

    @property
    def trusted_proxy_networks(self) -> List[str]:
        """將 TRUSTED_PROXIES 字串切成 CIDR 清單(已去空白)。"""
        if not self.TRUSTED_PROXIES.strip():
            return []
        return [item.strip() for item in self.TRUSTED_PROXIES.split(",") if item.strip()]

    # ── 驗證器 ────────────────────────────────────────────────────
    @field_validator("LOG_LEVEL", mode="after")
    @classmethod
    def _normalize_log_level(cls, v: str) -> str:
        return v.upper()

    @field_validator("APP_BUILD_ID", "BACKEND_BUILD_ID", mode="after")
    @classmethod
    def _normalize_app_build_id(cls, value: str) -> str:
        return normalize_app_build_id(value)

    @model_validator(mode="after")
    def _validate_storage_thresholds(self):
        if self.STORAGE_CRITICAL_PERCENT <= self.STORAGE_WARN_PERCENT:
            raise ValueError("STORAGE_CRITICAL_PERCENT 必須大於 STORAGE_WARN_PERCENT")
        return self


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """取得快取後的 Settings 實例(整個應用程式生命週期共用)。"""
    return Settings()


# 全域設定實例,供直接匯入使用
settings = get_settings()
