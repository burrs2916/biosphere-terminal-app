import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Divider from '@mui/material/Divider';
import {
  PlusIcon,
  XIcon,
  NotebookIcon,
  RobotIcon,
  BroomIcon,
  ClipboardIcon,
  ClipboardTextIcon,
  MagnifyingGlassIcon,
  MonitorIcon,
  PlugsConnectedIcon,
  FolderIcon,
} from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@mui/material/styles';

interface TerminalToolbarProps {
  onNewTab?: () => void;
  onCloseTab?: () => void;
  onOpenNotes?: () => void;
  onOpenAiCopilot?: () => void;
  onOpenRemoteDesktop?: () => void;
  onOpenSftp?: () => void;
  onClearBuffer?: () => void;
  onCopy?: () => void;
  onPaste?: () => void;
  onFind?: () => void;
  findOpen?: boolean;
  isSshSession?: boolean;
  onOpenConnections?: () => void;
}

export function TerminalToolbar({
  onNewTab,
  onCloseTab,
  onOpenNotes,
  onOpenAiCopilot,
  onOpenRemoteDesktop,
  onOpenSftp,
  onClearBuffer,
  onCopy,
  onPaste,
  onFind,
  findOpen,
  isSshSession,
  onOpenConnections,
}: TerminalToolbarProps) {
  const { t } = useTranslation('terminal');
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';

  const activeBtnSx = {
    bgcolor: 'rgba(108,99,255,0.15)',
    borderRadius: '6px',
  };

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 0.5,
        px: 1,
        py: 0.25,
        borderBottom: '1px solid',
        borderColor: 'divider',
        backgroundColor: isDark ? '#161B22' : '#f5f5f5',
        minHeight: 36,
      }}
    >
      {/* 终端操作按钮组 */}
      <Box sx={{ display: 'flex', gap: 0.25, alignItems: 'center' }}>
        <Tooltip title={t('new_tab')}>
          <IconButton size="small" onClick={onNewTab}>
            <PlusIcon size={16} weight="bold" color={isDark ? '#4FC3F7' : '#1565C0'} />
          </IconButton>
        </Tooltip>
        <Tooltip title={t('close_tab')}>
          <IconButton size="small" onClick={onCloseTab}>
            <XIcon size={16} color={isDark ? '#FF5252' : '#D32F2F'} />
          </IconButton>
        </Tooltip>
      </Box>

      <Divider orientation="vertical" flexItem sx={{ mx: 0.5, borderColor: 'divider' }} />

      {/* 编辑操作按钮组 */}
      <Box sx={{ display: 'flex', gap: 0.25, alignItems: 'center' }}>
        <Tooltip title={t('clear_buffer')}>
          <IconButton size="small" onClick={onClearBuffer}>
            <BroomIcon size={16} color={isDark ? '#8B949E' : '#6B7280'} />
          </IconButton>
        </Tooltip>
        <Tooltip title={t('copy_selection')}>
          <IconButton size="small" onClick={onCopy}>
            <ClipboardIcon size={16} color={isDark ? '#8B949E' : '#6B7280'} />
          </IconButton>
        </Tooltip>
        <Tooltip title={t('paste_clipboard')}>
          <IconButton size="small" onClick={onPaste}>
            <ClipboardTextIcon size={16} color={isDark ? '#8B949E' : '#6B7280'} />
          </IconButton>
        </Tooltip>
        <Tooltip title={t('find')}>
          <IconButton
            size="small"
            onClick={onFind}
            sx={findOpen ? activeBtnSx : {}}
          >
            <MagnifyingGlassIcon
              size={16}
              color={findOpen ? '#6C63FF' : isDark ? '#8B949E' : '#6B7280'}
              weight={findOpen ? 'fill' : 'regular'}
            />
          </IconButton>
        </Tooltip>
      </Box>

      <Divider orientation="vertical" flexItem sx={{ mx: 0.5, borderColor: 'divider' }} />

      {/* 外部工具按钮组 */}
      <Box sx={{ display: 'flex', gap: 0.25, alignItems: 'center' }}>
        <Tooltip title={t('open_notes')}>
          <IconButton size="small" onClick={onOpenNotes}>
            <NotebookIcon size={16} color={isDark ? '#FFD740' : '#E65100'} />
          </IconButton>
        </Tooltip>
        <Tooltip title={t('open_ai_copilot')}>
          <IconButton size="small" onClick={onOpenAiCopilot}>
            <RobotIcon size={16} color={isDark ? '#81C784' : '#2E7D32'} />
          </IconButton>
        </Tooltip>
        {isSshSession && (
          <Tooltip title={t('open_remote_desktop')}>
            <IconButton size="small" onClick={onOpenRemoteDesktop}>
              <MonitorIcon size={16} color={isDark ? '#4FC3F7' : '#0277BD'} />
            </IconButton>
          </Tooltip>
        )}
        {isSshSession && (
          <Tooltip title={t('open_sftp')}>
            <IconButton size="small" onClick={onOpenSftp}>
              <FolderIcon size={16} color={isDark ? '#FFD740' : '#E65100'} />
            </IconButton>
          </Tooltip>
        )}
        <Tooltip title={t('open_connections')}>
          <IconButton size="small" onClick={onOpenConnections}>
            <PlugsConnectedIcon size={16} color={isDark ? '#8B949E' : '#6B7280'} />
          </IconButton>
        </Tooltip>
      </Box>
    </Box>
  );
}
