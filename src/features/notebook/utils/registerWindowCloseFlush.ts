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

/**
 * Close vetoes registered by features that must not die silently — an active
 * SFTP transfer, for instance. Each guard returns true while it wants the
 * close attempt blocked. Cheap to call, must stay synchronous.
 */
type CloseGuard = () => boolean;
const closeGuards = new Map<string, CloseGuard>();

/** Called in the UI layer when a close attempt was vetoed, to raise a dialog. */
type CloseBlockedListener = (guardIds: string[]) => void;
const closeBlockedListeners = new Set<CloseBlockedListener>();

/**
 * Register a veto over window close. While `shouldBlock()` returns true the
 * close handler refuses to destroy the window and notifies the UI instead —
 * the user then decides through a confirm dialog. Returns the unregister fn.
 */
export function registerWindowCloseGuard(id: string, shouldBlock: CloseGuard): () => void {
  closeGuards.set(id, shouldBlock);
  return () => {
    closeGuards.delete(id);
  };
}

/** Subscribe to "close was blocked" events. Returns the unsubscribe fn. */
export function onCloseBlocked(listener: CloseBlockedListener): () => void {
  closeBlockedListeners.add(listener);
  return () => {
    closeBlockedListeners.delete(listener);
  };
}

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
      // Guards veto first: a running transfer must not be killed by an
      // accidental close — surface a confirm dialog instead of destroying.
      const blocking: string[] = [];
      for (const [id, shouldBlock] of closeGuards) {
        try {
          if (shouldBlock()) blocking.push(id);
        } catch {
          // A throwing guard must never trap the user inside the window.
        }
      }
      if (blocking.length > 0) {
        void writeFrontendLog(
          'warn',
          'window-close',
          `close-blocked | guards=${blocking.join(',')}`,
        ).catch(() => {});
        for (const listener of closeBlockedListeners) {
          try {
            listener(blocking);
          } catch {
            // Same principle: a broken dialog must not break the veto.
          }
        }
        return;
      }
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
