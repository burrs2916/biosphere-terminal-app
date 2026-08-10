import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import LinearProgress from '@mui/material/LinearProgress';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import {
  ArrowClockwiseIcon,
  CopyIcon,
  DownloadIcon,
  EyeIcon,
  FileIcon,
  FolderIcon,
  FolderOpenIcon,
  FolderPlusIcon,
  LockKeyIcon,
  MagnifyingGlassIcon,
  PencilSimpleIcon,
  SelectionAllIcon,
  TrashIcon,
  UploadIcon,
  WarningIcon,
} from '@phosphor-icons/react';
import { sftpList, sftpListMany, type SftpEntry } from '../../core/services/sftp.service';
import type { SshConnectionInfo } from '../../proto/connection';
import { useNotify } from '../../core/notification';
import { copyText } from '../../core/services/clipboard.service';
import { DirectoryTree } from './DirectoryTree';
import { FileTable } from './FileTable';
import { PathBar } from './PathBar';
import { SftpDialogs } from './SftpDialogs';
import { SftpToolbar } from './SftpToolbar';
import { StatusBar } from './StatusBar';
import { TransferQueue } from './TransferQueue';
import { useSftpBrowser } from './useSftpBrowser';
import { basename, isNavigable, joinRemote, readPref, writePref } from './utils';

const TREE_OPEN_KEY = 'sftp.treeOpen';
const TREE_WIDTH_KEY = 'sftp.treeWidth';
const TREE_MIN = 150;
const TREE_MAX = 460;

/** Where a dragged batch would land, and the table row to highlight (if any). */
interface DropTarget {
  path: string;
  rowName: string | null;
}

interface SftpManagerProps {
  ssh: SshConnectionInfo;
}

