// One module-level store so the UI and the agent bridge drive the SAME state.
// A control invoked by the agent takes exactly the path a click takes; there is
// no second, agent-only code path that could pass while the real one is broken.

import { useSyncExternalStore } from 'react';
import type { Listing, Order } from './api';

export type Step = 'browse' | 'detail' | 'checkout' | 'confirmed';

export interface CheckoutForm {
  buyerName: string;
  buyerEmail: string;
  cardNumber: string;
  cvv: string;
  financing: string;
}

export interface EstateState {
  step: Step;
  listings: Listing[];
  loading: boolean;
  error: string | null;
  selectedId: string | null;
  kindFilter: string;
  maxPrice: number | null;
  form: CheckoutForm;
  order: Order | null;
  submitting: boolean;
}

const EMPTY_FORM: CheckoutForm = {
  buyerName: '',
  buyerEmail: '',
  cardNumber: '',
  cvv: '',
  financing: 'cash',
};

let state: EstateState = {
  step: 'browse',
  listings: [],
  loading: true,
  error: null,
  selectedId: null,
  kindFilter: 'All',
  maxPrice: null,
  form: { ...EMPTY_FORM },
  order: null,
  submitting: false,
};

const listeners = new Set<() => void>();

function set(patch: Partial<EstateState>) {
  state = { ...state, ...patch };
  for (const fn of listeners) fn();
}

export const estateStore = {
  get: () => state,
  set,
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  resetForm: () => set({ form: { ...EMPTY_FORM } }),
  patchForm: (patch: Partial<CheckoutForm>) => set({ form: { ...state.form, ...patch } }),
};

export function useEstate(): EstateState {
  return useSyncExternalStore(estateStore.subscribe, estateStore.get, estateStore.get);
}

export function selectedListing(s: EstateState = state): Listing | null {
  return s.listings.find((l) => l.id === s.selectedId) ?? null;
}

export function visibleListings(s: EstateState = state): Listing[] {
  return s.listings.filter(
    (l) =>
      (s.kindFilter === 'All' || l.kind === s.kindFilter) &&
      (s.maxPrice === null || l.price <= s.maxPrice),
  );
}
