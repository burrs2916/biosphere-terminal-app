import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Chip from '@mui/material/Chip';
import { CommandHistory, SnippetList } from '../features/command';
import { writeToTerminal } from '../core/services/terminal.service';
import { useTerminalStore } from '../engine';

export function CommandPage() {
  const { t } = useTranslation('terminal');
  const [tab, setTab] = useState<'history' | 'snippets'>('history');
  const activeSessionId = useTerminalStore((s) => s.activeSessionId);

  const handleExecute = useCallback(
    (command: string) => {
      if (!activeSessionId) return;
      const bytes = new TextEncoder().encode(command + '\n');
      writeToTerminal(activeSessionId, Array.from(bytes)).catch(console.error);
    },
    [activeSessionId],
  );

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 1, borderBottom: '1px solid', borderColor: 'divider' }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 700, fontSize: 14 }}>
          {t('command_history')}
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Chip
          label={t('history.title')}
          variant={tab === 'history' ? 'filled' : 'outlined'}
          color={tab === 'history' ? 'primary' : 'default'}
          size="small"
          onClick={() => setTab('history')}
          sx={{ cursor: 'pointer' }}
        />
        <Chip
          label={t('snippets.title')}
          variant={tab === 'snippets' ? 'filled' : 'outlined'}
          color={tab === 'snippets' ? 'primary' : 'default'}
          size="small"
          onClick={() => setTab('snippets')}
          sx={{ cursor: 'pointer' }}
        />
      </Box>
      <Box sx={{ flex: 1, overflow: 'auto' }}>
        {tab === 'history' && (
          <CommandHistory onExecute={handleExecute} />
        )}
        {tab === 'snippets' && (
          <SnippetList onExecute={handleExecute} />
        )}
      </Box>
    </Box>
  );
}
