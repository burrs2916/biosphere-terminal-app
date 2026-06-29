import { invoke } from '@tauri-apps/api/core';
import type { CommandHistoryEntry, ParsedCommandResult } from '../../proto';

export async function getCommandHistory(limit?: number): Promise<CommandHistoryEntry[]> {
  return invoke('get_command_history', { limit: limit ?? null });
}

export async function searchCommandHistory(query: string): Promise<CommandHistoryEntry[]> {
  return invoke('search_command_history', { query });
}

export async function parseCommand(
  command: string,
  sessionId?: string,
  cwd?: string,
): Promise<ParsedCommandResult> {
  return invoke('parse_command', { command, sessionId: sessionId ?? null, cwd: cwd ?? null });
}

/// 只解析命令，不写入历史（用于命令面板预览）
export async function parseCommandOnly(command: string): Promise<ParsedCommandResult> {
  return invoke('parse_command_only', { command });
}

export async function recordExitCode(entryId: string, exitCode: number): Promise<void> {
  return invoke('record_exit_code', { entryId, exitCode });
}

export async function deleteCommandHistoryEntry(id: string): Promise<void> {
  return invoke('delete_command_history', { id });
}

export async function clearCommandHistory(): Promise<void> {
  return invoke('clear_command_history');
}

export async function deleteCommandHistoryBatch(ids: string[]): Promise<void> {
  return invoke('delete_command_history_batch', { ids });
}
