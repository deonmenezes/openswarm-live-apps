"""Live interaction feed.

The browser redacts before sending (see frontend/src/analytics/redact.ts), but a
server must never trust a client: anything arriving with a value on a sensitive
field is dropped here too, so a stale snippet or a hand-rolled POST cannot write
plaintext secrets into the durable store.
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

from backend.apps.store.store import load_store, save_store
from backend.config.Apps import SubApp

# Events are dropped, not queued, once a subscriber falls this far behind. A slow
# dashboard must never apply backpressure to the checkout being measured.
QUEUE_MAX = 500
# Cap the disk store so a long session can't grow store.json without bound.
KEEP_EVENTS = 2000

# Fields whose values must never be persisted, whatever the client claims. Matched
# as a substring against a lowercased field name, so "billing-cardNumber" is caught
# by "card".
BANNED_VALUE_FIELDS = ("card", "cvv", "cvc", "password", "passcode", "ssn", "routing", "iban", "account")

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


def _scrub(field: Optional[str], value: Optional[str]) -> Optional[str]:
    """Second line of defence: strip values on sensitive fields regardless of client behaviour."""
    if value is None or field is None:
        return value
    lowered = field.lower()
    if any(token in lowered for token in BANNED_VALUE_FIELDS):
        debug("ingest dropped a value on sensitive field %s", field)
        return None
    return value


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
async def collect(batch: EventBatch, request: Request) -> Dict[str, Any]:
    origin = request.headers.get("origin") or "unknown"
    now = int(time.time() * 1000)

    accepted: List[Dict[str, Any]] = []
    for event in batch.events:
        record = {
            "id": uuid.uuid4().hex[:12],
            "sessionId": event.sessionId,
            "type": event.type,
            "at": event.at or now,
            "receivedAt": now,
            "url": event.url,
            "field": event.field,
            "value": _scrub(event.field, event.value),
            "meta": event.meta or {},
            "origin": origin,
        }
        accepted.append(record)

    data = load_store()
    events = [*data.get("events", []), *accepted][-KEEP_EVENTS:]
    save_store({**data, "events": events})

    for record in accepted:
        _fanout(record)

    debug("ingest accepted %d events from %s", len(accepted), origin)
    return {"ok": True, "accepted": len(accepted)}


@ingest.router.get("/events")
async def list_events(session_id: Optional[str] = None, limit: int = 200) -> Dict[str, Any]:
    events = load_store().get("events", [])
    if session_id:
        events = [e for e in events if e.get("sessionId") == session_id]
    return {"events": events[-limit:], "total": len(events)}


@ingest.router.get("/sessions")
async def list_sessions() -> Dict[str, Any]:
    """Roll the flat event log up per session, so the UI can show funnels without re-deriving them."""
    sessions: Dict[str, Dict[str, Any]] = {}
    for event in load_store().get("events", []):
        sid = event.get("sessionId")
        if not sid:
            continue
        entry = sessions.setdefault(
            sid,
            {
                "sessionId": sid,
                "firstSeen": event.get("at"),
                "lastSeen": event.get("at"),
                "eventCount": 0,
                "origin": event.get("origin", "unknown"),
                "url": event.get("url"),
                "fields": {},
                "converted": False,
                "furthestStep": "browse",
            },
        )
        entry["eventCount"] += 1
        entry["lastSeen"] = max(entry["lastSeen"] or 0, event.get("at") or 0)
        if event.get("field") and event.get("value"):
            entry["fields"][event["field"]] = event["value"]
        if event.get("type") == "purchase":
            entry["converted"] = True
        step = (event.get("meta") or {}).get("step")
        if step:
            entry["furthestStep"] = step

    ordered = sorted(sessions.values(), key=lambda s: s.get("lastSeen") or 0, reverse=True)
    return {"sessions": ordered, "total": len(ordered)}


@ingest.router.get("/stream")
async def stream() -> StreamingResponse:
    queue: asyncio.Queue = asyncio.Queue(maxsize=QUEUE_MAX)
    _subscribers.append(queue)
    debug("ingest subscriber joined (%d total)", len(_subscribers))

    async def publish():
        try:
            yield "retry: 2000\n\n"
            while True:
                try:
                    record = await asyncio.wait_for(queue.get(), timeout=15)
                    yield f"data: {json.dumps(record)}\n\n"
                except asyncio.TimeoutError:
                    # Comment frame: keeps proxies from reaping an idle connection.
                    yield ": keepalive\n\n"
        finally:
            if queue in _subscribers:
                _subscribers.remove(queue)
            debug("ingest subscriber left (%d remain)", len(_subscribers))

    return StreamingResponse(
        publish(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@ingest.router.post("/clear")
async def clear() -> Dict[str, Any]:
    data = load_store()
    save_store({**data, "events": []})
    return {"ok": True}
