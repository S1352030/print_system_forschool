import asyncio
import gzip
import io
import os
import sqlite3
import tempfile
from pathlib import Path

import brotli
import pytest
from fastapi import FastAPI, Request
from fastapi.responses import PlainTextResponse
from pypdf import PdfWriter


TEST_ROOT = Path(tempfile.mkdtemp(prefix="print-system-tests-"))
os.environ["DATABASE_URL"] = f"sqlite:///{(TEST_ROOT / 'test.sqlite3').as_posix()}"
os.environ["UPLOAD_DIR"] = str(TEST_ROOT / "uploads")
os.environ["PDF_PARSE_CONCURRENCY"] = "1"
os.environ["LINE_CHANNEL_ACCESS_TOKEN"] = ""
os.environ["LINE_RECEIVER_ID"] = ""
os.environ["ADMIN_USERNAME"] = "test-admin"
os.environ["ADMIN_PASSWORD"] = "test-password"
os.environ["TRUSTED_PROXIES"] = ""
os.environ["APP_BUILD_ID"] = ""

from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402
import precompress  # noqa: E402
from compression import (  # noqa: E402
    BrotliGzipMiddleware,
    _select_content_encoding,
    _static_file_cache,
    serve_precompressed,
)
from compressed_static import PrecompressedStaticFiles  # noqa: E402
from database import Order, SessionLocal, engine  # noqa: E402


def make_pdf(*, pages: int = 1, encrypted: bool = False) -> bytes:
    writer = PdfWriter()
    for _ in range(pages):
        writer.add_blank_page(width=595, height=842)
    if encrypted:
        writer.encrypt("secret")
    output = io.BytesIO()
    writer.write(output)
    return output.getvalue()


def count_orders() -> int:
    db = SessionLocal()
    try:
        return db.query(Order).count()
    finally:
        db.close()


def test_check_pages_validates_content_and_status_codes():
    with TestClient(main.app, raise_server_exceptions=False) as client:
        valid = client.post(
            "/api/check-pages",
            files={"file": ("a4.pdf", make_pdf(pages=2), "application/pdf")},
        )
        assert valid.status_code == 200
        assert valid.json()["pages"] == 2

        empty = client.post(
            "/api/check-pages",
            files={"file": ("empty.pdf", b"", "application/pdf")},
        )
        assert empty.status_code == 400

        wrong_extension = client.post(
            "/api/check-pages",
            files={"file": ("document.txt", make_pdf(), "application/pdf")},
        )
        assert wrong_extension.status_code == 400

        wrong_magic = client.post(
            "/api/check-pages",
            files={"file": ("fake.pdf", b"not a pdf", "application/pdf")},
        )
        assert wrong_magic.status_code == 400

        corrupt = client.post(
            "/api/check-pages",
            files={"file": ("corrupt.pdf", b"%PDF-broken", "application/pdf")},
        )
        assert corrupt.status_code == 422

        encrypted = client.post(
            "/api/check-pages",
            files={"file": ("encrypted.pdf", make_pdf(encrypted=True), "application/pdf")},
        )
        assert encrypted.status_code == 422


def test_size_limit_accepts_boundary_and_rejects_over_limit():
    with TestClient(main.app, raise_server_exceptions=False) as client:
        exact_limit = b"%PDF-" + b"x" * (main.MAX_UPLOAD_SIZE - 5)
        exact = client.post(
            "/api/check-pages",
            files={"file": ("boundary.pdf", exact_limit, "application/pdf")},
        )
        assert exact.status_code == 422

        over_limit = exact_limit + b"x"
        over = client.post(
            "/api/check-pages",
            files={"file": ("too-large.pdf", over_limit, "application/pdf")},
        )
        assert over.status_code == 413


