import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import { PlusIcon, XIcon, NotebookIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';

interface TerminalToolbarProps {
  onNewTab?: () => void;
  onCloseTab?: () => void;
  onOpenNotes?: () => void;
}

export function TerminalToolbar({ onNewTab, onCloseTab, onOpenNotes }: TerminalToolbarProps) {
  const { t } = useTranslation('terminal');

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 0.5,
        px: 1.5,
        py: 0.5,
        borderBottom: '1px solid rgba(48, 54, 61, 0.6)',
        backgroundColor: '#161B22',
      }}
    >
      <Tooltip title={t('new_tab')}>
        <IconButton size="small" onClick={onNewTab}>
          <PlusIcon size={18} weight="bold" color="#4FC3F7" />
        </IconButton>
      </Tooltip>
      <Tooltip title={t('open_notes') || ''}>
        <IconButton size="small" onClick={onOpenNotes}>
          <NotebookIcon size={18} color="#FFD740" />
        </IconButton>
      </Tooltip>
      <Tooltip title={t('close_tab')}>
        <IconButton size="small" onClick={onCloseTab}>
          <XIcon size={18} color="#FF5252" />
        </IconButton>
      </Tooltip>
    </Box>
  );
}
