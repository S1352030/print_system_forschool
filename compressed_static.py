"""
預壓縮靜態檔案派發 — PrecompressedStaticFiles

繼承 Starlette 的 StaticFiles,覆寫 get_response,在派發靜態檔時:
  1. 根據 Accept-Encoding 優先回傳同目錄下的 .br / .gz 預壓縮檔
  2. Content-Type 一律取自「原始檔名」(絕不從 .br / .gz 推斷),
     避免瀏覽器收到 application/x-brotli 而拒絕執行 JS
  3. 帶上 Content-Encoding 與 Vary,讓外層 BrotliGzipMiddleware 自動 pass-through

適用場景:PDF.js 等「經 precompress.py 預先產生 .br/.gz、但體積龐大」的第三方函式庫。
若客戶端不支援壓縮,或預壓縮檔不存在/過期,自動降級為原生 StaticFiles 行為。
"""

import hashlib
import os
import mimetypes
from starlette.datastructures import Headers
from starlette.staticfiles import NotModifiedResponse, StaticFiles
from starlette.responses import FileResponse, Response
from starlette.types import Scope

from compression import (
    HAS_BROTLI,
    _get_file_meta,
    _select_content_encoding,
    _usable_sidecar_stat,
)


class PrecompressedStaticFiles(StaticFiles):
    """
    能感知預壓縮檔(.br / .gz)的 StaticFiles。

    MIME 來源防護:Content-Type 永遠由「原始路徑」推斷,
    而非由 .br/.gz 副檔名推斷,避免 JS 被誤判為 brotli/octet-stream。
    """

    async def get_response(self, path: str, scope: Scope):
        full_path, stat_result = self.lookup_path(path)

        # 找不到檔案或非檔案 → 交回父類別處理(會回 404 或 directory)
        if stat_result is None or not stat_result.st_mode or not os.path.isfile(full_path):
            return await super().get_response(path, scope)

        # 解析 Accept-Encoding(scope 的 headers 是 list[tuple[bytes, bytes]])
        accept_encoding: str | None = None
        for name, value in scope.get("headers", []):
            if name == b"accept-encoding":
                accept_encoding = value.decode("latin-1")
                break

        # MIME 防護:永遠取自「原始檔名」,絕不從 .br / .gz 推斷
        # (若交給 FileResponse 自動推斷 .br 會得到 application/x-brotli → JS 拒絕執行)
        media_type = mimetypes.guess_type(full_path)[0] or "application/octet-stream"

        # 取得預壓縮檔元資料(含 mtime 快取,避免重複 os.stat)
        meta = _get_file_meta(full_path)
        br_stat = (
            _usable_sidecar_stat(full_path + ".br", meta["stat"])
            if HAS_BROTLI
            else None
        )
        gzip_stat = _usable_sidecar_stat(full_path + ".gz", meta["stat"])
        negotiated_encoding = _select_content_encoding(
            accept_encoding,
            allow_br=br_stat is not None,
            allow_gzip=gzip_stat is not None,
        )
        if negotiated_encoding is None:
            return Response(
                status_code=406,
                headers={
                    "Cache-Control": "no-store",
                    "Vary": "Accept-Encoding",
                },
            )

        # 優先 Brotli
        if negotiated_encoding == "br":
            response = FileResponse(
                full_path + ".br",
                media_type=media_type,
                headers={
                    "Content-Encoding": "br",
                    "Vary": "Accept-Encoding",
                    "ETag": self._representation_etag(br_stat, "br"),
                },
                stat_result=br_stat,
            )
            return self._conditional_response(response, scope)

        # 次選 Gzip
        if negotiated_encoding == "gzip":
            response = FileResponse(
                full_path + ".gz",
                media_type=media_type,
                headers={
                    "Content-Encoding": "gzip",
                    "Vary": "Accept-Encoding",
                    "ETag": self._representation_etag(gzip_stat, "gzip"),
                },
                stat_result=gzip_stat,
            )
            return self._conditional_response(response, scope)

        # 降級:未壓縮原始檔(走原生 StaticFiles,保留其 304 / 範圍請求能力)
        response = await super().get_response(path, scope)
        self._ensure_accept_encoding_vary(response)
        return response

    def _conditional_response(self, response: FileResponse, scope: Scope):
        """對預壓縮 representation 套用 StaticFiles 原生條件式請求邏輯。"""
        request_headers = Headers(scope=scope)
        if self.is_not_modified(response.headers, request_headers):
            return NotModifiedResponse(response.headers)
        return response

    @staticmethod
    def _ensure_accept_encoding_vary(response) -> None:
        """Identity 仍是內容協商的一種結果，必須避免與 br/gzip 共用快取。"""
        vary = response.headers.get("Vary", "")
        tokens = [token.strip() for token in vary.split(",") if token.strip()]
        if not any(token.lower() == "accept-encoding" for token in tokens):
            tokens.append("Accept-Encoding")
            response.headers["Vary"] = ", ".join(tokens)

    @staticmethod
    def _representation_etag(stat_result: os.stat_result, encoding: str) -> str:
        """把編碼納入 strong ETag，避免不同 representation 標籤碰撞。"""
        raw = f"{encoding}-{stat_result.st_mtime_ns}-{stat_result.st_size}".encode()
        return f'"{hashlib.md5(raw).hexdigest()}"'
