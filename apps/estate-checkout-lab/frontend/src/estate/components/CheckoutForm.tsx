import React from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import LockIcon from '@mui/icons-material/Lock';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';
import { money, type Listing } from '../api';
import { policyFor } from '@/analytics/redact';
import { updateField, submitOrder } from '../actions';
import type { CheckoutForm as FormShape } from '../store';

interface Props {
  listing: Listing;
  form: FormShape;
  submitting: boolean;
  deposit: number;
}

const FIELDS: { key: keyof FormShape; label: string; placeholder: string }[] = [
  { key: 'buyerName', label: 'Full name', placeholder: 'Jane Quinn Doe' },
  { key: 'buyerEmail', label: 'Email', placeholder: 'jane@example.com' },
  { key: 'cardNumber', label: 'Card number', placeholder: '4242 4242 4242 4242' },
  { key: 'cvv', label: 'CVV', placeholder: '123' },
];

const CheckoutFormPanel: React.FC<Props> = ({ listing, form, submitting, deposit }) => {
  const c = useClaudeTokens();

  return (
    <Box
      sx={{
        bgcolor: c.bg.surface,
        border: `1px solid ${c.border.subtle}`,
        borderRadius: `${c.radius.xl}px`,
        p: 3,
      }}
    >
      <Typography sx={{ fontWeight: 650, fontSize: '1.05rem', color: c.text.primary }}>
        Reserve {listing.title}
      </Typography>
      <Typography sx={{ fontSize: '0.82rem', color: c.text.muted, mt: 0.5, mb: 2.5 }}>
        {money(deposit)} refundable deposit · 5% of {money(listing.price)}
      </Typography>

      <Box sx={{ display: 'grid', gap: 2 }}>
        {FIELDS.map(({ key, label, placeholder }) => {
          const policy = policyFor(key);
          const isSecret = policy === 'drop';
          return (
            <Box key={key}>
              <TextField
                fullWidth
                size="small"
                label={label}
                placeholder={placeholder}
                value={form[key]}
                onChange={(e) => updateField(key, e.target.value)}
                inputProps={{ 'data-field': key }}
                sx={{
                  '& .MuiOutlinedInput-root': {
                    borderRadius: `${c.radius.md}px`,
                    fontSize: '0.9rem',
                  },
                }}
              />
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.6, ml: 0.4 }}>
                {isSecret && <LockIcon sx={{ fontSize: 12, color: c.status.success }} />}
                <Typography
                  sx={{
                    fontSize: '0.7rem',
                    fontFamily: c.font.mono,
                    color: isSecret ? c.status.success : c.text.ghost,
                  }}
                >
                  {isSecret
                    ? 'never transmitted — dropped in browser'
                    : policy === 'keep'
                      ? 'sent as typed'
                      : `masked on capture (${policy})`}
                </Typography>
              </Box>
            </Box>
          );
        })}

        <Box>
          <Typography sx={{ fontSize: '0.78rem', color: c.text.tertiary, mb: 0.75 }}>
            Financing
          </Typography>
          <ToggleButtonGroup
            exclusive
            size="small"
            value={form.financing}
            onChange={(_, v) => v && updateField('financing', v)}
            sx={{ '& .MuiToggleButton-root': { borderRadius: `${c.radius.md}px`, px: 2, textTransform: 'none', fontSize: '0.8rem' } }}
          >
            <ToggleButton value="cash">Cash</ToggleButton>
            <ToggleButton value="mortgage">Mortgage</ToggleButton>
            <ToggleButton value="1031">1031 exchange</ToggleButton>
          </ToggleButtonGroup>
        </Box>

        <Button
          variant="contained"
          disableElevation
          disabled={submitting}
          onClick={() => void submitOrder()}
          sx={{
            mt: 0.5,
            py: 1.15,
            borderRadius: `${c.radius.full}px`,
            bgcolor: c.accent.primary,
            textTransform: 'none',
            fontWeight: 600,
            fontSize: '0.92rem',
            '&:hover': { bgcolor: c.accent.hover },
          }}
        >
          {submitting ? 'Reserving…' : `Reserve for ${money(deposit)}`}
        </Button>
      </Box>
    </Box>
  );
};

export default CheckoutFormPanel;
