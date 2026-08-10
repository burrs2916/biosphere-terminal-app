import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { SshConnectionInfo } from '../../proto/connection';

export interface SftpEntry {
  name: string;
  /**
   * The `lstat` truth. A symlink pointing at a folder is *not* a directory
   * here, which is what keeps recursive deletes from walking through it.
   */
  is_dir: boolean;
  is_symlink: boolean;
  /**
   * True when the entry can be entered: a real directory, or a symlink whose
   * target is one. Navigation, sorting and icons use this; destructive
   * operations must keep using `is_dir`.
   */
  target_is_dir: boolean;
  size: number;
  /** Normalised "YYYY-MM-DD HH:mm" when parsable, otherwise the raw string. */
  mtime: string;
  /** Epoch seconds, 0 when the remote timestamp could not be understood. */
  mtime_ts: number;
  perms: string;
  owner: string;
  group: string;
  link_target: string | null;
}

export interface SftpListResult {
  /** Absolute path resolved by the remote host. */
  path: string;
  entries: SftpEntry[];
}

/**
 * One directory's worth of entries from a batched `sftp_list_many` call.
 * `error` is set per-path when only that directory failed, so a single bad
 * folder does not sink the whole batch.
 */
export interface DirListing {
  /** The requested path, echoed back unchanged. */
  path: string;
  entries: SftpEntry[];
  /** Present when this directory could not be listed. */
  error: string | null;
}

/** A remote target plus the type we already know from the listing. */
export interface SftpRemoteItem {
  path: string;
  isDir: boolean;
}

export interface SftpProgressPayload {
  transferId: string;
  file: string;
  percent: number;
  transferred: string;
  rate: string;
  eta: string;
}

export async function sftpList(ssh: SshConnectionInfo, path: string): Promise<SftpListResult> {
  return invoke('sftp_list', { ssh, path });
}

/**
 * List several directories in one batched sftp session. The side tree reveals
 * an ancestor chain all at once, so fetching them together collapses N serial
 * round trips into a single process spawn. `list_dirs` on the backend falls
 * back to independent listings if the transcript diverges, so a caller can
 * treat every `DirListing.error` independently.
 */
export async function sftpListMany(
  ssh: SshConnectionInfo,
  paths: string[],
): Promise<DirListing[]> {
  return invoke('sftp_list_many', { ssh, paths });
}

/**
 * @param resume Continue an interrupted upload instead of re-sending it. The
 *   backend compares sizes per file and moves only what is still missing.
 */
export async function sftpUpload(
  ssh: SshConnectionInfo,
  localPaths: string[],
  remoteDir: string,
  transferId?: string,
  remoteNames?: string[],
  resume?: boolean,
): Promise<void> {
  return invoke('sftp_upload', { ssh, localPaths, remoteDir, transferId, remoteNames, resume });
}

/** @param resume Continue partially downloaded files rather than restarting them. */
export async function sftpDownload(
  ssh: SshConnectionInfo,
  items: SftpRemoteItem[],
  localDir: string,
  transferId?: string,
  resume?: boolean,
): Promise<void> {
  return invoke('sftp_download', { ssh, items, localDir, transferId, resume });
}

export async function sftpRemove(
  ssh: SshConnectionInfo,
  items: SftpRemoteItem[],
): Promise<void> {
  return invoke('sftp_remove', { ssh, items });
}

export async function sftpRename(
  ssh: SshConnectionInfo,
  from: string,
  to: string,
): Promise<void> {
  return invoke('sftp_rename', { ssh, from, to });
}

export async function sftpMkdir(ssh: SshConnectionInfo, remotePath: string): Promise<void> {
  return invoke('sftp_mkdir', { ssh, remotePath });
}

/**
 * Apply an octal permission mode ("755") to remote paths.
 *
 * POSIX remotes only in practice — Windows servers reject SETSTAT and the
 * rejection is reported to the user instead of being swallowed.
 */
export async function sftpChmod(
  ssh: SshConnectionInfo,
  paths: string[],
  mode: string,
): Promise<void> {
  return invoke('sftp_chmod', { ssh, paths, mode });
}

/**
 * Abort a running transfer. Resolves to false when the backend no longer knows
 * the id (the transfer finished in the meantime).
 */
export async function sftpCancel(transferId: string): Promise<boolean> {
  return invoke('sftp_cancel', { transferId });
}

/** Release the pooled SSH multiplex masters for this connection. */
export async function sftpDisconnect(ssh: SshConnectionInfo): Promise<void> {
  return invoke('sftp_disconnect', { ssh });
}

/** Subscribe to live transfer progress emitted by the backend. */
export async function onSftpProgress(
  handler: (p: SftpProgressPayload) => void,
): Promise<UnlistenFn> {
  return listen<SftpProgressPayload>('sftp-progress', (e) => handler(e.payload));
}
