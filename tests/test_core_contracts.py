"""Core regressions against an isolated application, never production data."""
import asyncio
import json
from pathlib import Path

import pytest
from starlette.requests import Request

# Reuse the existing import-time isolation before importing application models.
from test_pdf_pipeline import main, make_pdf, TestClient
from database import Base, Order, Announcement, GiftCard, GiftCardTransaction, OperationReceipt, SessionLocal

AUTH = ("test-admin", "test-password")


def current_contracts():
    """Compare behavior-relevant schema, leaving prose/operation names editable."""
    prose = {"description", "summary", "title", "operationId", "example", "examples"}

    def normalize(value):
        if isinstance(value, dict):
            return {key: normalize(item) for key, item in value.items() if key not in prose}
        if isinstance(value, list):
            return [normalize(item) for item in value]
        return value

    api = main.app.openapi()
    tables = {}
    for table in Base.metadata.sorted_tables:
        tables[table.name] = {
            "columns": {
                column.name: {"type": str(column.type), "nullable": column.nullable,
                    "primary_key": column.primary_key,
                    "default": None if column.default is None else
                        "callable" if column.default.is_callable else column.default.arg}
                for column in table.columns
            },
            "constraints": sorted([
                {"kind": type(c).__name__, "columns": [col.name for col in c.columns],
                 "expression": str(c.sqltext) if hasattr(c, "sqltext") else None}
                for c in table.constraints
            ], key=lambda item: json.dumps(item, sort_keys=True)),
            "indexes": sorted([
                {"name": index.name, "unique": index.unique,
                 "columns": [str(expression) for expression in index.expressions]}
                for index in table.indexes
            ], key=lambda item: item["name"]),
        }
    return {"paths": normalize(api["paths"]), "components": normalize(api["components"]), "tables": tables}


def test_public_api_and_database_contracts_remain_compatible():
    expected = json.loads((Path(__file__).parent / "fixtures/contracts.json").read_text(encoding="utf-8"))
    assert current_contracts() == expected, (
        "API or database contract drifted. Update the OpenSpec requirement and review compatibility "
        "before changing this baseline; do not refresh it to bypass a regression."
    )


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(main, "rate_limiter", main.RateLimiter())
    monkeypatch.setattr(main, "_PDF_PARSE_SEMAPHORE", asyncio.Semaphore(1))
    with SessionLocal() as db:
        for model in [GiftCardTransaction, GiftCard, OperationReceipt, Order, Announcement]:
            db.query(model).delete()
        db.commit()
    with TestClient(main.app, raise_server_exceptions=False) as client:
        yield client


@pytest.mark.parametrize("method,path,body", [
    ("GET", "/admin", None), ("GET", "/api/orders", None),
    ("PUT", "/api/orders/1", {"is_printed": True}), ("DELETE", "/api/orders/1", None),
    ("GET", "/api/orders/1/file", None), ("GET", "/api/admin/announcements", None),
    ("POST", "/api/announcements", {"content": "unauthorized"}),
    ("PUT", "/api/announcements/1", {"is_active": False}), ("DELETE", "/api/announcements/1", None),
    ("GET", "/api/admin/gift-cards", None), ("GET", "/api/admin/gift-cards/1", None),
    ("POST", "/api/admin/gift-cards/search", {"search": ""}),
    ("PUT", "/api/admin/gift-cards/1", {"is_active": False}),
    ("POST", "/api/admin/orders/1/payment", {"cash_received": 5, "request_id": "00000000-0000-4000-8000-000000000001"}),
    ("POST", "/api/admin/orders/1/cancel", {"request_id": "00000000-0000-4000-8000-000000000001"}),
])
def test_all_administrative_operations_require_authentication(client, method, path, body):
    response = client.request(method, path, **({"json": body} if body is not None else {}))
    assert response.status_code == 401
    assert response.headers["www-authenticate"] == "Basic"
    assert response.headers["cache-control"] == "no-store"


def test_login_failure_lock_and_recovery_preserve_security(client, monkeypatch):
    maximum = main.settings.ADMIN_MAX_LOGIN_FAILURES
    for attempt in range(maximum):
        response = client.get("/admin", auth=(AUTH[0], "incorrect"))
        assert response.status_code == (423 if attempt == maximum - 1 else 401)
    blocked = client.get("/admin", auth=AUTH)
    assert blocked.status_code == 423
    assert int(blocked.headers["retry-after"]) == main.settings.ADMIN_LOCK_DURATION_MIN * 60
    now = main.time.monotonic()
    monkeypatch.setattr(main.time, "monotonic", lambda: now + main.settings.ADMIN_LOCK_DURATION_MIN * 60 + 1)
    assert client.get("/admin", auth=AUTH).status_code == 200


def test_announcements_crud_visibility_and_validation(client):
    for content in ["", "   ", "x" * 1001]:
        assert client.post("/api/announcements", auth=AUTH, json={"content": content}).status_code == 422
    created = client.post("/api/announcements", auth=AUTH, json={"content": "  開放列印  "})
    assert created.status_code == 200
    assert created.json()["content"] == "開放列印"
    announcement_id = created.json()["id"]
    public = client.get("/api/announcements")
    assert [item["id"] for item in public.json()] == [announcement_id]
    assert public.headers["cache-control"] == "public, max-age=300"
    assert client.put(f"/api/announcements/{announcement_id}", auth=AUTH,
                      json={"is_active": False, "content": " 暫停收件 "}).status_code == 200
    assert client.get("/api/announcements").json() == []
    private = client.get("/api/admin/announcements", auth=AUTH)
    assert private.json()[0]["content"] == "暫停收件"
    assert private.headers["cache-control"] == "no-store"
    assert client.delete(f"/api/announcements/{announcement_id}", auth=AUTH).status_code == 200
    assert client.delete(f"/api/announcements/{announcement_id}", auth=AUTH).status_code == 404


