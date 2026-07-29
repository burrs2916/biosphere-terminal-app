import { invoke } from '@tauri-apps/api/core';
import type { ConnectionConfig, SshConnectionInfo } from '../../proto';
import i18n from '../i18n';

export async function listConnections(): Promise<ConnectionConfig[]> {
  return invoke<ConnectionConfig[]>('list_connections');
}

export async function saveConnection(config: ConnectionConfig): Promise<void> {
  return invoke('save_connection', { config });
}

export async function deleteConnection(id: string): Promise<void> {
  return invoke('delete_connection', { id });
}

export async function testConnection(ssh: SshConnectionInfo, timeoutMs = 20000): Promise<string> {
  const t0 = Date.now();
  console.log('[TEST-CONN][frontend] testConnection INVOKE ->', { host: ssh.host, port: ssh.port, auth: ssh.auth_method });
  const invokePromise = invoke<string>('test_connection', { ssh })
    .then((r) => {
      console.log('[TEST-CONN][frontend] invoke RESOLVED in', Date.now() - t0, 'ms ->', r);
      return r;
    })
    .catch((e) => {
      console.warn('[TEST-CONN][frontend] invoke REJECTED in', Date.now() - t0, 'ms ->', e);
      throw e;
    });
  // 客户端兜底超时：即便后端因异常迟迟不返回（理论上不会再发生），
  // 弹框也能在 timeoutMs 后恢复，避免“测试链接卡死、按钮永久禁用”。
  const timeoutPromise = new Promise<string>((_, reject) =>
    setTimeout(
      () => {
        console.warn('[TEST-CONN][frontend] CLIENT-TIMEOUT fired in', Date.now() - t0, 'ms');
        reject(i18n.t('connection.connection_timeout', { ns: 'terminal' }));
      },
      timeoutMs,
    ),
  );
  return Promise.race([invokePromise, timeoutPromise]);
}
