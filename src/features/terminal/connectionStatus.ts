/**
 * Independent, robust connection-status state machine for terminal sessions.
 *
 * The status bar, the tab markers and the connecting/disconnected overlays all
 * derive from this one reducer, so the on-screen feedback can never drift from
 * the real session state. It is a *pure* function: given the previous snapshot
 * and a lifecycle event it returns the next snapshot — no timers, no I/O, no
 * ambiguity.
 *
 * Why it cannot lie or lag:
 * - A session only ever moves forward: `connecting -> connected -> disconnected`.
 * - `spawn_ok` promotes *only* a still-connecting session. A late or duplicate
 *   `spawn_ok` (e.g. the session already ended) can never resurrect a dead
 *   session back to "connected".
 * - `spawn_error` applies *only* while connecting, and records the reason.
 * - `closed` disconnects any live or still-connecting session and is idempotent
 *   — it never overwrites an existing disconnect reason.
 * - The only way to leave `disconnected` is a brand-new session (reconnect),
 *   which starts from a fresh `connecting` snapshot.
 *
 * Net effect: the status is always the truthful current state, each event maps
 * to exactly one immediate state update (no delay), and no out-of-order or
 * duplicated event can make it失真.
 */

export type ConnStatus = 'connecting' | 'connected' | 'disconnected';

export interface ConnSnapshot {
  status: ConnStatus;
  /** Localized reason for a `disconnected` state, when one is known. */
  error?: string;
}

/** Lifecycle events fed into the machine. */
export type ConnEvent =
  | { kind: 'spawn_ok' }
  | { kind: 'spawn_error'; error: string }
  | { kind: 'closed' };

/** Snapshot for a freshly created tab. Local shells come up ~instantly, so they
 *  never show a "connecting" phase; SSH sessions begin in `connecting`. */
export function initialConn(isSsh: boolean): ConnSnapshot {
  return isSsh ? { status: 'connecting' } : { status: 'connected' };
}

/** Pure transition. Returns a *new* snapshot only when the state actually
 *  changes; otherwise returns the previous reference (so React can bail out of
 *  a needless re-render). */
export function reduceConn(prev: ConnSnapshot, event: ConnEvent): ConnSnapshot {
  switch (event.kind) {
    case 'spawn_ok':
      // Promote only a still-connecting session.
      return prev.status === 'connecting' ? { status: 'connected' } : prev;
    case 'spawn_error':
      // Connect/auth failed; only meaningful while still connecting.
      return prev.status === 'connecting'
        ? { status: 'disconnected', error: event.error }
        : prev;
    case 'closed': {
      // A live or still-connecting session that ended is disconnected. An
      // already-disconnected session keeps its existing reason (idempotent).
      if (prev.status === 'disconnected') return prev;
      return { status: 'disconnected' };
    }
    default: {
      // Exhaustiveness guard: any new event kind must be handled explicitly,
      // otherwise this fails to compile.
      const _never: never = event;
      return _never;
    }
  }
}
