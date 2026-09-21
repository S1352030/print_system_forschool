"""使用獨立測試資料庫驗證收款、折抵、退款及並行交易。"""
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
import asyncio
import json
import uuid

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

# 共用既有測試啟動設定；在匯入 main 前已將資料庫及 PDF 路徑隔離。
from test_pdf_pipeline import main, make_pdf, TestClient
from database import (GiftCard, GiftCardTransaction, OperationReceipt, Order,
                      SessionLocal, ensure_order_columns, get_taipei_now)

AUTH = ("test-admin", "test-password")


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(main.rate_limiter, "is_allowed", lambda *args: True)
    # 每個 TestClient 擁有自己的事件迴圈，不共用前一次並行測試綁定的 semaphore。
    monkeypatch.setattr(main, "_PDF_PARSE_SEMAPHORE", asyncio.Semaphore(1))
    with SessionLocal() as db:
        for model in [GiftCardTransaction, GiftCard, OperationReceipt, Order]:
            db.query(model).delete()
        db.commit()
    with TestClient(main.app, raise_server_exceptions=False) as test_client:
        yield test_client


def upload(client, pages=3, code=None, discount=0, request_id=None, pdf=None):
    data = {"user_name": "禮物卡測試", "pickup_location": "明天中午",
            "request_id": request_id or str(uuid.uuid4())}
    if code:
        data.update(gift_card_code=code, expected_discount=str(discount))
    return client.post("/api/upload", data=data,
        files={"file": ("print.pdf", pdf if pdf is not None else make_pdf(pages=pages), "application/pdf")})


def payment(client, order_id, cash, request_id=None):
    return client.post(f"/api/admin/orders/{order_id}/payment", auth=AUTH,
        json={"cash_received": cash, "request_id": request_id or str(uuid.uuid4()), "note": "多付補償"})


def issue(client, amount=2):
    order_id = upload(client).json()["order_id"]
    response = payment(client, order_id, 3 + amount)
    assert response.status_code == 200, response.text
    return response.json()["gift_card"]


def balance(client, code):
    return client.post("/api/gift-cards/check", json={"code": code}).json()["balance"]


def cancel(client, order_id, request_id=None):
    return client.post(f"/api/admin/orders/{order_id}/cancel", auth=AUTH,
                       json={"request_id": request_id or str(uuid.uuid4())})


def test_collect_cash_auto_issues_only_the_extra_once(client):
    order = upload(client).json()
    key = str(uuid.uuid4())
    result = payment(client, order["order_id"], 5, key)
    assert result.status_code == 200
    card = result.json()["gift_card"]
    assert card["balance"] == 2
    assert payment(client, order["order_id"], 5, key).json() == result.json()
    assert payment(client, order["order_id"], 5).status_code == 409
    assert payment(client, order["order_id"], 6, key).status_code == 409
    assert client.get("/api/admin/gift-cards", auth=AUTH).json()["total"] == 1
    assert result.headers["cache-control"] == "no-store"


def test_exact_payment_underpayment_and_invalid_amounts(client):
    order_id = upload(client).json()["order_id"]
    assert payment(client, order_id, 2).status_code == 400
    for cash in [-1, 2.5, True, "5", 1000001]:
        assert payment(client, order_id, cash).status_code == 422
    result = payment(client, order_id, 3)
    assert result.status_code == 200
    assert result.json()["gift_card"] is None
    assert client.get("/api/admin/gift-cards", auth=AUTH).json()["total"] == 0


def test_partial_credit_then_cash_uses_net_due(client):
    card = issue(client)
    response = upload(client, pages=5, code=card["code"], discount=2)
    assert response.status_code == 201, response.text
    order = response.json()
    assert (order["total_price"], order["gift_card_discount"], order["amount_due"]) == (5, 2, 3)
    assert balance(client, card["code"]) == 0
    result = payment(client, order["order_id"], 5).json()
    assert result["gift_card"]["balance"] == 2  # 5 元實收減 3 元應付
    history = client.get("/api/orders/history", params={"user_name": "禮物卡測試"}).json()
    item = next(row for row in history if row["id"] == order["order_id"])
    assert item["amount_due"] == 3
    assert item["is_paid"]
    assert card["code"] not in json.dumps(history)
    assert "finance_key" not in item and "note" not in item
    cancelled = cancel(client, order["order_id"]).json()
    assert cancelled["refunded"] == 2
    assert cancelled["cash_refund_due"] == 3
    assert balance(client, card["code"]) == 2
    assert balance(client, result["gift_card"]["code"]) == 2


