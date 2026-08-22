import { invoke } from '@tauri-apps/api/core';
import type { PtyConfig } from '../../proto';

export async function spawnTerminal(sessionId: string, config: PtyConfig): Promise<void> {
  return invoke('spawn_terminal', { sessionId, config });
}

export async function writeToTerminal(sessionId: string, data: number[]): Promise<number> {
  return invoke('write_to_terminal', { sessionId, data });
}

export async function killTerminal(sessionId: string): Promise<void> {
  return invoke('kill_terminal', { sessionId });
}

export async function resizeTerminal(sessionId: string, rows: number, cols: number): Promise<void> {
  return invoke('resize_terminal', { sessionId, rows, cols });
}

export async function getTerminalCwd(sessionId: string): Promise<string | null> {
  // cwd is cosmetic (status bar + command-history tagging). Never let a lookup
  // race / transient backend error reject — callers use `.then()` without a
  // catch and an unhandled rejection would otherwise surface as a spurious
  // "Terminal error: session not found" popup even though the terminal works.
  try {
    return await invoke<string | null>('get_terminal_cwd', { sessionId });
  } catch {
    return null;
  }
}