def test_order_pagination_legacy_shape_and_private_fields(client):
    with SessionLocal() as db:
        db.add_all([Order(user_name="page-user", file_name=f"{i}.pdf", total_pages=1, total_price=1,
                         fit_mode="cover", gift_card_discount=0) for i in range(205)])
        db.add(Order(user_name="another-user", file_name="private.pdf", total_pages=1, total_price=1))
        db.commit()
    legacy = client.get("/api/orders/history?user_name=page-user")
    assert isinstance(legacy.json(), list) and len(legacy.json()) == 200
    assert "X-Deprecation-Warning" in legacy.headers
    paged = client.get("/api/orders/history?user_name=page-user&page=2&page_size=50").json()
    assert (paged["total"], paged["page"], paged["page_size"], paged["total_pages"]) == (205, 2, 50, 5)
    assert len(paged["items"]) == 50
    assert all(item["fit_mode"] == "cover" and item["amount_due"] == 1 for item in paged["items"])
    assert all(not ({"finance_key", "physical_path", "gift_card_id", "cash_received"} & item.keys()) for item in paged["items"])
    capped = client.get("/api/orders?page=1&page_size=9999", auth=AUTH)
    assert capped.json()["page_size"] == 200
    assert capped.json()["total"] == 206
    assert "finance_key" not in capped.json()["items"][0]
    assert client.get("/api/orders/history?user_name=page-user&page=0").status_code == 422


def test_admin_order_summary_counts_all_pages_and_search_filters_items(client):
    with SessionLocal() as db:
        db.add_all([Order(user_name="王同學", file_name=f"{i}.pdf", total_pages=2, total_price=4,
                         gift_card_discount=1) for i in range(59)])
        db.add(Order(user_name="李同學", file_name="lee.pdf", total_pages=2, total_price=4, gift_card_discount=1))
        db.add(Order(user_name="已完成", file_name="done.pdf", total_pages=9, total_price=9,
                     is_paid=True, is_printed=True))
        db.add(Order(user_name="已取消", file_name="void.pdf", total_pages=5, total_price=5, is_cancelled=True))
        db.add(Order(user_name="全額折抵%", file_name="free.pdf", total_pages=1, total_price=2, gift_card_discount=5))
        db.commit()
        target_id = db.query(Order.id).filter(Order.user_name == "李同學").scalar()
    page = client.get("/api/orders?page=1&page_size=50", auth=AUTH).json()
    assert len(page["items"]) == 50 and page["total"] == 63
    assert page["summary"] == {"unpaid_count": 61, "unpaid_amount": 60 * 3,
                               "unprinted_count": 61, "unprinted_pages": 60 * 2 + 1}
    named = client.get("/api/orders?page=1&page_size=50&search=%20王%20", auth=AUTH).json()
    assert named["total"] == 59 and all(item["user_name"] == "王同學" for item in named["items"])
    assert named["summary"] == page["summary"]
    by_id = client.get(f"/api/orders?page=1&search={target_id}", auth=AUTH).json()
    assert [item["id"] for item in by_id["items"]] == [target_id]
    wildcard = client.get("/api/orders?page=1&search=%25", auth=AUTH).json()
    assert [item["user_name"] for item in wildcard["items"]] == ["全額折抵%"]
    assert client.get("/api/orders?page=1&search=" + "x" * 65, auth=AUTH).status_code == 422
    legacy = client.get("/api/orders?search=王", auth=AUTH).json()
    assert isinstance(legacy, list) and len(legacy) == 63


@pytest.mark.parametrize("color,price", [("bw", 3), ("color", 6)])
def test_actual_pdf_pricing_options_and_owner_preview(client, color, price):
    pdf = make_pdf(pages=3)
    response = client.post("/api/upload", data={"user_name": "owner", "color_mode": color,
        "duplex": "double", "fit_mode": "cover", "binding": "左上", "pickup_location": "明天下午"},
        files={"file": ("order.pdf", pdf, "application/pdf")})
    assert response.status_code == 201
    assert response.json()["total_price"] == response.json()["amount_due"] == price
    order_id = response.json()["order_id"]
    history = client.get("/api/orders/history?user_name=owner&page=1").json()["items"][0]
    assert (history["total_pages"], history["duplex"], history["fit_mode"], history["binding"]) == (3, "double", "cover", "左上")
    assert client.get(f"/api/orders/{order_id}/preview?user_name=other").status_code == 403
    preview = client.get(f"/api/orders/{order_id}/preview?user_name=owner", headers={"Range": "bytes=0-9"})
    assert preview.status_code == 206 and preview.content == pdf[:10]
    assert preview.headers["cache-control"] == "no-store"


def test_public_api_rate_limit_and_untrusted_forwarded_ip(client, monkeypatch):
    # Endpoint limits are captured when its dependency is constructed at startup.
    for _ in range(main.settings.RATE_LIMIT_API_PER_MIN):
        assert client.get("/api/announcements").status_code == 200
    limited = client.get("/api/announcements")
    assert limited.status_code == 429 and limited.headers["retry-after"] == "60"
    assert limited.headers["cache-control"] == "no-store"
    request = Request({"type": "http", "headers": [(b"x-forwarded-for", b"1.2.3.4")],
                       "client": ("203.0.113.42", 1000)})
    assert main._get_client_ip(request) == "203.0.113.42"
