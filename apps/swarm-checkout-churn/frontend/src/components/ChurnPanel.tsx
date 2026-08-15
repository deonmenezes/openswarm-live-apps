import React, { useCallback, useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import ButtonBase from '@mui/material/ButtonBase';
import CircularProgress from '@mui/material/CircularProgress';
import Collapse from '@mui/material/Collapse';
import LinearProgress from '@mui/material/LinearProgress';
import InsightsIcon from '@mui/icons-material/QueryStats';
import BoltIcon from '@mui/icons-material/Bolt';
import CheckIcon from '@mui/icons-material/Check';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';
import { llm, createWorkflow, isInsideOpenSwarm } from '@/openswarmHost';
import { ChurnSession, summarize, clearSessions } from '@/analytics/churn';

const REASON_LABEL: Record<string, string> = {
  abandoned_before_interacting: 'Left without touching anything',
  abandoned_after_viewing_price: 'Left after seeing the price',
  abandoned_during_review: 'Left while the risk review ran',
  abandoned_after_flagged: 'Left after being flagged for review',
  abandoned_after_error: 'Left after an error',
  converted: 'Completed payment',
  active: 'Still in session',
};

interface Diagnosis {
  headline: string;
  causes: { cause: string; evidence: string; fix: string }[];
}

const DIAGNOSE_SYSTEM = [
  'You are a product analyst diagnosing user churn in a checkout app.',
  'You get aggregate session telemetry. Identify why users leave.',
  'Reply with ONLY JSON, no prose, no fences:',
  '{"headline":"<one sentence verdict>","causes":[{"cause":"<short>","evidence":"<cite a number from the data>","fix":"<concrete action>"}]}',
  'Give at most 3 causes, ordered by impact. Be specific, never generic advice.',
].join(' ');

function pct(n: number) {
  return `${Math.round(n * 100)}%`;
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  const c = useClaudeTokens();
  return (
    <Stack spacing={0.25} sx={{ flex: 1, minWidth: 88 }}>
      <Typography sx={{ fontSize: 20, fontWeight: 600, color: tone ?? c.text.primary, fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </Typography>
      <Typography sx={{ fontSize: 11, color: c.text.muted }}>{label}</Typography>
    </Stack>
  );
}

export default function ChurnPanel({
  sessions,
  onReset,
}: {
  sessions: ChurnSession[];
  onReset: () => void;
}) {
  const c = useClaudeTokens();
  const [diagnosis, setDiagnosis] = useState<Diagnosis | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [workflowId, setWorkflowId] = useState<string | null>(null);

  const stats = useMemo(() => summarize(sessions), [sessions]);
  const worst = stats.byReason.find((r) => r.reason !== 'converted' && r.reason !== 'active');

  const diagnose = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const payload = {
        total_sessions: stats.totalSessions,
        converted: stats.converted,
        churn_rate: Number(stats.churnRate.toFixed(2)),
        bounce_rate: Number(stats.bounceRate.toFixed(2)),
        median_engaged_seconds: Math.round(stats.medianEngagedMs / 1000),
        exit_reasons: stats.byReason,
        sessions: sessions.slice(-12).map((s) => ({
          engaged_seconds: Math.round(s.engagedMs / 1000),
          interactions: s.interactions,
          idle_periods: s.idlePeriods,
          tab_switches: s.tabSwitches,
          reached_review: s.reachedReview,
          flagged: s.flagged,
          errored: s.errored,
          converted: s.converted,
          exit: s.exitReason,
          funnel: s.events.map((e) => e.type),
        })),
      };
      const raw = await llm(`Diagnose churn in this app:\n${JSON.stringify(payload)}`, {
        system: DIAGNOSE_SYSTEM,
        maxTokens: 600,
      });
      const start = raw.indexOf('{');
      const end = raw.lastIndexOf('}');
      if (start === -1 || end <= start) throw new Error('Analyst returned no JSON');
      const parsed = JSON.parse(raw.slice(start, end + 1)) as Diagnosis;
      setDiagnosis({ headline: parsed.headline, causes: parsed.causes ?? [] });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [stats, sessions]);

  const makeWorkflow = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const fixes = diagnosis?.causes.map((x, i) => `${i + 1}. ${x.cause} — ${x.fix}`).join('\n') ?? 'None yet.';
      const wf = await createWorkflow({
        title: 'Checkout churn watch',
        description: 'Reviews checkout abandonment telemetry and reports why users are dropping off.',
        steps: [
          {
            label: 'Read churn telemetry',
            text: 'Open the Swarm Checkout app and read its churn telemetry: total sessions, churn rate, bounce rate, median engaged time, and the breakdown of exit reasons.',
          },
          {
            label: 'Compare against last run',
            text: `Compare today's churn rate and exit-reason mix against the previous run. Flag any exit reason that grew by more than 10 percentage points. Known issues from the last diagnosis:\n${fixes}`,
          },
          {
            label: 'Report the top drop-off',
            text: 'Write a short report naming the single biggest drop-off point, the number backing it, and one concrete fix. If churn is below 20%, say so in one line and stop.',
          },
        ],
        schedule: { enabled: true, repeat_every: 1, repeat_unit: 'day', hour: 9, minute: 0 },
      });
      setWorkflowId(String(wf.id ?? ''));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [diagnosis]);

  const churnTone = stats.churnRate > 0.5 ? c.status.error : stats.churnRate > 0.25 ? c.text.primary : c.status.success;

  return (
    <Box sx={{ border: `1px solid ${c.border.subtle}`, borderRadius: `${c.radius.lg}px`, overflow: 'hidden' }}>
      <Stack
        direction="row"
        alignItems="center"
        spacing={1}
        sx={{ px: 2, py: 1.25, bgcolor: c.bg.secondary, borderBottom: `1px solid ${c.border.subtle}` }}
      >
        <InsightsIcon sx={{ fontSize: 16, color: c.text.muted }} />
        <Typography sx={{ fontSize: 13, fontWeight: 600, color: c.text.primary, flex: 1 }}>
          Churn
        </Typography>
        <ButtonBase
          onClick={() => { clearSessions(); onReset(); setDiagnosis(null); setWorkflowId(null); }}
          sx={{ fontSize: 11.5, color: c.text.muted, px: 1, py: 0.5, borderRadius: `${c.radius.xs}px` }}
        >
          Reset
        </ButtonBase>
      </Stack>

      <Stack spacing={2} sx={{ p: 2, bgcolor: c.bg.surface }}>
        <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
          <Stat label="Sessions" value={String(stats.totalSessions)} />
          <Stat label="Churn rate" value={pct(stats.churnRate)} tone={churnTone} />
          <Stat label="Bounced" value={pct(stats.bounceRate)} />
          <Stat label="Median time" value={`${Math.round(stats.medianEngagedMs / 1000)}s`} />
        </Stack>

        {stats.byReason.length > 0 && (
          <Stack spacing={1}>
            {stats.byReason.map((r) => (
              <Stack key={r.reason} spacing={0.5}>
                <Stack direction="row" justifyContent="space-between">
                  <Typography sx={{ fontSize: 12, color: c.text.secondary }}>
                    {REASON_LABEL[r.reason] ?? r.reason}
                  </Typography>
                  <Typography sx={{ fontSize: 12, color: c.text.muted, fontVariantNumeric: 'tabular-nums' }}>
                    {r.count}
                  </Typography>
                </Stack>
                <LinearProgress
                  variant="determinate"
                  value={(r.count / Math.max(1, stats.totalSessions)) * 100}
                  sx={{
                    height: 4,
                    borderRadius: 2,
                    bgcolor: c.bg.secondary,
                    '& .MuiLinearProgress-bar': {
                      bgcolor: r.reason === 'converted' ? c.status.success : c.accent.primary,
                      borderRadius: 2,
                    },
                  }}
                />
              </Stack>
            ))}
          </Stack>
        )}

        {worst && (
          <Typography sx={{ fontSize: 12, color: c.text.tertiary, lineHeight: 1.6 }}>
            Biggest leak: <b>{REASON_LABEL[worst.reason] ?? worst.reason}</b> ({worst.count} of{' '}
            {stats.totalSessions}).
          </Typography>
        )}

        {/* Operator-only: both actions call the OpenSwarm host on localhost, which a
            public visitor does not have. Hidden rather than shown-and-broken. */}
        <Stack direction="row" spacing={1} sx={{ display: isInsideOpenSwarm() ? 'flex' : 'none' }}>
          <ButtonBase
            onClick={diagnose}
            disabled={busy || stats.totalSessions === 0}
            sx={{
              flex: 1,
              height: 36,
              borderRadius: `${c.radius.sm}px`,
              bgcolor: c.accent.primary,
              color: '#fff',
              fontSize: 13,
              fontWeight: 600,
              gap: 0.75,
              transition: c.transition,
              '&.Mui-disabled': { opacity: 0.45, color: '#fff' },
            }}
          >
            {busy && <CircularProgress size={13} thickness={5} sx={{ color: '#fff' }} />}
            {diagnosis ? 'Re-diagnose' : 'Diagnose churn'}
          </ButtonBase>
          <ButtonBase
            onClick={makeWorkflow}
            disabled={busy || Boolean(workflowId)}
            sx={{
              flex: 1,
              height: 36,
              borderRadius: `${c.radius.sm}px`,
              border: `1px solid ${c.border.medium}`,
              color: c.text.secondary,
              fontSize: 13,
              fontWeight: 600,
              gap: 0.75,
              transition: c.transition,
              '&.Mui-disabled': { opacity: 0.55 },
            }}
          >
            {workflowId ? <CheckIcon sx={{ fontSize: 15 }} /> : <BoltIcon sx={{ fontSize: 15 }} />}
            {workflowId ? 'Workflow created' : 'Create watch workflow'}
          </ButtonBase>
        </Stack>

        <Collapse in={Boolean(diagnosis || error || workflowId)}>
          {error ? (
            <Typography sx={{ fontSize: 12, color: c.status.error, p: 1.25, borderRadius: `${c.radius.sm}px`, bgcolor: c.status.errorBg }}>
              {error}
            </Typography>
          ) : workflowId && !diagnosis ? (
            <Typography sx={{ fontSize: 12, color: c.text.secondary, p: 1.25, borderRadius: `${c.radius.sm}px`, bgcolor: c.status.successBg }}>
              Daily churn watch workflow saved to your Workflows hub.
            </Typography>
          ) : diagnosis ? (
            <Stack spacing={1.25} sx={{ p: 1.5, borderRadius: `${c.radius.sm}px`, bgcolor: c.bg.secondary }}>
              <Typography sx={{ fontSize: 13, fontWeight: 600, color: c.text.primary, lineHeight: 1.5 }}>
                {diagnosis.headline}
              </Typography>
              {diagnosis.causes.map((x, i) => (
                <Stack key={i} spacing={0.25}>
                  <Typography sx={{ fontSize: 12.5, color: c.text.secondary, fontWeight: 600 }}>
                    {x.cause}
                  </Typography>
                  <Typography sx={{ fontSize: 12, color: c.text.muted, lineHeight: 1.5 }}>
                    {x.evidence}
                  </Typography>
                  <Typography sx={{ fontSize: 12, color: c.accent.primary, lineHeight: 1.5 }}>
                    Fix: {x.fix}
                  </Typography>
                </Stack>
              ))}
            </Stack>
          ) : null}
        </Collapse>
      </Stack>
    </Box>
  );
}
