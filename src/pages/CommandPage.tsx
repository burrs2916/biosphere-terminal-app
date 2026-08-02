import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { CommandHistory } from '../features/command';
import { writeToTerminal, getTerminalCwd } from '../core/services/terminal.service';
import { parseCommand } from '../core/services/command.service';
import { useTerminalStore } from '../engine';
import { useNotify } from '../core/notification';
import { localizeBackendError } from '../core/backendError';

export function CommandPage() {
  const { t } = useTranslation('terminal');
  const activeSessionId = useTerminalStore((s) => s.activeSessionId);
  const notify = useNotify().notify;

  const handleExecute = useCallback(
    (command: string) => {
      if (!activeSessionId) {
        notify(t('no_active_terminal'));
        return;
      }
      const bytes = new TextEncoder().encode(command + '\n');
      writeToTerminal(activeSessionId, Array.from(bytes)).catch((e) => { console.error(e); notify(localizeBackendError(e)); });
      // 记录命令历史
      getTerminalCwd(activeSessionId).then((cwd) => {
        parseCommand(command, activeSessionId, cwd ?? undefined).catch((e) => notify(localizeBackendError(e)));
      }).catch((e) => notify(localizeBackendError(e)));
    },
    [activeSessionId, notify, t],
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
