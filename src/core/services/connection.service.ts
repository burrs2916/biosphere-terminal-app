import { invoke } from '@tauri-apps/api/core';
import type { ConnectionConfig, SshConnectionInfo } from '../../proto';

export async function listConnections(): Promise<ConnectionConfig[]> {
  return invoke('list_connections');
}

export async function saveConnection(config: ConnectionConfig): Promise<void> {
  return invoke('save_connection', { config });
}

export async function deleteConnection(id: string): Promise<void> {
  return invoke('delete_connection', { id });
}

export async function testConnection(ssh: SshConnectionInfo): Promise<string> {
  return invoke('test_connection', { ssh });
}
