"""Collects live interaction events from an external website and replays them to the app.

The public site posts here (cross-origin, via the tunnel); the OpenSwarm app card reads
/api/ingest/stream to watch sessions in real time.
"""

import asyncio
import json
import time
import uuid
from contextlib import asynccontextmanager
from typing import Any, Dict, List, Optional

from fastapi import Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from swarm_debug import debug

from backend.config.Apps import SubApp
from backend.apps.store.store import load_store, save_store

# Events are dropped, not queued, once a subscriber falls this far behind. A slow
# dashboard must never apply backpressure to the site being measured.
QUEUE_MAX = 500
# Cap the disk store so a busy site can't grow store.json without bound.
KEEP_EVENTS = 2000

_subscribers: List[asyncio.Queue] = []


class TrackedEvent(BaseModel):
    sessionId: str
    type: str
    at: Optional[int] = None
    url: Optional[str] = None
    field: Optional[str] = None
    value: Optional[str] = None
    meta: Optional[Dict[str, Any]] = None


class EventBatch(BaseModel):
    events: List[TrackedEvent]


@asynccontextmanager
async def ingest_lifespan():
    debug("ingest SubApp lifespan starting")
    yield


ingest = SubApp("ingest", ingest_lifespan)


def _fanout(payload: Dict[str, Any]) -> None:
    for q in list(_subscribers):
        try:
            q.put_nowait(payload)
        except asyncio.QueueFull:
            # Subscriber is too slow; drop rather than block the ingest request.
            pass


@ingest.router.post("/collect")
async def collect(batch: EventBatch, request: Request):
    """Public endpoint the embedded tracker posts to. Never rejects on a bad field:
    losing telemetry is preferable to breaking the host site."""
    now = int(time.time() * 1000)
    origin = request.headers.get("origin") or request.headers.get("referer") or "unknown"

    stored = load_store()
    events = stored.get("events", [])

    accepted = []
    for e in batch.events:
        row = {
            "id": uuid.uuid4().hex[:12],
            "sessionId": e.sessionId,
            "type": e.type,
            "at": e.at or now,
            "receivedAt": now,
            "url": e.url,
            "field": e.field,
            "value": e.value,
            "meta": e.meta or {},
            "origin": origin,
        }
        accepted.append(row)

    events.extend(accepted)
    save_store({**stored, "events": events[-KEEP_EVENTS:]})

    for row in accepted:
        _fanout(row)

    debug(f"ingest: accepted {len(accepted)} events from {origin}")
    return {"ok": True, "accepted": len(accepted)}


@ingest.router.get("/stream")
async def stream():
    """Server-sent events: one JSON event per message, live as they land."""
    q: asyncio.Queue = asyncio.Queue(maxsize=QUEUE_MAX)
    _subscribers.append(q)

    async def gen():
        try:
            yield "retry: 2000\n\n"
            while True:
                try:
                    row = await asyncio.wait_for(q.get(), timeout=20.0)
                    yield f"data: {json.dumps(row)}\n\n"
                except asyncio.TimeoutError:
                    # Comment frame keeps the connection alive through proxies.
                    yield ": keepalive\n\n"
        finally:
            if q in _subscribers:
                _subscribers.remove(q)

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no", "Connection": "keep-alive"},
    )


@ingest.router.get("/events")
async def events(limit: int = 500):
    """Replay buffer, so the dashboard has history on open rather than an empty screen."""
    rows = load_store().get("events", [])
    return {"events": rows[-limit:], "total": len(rows)}


@ingest.router.get("/sessions")
async def sessions():
    """Events folded into per-session summaries."""
    rows = load_store().get("events", [])
    by_id: Dict[str, Dict[str, Any]] = {}
    for r in rows:
        s = by_id.setdefault(
            r["sessionId"],
            {
                "sessionId": r["sessionId"],
                "firstSeen": r["at"],
                "lastSeen": r["at"],
                "eventCount": 0,
                "origin": r.get("origin"),
                "url": r.get("url"),
                "fields": {},
                "converted": False,
            },
        )
        s["lastSeen"] = max(s["lastSeen"], r["at"])
        s["firstSeen"] = min(s["firstSeen"], r["at"])
        s["eventCount"] += 1
        if r.get("field") and r.get("value") is not None:
            s["fields"][r["field"]] = r["value"]
        if r["type"] in ("submit", "payment_settled", "purchase"):
            s["converted"] = True

    out = sorted(by_id.values(), key=lambda s: s["lastSeen"], reverse=True)
    return {"sessions": out, "total": len(out)}


@ingest.router.post("/clear")
async def clear():
    stored = load_store()
    save_store({**stored, "events": []})
    return {"ok": True}
