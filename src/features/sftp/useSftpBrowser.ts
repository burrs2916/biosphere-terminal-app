import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { open } from '@tauri-apps/plugin-dialog';
import type { SshConnectionInfo } from '../../proto/connection';
import {
  onSftpProgress,
  sftpCancel,
  sftpChmod,
  sftpDisconnect,
  sftpDownload,
  sftpList,
  sftpMkdir,
  sftpRemove,
  sftpRename,
  sftpUpload,
  type SftpEntry,
  type SftpProgressPayload,
  type SftpRemoteItem,
} from '../../core/services/sftp.service';
import { useNotify } from '../../core/notification';
import { localizeBackendError } from '../../core/backendError';
import { isActiveTransfer, type TransferItem } from './TransferQueue';
import type { ConfirmState } from './SftpDialogs';
import {
  basename,
  formatSize,
  isHiddenName,
  isNavigable,
  joinRemote,
  newTransferId,
  parentPath,
  permsToOctal,
  readPref,
  sortEntries,
  writePref,
  type SortDir,
  type SortKey,
} from './utils';

const DOWNLOAD_DIR_KEY = 'sftp.downloadDir';
const SHOW_HIDDEN_KEY = 'sftp.showHidden';
const SORT_KEY = 'sftp.sort';
/** Three or four octal digits — the only thing `chmod` accepts. */
const OCTAL_MODE = /^[0-7]{3,4}$/;

/**
 * True only when the local OpenSSH client is missing.
 *
 * Matching a bare /sftp/ would swallow every ordinary failure — the backend
 * prefixes those with "SFTP 操作失败" — and replace the file list with a
 * full-screen "please install OpenSSH" page.
 */
export function isSftpMissingError(e: unknown): boolean {
  const msg = typeof e === 'string' ? e : e instanceof Error ? e.message : JSON.stringify(e);
  return /无法定位 sftp 程序|SFTP client .{0,24}not found|OpenSSH\.Client/i.test(msg);
}

/** Names that would silently target the wrong node if we passed them through. */
function invalidName(name: string): boolean {
  return name.includes('/') || name.includes('\\') || name === '.' || name === '..';
}

/** Restore the saved column ordering, falling back to name ascending. */
function readSort(): { key: SortKey; dir: SortDir } {
  const raw = readPref(SORT_KEY);
  const [k, d] = (raw ?? '').split(':');
  const key: SortKey = k === 'size' || k === 'mtime' ? k : 'name';
  const dir: SortDir = d === 'desc' ? 'desc' : 'asc';
  return { key, dir };
}

export interface HistoryState {
  canBack: boolean;
  canForward: boolean;
}

/**
 * Everything needed to replay a transfer without asking the user anything
 * again. A failed upload otherwise costs the whole picker dance a second time,
 * and after a dropped connection that is the single most likely next action.
 */
type RetryPayload =
  | { kind: 'upload'; paths: string[]; dir: string; remoteNames?: string[] }
  | { kind: 'download'; items: SftpRemoteItem[]; dir: string };

/** A transfer that has a row on screen but has not been handed to the backend. */
interface QueuedTransfer {
  id: string;
  run: () => Promise<void>;
}

/** True for the backend's "you asked me to stop" answer, in either language. */
function isCancellation(msg: string): boolean {
  return /取消|cancel/i.test(msg);
}

/**
 * Everything stateful about browsing one remote host: listing, navigation
 * history, selection, transfers and the destructive-action queue. Keeping it
 * out of the view makes the render tree readable and the logic testable.
 */
/**
 * Find a remote file name that does not collide with anything already present
 * (or already claimed in this batch). Mirrors what every OS file manager does
 * on a name clash: `report.pdf` -> `report (1).pdf` -> `report (2).pdf`.
 * `taken` is mutated so successive calls in one batch stay unique.
 */
function uniqueRemoteName(base: string, taken: Set<string>): string {
  if (!taken.has(base)) {
    taken.add(base);
    return base;
  }
  const dot = base.lastIndexOf('.');
  const hasExt = dot > 0 && dot < base.length - 1;
  const stem = hasExt ? base.slice(0, dot) : base;
  const ext = hasExt ? base.slice(dot) : '';
  let n = 1;
  let candidate: string;
  do {
    candidate = `${stem} (${n})${ext}`;
    n += 1;
  } while (taken.has(candidate));
  taken.add(candidate);
  return candidate;
}

