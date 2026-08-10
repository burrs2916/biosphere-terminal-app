/**
 * Terminal-output half of the Remote Desktop setup guide trace.
 *
 * The guide drives the remote server by pasting commands into an embedded SSH
 * terminal. Until now the trace recorded *what we sent* (`terminal.exec.send`)
 * and *what the probe concluded afterwards*, but never what the server actually
 * printed in between. That is precisely where the evidence lives:
 *
 *   - `E: Unable to locate package tigervnc-standalone-server`
 *   - `No match for argument: tigervnc-server`
 *   - `sudo: a terminal is required to read the password`
 *   - `A VNC server is already running as :1`
 *
 * Without those lines a failed step is only visible as "polling timed out",
 * which is indistinguishable from "the command is merely slow" — and is exactly
 * how a wrong instruction ends up looking like a hang.
 *
 * Design constraints:
 * - **Never flood.** A distro install can emit megabytes. Ordinary output is
 *   batched and globally budgeted; only notable lines bypass the batch.
 * - **Never lose the interesting part.** Lines matching failure patterns are
 *   always logged, even after the ordinary budget is exhausted.
 * - **Never break the guide.** Everything here is best-effort and swallows its
 *   own errors.
 * - **Never leak secrets.** All text goes through `rdRedact` before leaving.
 */

import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { rdLog, rdRedact, type RdLogPhase } from './remoteDesktopLog';

/** Ordinary (non-notable) lines written per run before we start suppressing.
 *  Raised to 3000 so a full distro install (CentOS `@xfce`, Debian `apt full`)
 *  does not get its progress truncated mid-run — the user reads this file to
 *  find bugs, so the command→output→result chain must stay intact. The 5 MB
 *  file rotation still bounds total size. */
const ORDINARY_LINE_BUDGET = 3000;
/** Notable lines have their own, larger budget so failures survive a noisy run. */
const NOTABLE_LINE_BUDGET = 600;
/** Lines held before a batch is flushed early. */
const BATCH_MAX_LINES = 24;
/** Idle time after which a partial batch is flushed. */
const BATCH_FLUSH_MS = 700;
/** Size of the rolling tail kept for post-mortem dumps. */
const TAIL_SIZE = 40;
/** A single line longer than this is truncated before logging. */
const MAX_LINE_LEN = 600;
/** Guard against a runaway line with no newline ever arriving. */
const MAX_PENDING_LEN = 64 * 1024;

/**
 * Patterns that mark a line as a hard failure.
 *
 * Kept deliberately narrow and anchored where possible: a false positive turns
 * a normal run into a wall of red, which is just as useless as no logging.
 */
const ERROR_PATTERNS: RegExp[] = [
  // The guide's own marker, mirroring `[WARN]` below. Every install command it
  // generates ends its mandatory step in `|| ( echo '[ERROR] …'; false )`, so
  // this line is the single most important one in the whole transcript: it is
  // the explanation the user gets for why the step failed. None of the generic
  // patterns below happen to match it.
  /\[ERROR\]/,
  /^E:\s/, // apt
  /\bUnable to locate package\b/i,
  /\bNo match for argument\b/i,
  /\bNo package .* available\b/i,
  /\bcommand not found\b/i,
  /\bPermission denied\b/i,
  /\bNo such file or directory\b/i,
  /\bOperation not permitted\b/i,
  /\bAuthentication failure\b/i,
  /\bsudo:\s/i,
  /\bfatal:\s/i,
  /^\s*error[: ]/i,
  /\berror:\s/i,
  /\bfailed to\b/i,
  /\bInstallation failed\b/i,
  /\bCould not resolve\b/i,
  /\bTemporary failure in name resolution\b/i,
  /\bConnection refused\b/i,
  /\bNo space left on device\b/i,
  /\bTraceback \(most recent call last\)/,
  /\bkilled\b/i,
  /\bsegmentation fault\b/i,
  /\bcannot open\b/i,
  /\bcannot create\b/i,
  /\bnot found in the repositor/i,
];

/**
 * Patterns worth surfacing but not fatal. `[WARN]` matters specially: the
 * guide's own generated hints echo it as a non-fatal fallback marker, so it
 * tells us a degraded path was taken (e.g. Xfce group unavailable).
 */
