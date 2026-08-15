// App-wide churn telemetry. The checkout button's own onEvent covers one funnel;
// this covers the whole session, including the parts where the user leaves without
// ever pressing anything. Persisted to localStorage so an abandoned session is still
// readable on the next visit, which is the only way an exit is observable at all.

import type { CheckoutAnalyticsEvent } from '@/components/SwarmCheckoutButton';
import { INGEST_COLLECT_URL, INGEST_EVENTS_URL } from '@/shared/state/API_ENDPOINTS';

const STORE_KEY = 'swarm-checkout:churn:v1';
const MAX_SESSIONS = 40;
/** No interaction for this long means the user mentally left, even if the tab is open. */
const IDLE_MS = 30_000;

export type ExitReason =
  | 'abandoned_before_interacting'
  | 'abandoned_after_viewing_price'
  | 'abandoned_during_review'
  | 'abandoned_after_flagged'
  | 'abandoned_after_error'
  | 'converted'
  | 'active';

export interface ChurnSession {
  id: string;
  startedAt: number;
  lastActivityAt: number;
  endedAt?: number;
  /** Milliseconds the tab was actually visible, not just open. */
  engagedMs: number;
  interactions: number;
  idlePeriods: number;
  reachedCheckout: boolean;
  reachedReview: boolean;
  flagged: boolean;
  errored: boolean;
  converted: boolean;
  tabSwitches: number;
  events: { type: string; at: number }[];
  exitReason: ExitReason;
}

function read(): ChurnSession[] {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? (JSON.parse(raw) as ChurnSession[]) : [];
  } catch {
    return [];
  }
}

function write(sessions: ChurnSession[]) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(sessions.slice(-MAX_SESSIONS)));
  } catch {
    // Private mode or a full quota: telemetry is never worth breaking checkout over.
  }
}

function classify(s: ChurnSession): ExitReason {
  if (s.converted) return 'converted';
  if (s.errored) return 'abandoned_after_error';
  if (s.flagged) return 'abandoned_after_flagged';
  if (s.reachedReview) return 'abandoned_during_review';
  if (s.reachedCheckout) return 'abandoned_after_viewing_price';
  if (s.interactions > 0) return 'abandoned_after_viewing_price';
  return 'abandoned_before_interacting';
}

/** The whole session as one event, so the server always holds the latest rollup. */
function asTrackedEvent(s: ChurnSession) {
  return {
    sessionId: s.id,
    type: 'churn',
    at: Date.now(),
    url: typeof window !== 'undefined' ? window.location.pathname : undefined,
    meta: {
      startedAt: s.startedAt,
      endedAt: s.endedAt,
      engagedMs: s.engagedMs,
      interactions: s.interactions,
      idlePeriods: s.idlePeriods,
      tabSwitches: s.tabSwitches,
      reachedCheckout: s.reachedCheckout,
      reachedReview: s.reachedReview,
      flagged: s.flagged,
      errored: s.errored,
      converted: s.converted,
      exitReason: s.exitReason,
      funnel: s.events.map((e) => e.type),
    },
  };
}

/**
 * Push the session to the backend.
 *
 * `beacon` matters more than it looks: the single most important churn signal is
 * the one fired as the user leaves, and a normal fetch started during pagehide is
 * routinely cancelled when the document goes away. sendBeacon is the one transport
 * the browser promises to finish after the page is gone, so an abandonment is
 * recorded rather than lost — which is exactly the event churn analysis is about.
 */
function push(session: ChurnSession, beacon = false) {
  const payload = JSON.stringify({ events: [asTrackedEvent(session)] });
  try {
    if (beacon && typeof navigator !== 'undefined' && navigator.sendBeacon) {
      navigator.sendBeacon(INGEST_COLLECT_URL, new Blob([payload], { type: 'application/json' }));
      return;
    }
    void fetch(INGEST_COLLECT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      keepalive: beacon,
    }).catch(() => {
      // Telemetry must never break the checkout it is measuring.
    });
  } catch {
    // Same: a failed report is strictly better than a broken page.
  }
}

/** Sessions as the backend has them, i.e. every visitor rather than this browser. */
export async function loadRemoteSessions(): Promise<ChurnSession[]> {
  try {
    const res = await fetch(`${INGEST_EVENTS_URL}?limit=500`);
    if (!res.ok) return [];
    const data = (await res.json()) as { events?: { sessionId: string; type: string; meta?: Record<string, unknown> }[] };
    const latest = new Map<string, ChurnSession>();
    for (const e of data.events ?? []) {
      if (e.type !== 'churn' || !e.meta) continue;
      const m = e.meta as Record<string, unknown>;
      // Later events for a session overwrite earlier ones, so the map ends up
      // holding each visitor's final state rather than a partial mid-session one.
      latest.set(e.sessionId, {
        id: e.sessionId,
        startedAt: Number(m.startedAt) || 0,
        lastActivityAt: Number(m.startedAt) || 0,
        endedAt: m.endedAt ? Number(m.endedAt) : undefined,
        engagedMs: Number(m.engagedMs) || 0,
        interactions: Number(m.interactions) || 0,
        idlePeriods: Number(m.idlePeriods) || 0,
        reachedCheckout: Boolean(m.reachedCheckout),
        reachedReview: Boolean(m.reachedReview),
        flagged: Boolean(m.flagged),
        errored: Boolean(m.errored),
        converted: Boolean(m.converted),
        tabSwitches: Number(m.tabSwitches) || 0,
        events: Array.isArray(m.funnel) ? (m.funnel as string[]).map((t) => ({ type: t, at: 0 })) : [],
        exitReason: (m.exitReason as ExitReason) ?? 'active',
      });
    }
    return [...latest.values()];
  } catch {
    return [];
  }
}