def test_upload_is_atomic_and_range_responses_are_correct():
    upload_root = Path(main.UPLOAD_DIR)
    before_orders = count_orders()
    with TestClient(main.app, raise_server_exceptions=False) as client:
        response = client.post(
            "/api/upload",
            data={
                "user_name": "測試者",
                "color_mode": "bw",
                "duplex": "single",
                "fit_mode": "fit",
            },
            files={"file": ("中文測試.pdf", make_pdf(pages=2), "application/pdf")},
        )
        assert response.status_code == 201
        order_id = response.json()["order_id"]
        assert count_orders() == before_orders + 1
        assert len(list(upload_root.glob("*.pdf"))) >= 1
        assert not list(upload_root.glob("*.part"))

        auth = ("test-admin", "test-password")
        full = client.get(f"/api/orders/{order_id}/file", auth=auth)
        assert full.status_code == 200
        assert full.headers["accept-ranges"] == "bytes"
        assert full.headers["cache-control"] == "no-store"
        assert full.headers["cloudflare-cdn-cache-control"] == "no-store"

        partial = client.get(
            f"/api/orders/{order_id}/file",
            auth=auth,
            headers={"Range": "bytes=0-63"},
        )
        assert partial.status_code == 206
        assert partial.headers["content-range"].startswith("bytes 0-63/")
        assert len(partial.content) == 64

        invalid = client.get(
            f"/api/orders/{order_id}/file",
            auth=auth,
            headers={"Range": "bytes=999999999-"},
        )
        assert invalid.status_code == 416
        assert invalid.headers["content-range"].startswith("bytes */")


def test_database_failure_rolls_back_and_removes_final_file(monkeypatch):
    upload_root = Path(main.UPLOAD_DIR)
    before_files = set(upload_root.glob("*.pdf"))
    before_orders = count_orders()

    def fail_commit(_session):
        raise RuntimeError("forced commit failure")

    monkeypatch.setattr(main.Session, "commit", fail_commit)
    with TestClient(main.app, raise_server_exceptions=False) as client:
        response = client.post(
            "/api/upload",
            data={"user_name": "rollback", "color_mode": "bw"},
            files={"file": ("rollback.pdf", make_pdf(), "application/pdf")},
        )
    assert response.status_code == 500
    assert count_orders() == before_orders
    assert set(upload_root.glob("*.pdf")) == before_files
    assert not list(upload_root.glob("*.part"))


def test_parse_semaphore_and_stale_part_cleanup(monkeypatch):
    assert main.settings.PDF_PARSE_CONCURRENCY == 1
    assert main._PDF_PARSE_SEMAPHORE._value == 1

    active = 0
    max_active = 0

    def fake_parser(_path):
        nonlocal active, max_active
        import time

        active += 1
        max_active = max(max_active, active)
        time.sleep(0.03)
        active -= 1
        return 1

    monkeypatch.setattr(main, "_count_pdf_pages_sync", fake_parser)

    async def run_two():
        await asyncio.gather(
            main.count_pdf_pages("one.pdf"),
            main.count_pdf_pages("two.pdf"),
        )

    asyncio.run(run_two())
    assert max_active == 1

    stale = Path(main.UPLOAD_DIR) / "stale.pdf.part"
    stale.write_bytes(b"partial")
    os.utime(stale, (1, 1))
    assert main._cleanup_stale_parts_once(max_age_hours=1) == 1
    assert not stale.exists()


