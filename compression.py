"""
壓縮模組 — Brotli 優先、Gzip 備用的雙重壓縮策略

提供兩個主要元件：

1. serve_precompressed()  靜態檔案預壓縮派發
   - 根據 Accept-Encoding 回傳 .br / .gz / 原始檔
   - 內建 ETag 條件式快取（304 Not Modified）
   - 靜態資源完全不經過動態壓縮，零 CPU 負擔

2. BrotliGzipMiddleware   ASGI 中介軟體（API 動態回應用）
   - Brotli Level 4 優先，Gzip Level 6 備用
   - 自動跳過二進位 MIME（PDF / Image / Video 等）
   - 僅壓縮 ≥ minimum_size 的文字類回應
"""

import os
import gzip
import io
import hashlib
from starlette.types import ASGIApp, Receive, Scope, Send, Message
from starlette.datastructures import MutableHeaders
from starlette.requests import Request
from starlette.responses import Response, FileResponse

try:
    import brotli
    HAS_BROTLI = True
except ImportError:
    HAS_BROTLI = False

# ── 應被壓縮的 MIME type 前綴 ─────────────────────────────────
# 只有這些類型的回應才會被動態壓縮，其餘全部 pass-through
_COMPRESSIBLE_PREFIXES = (
    "text/",
    "application/json",
    "application/javascript",
    "application/xml",
    "application/xhtml+xml",
    "application/rss+xml",
    "application/atom+xml",
    "image/svg+xml",
)


# ═══════════════════════════════════════════════════════════════
#  策略一：靜態資源預壓縮派發
# ═══════════════════════════════════════════════════════════════

def serve_precompressed(
    file_path: str,
    request: Request,
    media_type: str | None = None,
    extra_headers: dict[str, str] | None = None,
) -> Response:
    """
    根據 Accept-Encoding 派發預壓縮的靜態檔案。

    優先順序：.br → .gz → 原始檔案
    同時處理 ETag 條件式快取（If-None-Match → 304）。

    Parameters
    ----------
    file_path : str
        原始檔案路徑（例如 "index.html"）
    request : Request
        Starlette Request 物件，用於讀取 Accept-Encoding 與 If-None-Match
    media_type : str, optional
        覆寫 Content-Type（例如 "text/html"），不指定則由 FileResponse 自動推斷
    extra_headers : dict, optional
        額外的回應標頭（例如 Service-Worker-Allowed）
    """
    # ── ETag 條件式快取（基於原始檔案） ───────────────────────
    stat = os.stat(file_path)
    etag_raw = f"{stat.st_mtime}-{stat.st_size}".encode()
    etag = f'"{hashlib.md5(etag_raw).hexdigest()}"'

    if_none_match = request.headers.get("if-none-match")
    if if_none_match and if_none_match == etag:
        return Response(status_code=304, headers={"ETag": etag})

    # ── 組裝回應標頭 ─────────────────────────────────────────
    headers: dict[str, str] = {
        "Cache-Control": "public, max-age=86400",
        "ETag": etag,
        "Vary": "Accept-Encoding",
    }
    if extra_headers:
        headers.update(extra_headers)

    accept_encoding = request.headers.get("accept-encoding", "")

    # ── 優先嘗試 Brotli (.br) ────────────────────────────────
    if HAS_BROTLI and "br" in accept_encoding:
        br_path = file_path + ".br"
        if os.path.exists(br_path):
            headers["Content-Encoding"] = "br"
            return FileResponse(br_path, media_type=media_type, headers=headers)

    # ── 次選 Gzip (.gz) ─────────────────────────────────────
    if "gzip" in accept_encoding:
        gz_path = file_path + ".gz"
        if os.path.exists(gz_path):
            headers["Content-Encoding"] = "gzip"
            return FileResponse(gz_path, media_type=media_type, headers=headers)

    # ── 降級：回傳原始未壓縮檔案 ─────────────────────────────
    return FileResponse(file_path, media_type=media_type, headers=headers)


# ═══════════════════════════════════════════════════════════════
#  策略二＋動態壓縮：BrotliGzipMiddleware
# ═══════════════════════════════════════════════════════════════

