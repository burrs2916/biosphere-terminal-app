import { forwardRef, memo, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import {
  ArrowClockwiseIcon,
  CaretDownIcon,
  CaretRightIcon,
  CopyIcon,
  DownloadIcon,
  FolderIcon,
  FolderOpenIcon,
  HardDrivesIcon,
  HouseIcon,
  UploadIcon,
  WarningCircleIcon,
} from '@phosphor-icons/react';
import type { DirListing, SftpEntry } from '../../core/services/sftp.service';
import { localizeBackendError } from '../../core/backendError';
import { childDirPath, isDriveRoot, isHiddenName, isNavigable, pathSegments } from './utils';

/**
 * Directories with more children than this are truncated: a tree is for
 * orientation, and pushing 4 000 rows through it only makes the scrollbar
 * useless. The overflow row jumps into the table, which is windowed.
 */
const MAX_CHILDREN = 300;

interface TreeChild {
  name: string;
  path: string;
}

type NodeState =
  | { status: 'loading' }
  | { status: 'ready'; children: TreeChild[] }
  | { status: 'error'; error: string };

type RowKind = 'home' | 'root' | 'dir' | 'more';

interface Row {
  key: string;
  path: string;
  name: string;
  depth: number;
  kind: RowKind;
  /** Only set on `more` rows: how many children were held back. */
  hidden?: number;
  // Per-row view state, pre-computed so each row can be memoised: a single
  // node finishing its fetch then only repaints that one row, not the tree.
  isActive?: boolean;
  isDropTarget?: boolean;
  hasToggle?: boolean;
  open?: boolean;
  loading?: boolean;
  failed?: boolean;
  errorText?: string;
}

export interface DirectoryTreeLabels {
  home: string;
  root: string;
  refresh: string;
  uploadHere: string;
  downloadHere: string;
  copyPath: string;
  loadFailed: string;
}

interface DirectoryTreeProps {
  isDark: boolean;
  /** Directory shown in the table — highlighted and revealed automatically. */
  currentPath: string;
  /** Home directory, resolved by the very first listing. */
  homePath: string | null;
  /** Listing of `currentPath`; reused so the active node never refetches. */
  currentEntries: SftpEntry[];
  showHidden: boolean;
  /** Absolute path of the folder under a drag, if the cursor is over one. */
  dropPath: string | null;
  labels: DirectoryTreeLabels;
  /** Pluralised "N more…" row shown when a directory is truncated. */
  formatMore: (count: number) => string;
  list: (path: string) => Promise<SftpEntry[]>;
  /** Batched lister — drives the expand cascade so N nodes cost one trip. */
  listMany: (paths: string[]) => Promise<DirListing[]>;
  onNavigate: (path: string) => void;
  onUploadTo: (path: string) => void;
  onDownloadNode: (path: string) => void;
  onCopyPath: (path: string) => void;
}

/**
 * A lazily expanded view of the remote directory hierarchy.
 *
 * Two roots are offered because they answer two different questions: "where do
 * my files live" (home) and "what does this machine look like" (`/`, which on
 * Win32-OpenSSH enumerates the drive letters instead of a POSIX root).
 *
 * Nodes are the entries that can actually be entered, symlinked folders
 * included — the listing resolves those, so the tree no longer has to pretend
 * they are files. Unresolved symlinks stay out: a node that expands into an
 * error is worse than no node at all, and the table can still open them.
 */
export function DirectoryTree({
  isDark,
  currentPath,
  homePath,
  currentEntries,
  showHidden,
  dropPath,
  labels,
  formatMore,
  list,
  listMany,
  onNavigate,
  onUploadTo,
  onDownloadNode,
  onCopyPath,
}: DirectoryTreeProps) {
  const [nodes, setNodes] = useState<Map<string, NodeState>>(() => new Map());
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(['/']));
  const [menu, setMenu] = useState<{ path: string; x: number; y: number } | null>(null);

  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const inflight = useRef<Set<string>>(new Set());
  const activeRef = useRef<HTMLDivElement | null>(null);

  const subtle = isDark ? '#8B949E' : '#6B7280';

  const toChildren = useCallback(
    (base: string, entries: SftpEntry[]): TreeChild[] =>
      entries
        .filter(isNavigable)
        .map((e) => ({ name: e.name, path: childDirPath(base, e.name) })),
    [],
  );

  const fetchNode = useCallback(
    async (path: string, force = false) => {
      if (inflight.current.has(path)) return;
      const st = nodesRef.current.get(path);
      if (!force && st && st.status !== 'error') return;
      inflight.current.add(path);
      setNodes((m) => new Map(m).set(path, { status: 'loading' }));
      try {
        const entries = await list(path);
        setNodes((m) => new Map(m).set(path, { status: 'ready', children: toChildren(path, entries) }));
      } catch (e) {
        // Unreadable directories are the norm (/root, /proc/1, …). The node
        // reports it and the rest of the tree carries on.
        setNodes((m) => new Map(m).set(path, { status: 'error', error: localizeBackendError(e) }));
      } finally {
        inflight.current.delete(path);
      }
    },
    [list, toChildren],
  );

  /** Children of the browsed directory come from the table's own listing. */
  const currentChildren = useMemo(() => {
    if (!currentPath || currentPath === '.') return null;
    return toChildren(currentPath, currentEntries);
  }, [currentPath, currentEntries, toChildren]);

  const childrenOf = useCallback(
    (path: string): TreeChild[] | null => {
      if (currentChildren && path === currentPath) return currentChildren;
      const st = nodes.get(path);
      return st?.status === 'ready' ? st.children : null;
    },
    [nodes, currentChildren, currentPath],
  );

  // Reveal the browsed directory: expanding the ancestors makes each one
  // render, which in turn triggers its own fetch — a self-limiting cascade
  // rather than a burst of speculative requests.
  useEffect(() => {
    if (!currentPath || currentPath === '.') return;
    const chain = pathSegments(currentPath)
      .slice(0, -1)
      .map((s) => s.path);
    setExpanded((prev) => {
      const next = new Set(prev);
      next.add('/');
      chain.forEach((p) => next.add(p));
      if (homePath && currentPath.startsWith(`${homePath}/`)) next.add(homePath);
      return next.size === prev.size ? prev : next;
    });
  }, [currentPath, homePath]);

  useEffect(() => {
    // A deep reveal expands an ancestor chain all at once. Fetching every new
    // node in a single batched round-trip (one sftp session) is markedly
    // smoother on a high-latency link than one request per node.
    const pending: string[] = [];
    for (const p of expanded) {
      if (currentChildren && p === currentPath) continue;
      if (nodes.has(p)) continue;
      if (inflight.current.has(p)) continue;
      pending.push(p);
    }
    if (pending.length === 0) return;
    pending.forEach((p) => inflight.current.add(p));
    setNodes((m) => {
      const next = new Map(m);
      for (const p of pending) next.set(p, { status: 'loading' });
      return next;
    });
    listMany(pending)
      .then((listings) => {
        const byPath = new Map(listings.map((l) => [l.path, l]));
        setNodes((m) => {
          const next = new Map(m);
          for (const p of pending) {
            const l = byPath.get(p);
            if (l) {
              if (l.error) next.set(p, { status: 'error', error: l.error });
              else next.set(p, { status: 'ready', children: toChildren(p, l.entries) });
            } else {
              next.set(p, { status: 'error', error: 'missing listing' });
            }
          }
          return next;
        });
      })
      .catch((e) => {
        setNodes((m) => {
          const next = new Map(m);
          for (const p of pending) next.set(p, { status: 'error', error: localizeBackendError(e) });
          return next;
        });
      })
      .finally(() => {
        pending.forEach((p) => inflight.current.delete(p));
      });
  }, [expanded, nodes, currentPath, currentChildren, listMany, toChildren]);

  // Keep the highlighted node on screen when navigation happens in the table.
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest' });
  }, [currentPath, nodes]);

  const toggle = useCallback((path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  /** Click-to-open only ever adds: it must not collapse a folder the user
   *  explicitly opened elsewhere. */
  const expand = useCallback((path: string) => {
    setExpanded((prev) => {
      if (prev.has(path)) return prev;
      const next = new Set(prev);
      next.add(path);
      return next;
    });
  }, []);

  const rows = useMemo(() => {
    const out: Row[] = [];

    const walk = (path: string, depth: number) => {
      if (!expanded.has(path)) return;
      const kids = childrenOf(path);
      if (!kids) return;
      const visible = showHidden ? kids : kids.filter((c) => !isHiddenName(c.name));
      const shown = visible.slice(0, MAX_CHILDREN);
      for (const child of shown) {
        const state = nodes.get(child.path);
        const open = expanded.has(child.path);
        const cKids = childrenOf(child.path);
        // The chevron stays until a listing proves there is nothing to show —
        // otherwise every unexpanded folder would look like a leaf. Hidden
        // folders are excluded so the arrow never expands into blank space.
        const knownKids =
          cKids === null ? null : showHidden ? cKids.length : cKids.filter((c) => !isHiddenName(c.name)).length;
        const hasToggle = knownKids === null || knownKids > 0;
        const loading = state?.status === 'loading';
        const failed = state?.status === 'error';
        out.push({
          key: `${depth}:${child.path}`,
          path: child.path,
          name: child.name,
          depth,
          kind: 'dir',
          isActive: child.path === currentPath,
          isDropTarget: dropPath === child.path,
          hasToggle,
          open,
          loading,
          failed,
          errorText: failed ? state.error : '',
        });
        walk(child.path, depth + 1);
      }
      if (visible.length > shown.length) {
        out.push({
          key: `${depth}:more:${path}`,
          path,
          name: '',
          depth,
          kind: 'more',
          hidden: visible.length - shown.length,
        });
      }
    };

    // A root-owned account whose home *is* `/` would otherwise get the same
    // directory twice under two names.
    if (homePath && homePath !== '/') {
      out.push({ key: `home:${homePath}`, path: homePath, name: labels.home, depth: 0, kind: 'home' });
      walk(homePath, 1);
    }
    out.push({ key: 'root:/', path: '/', name: labels.root, depth: 0, kind: 'root' });
    walk('/', 1);
    return out;
  }, [expanded, childrenOf, showHidden, homePath, labels.home, labels.root, nodes, currentPath, dropPath]);

  const handleContextMenu = useCallback((path: string, e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ path, x: e.clientX, y: e.clientY });
  }, []);

  return (
    <Box
      sx={{
        height: '100%',
        overflow: 'auto',
        py: 0.5,
        userSelect: 'none',
        '&::-webkit-scrollbar': { width: 8, height: 8 },
        '&::-webkit-scrollbar-thumb': {
          borderRadius: 4,
          backgroundColor: isDark ? 'rgba(110,118,129,0.4)' : 'rgba(140,149,159,0.4)',
        },
      }}
    >
      {rows.map((row) => {
        if (row.kind === 'more') {
          return (
            <TreeMoreRow
              key={row.key}
              depth={row.depth}
              label={formatMore(row.hidden ?? 0)}
              isDark={isDark}
              onNavigate={() => onNavigate(row.path)}
            />
          );
        }
        return (
          <TreeRow
            key={row.key}
            ref={row.isActive ? activeRef : undefined}
            path={row.path}
            name={row.name}
            depth={row.depth}
            kind={row.kind}
            isActive={!!row.isActive}
            isDropTarget={!!row.isDropTarget}
            hasToggle={!!row.hasToggle}
            open={!!row.open}
            loading={!!row.loading}
            failed={!!row.failed}
            errorText={row.errorText ?? ''}
            isDark={isDark}
            loadFailedLabel={labels.loadFailed}
            onNavigate={onNavigate}
            onToggle={toggle}
            onExpand={expand}
            onContextMenu={handleContextMenu}
          />
        );
      })}

      <Menu
        open={!!menu}
        onClose={() => setMenu(null)}
        anchorReference="anchorPosition"
        anchorPosition={menu ? { top: menu.y, left: menu.x } : undefined}
      >
        <MenuItem
          dense
          onClick={() => {
            const p = menu!.path;
            setMenu(null);
            void fetchNode(p, true);
          }}
        >
          <ListItemIcon sx={{ minWidth: 26 }}>
            <ArrowClockwiseIcon size={15} color={subtle} />
          </ListItemIcon>
          <ListItemText slotProps={{ primary: { sx: { fontSize: 13 } } }}>{labels.refresh}</ListItemText>
        </MenuItem>
        <MenuItem
          dense
          onClick={() => {
            const p = menu!.path;
            setMenu(null);
            onUploadTo(p);
          }}
        >
          <ListItemIcon sx={{ minWidth: 26 }}>
            <UploadIcon size={15} color={subtle} />
          </ListItemIcon>
          <ListItemText slotProps={{ primary: { sx: { fontSize: 13 } } }}>{labels.uploadHere}</ListItemText>
        </MenuItem>
        <MenuItem
          dense
          onClick={() => {
            const p = menu!.path;
            setMenu(null);
            onDownloadNode(p);
          }}
        >
          <ListItemIcon sx={{ minWidth: 26 }}>
            <DownloadIcon size={15} color={subtle} />
          </ListItemIcon>
          <ListItemText slotProps={{ primary: { sx: { fontSize: 13 } } }}>{labels.downloadHere}</ListItemText>
        </MenuItem>
        <MenuItem
          dense
          onClick={() => {
            const p = menu!.path;
            setMenu(null);
            onCopyPath(p);
          }}
        >
          <ListItemIcon sx={{ minWidth: 26 }}>
            <CopyIcon size={15} color={subtle} />
          </ListItemIcon>
          <ListItemText slotProps={{ primary: { sx: { fontSize: 13 } } }}>{labels.copyPath}</ListItemText>
        </MenuItem>
      </Menu>
    </Box>
  );
}

