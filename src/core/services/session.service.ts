import { invoke } from '@tauri-apps/api/core';
import type { TerminalSession } from '../../proto';

export async function listSessions(): Promise<TerminalSession[]> {
  return invoke('list_sessions');
}

export async function createSession(session: TerminalSession): Promise<void> {
  return invoke('create_session', { session });
}

export async function deleteSession(id: string): Promise<void> {
  return invoke('delete_session', { id });
}