def test_cache_security_health_and_sqlite_settings():
    with TestClient(main.app, raise_server_exceptions=False) as client:
        root = client.get("/")
        assert root.status_code == 200
        assert root.headers["cache-control"] == "public, no-cache"
        assert root.headers["cloudflare-cdn-cache-control"] == (
            "public, max-age=3600, stale-while-revalidate=60, "
            "stale-if-error=86400"
        )
        assert root.headers["cache-tag"] == "print-app"
        assert "'wasm-unsafe-eval'" in root.headers["content-security-policy"]
        assert "'unsafe-eval'" not in root.headers["content-security-policy"].replace(
            "'wasm-unsafe-eval'",
            "",
        )
        assert "fonts.googleapis.com" not in root.headers["content-security-policy"]
        assert "fonts.gstatic.com" not in root.headers["content-security-policy"]
        assert "'sha256-Q+2UG9QqKHi6mrJXxzBhVuSuWvhvxQ9AEtwosCCqZms='" in (
            root.headers["content-security-policy"]
        )
        assert "'unsafe-inline'" not in root.headers["content-security-policy"].split(
            "style-src",
            maxsplit=1,
        )[0]
        assert client.head("/").status_code == 200

        root_with_query = client.get("/?fresh=1")
        assert root_with_query.headers["cache-control"] == "no-store"
        assert root_with_query.headers["cloudflare-cdn-cache-control"] == "no-store"
        assert "cache-tag" not in root_with_query.headers

        vendor = client.get("/static/pdfjs/5.7.284/build/pdf.min.mjs")
        assert vendor.status_code == 200
        assert vendor.headers["cache-control"] == "public, max-age=31536000, immutable"
        assert vendor.headers["cloudflare-cdn-cache-control"] == (
            "public, max-age=31536000, immutable"
        )
        vendor_with_query = client.get(
            "/static/pdfjs/5.7.284/build/pdf.min.mjs?fresh=1"
        )
        assert vendor_with_query.headers["cache-control"] == "public, no-cache"
        assert vendor_with_query.headers["cloudflare-cdn-cache-control"] == "no-store"

        legacy_asset = client.get("/static/js/app.js")
        assert legacy_asset.headers["cache-control"] == "public, no-cache"
        assert legacy_asset.headers["cloudflare-cdn-cache-control"] == "no-store"

        announcements = client.get("/api/announcements")
        assert announcements.status_code == 200
        assert announcements.headers["cache-control"] == "public, max-age=300"
        assert announcements.headers["cloudflare-cdn-cache-control"] == (
            "public, max-age=300"
        )
        assert announcements.headers["cache-tag"] == "print-announcements"

        announcements_head = client.head("/api/announcements")
        assert announcements_head.status_code == 200
        assert announcements_head.headers["cache-control"] == "public, max-age=300"
        assert announcements_head.headers["cache-tag"] == "print-announcements"

        announcement_with_query = client.get("/api/announcements?fresh=1")
        assert announcement_with_query.headers["cache-control"] == "no-store"
        assert announcement_with_query.headers["cloudflare-cdn-cache-control"] == "no-store"
        assert "cache-tag" not in announcement_with_query.headers

        announcement_with_auth = client.get(
            "/api/announcements",
            headers={"Authorization": "Bearer test"},
        )
        assert announcement_with_auth.headers["cache-control"] == "no-store"
        assert announcement_with_auth.headers["cloudflare-cdn-cache-control"] == "no-store"
        assert "cache-tag" not in announcement_with_auth.headers

        announcement_post = client.post(
            "/api/announcements",
            auth=("test-admin", "test-password"),
            json={"content": "cache contract test"},
        )
        assert announcement_post.status_code == 200
        assert announcement_post.headers["cache-control"] == "no-store"
        assert announcement_post.headers["cloudflare-cdn-cache-control"] == "no-store"
        assert "cache-tag" not in announcement_post.headers

        health = client.get("/health")
        assert health.status_code == 200
        assert health.json()["build_id"] == main.settings.APP_VERSION
        assert health.json()["frontend_build_id"] is None
        assert health.headers["cache-control"] == "no-store"
        assert health.headers["cloudflare-cdn-cache-control"] == "no-store"

        service_worker = client.get("/sw.js")
        assert service_worker.headers["cache-control"] == "no-cache"
        assert service_worker.headers["cloudflare-cdn-cache-control"] == "no-store"

        admin = client.get("/admin")
        assert admin.status_code == 401
        assert admin.headers["cache-control"] == "no-store"
        assert admin.headers["cloudflare-cdn-cache-control"] == "no-store"

        missing = client.get("/does-not-exist")
        assert missing.status_code == 404
        assert missing.headers["cache-control"] == "no-store"
        assert missing.headers["cloudflare-cdn-cache-control"] == "no-store"

    source_path = TEST_ROOT / "test.sqlite3"
    backup_path = TEST_ROOT / "backup.sqlite3"
    with sqlite3.connect(source_path) as source, sqlite3.connect(backup_path) as backup:
        source.backup(backup)
        assert backup.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    with engine.connect() as connection:
        assert connection.exec_driver_sql("PRAGMA journal_mode").scalar().lower() == "wal"
        assert connection.exec_driver_sql("PRAGMA busy_timeout").scalar() == 5000
        assert connection.exec_driver_sql("PRAGMA journal_size_limit").scalar() == 16_777_216


