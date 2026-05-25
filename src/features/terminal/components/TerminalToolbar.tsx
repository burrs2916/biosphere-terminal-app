import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Divider from '@mui/material/Divider';
import {
  PlusIcon,
  XIcon,
  NotebookIcon,
  RobotIcon,
  LightningIcon,
  BroomIcon,
  ClipboardIcon,
  ClipboardTextIcon,
  MagnifyingGlassIcon,
} from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@mui/material/styles';

interface TerminalToolbarProps {
  onNewTab?: () => void;
  onCloseTab?: () => void;
  onOpenNotes?: () => void;
  onOpenAiCopilot?: () => void;
  onOpenWorkshop?: () => void;
  onClearBuffer?: () => void;
  onCopy?: () => void;
  onPaste?: () => void;
  onFind?: () => void;
}

export function TerminalToolbar({
  onNewTab,
  onCloseTab,
  onOpenNotes,
  onOpenAiCopilot,
  onOpenWorkshop,
  onClearBuffer,
  onCopy,
  onPaste,
  onFind,
}: TerminalToolbarProps) {
  const { t } = useTranslation('terminal');
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 0.5,
        px: 1.5,
        py: 0.5,
        borderBottom: '1px solid',
        borderColor: 'divider',
        backgroundColor: isDark ? '#161B22' : '#f5f5f5',
      }}
    >
      <Tooltip title={t('new_tab')}>
        <IconButton size="small" onClick={onNewTab}>
          <PlusIcon size={18} weight="bold" color={isDark ? '#4FC3F7' : '#1565C0'} />
        </IconButton>
      </Tooltip>
      <Tooltip title={t('close_tab')}>
        <IconButton size="small" onClick={onCloseTab}>
          <XIcon size={18} color={isDark ? '#FF5252' : '#D32F2F'} />
        </IconButton>
      </Tooltip>

      <Divider orientation="vertical" flexItem sx={{ mx: 0.5, borderColor: 'divider' }} />

      <Tooltip title={t('clear_buffer')}>
        <IconButton size="small" onClick={onClearBuffer}>
          <BroomIcon size={18} color={isDark ? '#8B949E' : '#6B7280'} />
        </IconButton>
      </Tooltip>
      <Tooltip title={t('copy_selection')}>
        <IconButton size="small" onClick={onCopy}>
          <ClipboardIcon size={18} color={isDark ? '#8B949E' : '#6B7280'} />
        </IconButton>
      </Tooltip>
      <Tooltip title={t('paste_clipboard')}>
        <IconButton size="small" onClick={onPaste}>
          <ClipboardTextIcon size={18} color={isDark ? '#8B949E' : '#6B7280'} />
        </IconButton>
      </Tooltip>
      <Tooltip title={t('find')}>
        <IconButton size="small" onClick={onFind}>
          <MagnifyingGlassIcon size={18} color={isDark ? '#8B949E' : '#6B7280'} />
        </IconButton>
      </Tooltip>

      <Divider orientation="vertical" flexItem sx={{ mx: 0.5, borderColor: 'divider' }} />

      <Tooltip title={t('open_notes') || ''}>
        <IconButton size="small" onClick={onOpenNotes}>
          <NotebookIcon size={18} color={isDark ? '#FFD740' : '#E65100'} />
        </IconButton>
      </Tooltip>
      <Tooltip title={t('open_ai_copilot') || 'AI Copilot'}>
        <IconButton size="small" onClick={onOpenAiCopilot}>
          <RobotIcon size={18} color={isDark ? '#81C784' : '#2E7D32'} />
        </IconButton>
      </Tooltip>
      <Tooltip title={t('open_workshop') || 'Plugin Workshop'}>
        <IconButton size="small" onClick={onOpenWorkshop}>
          <LightningIcon size={18} color={isDark ? '#CE93D8' : '#6A1B9A'} />
        </IconButton>
      </Tooltip>
    </Box>
  );
}
