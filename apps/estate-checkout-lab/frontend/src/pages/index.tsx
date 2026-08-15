// Estate Checkout Lab — a real checkout flow used as a testbed for OpenSwarm's
// app surfaces: the agent bridge, a FastAPI SubApp with a durable store, an SSE
// live feed, and the host SDK. The checkout is real enough to produce believable
// telemetry; the redaction is real enough that no secret leaves the browser.

import React, { useCallback, useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';
import { money, type Listing } from '@/estate/api';
import { useEstate, selectedListing, visibleListings } from '@/estate/store';
import {
  loadListings,
  openListing,
  backToBrowse,
  startCheckout,
  setKindFilter,
} from '@/estate/actions';
import { registerBridge } from '@/estate/bridge';
import ListingCard from '@/estate/components/ListingCard';
import CheckoutFormPanel from '@/estate/components/CheckoutForm';
import LiveFeed from '@/estate/components/LiveFeed';
import { sessionId } from '@/analytics/tracker';

const KINDS = ['All', 'Estate', 'Condo', 'Cabin', 'Townhouse', 'Modern', 'Cottage'];
const DEPOSIT_RATE = 0.05;

const Home: React.FC = () => {
  const c = useClaudeTokens();
  const state = useEstate();
  const [streamCount, setStreamCount] = useState(0);
  const listing = selectedListing(state);
  const visible = visibleListings(state);

  useEffect(() => {
    void loadListings();
    registerBridge();
  }, []);

  const onCount = useCallback((n: number) => setStreamCount(n), []);

  return (
    <Box sx={{ height: '100vh', bgcolor: c.bg.page, display: 'flex', flexDirection: 'column' }}>
      <Box
        sx={{
          px: 4,
          py: 2.5,
          display: 'flex',
          alignItems: 'center',
          gap: 2,
          borderBottom: `1px solid ${c.border.subtle}`,
          bgcolor: c.bg.surface,
        }}
      >
        <Box>
          <Typography sx={{ fontWeight: 650, fontSize: '1.05rem', color: c.text.primary }}>
            Estate Checkout Lab
          </Typography>
          <Typography sx={{ fontSize: '0.76rem', color: c.text.muted }}>
            OpenSwarm component testbed · session {sessionId}
          </Typography>
        </Box>
        <Box sx={{ ml: 'auto', display: 'flex', gap: 1 }}>
          <Chip
            label={`${streamCount} streamed`}
            size="small"
            sx={{
              bgcolor: `${c.accent.primary}14`,
              color: c.accent.primary,
              fontWeight: 600,
              fontSize: '0.72rem',
            }}
          />
          <Chip
            label={state.step}
            size="small"
            sx={{
              bgcolor: `${c.text.primary}0A`,
              color: c.text.secondary,
              fontWeight: 600,
              fontSize: '0.72rem',
            }}
          />
        </Box>
      </Box>

      <Box sx={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <Box sx={{ flex: 1, overflowY: 'auto', p: 4 }}>
          {state.loading && (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
              <CircularProgress size={22} sx={{ color: c.accent.primary }} />
            </Box>
          )}

          {state.error && (
            <Box
              sx={{
                p: 2,
                borderRadius: `${c.radius.lg}px`,
                bgcolor: c.status.errorBg,
                color: c.status.error,
                fontSize: '0.85rem',
                mb: 2,
              }}
            >
              {state.error}
            </Box>
          )}

          {!state.loading && state.step === 'browse' && (
            <>
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 3 }}>
                {KINDS.map((k) => (
                  <Chip
                    key={k}
                    label={k}
                    onClick={() => setKindFilter(k)}
                    sx={{
                      cursor: 'pointer',
                      fontWeight: 600,
                      fontSize: '0.76rem',
                      bgcolor: state.kindFilter === k ? c.accent.primary : c.bg.surface,
                      color: state.kindFilter === k ? '#fff' : c.text.secondary,
                      border: `1px solid ${state.kindFilter === k ? 'transparent' : c.border.subtle}`,
                      '&:hover': {
                        bgcolor: state.kindFilter === k ? c.accent.hover : c.bg.elevated,
                      },
                    }}
                  />
                ))}
              </Box>
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(268px, 1fr))',
                  gap: 2.5,
                }}
              >
                {visible.map((l: Listing) => (
                  <ListingCard key={l.id} listing={l} onOpen={openListing} />
                ))}
              </Box>
            </>
          )}

          {state.step === 'detail' && listing && (
            <Box sx={{ maxWidth: 860 }}>
              <Button
                startIcon={<ArrowBackIcon sx={{ fontSize: 16 }} />}
                onClick={backToBrowse}
                sx={{ textTransform: 'none', color: c.text.tertiary, mb: 2 }}
              >
                All properties
              </Button>
              <Box
                sx={{
                  height: 320,
                  borderRadius: `${c.radius.xl}px`,
                  backgroundImage: `url(${listing.image})`,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                }}
              />
              <Typography
                sx={{ fontWeight: 650, fontSize: '1.6rem', color: c.text.primary, mt: 2.5 }}
              >
                {listing.title}
              </Typography>
              <Typography sx={{ fontSize: '0.9rem', color: c.text.muted }}>
                {listing.city}, {listing.state} · built {listing.year}
              </Typography>
              <Typography
                sx={{
                  fontSize: '0.92rem',
                  color: c.text.secondary,
                  mt: 2,
                  lineHeight: 1.65,
                  maxWidth: 620,
                }}
              >
                {listing.blurb}
              </Typography>
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 2.5 }}>
                {listing.features.map((f) => (
                  <Chip
                    key={f}
                    label={f}
                    size="small"
                    sx={{
                      bgcolor: c.bg.surface,
                      border: `1px solid ${c.border.subtle}`,
                      fontSize: '0.75rem',
                    }}
                  />
                ))}
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 3, mt: 3.5 }}>
                <Typography sx={{ fontWeight: 700, fontSize: '1.8rem', color: c.text.primary }}>
                  {money(listing.price)}
                </Typography>
                <Button
                  variant="contained"
                  disableElevation
                  onClick={startCheckout}
                  sx={{
                    px: 3.5,
                    py: 1.15,
                    borderRadius: `${c.radius.full}px`,
                    bgcolor: c.accent.primary,
                    textTransform: 'none',
                    fontWeight: 600,
                    '&:hover': { bgcolor: c.accent.hover },
                  }}
                >
                  Reserve this property
                </Button>
              </Box>
            </Box>
          )}

          {state.step === 'checkout' && listing && (
            <Box sx={{ maxWidth: 520 }}>
              <Button
                startIcon={<ArrowBackIcon sx={{ fontSize: 16 }} />}
                onClick={() => openListing(listing.id)}
                sx={{ textTransform: 'none', color: c.text.tertiary, mb: 2 }}
              >
                Back to property
              </Button>
              <CheckoutFormPanel
                listing={listing}
                form={state.form}
                submitting={state.submitting}
                deposit={Math.round(listing.price * DEPOSIT_RATE)}
              />
            </Box>
          )}

          {state.step === 'confirmed' && state.order && (
            <Box sx={{ maxWidth: 520 }}>
              <Box
                sx={{
                  p: 3.5,
                  borderRadius: `${c.radius.xl}px`,
                  bgcolor: c.bg.surface,
                  border: `1px solid ${c.border.subtle}`,
                  textAlign: 'center',
                }}
              >
                <CheckCircleIcon sx={{ fontSize: 44, color: c.status.success }} />
                <Typography
                  sx={{ fontWeight: 650, fontSize: '1.2rem', color: c.text.primary, mt: 1.5 }}
                >
                  Reserved
                </Typography>
                <Typography sx={{ fontSize: '0.88rem', color: c.text.muted, mt: 0.5 }}>
                  {state.order.listingTitle} · {money(state.order.deposit)} deposit
                </Typography>
                <Box
                  sx={{
                    mt: 2.5,
                    p: 2,
                    borderRadius: `${c.radius.lg}px`,
                    bgcolor: c.bg.page,
                    fontFamily: c.font.mono,
                    fontSize: '0.78rem',
                    color: c.text.secondary,
                    textAlign: 'left',
                  }}
                >
                  <div>order: {state.order.id}</div>
                  <div>buyer: {state.order.buyerName}</div>
                  <div>email: {state.order.buyerEmail}</div>
                  <div>financing: {state.order.financing}</div>
                </Box>
                <Typography sx={{ fontSize: '0.74rem', color: c.text.ghost, mt: 1.5 }}>
                  Name and email are stored masked. No payment instrument was ever transmitted.
                </Typography>
                <Button
                  onClick={backToBrowse}
                  sx={{ mt: 2, textTransform: 'none', color: c.accent.primary, fontWeight: 600 }}
                >
                  Browse more properties
                </Button>
              </Box>
            </Box>
          )}
        </Box>

        <Box
          sx={{
            width: 380,
            minWidth: 380,
            p: 2.5,
            borderLeft: `1px solid ${c.border.subtle}`,
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
          }}
        >
          <LiveFeed onCount={onCount} />
        </Box>
      </Box>
    </Box>
  );
};

export default Home;