export function useSftpBrowser(ssh: SshConnectionInfo) {
  const { t } = useTranslation('fileTransfer');
  const notify = useNotify().notify;

  const [path, setPath] = useState('.');
  /** Absolute home directory, learned the first time `.` is resolved. */
  const [homePath, setHomePath] = useState<string | null>(null);
  const [entries, setEntries] = useState<SftpEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sftpMissing, setSftpMissing] = useState(false);
  const [busy, setBusy] = useState(false);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [focused, setFocused] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>(() => readSort().key);
  const [sortDir, setSortDir] = useState<SortDir>(() => readSort().dir);
  const [showHidden, setShowHidden] = useState(() => readPref(SHOW_HIDDEN_KEY) === '1');
  const [search, setSearch] = useState('');

  const [renaming, setRenaming] = useState<SftpEntry | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [confirm, setConfirm] = useState<ConfirmState>(null);
  const [chmodTargets, setChmodTargets] = useState<SftpEntry[] | null>(null);
  const [chmodValue, setChmodValue] = useState('644');
  const [batchRename, setBatchRename] = useState<SftpEntry[] | null>(null);

  const [transfers, setTransfers] = useState<TransferItem[]>([]);
  const [history, setHistory] = useState<HistoryState>({ canBack: false, canForward: false });

  const sshRef = useRef(ssh);
  sshRef.current = ssh;
  const pathRef = useRef(path);
  pathRef.current = path;
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  /** Anchor row for Shift range selection — must survive the click extending it. */
  const anchorRef = useRef<number>(-1);
  /** Replay data per transfer id, dropped as soon as the row is dismissed. */
  const retryRef = useRef<Map<string, RetryPayload>>(new Map());
  const histRef = useRef<{ stack: string[]; idx: number }>({ stack: [], idx: -1 });
  /** Transfers waiting for the single slot, in the order the user asked for them. */
  const queueRef = useRef<QueuedTransfer[]>([]);
  /** Id of the transfer currently talking to the backend, if any. */
  const activeRef = useRef<string | null>(null);
  /** Indirection so the pump can re-enter itself without a stale closure. */
  const pumpRef = useRef<() => void>(() => {});

  const syncHistory = useCallback(() => {
    const h = histRef.current;
    setHistory({ canBack: h.idx > 0, canForward: h.idx >= 0 && h.idx < h.stack.length - 1 });
  }, []);

  const pushHistory = useCallback(
    (resolved: string) => {
      const h = histRef.current;
      if (h.stack[h.idx] === resolved) return;
      h.stack = h.stack.slice(0, h.idx + 1);
      h.stack.push(resolved);
      h.idx = h.stack.length - 1;
      syncHistory();
    },
    [syncHistory],
  );

  /** Fetch a directory. `record` is false when replaying the history stack. */
  const load = useCallback(
    async (target: string, record = true) => {
      setLoading(true);
      setError(null);
      setSftpMissing(false);
      try {
        const res = await sftpList(sshRef.current, target);
        setEntries(res.entries);
        setPath(res.path);
        pathRef.current = res.path;
        // `.` is the only target the server expands into the login directory,
        // so this is the one chance to learn where "home" actually is.
        if (target === '.' && res.path.startsWith('/')) setHomePath(res.path);
        if (record) pushHistory(res.path);
        return true;
      } catch (e) {
        if (isSftpMissingError(e)) setSftpMissing(true);
        else setError(localizeBackendError(e));
        return false;
      } finally {
        setLoading(false);
      }
    },
    [pushHistory],
  );

  const resetViewState = useCallback(() => {
    setSelected(new Set());
    setFocused(null);
    setSearch('');
    anchorRef.current = -1;
  }, []);

  const navigate = useCallback(
    (target: string) => {
      resetViewState();
      void load(target, true);
    },
    [load, resetViewState],
  );

  const refresh = useCallback(() => {
    void load(pathRef.current, false);
  }, [load]);

  const goBack = useCallback(() => {
    const h = histRef.current;
    if (h.idx <= 0) return;
    h.idx -= 1;
    syncHistory();
    resetViewState();
    void load(h.stack[h.idx], false);
  }, [load, resetViewState, syncHistory]);

  const goForward = useCallback(() => {
    const h = histRef.current;
    if (h.idx >= h.stack.length - 1) return;
    h.idx += 1;
    syncHistory();
    resetViewState();
    void load(h.stack[h.idx], false);
  }, [load, resetViewState, syncHistory]);

  useEffect(() => {
    void load('.', true);
    return () => {
      // Drop anything still waiting: the window is going away, so firing those
      // transfers would move files with nowhere to report the outcome.
      queueRef.current = [];
      sftpDisconnect(sshRef.current).catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- derived view data ---------------------------------------------------

  const hiddenCount = useMemo(
    () => entries.filter((e) => isHiddenName(e.name)).length,
    [entries],
  );

  const displayed = useMemo(() => {
    let list = entries;
    if (!showHidden) list = list.filter((e) => !isHiddenName(e.name));
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((e) => e.name.toLowerCase().includes(q));
    return sortEntries(list, sortKey, sortDir);
  }, [entries, showHidden, search, sortKey, sortDir]);

  const selectedEntries = useMemo(
    () => entries.filter((e) => selected.has(e.name)),
    [entries, selected],
  );

  const selectedSizeLabel = useMemo(() => {
    const bytes = selectedEntries.reduce((sum, e) => sum + (e.is_dir ? 0 : e.size), 0);
    return bytes > 0 ? formatSize(bytes) : '';
  }, [selectedEntries]);

  // ---- transfers -----------------------------------------------------------

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    onSftpProgress((p: SftpProgressPayload) => {
      setTransfers((prev) =>
        prev.map((x) => {
          if (x.id !== p.transferId) return x;
          // A new file name on the wire means the previous one finished, which
          // is the only "n of m" signal OpenSSH gives us.
          const advanced = x.currentFile !== undefined && x.currentFile !== p.file;
          return {
            ...x,
            percent: p.percent,
            currentFile: p.file,
            fileNo: advanced ? (x.fileNo ?? 1) + 1 : (x.fileNo ?? 1),
            rate: p.rate,
            eta: p.eta,
          };
        }),
      );
    })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => {});
    return () => {
      unlisten?.();
    };
  }, []);

  /**
   * Add the row, or reset it in place when this is a retry — replacing the
   * whole object is what clears the stale error, rate and per-file counter.
   */
  const openTransferRow = useCallback((row: TransferItem) => {
    setTransfers((prev) =>
      prev.some((x) => x.id === row.id)
        ? prev.map((x) => (x.id === row.id ? row : x))
        : [...prev, row],
    );
  }, []);

  /**
   * Renumber the waiting rows from the queue itself, so the position a user
   * reads is never a stale copy of where the transfer used to be.
   */
  const syncQueuePositions = useCallback(() => {
    const order = new Map(queueRef.current.map((q, i) => [q.id, i + 1]));
    setTransfers((prev) =>
      prev.map((x) => {
        const pos = order.get(x.id);
        if (pos === undefined) return x;
        return x.queuePos === pos ? x : { ...x, queuePos: pos };
      }),
    );
  }, []);

  /**
   * Start the next transfer when the slot is free.
   *
   * One at a time is not a throttle we chose — the backend serialises the
   * transfer lane behind a mutex. Mirroring that here is what lets a waiting
   * row say "queued, 2nd" instead of sitting at "running · 0%" with no rate
   * and no ETA, which is indistinguishable from a hang.
   */
  const pump = useCallback(() => {
    if (activeRef.current) return;
    const next = queueRef.current.shift();
    if (!next) return;
    activeRef.current = next.id;
    syncQueuePositions();
    void next.run().finally(() => {
      activeRef.current = null;
      pumpRef.current();
    });
  }, [syncQueuePositions]);
  pumpRef.current = pump;

  const enqueueTransfer = useCallback(
    (id: string, run: () => Promise<void>) => {
      queueRef.current.push({ id, run });
      syncQueuePositions();
      pumpRef.current();
    },
    [syncQueuePositions],
  );

  /** Take a transfer out of the waiting line. Returns false if it already ran. */
  const dequeueTransfer = useCallback(
    (id: string): boolean => {
      const idx = queueRef.current.findIndex((q) => q.id === id);
      if (idx < 0) return false;
      queueRef.current.splice(idx, 1);
      syncQueuePositions();
      return true;
    },
    [syncQueuePositions],
  );

  /** Move a finished transfer's row into its terminal state. */
  const settleTransfer = useCallback((id: string, e: unknown): string => {
    const msg = localizeBackendError(e);
    const cancelled = isCancellation(msg);
    setTransfers((prev) =>
      prev.map((x) =>
        x.id === id
          ? {
              ...x,
              status: cancelled ? 'cancelled' : 'error',
              queuePos: undefined,
              error: cancelled ? undefined : msg,
            }
          : x,
      ),
    );
    return cancelled ? '' : msg;
  }, []);

  const runUpload = useCallback(
    (
      paths: string[],
      dir: string,
      reuseId?: string,
      remoteNames?: string[],
      resume = false,
    ) => {
      const count = paths.length;
      const id = reuseId ?? newTransferId();
      retryRef.current.set(id, { kind: 'upload', paths, dir, remoteNames });
      openTransferRow({
        id,
        kind: 'upload',
        label: count === 1 ? basename(paths[0]) : t('upload_count', { count }),
        count,
        status: 'queued',
        percent: 0,
        startedAt: Date.now(),
        retryable: true,
        resuming: resume,
      });
      enqueueTransfer(id, async () => {
        // `startedAt` is reset here rather than at queue time so the elapsed
        // time reflects the transfer, not the wait.
        setTransfers((prev) =>
          prev.map((x) =>
            x.id === id
              ? { ...x, status: 'running', queuePos: undefined, startedAt: Date.now() }
              : x,
          ),
        );
        try {
          await sftpUpload(sshRef.current, paths, dir, id, remoteNames, resume);
          setTransfers((prev) =>
            prev.map((x) =>
              x.id === id ? { ...x, status: 'done', percent: 100, queuePos: undefined } : x,
            ),
          );
          notify(
            count === 1
              ? t('uploaded', { name: basename(paths[0]) })
              : t('uploaded_count', { count }),
          );
          // Refresh whatever the user is looking at: either the destination
          // itself, or the parent whose folder row just grew.
          await load(pathRef.current, false);
        } catch (e) {
          // A cancel the user asked for is not news; the row already says so.
          const msg = settleTransfer(id, e);
          if (msg) notify(msg, 'error');
        }
      });
    },
    [t, notify, load, openTransferRow, enqueueTransfer, settleTransfer],
  );

  /**
   * Warn about same-name collisions before anything is overwritten.
   *
   * `targetDir` is set when files are dropped straight onto a folder row; that
   * directory is not on screen, so its contents are fetched to keep the
   * overwrite warning as trustworthy as it is for the current directory.
   */
  const startUpload = useCallback(
    async (paths: string[], targetDir?: string) => {
      if (paths.length === 0) return;
      const dir = targetDir ?? pathRef.current;
      let existing: { name: string; isDir: boolean }[];
      // `isNavigable`, because that is what the collision will actually behave
      // like: uploading a folder onto a symlinked folder merges into its
      // target, so the dialog has to say "merge", not "replace this file".
      if (dir === pathRef.current) {
        existing = entriesRef.current.map((e) => ({ name: e.name, isDir: isNavigable(e) }));
      } else {
        try {
          const res = await sftpList(sshRef.current, dir);
          existing = res.entries.map((e) => ({ name: e.name, isDir: isNavigable(e) }));
        } catch {
          // Unreadable target: let the transfer itself report the real reason
          // instead of blocking on a collision check we cannot perform.
          existing = [];
        }
      }
      const dirNames = new Set(existing.filter((e) => e.isDir).map((e) => e.name));
      const names = new Set(existing.map((e) => e.name));
      const conflicts = paths
        .map(basename)
        .filter((n) => names.has(n))
        .map((name) => ({ name, isDir: dirNames.has(name) }));
      if (conflicts.length > 0) {
        // Pre-compute the "keep both" target names so the dialog's third
        // button can act without re-listing the directory. `taken` starts with
        // everything already in the destination and grows as we assign, so two
        // selected files that share a basename also get disambiguated.
        const taken = new Set(existing.map((e) => e.name));
        const keepBothNames = paths.map((p) => uniqueRemoteName(basename(p), taken));
        setConfirm({ kind: 'overwrite', paths, conflicts, dir, keepBothNames });
        return;
      }
      runUpload(paths, dir);
    },
    [runUpload],
  );

  /** `targetDir` lets the tree upload into a folder the table is not showing. */
  const pickAndUpload = useCallback(
    async (mode: 'files' | 'folder', targetDir?: string) => {
      try {
        const picked = await open(
          mode === 'folder'
            ? { directory: true, multiple: true, title: t('upload_folder') }
            : { multiple: true, title: t('upload_files') },
        );
        if (!picked) return;
        const paths = (Array.isArray(picked) ? picked : [picked]).filter(
          (f): f is string => typeof f === 'string',
        );
        await startUpload(paths, targetDir);
      } catch (e) {
        notify(localizeBackendError(e), 'error');
      }
    },
    [t, notify, startUpload],
  );

  /**
   * Upload every selected item, renaming on a name clash so nothing is
   * overwritten and nothing is silently dropped. The disambiguated names were
   * computed up front in `startUpload`.
   */
  const confirmKeepBoth = useCallback(() => {
    if (confirm?.kind !== 'overwrite') return;
    const { paths, dir, keepBothNames } = confirm;
    setConfirm(null);
    void runUpload(paths, dir, undefined, keepBothNames);
  }, [confirm, runUpload]);

  const pickDownloadDir = useCallback(async (): Promise<string | null> => {
    const previous = readPref(DOWNLOAD_DIR_KEY);
    const dir = await open({
      directory: true,
      title: t('choose_local_dir'),
      defaultPath: previous ?? undefined,
    });
    if (!dir || typeof dir !== 'string') return null;
    writePref(DOWNLOAD_DIR_KEY, dir);
    return dir;
  }, [t]);

  const runDownload = useCallback(
    (items: SftpRemoteItem[], dir: string, reuseId?: string, resume = false) => {
      const count = items.length;
      const id = reuseId ?? newTransferId();
      retryRef.current.set(id, { kind: 'download', items, dir });
      openTransferRow({
        id,
        kind: 'download',
        label: count === 1 ? basename(items[0].path) : t('download_count', { count }),
        count,
        status: 'queued',
        percent: 0,
        startedAt: Date.now(),
        retryable: true,
        resuming: resume,
      });
      enqueueTransfer(id, async () => {
        setTransfers((prev) =>
          prev.map((x) =>
            x.id === id
              ? { ...x, status: 'running', queuePos: undefined, startedAt: Date.now() }
              : x,
          ),
        );
        try {
          await sftpDownload(sshRef.current, items, dir, id, resume);
          setTransfers((prev) =>
            prev.map((x) =>
              x.id === id ? { ...x, status: 'done', percent: 100, queuePos: undefined } : x,
            ),
          );
          notify(t('downloaded_to', { count, dir }));
        } catch (e) {
          const msg = settleTransfer(id, e);
          if (msg) notify(msg, 'error');
        }
      });
    },
    [t, notify, openTransferRow, enqueueTransfer, settleTransfer],
  );

  /**
   * Directories are downloaded recursively — the backend already passes `-r`
   * to sftp, so refusing folders here was pure UI friction.
   */
  const downloadEntries = useCallback(
    async (list: SftpEntry[], ask = false) => {
      if (list.length === 0) {
        notify(t('no_selection'));
        return;
      }
      // Resolve the folder *before* the queue row is created so a cancelled
      // picker never leaves a ghost entry behind.
      const dir = (!ask && readPref(DOWNLOAD_DIR_KEY)) || (await pickDownloadDir());
      if (!dir) return;

      const base = pathRef.current;
      const items: SftpRemoteItem[] = list.map((e) => ({
        // Symlinked folders download recursively, like the target they stand
        // for — `get` without `-r` would just fail with "not a regular file".
        path: joinRemote(base, e.name),
        isDir: isNavigable(e),
      }));
      runDownload(items, dir);
    },
    [t, notify, pickDownloadDir, runDownload],
  );

  /**
   * Download an arbitrary remote directory — e.g. a node in the side tree — the
   * same way a table row would: recursively, with a destination picker. The
   * path is absolute (not relative to the browsed table dir), so it is built
   * straight from the argument.
   */
  const downloadRemoteDir = useCallback(
    async (remotePath: string) => {
      const dir = await pickDownloadDir();
      if (!dir) return;
      runDownload([{ path: remotePath, isDir: true }], dir);
    },
    [pickDownloadDir, runDownload],
  );

  /**
   * Replay a finished transfer exactly as it was queued. The remote paths are
   * absolute and the local folder is remembered, so this stays correct even
   * after the user has browsed somewhere else in the meantime.
   *
   * `resume` picks up where the interrupted attempt stopped instead of sending
   * everything again — the difference between minutes and hours once a
   * multi-gigabyte transfer drops at 90%.
   */
  const retryTransfer = useCallback(
    (id: string, resume = false) => {
      const payload = retryRef.current.get(id);
      if (!payload) return;
      if (payload.kind === 'upload') {
        // Deliberately bypasses the overwrite prompt: a retry after a partial
        // upload would collide with its own leftovers every single time. The
        // same remote names (if any) are replayed so "keep both" stays correct.
        runUpload(payload.paths, payload.dir, id, payload.remoteNames, resume);
      } else {
        runDownload(payload.items, payload.dir, id, resume);
      }
    },
    [runUpload, runDownload],
  );

  const markCancelled = useCallback((id: string) => {
    setTransfers((prev) =>
      prev.map((x) =>
        x.id === id && isActiveTransfer(x)
          ? { ...x, status: 'cancelled', queuePos: undefined }
          : x,
      ),
    );
  }, []);

  const cancelTransfer = useCallback(
    async (id: string) => {
      // Still waiting its turn: dropping it from the line is instant and the
      // backend never has to hear about a transfer it was never given.
      if (dequeueTransfer(id)) {
        retryRef.current.delete(id);
        markCancelled(id);
        return;
      }
      const ok = await sftpCancel(id).catch(() => false);
      if (ok) markCancelled(id);
      // A `false` here means the transfer finished between the click and the
      // call; the row is about to settle on its own, so stay quiet.
    },
    [dequeueTransfer, markCancelled],
  );

  const dismissTransfer = useCallback(
    (id: string) => {
      // Closing a waiting row has to cancel it too — otherwise the transfer
      // would still fire with no row left to report it.
      dequeueTransfer(id);
      retryRef.current.delete(id);
      setTransfers((prev) => prev.filter((x) => x.id !== id));
    },
    [dequeueTransfer],
  );

  const clearFinishedTransfers = useCallback(() => {
    setTransfers((prev) => {
      // Drop the replay payloads along with the rows, otherwise a long session
      // keeps every path list it has ever transferred alive. Queued rows stay:
      // they are still going to run.
      for (const x of prev) if (!isActiveTransfer(x)) retryRef.current.delete(x.id);
      return prev.filter(isActiveTransfer);
    });
  }, []);

  // ---- mutations -----------------------------------------------------------

  const deleteEntries = useCallback(
    async (names: string[]) => {
      if (names.length === 0) return;
      const base = pathRef.current;
      const items: SftpRemoteItem[] = names.map((n) => {
        const e = entriesRef.current.find((x) => x.name === n);
        // `is_dir`, never `isNavigable`: deleting a symlinked folder must
        // unlink the link, not walk through it and empty the real directory.
        return { path: joinRemote(base, n), isDir: e?.is_dir ?? false };
      });
      try {
        setBusy(true);
        await sftpRemove(sshRef.current, items);
        notify(names.length === 1 ? t('deleted', { name: names[0] }) : t('deleted_count', { count: names.length }));
        setSelected(new Set());
        setFocused(null);
        await load(base, false);
      } catch (e) {
        notify(localizeBackendError(e), 'error');
      } finally {
        setBusy(false);
      }
    },
    [t, notify, load],
  );

  const submitRename = useCallback(async () => {
    const next = renameValue.trim();
    if (!renaming || !next) return;
    if (next === renaming.name) {
      setRenaming(null);
      return;
    }
    if (invalidName(next)) {
      notify(t('invalid_name'), 'error');
      return;
    }
    if (entriesRef.current.some((e) => e.name === next)) {
      notify(t('name_taken', { name: next }), 'error');
      return;
    }
    const base = pathRef.current;
    try {
      setBusy(true);
      await sftpRename(sshRef.current, joinRemote(base, renaming.name), joinRemote(base, next));
      notify(t('renamed'));
      setRenaming(null);
      setRenameValue('');
      setSelected(new Set([next]));
      setFocused(next);
      await load(base, false);
    } catch (e) {
      notify(localizeBackendError(e), 'error');
    } finally {
      setBusy(false);
    }
  }, [renaming, renameValue, t, notify, load]);

  const submitNewFolder = useCallback(async () => {
    const name = newFolderName.trim();
    if (!name) return;
    if (invalidName(name)) {
      notify(t('invalid_name'), 'error');
      return;
    }
    if (entriesRef.current.some((e) => e.name === name)) {
      notify(t('name_taken', { name }), 'error');
      return;
    }
    const base = pathRef.current;
    try {
      setBusy(true);
      await sftpMkdir(sshRef.current, joinRemote(base, name));
      notify(t('folder_created'));
      setNewFolderOpen(false);
      setNewFolderName('');
      setSelected(new Set([name]));
      setFocused(name);
      await load(base, false);
    } catch (e) {
      notify(localizeBackendError(e), 'error');
    } finally {
      setBusy(false);
    }
  }, [newFolderName, t, notify, load]);

  const startChmod = useCallback((list: SftpEntry[]) => {
    if (list.length === 0) return;
    // Seed with the first target's current bits so a single-file edit starts
    // from the truth instead of a guess.
    setChmodValue(permsToOctal(list[0].perms) || (list[0].is_dir ? '755' : '644'));
    setChmodTargets(list);
  }, []);

  /**
   * Apply POSIX permission bits. Windows remotes answer with a plain refusal,
   * which is surfaced as-is rather than dressed up as success.
   */
  const submitChmod = useCallback(async () => {
    if (!chmodTargets || chmodTargets.length === 0) return;
    const mode = chmodValue.trim();
    if (!OCTAL_MODE.test(mode)) {
      notify(t('invalid_mode'), 'error');
      return;
    }
    const base = pathRef.current;
    const targets = chmodTargets.map((e) => joinRemote(base, e.name));
    try {
      setBusy(true);
      await sftpChmod(sshRef.current, targets, mode);
      notify(
        targets.length === 1
          ? t('perms_changed', { name: chmodTargets[0].name, mode })
          : t('perms_changed_count', { count: targets.length, mode }),
      );
      setChmodTargets(null);
      await load(base, false);
    } catch (e) {
      notify(localizeBackendError(e), 'error');
    } finally {
      setBusy(false);
    }
  }, [chmodTargets, chmodValue, t, notify, load]);

  /**
   * Open the batch-rename dialog over a selection. Entries are sorted by name
   * so the `{n}` sequence placeholder is deterministic no matter how the user
   * assembled the selection.
   */
  const startBatchRename = useCallback((list: SftpEntry[]) => {
    if (list.length < 1) return;
    setBatchRename(
      [...list].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })),
    );
  }, []);

  const submitBatchRename = useCallback(
    async (newNames: string[]) => {
      const targets = batchRename;
      if (!targets || targets.length === 0 || newNames.length !== targets.length) {
        setBatchRename(null);
        return;
      }
      const base = pathRef.current;
      let done = 0;
      try {
        setBusy(true);
        for (let i = 0; i < targets.length; i++) {
          const oldName = targets[i].name;
          const newName = (newNames[i] ?? '').trim();
          if (!newName || newName === oldName) continue;
          if (invalidName(newName)) {
            notify(t('batch_rename_invalid', { name: newName }), 'error');
            break;
          }
          await sftpRename(sshRef.current, joinRemote(base, oldName), joinRemote(base, newName));
          done++;
        }
        if (done > 0) notify(t('renamed_count', { count: done }));
      } catch (e) {
        notify(localizeBackendError(e), 'error');
      } finally {
        setBusy(false);
        setBatchRename(null);
        setSelected(new Set());
        setFocused(null);
        await load(base, false);
      }
    },
    [batchRename, t, notify, load],
  );

  /**
   * Open whatever the row points at.
   *
   * Symlinked folders are resolved by the listing probe, so they navigate
   * straight away. The listing-based fallback below still matters: when the
   * probe could not run (an sftp client too old for `ls -1`, a directory the
   * glob cannot read) a symlink arrives unresolved, and trying the listing is
   * the difference between "walks in" and "dead end".
   */
  const openEntry = useCallback(
    async (entry: SftpEntry) => {
      const target = joinRemote(pathRef.current, entry.name);
      if (isNavigable(entry)) {
        navigate(target);
        return;
      }
      if (entry.is_symlink) {
        setLoading(true);
        try {
          const res = await sftpList(sshRef.current, target);
          resetViewState();
          setEntries(res.entries);
          setPath(res.path);
          pathRef.current = res.path;
          pushHistory(res.path);
          return;
        } catch {
          notify(t('link_not_dir'));
        } finally {
          setLoading(false);
        }
      }
      void downloadEntries([entry]);
    },
    [navigate, resetViewState, pushHistory, downloadEntries, notify, t],
  );

  // ---- selection -----------------------------------------------------------

  const handleRowClick = useCallback(
    (entry: SftpEntry, index: number, e: MouseEvent) => {
      setFocused(entry.name);
      if (e.shiftKey && anchorRef.current >= 0) {
        const a = Math.min(anchorRef.current, index);
        const b = Math.max(anchorRef.current, index);
        setSelected(new Set(displayed.slice(a, b + 1).map((x) => x.name)));
        return;
      }
      anchorRef.current = index;
      if (e.metaKey || e.ctrlKey) {
        setSelected((prev) => {
          const next = new Set(prev);
          if (next.has(entry.name)) next.delete(entry.name);
          else next.add(entry.name);
          return next;
        });
      } else {
        setSelected(new Set([entry.name]));
      }
    },
    [displayed],
  );

  const selectAll = useCallback(() => {
    setSelected(new Set(displayed.map((x) => x.name)));
  }, [displayed]);

  const clearSelection = useCallback(() => {
    setSelected(new Set());
    setFocused(null);
    anchorRef.current = -1;
  }, []);

  const moveFocus = useCallback(
    (delta: number | 'first' | 'last') => {
      if (displayed.length === 0) return;
      const idx = displayed.findIndex((x) => x.name === focused);
      let next: number;
      if (delta === 'first') next = 0;
      else if (delta === 'last') next = displayed.length - 1;
      else if (idx < 0) next = delta > 0 ? 0 : displayed.length - 1;
      else next = Math.min(displayed.length - 1, Math.max(0, idx + delta));
      const entry = displayed[next];
      setFocused(entry.name);
      setSelected(new Set([entry.name]));
      anchorRef.current = next;
    },
    [displayed, focused],
  );

  const toggleHidden = useCallback(() => {
    setShowHidden((v) => {
      writePref(SHOW_HIDDEN_KEY, v ? '0' : '1');
      return !v;
    });
  }, []);

  const handleSort = useCallback(
    (k: SortKey) => {
      const dir: SortDir = k === sortKey ? (sortDir === 'asc' ? 'desc' : 'asc') : 'asc';
      setSortKey(k);
      setSortDir(dir);
      writePref(SORT_KEY, `${k}:${dir}`);
      anchorRef.current = -1;
    },
    [sortKey, sortDir],
  );

  const startRename = useCallback((entry: SftpEntry) => {
    setRenaming(entry);
    setRenameValue(entry.name);
  }, []);

  const requestDelete = useCallback((names: string[]) => {
    if (names.length === 0) return;
    setConfirm({ kind: 'delete', names });
  }, []);

  const parent = useMemo(() => parentPath(path), [path]);

  return {
    // data
    path,
    homePath,
    parent,
    entries,
    displayed,
    hiddenCount,
    selected,
    selectedEntries,
    selectedSizeLabel,
    focused,
    sortKey,
    sortDir,
    showHidden,
    search,
    loading,
    busy,
    error,
    sftpMissing,
    transfers,
    history,
    // dialogs
    renaming,
    renameValue,
    newFolderOpen,
    newFolderName,
    confirm,
    chmodTargets,
    chmodValue,
    batchRename,
    // setters used by the view
    setSearch,
    setRenameValue,
    setNewFolderName,
    setNewFolderOpen,
    setRenaming,
    setConfirm,
    setChmodTargets,
    setChmodValue,
    setBatchRename,
    // actions
    navigate,
    refresh,
    goBack,
    goForward,
    openEntry,
    startUpload,
    pickAndUpload,
    runUpload,
    confirmKeepBoth,
    downloadEntries,
    downloadRemoteDir,
    retryTransfer,
    deleteEntries,
    requestDelete,
    startRename,
    submitRename,
    submitNewFolder,
    startChmod,
    submitChmod,
    startBatchRename,
    submitBatchRename,
    handleRowClick,
    handleSort,
    selectAll,
    clearSelection,
    moveFocus,
    toggleHidden,
    cancelTransfer,
    dismissTransfer,
    clearFinishedTransfers,
  };
}
