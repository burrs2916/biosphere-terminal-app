import { getCurrentWindow } from '@tauri-apps/api/window';
import { flushAllNotebook } from './notebookFlush';
import { writeFrontendLog } from '../../../core/services/agent.service';

let initialized = false;

/**
 * How long the close handler waits for pending notebook saves before it
 * destroys the window anyway.
 *
 * The autosave debounce is 2s, so a flush that has not settled by ~2.5s is
 * not "still saving" — the IPC round trip itself is stuck. That is exactly
 * the freeze scenario where the user cannot close the window at all, and
 * trapping them behind a hung flush is the worse failure: one dropped
 * debounce cycle (the autosave fires again on next launch) is the lesser
 * one. The window must always end up destroyed.
 */
const FLUSH_GRACE_MS = 2500;

/** Resolve 'ok' when `p` settles (either way) and 'timeout' after `ms`. */
function raceTimeout(p: Promise<unknown>, ms: number): Promise<'ok' | 'timeout'> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (v: 'ok' | 'timeout') => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(v);
    };
    const timer = setTimeout(() => finish('timeout'), ms);
    p.then(
      () => finish('ok'),
      () => finish('ok'),
    );
  });
}

/**
 * Intercept the Tauri window close so we can flush all pending notebook saves
 * before the webview is destroyed. Without this, the 2s autosave debounce can
 * drop the last keystrokes when the window closes (R6-1).
 *
 * We preventDefault() the close, await every registered flush (bounded by
 * FLUSH_GRACE_MS), then destroy() the window (destroy bypasses CloseRequested,
 * so no re-entrancy). The outcome is logged to debug.log either way: a
 * 'timeout' entry is the signature of a backend-side stall, which is what the
 * support logs need to show.
 */
export async function initWindowCloseFlush(): Promise<void> {
  if (initialized) return;
  initialized = true;
  try {
    const win = getCurrentWindow();
    const unlisten = await win.onCloseRequested(async (event) => {
      event.preventDefault();
      const started = Date.now();
      let outcome: 'ok' | 'timeout' | 'error' = 'ok';
      // Always close the window, even if the flush throws or hangs — we own
      // the close now (preventDefault) and a hang here would trap the user.
      try {
        const raced = await raceTimeout(flushAllNotebook(), FLUSH_GRACE_MS);
        if (raced === 'timeout') outcome = 'timeout';
      } catch (err) {
        outcome = 'error';
        console.error('[window-close-flush] flush failed, closing anyway:', err);
      }
      void writeFrontendLog(
        outcome === 'ok' ? 'info' : 'warn',
        'window-close',
        `close-flush | outcome=${outcome} elapsed=${Date.now() - started}ms`,
      ).catch(() => {});
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
