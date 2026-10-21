"""Generate sidecars only inside a newly created QA build; no orphan cleanup."""
import gzip
from pathlib import Path
import sys

import brotli

build = Path(sys.argv[1]).resolve()
build_root = (Path(__file__).resolve().parent.parent / "static/builds").resolve()
if build.parent != build_root or not build.name.startswith("qa-") or build.is_symlink():
    raise SystemExit("Refusing a non-QA build directory")
count = 0
for path in sorted(build.rglob("*")):
    if path.is_file() and path.suffix in {".html", ".css", ".js", ".mjs"}:
        if path.is_symlink() or not path.resolve().is_relative_to(build):
            raise SystemExit("Refusing build symlink")
        data = path.read_bytes()
        Path(str(path) + ".br").write_bytes(brotli.compress(data, quality=11))
        Path(str(path) + ".gz").write_bytes(gzip.compress(data, compresslevel=9, mtime=0))
        count += 1
print(f"Precompressed {count} QA build assets.")
