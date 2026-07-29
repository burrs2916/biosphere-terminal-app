// Central registry of pending notebook saves.
//
// The editor autosaves on a 2s debounce. If the user closes the window inside
// that window, the fire-and-forget unmount save may be abandoned when the
// webview is torn down — losing the last keystrokes (R6-1).
//
// To make the flush reliable we intercept the Tauri window close event and
// await every registered pending save *before* the window is actually
// destroyed. Each mounted NoteEditor registers a flush closure here.

type FlushFn = () => Promise<void>;

const registry = new Set<FlushFn>();

/** Register a flush closure. Returns an unregister function. */
export function registerNotebookFlush(fn: FlushFn): () => void {
  registry.add(fn);
  return () => {
    registry.delete(fn);
  };
}

/** Await all registered pending saves. Safe to call when nothing is pending. */
export async function flushAllNotebook(): Promise<void> {
  const tasks = Array.from(registry).map((fn) => fn().catch(() => undefined));
  if (tasks.length) {
    await Promise.all(tasks);
  }
}
