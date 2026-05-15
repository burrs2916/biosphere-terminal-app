import { Box, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { ConnectionList } from '../features/connection';

export function ConnectionPage() {
  const { t } = useTranslation('terminal');

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h5" sx={{ mb: 2, fontWeight: 700 }}>
        {t('connection.title')}
      </Typography>
      <ConnectionList onConnect={(conn) => console.log('Connect:', conn)} />
    </Box>
  );
}
