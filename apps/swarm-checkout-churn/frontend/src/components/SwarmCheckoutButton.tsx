import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import ButtonBase from '@mui/material/ButtonBase';
import CircularProgress from '@mui/material/CircularProgress';
import Collapse from '@mui/material/Collapse';
import LockIcon from '@mui/icons-material/Lock';
import CheckIcon from '@mui/icons-material/Check';
import ShieldIcon from '@mui/icons-material/GppGood';
import WarningIcon from '@mui/icons-material/ReportGmailerrorred';
import { motion, AnimatePresence } from 'framer-motion';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';
import { llm } from '@/openswarmHost';

export interface CheckoutLineItem {
  name: string;
  quantity: number;
  /** Unit price in minor units (cents), so no float drift. */
  unitAmount: number;
}

export interface SwarmRiskVerdict {
  decision: 'approve' | 'review' | 'decline';
  score: number;
  reason: string;
}

export type CheckoutAnalyticsEvent =
  | { type: 'checkout_started'; totalMinor: number; currency: string; itemCount: number }
  | { type: 'review_started' }
  | { type: 'review_completed'; engine: 'harness' | 'local' | 'rules'; decision: SwarmRiskVerdict['decision']; score: number; durationMs: number }
  | { type: 'review_override'; score: number }
  | { type: 'payment_settled'; decision: SwarmRiskVerdict['decision']; totalMinor: number; currency: string; durationMs: number }
  | { type: 'checkout_failed'; message: string; durationMs: number };

export interface SwarmCheckoutButtonProps {
  items: CheckoutLineItem[];
  currency?: string;
  /** Extra signals handed to the swarm reviewer (country, device, email age...). */
  signals?: Record<string, string | number | boolean>;
  /** Runs only after the harness returns a non-declining verdict. */
  onPay?: (verdict: SwarmRiskVerdict) => Promise<void> | void;
  onVerdict?: (verdict: SwarmRiskVerdict) => void;
  /** Fires at every step of the checkout funnel, for analytics. */
  onEvent?: (event: CheckoutAnalyticsEvent) => void;
  label?: string;
  /** Skip the harness review and pay straight away. */
  disableReview?: boolean;
  /** Hands the caller a function that triggers the same flow as pressing the button. */
  onReady?: (trigger: () => void) => void;
}

type Phase = 'idle' | 'reviewing' | 'flagged' | 'paying' | 'paid' | 'error';

const REVIEW_SYSTEM = [
  'You are a payment risk engine inside a checkout flow.',
  'Given an order, reply with ONLY a JSON object, no prose and no code fences:',
  '{"decision":"approve"|"review"|"decline","score":<0-100 risk score>,"reason":"<max 12 words>"}',
  'Approve ordinary consumer orders. Reserve decline for clear fraud signals.',
].join(' ');

function formatAmount(minor: number, currency: string): string {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(minor / 100);
}

const OLLAMA_URL = 'http://localhost:11434/api/chat';
const OLLAMA_MODEL = 'qwen2.5-coder:7b';

