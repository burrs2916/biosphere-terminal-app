import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Typography from '@mui/material/Typography';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@mui/material/styles';
import { useSearchParams } from 'react-router-dom';
import { invoke } from '@tauri-apps/api/core';
import { SftpManager } from '../features/sftp/SftpManager';
import type { SshConnectionInfo } from '../proto/connection';
import { useFeatureGate, LockedScreen } from '../features/licensing';
import { localizeBackendError } from '../core/backendError';

export function SftpPage() {
  const { t } = useTranslation('fileTransfer');
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const [searchParams] = useSearchParams();

  // 安全铁律：密码/密钥不进 URL。URL 只带一次性 token（host/port/username 等展示字段除外），
  // 完整凭据由 Rust 侧 CredentialStash 暂存，这里凭 token 一次性取回。
  // 无 token（异常路径兜底）时回退读 URL 参数 —— 此时 URL 本就不含密码，凭据为空由用户重开窗口。
  const token = searchParams.get('token') || '';
  const host = searchParams.get('host') || '';
  const port = searchParams.get('port') || '22';
  const username = searchParams.get('username') || '';
  const authMethod = searchParams.get('authMethod') || 'none';
  const keyPath = searchParams.get('privateKeyPath') || '';

  const { canUse } = useFeatureGate('sftp');

  const [ssh, setSsh] = useState<SshConnectionInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (token) {
      invoke<SshConnectionInfo>('take_stashed_credentials', { token })
        .then((s) => {
          if (!cancelled) setSsh(s);
        })
        .catch((e) => {
          if (!cancelled) setLoadError(localizeBackendError(e));
        });
    } else {
      setSsh({
        host,
        port: parseInt(port) || 22,
        username,
        auth_method: authMethod as 'none' | 'password' | 'private_key',
        private_key_path: authMethod === 'private_key' ? keyPath : undefined,
        password: undefined,
      });
    }
    return () => {
      cancelled = true;
    };
    // URL 参数在窗口生命周期内不变，仅 token 触发一次取回。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  if (!canUse) {
    return <LockedScreen feature="sftp" />;
  }

  if (loadError) {
    return (
      <Box sx={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 1 }}>
        <Typography color="error">{loadError}</Typography>
      </Box>
    );
  }

  if (!ssh) {
    return (
      <Box sx={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <CircularProgress />
      </Box>
    );
  }

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