def test_frontend_build_validation_fail_fast_and_serving(tmp_path, monkeypatch):
    static_root = tmp_path / "static"
    build_id = "build_20260810"

    assert main._validate_frontend_build(build_id="", static_root=static_root) is None
    assert main._frontend_entry_path(
        "index.html",
        build_id="",
        static_root=static_root,
    ) == Path("index.html")

    with pytest.raises(ValueError, match="APP_BUILD_ID"):
        main._active_frontend_build_id("../escape")
    with pytest.raises(RuntimeError, match="產物不完整"):
        main._validate_frontend_build(build_id=build_id, static_root=static_root)

    monkeypatch.setattr(main, "STATIC_ROOT", static_root)
    monkeypatch.setattr(main.settings, "APP_BUILD_ID", build_id)
    monkeypatch.setattr(main.settings, "BACKEND_BUILD_ID", "backend_20260810")
    with pytest.raises(RuntimeError, match="產物不完整"):
        with TestClient(main.app):
            pass

    build_root = static_root / "builds" / build_id
    build_root.mkdir(parents=True)
    (build_root / "index.html").write_text("<h1>built frontend</h1>", encoding="utf-8")
    (build_root / "admin.html").write_text("<h1>built admin</h1>", encoding="utf-8")

    assert main._validate_frontend_build() == build_id
    with TestClient(main.app, raise_server_exceptions=False) as client:
        root = client.get("/")
        assert root.status_code == 200
        assert "built frontend" in root.text

        admin = client.get("/admin", auth=("test-admin", "test-password"))
        assert admin.status_code == 200
        assert "built admin" in admin.text
        assert admin.headers["cache-control"] == "no-store"

        health = client.get("/health")
        assert health.json()["build_id"] == "backend_20260810"
        assert health.json()["frontend_build_id"] == build_id


def test_versioned_build_cache_contract_and_error_override():
    cache_app = FastAPI()

    @cache_app.get("/static/builds/build123/app.js")
    async def built_asset():
        return PlainTextResponse("built", media_type="application/javascript")

    @cache_app.get("/static/builds/build123/missing.js")
    async def missing_built_asset():
        return PlainTextResponse("missing", status_code=404)

    cache_app.add_middleware(main.SecurityAndCacheMiddleware)
    with TestClient(cache_app) as client:
        built = client.get("/static/builds/build123/app.js")
        assert built.status_code == 200
        assert built.headers["cache-control"] == "public, max-age=31536000, immutable"
        assert built.headers["cloudflare-cdn-cache-control"] == (
            "public, max-age=31536000, immutable"
        )

        built_with_query = client.get("/static/builds/build123/app.js?fresh=1")
        assert built_with_query.status_code == 200
        assert built_with_query.headers["cache-control"] == "public, no-cache"
        assert built_with_query.headers["cloudflare-cdn-cache-control"] == "no-store"

        missing = client.get("/static/builds/build123/missing.js")
        assert missing.status_code == 404
        assert missing.headers["cache-control"] == "no-store"
        assert missing.headers["cloudflare-cdn-cache-control"] == "no-store"


def test_route_precompressed_uses_representation_specific_etags(tmp_path):
    source = tmp_path / "entry.html"
    source.write_text("<main>representation etag</main>\n" * 40, encoding="utf-8")
    assert precompress.precompress(str(source)) is True
    _static_file_cache.pop(str(source), None)

    route_app = FastAPI()

    @route_app.api_route("/", methods=["GET", "HEAD"])
    async def serve_entry(request: Request):
        return serve_precompressed(
            str(source),
            request,
            media_type="text/html; charset=utf-8",
            extra_headers={"Service-Worker-Allowed": "/"},
        )

    with TestClient(route_app) as client:
        brotli_response = client.get("/", headers={"Accept-Encoding": "br"})
        gzip_response = client.get("/", headers={"Accept-Encoding": "gzip"})
        identity_response = client.get("/", headers={"Accept-Encoding": "identity"})

        assert brotli_response.headers["content-encoding"] == "br"
        assert gzip_response.headers["content-encoding"] == "gzip"
        assert "content-encoding" not in identity_response.headers
        assert len({
            brotli_response.headers["etag"],
            gzip_response.headers["etag"],
            identity_response.headers["etag"],
        }) == 3

        brotli_cached = client.get(
            "/",
            headers={
                "Accept-Encoding": "br",
                "If-None-Match": brotli_response.headers["etag"],
            },
        )
        assert brotli_cached.status_code == 304
        assert brotli_cached.content == b""
        assert brotli_cached.headers["content-encoding"] == "br"
        assert brotli_cached.headers["vary"] == "Accept-Encoding"
        assert brotli_cached.headers["service-worker-allowed"] == "/"

        wrong_representation = client.get(
            "/",
            headers={
                "Accept-Encoding": "gzip",
                "If-None-Match": brotli_response.headers["etag"],
            },
        )
        assert wrong_representation.status_code == 200

        head_response = client.head("/", headers={"Accept-Encoding": "br"})
        assert head_response.status_code == 200
        assert head_response.content == b""

        gzip_preferred = client.get(
            "/",
            headers={"Accept-Encoding": "br;q=0.2, gzip;q=0.8"},
        )
        assert gzip_preferred.headers["content-encoding"] == "gzip"

        identity_preferred = client.get(
            "/",
            headers={"Accept-Encoding": "identity;q=1, br;q=0.1, gzip;q=0"},
        )
        assert "content-encoding" not in identity_preferred.headers

        rejected_encodings = client.get(
            "/",
            headers={"Accept-Encoding": "xbr, br;q=0, gzip;q=0"},
        )
        assert "content-encoding" not in rejected_encodings.headers

        Path(f"{source}.br").unlink()
        missing_cached_sidecar = client.get(
            "/",
            headers={"Accept-Encoding": "br, gzip;q=0"},
        )
        assert missing_cached_sidecar.status_code == 200
        assert "content-encoding" not in missing_cached_sidecar.headers

        no_representation = client.get(
            "/",
            headers={
                "Accept-Encoding": "identity;q=0, br;q=0, gzip;q=0",
            },
        )
        assert no_representation.status_code == 406
        assert no_representation.headers["cache-control"] == "no-store"
        assert no_representation.headers["vary"] == "Accept-Encoding"


