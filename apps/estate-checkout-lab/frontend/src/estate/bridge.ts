// Agent bridge registration. Controls map 1:1 onto the same action functions the
// buttons call, so anything the agent can do is something a user can do, and a
// control that passes proves the real path works.

import {
  backToBrowse,
  flushNow,
  loadListings,
  openListing,
  setKindFilter,
  setMaxPrice,
  startCheckout,
  submitOrder,
  updateField,
} from './actions';
import { estateStore, selectedListing, visibleListings, type CheckoutForm } from './store';
import { stats } from '@/analytics/tracker';

const FORM_FIELDS: (keyof CheckoutForm)[] = [
  'buyerName',
  'buyerEmail',
  'cardNumber',
  'cvv',
  'financing',
];

export function registerBridge() {
  window.OPENSWARM_APP?.register({
    rules:
      'Estate Checkout Lab: a property marketplace used as a testbed for OpenSwarm app surfaces. ' +
      'Flow is browse -> detail -> checkout -> confirmed. Every interaction is captured, redacted ' +
      'in-browser, POSTed to the FastAPI backend, persisted, and streamed back over SSE into the ' +
      'right-hand live feed. Sensitive fields (cardNumber, cvv) are destroyed at capture and never ' +
      'transmitted; name and email are masked. To exercise the whole pipeline: openListing, ' +
      'startCheckout, setField for each field, then submitOrder, and confirm the events appear.',
    controls: [
      { name: 'loadListings', description: 'Refetch the property catalog from the backend' },
      { name: 'setKindFilter', args: { kind: 'Condo' }, description: 'Filter the grid by property kind, or "All"' },
      { name: 'setMaxPrice', args: { maxPrice: 2000000 }, description: 'Cap the visible price; null clears it' },
      { name: 'openListing', args: { id: 'marina-loft' }, description: 'Open a property detail page by id' },
      { name: 'startCheckout', description: 'Move the selected property into checkout' },
      {
        name: 'setField',
        args: { field: 'buyerEmail', value: 'jane@example.com' },
        description:
          'Type into a checkout field. Fields: buyerName, buyerEmail, cardNumber, cvv, financing. ' +
          'Values on cardNumber/cvv are dropped at capture by design; the event still records that it happened.',
      },
      { name: 'submitOrder', description: 'Submit the reservation and record a purchase event' },
      { name: 'back', description: 'Return to the browse grid' },
      { name: 'flush', description: 'Force-send any queued analytics events immediately' },
    ],
    getState: () => {
      const s = estateStore.get();
      const listing = selectedListing(s);
      return {
        step: s.step,
        loading: s.loading,
        error: s.error,
        visibleCount: visibleListings(s).length,
        kindFilter: s.kindFilter,
        maxPrice: s.maxPrice,
        selected: listing ? { id: listing.id, title: listing.title, price: listing.price } : null,
        // The raw values stay in the browser; expose only whether each is filled,
        // so an agent can verify the form without the state dump leaking secrets.
        formFilled: Object.fromEntries(
          FORM_FIELDS.map((f) => [f, Boolean(s.form[f])]),
        ),
        order: s.order ? { id: s.order.id, deposit: s.order.deposit, buyer: s.order.buyerName } : null,
        analytics: stats(),
      };
    },
    invoke: (name, args = {}) => {
      switch (name) {
        case 'loadListings':
          void loadListings();
          return { ok: true };
        case 'setKindFilter':
          setKindFilter(String(args.kind ?? 'All'));
          return { ok: true, visible: visibleListings().length };
        case 'setMaxPrice':
          setMaxPrice(args.maxPrice == null ? null : Number(args.maxPrice));
          return { ok: true, visible: visibleListings().length };
        case 'openListing':
          return openListing(String(args.id ?? ''));
        case 'startCheckout':
          return startCheckout();
        case 'setField': {
          const field = String(args.field ?? '') as keyof CheckoutForm;
          if (!FORM_FIELDS.includes(field)) {
            return { ok: false, error: `unknown field "${field}"`, fields: FORM_FIELDS };
          }
          updateField(field, String(args.value ?? ''));
          return { ok: true, field };
        }
        case 'submitOrder':
          return submitOrder();
        case 'back':
          return backToBrowse();
        case 'flush':
          return flushNow();
        default:
          return { ok: false, error: `unknown control "${name}"` };
      }
    },
  });
}
