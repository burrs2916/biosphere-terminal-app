import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { SealCheckIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';

export function StatusBar() {
  const { t } = useTranslation();

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1.5,
        px: 2,
        py: 0.5,
        borderTop: '1px solid rgba(48, 54, 61, 0.6)',
        background: 'linear-gradient(180deg, #161B22 0%, #0D1117 100%)',
      }}
    >
      <SealCheckIcon size={14} weight="fill" color="#00E676" />
      <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 500 }}>
        {t('status.connected')}
      </Typography>
    </Box>
  );
}