// The harness 502s when OpenSwarm has no provider credential configured. A local
// Ollama daemon is the offline path, so the review still runs rather than the
// button silently doing nothing.
async function reviewLocally(prompt: string): Promise<string> {
  const res = await fetch(OLLAMA_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      stream: false,
      format: 'json',
      options: { temperature: 0 },
      messages: [
        { role: 'system', content: REVIEW_SYSTEM },
        { role: 'user', content: prompt },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Local model ${res.status}`);
  const data = await res.json();
  return data.message.content as string;
}

/**
 * Last-resort verdict with no network at all.
 *
 * Both engines above talk to localhost — the harness on 8324, Ollama on 11434 —
 * which resolve to whatever machine is VIEWING the page. That is fine in OpenSwarm
 * and simply absent for a visitor on a public deployment, where the https page also
 * refuses to call http://localhost as mixed content. Without this the button spins
 * forever for every real visitor, and the funnel it exists to measure never
 * completes. These are the same signals a rules engine would check before spending
 * money on a model call, so the demo stays honest: it just says which engine ruled.
 */
function reviewWithRules(order: {
  total_minor: number;
  signals: Record<string, string | number | boolean>;
}): SwarmRiskVerdict {
  const s = order.signals ?? {};
  let score = 10;
  const reasons: string[] = [];

  const total = order.total_minor ?? 0;
  if (total > 100_000) { score += 35; reasons.push('order over $1,000'); }
  else if (total > 50_000) { score += 20; reasons.push('order over $500'); }

  const country = String(s.country ?? '');
  const cardCountry = String(s.cardCountry ?? '');
  if (country && cardCountry && country !== cardCountry) {
    score += 30;
    reasons.push(`billing country ${cardCountry} differs from ${country}`);
  }

  const age = Number(s.accountAgeDays);
  if (Number.isFinite(age)) {
    if (age < 1) { score += 30; reasons.push('account created today'); }
    else if (age < 30) { score += 15; reasons.push('account under 30 days old'); }
  }

  score = Math.max(0, Math.min(100, score));
  const decision: SwarmRiskVerdict['decision'] = score >= 70 ? 'decline' : score >= 40 ? 'review' : 'approve';
  return {
    decision,
    score,
    reason: reasons.length ? reasons.join('; ') : 'no risk signals triggered',
  };
}

// The model is told to return bare JSON, but real models still wrap it in prose or
// fences often enough that the first `{...}` span is the only reliable anchor.
function parseVerdict(raw: string): SwarmRiskVerdict {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('Risk engine returned no verdict');
  const parsed = JSON.parse(raw.slice(start, end + 1)) as Partial<SwarmRiskVerdict>;
  const decision =
    parsed.decision === 'decline' || parsed.decision === 'review' ? parsed.decision : 'approve';
  return {
    decision,
    score: typeof parsed.score === 'number' ? parsed.score : 0,
    reason: parsed.reason ?? 'No reason given',
  };
}

export default function SwarmCheckoutButton({
  items,
  currency = 'USD',
  signals,
  onPay,
  onVerdict,
  onEvent,
  label = 'Pay now',
  disableReview = false,
  onReady,
}: SwarmCheckoutButtonProps) {
  const c = useClaudeTokens();
  const [phase, setPhase] = useState<Phase>('idle');
  const [verdict, setVerdict] = useState<SwarmRiskVerdict | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [engine, setEngine] = useState<'harness' | 'local' | 'rules' | null>(null);

  // Held in a ref so an inline onEvent prop doesn't churn handleClick's identity,
  // which would re-fire onReady on every render.
  const eventRef = useRef(onEvent);
  eventRef.current = onEvent;
  const track = useCallback((event: CheckoutAnalyticsEvent) => eventRef.current?.(event), []);

  const total = useMemo(
    () => items.reduce((sum, i) => sum + i.unitAmount * i.quantity, 0),
    [items],
  );

  const settle = useCallback(
    async (v: SwarmRiskVerdict) => {
      const startedAt = performance.now();
      setPhase('paying');
      await onPay?.(v);
      setPhase('paid');
      track({
        type: 'payment_settled',
        decision: v.decision,
        totalMinor: total,
        currency,
        durationMs: Math.round(performance.now() - startedAt),
      });
    },
    [onPay, track, total, currency],
  );

  const handleClick = useCallback(async () => {
    if (phase === 'reviewing' || phase === 'paying' || phase === 'paid') return;

    // Second press on a flagged order = the shopper overriding a soft "review".
    if (phase === 'flagged' && verdict) {
      track({ type: 'review_override', score: verdict.score });
      await settle(verdict);
      return;
    }

    setError(null);
    track({ type: 'checkout_started', totalMinor: total, currency, itemCount: items.length });

    if (disableReview) {
      await settle({ decision: 'approve', score: 0, reason: 'Review disabled' });
      return;
    }

    setPhase('reviewing');
    const reviewStartedAt = performance.now();
    try {
      const order = {
        currency,
        total_minor: total,
        items: items.map((i) => ({ name: i.name, qty: i.quantity, unit_minor: i.unitAmount })),
        signals: signals ?? {},
      };
      const prompt = `Assess this order:\n${JSON.stringify(order)}`;
      track({ type: 'review_started' });
      let v: SwarmRiskVerdict;
      let usedEngine: 'harness' | 'local' | 'rules';
      try {
        v = parseVerdict(await llm(prompt, { system: REVIEW_SYSTEM, maxTokens: 200 }));
        usedEngine = 'harness';
      } catch {
        try {
          v = parseVerdict(await reviewLocally(prompt));
          usedEngine = 'local';
        } catch {
          // Neither model is reachable from this machine; rule on the signals
          // directly rather than leaving the shopper on a spinner.
          v = reviewWithRules(order);
          usedEngine = 'rules';
        }
      }
      setEngine(usedEngine);
      setVerdict(v);
      onVerdict?.(v);
      track({
        type: 'review_completed',
        engine: usedEngine,
        decision: v.decision,
        score: v.score,
        durationMs: Math.round(performance.now() - reviewStartedAt),
      });

      if (v.decision === 'approve') await settle(v);
      else setPhase('flagged');
    } catch (e) {
      console.error('[swarm-checkout] harness failed:', e);
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      setPhase('error');
      track({
        type: 'checkout_failed',
        message,
        durationMs: Math.round(performance.now() - reviewStartedAt),
      });
    }
  }, [phase, verdict, disableReview, settle, currency, total, items, signals, onVerdict, track]);

  useEffect(() => {
    onReady?.(handleClick);
  }, [onReady, handleClick]);

  const declined = verdict?.decision === 'decline';
  const busy = phase === 'reviewing' || phase === 'paying';
  const locked = busy || phase === 'paid' || declined;

  const face = (() => {
    if (phase === 'reviewing') return { text: 'Swarm reviewing order', icon: null };
    if (phase === 'paying') return { text: 'Processing payment', icon: null };
    if (phase === 'paid') return { text: 'Payment complete', icon: <CheckIcon sx={{ fontSize: 18 }} /> };
    if (phase === 'error') return { text: 'Retry payment', icon: <WarningIcon sx={{ fontSize: 18 }} /> };
    if (phase === 'flagged') {
      return declined
        ? { text: 'Payment declined', icon: <WarningIcon sx={{ fontSize: 18 }} /> }
        : { text: 'Confirm anyway', icon: <LockIcon sx={{ fontSize: 16 }} /> };
    }
    return { text: `${label} · ${formatAmount(total, currency)}`, icon: <LockIcon sx={{ fontSize: 16 }} /> };
  })();

  const bg = phase === 'paid' ? c.status.success : declined ? c.status.error : c.accent.primary;

  return (
    <Stack spacing={1.5} sx={{ width: '100%', maxWidth: 380 }}>
      <Box
        sx={{
          border: `1px solid ${c.border.subtle}`,
          borderRadius: `${c.radius.lg}px`,
          bgcolor: c.bg.surface,
          overflow: 'hidden',
        }}
      >
        <Stack spacing={1.25} sx={{ p: 2 }}>
          {items.map((item) => (
            <Stack key={item.name} direction="row" justifyContent="space-between" spacing={2}>
              <Typography sx={{ fontSize: 13, color: c.text.secondary }}>
                {item.name}
                {item.quantity > 1 && (
                  <Box component="span" sx={{ color: c.text.muted }}> × {item.quantity}</Box>
                )}
              </Typography>
              <Typography sx={{ fontSize: 13, color: c.text.primary, fontVariantNumeric: 'tabular-nums' }}>
                {formatAmount(item.unitAmount * item.quantity, currency)}
              </Typography>
            </Stack>
          ))}
        </Stack>

        <Stack
          direction="row"
          justifyContent="space-between"
          sx={{ px: 2, py: 1.5, borderTop: `1px solid ${c.border.subtle}`, bgcolor: c.bg.secondary }}
        >
          <Typography sx={{ fontSize: 13, fontWeight: 600, color: c.text.primary }}>Total</Typography>
          <Typography
            sx={{ fontSize: 13, fontWeight: 600, color: c.text.primary, fontVariantNumeric: 'tabular-nums' }}
          >
            {formatAmount(total, currency)}
          </Typography>
        </Stack>
      </Box>

      <ButtonBase
        onClick={handleClick}
        disabled={locked}
        sx={{
          position: 'relative',
          width: '100%',
          height: 46,
          borderRadius: `${c.radius.md}px`,
          bgcolor: bg,
          color: '#fff',
          fontSize: 14,
          fontWeight: 600,
          overflow: 'hidden',
          transition: c.transition,
          boxShadow: c.shadow.sm,
          '&:hover': { bgcolor: locked ? bg : c.accent.hover },
          '&.Mui-disabled': { color: '#fff', opacity: phase === 'paid' || declined ? 1 : 0.9 },
        }}
      >
        {busy && (
          <Box
            component={motion.div}
            aria-hidden
            initial={{ x: '-100%' }}
            animate={{ x: '100%' }}
            transition={{ duration: 1.1, repeat: Infinity, ease: 'linear' }}
            sx={{
              position: 'absolute',
              inset: 0,
              background: 'linear-gradient(90deg,transparent,rgba(255,255,255,0.28),transparent)',
            }}
          />
        )}
        <Stack direction="row" spacing={1} alignItems="center" sx={{ zIndex: 1 }}>
          {busy ? <CircularProgress size={15} thickness={5} sx={{ color: '#fff' }} /> : face.icon}
          <span>{face.text}</span>
        </Stack>
      </ButtonBase>

      <Collapse in={Boolean(verdict) || Boolean(error)}>
        <AnimatePresence mode="wait">
          <Box
            component={motion.div}
            key={error ?? verdict?.reason ?? 'none'}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            sx={{
              display: 'flex',
              gap: 1,
              alignItems: 'flex-start',
              p: 1.25,
              borderRadius: `${c.radius.sm}px`,
              bgcolor: error || declined ? c.status.errorBg : c.status.successBg,
            }}
          >
            {error || declined ? (
              <WarningIcon sx={{ fontSize: 16, color: c.status.error, mt: '1px' }} />
            ) : (
              <ShieldIcon sx={{ fontSize: 16, color: c.status.success, mt: '1px' }} />
            )}
            <Typography sx={{ fontSize: 12, color: c.text.secondary, lineHeight: 1.5 }}>
              {error ?? (
                <>
                  Swarm verdict: <b>{verdict?.decision}</b> · risk {verdict?.score}/100 — {verdict?.reason}
                  <Box component="span" sx={{ color: c.text.muted }}>
                    {engine === 'local'
                      ? ' · reviewed locally'
                      : engine === 'rules'
                        ? ' · reviewed by rules'
                        : ' · reviewed by harness'}
                  </Box>
                </>
              )}
            </Typography>
          </Box>
        </AnimatePresence>
      </Collapse>
    </Stack>
  );
}
