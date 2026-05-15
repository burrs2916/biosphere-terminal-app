import { Box, Typography, List, ListItemButton, ListItemText, Chip } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { allFrontendPlugins } from '../plugins';

export function PluginPage() {
  const { t } = useTranslation('terminal');

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h5" sx={{ mb: 2, fontWeight: 700 }}>
        {t('plugin.title')}
      </Typography>
      <List>
        {allFrontendPlugins.map((plugin) => (
          <ListItemButton key={plugin.id}>
            <ListItemText primary={plugin.name} secondary={plugin.id} />
            <Chip label={t('plugin.builtin')} size="small" color="primary" variant="outlined" />
          </ListItemButton>
        ))}
      </List>
    </Box>
  );
}
