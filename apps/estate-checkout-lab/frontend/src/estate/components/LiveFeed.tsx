// Consumes /api/ingest/stream. This is the piece that proves the pipeline end to
// end: a keystroke goes browser -> redact -> POST -> store.json -> SSE -> back
// into this list. If a value shows up here, it survived redaction; secrets show
// as "(dropped)" because the server received no value at all.

import React, { useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Chip from '@mui/material/Chip';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';
import { INGEST_EVENTS_URL, INGEST_STREAM_URL } from '@/shared/state/API_ENDPOINTS';
import type { ServerEvent } from '../api';

const KEEP = 60;
/** How long to wait for any stream frame before deciding the stream is buffered. */
const STREAM_GRACE_MS = 5000;
const POLL_MS = 2500;

const TYPE_COLOR: Record<string, 'accent' | 'success' | 'muted'> = {
  purchase: 'success',
  blocked: 'accent',
};

interface Props {
  onCount?: (n: number) => void;
}

const LiveFeed: React.FC<Props> = ({ onCount }) => {
  const c = useClaudeTokens();
  const [events, setEvents] = useState<ServerEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const countRef = useRef(0);

  useEffect(() => {
    const seen = new Set<string>();
    let poll: ReturnType<typeof setInterval> | null = null;

    // Shared by both transports so an event delivered twice (SSE races the poller
    // during failover) is only counted and rendered once.
    const ingestRecords = (records: ServerEvent[]) => {
      const fresh = records.filter((r) => r.id && !seen.has(r.id));
      if (!fresh.length) return;
      fresh.forEach((r) => seen.add(r.id));
      countRef.current += fresh.length;
      onCount?.(countRef.current);
      setEvents((prev) => [...fresh.reverse(), ...prev].slice(0, KEEP));
      setConnected(true);
    };

    // Some proxies buffer text/event-stream instead of passing it through, so the
    // connection opens and then silently delivers nothing (Cloudflare quick tunnels
    // do exactly this). Polling is the fallback: slower, but it cannot be buffered
    // away. Only started if the stream proves dead, so a direct local connection
    // still gets true realtime.
    const startPolling = () => {
      if (poll) return;
      const tick = async () => {
        try {
          const res = await fetch(`${INGEST_EVENTS_URL}?limit=${KEEP}`);
          if (!res.ok) return;
          const data = (await res.json()) as { events?: ServerEvent[] };
          ingestRecords(data.events ?? []);
        } catch {
          // Backend unreachable; keep the interval so it recovers on its own.
        }
      };
      void tick();
      poll = setInterval(tick, POLL_MS);
    };

    // Backfill before subscribing. The stream only carries events that happen after
    // the connection opens, so without this the panel opens empty and a visit that
    // already happened is invisible — the operator watching from OpenSwarm would
    // have to have had this panel open at the exact moment a stranger clicked.
    const backfill = async () => {
      try {
        const res = await fetch(`${INGEST_EVENTS_URL}?limit=${KEEP}`);
        if (!res.ok) return;
        const data = (await res.json()) as { events?: ServerEvent[] };
        ingestRecords(data.events ?? []);
      } catch {
        // Nothing to show yet; the stream below still delivers anything new.
      }
    };
    void backfill();

    const source = new EventSource(INGEST_STREAM_URL);
    // The stream sends a retry: frame immediately and a keepalive every 20s, so
    // silence past this deadline means the body is being held somewhere upstream.
    const watchdog = setTimeout(startPolling, STREAM_GRACE_MS);

    source.onopen = () => setConnected(true);
    source.onerror = () => {
      setConnected(false);
      startPolling();
    };
    source.onmessage = (e) => {
      clearTimeout(watchdog);
      if (poll) {
        clearInterval(poll);
        poll = null;
      }
      try {
        ingestRecords([JSON.parse(e.data) as ServerEvent]);
      } catch {
        // A keepalive comment frame never reaches onmessage; anything unparseable
        // here is a malformed record, and dropping it beats killing the stream.
      }
    };

    return () => {
      clearTimeout(watchdog);
      if (poll) clearInterval(poll);
      source.close();
    };
  }, [onCount]);

  return (
    <Box
      sx={{
        bgcolor: c.bg.surface,
        border: `1px solid ${c.border.subtle}`,
        borderRadius: `${c.radius.xl}px`,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        height: '100%',
        minHeight: 0,
      }}
    >
      <Box
        sx={{
          px: 2.25,
          py: 1.75,
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          borderBottom: `1px solid ${c.border.subtle}`,
        }}
      >
        <Box
          sx={{
            width: 7,
            height: 7,
            borderRadius: '50%',
            bgcolor: connected ? c.status.success : c.text.ghost,
            boxShadow: connected ? `0 0 0 3px ${c.status.successBg}` : 'none',
          }}
        />
        <Typography sx={{ fontWeight: 600, fontSize: '0.85rem', color: c.text.primary }}>
          Live ingest stream
        </Typography>
        <Typography sx={{ fontSize: '0.72rem', color: c.text.ghost, ml: 'auto', fontFamily: c.font.mono }}>
          {connected ? 'SSE connected' : 'reconnecting…'}
        </Typography>
      </Box>

      <Box sx={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {events.length === 0 && (
          <Typography sx={{ p: 2.25, fontSize: '0.8rem', color: c.text.ghost }}>
            Nothing yet. Interact with the checkout and events land here in real time.
          </Typography>
        )}
        {events.map((e) => {
          const tone = TYPE_COLOR[e.type];
          return (
            <Box
              key={e.id}
              sx={{
                px: 2.25,
                py: 1.15,
                borderBottom: `1px solid ${c.border.subtle}`,
                display: 'flex',
                alignItems: 'baseline',
                gap: 1.25,
              }}
            >
              <Chip
                label={e.type}
                size="small"
                sx={{
                  height: 19,
                  fontSize: '0.65rem',
                  fontWeight: 600,
                  bgcolor:
                    tone === 'success'
                      ? c.status.successBg
                      : tone === 'accent'
                        ? `${c.accent.primary}1A`
                        : `${c.text.primary}0A`,
                  color:
                    tone === 'success'
                      ? c.status.success
                      : tone === 'accent'
                        ? c.accent.primary
                        : c.text.tertiary,
                }}
              />
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Typography
                  sx={{
                    fontSize: '0.78rem',
                    fontFamily: c.font.mono,
                    color: c.text.secondary,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {e.field ? `${e.field} = ` : ''}
                  {e.field && !e.value ? (
                    <Box component="span" sx={{ color: c.status.success }}>
                      (dropped)
                    </Box>
                  ) : (
                    e.value || String((e.meta as Record<string, unknown>)?.step ?? '—')
                  )}
                </Typography>
              </Box>
              <Typography sx={{ fontSize: '0.68rem', color: c.text.ghost, fontFamily: c.font.mono }}>
                {new Date(e.at).toLocaleTimeString('en-US', { hour12: false })}
              </Typography>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
};

export default LiveFeed;
