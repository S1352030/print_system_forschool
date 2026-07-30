import asyncio
import io
import os
import sqlite3
import tempfile
from pathlib import Path

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

from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402
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
        assert full.headers["cache-control"] == "private, no-cache"

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
        assert root.headers["cdn-cache-control"] == "public, max-age=300"
        assert "'wasm-unsafe-eval'" in root.headers["content-security-policy"]
        assert "'unsafe-eval'" not in root.headers["content-security-policy"].replace(
            "'wasm-unsafe-eval'",
            "",
        )
        assert client.head("/").status_code == 200

        vendor = client.get("/static/pdfjs/5.7.284/build/pdf.min.mjs")
        assert vendor.status_code == 200
        assert vendor.headers["cache-control"] == "public, max-age=31536000, immutable"

        health = client.get("/health")
        assert health.status_code == 200
        assert health.json()["build_id"]
        assert health.headers["cache-control"] == "no-store"

    source_path = TEST_ROOT / "test.sqlite3"
    backup_path = TEST_ROOT / "backup.sqlite3"
    with sqlite3.connect(source_path) as source, sqlite3.connect(backup_path) as backup:
        source.backup(backup)
        assert backup.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    with engine.connect() as connection:
        assert connection.exec_driver_sql("PRAGMA journal_mode").scalar().lower() == "wal"
        assert connection.exec_driver_sql("PRAGMA busy_timeout").scalar() == 5000
        assert connection.exec_driver_sql("PRAGMA journal_size_limit").scalar() == 16_777_216