def test_reusable_balance_full_payment_and_upload_replay(client):
    card = issue(client, 5)
    key = str(uuid.uuid4())
    pdf = make_pdf(pages=3)
    response = upload(client, code=card["code"].lower().replace("-", " "), discount=3, request_id=key, pdf=pdf)
    assert response.status_code == 201
    first = response.json()
    assert first["amount_due"] == 0
    assert balance(client, card["code"]) == 2
    retried = upload(client, code=card["code"], discount=3, request_id=key, pdf=pdf)
    assert retried.json() == first
    assert balance(client, card["code"]) == 2
    assert upload(client, pages=4, code=card["code"], discount=3, request_id=key).status_code == 409
    with SessionLocal() as db:
        assert db.get(Order, first["order_id"]).is_paid
    assert client.put(f'/api/orders/{first["order_id"]}', auth=AUTH, json={"is_paid": False}).status_code == 409
    next_order = upload(client, pages=4, code=card["code"], discount=2).json()
    assert next_order["amount_due"] == 2 and next_order["gift_card_balance"] == 0


def test_stale_quote_invalid_pdf_and_disabled_cards_do_not_charge(client):
    card = issue(client, 5)
    with SessionLocal() as db:
        before = db.query(Order).count()
    assert upload(client, pages=3, code=card["code"], discount=2).status_code == 409
    assert upload(client, code=card["code"], discount=3, pdf=b"%PDF-corrupt").status_code == 422
    assert upload(client, code="INVALID", discount=3).status_code == 400
    assert balance(client, card["code"]) == 5
    assert client.put(f'/api/admin/gift-cards/{card["id"]}', auth=AUTH, json={"is_active": False}).status_code == 200
    assert upload(client, code=card["code"], discount=3).status_code == 409
    with SessionLocal() as db:
        assert db.query(Order).count() == before
        assert db.get(GiftCard, card["id"]).balance == 5


def test_cancel_refunds_once_including_disabled_card(client):
    card = issue(client, 5)
    order = upload(client, code=card["code"], discount=3).json()
    client.put(f'/api/admin/gift-cards/{card["id"]}', auth=AUTH, json={"is_active": False})
    key = str(uuid.uuid4())
    response = cancel(client, order["order_id"], key)
    assert response.status_code == 200
    assert response.json()["refunded"] == 3
    assert cancel(client, order["order_id"], key).json() == response.json()
    assert cancel(client, order["order_id"]).json()["refunded"] == 0
    assert client.put(f'/api/orders/{order["order_id"]}', auth=AUTH, json={"is_printed": True}).status_code == 409
    assert payment(client, order["order_id"], 3).status_code == 409
    detail = client.get(f'/api/admin/gift-cards/{card["id"]}', auth=AUTH).json()
    assert detail["card"]["balance"] == 5
    assert [row["kind"] for row in detail["items"]] == ["refund", "redeem", "issue"]
    assert not detail["card"]["is_active"]


def test_printed_cannot_cancel_delete_and_cleanup_preserve_ledger(client):
    card = issue(client, 5)
    order = upload(client, code=card["code"], discount=3).json()
    client.put(f'/api/orders/{order["order_id"]}', auth=AUTH, json={"is_printed": True})
    assert cancel(client, order["order_id"]).status_code == 409
    with SessionLocal() as db:
        stored = db.get(Order, order["order_id"])
        stored.created_at = get_taipei_now() - timedelta(days=main.settings.ORDER_RETENTION_DAYS + 1)
        db.commit()
    assert main._cleanup_old_orders_once() == 1
    assert balance(client, card["code"]) == 2
    assert client.delete(f'/api/orders/{card["source_order_id"]}', auth=AUTH).status_code == 200
    detail = client.get(f'/api/admin/gift-cards/{card["id"]}', auth=AUTH).json()
    assert len(detail["items"]) == 2
    assert detail["items"][0]["order_summary"] == "禮物卡測試／print.pdf"


