import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { SealCheckIcon, FolderOpenIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';

interface TerminalStatusBarProps {
  sessionName?: string;
  cwd?: string;
  connected?: boolean;
}

export function TerminalStatusBar({ sessionName, cwd, connected = true }: TerminalStatusBarProps) {
  const { t } = useTranslation('terminal');

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        px: 2,
        py: 0.5,
        borderTop: '1px solid rgba(48, 54, 61, 0.6)',
        background: 'linear-gradient(180deg, #161B22 0%, #0D1117 100%)',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <SealCheckIcon
          size={14}
          weight="fill"
          color={connected ? '#00E676' : '#FF5252'}
        />
        <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 500 }}>
          {sessionName || t('local_terminal')}
        </Typography>
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <FolderOpenIcon size={13} color="#8B949E" />
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            {cwd || '~'}
          </Typography>
        </Box>
        <Typography
          variant="caption"
          sx={{
            color: connected ? '#00E676' : '#FF5252',
            fontWeight: 600,
          }}
        >
          {connected ? t('connected') : t('disconnected')}
        </Typography>
      </Box>
    </Box>
  );
}
