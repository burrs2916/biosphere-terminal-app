import { invoke } from '@tauri-apps/api/core';
import type { CommandHistoryEntry, CommandSnippet, ParsedCommandResult } from '../../proto';

export async function getCommandHistory(limit?: number): Promise<CommandHistoryEntry[]> {
  return invoke('get_command_history', { limit: limit ?? null });
}

export async function saveCommandHistory(entry: CommandHistoryEntry): Promise<void> {
  return invoke('save_command_history', { entry });
}

export async function searchCommandHistory(query: string): Promise<CommandHistoryEntry[]> {
  return invoke('search_command_history', { query });
}

export async function listSnippets(): Promise<CommandSnippet[]> {
  return invoke('list_snippets');
}

export async function saveSnippet(snippet: CommandSnippet): Promise<void> {
  return invoke('save_snippet', { snippet });
}

export async function deleteSnippet(id: string): Promise<void> {
  return invoke('delete_snippet', { id });
}

export async function parseCommand(
  command: string,
  sessionId?: string,
  cwd?: string,
): Promise<ParsedCommandResult> {
  return invoke('parse_command', { command, sessionId: sessionId ?? null, cwd: cwd ?? null });
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
