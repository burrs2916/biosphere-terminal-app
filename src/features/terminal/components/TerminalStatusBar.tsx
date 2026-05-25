import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { SealCheckIcon, FolderOpenIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@mui/material/styles';

interface TerminalStatusBarProps {
  sessionName?: string;
  cwd?: string;
  connected?: boolean;
}

export function TerminalStatusBar({ sessionName, cwd, connected = true }: TerminalStatusBarProps) {
  const { t } = useTranslation('terminal');
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';

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
        <SealCheckIcon
          size={14}
          weight="fill"
          color={connected
            ? (isDark ? '#00E676' : '#00C853')
            : (isDark ? '#FF5252' : '#D32F2F')}
        />
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
          sx={{
            color: connected
              ? (isDark ? '#00E676' : '#00C853')
              : (isDark ? '#FF5252' : '#D32F2F'),
            fontWeight: 600,
          }}
        >
          {connected ? t('connected') : t('disconnected')}
        </Typography>
      </Box>
    </Box>
  );
}
