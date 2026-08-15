// The inspector half of the testbed: what the durable store actually holds, plus
// a live exercise of the host SDK (workflows + LLM). Kept on its own route so the
// checkout page stays a clean subject and this page is the instrumentation.

import React, { useCallback, useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';
import {
  clearAll,
  fetchEvents,
  fetchOrders,
  fetchSessions,
  money,
  type Order,
  type ServerEvent,
  type SessionRollup,
} from '@/estate/api';
import { llm, listWorkflows, type WorkflowSummary } from '@/openswarmHost';

const Panel: React.FC<{ title: string; action?: React.ReactNode; children: React.ReactNode }> = ({
  title,
  action,
  children,
}) => {
  const c = useClaudeTokens();
  return (
    <Box
      sx={{
        bgcolor: c.bg.surface,
        border: `1px solid ${c.border.subtle}`,
        borderRadius: `${c.radius.xl}px`,
        overflow: 'hidden',
      }}
    >
      <Box
        sx={{
          px: 2.5,
          py: 1.75,
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
          borderBottom: `1px solid ${c.border.subtle}`,
        }}
      >
        <Typography sx={{ fontWeight: 600, fontSize: '0.88rem', color: c.text.primary }}>
          {title}
        </Typography>
        <Box sx={{ ml: 'auto' }}>{action}</Box>
      </Box>
      <Box sx={{ p: 2.5 }}>{children}</Box>
    </Box>
  );
};

const Sessions: React.FC = () => {
  const c = useClaudeTokens();
  const [sessions, setSessions] = useState<SessionRollup[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [revenue, setRevenue] = useState(0);
  const [events, setEvents] = useState<ServerEvent[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowSummary[] | null>(null);
  const [hostError, setHostError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string>('');
  const [thinking, setThinking] = useState(false);

  const refresh = useCallback(async () => {
    const [s, o, e] = await Promise.all([fetchSessions(), fetchOrders(), fetchEvents(400)]);
    setSessions(s);
    setOrders(o.orders);
    setRevenue(o.depositRevenue);
    setEvents(e);
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 4000);
    return () => clearInterval(t);
  }, [refresh]);

  useEffect(() => {
    listWorkflows()
      .then(setWorkflows)
      .catch((err: Error) =>
        // The host token rides in the preview URL. Opened directly (no ?token=)
        // every host call 401s, which is a environment fact, not a broken app.
        setHostError(
          /401|unauthorized/i.test(err.message)
            ? 'No host token — open this app from its OpenSwarm card to reach host APIs.'
            : err.message,
        ),
      );
  }, []);

  const blocked = events.filter((e) => e.type === 'blocked').length;
  const leaked = events.filter(
    (e) => e.field && /card|cvv|password|ssn/i.test(e.field) && e.value,
  ).length;

  async function summarise() {
    setThinking(true);
    try {
      const text = await llm(
        `Funnel data from a property checkout testbed. Sessions: ${sessions.length}, ` +
          `orders: ${orders.length}, deposit revenue: ${revenue}. ` +
          `Furthest steps: ${sessions.map((s) => s.furthestStep).join(', ') || 'none'}. ` +
          'In two sentences, what does this funnel suggest?',
        { maxTokens: 220 },
      );
      setSummary(text);
    } catch (err) {
      setSummary(`host llm unavailable: ${(err as Error).message}`);
    } finally {
      setThinking(false);
    }
  }

  const mono = { fontFamily: c.font.mono, fontSize: '0.78rem', color: c.text.secondary };

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: c.bg.page, p: 4 }}>
      <Typography sx={{ fontWeight: 650, fontSize: '1.25rem', color: c.text.primary }}>
        Store inspector
      </Typography>
      <Typography sx={{ fontSize: '0.82rem', color: c.text.muted, mb: 3 }}>
        What survived the pipeline, straight from backend/data/store.json
      </Typography>

      <Box sx={{ display: 'grid', gap: 2.5, gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))' }}>
        <Panel
          title="Redaction audit"
          action={
            <Chip
              label={leaked === 0 ? 'clean' : `${leaked} leaked`}
              size="small"
              sx={{
                bgcolor: leaked === 0 ? c.status.successBg : c.status.errorBg,
                color: leaked === 0 ? c.status.success : c.status.error,
                fontWeight: 700,
                fontSize: '0.7rem',
              }}
            />
          }
        >
          <Typography sx={mono}>events stored: {events.length}</Typography>
          <Typography sx={mono}>secret-field attempts blocked: {blocked}</Typography>
          <Typography sx={{ ...mono, color: leaked === 0 ? c.status.success : c.status.error }}>
            sensitive values persisted: {leaked}
          </Typography>
          <Typography sx={{ fontSize: '0.74rem', color: c.text.ghost, mt: 1.25 }}>
            Counts scan every stored event for a value on a card/cvv/password/ssn field. Zero is the
            only passing number.
          </Typography>
        </Panel>

        <Panel
          title="Sessions"
          action={
            <Button
              size="small"
              onClick={() => void clearAll().then(refresh)}
              sx={{ textTransform: 'none', fontSize: '0.75rem', color: c.text.tertiary }}
            >
              Clear store
            </Button>
          }
        >
          {sessions.length === 0 && (
            <Typography sx={{ fontSize: '0.8rem', color: c.text.ghost }}>No sessions yet.</Typography>
          )}
          {sessions.map((s) => (
            <Box key={s.sessionId} sx={{ display: 'flex', gap: 1.5, alignItems: 'baseline', py: 0.6 }}>
              <Typography sx={{ ...mono, minWidth: 92 }}>{s.sessionId}</Typography>
              <Chip
                label={s.furthestStep}
                size="small"
                sx={{
                  height: 19,
                  fontSize: '0.65rem',
                  bgcolor: s.converted ? c.status.successBg : `${c.text.primary}0A`,
                  color: s.converted ? c.status.success : c.text.tertiary,
                }}
              />
              <Typography sx={{ ...mono, color: c.text.ghost, ml: 'auto' }}>
                {s.eventCount} events
              </Typography>
            </Box>
          ))}
        </Panel>

        <Panel title="Orders" action={<Typography sx={{ ...mono }}>{money(revenue)}</Typography>}>
          {orders.length === 0 && (
            <Typography sx={{ fontSize: '0.8rem', color: c.text.ghost }}>No orders yet.</Typography>
          )}
          {orders.map((o) => (
            <Box key={o.id} sx={{ py: 0.6 }}>
              <Typography sx={mono}>
                {o.id} · {o.buyerName} · {o.buyerEmail}
              </Typography>
              <Typography sx={{ ...mono, color: c.text.ghost }}>
                {o.listingTitle} — {money(o.deposit)} deposit
              </Typography>
            </Box>
          ))}
        </Panel>

        <Panel title="Host SDK">
          <Typography sx={{ fontSize: '0.78rem', color: c.text.tertiary, mb: 1 }}>
            Workflows
          </Typography>
          {hostError && (
            <Typography sx={{ ...mono, color: c.status.error }}>{hostError}</Typography>
          )}
          {workflows && workflows.length === 0 && (
            <Typography sx={{ ...mono, color: c.text.ghost }}>none saved</Typography>
          )}
          {workflows?.map((w) => (
            <Typography key={w.id} sx={mono}>
              {w.name}
            </Typography>
          ))}
          <Button
            size="small"
            disabled={thinking}
            onClick={() => void summarise()}
            sx={{
              mt: 2,
              textTransform: 'none',
              fontSize: '0.78rem',
              fontWeight: 600,
              color: c.accent.primary,
            }}
          >
            {thinking ? 'Asking the host model…' : 'Summarise funnel with host LLM'}
          </Button>
          {summary && (
            <Typography sx={{ fontSize: '0.82rem', color: c.text.secondary, mt: 1, lineHeight: 1.6 }}>
              {summary}
            </Typography>
          )}
        </Panel>
      </Box>
    </Box>
  );
};

export default Sessions;