/**
 * One directory row, memoised so a single node finishing its fetch repaints
 * only that row instead of the whole tree. Props are all primitives or stable
 * callbacks, so React.memo's shallow compare holds the line.
 */
interface TreeRowProps {
  path: string;
  name: string;
  depth: number;
  kind: RowKind;
  isActive: boolean;
  isDropTarget: boolean;
  hasToggle: boolean;
  open: boolean;
  loading: boolean;
  failed: boolean;
  errorText: string;
  isDark: boolean;
  loadFailedLabel: string;
  onNavigate: (path: string) => void;
  onToggle: (path: string) => void;
  onExpand: (path: string) => void;
  onContextMenu: (path: string, e: MouseEvent) => void;
}

const TreeRow = memo(
  forwardRef<HTMLDivElement, TreeRowProps>(function TreeRow(
    {
      path,
      name,
      depth,
      kind,
      isActive,
      isDropTarget,
      hasToggle,
      open,
      loading,
      failed,
      errorText,
      isDark,
      loadFailedLabel,
      onNavigate,
      onToggle,
      onExpand,
      onContextMenu,
    },
    ref,
  ) {
    const subtle = isDark ? '#8B949E' : '#6B7280';
    const textColor = isDark ? '#C9D1D9' : '#24292F';
    const accent = isDark ? '#58A6FF' : '#0969DA';
    const folderTint = isDark ? '#7D8590' : '#54AEFF';
    return (
      <Box
        ref={ref}
        data-tree-path={path}
        onClick={() => {
          if (!open) onExpand(path);
          onNavigate(path);
        }}
        onContextMenu={(e) => onContextMenu(path, e)}
        sx={{
          pl: `${4 + depth * 13}px`,
          pr: 0.75,
          height: 26,
          display: 'flex',
          alignItems: 'center',
          gap: 0.25,
          cursor: 'pointer',
          borderRadius: 0.75,
          mx: 0.5,
          bgcolor: isDropTarget
            ? isDark
              ? 'rgba(63,185,80,0.22)'
              : 'rgba(31,136,61,0.14)'
            : isActive
              ? isDark
                ? 'rgba(56,139,253,0.18)'
                : 'rgba(9,105,218,0.10)'
              : 'transparent',
          outline: isDropTarget
            ? `1px solid ${isDark ? 'rgba(63,185,80,0.8)' : '#1F883D'}`
            : 'none',
          '&:hover': {
            bgcolor: isActive
              ? isDark
                ? 'rgba(56,139,253,0.24)'
                : 'rgba(9,105,218,0.14)'
              : isDark
                ? 'rgba(110,118,129,0.16)'
                : 'rgba(27,31,36,0.055)',
          },
        }}
      >
        <Box
          onClick={(e) => {
            e.stopPropagation();
            if (hasToggle) onToggle(path);
          }}
          sx={{
            width: 15,
            height: 20,
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 0.5,
            '&:hover': hasToggle
              ? { bgcolor: isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.07)' }
              : undefined,
          }}
        >
          {loading ? (
            <CircularProgress size={9} thickness={6} sx={{ color: subtle }} />
          ) : hasToggle ? (
            open ? (
              <CaretDownIcon size={10} color={subtle} weight="bold" />
            ) : (
              <CaretRightIcon size={10} color={subtle} weight="bold" />
            )
          ) : null}
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', width: 17, flexShrink: 0 }}>
          {kind === 'home' ? (
            <HouseIcon size={14} color={isActive ? accent : folderTint} weight="fill" />
          ) : kind === 'root' || isDriveRoot(path) ? (
            <HardDrivesIcon size={14} color={isActive ? accent : folderTint} weight="fill" />
          ) : open ? (
            <FolderOpenIcon size={14} color={isActive ? accent : folderTint} weight="fill" />
          ) : (
            <FolderIcon size={14} color={isActive ? accent : folderTint} weight="fill" />
          )}
        </Box>

        <Typography
          sx={{
            flex: 1,
            minWidth: 0,
            fontSize: 12.5,
            lineHeight: 1.2,
            color: isActive ? (isDark ? '#E6EDF3' : '#0969DA') : textColor,
            fontWeight: isActive ? 600 : 400,
            opacity: isHiddenName(name) ? 0.62 : 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={path}
        >
          {name}
        </Typography>

        {failed && (
          <Tooltip title={`${loadFailedLabel}${errorText ? ` — ${errorText}` : ''}`}>
            <Box sx={{ display: 'flex', flexShrink: 0 }}>
              <WarningCircleIcon size={13} color={isDark ? '#D29922' : '#9A6700'} />
            </Box>
          </Tooltip>
        )}
      </Box>
    );
  }),
);

/** The "N more…" overflow row that jumps into the (windowed) table. */
interface TreeMoreRowProps {
  depth: number;
  label: string;
  isDark: boolean;
  onNavigate: () => void;
}

const TreeMoreRow = memo(function TreeMoreRow({ depth, label, isDark, onNavigate }: TreeMoreRowProps) {
  const subtle = isDark ? '#8B949E' : '#6B7280';
  return (
    <Box
      onClick={onNavigate}
      sx={{
        pl: `${8 + depth * 13}px`,
        pr: 1,
        height: 24,
        display: 'flex',
        alignItems: 'center',
        cursor: 'pointer',
        color: subtle,
        fontSize: 11.5,
        fontStyle: 'italic',
        '&:hover': { textDecoration: 'underline' },
      }}
    >
      {label}
    </Box>
  );
});
