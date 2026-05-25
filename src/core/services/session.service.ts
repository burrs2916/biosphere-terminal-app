import { invoke } from '@tauri-apps/api/core';
import type { TerminalSession } from '../../proto';

export async function listSessions(): Promise<TerminalSession[]> {
  return invoke('list_sessions');
}
