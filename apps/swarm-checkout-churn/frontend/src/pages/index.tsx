import React, { useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import ButtonBase from '@mui/material/ButtonBase';
import Tooltip from '@mui/material/Tooltip';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CheckIcon from '@mui/icons-material/Check';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';
import SwarmCheckoutButton, { CheckoutAnalyticsEvent, SwarmRiskVerdict } from '@/components/SwarmCheckoutButton';
import ChurnPanel from '@/components/ChurnPanel';
import { ChurnTracker, ChurnSession, loadSessions, loadRemoteSessions, summarize } from '@/analytics/churn';

const DEMO_ITEMS = [
  { name: 'Pro plan (annual)', quantity: 1, unitAmount: 24000 },
  { name: 'Extra seat', quantity: 3, unitAmount: 900 },
];

const USAGE = `import SwarmCheckoutButton from "@/components/SwarmCheckoutButton"

export function CheckoutDemo() {
  return (
    <SwarmCheckoutButton
      items={[
        { name: "Pro plan (annual)", quantity: 1, unitAmount: 24000 },
        { name: "Extra seat", quantity: 3, unitAmount: 900 },
      ]}
      currency="USD"
      signals={{ country: "US", cardCountry: "US", accountAgeDays: 412 }}
      onVerdict={(v) => console.log(v.decision, v.score)}
      onEvent={(e) => analytics.track(e.type, e)}
      onPay={async (verdict) => {
        await fetch("/api/orders", {
          method: "POST",
          body: JSON.stringify({ verdict }),
        })
      }}
    />
  )
}`;

const PROPS: { name: string; type: string; def: string; desc: string }[] = [
  { name: 'items', type: 'CheckoutLineItem[]', def: '—', desc: 'Line items. unitAmount is in minor units (cents).' },
  { name: 'currency', type: 'string', def: '"USD"', desc: 'ISO code used for Intl formatting.' },
  { name: 'signals', type: 'Record<string, string | number | boolean>', def: '—', desc: 'Extra risk context passed to the swarm reviewer.' },
  { name: 'onPay', type: '(v: SwarmRiskVerdict) => Promise<void>', def: '—', desc: 'Runs only after a non-declining verdict.' },
  { name: 'onVerdict', type: '(v: SwarmRiskVerdict) => void', def: '—', desc: 'Fires with every harness verdict.' },
  { name: 'onEvent', type: '(e: CheckoutAnalyticsEvent) => void', def: '—', desc: 'Analytics hook for every funnel step, with timings.' },
  { name: 'label', type: 'string', def: '"Pay now"', desc: 'Idle button label, shown before the amount.' },
  { name: 'disableReview', type: 'boolean', def: 'false', desc: 'Bypass the harness and pay immediately.' },
];

function SyntaxLine({ line }: { line: string }) {
  const c = useClaudeTokens();
  const kw = /^(import|from|export|function|return|await|async|const)$/;
  const tokens = line.split(/(\s+|[<>(){}[\],=."])/).filter(Boolean);
  return (
    <>
      {tokens.map((t, i) => {
        let color = c.text.secondary;
        if (kw.test(t)) color = '#C678DD';
        else if (t.startsWith('"')) color = '#98C379';
        else if (/^[A-Z]/.test(t)) color = '#61AFEF';
        else if (/^\d+$/.test(t)) color = '#D19A66';
        return (
          <Box component="span" key={i} sx={{ color }}>
            {t}
          </Box>
        );
      })}
    </>
  );
}

function CodePanel({ file, code }: { file: string; code: string }) {
  const c = useClaudeTokens();
  const [copied, setCopied] = useState(false);
  const timer = useRef<number>();

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const copy = () => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      timer.current = window.setTimeout(() => setCopied(false), 1600);
    });
  };

  return (
    <Box sx={{ border: `1px solid ${c.border.subtle}`, borderRadius: `${c.radius.lg}px`, overflow: 'hidden' }}>
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        sx={{ px: 2, py: 1.25, bgcolor: c.bg.secondary, borderBottom: `1px solid ${c.border.subtle}` }}
      >
        <Stack direction="row" spacing={1.25} alignItems="center">
          <Box
            sx={{
              width: 18,
              height: 18,
              borderRadius: '4px',
              bgcolor: '#3178C6',
              color: '#fff',
              fontSize: 9,
              fontWeight: 700,
              display: 'grid',
              placeItems: 'center',
            }}
          >
            TS
          </Box>
          <Typography sx={{ fontFamily: c.font.mono, fontSize: 12.5, color: c.text.secondary }}>
            {file}
          </Typography>
        </Stack>
        <Tooltip title={copied ? 'Copied' : 'Copy'}>
          <ButtonBase onClick={copy} sx={{ p: 0.75, borderRadius: `${c.radius.xs}px`, color: c.text.muted }}>
            {copied ? <CheckIcon sx={{ fontSize: 15 }} /> : <ContentCopyIcon sx={{ fontSize: 15 }} />}
          </ButtonBase>
        </Tooltip>
      </Stack>

      <Box sx={{ bgcolor: c.bg.surface, py: 1.5, overflowX: 'auto' }}>
        {code.split('\n').map((line, i) => (
          <Stack key={i} direction="row" spacing={2} sx={{ px: 2, minWidth: 'max-content' }}>
            <Box
              sx={{
                fontFamily: c.font.mono,
                fontSize: 12.5,
                color: c.text.ghost,
                width: 22,
                textAlign: 'right',
                userSelect: 'none',
                flexShrink: 0,
              }}
            >
              {i + 1}
            </Box>
            <Box sx={{ fontFamily: c.font.mono, fontSize: 12.5, lineHeight: 1.7, whiteSpace: 'pre' }}>
              <SyntaxLine line={line} />
            </Box>
          </Stack>
        ))}
      </Box>
    </Box>
  );
}

function EventLog({ events }: { events: CheckoutAnalyticsEvent[] }) {
  const c = useClaudeTokens();
  return (
    <Box sx={{ border: `1px solid ${c.border.subtle}`, borderRadius: `${c.radius.md}px`, overflow: 'hidden' }}>
      <Typography
        sx={{
          px: 1.5,
          py: 1,
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: c.text.muted,
          bgcolor: c.bg.secondary,
          borderBottom: `1px solid ${c.border.subtle}`,
        }}
      >
        Analytics events
      </Typography>
      <Stack sx={{ bgcolor: c.bg.surface, maxHeight: 150, overflowY: 'auto' }}>
        {events.map((e, i) => {
          const { type, ...rest } = e;
          return (
            <Stack
              key={i}
              direction="row"
              spacing={1.5}
              sx={{ px: 1.5, py: 0.75, borderTop: i === 0 ? 'none' : `1px solid ${c.border.subtle}` }}
            >
              <Typography sx={{ fontFamily: c.font.mono, fontSize: 11.5, color: c.accent.primary, flexShrink: 0 }}>
                {type}
              </Typography>
              <Typography sx={{ fontFamily: c.font.mono, fontSize: 11.5, color: c.text.muted }}>
                {Object.entries(rest).map(([k, v]) => `${k}=${v}`).join(' ')}
              </Typography>
            </Stack>
          );
        })}
      </Stack>
    </Box>
  );
}

export default function Home() {
  const c = useClaudeTokens();
  const [tab, setTab] = useState<'preview' | 'code'>('preview');
  const [log, setLog] = useState<SwarmRiskVerdict | null>(null);
  const [events, setEvents] = useState<CheckoutAnalyticsEvent[]>([]);
  const [sessions, setSessions] = useState<ChurnSession[]>(() => loadSessions());
  const payRef = useRef<(() => void) | null>(null);
  const churn = useRef<ChurnTracker>();
  if (!churn.current) churn.current = new ChurnTracker();

  useEffect(() => churn.current!.start(), []);

  // Churn is only interesting in aggregate, and localStorage only ever knows about
  // this one browser. Poll the backend so the panel reflects every visitor, and
  // merge rather than replace so the in-progress local session (not yet reported
  // as ended) is not clobbered by its own older server-side copy.
  useEffect(() => {
    let cancelled = false;
    const sync = async () => {
      const remote = await loadRemoteSessions();
      if (cancelled) return;
      setSessions(() => {
        const local = loadSessions();
        const byId = new Map<string, ChurnSession>();
        remote.forEach((s) => byId.set(s.id, s));
        local.forEach((s) => byId.set(s.id, s));
        return [...byId.values()].sort((a, b) => a.startedAt - b.startedAt);
      });
    };
    void sync();
    const t = setInterval(sync, 5000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  useEffect(() => {
    window.OPENSWARM_APP?.register({
      rules:
        'Docs page for SwarmCheckoutButton, a checkout button whose payment is gated by an OpenSwarm harness risk review. Switch between the Preview and Code tabs.',
      controls: [
        { name: 'showPreview', description: 'Show the live component preview' },
        { name: 'showCode', description: 'Show the usage source code' },
        { name: 'pay', description: 'Press the checkout button and run the risk review' },
      ],
      getState: () => ({
        tab,
        lastVerdict: log,
        analytics: events,
        churn: { stats: summarize(sessions), sessionCount: sessions.length },
      }),
      invoke: (name: string) => {
        if (name === 'showPreview') { setTab('preview'); return { ok: true }; }
        if (name === 'showCode') { setTab('code'); return { ok: true }; }
        if (name === 'pay') {
          if (!payRef.current) throw 'Checkout button not mounted; switch to the Preview tab first';
          payRef.current();
          return { ok: true, note: 'review started; poll getState for lastVerdict' };
        }
        throw `Unknown action: ${name}`;
      },
    });
  }, [tab, log, events, sessions]);

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: c.bg.page, py: 6 }}>
      <Stack spacing={4} sx={{ maxWidth: 860, mx: 'auto', px: 4 }}>
        <Stack spacing={1.5}>
          <Typography sx={{ fontSize: 34, fontWeight: 600, letterSpacing: '-0.02em', color: c.text.primary }}>
            Swarm Checkout
          </Typography>
          <Typography sx={{ fontSize: 15, color: c.text.tertiary, lineHeight: 1.6, maxWidth: 620 }}>
            A checkout button that runs a real risk review through the OpenSwarm harness before it
            takes money. Approve clears instantly, review asks the shopper to confirm, decline locks
            the button.
          </Typography>
        </Stack>

        <Stack direction="row" spacing={0.5}>
          {(['preview', 'code'] as const).map((t) => (
            <ButtonBase
              key={t}
              onClick={() => setTab(t)}
              sx={{
                px: 1.75,
                py: 0.75,
                borderRadius: `${c.radius.sm}px`,
                fontSize: 14,
                fontWeight: 500,
                textTransform: 'capitalize',
                color: tab === t ? c.text.primary : c.text.muted,
                bgcolor: tab === t ? c.bg.surface : 'transparent',
                border: `1px solid ${tab === t ? c.border.medium : 'transparent'}`,
                transition: c.transition,
              }}
            >
              {t}
            </ButtonBase>
          ))}
        </Stack>

        {tab === 'preview' ? (
          <Box
            sx={{
              border: `1px solid ${c.border.subtle}`,
              borderRadius: `${c.radius.lg}px`,
              bgcolor: c.bg.elevated,
              display: 'grid',
              placeItems: 'center',
              p: 5,
              minHeight: 380,
            }}
          >
            <Stack spacing={2.5} sx={{ width: '100%', maxWidth: 380 }}>
              <SwarmCheckoutButton
                items={DEMO_ITEMS}
                currency="USD"
                signals={{ country: 'US', cardCountry: 'US', accountAgeDays: 412 }}
                onVerdict={setLog}
                onEvent={(e) => {
                  setEvents((prev) => [...prev, e]);
                  churn.current!.record(e);
                  setSessions(loadSessions());
                }}
                onReady={(trigger) => { payRef.current = trigger; }}
              />
              {events.length > 0 && <EventLog events={events} />}
              <ChurnPanel sessions={sessions} onReset={() => setSessions(loadSessions())} />
            </Stack>
          </Box>
        ) : (
          <CodePanel file="components/ui/swarm-checkout-demo.tsx" code={USAGE} />
        )}

        <Stack spacing={1.5}>
          <Typography sx={{ fontSize: 19, fontWeight: 600, color: c.text.primary }}>Props</Typography>
          <Box sx={{ border: `1px solid ${c.border.subtle}`, borderRadius: `${c.radius.lg}px`, overflow: 'hidden' }}>
            {PROPS.map((p, i) => (
              <Stack
                key={p.name}
                spacing={0.5}
                sx={{
                  px: 2,
                  py: 1.5,
                  bgcolor: c.bg.surface,
                  borderTop: i === 0 ? 'none' : `1px solid ${c.border.subtle}`,
                }}
              >
                <Stack direction="row" spacing={1.5} alignItems="baseline" flexWrap="wrap">
                  <Typography sx={{ fontFamily: c.font.mono, fontSize: 13, color: c.text.primary }}>
                    {p.name}
                  </Typography>
                  <Typography sx={{ fontFamily: c.font.mono, fontSize: 12, color: c.accent.primary }}>
                    {p.type}
                  </Typography>
                  <Typography sx={{ fontFamily: c.font.mono, fontSize: 12, color: c.text.ghost }}>
                    {p.def}
                  </Typography>
                </Stack>
                <Typography sx={{ fontSize: 13, color: c.text.tertiary }}>{p.desc}</Typography>
              </Stack>
            ))}
          </Box>
        </Stack>

        <Typography sx={{ fontSize: 12.5, color: c.text.muted, lineHeight: 1.6 }}>
          The verdict comes from llm() in @/openswarmHost, which calls the OpenSwarm harness on
          localhost:8324 using your own configured provider. No payment is actually charged in this
          demo.
        </Typography>
      </Stack>
    </Box>
  );
}
