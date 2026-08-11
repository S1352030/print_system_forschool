#!/usr/bin/env python3
"""增量產生 Brotli/Gzip 靜態資源，並清除沒有來源檔的舊 sidecar。"""

import glob
import gzip
import os

try:
    import brotli
except ImportError:
    print("錯誤：請先安裝 brotli 套件 → pip install brotli")
    raise SystemExit(1)

_GLOB_PATTERNS = [
    "*.html",
    "*.css",
    "sw.js",
    "static/**/*.css",
    "static/**/*.js",
    "static/builds/**/*.html",
    "static/builds/**/*.mjs",
    "static/pdfjs/**/*.mjs",
    "static/pdfjs/**/*.wasm",
]

BROTLI_QUALITY = 11
GZIP_LEVEL = 9


def _collect_files() -> list[str]:
    files: set[str] = set()
    for pattern in _GLOB_PATTERNS:
        files.update(
            path
            for path in glob.glob(pattern, recursive=True)
            if os.path.isfile(path) and not path.endswith((".br", ".gz"))
        )
    return sorted(files)


def _is_current(source: str, sidecar: str) -> bool:
    return (
        os.path.isfile(sidecar)
        and os.path.getsize(sidecar) > 0
        and os.path.getmtime(sidecar) >= os.path.getmtime(source)
    )


def _atomic_write(path: str, data: bytes) -> None:
    temp_path = f"{path}.tmp"
    with open(temp_path, "wb") as output:
        output.write(data)
    os.replace(temp_path, path)


def precompress(file_path: str) -> bool:
    br_path = f"{file_path}.br"
    gz_path = f"{file_path}.gz"
    needs_br = not _is_current(file_path, br_path)
    needs_gz = not _is_current(file_path, gz_path)
    if not needs_br and not needs_gz:
        print(f"  [SKIP] {file_path}")
        return False

    with open(file_path, "rb") as source:
        original_data = source.read()
    if not original_data:
        print(f"  [WARN] {file_path} 為空檔案，跳過")
        return False

    if needs_br:
        _atomic_write(br_path, brotli.compress(original_data, quality=BROTLI_QUALITY))
    if needs_gz:
        _atomic_write(gz_path, gzip.compress(original_data, compresslevel=GZIP_LEVEL, mtime=0))
    print(f"  [UPDATE] {file_path}")
    return True


def remove_orphan_sidecars() -> int:
    sidecars = (
        glob.glob("*.br")
        + glob.glob("*.gz")
        + glob.glob("static/**/*.br", recursive=True)
        + glob.glob("static/**/*.gz", recursive=True)
    )
    removed = 0
    for sidecar in sidecars:
        source = sidecar[:-3]
        if not os.path.isfile(source):
            os.remove(sidecar)
            print(f"  [REMOVE] {sidecar}")
            removed += 1
    return removed


def main() -> None:
    removed = remove_orphan_sidecars()
    updated = sum(precompress(path) for path in _collect_files())
    print(f"[OK] 更新 {updated} 份來源，移除 {removed} 份孤兒壓縮檔。")


if __name__ == "__main__":
    main()
