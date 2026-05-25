import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { CommandHistory } from '../features/command';
import { writeToTerminal } from '../core/services/terminal.service';
import { useTerminalStore } from '../engine';
import { useNotify } from '../core/notification';

export function CommandPage() {
  const { t } = useTranslation('terminal');
  const activeSessionId = useTerminalStore((s) => s.activeSessionId);
  const notify = useNotify().notify;

  const handleExecute = useCallback(
    (command: string) => {
      if (!activeSessionId) return;
      const bytes = new TextEncoder().encode(command + '\n');
      writeToTerminal(activeSessionId, Array.from(bytes)).catch((e) => { console.error(e); notify(String(e)); });
    },
    [activeSessionId],
  );

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 1, borderBottom: '1px solid', borderColor: 'divider' }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 700, fontSize: 14 }}>
          {t('command_history')}
        </Typography>
      </Box>
      <Box sx={{ flex: 1, overflow: 'auto' }}>
        <CommandHistory onExecute={handleExecute} />
      </Box>
    </Box>
  );
}
