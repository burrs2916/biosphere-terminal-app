import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@mui/material/styles';
import { useSearchParams } from 'react-router-dom';
import { SftpManager } from '../features/sftp/SftpManager';
import type { SshConnectionInfo } from '../proto/connection';
import { useFeatureGate, LockedScreen } from '../features/licensing';

export function SftpPage() {
  const { t } = useTranslation('fileTransfer');
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const [searchParams] = useSearchParams();

  const host = searchParams.get('host') || '';
  const port = searchParams.get('port') || '22';
  const username = searchParams.get('username') || '';
  const authMethod = searchParams.get('authMethod') || 'none';
  const keyPath = searchParams.get('privateKeyPath') || '';
  const password = searchParams.get('password') || '';

  const { canUse } = useFeatureGate('sftp');
  if (!canUse) {
    return <LockedScreen feature="sftp" />;
  }

  const ssh: SshConnectionInfo = {
    host,
    port: parseInt(port) || 22,
    username,
    auth_method: authMethod as 'none' | 'password' | 'private_key',
    private_key_path: authMethod === 'private_key' ? keyPath : undefined,
    password: authMethod === 'password' ? password : undefined,
  };

  const textColor = isDark ? '#c9d1d9' : '#24292f';

  return (
    <Box sx={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <Box
        sx={{
          px: 2,
          py: 1,
          borderBottom: '1px solid',
          borderColor: 'divider',
          display: 'flex',
          alignItems: 'center',
          gap: 1,
        }}
      >
        <Typography variant="subtitle1" sx={{ color: textColor, fontWeight: 600 }}>
          {t('title')}
        </Typography>
        <Typography variant="body2" sx={{ color: isDark ? '#8B949E' : '#6B7280' }}>
          {ssh.username}@{ssh.host}:{ssh.port}
        </Typography>
      </Box>
      <Box sx={{ flex: 1, overflow: 'hidden' }}>
        <SftpManager ssh={ssh} />
      </Box>
    </Box>
  );
}
