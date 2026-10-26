import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { SealCheckIcon, FolderOpenIcon, CircleNotchIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@mui/material/styles';
import type { ConnStatus } from '../connectionStatus';

interface TerminalStatusBarProps {
  sessionName?: string;
  cwd?: string;
  connStatus?: ConnStatus;
}

export function TerminalStatusBar({ sessionName, cwd, connStatus = 'connected' }: TerminalStatusBarProps) {
  const { t } = useTranslation('terminal');
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';

  const statusColor =
    connStatus === 'connected'
      ? isDark ? '#00E676' : '#00C853'
      : connStatus === 'connecting'
        ? isDark ? '#FFB300' : '#FF8F00'
        : isDark ? '#FF5252' : '#D32F2F';

  const statusLabel =
    connStatus === 'connected'
      ? t('connected')
      : connStatus === 'connecting'
        ? t('status_connecting')
        : t('disconnected');

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        px: 2,
        py: 0.5,
        borderTop: '1px solid',
        borderColor: 'divider',
        background: isDark
          ? 'linear-gradient(180deg, #161B22 0%, #0D1117 100%)'
          : 'linear-gradient(180deg, #ffffff 0%, #f5f5f5 100%)',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        {connStatus === 'connecting' ? (
          <CircleNotchIcon size={14} color={statusColor} />
        ) : (
          <SealCheckIcon size={14} weight="fill" color={statusColor} />
        )}
        <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 500 }}>
          {sessionName || t('local_terminal')}
        </Typography>
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <FolderOpenIcon size={13} color={isDark ? '#8B949E' : '#6B7280'} />
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            {cwd || '~'}
          </Typography>
        </Box>
        <Typography
          variant="caption"
          sx={{ color: statusColor, fontWeight: 600 }}
        >
          {statusLabel}
        </Typography>
      </Box>
    </Box>
  );
}