@pytest.mark.parametrize(
    ("header", "expected"),
    [
        (None, "br"),
        ("", "identity"),
        ("br, gzip", "br"),
        ("br;q=0, gzip;q=1", "gzip"),
        ("br;q=0.2, gzip;q=0.8", "gzip"),
        ("xbr, gzip;q=0", "identity"),
        ("*;q=0.5, gzip;q=0", "br"),
        ("BR;Q=1", "br"),
        ("identity;q=0, br;q=0, gzip;q=0", None),
        ("*;q=0", None),
        ("*;q=0, identity;q=1", "identity"),
        ("identity;q=1, br;q=0.1, gzip;q=0", "identity"),
        ("identity;q=0.5, br;q=0.5, gzip;q=0", "br"),
    ],
)
def test_accept_encoding_negotiation_respects_tokens_and_quality(header, expected):
    assert _select_content_encoding(
        header,
        allow_br=True,
        allow_gzip=True,
    ) == expected


def test_dynamic_compression_respects_accept_encoding_quality():
    compression_app = FastAPI()

    @compression_app.get("/")
    async def large_text():
        return PlainTextResponse("compressible response " * 100)

    compression_app.add_middleware(BrotliGzipMiddleware, minimum_size=100)
    with TestClient(compression_app) as client:
        gzip_response = client.get(
            "/",
            headers={"Accept-Encoding": "br;q=0.2, gzip;q=0.8"},
        )
        assert gzip_response.headers["content-encoding"] == "gzip"

        identity_preferred = client.get(
            "/",
            headers={"Accept-Encoding": "identity;q=1, br;q=0.1, gzip;q=0"},
        )
        assert "content-encoding" not in identity_preferred.headers

        identity_response = client.get(
            "/",
            headers={"Accept-Encoding": "xbr, br;q=0, gzip;q=0"},
        )
        assert "content-encoding" not in identity_response.headers

        no_representation = client.get(
            "/",
            headers={"Accept-Encoding": "identity;q=0, br;q=0, gzip;q=0"},
        )
        assert no_representation.status_code == 406
        assert no_representation.headers["vary"] == "Accept-Encoding"


