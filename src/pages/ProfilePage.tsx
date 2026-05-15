import { Box, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { ProfileEditor } from '../features/profile';

export function ProfilePage() {
  const { t } = useTranslation('terminal');

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h5" sx={{ mb: 2, fontWeight: 700 }}>
        {t('profile.title')}
      </Typography>
      <ProfileEditor />
    </Box>
  );
}
