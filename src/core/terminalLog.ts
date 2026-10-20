/**
 * Frontend-side Terminal diagnostics.
 *
 * Everything here is forwarded to the backend, which appends it to the same
 * `debug.log` the Rust side writes to. The two halves share one monotonically
 * increasing sequence number, so a frontend entry and the backend entry it
 * caused can be ordered exactly.
 *
 * Why this exists: a Windows report of "the app froze / quit by itself" is
 * almost never explained by the Rust logs alone. The frontend is where the
 * WebGL renderer is attached, where the output chunks are written into xterm,
 * and where the `spawnTerminal` promise settles. Without those entries the
 * only thing on disk is "the backend was called and never answered" — which
 * does not tell us whether the renderer died, the chunk flood stalled the
 * renderer, or the invoke never arrived.
 */

import { invoke } from '@tauri-apps/api/core';

export type TermLogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

/**
 * Phases are free-form but kept short so the trace stays scannable.
 * They mark where in the terminal lifecycle an event happened.
 */
export type TermLogPhase =
  | 'spawn'
  | 'renderer'
  | 'output'
  | 'input'
  | 'lifecycle'
  | 'conn';

function oneLine(value: string): string {
  return value.replace(/\r/g, '\\r').replace(/\n/g, '\\n').replace(/\t/g, '\\t');
}

function clamp(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}…<truncated, total ${value.length} chars>`;
}

/**
 * Serialize IPC calls. `invoke` is async, so without a queue two log calls
 * can reach the backend out of order and the shared sequence number stops
 * describing reality.
 */
let tail: Promise<unknown> = Promise.resolve();

/**
 * Append one entry to `debug.log`.
 *
 * Never awaited by callers: a logging hiccup must not alter terminal
 * behaviour. Failures are swallowed (the IPC may not be ready during the
 * earliest bootstrap lines) but mirrored to the console in dev builds.
 */
export function termLog(
  level: TermLogLevel,
  phase: TermLogPhase,
  event: string,
  detail: string = '',
): void {
  const payload = clamp(oneLine(detail), 8192);

  tail = tail
    .then(() =>
      invoke('append_terminal_log', {
        level,
        phase,
        event,
        detail: payload,
      }),
    )
    .then(
      () => undefined,
      () => undefined,
    );

  if (import.meta.env.DEV) {
    const line = `[term] ${phase}/${event} ${payload}`;
    if (level === 'ERROR') console.error(line);
    else if (level === 'WARN') console.warn(line);
    else console.log(line);
  }
}

/**
 * Wrap an async operation with begin/ok/err entries and an elapsed time.
 *
 * Used for everything that crosses the IPC boundary, because "the call never
 * came back" is otherwise indistinguishable from "the call never happened".
 */
export async function termTimed<T>(
  phase: TermLogPhase,
  event: string,
  fn: () => Promise<T>,
  context: Record<string, unknown> = {},
  describe?: (result: T) => Record<string, unknown>,
): Promise<T> {
  const started = Date.now();
  termLog('DEBUG', phase, `${event}.begin`, renderFields(context));
  try {
    const result = await fn();
    const extra = describe ? describe(result) : {};
    termLog(
      'DEBUG',
      phase,
      `${event}.ok`,
      renderFields({ ...context, ...extra, elapsedMs: Date.now() - started }),
    );
    return result;
  } catch (e) {
    termLog(
      'ERROR',
      phase,
      `${event}.err`,
      renderFields({ ...context, elapsedMs: Date.now() - started, error: describeError(e) }),
    );
    throw e;
  }
}

/** Render a value for a `key=value` token, keeping it greppable. */
function renderValue(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (typeof value === 'string') return value.length === 0 ? "''" : value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/** Build a `k=v k=v` detail string, dropping undefined-valued keys. */
export function renderFields(fields: Record<string, unknown>): string {
  return Object.entries(fields)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${renderValue(v)}`)
    .join(' ');
}

function describeError(e: unknown): string {
  if (e instanceof Error) return `${e.name}: ${e.message}`;
  if (typeof e === 'string') return e;
  try {
    return JSON.stringify(e) ?? String(e);
  } catch {
    return String(e);
  }
}