export class ChurnTracker {
  private session: ChurnSession;
  private visibleSince: number | null;
  private idleTimer: number | undefined;
  private detach: (() => void)[] = [];

  constructor() {
    const now = Date.now();
    this.session = {
      id: `s-${now.toString(36)}`,
      startedAt: now,
      lastActivityAt: now,
      engagedMs: 0,
      interactions: 0,
      idlePeriods: 0,
      reachedCheckout: false,
      reachedReview: false,
      flagged: false,
      errored: false,
      converted: false,
      tabSwitches: 0,
      events: [{ type: 'session_start', at: now }],
      exitReason: 'active',
    };
    this.visibleSince = document.visibilityState === 'visible' ? now : null;
    this.persist();
    // Report the session the moment it exists, so a visitor who leaves without
    // ever interacting still shows up as a bounce instead of never existing.
    push(this.session);
  }

  start() {
    const onActivity = () => this.touch();
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        this.settleEngagement();
        this.session.tabSwitches += 1;
        this.session.events.push({ type: 'tab_hidden', at: Date.now() });
        this.persist();
      } else {
        this.visibleSince = Date.now();
        this.touch();
      }
    };
    // pagehide is the only exit signal that survives a real tab close; unload is
    // unreliable and beforeunload does not fire on mobile.
    const onExit = () => this.end();

    ['pointerdown', 'keydown', 'scroll'].forEach((e) => {
      window.addEventListener(e, onActivity, { passive: true });
      this.detach.push(() => window.removeEventListener(e, onActivity));
    });
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onExit);
    this.detach.push(() => document.removeEventListener('visibilitychange', onVisibility));
    this.detach.push(() => window.removeEventListener('pagehide', onExit));

    this.armIdle();
    return () => {
      this.end();
      this.detach.forEach((fn) => fn());
      this.detach = [];
    };
  }

  private settleEngagement() {
    if (this.visibleSince !== null) {
      this.session.engagedMs += Date.now() - this.visibleSince;
      this.visibleSince = null;
    }
  }

  private armIdle() {
    window.clearTimeout(this.idleTimer);
    this.idleTimer = window.setTimeout(() => {
      this.session.idlePeriods += 1;
      this.session.events.push({ type: 'went_idle', at: Date.now() });
      this.persist();
    }, IDLE_MS);
  }

  private touch() {
    this.session.lastActivityAt = Date.now();
    if (this.visibleSince === null) this.visibleSince = Date.now();
    this.armIdle();
  }

  /** Feed the checkout funnel into the session record. */
  record(event: CheckoutAnalyticsEvent) {
    const now = Date.now();
    this.session.interactions += 1;
    this.session.lastActivityAt = now;
    this.session.events.push({ type: event.type, at: now });

    if (event.type === 'checkout_started') this.session.reachedCheckout = true;
    if (event.type === 'review_started') this.session.reachedReview = true;
    if (event.type === 'review_completed' && event.decision !== 'approve') this.session.flagged = true;
    if (event.type === 'checkout_failed') this.session.errored = true;
    if (event.type === 'payment_settled') this.session.converted = true;

    this.armIdle();
    this.persist();
    push(this.session);
  }

  private end() {
    if (this.session.endedAt) return;
    this.settleEngagement();
    this.session.endedAt = Date.now();
    this.session.exitReason = classify(this.session);
    window.clearTimeout(this.idleTimer);
    this.persist();
    // The page is going away: beacon, or the exit reason never reaches the server.
    push(this.session, true);
  }

  private persist() {
    this.settleEngagementSnapshot();
    this.session.exitReason = this.session.endedAt ? this.session.exitReason : classify(this.session);
    const all = read().filter((s) => s.id !== this.session.id);
    write([...all, this.session]);
  }

  // A snapshot must not consume the visible-since marker, or a mid-session write
  // would zero out engagement time that is still accruing.
  private settleEngagementSnapshot() {
    if (this.visibleSince !== null) {
      const now = Date.now();
      this.session.engagedMs += now - this.visibleSince;
      this.visibleSince = now;
    }
  }

  current(): ChurnSession {
    return this.session;
  }
}

export interface ChurnStats {
  totalSessions: number;
  converted: number;
  abandoned: number;
  churnRate: number;
  medianEngagedMs: number;
  bounceRate: number;
  byReason: { reason: ExitReason; count: number }[];
}

export function loadSessions(): ChurnSession[] {
  return read();
}

export function clearSessions() {
  try {
    localStorage.removeItem(STORE_KEY);
  } catch {
    // nothing to do
  }
}

export function summarize(sessions: ChurnSession[]): ChurnStats {
  const finished = sessions.filter((s) => s.exitReason !== 'active');
  const converted = sessions.filter((s) => s.converted).length;
  const abandoned = finished.length - finished.filter((s) => s.converted).length;
  const engaged = [...sessions.map((s) => s.engagedMs)].sort((a, b) => a - b);
  const median = engaged.length ? engaged[Math.floor(engaged.length / 2)] : 0;
  const bounced = sessions.filter((s) => s.interactions === 0).length;

  const counts = new Map<ExitReason, number>();
  sessions.forEach((s) => counts.set(s.exitReason, (counts.get(s.exitReason) ?? 0) + 1));

  return {
    totalSessions: sessions.length,
    converted,
    abandoned,
    churnRate: finished.length ? abandoned / finished.length : 0,
    medianEngagedMs: median,
    bounceRate: sessions.length ? bounced / sessions.length : 0,
    byReason: [...counts.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count),
  };
}
