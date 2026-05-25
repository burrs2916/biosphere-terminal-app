import { Box, Typography, Button } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

export function NotFoundPage() {
  const navigate = useNavigate();
  const { t } = useTranslation('terminal');

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        gap: 2,
        p: 4,
      }}
    >
      <Typography variant="h1" sx={{ fontWeight: 800, color: 'text.secondary', opacity: 0.4 }}>
        404
      </Typography>
      <Typography variant="h6" color="text.secondary">
        {t('notFound.description', 'Page not found')}
      </Typography>
      <Button variant="outlined" onClick={() => navigate('/')}>
        {t('notFound.goHome', 'Back to Terminal')}
      </Button>
    </Box>
  );
}
