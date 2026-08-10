/**
 * Frontend half of the Remote Desktop setup guide trace.
 *
 * The guide is a frontend-driven state machine: React decides which branch to
 * take, which command to show the user, when to poll, and when to declare a
 * step done. The backend only answers probes. That means a bug report like
 * "it told me to install something that was already installed" cannot be
 * diagnosed from backend logs alone — the *decision* happened here.
 *
 * This module bridges those decisions into the very same `logs/debug.log` the
 * backend writes to, sharing one `run_id` so a whole session
 * (probe → install → password → start → connect) reads as a single
 * chronological trace.
 *
 * Rules enforced here:
 * - Secrets (SSH / VNC passwords) are redacted **before** leaving the renderer.
 * - Logging is fire-and-forget and can never throw into guide logic.
 * - Entries are serialized so their on-disk order matches their call order.
 */

import { invoke } from '@tauri-apps/api/core';

export type RdLogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

/** Phases mirror the guide's `SetupPhase` plus a few lifecycle-only stages. */
export type RdLogPhase =
  | 'config'
  | 'connecting'
  | 'checking'
  | 'install'
  | 'password'
  | 'start'
  | 'ready'
  | 'viewer'
  | 'error'
  | '-';

let currentRunId = '-';

/**
 * Secrets are kept only in memory and only to strip them out of log payloads.
 * Anything shorter than 3 chars is ignored: it would match everywhere and turn
 * the log into noise (same rule as the backend redactor).
 */
const secrets = new Set<string>();

/** Serializes IPC calls so log order on disk equals call order. */
let tail: Promise<void> = Promise.resolve();

/**
 * Mint a correlation id for a new guide session.
 * Called when the user hits Connect; every later entry carries it.
 */
export function startRdRun(host: string): string {
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\..+$/, '');
  const suffix = Math.random().toString(36).slice(2, 6);
  currentRunId = `rd-${sanitizeToken(host) || 'host'}-${stamp}-${suffix}`;
  return currentRunId;
}

export function currentRdRunId(): string {
  return currentRunId;
}

/**
 * Close out a run.
 *
 * Secrets are dropped immediately, but the run id is deliberately kept until
 * the next `startRdRun`: React unmount teardown (viewer cleanup, tunnel close)
 * fires *after* this call and those entries still belong to the run that is
 * ending. Resetting the id here would orphan exactly the events that explain
 * how a session terminated.
 */
export function endRdRun(): void {
  secrets.clear();
}

/** Register a value that must never appear in the log. */
export function registerRdSecret(value?: string | null): void {
  if (value && value.length >= 3) secrets.add(value);
}

export function clearRdSecrets(): void {
  secrets.clear();
}

/** Replace every registered secret with a fixed mask. */
export function rdRedact(value: string): string {
  let out = value;
  for (const secret of secrets) {
    if (out.includes(secret)) out = out.split(secret).join('***REDACTED***');
  }
  return out;
}

/** Describe a secret by presence and length only — never its value. */
export function rdShape(value?: string | null): string {
  if (value === undefined || value === null) return 'none';
  if (value.length === 0) return 'empty';
  return `set(len=${value.length})`;
}

/** Collapse newlines/tabs so one logical entry stays on one physical line. */
function oneLine(value: string): string {
  return value.replace(/\r/g, '\\r').replace(/\n/g, '\\n').replace(/\t/g, '\\t');
}

function clamp(value: string, max = 4096): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}…<truncated, total ${value.length} chars>`;
}

function sanitizeToken(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, '');
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
export function rdFields(fields: Record<string, unknown>): string {
  return Object.entries(fields)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${renderValue(v)}`)
    .join(' ');
}

/**
 * Append one entry to debug.log.
 *
 * Never awaited by callers: a logging hiccup must not alter guide behaviour.
 */
export function rdLog(
  level: RdLogLevel,
  phase: RdLogPhase,
  event: string,
  detail: string | Record<string, unknown> = '',
): void {
  const raw = typeof detail === 'string' ? detail : rdFields(detail);
  const payload = clamp(oneLine(rdRedact(raw)));
  // Snapshot the run id *now*: the IPC call is queued, and by the time it
  // drains the run may already have ended, which would stamp trailing entries
  // with `-` and break the correlation of the very events that end a run.
  const runId = currentRunId;

  tail = tail
    .then(() =>
      invoke('append_remote_desktop_log', {
        level,
        runId,
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
    const line = `[rd-guide] ${phase}/${event} ${payload}`;
    if (level === 'ERROR') console.error(line);
    else if (level === 'WARN') console.warn(line);
    else console.log(line);
  }
}

/**
 * Wrap an async operation with begin/ok/err entries and an elapsed time.
 *
 * Used for everything that crosses the IPC boundary, because "the guide hung"
 * is otherwise indistinguishable from "the guide never made the call".
 */
export async function rdTimed<T>(
  phase: RdLogPhase,
  event: string,
  fn: () => Promise<T>,
  context: Record<string, unknown> = {},
  describe?: (result: T) => Record<string, unknown>,
): Promise<T> {
  const started = Date.now();
  rdLog('DEBUG', phase, `${event}.begin`, context);
  try {
    const result = await fn();
    rdLog('INFO', phase, `${event}.ok`, {
      elapsed_ms: Date.now() - started,
      ...(describe ? describe(result) : {}),
    });
    return result;
  } catch (e) {
    rdLog('ERROR', phase, `${event}.err`, {
      elapsed_ms: Date.now() - started,
      error: e instanceof Error ? `${e.name}: ${e.message}` : String(e),
    });
    throw e;
  }
}
