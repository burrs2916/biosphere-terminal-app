import { getCurrentWindow } from '@tauri-apps/api/window';
import { flushAllNotebook } from './notebookFlush';

let initialized = false;

/**
 * Intercept the Tauri window close so we can flush all pending notebook saves
 * before the webview is destroyed. Without this, the 2s autosave debounce can
 * drop the last keystrokes when the window closes (R6-1).
 *
 * We preventDefault() the close, await every registered flush, then destroy()
 * the window (destroy bypasses CloseRequested, so no re-entrancy).
 */
export async function initWindowCloseFlush(): Promise<void> {
  if (initialized) return;
  initialized = true;
  try {
    const win = getCurrentWindow();
    const unlisten = await win.onCloseRequested(async (event) => {
      event.preventDefault();
      // Always close the window, even if the flush throws — we own the close
      // now (preventDefault) and a hang here would trap the user.
      try {
        await flushAllNotebook();
      } catch (err) {
        console.error('[window-close-flush] flush failed, closing anyway:', err);
      }
      try {
        // destroy() closes the window without re-emitting CloseRequested
        // (close() would re-enter this handler and loop forever).
        await win.destroy();
      } catch (err) {
        console.error('[window-close-flush] destroy failed:', err);
      }
    });
    // Keep the unlisten alive for the app lifetime. If the env isn't Tauri,
    // the try/catch below resets the guard so a later call can retry.
    void unlisten;
  } catch {
    // Not running inside Tauri (e.g. plain browser preview) — ignore.
    initialized = false;
  }
}
