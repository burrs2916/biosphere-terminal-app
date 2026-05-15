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
