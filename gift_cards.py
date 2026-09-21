"""禮物卡收款、折抵及退款。SQLite 寫入鎖必須在讀取餘額／訂單前取得。"""
import hashlib
import json
import secrets

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.orm import Session

from database import GiftCard, GiftCardTransaction, OperationReceipt, Order, get_db
from schemas import GiftCardCheck, GiftCardStatusUpdate, GiftCardSearch, OrderPayment, OrderCancel


def begin_money_write(db):
    db.execute(text("BEGIN IMMEDIATE"))


def fingerprint(data):
    return hashlib.sha256(json.dumps(data, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def replay(db, request_id, request_fingerprint):
    receipt = db.get(OperationReceipt, str(request_id))
    if receipt:
        if receipt.fingerprint != request_fingerprint:
            raise HTTPException(409, "這次請求的內容已變更，請重新確認後再送出。")
        return json.loads(receipt.response_json)
    return None


def save_receipt(db, request_id, request_fingerprint, response):
    db.add(OperationReceipt(request_id=str(request_id), fingerprint=request_fingerprint,
                            response_json=json.dumps(response, ensure_ascii=False)))


def normalize_code(code):
    return "".join(code.upper().split()).replace("-", "")


def display_code(code):
    return "-".join(code[i:i + 4] for i in range(0, len(code), 4))


def find_card(db, code):
    card = db.query(GiftCard).filter(GiftCard.code == normalize_code(code)).first()
    if not card:
        raise HTTPException(400, "禮物卡代碼無效，請確認後重新輸入。")
    if not card.is_active:
        raise HTTPException(409, "這張禮物卡已停用，請聯絡管理員。")
    return card


def record_transaction(db, card, order, kind, amount):
    db.add(GiftCardTransaction(
        card_id=card.id, kind=kind, amount=amount, balance_after=card.balance,
        order_id=order.id, order_key=order.finance_key,
        order_summary=f"{order.user_name}／{order.file_name}",
    ))


def redeem(db, order, code, expected_discount):
    card = find_card(db, code)
    if card.balance <= 0:
        raise HTTPException(409, "這張禮物卡已用完，請移除後重新確認金額。")
    discount = min(card.balance, order.total_price)
    if discount != expected_discount:
        raise HTTPException(409, "禮物卡餘額或訂單金額已變動，請重新套用並確認折抵金額。")
    card.balance -= discount
    order.gift_card_id = card.id
    order.gift_card_discount = discount
    order.is_paid = order.amount_due == 0
    record_transaction(db, card, order, "redeem", -discount)
    return card.balance


def card_json(card):
    return dict(id=card.id, code=display_code(card.code), initial_amount=card.initial_amount,
                balance=card.balance, is_active=card.is_active, note=card.note,
                source_order_id=card.source_order_id, created_at=str(card.created_at))


def private_json(data, status=200):
    return JSONResponse(data, status_code=status, headers={"Cache-Control": "no-store"})


def build_gift_card_router(authenticate_admin, rate_limit):
    router = APIRouter()
    admin = [Depends(authenticate_admin), Depends(rate_limit("admin"))]

    @router.post("/api/gift-cards/check", dependencies=[Depends(rate_limit("api"))])
    def check_card(payload: GiftCardCheck, db: Session = Depends(get_db)):
        card = find_card(db, payload.code)
        return private_json({"balance": card.balance, "is_active": True})

    def list_cards_result(db, page, search=""):
        query = db.query(GiftCard)
        if search.strip():
            # 精確代碼查詢，避免把 SQL 萬用字元當成搜尋條件。
            query = query.filter(GiftCard.code == normalize_code(search))
        total = query.count()
        cards = query.order_by(GiftCard.id.desc()).offset((page - 1) * 25).limit(25).all()
        return private_json({"items": [card_json(c) for c in cards], "page": page,
                             "total": total, "total_pages": (total + 24) // 25})

    @router.get("/api/admin/gift-cards", dependencies=admin)
    def list_cards(page: int = Query(1, ge=1), db: Session = Depends(get_db)):
        return list_cards_result(db, page)

    @router.post("/api/admin/gift-cards/search", dependencies=admin)
    def search_cards(payload: GiftCardSearch, db: Session = Depends(get_db)):
        return list_cards_result(db, payload.page, payload.search)

    @router.get("/api/admin/gift-cards/{card_id}", dependencies=admin)
    def card_detail(card_id: int, page: int = Query(1, ge=1), db: Session = Depends(get_db)):
        card = db.get(GiftCard, card_id)
        if not card:
            raise HTTPException(404, "找不到禮物卡")
        query = db.query(GiftCardTransaction).filter_by(card_id=card_id)
        total = query.count()
        rows = query.order_by(GiftCardTransaction.id.desc()).offset((page - 1) * 25).limit(25).all()
        return private_json({"card": card_json(card), "page": page, "total_pages": (total + 24) // 25,
            "items": [dict(kind=r.kind, amount=r.amount, balance_after=r.balance_after,
                           order_id=r.order_id, order_summary=r.order_summary,
                           created_at=str(r.created_at)) for r in rows]})

    @router.put("/api/admin/gift-cards/{card_id}", dependencies=admin)
    def set_card_status(card_id: int, payload: GiftCardStatusUpdate, db: Session = Depends(get_db)):
        begin_money_write(db)
        card = db.get(GiftCard, card_id)
        if not card:
            raise HTTPException(404, "找不到禮物卡")
        card.is_active = payload.is_active
        result = card_json(card)
        db.commit()
        return private_json(result)

    @router.post("/api/admin/orders/{order_id}/payment", dependencies=admin)
    def collect_payment(order_id: int, payload: OrderPayment, db: Session = Depends(get_db)):
        request_fp = fingerprint({"payment": order_id, "cash": payload.cash_received, "note": payload.note})
        begin_money_write(db)
        previous = replay(db, payload.request_id, request_fp)
        if previous is not None:
            return private_json(previous)
        order = db.get(Order, order_id)
        if not order:
            raise HTTPException(404, "找不到該訂單")
        if order.is_cancelled or order.is_paid or order.cash_received is not None:
            raise HTTPException(409, "訂單已收款或已取消，不能重複收款發卡。")
        if payload.cash_received < order.amount_due:
            raise HTTPException(400, f"實收金額不足，這筆訂單需收 {order.amount_due} 元。")
        extra = payload.cash_received - order.amount_due
        card = None
        if extra:
            alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
            code = "".join(secrets.choice(alphabet) for _ in range(24))
            card = GiftCard(code=code, initial_amount=extra, balance=extra,
                            source_order_id=order.id, note=payload.note.strip())
            db.add(card)
            db.flush()
            record_transaction(db, card, order, "issue", extra)
        order.cash_received = payload.cash_received
        order.is_paid = True
        result = {"order_id": order.id, "cash_received": payload.cash_received,
                  "amount_due": order.amount_due, "gift_card": card_json(card) if card else None}
        save_receipt(db, payload.request_id, request_fp, result)
        db.commit()
        return private_json(result)

    @router.post("/api/admin/orders/{order_id}/cancel", dependencies=admin)
    def cancel_order(order_id: int, payload: OrderCancel, db: Session = Depends(get_db)):
        request_fp = fingerprint({"cancel": order_id})
        begin_money_write(db)
        previous = replay(db, payload.request_id, request_fp)
        if previous is not None:
            return private_json(previous)
        order = db.get(Order, order_id)
        if not order:
            raise HTTPException(404, "找不到該訂單")
        if order.is_printed:
            raise HTTPException(409, "訂單已列印，不能取消。")
        refunded = 0
        if not order.is_cancelled:
            if order.gift_card_discount:
                card = db.get(GiftCard, order.gift_card_id)
                if not card:
                    raise HTTPException(409, "找不到原禮物卡，請先檢查帳目。")
                refunded = order.gift_card_discount
                card.balance += refunded
                record_transaction(db, card, order, "refund", refunded)
            order.is_cancelled = True
        result = {"order_id": order.id, "is_cancelled": True, "refunded": refunded,
                  "cash_received": order.cash_received,
                  "cash_refund_due": order.amount_due if order.is_paid else 0}
        save_receipt(db, payload.request_id, request_fp, result)
        db.commit()
        return private_json(result)

    return router
