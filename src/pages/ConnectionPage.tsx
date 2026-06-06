import { Box, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { ConnectionList } from '../features/connection';
import { useNotify } from '../core/notification';

export function ConnectionPage() {
  const { t } = useTranslation('terminal');
  const notify = useNotify().notify;

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h5" sx={{ mb: 2, fontWeight: 700 }}>
        {t('connection.title')}
      </Typography>
      <ConnectionList onConnect={(conn) => notify(t('connection.connected_to', { name: conn.name, defaultValue: `Connected to ${conn.name}` }))} />
    </Box>
  );
}