def test_admin_auth_search_and_public_validation(client):
    card = issue(client)
    assert client.get("/api/admin/gift-cards").status_code == 401
    assert client.get(f'/api/admin/gift-cards/{card["id"]}').status_code == 401
    assert client.post('/api/admin/gift-cards/search', json={}).status_code == 401
    assert client.put(f'/api/admin/gift-cards/{card["id"]}', json={"is_active": False}).status_code == 401
    assert client.post(f'/api/admin/orders/{card["source_order_id"]}/payment', json={"cash_received": 10, "request_id": str(uuid.uuid4())}).status_code == 401
    assert client.post(f'/api/admin/orders/{card["source_order_id"]}/cancel', json={"request_id": str(uuid.uuid4())}).status_code == 401
    response = client.post('/api/gift-cards/check', json={"code": card["code"]})
    assert response.json() == {"balance": 2, "is_active": True}
    assert response.headers['cache-control'] == 'no-store'
    assert client.post('/api/admin/gift-cards/search', auth=AUTH, json={"search": card["code"]}).json()["total"] == 1
    assert client.post('/api/admin/gift-cards/search', auth=AUTH, json={"search": "%"}).json()["total"] == 0


def test_parallel_redeem_never_overspends(client):
    card = issue(client, 3)
    with ThreadPoolExecutor(max_workers=2) as executor:
        responses = list(executor.map(lambda _: upload(client, code=card["code"], discount=3), range(2)))
    assert sorted(r.status_code for r in responses) == [201, 409]
    assert balance(client, card["code"]) == 0
    with SessionLocal() as db:
        assert db.query(GiftCardTransaction).filter_by(kind="redeem").count() == 1


def test_parallel_cash_requests_issue_one_card(client):
    order_id = upload(client).json()["order_id"]
    with ThreadPoolExecutor(max_workers=2) as executor:
        responses = list(executor.map(lambda _: payment(client, order_id, 5), range(2)))
    assert sorted(r.status_code for r in responses) == [200, 409]
    assert client.get('/api/admin/gift-cards', auth=AUTH).json()["total"] == 1


def test_commit_failure_rolls_back_order_and_credit(client, monkeypatch):
    card = issue(client, 5)
    with SessionLocal() as db:
        before = db.query(Order).count()
    def fail_commit(self):
        raise RuntimeError("simulated storage failure")
    with monkeypatch.context() as patch:
        patch.setattr(Session, "commit", fail_commit)
        assert upload(client, code=card["code"], discount=3).status_code == 500
    with SessionLocal() as db:
        assert db.get(GiftCard, card["id"]).balance == 5
        assert db.query(Order).count() == before
        assert db.query(GiftCardTransaction).filter_by(kind="redeem").count() == 0


def test_migration_old_orders_is_repeatable(tmp_path, monkeypatch):
    import database
    migration_engine = create_engine(f"sqlite:///{(tmp_path / 'old.sqlite3').as_posix()}")
    try:
        with migration_engine.begin() as connection:
            connection.execute(text("CREATE TABLE orders (id INTEGER PRIMARY KEY, user_name VARCHAR, total_price INTEGER, is_paid BOOLEAN, is_printed BOOLEAN, created_at DATETIME)"))
            connection.execute(text("INSERT INTO orders (id, user_name, total_price, is_paid, is_printed) VALUES (1, 'old', 3, 1, 0)"))
        monkeypatch.setattr(database, 'engine', migration_engine)
        ensure_order_columns()
        ensure_order_columns()
        with migration_engine.connect() as connection:
            row = connection.execute(text("SELECT * FROM orders")).mappings().one()
            assert row['total_price'] == 3 and row['is_paid'] == 1
            assert row['gift_card_discount'] == 0 and row['is_cancelled'] == 0
            assert row['finance_key'] and row['cash_received'] is None
    finally:
        migration_engine.dispose()
