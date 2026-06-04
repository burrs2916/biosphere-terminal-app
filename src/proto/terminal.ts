import type { SshConnectionInfo } from './connection';

export interface TerminalSession {
  id: string;
  name: string;
  profile_id: string | null;
  cwd: string;
  created_at: number;
  updated_at: number;
}

export interface PtyConfig {
  rows: number;
  cols: number;
  shell?: string;
  cwd?: string;
  env?: Record<string, string>;
  connection_type?: 'local' | 'ssh';
  ssh?: SshConnectionInfo;
  x11_forwarding?: boolean;
}

export interface TerminalSize {
  rows: number;
  cols: number;
}
