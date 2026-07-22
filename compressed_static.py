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

import os
import mimetypes
from starlette.staticfiles import StaticFiles
from starlette.responses import FileResponse
from starlette.types import Scope

from compression import _get_file_meta, HAS_BROTLI


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
        accept_encoding = ""
        for name, value in scope.get("headers", []):
            if name == b"accept-encoding":
                accept_encoding = value.decode("latin-1")
                break

        # MIME 防護:永遠取自「原始檔名」,絕不從 .br / .gz 推斷
        # (若交給 FileResponse 自動推斷 .br 會得到 application/x-brotli → JS 拒絕執行)
        media_type = mimetypes.guess_type(full_path)[0] or "application/octet-stream"

        # 取得預壓縮檔元資料(含 mtime 快取,避免重複 os.stat)
        meta = _get_file_meta(full_path)

        # 優先 Brotli
        if (
            HAS_BROTLI
            and "br" in accept_encoding
            and meta["br_exists"]
            and meta["br_mtime"] >= meta["mtime"]
        ):
            return FileResponse(
                full_path + ".br",
                media_type=media_type,
                headers={
                    "Content-Encoding": "br",
                    "Vary": "Accept-Encoding",
                },
                stat_result=os.stat(full_path + ".br"),
            )

        # 次選 Gzip
        if (
            "gzip" in accept_encoding
            and meta["gz_exists"]
            and meta["gz_mtime"] >= meta["mtime"]
        ):
            return FileResponse(
                full_path + ".gz",
                media_type=media_type,
                headers={
                    "Content-Encoding": "gzip",
                    "Vary": "Accept-Encoding",
                },
                stat_result=os.stat(full_path + ".gz"),
            )

        # 降級:未壓縮原始檔(走原生 StaticFiles,保留其 304 / 範圍請求能力)
        return await super().get_response(path, scope)
