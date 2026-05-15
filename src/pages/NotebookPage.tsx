import { Box } from '@mui/material';
import { NotebookPanel } from '../features/notebook';

export function NotebookPage() {
  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <NotebookPanel />
    </Box>
  );
}
