import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { SealCheckIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@mui/material/styles';

export function StatusBar() {
  const { t } = useTranslation();
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1.5,
        px: 2,
        py: 0.5,
        borderTop: '1px solid',
        borderColor: 'divider',
        background: isDark
          ? 'linear-gradient(180deg, #161B22 0%, #0D1117 100%)'
          : 'linear-gradient(180deg, #ffffff 0%, #f5f5f5 100%)',
      }}
    >
      <SealCheckIcon size={14} weight="fill" color={isDark ? '#00E676' : '#00C853'} />
      <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 500 }}>
        {t('status.connected')}
      </Typography>
    </Box>
  );
}