class BrotliGzipMiddleware:
    """
    ASGI 中介軟體：對 API 動態回應進行 Brotli/Gzip 即時壓縮。

    行為規則：
    ✅ 壓縮：text/*、application/json 等文字類回應
    ❌ 跳過：application/pdf、image/*、video/* 等已壓縮的二進位格式
    ❌ 跳過：已有 Content-Encoding 的回應（如預壓縮靜態檔）
    ❌ 跳過：回應 body < minimum_size 的小型回應

    Parameters
    ----------
    app : ASGIApp
    minimum_size : int
        低於此位元組數的回應不壓縮（預設 500）
    brotli_quality : int
        Brotli 壓縮等級，建議 3-4（預設 4，平衡 CPU 與壓縮率）
    gzip_level : int
        Gzip 壓縮等級（預設 6，標準平衡）
    """

    def __init__(
        self,
        app: ASGIApp,
        minimum_size: int = 500,
        brotli_quality: int = 4,
        gzip_level: int = 6,
    ):
        self.app = app
        self.minimum_size = minimum_size
        self.brotli_quality = brotli_quality
        self.gzip_level = gzip_level

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        # 從 ASGI scope 解析 Accept-Encoding
        accept_encoding = ""
        for header_name, header_value in scope.get("headers", []):
            if header_name == b"accept-encoding":
                accept_encoding = header_value.decode("latin-1")
                break

        use_br = HAS_BROTLI and ("br" in accept_encoding)
        use_gzip = "gzip" in accept_encoding

        if not use_br and not use_gzip:
            # 客戶端不支援任何壓縮，直接 pass-through
            await self.app(scope, receive, send)
            return

        responder = _CompressResponder(
            app=self.app,
            use_br=use_br,
            use_gzip=use_gzip,
            minimum_size=self.minimum_size,
            brotli_quality=self.brotli_quality,
            gzip_level=self.gzip_level,
        )
        await responder(scope, receive, send)


class _CompressResponder:
    """內部類別：攔截回應 body 並依條件壓縮。"""

    def __init__(
        self,
        app: ASGIApp,
        use_br: bool,
        use_gzip: bool,
        minimum_size: int,
        brotli_quality: int,
        gzip_level: int,
    ):
        self.app = app
        self.use_br = use_br
        self.use_gzip = use_gzip
        self.minimum_size = minimum_size
        self.brotli_quality = brotli_quality
        self.gzip_level = gzip_level

        self.initial_message: Message = {}
        self.body_parts: list[bytes] = []
        self.pass_through = False
        self.decision_made = False

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        self.send = send
        await self.app(scope, receive, self._intercept_send)

    async def _intercept_send(self, message: Message) -> None:
        # ── http.response.start：暫存，等看到 body 再決定 ────
        if message["type"] == "http.response.start":
            self.initial_message = message
            return

        if message["type"] != "http.response.body":
            await self.send(message)
            return

        body = message.get("body", b"")
        more_body = message.get("more_body", False)

        # ── 首次收到 body：判斷是否需要壓縮 ────────────────
        if not self.decision_made:
            self.decision_made = True
            headers = MutableHeaders(
                raw=list(self.initial_message.get("headers", []))
            )
            content_type = headers.get("content-type", "")
            content_encoding = headers.get("content-encoding")

            # 已有 Content-Encoding（預壓縮靜態檔）→ 跳過
            if content_encoding:
                self.pass_through = True
            # 非文字類 MIME type（PDF / 圖片 / 影片等）→ 跳過
            elif not any(
                content_type.startswith(prefix) for prefix in _COMPRESSIBLE_PREFIXES
            ):
                self.pass_through = True

            if self.pass_through:
                await self.send(self.initial_message)
                await self.send(message)
                return

        # ── 已決定 pass-through 的後續 chunk ────────────────
        if self.pass_through:
            await self.send(message)
            return

        # ── 累積 body chunks（等全部到齊再一次壓縮）─────────
        self.body_parts.append(body)

        if not more_body:
            full_body = b"".join(self.body_parts)

            # Body 太小，不值得壓縮
            if len(full_body) < self.minimum_size:
                await self.send(self.initial_message)
                await self.send(
                    {"type": "http.response.body", "body": full_body}
                )
                return

            # ── 執行壓縮 ─────────────────────────────────────
            compressed, encoding = self._compress(full_body)

            headers = MutableHeaders(
                raw=list(self.initial_message.get("headers", []))
            )
            headers["Content-Encoding"] = encoding
            headers["Content-Length"] = str(len(compressed))
            headers.append("Vary", "Accept-Encoding")
            
            # 必須將修改後的 headers 寫回 initial_message 中
            self.initial_message["headers"] = headers.raw

            await self.send(self.initial_message)
            await self.send(
                {"type": "http.response.body", "body": compressed}
            )

    def _compress(self, data: bytes) -> tuple[bytes, str]:
        """壓縮資料，回傳 (壓縮後 bytes, encoding 名稱)。"""
        if self.use_br:
            return brotli.compress(data, quality=self.brotli_quality), "br"

        # Gzip 壓縮
        buf = io.BytesIO()
        with gzip.GzipFile(
            fileobj=buf, mode="wb", compresslevel=self.gzip_level
        ) as gz:
            gz.write(data)
        return buf.getvalue(), "gzip"
