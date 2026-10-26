import { Box, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ConnectionList } from '../features/connection';
import { useNotify } from '../core/notification';
import { useConnectIntent } from '../features/terminal/connectIntent';
import type { ConnectionConfig, SshConnectionInfo } from '../proto';

export function ConnectionPage() {
  const { t } = useTranslation('terminal');
  const notify = useNotify().notify;
  const navigate = useNavigate();

  const handleConnect = (conn: ConnectionConfig) => {
    if (conn.connection_type === 'ssh') {
      let ssh: SshConnectionInfo;
      try {
        ssh = JSON.parse(conn.config_json);
      } catch {
        notify(t('connection.config_parse_error'), 'error');
        return;
      }
      useConnectIntent.getState().set({ connectionType: 'ssh', ssh, name: conn.name, connectionId: conn.id });
    } else {
      useConnectIntent.getState().set({ connectionType: 'local', name: conn.name });
    }
    // 终端页是常驻组件，切到其视图（isTerminal = pathname === '/'）并由其订阅消费意图；
    // 连接中/成功/失败状态由 TerminalPage 的实时状态机驱动（状态栏 + Tab 圆点），无需此处弹窗。
    navigate('/');
  };

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h5" sx={{ mb: 2, fontWeight: 700 }}>
        {t('connection.title')}
      </Typography>
      <ConnectionList onConnect={handleConnect} />
    </Box>
  );
}
