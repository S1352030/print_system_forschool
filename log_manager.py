"""
Zstandard 日誌管理模組

提供以下功能：
1. ZstdRotatingFileHandler — 日誌輪替時自動以 Zstd 壓縮舊檔（.zst）
2. setup_logging()         — 一鍵初始化結構化日誌系統

Zstd 特性：
- 壓縮速度極快（Level 3 約為 Gzip 的 3-5 倍）
- 解壓速度業界最快
- 壓縮率與 Gzip Level 9 相當甚至更優

用法：
    from log_manager import setup_logging
    setup_logging()

    import logging
    log = logging.getLogger("print_system")
    log.info("伺服器啟動完成")
"""

import os
import logging
from logging.handlers import RotatingFileHandler

try:
    import zstandard as zstd

    HAS_ZSTD = True
except ImportError:
    HAS_ZSTD = False

# ── 預設配置 ──────────────────────────────────────────────────
LOG_DIR = "logs"
DEFAULT_LOG_FILE = "app.log"
MAX_LOG_BYTES = 5 * 1024 * 1024  # 5 MB 觸發輪替
BACKUP_COUNT = 10  # 保留最近 10 份壓縮日誌
ZSTD_LEVEL = 3  # Zstd 壓縮等級（Level 3 = 極低 CPU，優秀壓縮率）


class ZstdRotatingFileHandler(RotatingFileHandler):
    """
    自訂 RotatingFileHandler：日誌輪替時以 Zstandard 壓縮舊檔。

    輪替流程：
    1. 關閉目前的 log stream
    2. 將既有的 .zst 備份檔案依序後移（.1.zst → .2.zst → ...）
    3. 將當前 log 檔壓縮為 .1.zst
    4. 清空原始 log 檔，重新開啟 stream

    若未安裝 zstandard 套件，則退化為普通重新命名（不壓縮）。
    """

    def __init__(
        self,
        filename: str,
        maxBytes: int = 0,
        backupCount: int = 0,
        zstd_level: int = ZSTD_LEVEL,
        encoding: str | None = None,
        delay: bool = False,
    ):
        self.zstd_level = zstd_level
        super().__init__(
            filename,
            maxBytes=maxBytes,
            backupCount=backupCount,
            encoding=encoding,
            delay=delay,
        )

    def doRollover(self) -> None:
        """執行日誌輪替：壓縮 → 後移 → 重建空檔案。"""
        # 關閉目前的 stream
        if self.stream:
            self.stream.close()
            self.stream = None  # type: ignore[assignment]

        if self.backupCount > 0:
            # 刪除最舊的備份
            ext = ".zst" if HAS_ZSTD else ""
            oldest = f"{self.baseFilename}.{self.backupCount}{ext}"
            if os.path.exists(oldest):
                os.remove(oldest)

            # 依序後移既有備份：.9 → .10, .8 → .9, ...
            for i in range(self.backupCount - 1, 0, -1):
                src = f"{self.baseFilename}.{i}{ext}"
                dst = f"{self.baseFilename}.{i + 1}{ext}"
                if os.path.exists(src):
                    os.rename(src, dst)

            # 壓縮當前 log 檔為 .1.zst（或 .1）
            if (
                os.path.exists(self.baseFilename)
                and os.path.getsize(self.baseFilename) > 0
            ):
                if HAS_ZSTD:
                    dst_path = f"{self.baseFilename}.1.zst"
                    cctx = zstd.ZstdCompressor(level=self.zstd_level)
                    with open(self.baseFilename, "rb") as f_in:
                        raw_data = f_in.read()
                    compressed = cctx.compress(raw_data)
                    with open(dst_path, "wb") as f_out:
                        f_out.write(compressed)
                else:
                    # 無 zstd：僅重新命名
                    dst_path = f"{self.baseFilename}.1"
                    os.rename(self.baseFilename, dst_path)

        # 清空/建立新的空 log 檔
        if os.path.exists(self.baseFilename):
            os.remove(self.baseFilename)

        if not self.delay:
            self.stream = self._open()


def setup_logging(
    log_dir: str = LOG_DIR,
    log_filename: str = DEFAULT_LOG_FILE,
    max_bytes: int = MAX_LOG_BYTES,
    backup_count: int = BACKUP_COUNT,
    zstd_level: int = ZSTD_LEVEL,
    console_level: int = logging.INFO,
    file_level: int = logging.DEBUG,
) -> logging.Logger:
    """
    初始化應用程式日誌系統。

    同時輸出至：
    - Console（供 pm2 或 systemd 擷取 stdout）
    - 檔案（logs/app.log，達 5MB 自動輪替並以 Zstd 壓縮）

    Parameters
    ----------
    log_dir : str
        日誌目錄路徑
    log_filename : str
        日誌檔案名稱
    max_bytes : int
        單一 log 檔案的大小上限（bytes）
    backup_count : int
        保留的壓縮備份數量
    zstd_level : int
        Zstd 壓縮等級（1-22，建議 3）
    console_level : int
        Console 輸出的最低日誌等級
    file_level : int
        檔案輸出的最低日誌等級

    Returns
    -------
    logging.Logger
        設定完成的根 logger
    """
    os.makedirs(log_dir, exist_ok=True)
    log_file_path = os.path.join(log_dir, log_filename)

    # 日誌格式
    formatter = logging.Formatter(
        fmt="%(asctime)s | %(levelname)-8s | %(name)-20s | %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    root_logger = logging.getLogger()
    root_logger.setLevel(logging.DEBUG)

    # 避免重複掛載 handler（例如 uvicorn --reload 時）
    if root_logger.handlers:
        root_logger.handlers.clear()

    # ── Console Handler（pm2 stdout 擷取用）──────────────────
    console_handler = logging.StreamHandler()
    console_handler.setLevel(console_level)
    console_handler.setFormatter(formatter)
    root_logger.addHandler(console_handler)

    # ── File Handler（Zstd 壓縮輪替）─────────────────────────
    file_handler = ZstdRotatingFileHandler(
        filename=log_file_path,
        maxBytes=max_bytes,
        backupCount=backup_count,
        zstd_level=zstd_level,
    )
    file_handler.setLevel(file_level)
    file_handler.setFormatter(formatter)
    root_logger.addHandler(file_handler)

    # 首次啟動訊息
    zstd_status = f"Zstd Level {zstd_level}" if HAS_ZSTD else "未安裝 zstandard（退化為無壓縮輪替）"
    root_logger.info(
        "日誌系統初始化完成 — 輪替: %s, 上限: %s MB, 備份: %d 份, 壓縮: %s",
        log_file_path,
        max_bytes / (1024 * 1024),
        backup_count,
        zstd_status,
    )

    return root_logger