const WARN_PATTERNS: RegExp[] = [
  /\[WARN\]/,
  /^W:\s/, // apt warnings
  /\bwarning:\s/i,
  /\bis already running\b/i,
  /\bskipping\b/i,
  /\balready installed\b/i,
  /\bnothing to do\b/i,
  /\bdeprecated\b/i,
  /\bwould you like\b/i,
  // An interactive confirmation the pasted command cannot answer, so the step
  // stalls forever and looks like a hang. No `\b` anchor: the preceding char is
  // usually a space, and `\b` before `[` never matches there.
  /[[(](?:y\/n|yes\/no|y\/i\/n)[\])]/i,
  /\bpassword for\b/i,
];

/**
 * Completion sentinel appended to every command the guide submits.
 *
 * Why this exists: the guide used to infer "the install finished" from the
 * probe's `vncInstalled`, i.e. from `which tigervncserver`. dpkg unpacks in
 * dependency order, so that binary appears roughly a third of the way through
 * `apt install tigervnc-standalone-server … xfce4` — the guide then jumped to
 * the password step while apt was still installing Xfce's GL/CUPS tail, and the
 * next step's `apt install` died on the dpkg lock. Presence of a binary is not
 * the end of a command; only the shell can tell us that.
 *
 * Shape: `__RD:<phase>:<seq>:<exit>`
 *
 * The `<exit>` group must be digits. This is load-bearing: the terminal echoes
 * the pasted command line, so the literal text `__RD:install:3:$?` appears in
 * the output *before* the command runs. Requiring digits makes the echo
 * un-matchable, so only the shell's own expansion can satisfy it.
 *
 * `<seq>` scopes a sentinel to the exact submission that requested it, so a
 * late sentinel from a re-run step can never satisfy the current wait.
 */
const SENTINEL_RE = /__RD:([a-z_-]+):(\d+):(\d+)(?:\s|$)/i;

export interface RdCommandCompletion {
  phase: string;
  seq: number;
  exitCode: number;
}

let sentinelSeq = 0;
/** Completions observed so far, so a wait started after the fact still resolves. */
const seenCompletions = new Map<number, RdCommandCompletion>();
const completionListeners = new Set<(c: RdCommandCompletion) => void>();

/**
 * Allocate a sentinel and return the shell suffix that emits it.
 *
 * `$?` is expanded by the shell, so the exit status reported is that of the
 * command the suffix is appended to — including the last link of an `&&` chain.
 */
export function nextRdSentinel(phase: string): { seq: number; suffix: string } {
  sentinelSeq += 1;
  const safePhase = phase.replace(/[^a-z_-]/gi, '') || 'step';
  return {
    seq: sentinelSeq,
    suffix: `; echo "__RD:${safePhase}:${sentinelSeq}:$?"`,
  };
}

/**
 * Whether a given submission has finished, without blocking.
 *
 * The guide already runs a polling loop for remote state, so it checks this on
 * each tick rather than awaiting — one loop, one place that decides to advance,
 * and no promise left dangling if the sentinel never arrives.
 */
export function peekRdCommand(seq: number): RdCommandCompletion | null {
  return seenCompletions.get(seq) ?? null;
}

function handleSentinel(state: CaptureState, line: string): boolean {
  const m = SENTINEL_RE.exec(line);
  if (!m) return false;

  const completion: RdCommandCompletion = {
    phase: m[1],
    seq: Number(m[2]),
    exitCode: Number(m[3]),
  };
  // 幂等：同一 seq 的 sentinel 可能在整行与 lastFrame 两处都匹配到（见 handleLine），
  // 避免重复触发 flush / rdLog / listener 等副作用。
  if (seenCompletions.has(completion.seq)) return true;
  seenCompletions.set(completion.seq, completion);

  // The sentinel is the authoritative end-of-command marker, so everything the
  // command printed must already be in the log when it lands.
  emitRepeat(state);
  flushBatch(state, 'before_sentinel');
  // A new command starts from a clean slate for duplicate compression.
  state.lastLine = '';
  state.repeatCount = 0;
  rdLog(
    completion.exitCode === 0 ? 'INFO' : 'ERROR',
    state.getPhase(),
    'terminal.command.done',
    {
      session_id: state.sessionId,
      sentinel_phase: completion.phase,
      seq: completion.seq,
      exit_code: completion.exitCode,
      note:
        completion.exitCode === 0
          ? 'command finished; the step may now advance'
          : 'command exited non-zero — the step failed rather than being merely slow',
      ...(completion.exitCode === 0 ? {} : { tail: state.tail.slice(-12).join(' ⏎ ') }),
    },
  );

  for (const fn of Array.from(completionListeners)) {
    try {
      fn(completion);
    } catch {
      /* a listener must never break capture */
    }
  }
  return true;
}

