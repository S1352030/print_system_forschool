#!/usr/bin/env python3
"""
靜態資源預先壓縮腳本（Pre-compression）

在部署前執行此腳本，為 HTML / CSS / JS 等靜態檔案產生：
  - .br  檔（Brotli Quality 11，最高壓縮率）
  - .gz  檔（Gzip Level 9，最高壓縮率）

伺服器只需根據 Accept-Encoding 標頭回傳預壓縮檔，
完全免除即時壓縮的 CPU 負擔。

用法：
    python precompress.py
"""

import os
import gzip

try:
    import brotli
except ImportError:
    print("錯誤：請先安裝 brotli 套件 → pip install brotli")
    raise SystemExit(1)

# ── 需要預壓縮的靜態檔案清單 ──────────────────────────────────
STATIC_FILES = [
    "index.html",
    "admin.html",
    "sw.js",
]

BROTLI_QUALITY = 11  # 最高壓縮率（僅部署時執行一次，不影響即時效能）
GZIP_LEVEL = 9       # 最高壓縮率


def precompress(file_path: str) -> None:
    """為單一檔案產生 .br 與 .gz 壓縮版本，並印出壓縮率報告。"""
    with open(file_path, "rb") as f:
        original_data = f.read()

    original_size = len(original_data)
    if original_size == 0:
        print(f"  [WARN] {file_path} 為空檔案，跳過")
        return

    # ── Brotli 壓縮 ──────────────────────────────────────────
    br_data = brotli.compress(original_data, quality=BROTLI_QUALITY)
    br_path = file_path + ".br"
    with open(br_path, "wb") as f:
        f.write(br_data)
    br_ratio = (1 - len(br_data) / original_size) * 100

    # ── Gzip 壓縮 ───────────────────────────────────────────
    gz_path = file_path + ".gz"
    with gzip.open(gz_path, "wb", compresslevel=GZIP_LEVEL) as f:
        f.write(original_data)
    gz_size = os.path.getsize(gz_path)
    gz_ratio = (1 - gz_size / original_size) * 100

    # ── 輸出壓縮報告 ─────────────────────────────────────────
    print(f"  [FILE] {file_path}")
    print(f"     原始大小:         {original_size:>10,} bytes")
    print(f"     Brotli (Lv{BROTLI_QUALITY:>2}):   {len(br_data):>10,} bytes  (down {br_ratio:.1f}%)")
    print(f"     Gzip   (Lv{GZIP_LEVEL}):    {gz_size:>10,} bytes  (down {gz_ratio:.1f}%)")
    print()


def main() -> None:
    print("=" * 52)
    print("  靜態資源預先壓縮  (Brotli + Gzip)")
    print("=" * 52)
    print()

    compressed_count = 0
    for file_path in STATIC_FILES:
        if os.path.exists(file_path):
            precompress(file_path)
            compressed_count += 1
        else:
            print(f"  [WARN] {file_path} 不存在，跳過\n")

    if compressed_count > 0:
        print(f"[OK] 完成！已為 {compressed_count} 個檔案產生預壓縮版本。")
        print("     伺服器將根據 Accept-Encoding 自動派發 .br 或 .gz 檔案。")
    else:
        print("[WARN] 沒有找到任何可壓縮的檔案。")


if __name__ == "__main__":
    main()
