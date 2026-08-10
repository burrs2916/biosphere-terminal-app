import { invoke } from '@tauri-apps/api/core';
import type { SshConnectionInfo } from '../../proto/connection';

export interface RemoteDesktopSession {
  id: string;
  wsUrl: string;
  localPort: number;
  vncPort: number;
}

export interface VncSetupResult {
  vncInstalled: boolean;
  vncRunning: boolean;
  vncPort: number;
  display: string | null;
  needsPassword: boolean;
  osName: string;
}

export async function createRemoteDesktop(
  sessionId: string,
  ssh: SshConnectionInfo,
  vncPort?: number,
): Promise<RemoteDesktopSession> {
  return invoke('create_remote_desktop', {
    sessionId,
    ssh,
    vncPort: vncPort || null,
  });
}

export async function closeRemoteDesktop(sessionId: string): Promise<void> {
  return invoke('close_remote_desktop', { sessionId });
}

/**
 * Probe the remote host for VNC state.
 */
export async function setupRemoteDesktop(
  ssh: SshConnectionInfo,
  vncPort?: number,
  runId?: string,
): Promise<VncSetupResult> {
  return invoke('setup_remote_desktop', {
    ssh,
    vncPort: vncPort || null,
    runId: runId || null,
  });
}