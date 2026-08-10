import { WebviewWindow } from '@tauri-apps/api/webviewWindow';

const openWindows = new Map<string, WebviewWindow>();

export async function openCategoryNotesWindow(groupId: string, categoryName: string): Promise<WebviewWindow | null> {
  const key = `category-notes-${groupId}-${categoryName || 'all'}`;

  const existing = await WebviewWindow.getByLabel(key);
  if (existing) {
    await existing.setFocus();
    return existing;
  }

  const title = categoryName
    ? `${categoryName} — Notes`
    : 'All Notes';

  const webview = new WebviewWindow(key, {
    url: `/#/category-notes?groupId=${encodeURIComponent(groupId)}&category=${encodeURIComponent(categoryName)}`,
    title,
    width: 1000,
    height: 700,
    minWidth: 600,
    minHeight: 400,
    center: true,
    resizable: true,
    decorations: true,
    focus: true,
  });

  openWindows.set(key, webview);

  webview.once('tauri://destroyed', () => {
    openWindows.delete(key);
  });

  webview.once('tauri://error', (e) => {
    console.error('[window] failed to create category notes window:', e);
    openWindows.delete(key);
  });

  return webview;
}

interface SshWindowParams {
  host: string;
  port?: number;
  username: string;
  authMethod: string;
  privateKeyPath?: string;
  password?: string;
  /** 来源连接的 id，用于把安装档位等偏好持久化到该连接。 */
  connectionId?: string;
}

/**
 * Resolve an existing window by label, but only if it is actually usable.
 *
 * `WebviewWindow.getByLabel` can keep returning a window that failed to load or
 * was destroyed but not yet released by the runtime. If we then keep
 * `setFocus()`-ing that dead handle, clicking the toolbar button looks like it
 * "does nothing" — no new window, no error. So: if the window can't be focused
 * or isn't visible, destroy it and let the caller create a fresh one.
 */
async function reuseOrRecreate(key: string): Promise<WebviewWindow | null> {
  try {
    const existing = await WebviewWindow.getByLabel(key);
    if (!existing) return null;
    let alive = true;
    try {
      await existing.setFocus();
      const visible = await existing.isVisible().catch(() => false);
      alive = !!visible;
    } catch {
      alive = false;
    }
    if (alive) return existing;
    try {
      await existing.destroy();
    } catch {
      /* ignore */
    }
    return null;
  } catch {
    return null;
  }
}

function buildSshUrl(path: string, sshParams?: SshWindowParams): string {
  if (!sshParams) return `/#/${path}`;
  const params = new URLSearchParams();
  params.set('host', sshParams.host);
  if (sshParams.port) params.set('port', String(sshParams.port));
  params.set('username', sshParams.username);
  params.set('authMethod', sshParams.authMethod);
  if (sshParams.privateKeyPath) params.set('privateKeyPath', sshParams.privateKeyPath);
  if (sshParams.password) params.set('password', sshParams.password);
  if (sshParams.connectionId) params.set('connectionId', sshParams.connectionId);
  return `/#/${path}?${params.toString()}`;
}

export async function openRemoteDesktopWindow(
  sshParams?: SshWindowParams,
  onError?: (msg: string) => void,
): Promise<WebviewWindow | null> {
  const key = 'remote-desktop';

  const existing = await reuseOrRecreate(key);
  if (existing) return existing;

  const webview = new WebviewWindow(key, {
    url: buildSshUrl('remote-desktop', sshParams),
    title: 'Remote Desktop',
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    center: true,
    resizable: true,
    decorations: true,
    focus: true,
  });

  openWindows.set(key, webview);

  webview.once('tauri://destroyed', () => {
    openWindows.delete(key);
  });

  webview.once('tauri://error', (e: any) => {
    console.error('[window] failed to create remote desktop window:', e);
    openWindows.delete(key);
    const raw = e?.payload?.message ?? e?.payload ?? e;
    onError?.(typeof raw === 'string' ? raw : JSON.stringify(raw));
  });

  return webview;
}