type Severity = 'ERROR' | 'WARN' | null;

function classify(line: string): Severity {
  for (const re of ERROR_PATTERNS) if (re.test(line)) return 'ERROR';
  for (const re of WARN_PATTERNS) if (re.test(line)) return 'WARN';
  return null;
}

/**
 * Strip ANSI/VT control sequences so the log holds readable text.
 *
 * Covers CSI (`ESC [ ... final`), OSC (`ESC ] ... BEL|ST`) — which carries the
 * window title and would otherwise dump the whole prompt into the log — plus
 * two-character escapes and stray C0 controls.
 */
function stripAnsi(value: string): string {
  return value
    // OSC: ESC ] ... (BEL | ESC \)
    .replace(/\u001B\][\s\S]*?(?:\u0007|\u001B\\)/g, '')
    // CSI: ESC [ params intermediates final
    .replace(/\u001B\[[0-9;?]*[ -/]*[@-~]/g, '')
    // nF sequences: ESC + intermediates(0x20-0x2F) + final(0x30-0x7E).
    // This is charset designation such as `ESC ( B`, which many programs emit
    // on every prompt redraw. `[@-Z\-_]` below does not cover it because `(`
    // is 0x28, outside that range — it used to leak through as literal "(B".
    .replace(/\u001B[ -/]+[0-~]/g, '')
    // Other two-char escapes (keypad mode, index, ...)
    .replace(/\u001B[@-Z\\-_]/g, '')
    // Remaining C0 controls except \t \n \r
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
}

/**
 * Collapse an in-place redraw to its final state.
 *
 * Package managers animate progress with carriage returns (`10%\r20%\r...`).
 * Logging every frame buries the run; only the last frame carries information.
 */
function lastFrame(line: string): string {
  const idx = line.lastIndexOf('\r');
  return idx === -1 ? line : line.slice(idx + 1);
}

interface CaptureState {
  sessionId: string;
  getPhase: () => RdLogPhase;
  unlisteners: UnlistenFn[];
  disposed: boolean;
  pending: string;
  batch: string[];
  timer: ReturnType<typeof setTimeout> | null;
  tail: string[];
  ordinaryLogged: number;
  notableLogged: number;
  suppressed: number;
  totalLines: number;
  totalBytes: number;
  lastLine: string;
  repeatCount: number;
}

let active: CaptureState | null = null;

function truncateLine(line: string): string {
  return line.length <= MAX_LINE_LEN
    ? line
    : `${line.slice(0, MAX_LINE_LEN)}…<+${line.length - MAX_LINE_LEN}>`;
}

/** Flush the pending batch of ordinary lines as one entry. */
function flushBatch(state: CaptureState, reason: string): void {
  if (state.timer) {
    clearTimeout(state.timer);
    state.timer = null;
  }
  if (state.batch.length === 0) return;

  const lines = state.batch;
  state.batch = [];
  rdLog('DEBUG', state.getPhase(), 'terminal.out.chunk', {
    session_id: state.sessionId,
    lines: lines.length,
    reason,
    text: lines.join(' ⏎ '),
  });
}

function scheduleFlush(state: CaptureState): void {
  if (state.timer) return;
  state.timer = setTimeout(() => {
    state.timer = null;
    if (!state.disposed) flushBatch(state, 'idle');
  }, BATCH_FLUSH_MS);
}

/**
 * Emit a run of identical consecutive lines that just ended.
 * Repeated identical output (retry loops, `.` spinners) is compressed to one
 * entry with a count instead of N entries.
 */
function emitRepeat(state: CaptureState): void {
  if (state.repeatCount <= 1) return;
  const line = `${state.lastLine} ×${state.repeatCount}`;
  state.repeatCount = 0;
  pushOrdinary(state, line, true);
}

