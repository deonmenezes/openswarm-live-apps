// Every state transition in the app. Buttons call these; the agent bridge calls
// these. Tracking lives here rather than in components so an agent-driven run
// produces exactly the same event stream as a human one.

import { createOrder, fetchListings } from './api';
import { estateStore, selectedListing, visibleListings, type CheckoutForm } from './store';
import { sessionId, trackField, trackPurchase, trackStep, trackView, flush } from '@/analytics/tracker';

export async function loadListings() {
  estateStore.set({ loading: true, error: null });
  try {
    const listings = await fetchListings();
    estateStore.set({ listings, loading: false });
    trackView('/browse', { count: listings.length });
  } catch (e) {
    estateStore.set({ loading: false, error: (e as Error).message });
  }
}

export function setKindFilter(kind: string) {
  estateStore.set({ kindFilter: kind });
  trackStep('browse', { filterKind: kind, visible: visibleListings().length });
}

export function setMaxPrice(maxPrice: number | null) {
  estateStore.set({ maxPrice });
  trackStep('browse', { maxPrice, visible: visibleListings().length });
}

export function openListing(id: string) {
  const exists = estateStore.get().listings.some((l) => l.id === id);
  if (!exists) return { ok: false, error: `no listing "${id}"` };
  estateStore.set({ selectedId: id, step: 'detail' });
  trackStep('detail', { listingId: id });
  return { ok: true, step: 'detail', listingId: id };
}

export function backToBrowse() {
  estateStore.set({ step: 'browse', selectedId: null, order: null });
  trackStep('browse', {});
  return { ok: true, step: 'browse' };
}

export function startCheckout() {
  const listing = selectedListing();
  if (!listing) return { ok: false, error: 'select a listing first' };
  estateStore.set({ step: 'checkout' });
  trackStep('checkout', { listingId: listing.id, price: listing.price });
  return { ok: true, step: 'checkout' };
}

/** The redaction demo lives here: the raw value updates local form state (so the
 *  input behaves normally) while only the redacted form is ever tracked. */
export function updateField(field: keyof CheckoutForm, value: string) {
  estateStore.patchForm({ [field]: value } as Partial<CheckoutForm>);
  trackField(field, value);
}

export async function submitOrder() {
  const s = estateStore.get();
  const listing = selectedListing(s);
  if (!listing) return { ok: false, error: 'no listing selected' };
  if (!s.form.buyerName.trim() || !s.form.buyerEmail.trim()) {
    return { ok: false, error: 'name and email are required' };
  }

  estateStore.set({ submitting: true });
  try {
    const order = await createOrder({
      listingId: listing.id,
      buyerName: s.form.buyerName,
      buyerEmail: s.form.buyerEmail,
      sessionId,
      financing: s.form.financing,
    });
    estateStore.set({ order, step: 'confirmed', submitting: false });
    trackPurchase(order.id, order.deposit, { listingId: listing.id });
    return { ok: true, order };
  } catch (e) {
    estateStore.set({ submitting: false, error: (e as Error).message });
    return { ok: false, error: (e as Error).message };
  }
}

export async function flushNow() {
  await flush();
  return { ok: true };
}
