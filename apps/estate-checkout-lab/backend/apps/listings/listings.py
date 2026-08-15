"""Property catalog.

Seed data only: listings never change at runtime, so they live in the module. The
durable store is reserved for what the user actually creates (orders, captured events).
"""

from contextlib import asynccontextmanager
from typing import Any, Dict, List, Optional

from swarm_debug import debug

from backend.config.Apps import SubApp

LISTINGS: List[Dict[str, Any]] = [
    {
        "id": "sunset-ridge",
        "title": "Sunset Ridge Estate",
        "city": "Malibu",
        "state": "CA",
        "price": 4250000,
        "beds": 5,
        "baths": 6,
        "sqft": 6200,
        "kind": "Estate",
        "year": 2019,
        "blurb": "Cliffside glass-and-cedar estate with a 60ft infinity pool and unbroken Pacific views.",
        "image": "https://images.unsplash.com/photo-1613490493576-7fde63acd811?w=1200&q=80",
        "features": ["Ocean view", "Infinity pool", "Wine cellar", "4-car garage"],
    },
    {
        "id": "marina-loft",
        "title": "Marina Loft 12B",
        "city": "San Francisco",
        "state": "CA",
        "price": 1395000,
        "beds": 2,
        "baths": 2,
        "sqft": 1450,
        "kind": "Condo",
        "year": 2015,
        "blurb": "Corner loft with 14ft ceilings, blackened steel details, and a skyline-facing terrace.",
        "image": "https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?w=1200&q=80",
        "features": ["Doorman", "Terrace", "Gym", "EV charging"],
    },
    {
        "id": "aspen-grove",
        "title": "Aspen Grove Cabin",
        "city": "Aspen",
        "state": "CO",
        "price": 2780000,
        "beds": 4,
        "baths": 3,
        "sqft": 3100,
        "kind": "Cabin",
        "year": 2008,
        "blurb": "Reclaimed-timber cabin backing onto national forest, ski-in access down the north trail.",
        "image": "https://images.unsplash.com/photo-1449158743715-0a90ebb6d2d8?w=1200&q=80",
        "features": ["Ski-in access", "Stone fireplace", "Hot tub", "Heated drive"],
    },
    {
        "id": "beacon-hill",
        "title": "Beacon Hill Townhouse",
        "city": "Boston",
        "state": "MA",
        "price": 1850000,
        "beds": 3,
        "baths": 3,
        "sqft": 2400,
        "kind": "Townhouse",
        "year": 1898,
        "blurb": "Federal-era brick townhouse, restored throughout, with an walled garden off the kitchen.",
        "image": "https://images.unsplash.com/photo-1568605114967-8130f3a36994?w=1200&q=80",
        "features": ["Walled garden", "Original millwork", "Roof deck", "Wine room"],
    },
    {
        "id": "desert-modern",
        "title": "Desert Modern",
        "city": "Scottsdale",
        "state": "AZ",
        "price": 3100000,
        "beds": 4,
        "baths": 4,
        "sqft": 4050,
        "kind": "Modern",
        "year": 2021,
        "blurb": "Low-slung concrete and glass set into the McDowell foothills, built around a shaded courtyard.",
        "image": "https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=1200&q=80",
        "features": ["Courtyard pool", "Solar array", "Casita", "Mountain view"],
    },
    {
        "id": "lakeview-cottage",
        "title": "Lakeview Cottage",
        "city": "Lake Tahoe",
        "state": "NV",
        "price": 985000,
        "beds": 2,
        "baths": 1,
        "sqft": 1100,
        "kind": "Cottage",
        "year": 1974,
        "blurb": "Shingled cottage a hundred yards off the water, with a screened porch and a private dock slip.",
        "image": "https://images.unsplash.com/photo-1470770841072-f978cf4d019e?w=1200&q=80",
        "features": ["Dock slip", "Screened porch", "Wood stove", "Lake access"],
    },
]

_BY_ID = {item["id"]: item for item in LISTINGS}


@asynccontextmanager
async def listings_lifespan():
    debug("listings SubApp lifespan starting (%d properties)", len(LISTINGS))
    yield


listings = SubApp("listings", listings_lifespan)


@listings.router.get("/list")
async def list_listings(
    kind: Optional[str] = None,
    max_price: Optional[int] = None,
    min_beds: Optional[int] = None,
) -> Dict[str, Any]:
    """The catalog, optionally narrowed. Filters compose; an unmatched filter yields an empty list."""
    results = LISTINGS
    if kind:
        results = [r for r in results if r["kind"].lower() == kind.lower()]
    if max_price is not None:
        results = [r for r in results if r["price"] <= max_price]
    if min_beds is not None:
        results = [r for r in results if r["beds"] >= min_beds]
    debug("listings filtered -> %d", len(results))
    return {"listings": results, "total": len(results)}


@listings.router.get("/kinds")
async def list_kinds() -> Dict[str, Any]:
    return {"kinds": sorted({item["kind"] for item in LISTINGS})}


@listings.router.get("/{listing_id}")
async def get_listing(listing_id: str) -> Dict[str, Any]:
    item = _BY_ID.get(listing_id)
    if item is None:
        return {"found": False, "listing": None}
    return {"found": True, "listing": item}