function pushOrdinary(state: CaptureState, line: string, force = false): void {
  if (!force && state.ordinaryLogged >= ORDINARY_LINE_BUDGET) {
    state.suppressed += 1;
    return;
  }
  state.ordinaryLogged += 1;
  state.batch.push(line);
  if (state.batch.length >= BATCH_MAX_LINES) flushBatch(state, 'full');
  else scheduleFlush(state);

  if (state.ordinaryLogged === ORDINARY_LINE_BUDGET) {
    flushBatch(state, 'budget');
    rdLog('WARN', state.getPhase(), 'terminal.out.budget_reached', {
      session_id: state.sessionId,
      ordinary_budget: ORDINARY_LINE_BUDGET,
      note: 'further ordinary output is counted but not written; notable lines still are',
    });
  }
}

function handleLine(state: CaptureState, rawLine: string): void {
  const fullCleaned = stripAnsi(rawLine);
  const cleaned = stripAnsi(lastFrame(rawLine)).trimEnd();
  state.totalLines += 1;
  if (cleaned.trim().length === 0 && fullCleaned.trim().length === 0) return;

  // The sentinel must be scanned across the whole line, not just the last frame.
  // Terminal output ends a line with `\r\n`, or the shell prints its prompt
  // (no `\r`) immediately after the `echo`ed sentinel — in both cases
  // `lastFrame` (which keeps only what follows the final `\r`) drops the
  // sentinel frame, so `completion` would stay null forever and the guide would
  // hang on "command still running". Scan the full line first, then fall back
  // to the last frame.
  if (handleSentinel(state, fullCleaned)) return;
  if (cleaned.trim().length === 0) return;
  if (handleSentinel(state, cleaned)) return;

  const line = truncateLine(rdRedact(cleaned));

  // Keep the rolling tail regardless of budget — it is the post-mortem view.
  state.tail.push(line);
  if (state.tail.length > TAIL_SIZE) state.tail.shift();

  // Compress consecutive duplicates.
  if (line === state.lastLine) {
    state.repeatCount += 1;
    return;
  }
  emitRepeat(state);
  state.lastLine = line;
  state.repeatCount = 1;

  const severity = classify(line);
  if (severity) {
    if (state.notableLogged >= NOTABLE_LINE_BUDGET) {
      state.suppressed += 1;
      return;
    }
    state.notableLogged += 1;
    // Order matters: a notable line must appear after the ordinary lines that
    // preceded it, so drain the batch first.
    flushBatch(state, 'before_notable');
    rdLog(severity, state.getPhase(), 'terminal.out.notable', {
      session_id: state.sessionId,
      text: line,
    });
    return;
  }

  pushOrdinary(state, line);
}

function ingest(state: CaptureState, data: string): void {
  state.totalBytes += data.length;
  state.pending += data;

  // A line that never terminates must not grow without bound.
  if (state.pending.length > MAX_PENDING_LEN) {
    handleLine(state, state.pending);
    state.pending = '';
    return;
  }

  let idx = state.pending.indexOf('\n');
  while (idx !== -1) {
    const line = state.pending.slice(0, idx);
    state.pending = state.pending.slice(idx + 1);
    handleLine(state, line);
    idx = state.pending.indexOf('\n');
  }
}

/**
 * Begin mirroring a setup terminal's output into the guide trace.
 *
 * `getPhase` is read per line rather than captured once, so output is attributed
 * to the step the guide was on when the server printed it.
 */
