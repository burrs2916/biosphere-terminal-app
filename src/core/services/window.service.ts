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
    url: `/category-notes?groupId=${encodeURIComponent(groupId)}&category=${encodeURIComponent(categoryName)}`,
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

export async function openRemoteDesktopWindow(sshParams?: {
  host: string;
  port?: number;
  username: string;
  authMethod: string;
  privateKeyPath?: string;
  password?: string;
}): Promise<WebviewWindow | null> {
  const id = Date.now().toString(36);
  const key = `remote-desktop-${id}`;

  let url = '/remote-desktop';
  if (sshParams) {
    const params = new URLSearchParams();
    params.set('host', sshParams.host);
    if (sshParams.port) params.set('port', String(sshParams.port));
    params.set('username', sshParams.username);
    params.set('authMethod', sshParams.authMethod);
    if (sshParams.privateKeyPath) params.set('privateKeyPath', sshParams.privateKeyPath);
    if (sshParams.password) params.set('password', sshParams.password);
    url += `?${params.toString()}`;
  }

  const webview = new WebviewWindow(key, {
    url,
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

  webview.once('tauri://error', (e) => {
    console.error('[window] failed to create remote desktop window:', e);
    openWindows.delete(key);
  });

  return webview;
}

export async function openPluginScriptViewerWindow(pluginId: string, pluginName: string): Promise<WebviewWindow | null> {
  const key = `plugin-script-${pluginId}`;

  const existing = await WebviewWindow.getByLabel(key);
  if (existing) {
    await existing.setFocus();
    return existing;
  }

  const webview = new WebviewWindow(key, {
    url: `/plugin-script-viewer?pluginId=${encodeURIComponent(pluginId)}`,
    title: `${pluginName} — Script Viewer`,
    width: 800,
    height: 600,
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
    console.error('[window] failed to create plugin script viewer window:', e);
    openWindows.delete(key);
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
    url: `/category-notes?noteId=${encodeURIComponent(noteId)}`,
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
    url: '/category-notes',
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
  const id = Date.now().toString(36);
  const key = `notes-ref-${id}`;

  const webview = new WebviewWindow(key, {
    url: '/notes-reference',
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
  const id = Date.now().toString(36);
  const key = `ai-copilot-${id}`;

  const webview = new WebviewWindow(key, {
    url: '/ai-copilot',
    title: 'AI Copilot',
    width: 480,
    height: 700,
    minWidth: 360,
    minHeight: 500,
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

export async function openPluginWorkshopWindow(): Promise<WebviewWindow | null> {
  const id = Date.now().toString(36);
  const key = `plugin-workshop-${id}`;

  const webview = new WebviewWindow(key, {
    url: '/plugin-workshop',
    title: 'Plugin Workshop',
    width: 900,
    height: 700,
    minWidth: 700,
    minHeight: 500,
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
    console.error('[window] failed to create plugin workshop window:', e);
    openWindows.delete(key);
  });

  return webview;
}
