"""Reservation orders.

An order records that a property was reserved and for how much. It deliberately
stores no payment instrument: the frontend never sends one, and there is nothing
here that could hold one if it did.
"""

import time
import uuid
from contextlib import asynccontextmanager
from typing import Any, Dict, List, Optional

from pydantic import BaseModel
from swarm_debug import debug

from backend.apps.listings.listings import LISTINGS
from backend.apps.store.store import load_store, save_store
from backend.config.Apps import SubApp

_BY_ID = {item["id"]: item for item in LISTINGS}

# Reservation is a deposit against the sale price, not the full amount.
DEPOSIT_RATE = 0.05


class OrderRequest(BaseModel):
    listingId: str
    buyerName: str
    buyerEmail: str
    sessionId: Optional[str] = None
    financing: Optional[str] = "cash"


@asynccontextmanager
async def orders_lifespan():
    debug("orders SubApp lifespan starting")
    yield


orders = SubApp("orders", orders_lifespan)


def _mask_email(email: str) -> str:
    """j***@d***.com — enough to recognise a returning buyer, not enough to contact them."""
    if "@" not in email:
        return "***"
    local, _, domain = email.partition("@")
    domain_name, _, tld = domain.partition(".")
    masked_local = (local[0] + "***") if local else "***"
    masked_domain = (domain_name[0] + "***") if domain_name else "***"
    return f"{masked_local}@{masked_domain}" + (f".{tld}" if tld else "")


def _mask_name(name: str) -> str:
    parts = [p for p in name.split() if p]
    if not parts:
        return "***"
    return " ".join([parts[0]] + [f"{p[0]}." for p in parts[1:]])


@orders.router.post("/create")
async def create_order(req: OrderRequest) -> Dict[str, Any]:
    listing = _BY_ID.get(req.listingId)
    if listing is None:
        return {"ok": False, "error": f"No listing with id {req.listingId}"}

    deposit = round(listing["price"] * DEPOSIT_RATE)
    order = {
        "id": f"ORD-{uuid.uuid4().hex[:8].upper()}",
        "listingId": listing["id"],
        "listingTitle": listing["title"],
        "price": listing["price"],
        "deposit": deposit,
        "buyerName": _mask_name(req.buyerName),
        "buyerEmail": _mask_email(req.buyerEmail),
        "financing": req.financing or "cash",
        "sessionId": req.sessionId,
        "createdAt": int(time.time() * 1000),
        "status": "reserved",
    }

    data = load_store()
    save_store({**data, "orders": [*data.get("orders", []), order]})
    debug("order created %s for %s", order["id"], listing["id"])
    return {"ok": True, "order": order}


@orders.router.get("/list")
async def list_orders() -> Dict[str, Any]:
    items: List[Dict[str, Any]] = load_store().get("orders", [])
    ordered = sorted(items, key=lambda o: o.get("createdAt", 0), reverse=True)
    revenue = sum(o.get("deposit", 0) for o in ordered)
    return {"orders": ordered, "total": len(ordered), "depositRevenue": revenue}


@orders.router.post("/clear")
async def clear_orders() -> Dict[str, Any]:
    data = load_store()
    save_store({**data, "orders": []})
    return {"ok": True}
