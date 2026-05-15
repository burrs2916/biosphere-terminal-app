import { Box } from '@mui/material';
import { AgentPanel } from '../features/agent';

export function AgentPage() {
  return (
    <Box sx={{ height: '100%', width: '100%', display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
      <AgentPanel />
    </Box>
  );
}
