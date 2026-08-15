import React from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Chip from '@mui/material/Chip';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';
import { money, type Listing } from '../api';

interface Props {
  listing: Listing;
  onOpen: (id: string) => void;
}

const ListingCard: React.FC<Props> = ({ listing, onOpen }) => {
  const c = useClaudeTokens();

  return (
    <Box
      onClick={() => onOpen(listing.id)}
      data-listing={listing.id}
      sx={{
        cursor: 'pointer',
        borderRadius: `${c.radius.xl}px`,
        overflow: 'hidden',
        bgcolor: c.bg.surface,
        border: `1px solid ${c.border.subtle}`,
        transition: c.transition,
        '&:hover': { transform: 'translateY(-3px)', boxShadow: c.shadow.lg },
      }}
    >
      <Box
        sx={{
          height: 176,
          backgroundImage: `url(${listing.image})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          position: 'relative',
        }}
      >
        <Chip
          label={listing.kind}
          size="small"
          sx={{
            position: 'absolute',
            top: 12,
            left: 12,
            bgcolor: 'rgba(0,0,0,0.55)',
            color: '#fff',
            backdropFilter: 'blur(8px)',
            fontSize: '0.7rem',
            fontWeight: 600,
          }}
        />
      </Box>
      <Box sx={{ p: 2.25 }}>
        <Typography sx={{ fontWeight: 600, fontSize: '0.98rem', color: c.text.primary }}>
          {listing.title}
        </Typography>
        <Typography sx={{ fontSize: '0.8rem', color: c.text.muted, mt: 0.25 }}>
          {listing.city}, {listing.state} · {listing.year}
        </Typography>
        <Typography
          sx={{ fontWeight: 650, fontSize: '1.15rem', color: c.text.primary, mt: 1.25 }}
        >
          {money(listing.price)}
        </Typography>
        <Typography sx={{ fontSize: '0.78rem', color: c.text.tertiary, mt: 0.5 }}>
          {listing.beds} bd · {listing.baths} ba · {listing.sqft.toLocaleString()} sqft
        </Typography>
      </Box>
    </Box>
  );
};

export default ListingCard;
