import { Box } from '@mui/material';
import { AgentPanel } from '../features/agent';
import { useFeatureGate, LockedScreen } from '../features/licensing';

export function AgentPage() {
  // Pro 功能：未付费时显示锁定页
  const featureGate = useFeatureGate('ai_copilot');
  if (!featureGate.canUse) {
    return <LockedScreen feature="ai_copilot" />;
  }

  return (
    <Box sx={{ height: '100%', width: '100%', display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
      <AgentPanel />
    </Box>
  );
}
