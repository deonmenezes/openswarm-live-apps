// Relative '/api' is right inside OpenSwarm, where vite proxies it to the local
// backend. A build deployed anywhere else has no proxy, so VITE_API_BASE points it
// at the backend's absolute origin (e.g. the tunnel URL). Trailing slashes are
// stripped so '<base>/' and '<base>' both produce '<base>/ingest/collect'.
const API_URL = (import.meta.env.VITE_API_BASE || '/api').replace(/\/+$/, '');

// HEALTH - Endpoints
export const HEALTH_CHECK_URL = API_URL + '/health/check';

// LISTINGS - Endpoints
export const LISTINGS_LIST_URL = API_URL + '/listings/list';
export const LISTINGS_KINDS_URL = API_URL + '/listings/kinds';
export const listingUrl = (id: string) => `${API_URL}/listings/${encodeURIComponent(id)}`;

// ORDERS - Endpoints
export const ORDERS_CREATE_URL = API_URL + '/orders/create';
export const ORDERS_LIST_URL = API_URL + '/orders/list';
export const ORDERS_CLEAR_URL = API_URL + '/orders/clear';

// INGEST - Endpoints
export const INGEST_COLLECT_URL = API_URL + '/ingest/collect';
export const INGEST_EVENTS_URL = API_URL + '/ingest/events';
export const INGEST_SESSIONS_URL = API_URL + '/ingest/sessions';
export const INGEST_STREAM_URL = API_URL + '/ingest/stream';
export const INGEST_CLEAR_URL = API_URL + '/ingest/clear';
