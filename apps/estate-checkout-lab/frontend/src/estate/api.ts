import {
  LISTINGS_LIST_URL,
  ORDERS_CREATE_URL,
  ORDERS_LIST_URL,
  ORDERS_CLEAR_URL,
  INGEST_SESSIONS_URL,
  INGEST_EVENTS_URL,
  INGEST_CLEAR_URL,
} from '@/shared/state/API_ENDPOINTS';

export interface Listing {
  id: string;
  title: string;
  city: string;
  state: string;
  price: number;
  beds: number;
  baths: number;
  sqft: number;
  kind: string;
  year: number;
  blurb: string;
  image: string;
  features: string[];
}

export interface Order {
  id: string;
  listingId: string;
  listingTitle: string;
  price: number;
  deposit: number;
  buyerName: string;
  buyerEmail: string;
  financing: string;
  createdAt: number;
  status: string;
}

export interface SessionRollup {
  sessionId: string;
  firstSeen: number;
  lastSeen: number;
  eventCount: number;
  origin: string;
  url?: string;
  fields: Record<string, string>;
  converted: boolean;
  furthestStep: string;
}

export interface ServerEvent {
  id: string;
  sessionId: string;
  type: string;
  at: number;
  field?: string | null;
  value?: string | null;
  meta?: Record<string, unknown>;
  url?: string | null;
}

export interface Filters {
  kind?: string;
  maxPrice?: number;
  minBeds?: number;
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json() as Promise<T>;
}

export async function fetchListings(filters: Filters = {}): Promise<Listing[]> {
  const qs = new URLSearchParams();
  if (filters.kind) qs.set('kind', filters.kind);
  if (filters.maxPrice) qs.set('max_price', String(filters.maxPrice));
  if (filters.minBeds) qs.set('min_beds', String(filters.minBeds));
  const suffix = qs.toString() ? `?${qs}` : '';
  const data = await getJson<{ listings: Listing[] }>(LISTINGS_LIST_URL + suffix);
  return data.listings ?? [];
}

export interface CreateOrderInput {
  listingId: string;
  buyerName: string;
  buyerEmail: string;
  sessionId: string;
  financing: string;
}

export async function createOrder(input: CreateOrderInput): Promise<Order> {
  const res = await fetch(ORDERS_CREATE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const data = (await res.json()) as { ok: boolean; order?: Order; error?: string };
  if (!data.ok || !data.order) throw new Error(data.error || 'order failed');
  return data.order;
}

export async function fetchOrders(): Promise<{ orders: Order[]; depositRevenue: number }> {
  const data = await getJson<{ orders: Order[]; depositRevenue: number }>(ORDERS_LIST_URL);
  return { orders: data.orders ?? [], depositRevenue: data.depositRevenue ?? 0 };
}

export async function fetchSessions(): Promise<SessionRollup[]> {
  const data = await getJson<{ sessions: SessionRollup[] }>(INGEST_SESSIONS_URL);
  return data.sessions ?? [];
}

export async function fetchEvents(limit = 200): Promise<ServerEvent[]> {
  const data = await getJson<{ events: ServerEvent[] }>(`${INGEST_EVENTS_URL}?limit=${limit}`);
  return data.events ?? [];
}

export async function clearAll(): Promise<void> {
  await Promise.all([
    fetch(INGEST_CLEAR_URL, { method: 'POST' }),
    fetch(ORDERS_CLEAR_URL, { method: 'POST' }),
  ]);
}

export const money = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