def test_precompressed_static_revalidates_each_representation_and_falls_back(tmp_path):
    source = tmp_path / "asset.js"
    source_bytes = b"export const message = 'precompressed';\n" * 20
    source.write_bytes(source_bytes)
    br_path = Path(f"{source}.br")
    gz_path = Path(f"{source}.gz")
    br_path.write_bytes(brotli.compress(source_bytes, quality=5))
    gz_path.write_bytes(gzip.compress(source_bytes, compresslevel=6, mtime=0))
    os.utime(source, (100, 100))
    os.utime(br_path, (200, 200))
    os.utime(gz_path, (201, 201))

    static_app = FastAPI()
    static_app.mount("/", PrecompressedStaticFiles(directory=tmp_path), name="assets")

    with TestClient(static_app) as client:
        brotli_first = client.get("/asset.js", headers={"Accept-Encoding": "br"})
        assert brotli_first.status_code == 200
        assert brotli_first.headers["content-encoding"] == "br"
        assert brotli_first.headers["vary"] == "Accept-Encoding"
        brotli_etag = brotli_first.headers["etag"]

        brotli_cached = client.get(
            "/asset.js",
            headers={"Accept-Encoding": "br", "If-None-Match": brotli_etag},
        )
        assert brotli_cached.status_code == 304
        assert brotli_cached.content == b""
        assert brotli_cached.headers["etag"] == brotli_etag
        assert brotli_cached.headers["vary"] == "Accept-Encoding"

        gzip_first = client.get("/asset.js", headers={"Accept-Encoding": "gzip"})
        assert gzip_first.status_code == 200
        assert gzip_first.headers["content-encoding"] == "gzip"
        gzip_etag = gzip_first.headers["etag"]
        assert gzip_etag != brotli_etag

        gzip_cached = client.get(
            "/asset.js",
            headers={"Accept-Encoding": "gzip", "If-None-Match": gzip_etag},
        )
        assert gzip_cached.status_code == 304
        assert gzip_cached.content == b""
        assert gzip_cached.headers["vary"] == "Accept-Encoding"

        identity = client.get("/asset.js", headers={"Accept-Encoding": "identity"})
        assert identity.headers["vary"] == "Accept-Encoding"
        assert len({brotli_etag, gzip_etag, identity.headers["etag"]}) == 3
        identity_cached = client.get(
            "/asset.js",
            headers={
                "Accept-Encoding": "identity",
                "If-None-Match": identity.headers["etag"],
            },
        )
        assert identity_cached.status_code == 304
        assert identity_cached.headers["vary"] == "Accept-Encoding"

        quality_zero = client.get(
            "/asset.js",
            headers={"Accept-Encoding": "xbr, br;q=0, gzip;q=0"},
        )
        assert "content-encoding" not in quality_zero.headers

        no_representation = client.get(
            "/asset.js",
            headers={"Accept-Encoding": "identity;q=0, br;q=0, gzip;q=0"},
        )
        assert no_representation.status_code == 406
        assert no_representation.headers["cache-control"] == "no-store"
        assert no_representation.headers["vary"] == "Accept-Encoding"

        head = client.head("/asset.js", headers={"Accept-Encoding": "br"})
        assert head.status_code == 200
        assert head.content == b""

        br_path.unlink()
        missing_cached_sidecar = client.get(
            "/asset.js",
            headers={"Accept-Encoding": "br, gzip;q=0"},
        )
        assert missing_cached_sidecar.status_code == 200
        assert "content-encoding" not in missing_cached_sidecar.headers

        os.utime(source, (300, 300))
        stale_sidecar = client.get("/asset.js", headers={"Accept-Encoding": "br"})
        assert stale_sidecar.status_code == 200
        assert "content-encoding" not in stale_sidecar.headers
        assert stale_sidecar.headers["vary"] == "Accept-Encoding"


def test_precompress_collects_build_entries_modules_and_pdfjs_wasm(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    build_root = tmp_path / "static" / "builds" / "build123"
    build_root.mkdir(parents=True)
    (build_root / "index.html").write_text("<h1>index</h1>", encoding="utf-8")
    (build_root / "admin.html").write_text("<h1>admin</h1>", encoding="utf-8")
    (build_root / "app.js").write_text("export const app = true;", encoding="utf-8")
    (build_root / "chunk.mjs").write_text("export const chunk = true;", encoding="utf-8")
    (build_root / "app.css").write_text("body { color: black; }", encoding="utf-8")

    wasm_path = tmp_path / "static" / "pdfjs" / "5.7.284" / "wasm" / "codec.wasm"
    wasm_path.parent.mkdir(parents=True)
    wasm_path.write_bytes(b"\x00asm" + b"x" * 128)

    collected = {Path(path).as_posix() for path in precompress._collect_files()}
    assert {
        "static/builds/build123/index.html",
        "static/builds/build123/admin.html",
        "static/builds/build123/app.js",
        "static/builds/build123/chunk.mjs",
        "static/builds/build123/app.css",
        "static/pdfjs/5.7.284/wasm/codec.wasm",
    } <= collected

    assert precompress.precompress(str(wasm_path)) is True
    br_sidecar = Path(f"{wasm_path}.br")
    gz_sidecar = Path(f"{wasm_path}.gz")
    assert br_sidecar.is_file()
    assert gz_sidecar.is_file()
    assert brotli.decompress(br_sidecar.read_bytes()) == wasm_path.read_bytes()
    assert gzip.decompress(gz_sidecar.read_bytes()) == wasm_path.read_bytes()
