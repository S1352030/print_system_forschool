"""
Pydantic 請求模型(Schema)
=========================
為所有寫入端點提供型別驗證,取代舊版裸 dict 接收 payload 的寫法。

效益:
1. 自動驗證型別與必填欄位,錯誤的請求會回 422 並指出問題欄位
2. OpenAPI 文件(Swagger UI / /docs)自動產生完整 schema
3. 程式碼內嵌文件,IDE 補全與型別檢查更完整
"""

from pydantic import BaseModel, Field, field_validator


class AnnouncementCreate(BaseModel):
    """POST /api/announcements 的請求 body。"""
    content: str = Field(..., min_length=1, max_length=1000, description="公告內容(不可為空)")

    @field_validator("content")
    @classmethod
    def _strip_and_check(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("公告內容不能為空")
        return v


class AnnouncementUpdate(BaseModel):
    """PUT /api/announcements/{id} 的請求 body,兩個欄位皆為選填。"""
    content: str | None = Field(default=None, min_length=1, max_length=1000, description="新的公告內容")
    is_active: bool | None = Field(default=None, description="是否啟用")

    @field_validator("content")
    @classmethod
    def _strip_content(cls, v: str | None) -> str | None:
        if v is None:
            return None
        v = v.strip()
        if not v:
            raise ValueError("公告內容不能為空")
        return v


class OrderStatusUpdate(BaseModel):
    """PUT /api/orders/{id} 的請求 body,兩個欄位皆為選填。"""
    is_paid: bool | None = Field(default=None, description="是否已付款")
    is_printed: bool | None = Field(default=None, description="是否已列印")