export function startRdTerminalCapture(
  sessionId: string,
  getPhase: () => RdLogPhase,
): void {
  stopRdTerminalCapture('restarted');

  const state: CaptureState = {
    sessionId,
    getPhase,
    unlisteners: [],
    disposed: false,
    pending: '',
    batch: [],
    timer: null,
    tail: [],
    ordinaryLogged: 0,
    notableLogged: 0,
    suppressed: 0,
    totalLines: 0,
    totalBytes: 0,
    lastLine: '',
    repeatCount: 0,
  };
  active = state;
  // Completions belong to the terminal that produced them; a fresh capture must
  // not be able to satisfy a wait with a sentinel from a previous session.
  seenCompletions.clear();

  rdLog('INFO', getPhase(), 'terminal.capture.start', {
    session_id: sessionId,
    ordinary_budget: ORDINARY_LINE_BUDGET,
    notable_budget: NOTABLE_LINE_BUDGET,
  });

  const attach = <T>(event: string, handler: (payload: T) => void) => {
    listen<T>(event, (e) => {
      if (state.disposed) return;
      try {
        handler(e.payload);
      } catch {
        /* logging must never disturb the guide */
      }
    })
      .then((un) => {
        // The capture may have been stopped while the listener was registering.
        if (state.disposed) un();
        else state.unlisteners.push(un);
      })
      .catch(() => {
        rdLog('WARN', getPhase(), 'terminal.capture.listen_failed', {
          session_id: sessionId,
          event,
          note: 'remote command output will be missing from this trace',
        });
      });
  };

  attach<{ session_id: string; data: string }>('terminal-output', (p) => {
    if (p.session_id !== sessionId) return;
    ingest(state, p.data);
  });

  // The setup shell dying mid-guide leaves the UI polling forever. That looks
  // like a hang and is invisible without this.
  attach<{ session_id: string; exit_code: number | null }>('terminal-closed', (p) => {
    if (p.session_id !== sessionId) return;
    flushBatch(state, 'session_closed');
    rdLog('ERROR', getPhase(), 'terminal.session.closed', {
      session_id: sessionId,
      exit_code: p.exit_code,
      note: 'setup shell exited; any in-flight step cannot complete and polling will time out',
      tail: state.tail.slice(-12).join(' ⏎ '),
    });
  });

  attach<{ session_id: string; error: string }>('terminal-error', (p) => {
    if (p.session_id !== sessionId) return;
    flushBatch(state, 'session_error');
    rdLog('ERROR', getPhase(), 'terminal.session.error', {
      session_id: sessionId,
      error: rdRedact(p.error),
    });
  });
}

/** Last lines the terminal printed, for attaching to a timeout or failure. */
export function rdTerminalTail(lines = 20): string {
  if (!active) return '<no terminal capture active>';
  const tail = active.tail.slice(-lines);
  return tail.length === 0 ? '<no output captured yet>' : tail.join(' ⏎ ');
}

/** Counters describing how much output the run produced. */
export function rdTerminalStats(): Record<string, unknown> {
  if (!active) return { capture: 'inactive' };
  return {
    session_id: active.sessionId,
    total_lines: active.totalLines,
    total_bytes: active.totalBytes,
    ordinary_logged: active.ordinaryLogged,
    notable_logged: active.notableLogged,
    suppressed: active.suppressed,
  };
}

/** Flush anything buffered — call before logging a decision that depends on it. */
export function flushRdTerminalCapture(reason = 'explicit'): void {
  if (!active) return;
  emitRepeat(active);
  flushBatch(active, reason);
}

export function stopRdTerminalCapture(reason: string): void {
  const state = active;
  if (!state) return;
  active = null;

  emitRepeat(state);
  if (state.pending.trim().length > 0) {
    handleLine(state, state.pending);
    state.pending = '';
  }
  flushBatch(state, 'capture_stop');

  state.disposed = true;
  if (state.timer) {
    clearTimeout(state.timer);
    state.timer = null;
  }
  for (const un of state.unlisteners) {
    try {
      un();
    } catch {
      /* ignore */
    }
  }
  state.unlisteners = [];

  rdLog('INFO', state.getPhase(), 'terminal.capture.stop', {
    session_id: state.sessionId,
    reason,
    total_lines: state.totalLines,
    total_bytes: state.totalBytes,
    ordinary_logged: state.ordinaryLogged,
    notable_logged: state.notableLogged,
    suppressed: state.suppressed,
  });
}

/** Exposed for unit testing the pure helpers. */
export const __rdTerminalInternals = {
  stripAnsi,
  lastFrame,
  classify,
  truncateLine,
  SENTINEL_RE,
  parseSentinel: (line: string): RdCommandCompletion | null => {
    const m = SENTINEL_RE.exec(line);
    return m
      ? { phase: m[1], seq: Number(m[2]), exitCode: Number(m[3]) }
      : null;
  },
  resetSentinelState: () => {
    sentinelSeq = 0;
    seenCompletions.clear();
    completionListeners.clear();
  },
};