export async function openSftpWindow(
  sshParams?: SshWindowParams,
  onError?: (msg: string) => void,
): Promise<WebviewWindow | null> {
  const key = 'sftp';

  const existing = await reuseOrRecreate(key);
  if (existing) return existing;

  const webview = new WebviewWindow(key, {
    url: buildSshUrl('sftp', sshParams),
    title: 'SFTP File Transfer',
    width: 900,
    height: 650,
    minWidth: 600,
    minHeight: 400,
    center: true,
    resizable: true,
    decorations: true,
    focus: true,
  });

  openWindows.set(key, webview);

  webview.once('tauri://destroyed', () => {
    openWindows.delete(key);
  });

  webview.once('tauri://error', (e: any) => {
    console.error('[window] failed to create sftp window:', e);
    openWindows.delete(key);
    const raw = e?.payload?.message ?? e?.payload ?? e;
    onError?.(typeof raw === 'string' ? raw : JSON.stringify(raw));
  });

  return webview;
}

export async function openNoteEditorWindow(noteId: string, title?: string): Promise<WebviewWindow | null> {
  const key = `note-editor-${noteId}`;

  const existing = await WebviewWindow.getByLabel(key);
  if (existing) {
    await existing.setFocus();
    return existing;
  }

  const webview = new WebviewWindow(key, {
    url: `/#/category-notes?noteId=${encodeURIComponent(noteId)}`,
    title: title || 'Note Editor',
    width: 1000,
    height: 700,
    minWidth: 600,
    minHeight: 400,
    center: true,
    resizable: true,
    decorations: true,
    focus: true,
  });

  openWindows.set(key, webview);

  webview.once('tauri://destroyed', () => {
    openWindows.delete(key);
  });

  webview.once('tauri://error', (e) => {
    console.error('[window] failed to create note editor window:', e);
    openWindows.delete(key);
  });

  return webview;
}

export async function openAllNotesWindow(): Promise<WebviewWindow | null> {
  const key = 'category-notes-all';

  const existing = await WebviewWindow.getByLabel(key);
  if (existing) {
    await existing.setFocus();
    return existing;
  }

  const webview = new WebviewWindow(key, {
    url: '/#/category-notes',
    title: 'All Notes',
    width: 1000,
    height: 700,
    minWidth: 600,
    minHeight: 400,
    center: true,
    resizable: true,
    decorations: true,
    focus: true,
  });

  openWindows.set(key, webview);

  webview.once('tauri://destroyed', () => {
    openWindows.delete(key);
  });

  webview.once('tauri://error', (e) => {
    console.error('[window] failed to create all notes window:', e);
    openWindows.delete(key);
  });

  return webview;
}

export async function openNotesReferenceWindow(): Promise<WebviewWindow | null> {
  const key = 'notes-ref';

  const existing = await WebviewWindow.getByLabel(key);
  if (existing) {
    await existing.setFocus();
    return existing;
  }

  const webview = new WebviewWindow(key, {
    url: '/#/notes-reference',
    title: 'Notes Reference',
    width: 1000,
    height: 700,
    minWidth: 600,
    minHeight: 400,
    center: true,
    resizable: true,
    decorations: true,
    focus: true,
  });

  openWindows.set(key, webview);

  webview.once('tauri://destroyed', () => {
    openWindows.delete(key);
  });

  webview.once('tauri://error', (e) => {
    console.error('[window] failed to create notes reference window:', e);
    openWindows.delete(key);
  });

  return webview;
}

export async function openAiCopilotWindow(): Promise<WebviewWindow | null> {
  const key = 'ai-copilot';

  const existing = await WebviewWindow.getByLabel(key);
  if (existing) {
    await existing.setFocus();
    return existing;
  }

  const webview = new WebviewWindow(key, {
    url: '/#/ai-copilot',
    title: 'AI Copilot',
    width: 880,
    height: 760,
    minWidth: 480,
    minHeight: 560,
    center: true,
    resizable: true,
    decorations: true,
    focus: true,
  });

  openWindows.set(key, webview);

  webview.once('tauri://destroyed', () => {
    openWindows.delete(key);
  });

  webview.once('tauri://error', (e) => {
    console.error('[window] failed to create ai copilot window:', e);
    openWindows.delete(key);
  });

  return webview;
}
