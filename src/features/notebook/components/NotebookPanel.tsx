import { Box, Typography, Divider } from '@mui/material';
import { GroupSidebar } from './GroupSidebar';
import { CategoryCards } from './CategoryCards';
import { useNotebookStore } from '../store/notebookStore';
import { useTranslation } from 'react-i18next';

export function NotebookPanel() {
  useNotebookStore((s) => s.activeGroupId);
  const { t } = useTranslation('notebook');

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', px: 2, py: 1 }}>
        <Typography variant="subtitle2" sx={{ flex: 1, fontSize: 14, fontWeight: 700 }}>
          {t('notebook.title')}
        </Typography>
      </Box>
      <Divider sx={{ borderColor: 'rgba(48, 54, 61, 0.6)' }} />
      <Box sx={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <GroupSidebar />
        <CategoryCards />
      </Box>
    </Box>
  );
}