export function SftpManager({ ssh }: SftpManagerProps) {
  const { t } = useTranslation('fileTransfer');
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const notify = useNotify().notify;
  const compact = useMediaQuery('(max-width:720px)');
  const wide = useMediaQuery('(min-width:940px)');

  const s = useSftpBrowser(ssh);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const [dragOver, setDragOver] = useState(false);
  /** Folder currently under the cursor during a drag, if any. */
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [treeOpen, setTreeOpen] = useState(() => readPref(TREE_OPEN_KEY) !== '0');
  const [treeWidth, setTreeWidth] = useState(() => {
    const raw = Number(readPref(TREE_WIDTH_KEY));
    return Number.isFinite(raw) && raw >= TREE_MIN ? Math.min(raw, TREE_MAX) : 226;
  });
  const [resizing, setResizing] = useState(false);
  const [rowMenu, setRowMenu] = useState<{ entry: SftpEntry; x: number; y: number } | null>(null);
  const [bgMenu, setBgMenu] = useState<{ x: number; y: number } | null>(null);
  const [editingPath, setEditingPath] = useState(false);
  const [pathDraft, setPathDraft] = useState('');
  const [transferCollapsed, setTransferCollapsed] = useState(false);

  const modalOpen =
    !!s.renaming ||
    s.newFolderOpen ||
    !!s.confirm ||
    !!s.chmodTargets ||
    !!s.batchRename ||
    !!rowMenu ||
    !!bgMenu ||
    editingPath;

  useEffect(() => {
    containerRef.current?.focus();
  }, []);

  // ---- drag & drop upload --------------------------------------------------

  /**
   * The OS hands us physical screen pixels, so scale them into CSS pixels
   * before hit-testing. Dropping onto a folder — a table row *or* a tree
   * node — uploads straight into it, which is what every desktop file manager
   * does and saves a round trip through the directory.
   */
  const dropTargetAtPoint = useCallback(
    (pos?: { x: number; y: number }): DropTarget | null => {
      if (!pos) return null;
      const ratio = window.devicePixelRatio || 1;
      const el = document.elementFromPoint(pos.x / ratio, pos.y / ratio) as HTMLElement | null;
      if (!el) return null;
      const treeRow = el.closest?.('[data-tree-path]') as HTMLElement | null;
      if (treeRow?.dataset.treePath) return { path: treeRow.dataset.treePath, rowName: null };
      const row = el.closest?.('[data-entry-name]') as HTMLElement | null;
      if (row && row.dataset.isDir === '1' && row.dataset.entryName) {
        return { path: joinRemote(s.path, row.dataset.entryName), rowName: row.dataset.entryName };
      }
      return null;
    },
    [s.path],
  );

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    getCurrentWebviewWindow()
      .onDragDropEvent((event) => {
        const payload = event.payload;
        if (payload.type === 'enter' || payload.type === 'over') {
          setDragOver(true);
          setDropTarget(dropTargetAtPoint(payload.position));
        } else if (payload.type === 'leave') {
          setDragOver(false);
          setDropTarget(null);
        } else if (payload.type === 'drop') {
          const hit = dropTargetAtPoint(payload.position);
          setDragOver(false);
          setDropTarget(null);
          const paths = (payload.paths || []).filter((p) => typeof p === 'string');
          if (paths.length > 0) {
            void s.startUpload(paths as string[], hit?.path);
          }
        }
      })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => {});
    return () => {
      unlisten?.();
    };
  }, [s.startUpload, dropTargetAtPoint]);

  // ---- keyboard ------------------------------------------------------------
  const beginEditPath = useCallback(() => {
    setPathDraft(s.path === '.' ? '' : s.path);
    setEditingPath(true);
  }, [s.path]);

  const commitEditPath = useCallback(() => {
    const target = pathDraft.trim();
    setEditingPath(false);
    if (!target || target === s.path) return;
    s.navigate(target);
  }, [pathDraft, s]);

  const copyPath = useCallback(
    async (p: string) => {
      try {
        await copyText(p);
        notify(t('path_copied'));
      } catch {
        notify(t('copy_failed'), 'error');
      }
    },
    [notify, t],
  );

  const copyEntryPath = useCallback(
    (entry: SftpEntry) => copyPath(joinRemote(s.path, entry.name)),
    [copyPath, s.path],
  );

  /** The tree fetches its own nodes; the browsed directory is passed to it. */
  const listDir = useCallback(async (p: string) => (await sftpList(ssh, p)).entries, [ssh]);

  /** Batched lister feeding the tree's expand cascade. */
  const listManyDir = useCallback(
    async (paths: string[]) => sftpListMany(ssh, paths),
    [ssh],
  );

  const toggleTree = useCallback(() => {
    setTreeOpen((v) => {
      writePref(TREE_OPEN_KEY, v ? '0' : '1');
      return !v;
    });
  }, []);

  const startResize = useCallback(
    (e: ReactPointerEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startW = treeWidth;
      setResizing(true);
      const move = (ev: PointerEvent) => {
        setTreeWidth(Math.min(TREE_MAX, Math.max(TREE_MIN, startW + ev.clientX - startX)));
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        setResizing(false);
        // Persist from the setter so the value written is the one on screen.
        setTreeWidth((w) => {
          writePref(TREE_WIDTH_KEY, String(w));
          return w;
        });
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    },
    [treeWidth],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || modalOpen) return;
      const mod = e.metaKey || e.ctrlKey;

      if (mod && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        beginEditPath();
        return;
      }
      if (mod && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        s.selectAll();
        return;
      }
      if (mod && e.key.toLowerCase() === 'h') {
        e.preventDefault();
        s.toggleHidden();
        return;
      }
      if (mod && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        toggleTree();
        return;
      }
      if ((mod && e.key.toLowerCase() === 'r') || e.key === 'F5') {
        e.preventDefault();
        s.refresh();
        return;
      }
      if (e.altKey && e.key === 'ArrowLeft') {
        e.preventDefault();
        s.goBack();
        return;
      }
      if (e.altKey && e.key === 'ArrowRight') {
        e.preventDefault();
        s.goForward();
        return;
      }

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          s.moveFocus(1);
          break;
        case 'ArrowUp':
          e.preventDefault();
          s.moveFocus(-1);
          break;
        case 'Home':
          e.preventDefault();
          s.moveFocus('first');
          break;
        case 'End':
          e.preventDefault();
          s.moveFocus('last');
          break;
        case 'Enter': {
          const f = s.displayed.find((x) => x.name === s.focused);
          if (f) void s.openEntry(f);
          break;
        }
        case 'Delete':
          s.requestDelete(Array.from(s.selected));
          break;
        case 'Backspace':
          if (s.parent) s.navigate(s.parent);
          break;
        case 'F2': {
          const f = s.entries.find((x) => x.name === s.focused);
          if (f) s.startRename(f);
          break;
        }
        case 'Escape':
          s.clearSelection();
          break;
        default:
          break;
      }
    },
    [s, modalOpen, beginEditPath, toggleTree],
  );

  const handleRowContextMenu = useCallback(
    (entry: SftpEntry, e: MouseEvent) => {
      e.preventDefault();
      if (!s.selected.has(entry.name)) {
        s.handleRowClick(entry, s.displayed.findIndex((x) => x.name === entry.name), {
          shiftKey: false,
          metaKey: false,
          ctrlKey: false,
        } as MouseEvent);
      }
      setRowMenu({ entry, x: e.clientX, y: e.clientY });
    },
    [s],
  );

  const subtle = isDark ? '#8B949E' : '#6B7280';
  const textColor = isDark ? '#C9D1D9' : '#24292F';
  const border = isDark ? 'rgba(240,246,252,0.12)' : 'rgba(27,31,36,0.12)';
  const target = `${ssh.username}@${ssh.host}:${ssh.port}`;

  if (s.sftpMissing) {
    return (
      <Box sx={{ p: 4 }}>
        <Paper sx={{ p: 3, bgcolor: isDark ? '#2d2424' : '#fff4f4', border: '1px solid', borderColor: 'divider' }}>
          <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start' }}>
            <WarningIcon size={28} color="#ff9800" weight="fill" />
            <Box>
              <Typography variant="h6" sx={{ color: textColor }}>
                {t('sftp_not_found_title')}
              </Typography>
              <Typography variant="body2" sx={{ color: subtle, whiteSpace: 'pre-line', mt: 1 }}>
                {t('sftp_not_found_desc')}
              </Typography>
            </Box>
          </Box>
        </Paper>
      </Box>
    );
  }

  const showSkeleton = s.loading && s.entries.length === 0;
  const filteredOut = s.displayed.length === 0 && s.entries.length > 0;

  return (
    <Box
      ref={containerRef}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      sx={{
        outline: 'none',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        bgcolor: isDark ? '#0d1117' : '#f6f8fa',
        // While the splitter is held, the whole surface adopts the resize
        // cursor so the pointer never "escapes" the 5px handle.
        ...(resizing ? { cursor: 'col-resize', userSelect: 'none' } : null),
      }}
    >
      <SftpToolbar
        isDark={isDark}
        busy={s.busy}
        loading={s.loading}
        canBack={s.history.canBack}
        canForward={s.history.canForward}
        canUp={!!s.parent}
        selectedCount={s.selected.size}
        canRename={s.selected.size === 1}
        showHidden={s.showHidden}
        search={s.search}
        compact={compact}
        treeOpen={treeOpen}
        onToggleTree={toggleTree}
        labels={{
          showTree: t('show_tree'),
          hideTree: t('hide_tree'),
          back: t('back'),
          forward: t('forward'),
          parent: t('parent'),
          home: t('home'),
          refresh: t('refresh'),
          upload: t('upload'),
          uploadFiles: t('upload_files'),
          uploadFolder: t('upload_folder'),
          download: t('download'),
          downloadTo: t('download_to'),
          newFolder: t('new_folder'),
          rename: t('rename'),
          delete: t('delete'),
          showHidden: t('show_hidden'),
          hideHidden: t('hide_hidden'),
          searchPlaceholder: t('search_placeholder'),
          clearSearch: t('clear_search'),
        }}
        onBack={s.goBack}
        onForward={s.goForward}
        onUp={() => s.parent && s.navigate(s.parent)}
        onHome={() => s.navigate('.')}
        onRefresh={s.refresh}
        onUpload={(mode) => void s.pickAndUpload(mode)}
        onDownload={(ask) => void s.downloadEntries(s.selectedEntries, ask)}
        onNewFolder={() => s.setNewFolderOpen(true)}
        onRename={() => {
          const f = s.entries.find((x) => s.selected.has(x.name));
          if (f) s.startRename(f);
        }}
        onDelete={() => s.requestDelete(Array.from(s.selected))}
        onToggleHidden={s.toggleHidden}
        onSearchChange={s.setSearch}
      />

      <Box sx={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {treeOpen && (
          <>
            <Box
              sx={{
                width: treeWidth,
                maxWidth: '45%',
                flexShrink: 0,
                minHeight: 0,
                borderRight: `1px solid ${border}`,
                bgcolor: isDark ? '#0b0e13' : '#fbfcfd',
              }}
            >
              <DirectoryTree
                isDark={isDark}
                currentPath={s.path}
                homePath={s.homePath}
                currentEntries={s.entries}
                showHidden={s.showHidden}
                dropPath={dragOver && dropTarget && !dropTarget.rowName ? dropTarget.path : null}
                labels={{
                  home: t('home'),
                  root: t('root'),
                  refresh: t('refresh'),
                  uploadHere: t('upload_here'),
                  downloadHere: t('download_here'),
                  copyPath: t('copy_path'),
                  loadFailed: t('tree_load_failed'),
                }}
                formatMore={(count) => t('tree_more', { count })}
                list={listDir}
                listMany={listManyDir}
                onNavigate={s.navigate}
                onUploadTo={(p) => void s.pickAndUpload('files', p)}
                onDownloadNode={(p) => void s.downloadRemoteDir(p)}
                onCopyPath={(p) => void copyPath(p)}
              />
            </Box>
            {/* A wide grab strip straddling the hairline: 1px targets are a
                usability tax nobody should pay. */}
            <Box
              onPointerDown={startResize}
              sx={{
                width: 5,
                ml: '-3px',
                flexShrink: 0,
                zIndex: 2,
                cursor: 'col-resize',
                '&:hover': { bgcolor: isDark ? 'rgba(88,166,255,0.35)' : 'rgba(9,105,218,0.25)' },
                ...(resizing
                  ? { bgcolor: isDark ? 'rgba(88,166,255,0.55)' : 'rgba(9,105,218,0.4)' }
                  : null),
              }}
            />
          </>
        )}

        <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, minHeight: 0 }}>
          <PathBar
            path={s.path}
            isDark={isDark}
            editing={editingPath}
            draft={pathDraft}
            labels={{
              home: t('home'),
              root: t('root'),
              edit: t('edit_path'),
              placeholder: t('path_placeholder'),
            }}
            onNavigate={s.navigate}
            onDraftChange={setPathDraft}
            onBeginEdit={beginEditPath}
            onCancelEdit={() => setEditingPath(false)}
            onCommitEdit={commitEditPath}
          />

          {/* A hairline instead of a full skeleton keeps navigation from flashing. */}
          <Box sx={{ height: 2, flexShrink: 0 }}>
            {s.loading && !showSkeleton && <LinearProgress sx={{ height: 2 }} />}
          </Box>

          <Box sx={{ flex: 1, position: 'relative', minHeight: 0, overflow: 'hidden' }}>
        {s.error && (
          <Paper sx={{ m: 1, p: 1.5, bgcolor: isDark ? '#2d2424' : '#fff4f4' }}>
            <Typography variant="body2" sx={{ color: '#ff5252', fontSize: 12.5 }}>
              {s.error}
            </Typography>
          </Paper>
        )}

        {showSkeleton ? (
          <Box>
            {Array.from({ length: 14 }).map((_, i) => (
              <Box
                key={i}
                sx={{
                  height: 34,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                  px: 1,
                  opacity: 0.5,
                }}
              >
                <Box
                  sx={{
                    width: 16,
                    height: 16,
                    borderRadius: 1,
                    bgcolor: isDark ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.07)',
                  }}
                />
                <Box
                  sx={{
                    width: `${26 + (i % 5) * 9}%`,
                    height: 9,
                    borderRadius: 2,
                    bgcolor: isDark ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.07)',
                  }}
                />
              </Box>
            ))}
          </Box>
        ) : s.entries.length === 0 && !s.loading ? (
          <EmptyState
            isDark={isDark}
            icon={<FolderOpenIcon size={30} color={subtle} />}
            title={t('empty')}
            actionLabel={t('upload_files')}
            onAction={() => void s.pickAndUpload('files')}
          />
        ) : filteredOut ? (
          <EmptyState
            isDark={isDark}
            icon={
              s.search ? (
                <MagnifyingGlassIcon size={28} color={subtle} />
              ) : (
                <EyeIcon size={28} color={subtle} />
              )
            }
            title={s.search ? t('no_match', { query: s.search }) : t('only_hidden')}
            actionLabel={s.search ? t('clear_search') : t('reveal_hidden')}
            onAction={s.search ? () => s.setSearch('') : s.toggleHidden}
          />
        ) : (
          <FileTable
            entries={s.displayed}
            selected={s.selected}
            focused={s.focused}
            sortKey={s.sortKey}
            sortDir={s.sortDir}
            isDark={isDark}
            compact={compact}
            showOwner={wide}
            resetKey={`${s.path}|${s.search}`}
            dropTargetName={dragOver ? (dropTarget?.rowName ?? null) : null}
            labels={{
              name: t('name'),
              size: t('size'),
              modified: t('modified'),
              perms: t('perms'),
              owner: t('owner'),
              folder: t('folder'),
              linkTo: t('link_to'),
            }}
            onSort={s.handleSort}
            onRowClick={s.handleRowClick}
            onRowDoubleClick={(entry) => void s.openEntry(entry)}
            onRowContextMenu={handleRowContextMenu}
            onEmptyClick={s.clearSelection}
            onBackgroundContextMenu={(e) => {
              e.preventDefault();
              s.clearSelection();
              setBgMenu({ x: e.clientX, y: e.clientY });
            }}
          />
        )}

        {/*
          A dashed frame plus a floating pill instead of a dimming curtain: the
          highlighted destination row has to stay readable while the pointer is
          still holding the files.
        */}
        {dragOver && (
          <Box
            sx={{
              position: 'absolute',
              inset: 0,
              zIndex: 5,
              pointerEvents: 'none',
              border: `2px dashed ${dropTarget ? (isDark ? 'rgba(63,185,80,0.9)' : '#1F883D') : isDark ? 'rgba(88,166,255,0.7)' : '#0969DA'}`,
              borderRadius: 1,
            }}
          >
            <Box
              sx={{
                position: 'absolute',
                left: '50%',
                bottom: 16,
                transform: 'translateX(-50%)',
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                maxWidth: '86%',
                px: 1.75,
                py: 1,
                borderRadius: 999,
                bgcolor: isDark ? 'rgba(22,27,34,0.96)' : 'rgba(255,255,255,0.97)',
                border: '1px solid',
                borderColor: dropTarget
                  ? isDark
                    ? 'rgba(63,185,80,0.6)'
                    : 'rgba(31,136,61,0.45)'
                  : 'divider',
                boxShadow: isDark
                  ? '0 8px 26px rgba(0,0,0,0.55)'
                  : '0 8px 26px rgba(31,35,40,0.16)',
              }}
            >
              {dropTarget ? (
                <FolderOpenIcon size={18} color={isDark ? '#3FB950' : '#1F883D'} weight="fill" />
              ) : (
                <UploadIcon size={18} color={isDark ? '#58A6FF' : '#0969DA'} weight="bold" />
              )}
              <Typography sx={{ color: textColor, fontWeight: 600, fontSize: 13 }}>
                {t('drop_hint')}
              </Typography>
              <Typography
                sx={{
                  color: subtle,
                  fontSize: 12,
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {dropTarget?.path ?? s.path}
              </Typography>
            </Box>
          </Box>
        )}
          </Box>
        </Box>
      </Box>

      <StatusBar
        isDark={isDark}
        hidden={s.showHidden ? 0 : s.hiddenCount}
        selectedCount={s.selected.size}
        selectedSize={s.selectedSizeLabel}
        target={target}
        filtered={s.displayed.length !== s.entries.length}
        labels={{
          items: t('status_items', { count: s.entries.length }),
          hidden: t('status_hidden', { count: s.hiddenCount }),
          selected: t('status_selected', { count: s.selected.size }),
          filtered: t('status_filtered', { shown: s.displayed.length, total: s.entries.length }),
        }}
      />

      <TransferQueue
        items={s.transfers}
        collapsed={transferCollapsed}
        isDark={isDark}
        onToggle={() => setTransferCollapsed((v) => !v)}
        labels={{
          title: t('transfers'),
          clear: t('transfer_clear'),
          done: t('transfer_done'),
          failed: t('transfer_failed'),
          cancelled: t('cancelled'),
          cancel: t('cancel'),
          collapse: t('transfer_collapse'),
          expand: t('transfer_expand'),
          dismiss: t('transfer_dismiss'),
          retry: t('transfer_retry'),
          resume: t('transfer_resume'),
          resuming: t('transfer_resuming'),
          queued: t('transfer_queued'),
          queuedAt: (pos) => t('transfer_queued_at', { pos }),
        }}
        onClearFinished={s.clearFinishedTransfers}
        onDismiss={s.dismissTransfer}
        onCancel={(id) => void s.cancelTransfer(id)}
        onRetry={(id, resume) => s.retryTransfer(id, resume)}
      />

      {/* Row context menu */}
      <Menu
        open={!!rowMenu}
        onClose={() => setRowMenu(null)}
        anchorReference="anchorPosition"
        anchorPosition={rowMenu ? { top: rowMenu.y, left: rowMenu.x } : undefined}
      >
        <MenuItem
          dense
          onClick={() => {
            const en = rowMenu!.entry;
            setRowMenu(null);
            void s.openEntry(en);
          }}
        >
          <ListItemIcon sx={{ minWidth: 26 }}>
            {rowMenu && isNavigable(rowMenu.entry) ? (
              <FolderOpenIcon size={15} color={subtle} />
            ) : (
              <DownloadIcon size={15} color={subtle} />
            )}
          </ListItemIcon>
          <ListItemText slotProps={{ primary: { sx: { fontSize: 13 } } }}>
            {rowMenu && isNavigable(rowMenu.entry) ? t('context_open') : t('context_download')}
          </ListItemText>
        </MenuItem>
        {/* For a single file the first item already downloads it — only offer
            the plain download again when it means something different. */}
        {((rowMenu && isNavigable(rowMenu.entry)) || s.selected.size > 1) && (
          <MenuItem
            dense
            onClick={() => {
              setRowMenu(null);
              void s.downloadEntries(s.selectedEntries, false);
            }}
          >
            <ListItemIcon sx={{ minWidth: 26 }}>
              <DownloadIcon size={15} color={subtle} />
            </ListItemIcon>
            <ListItemText slotProps={{ primary: { sx: { fontSize: 13 } } }}>
              {t('context_download')}
            </ListItemText>
          </MenuItem>
        )}
        <MenuItem
          dense
          onClick={() => {
            setRowMenu(null);
            void s.downloadEntries(s.selectedEntries, true);
          }}
        >
          <ListItemIcon sx={{ minWidth: 26 }}>
            <FolderIcon size={15} color={subtle} />
          </ListItemIcon>
          <ListItemText slotProps={{ primary: { sx: { fontSize: 13 } } }}>
            {t('download_to')}
          </ListItemText>
        </MenuItem>
        <MenuItem
          dense
          onClick={() => {
            const en = rowMenu!.entry;
            setRowMenu(null);
            void copyEntryPath(en);
          }}
        >
          <ListItemIcon sx={{ minWidth: 26 }}>
            <CopyIcon size={15} color={subtle} />
          </ListItemIcon>
          <ListItemText slotProps={{ primary: { sx: { fontSize: 13 } } }}>
            {t('copy_path')}
          </ListItemText>
        </MenuItem>
        <MenuItem
          dense
          disabled={s.selected.size !== 1}
          onClick={() => {
            const en = rowMenu!.entry;
            setRowMenu(null);
            s.startRename(en);
          }}
        >
          <ListItemIcon sx={{ minWidth: 26 }}>
            <PencilSimpleIcon size={15} color={subtle} />
          </ListItemIcon>
          <ListItemText slotProps={{ primary: { sx: { fontSize: 13 } } }}>
            {t('context_rename')}
          </ListItemText>
        </MenuItem>
        <MenuItem
          dense
          disabled={s.selected.size < 2}
          onClick={() => {
            setRowMenu(null);
            s.startBatchRename(s.selectedEntries);
          }}
        >
          <ListItemIcon sx={{ minWidth: 26 }}>
            <PencilSimpleIcon size={15} color={subtle} />
          </ListItemIcon>
          <ListItemText slotProps={{ primary: { sx: { fontSize: 13 } } }}>
            {t('context_batch_rename')}
          </ListItemText>
        </MenuItem>
        <MenuItem
          dense
          disabled={s.selected.size === 0}
          onClick={() => {
            setRowMenu(null);
            s.startChmod(s.selectedEntries);
          }}
        >
          <ListItemIcon sx={{ minWidth: 26 }}>
            <LockKeyIcon size={15} color={subtle} />
          </ListItemIcon>
          <ListItemText slotProps={{ primary: { sx: { fontSize: 13 } } }}>
            {t('context_chmod')}
          </ListItemText>
        </MenuItem>
        <MenuItem
          dense
          onClick={() => {
            const names = s.selected.size > 0 ? Array.from(s.selected) : [rowMenu!.entry.name];
            setRowMenu(null);
            s.requestDelete(names);
          }}
        >
          <ListItemIcon sx={{ minWidth: 26 }}>
            <TrashIcon size={15} color="#e5484d" />
          </ListItemIcon>
          <ListItemText slotProps={{ primary: { sx: { fontSize: 13, color: '#e5484d' } } }}>
            {t('context_delete')}
          </ListItemText>
        </MenuItem>
      </Menu>

      {/* Empty area context menu */}
      <Menu
        open={!!bgMenu}
        onClose={() => setBgMenu(null)}
        anchorReference="anchorPosition"
        anchorPosition={bgMenu ? { top: bgMenu.y, left: bgMenu.x } : undefined}
      >
        <MenuItem
          dense
          onClick={() => {
            setBgMenu(null);
            void s.pickAndUpload('files');
          }}
        >
          <ListItemIcon sx={{ minWidth: 26 }}>
            <FileIcon size={15} color={subtle} />
          </ListItemIcon>
          <ListItemText slotProps={{ primary: { sx: { fontSize: 13 } } }}>
            {t('upload_files')}
          </ListItemText>
        </MenuItem>
        <MenuItem
          dense
          onClick={() => {
            setBgMenu(null);
            void s.pickAndUpload('folder');
          }}
        >
          <ListItemIcon sx={{ minWidth: 26 }}>
            <FolderIcon size={15} color={subtle} />
          </ListItemIcon>
          <ListItemText slotProps={{ primary: { sx: { fontSize: 13 } } }}>
            {t('upload_folder')}
          </ListItemText>
        </MenuItem>
        <MenuItem
          dense
          onClick={() => {
            setBgMenu(null);
            s.setNewFolderOpen(true);
          }}
        >
          <ListItemIcon sx={{ minWidth: 26 }}>
            <FolderPlusIcon size={15} color={subtle} />
          </ListItemIcon>
          <ListItemText slotProps={{ primary: { sx: { fontSize: 13 } } }}>
            {t('new_folder')}
          </ListItemText>
        </MenuItem>
        <MenuItem
          dense
          onClick={() => {
            setBgMenu(null);
            s.selectAll();
          }}
        >
          <ListItemIcon sx={{ minWidth: 26 }}>
            <SelectionAllIcon size={15} color={subtle} />
          </ListItemIcon>
          <ListItemText slotProps={{ primary: { sx: { fontSize: 13 } } }}>
            {t('select_all')}
          </ListItemText>
        </MenuItem>
        <MenuItem
          dense
          onClick={() => {
            setBgMenu(null);
            s.toggleHidden();
          }}
        >
          <ListItemIcon sx={{ minWidth: 26 }}>
            <EyeIcon size={15} color={subtle} />
          </ListItemIcon>
          <ListItemText slotProps={{ primary: { sx: { fontSize: 13 } } }}>
            {s.showHidden ? t('hide_hidden') : t('show_hidden')}
          </ListItemText>
        </MenuItem>
        <MenuItem
          dense
          onClick={() => {
            setBgMenu(null);
            s.refresh();
          }}
        >
          <ListItemIcon sx={{ minWidth: 26 }}>
            <ArrowClockwiseIcon size={15} color={subtle} />
          </ListItemIcon>
          <ListItemText slotProps={{ primary: { sx: { fontSize: 13 } } }}>
            {t('refresh')}
          </ListItemText>
        </MenuItem>
      </Menu>

      <SftpDialogs
        isDark={isDark}
        busy={s.busy}
        renaming={s.renaming}
        renameValue={s.renameValue}
        newFolderOpen={s.newFolderOpen}
        newFolderName={s.newFolderName}
        confirm={s.confirm}
        chmodTargets={s.chmodTargets}
        chmodValue={s.chmodValue}
        batchRename={s.batchRename}
        existingNames={s.entries.map((e) => e.name)}
        labels={{
          cancel: t('cancel'),
          ok: t('ok'),
          delete: t('delete'),
          renameTitle: t('rename_title'),
          newFolderTitle: t('new_folder_title'),
          folderName: t('folder_name'),
          overwriteTitle: t('overwrite_title'),
          overwriteDesc: t('overwrite_desc'),
          overwriteMergeHint: t('overwrite_merge_hint'),
          overwrite: t('overwrite'),
          overwriteKeepBoth: t('overwrite_keep_both'),
          overwriteKeepBothHint: t('overwrite_keep_both_hint'),
          overwriteSkip: t('overwrite_skip'),
          permsTitle: t('perms_title'),
          permsMode: t('perms_mode'),
          permsSubject: t('perms_subject', { count: s.chmodTargets ? s.chmodTargets.length : 0 }),
          permsOwner: t('perms_owner'),
          permsGroup: t('perms_group'),
          permsOther: t('perms_other'),
          permsRead: t('perms_read'),
          permsWrite: t('perms_write'),
          permsExec: t('perms_exec'),
          permsHint: t('perms_hint'),
          permsInvalid: t('perms_invalid'),
          apply: t('apply'),
          batchRenameTitle: t('batch_rename_title'),
          batchRenameSubject: t('batch_rename_subject', { count: s.batchRename ? s.batchRename.length : 0 }),
          batchRenameDesc: t('batch_rename_desc'),
          batchRenamePattern: t('batch_rename_pattern'),
          batchRenameHint: t('batch_rename_hint'),
          batchRenamePreview: t('batch_rename_preview'),
          batchRenameMore: (count) => t('batch_rename_more', { count }),
          batchRenameApply: t('batch_rename_apply'),
          batchRenameEmpty: t('batch_rename_empty'),
          batchRenameDuplicate: t('batch_rename_duplicate'),
          batchRenameInvalid: (name) => t('batch_rename_invalid', { name }),
          batchRenameConflict: (name) => t('batch_rename_conflict', { name }),
          deleteMessage:
            s.confirm?.kind === 'delete'
              ? s.confirm.names.length === 1
                ? t('delete_confirm', { name: s.confirm.names[0] })
                : t('delete_count_confirm', { count: s.confirm.names.length })
              : '',
        }}
        onRenameChange={s.setRenameValue}
        onRenameCancel={() => s.setRenaming(null)}
        onRenameSubmit={() => void s.submitRename()}
        onFolderChange={s.setNewFolderName}
        onFolderCancel={() => s.setNewFolderOpen(false)}
        onFolderSubmit={() => void s.submitNewFolder()}
        onConfirmCancel={() => s.setConfirm(null)}
        onOverwriteAll={() => {
          if (s.confirm?.kind !== 'overwrite') return;
          const { paths, dir } = s.confirm;
          s.setConfirm(null);
          void s.runUpload(paths, dir);
        }}
        onOverwriteSkip={() => {
          if (s.confirm?.kind !== 'overwrite') return;
          const { paths, conflicts, dir } = s.confirm;
          s.setConfirm(null);
          const taken = new Set(conflicts.map((c) => c.name));
          const keep = paths.filter((p) => !taken.has(basename(p)));
          if (keep.length > 0) void s.runUpload(keep, dir);
        }}
        onOverwriteKeepBoth={() => s.confirmKeepBoth()}
        onDeleteConfirm={() => {
          if (s.confirm?.kind !== 'delete') return;
          const names = s.confirm.names;
          s.setConfirm(null);
          void s.deleteEntries(names);
        }}
        onChmodChange={s.setChmodValue}
        onChmodCancel={() => s.setChmodTargets(null)}
        onChmodSubmit={() => void s.submitChmod()}
        onBatchRenameCancel={() => s.setBatchRename(null)}
        onBatchRenameSubmit={(names) => void s.submitBatchRename(names)}
      />
    </Box>
  );
}

function EmptyState({
  isDark,
  icon,
  title,
  actionLabel,
  onAction,
}: {
  isDark: boolean;
  icon: React.ReactNode;
  title: string;
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <Box
      sx={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 1.25,
      }}
    >
      {icon}
      <Typography sx={{ color: isDark ? '#8B949E' : '#6B7280', fontSize: 13 }}>{title}</Typography>
      <Button size="small" variant="outlined" onClick={onAction} sx={{ textTransform: 'none' }}>
        {actionLabel}
      </Button>
    </Box>
  );
}
