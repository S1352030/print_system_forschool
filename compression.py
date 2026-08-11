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
import stat as stat_module
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

# ── 靜態檔案元資料快取（啟動時載入，避免每次請求都呼叫 os.stat）───
_static_file_cache: dict[str, dict] = {}


def _parse_accept_encoding(header_value: str | None) -> dict[str, float]:
    """解析 Accept-Encoding，重複 token 採最高合法 q 值。"""
    if header_value is None:
        # RFC 9110 §12.5.3：欄位不存在代表任何 content-coding 都可接受。
        return {"*": 1.0}
    qualities: dict[str, float] = {}
    for member in header_value.split(","):
        parts = [part.strip() for part in member.split(";")]
        token = parts[0].lower()
        if not token:
            continue
        quality = 1.0
        for parameter in parts[1:]:
            name, separator, value = parameter.partition("=")
            if separator and name.strip().lower() == "q":
                try:
                    parsed = float(value.strip())
                    quality = parsed if 0.0 <= parsed <= 1.0 else 0.0
                except ValueError:
                    quality = 0.0
                break
        qualities[token] = max(qualities.get(token, 0.0), quality)
    return qualities


def _encoding_quality(qualities: dict[str, float], encoding: str) -> float:
    """明確 content-coding 優先於 wildcard。"""
    if encoding in qualities:
        return qualities[encoding]
    return qualities.get("*", 0.0)


def _identity_is_acceptable(qualities: dict[str, float]) -> bool:
    """Identity 預設可接受；identity;q=0 或未覆寫的 *;q=0 才禁止。"""
    if "identity" in qualities:
        return qualities["identity"] > 0
    if "*" in qualities:
        return qualities["*"] > 0
    return True


def _select_content_encoding(
    header_value: str | None,
    *,
    allow_br: bool,
    allow_gzip: bool,
) -> str | None:
    """回傳 br/gzip/identity；沒有可接受 representation 時回傳 None。"""
    qualities = _parse_accept_encoding(header_value)
    candidates: list[tuple[float, int, str]] = []
    if allow_br:
        candidates.append((_encoding_quality(qualities, "br"), 1, "br"))
    if allow_gzip:
        candidates.append((_encoding_quality(qualities, "gzip"), 0, "gzip"))
    if "identity" in qualities:
        candidates.append((qualities["identity"], -1, "identity"))
    acceptable = [candidate for candidate in candidates if candidate[0] > 0]
    selected = max(acceptable, default=None)
    if selected:
        return selected[2]
    return "identity" if _identity_is_acceptable(qualities) else None


def _etag_from_stat(stat_result: os.stat_result, representation: str) -> str:
    """依實際傳送的 representation 產生 strong ETag。"""
    etag_raw = (
        f"{representation}-{stat_result.st_mtime_ns}-{stat_result.st_size}"
    ).encode()
    return f'"{hashlib.md5(etag_raw).hexdigest()}"'


def _if_none_match_matches(header_value: str | None, etag: str) -> bool:
    """GET/HEAD 的 If-None-Match 使用 weak comparison，並支援標籤清單。"""
    if not header_value:
        return False
    for candidate in header_value.split(","):
        normalized = candidate.strip()
        if normalized == "*":
            return True
        if normalized.startswith("W/"):
            normalized = normalized[2:].strip()
        if normalized == etag:
            return True
    return False


def _get_file_meta(file_path: str) -> dict:
    """取得檔案元資料，快取以避免重複 os.stat 呼叫。"""
    cached = _static_file_cache.get(file_path)
    if cached:
        try:
            current_stat = os.stat(file_path)
            # 來源的奈秒 mtime 與大小都未變時才重用快取。
            if (
                current_stat.st_mtime_ns == cached["stat"].st_mtime_ns
                and current_stat.st_size == cached["stat"].st_size
            ):
                return cached
        except OSError:
            pass
    # 重新讀取
    stat = os.stat(file_path)
    meta = {"stat": stat}
    _static_file_cache[file_path] = meta
    return meta


def _usable_sidecar_stat(
    sidecar_path: str,
    source_stat: os.stat_result,
) -> os.stat_result | None:
    """即時確認 sidecar 仍存在、是一般檔案且不早於來源。"""
    try:
        sidecar_stat = os.stat(sidecar_path)
    except OSError:
        return None
    if not stat_module.S_ISREG(sidecar_stat.st_mode):
        return None
    if sidecar_stat.st_mtime_ns < source_stat.st_mtime_ns:
        return None
    return sidecar_stat


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
    # ── 先完成內容協商，再依實際 representation 產生 ETag ─────────
    meta = _get_file_meta(file_path)
    accept_encoding = request.headers.get("accept-encoding")
    selected_path = file_path
    selected_stat = meta["stat"]
    content_encoding: str | None = None
    br_stat = (
        _usable_sidecar_stat(file_path + ".br", meta["stat"])
        if HAS_BROTLI
        else None
    )
    gzip_stat = _usable_sidecar_stat(file_path + ".gz", meta["stat"])
    negotiated_encoding = _select_content_encoding(
        accept_encoding,
        allow_br=br_stat is not None,
        allow_gzip=gzip_stat is not None,
    )
    if negotiated_encoding is None:
        not_acceptable_headers = {
            "Cache-Control": "no-store",
            "Vary": "Accept-Encoding",
        }
        if extra_headers:
            not_acceptable_headers.update(extra_headers)
        return Response(status_code=406, headers=not_acceptable_headers)

    if negotiated_encoding == "br":
        selected_path = file_path + ".br"
        selected_stat = br_stat
        content_encoding = "br"
    elif negotiated_encoding == "gzip":
        selected_path = file_path + ".gz"
        selected_stat = gzip_stat
        content_encoding = "gzip"

    etag = _etag_from_stat(selected_stat, content_encoding or "identity")

    # ── 組裝回應標頭 ─────────────────────────────────────────
    headers: dict[str, str] = {
        "Cache-Control": "no-cache",  # 改為 no-cache，讓瀏覽器每次都用 ETag 詢問，解決 F5 緩存不更新問題
        "ETag": etag,
        "Vary": "Accept-Encoding",
    }
    if extra_headers:
        headers.update(extra_headers)
    if content_encoding:
        headers["Content-Encoding"] = content_encoding

    if _if_none_match_matches(request.headers.get("if-none-match"), etag):
        return Response(status_code=304, headers=headers)

    return FileResponse(
        selected_path,
        media_type=media_type,
        headers=headers,
        stat_result=selected_stat,
    )


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
        accept_encoding: str | None = None
        for header_name, header_value in scope.get("headers", []):
            if header_name == b"accept-encoding":
                accept_encoding = header_value.decode("latin-1")
                break

        negotiated_encoding = _select_content_encoding(
            accept_encoding,
            allow_br=HAS_BROTLI,
            allow_gzip=True,
        )
        if negotiated_encoding is None:
            response = Response(
                status_code=406,
                headers={
                    "Cache-Control": "no-store",
                    "Vary": "Accept-Encoding",
                },
            )
            await response(scope, receive, send)
            return
        use_br = negotiated_encoding == "br"
        use_gzip = negotiated_encoding == "gzip"

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
