// The capture side of the testbed: batches interaction events and POSTs them to
// /api/ingest/collect. Field values go through redact() first, so what leaves the
// browser is already safe; nothing here can be configured to send a raw secret.

import { redact, type Policy } from './redact';
import { INGEST_COLLECT_URL } from '@/shared/state/API_ENDPOINTS';

export type EventType = 'view' | 'field' | 'step' | 'purchase' | 'blocked';

export interface TrackedEvent {
  sessionId: string;
  type: EventType;
  at: number;
  url?: string;
  field?: string;
  value?: string | null;
  meta?: Record<string, unknown>;
}

// A local mirror of what was sent, so the UI can prove redaction happened without
// waiting for the server to echo it back.
export interface LocalRecord extends TrackedEvent {
  id: string;
  policy?: Policy;
  note?: string;
  raw?: string;
}

const FLUSH_MS = 700;
const LOCAL_KEEP = 300;

let queue: TrackedEvent[] = [];
let local: LocalRecord[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let sent = 0;
let dropped = 0;

const listeners = new Set<(records: LocalRecord[]) => void>();

export const sessionId = `S-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

function emit() {
  for (const fn of listeners) fn(local);
}

export function subscribe(fn: (records: LocalRecord[]) => void): () => void {
  listeners.add(fn);
  fn(local);
  return () => listeners.delete(fn);
}

export function localRecords(): LocalRecord[] {
  return local;
}

export function stats() {
  return { sessionId, queued: queue.length, sent, dropped, captured: local.length };
}

function push(event: TrackedEvent, extra: Partial<LocalRecord> = {}) {
  queue.push(event);
  local = [
    { ...event, ...extra, id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}` },
    ...local,
  ].slice(0, LOCAL_KEEP);
  emit();
  schedule();
}

function schedule() {
  if (timer) return;
  timer = setTimeout(flush, FLUSH_MS);
}

export async function flush(): Promise<void> {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (!queue.length) return;
  const batch = queue;
  queue = [];
  try {
    await fetch(INGEST_COLLECT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ events: batch }),
    });
    sent += batch.length;
  } catch {
    // The testbed must never break the flow it is measuring. A failed POST loses
    // the batch rather than retrying forever and pinning the queue.
    dropped += batch.length;
  }
  emit();
}

export function trackView(page: string, meta: Record<string, unknown> = {}) {
  push({
    sessionId,
    type: 'view',
    at: Date.now(),
    url: page,
    meta,
  });
}

export function trackStep(step: string, meta: Record<string, unknown> = {}) {
  push({
    sessionId,
    type: 'step',
    at: Date.now(),
    url: window.location.pathname,
    meta: { step, ...meta },
  });
}

/** The interesting one: what a tester types is redacted here, at the keystroke. */
export function trackField(field: string, rawValue: string) {
  const result = redact(field, rawValue);
  push(
    {
      sessionId,
      type: result.value === null ? 'blocked' : 'field',
      at: Date.now(),
      url: window.location.pathname,
      field,
      value: result.value,
      meta: { policy: result.policy },
    },
    { policy: result.policy, note: result.note, raw: rawValue },
  );
}

export function trackPurchase(orderId: string, amount: number, meta: Record<string, unknown> = {}) {
  push({
    sessionId,
    type: 'purchase',
    at: Date.now(),
    url: window.location.pathname,
    meta: { step: 'purchase', orderId, amount, ...meta },
  });
  void flush();
}

export function resetLocal() {
  local = [];
  queue = [];
  sent = 0;
  dropped = 0;
  emit();
}
