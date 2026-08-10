import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Tooltip from '@mui/material/Tooltip';
import {
  CaretDownIcon,
  CaretUpIcon,
  FileAudioIcon,
  FileCodeIcon,
  FileIcon,
  FileImageIcon,
  FilePdfIcon,
  FileTextIcon,
  FileVideoIcon,
  FileZipIcon,
  FolderIcon,
  HardDrivesIcon,
  LinkSimpleIcon,
} from '@phosphor-icons/react';
import type { SftpEntry } from '../../core/services/sftp.service';
import {
  fileKind,
  formatSize,
  isHiddenName,
  isNavigable,
  permsToOctal,
  type SortDir,
  type SortKey,
} from './utils';

const ROW_H = 34;
const OVERSCAN = 10;

interface FileTableProps {
  entries: SftpEntry[];
  selected: Set<string>;
  focused: string | null;
  sortKey: SortKey;
  sortDir: SortDir;
  isDark: boolean;
  compact: boolean;
  /** Render the owner/group column (meaningful on POSIX remotes). */
  showOwner: boolean;
  /**
   * Scroll returns to the top only when this changes. Tying it to the entry
   * array instead would throw the viewport away on every refresh, so deleting
   * one file at the bottom of a long directory bounced the user to the top.
   */
  resetKey: string;
  /** Folder row currently under a drag, highlighted as the upload target. */
  dropTargetName?: string | null;
  labels: {
    name: string;
    size: string;
    modified: string;
    perms: string;
    owner: string;
    folder: string;
    linkTo: string;
  };
  onSort: (key: SortKey) => void;
  onRowClick: (entry: SftpEntry, index: number, e: React.MouseEvent) => void;
  onRowDoubleClick: (entry: SftpEntry) => void;
  onRowContextMenu: (entry: SftpEntry, e: React.MouseEvent) => void;
  onEmptyClick: () => void;
  /** Right click on the blank area below the rows. */
  onBackgroundContextMenu?: (e: React.MouseEvent) => void;
}

function KindIcon({ entry, color, size }: { entry: SftpEntry; color: string; size: number }) {
  const kind = fileKind(entry);
  const common = { size, color, weight: (kind === 'folder' ? 'fill' : 'regular') as 'fill' | 'regular' };
  switch (kind) {
    case 'folder':
      return <FolderIcon {...common} />;
    case 'archive':
      return <FileZipIcon {...common} />;
    case 'image':
      return <FileImageIcon {...common} />;
    case 'code':
      return <FileCodeIcon {...common} />;
    case 'text':
      return <FileTextIcon {...common} />;
    case 'pdf':
      return <FilePdfIcon {...common} />;
    case 'audio':
      return <FileAudioIcon {...common} />;
    case 'video':
      return <FileVideoIcon {...common} />;
    case 'binary':
      return <HardDrivesIcon {...common} />;
    default:
      return <FileIcon {...common} />;
  }
}

export function FileTable({
  entries,
  selected,
  focused,
  sortKey,
  sortDir,
  isDark,
  compact,
  showOwner,
  resetKey,
  dropTargetName,
  labels,
  onSort,
  onRowClick,
  onRowDoubleClick,
  onRowContextMenu,
  onEmptyClick,
  onBackgroundContextMenu,
}: FileTableProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(480);

  // Windowed rendering keeps directories with thousands of entries at 60fps.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewport(el.clientHeight));
    ro.observe(el);
    setViewport(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    setScrollTop(0);
  }, [resetKey]);

  // Keeping the viewport across refreshes means it can now outlive the rows it
  // was showing (delete the tail of a directory), so clamp it back into range.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const max = Math.max(0, entries.length * ROW_H - el.clientHeight);
    if (el.scrollTop > max) {
      el.scrollTop = max;
      setScrollTop(max);
    }
  }, [entries]);

  // Keyboard navigation must drag the viewport along, otherwise arrow keys walk
  // the focus ring straight out of sight in a long directory.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !focused) return;
    const idx = entries.findIndex((e) => e.name === focused);
    if (idx < 0) return;
    const top = idx * ROW_H;
    const bottom = top + ROW_H;
    if (top < el.scrollTop) {
      el.scrollTop = top;
      setScrollTop(top);
    } else if (bottom > el.scrollTop + el.clientHeight) {
      const next = bottom - el.clientHeight;
      el.scrollTop = next;
      setScrollTop(next);
    }
  }, [focused, entries]);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  }, []);

  const range = useMemo(() => {
    const start = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
    const end = Math.min(entries.length, Math.ceil((scrollTop + viewport) / ROW_H) + OVERSCAN);
    return { start, end };
  }, [scrollTop, viewport, entries.length]);

  const gridTemplate = compact
    ? '1fr 88px 116px'
    : showOwner
      ? '1fr 96px 148px 92px 104px'
      : '1fr 96px 148px 92px';
  const border = isDark ? 'rgba(240,246,252,0.08)' : 'rgba(27,31,36,0.10)';
  const headText = isDark ? '#8B949E' : '#57606A';
  const bodyText = isDark ? '#C9D1D9' : '#24292F';
  const subtle = isDark ? '#7D8590' : '#6E7781';
  const selBg = isDark ? 'rgba(56,139,253,0.22)' : 'rgba(9,105,218,0.12)';
  const hoverBg = isDark ? 'rgba(177,186,196,0.08)' : 'rgba(27,31,36,0.045)';
  const focusRing = isDark ? 'rgba(88,166,255,0.65)' : 'rgba(9,105,218,0.55)';
  const dirColor = isDark ? '#6CB6FF' : '#0969DA';
  const dropBg = isDark ? 'rgba(63,185,80,0.22)' : 'rgba(31,136,61,0.14)';
  const dropRing = isDark ? 'rgba(63,185,80,0.85)' : 'rgba(31,136,61,0.75)';

  const Header = ({ k, label, align }: { k: SortKey; label: string; align?: 'right' | 'left' }) => (
    <Box
      onClick={() => onSort(k)}
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: align === 'right' ? 'flex-end' : 'flex-start',
        gap: 0.4,
        px: 1,
        height: 32,
        cursor: 'pointer',
        userSelect: 'none',
        fontSize: 12,
        fontWeight: 600,
        letterSpacing: 0.2,
        color: sortKey === k ? (isDark ? '#E6EDF3' : '#1F2328') : headText,
        '&:hover': { color: isDark ? '#E6EDF3' : '#1F2328' },
      }}
    >
      {label}
      {sortKey === k &&
        (sortDir === 'asc' ? <CaretUpIcon size={11} weight="bold" /> : <CaretDownIcon size={11} weight="bold" />)}
    </Box>
  );

  const visible = entries.slice(range.start, range.end);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: gridTemplate,
          borderBottom: `1px solid ${border}`,
          bgcolor: isDark ? 'rgba(110,118,129,0.08)' : 'rgba(175,184,193,0.12)',
          flexShrink: 0,
        }}
      >
        <Header k="name" label={labels.name} />
        <Header k="size" label={labels.size} align="right" />
        <Header k="mtime" label={labels.modified} />
        {!compact && (
          <Box sx={{ px: 1, height: 32, display: 'flex', alignItems: 'center', fontSize: 12, fontWeight: 600, color: headText }}>
            {labels.perms}
          </Box>
        )}
        {showOwner && !compact && (
          <Box sx={{ px: 1, height: 32, display: 'flex', alignItems: 'center', fontSize: 12, fontWeight: 600, color: headText }}>
            {labels.owner}
          </Box>
        )}
      </Box>

      <Box
        ref={scrollRef}
        onScroll={handleScroll}
        onMouseDown={(e) => {
          if (e.target === e.currentTarget || (e.target as HTMLElement).dataset.emptyzone === '1') onEmptyClick();
        }}
        onContextMenu={(e) => {
          const target = e.target as HTMLElement;
          if (e.target === e.currentTarget || target.dataset.emptyzone === '1') {
            onBackgroundContextMenu?.(e);
          }
        }}
        sx={{ flex: 1, overflow: 'auto', minHeight: 0, position: 'relative' }}
      >
        <Box sx={{ height: entries.length * ROW_H, position: 'relative' }} data-emptyzone="1">
          <Box sx={{ position: 'absolute', top: range.start * ROW_H, left: 0, right: 0 }}>
            {visible.map((entry, i) => {
              const index = range.start + i;
              const isSelected = selected.has(entry.name);
              const isFocused = focused === entry.name;
              const hidden = isHiddenName(entry.name);
              const octal = permsToOctal(entry.perms);
              const isDropTarget = dropTargetName === entry.name;
              // Folder styling follows what the row *behaves* like, so a
              // symlinked folder reads as a folder instead of a 7-byte file.
              const navigable = isNavigable(entry);
              return (
                <Box
                  key={entry.name}
                  // Read back by the drag-drop hit test, which only gets screen
                  // coordinates from the OS and has to map them to a row.
                  data-entry-name={entry.name}
                  data-is-dir={navigable ? '1' : '0'}
                  onClick={(e) => onRowClick(entry, index, e)}
                  onDoubleClick={() => onRowDoubleClick(entry)}
                  onContextMenu={(e) => onRowContextMenu(entry, e)}
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: gridTemplate,
                    alignItems: 'center',
                    height: ROW_H,
                    cursor: 'default',
                    userSelect: 'none',
                    bgcolor: isDropTarget ? dropBg : isSelected ? selBg : 'transparent',
                    boxShadow: isDropTarget
                      ? `inset 0 0 0 2px ${dropRing}`
                      : isFocused
                        ? `inset 0 0 0 1px ${focusRing}`
                        : 'none',
                    opacity: hidden && !isSelected ? 0.62 : 1,
                    transition: 'background-color 120ms ease',
                    '&:hover': { bgcolor: isSelected ? selBg : hoverBg },
                  }}
                >
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.9, px: 1, minWidth: 0 }}>
                    <Box sx={{ display: 'flex', flexShrink: 0 }}>
                      <KindIcon entry={entry} size={17} color={navigable ? dirColor : subtle} />
                    </Box>
                    <Tooltip
                      title={
                        entry.link_target
                          ? `${entry.name} ${labels.linkTo} ${entry.link_target}`
                          : `${entry.name}${entry.owner ? `  ·  ${entry.owner}:${entry.group}` : ''}`
                      }
                      enterDelay={600}
                      placement="bottom-start"
                    >
                      <Box
                        component="span"
                        sx={{
                          fontSize: 13,
                          color: navigable ? (isDark ? '#E6EDF3' : '#1F2328') : bodyText,
                          fontWeight: navigable ? 500 : 400,
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {entry.name}
                      </Box>
                    </Tooltip>
                    {entry.is_symlink && (
                      <Box sx={{ display: 'flex', flexShrink: 0, color: subtle }}>
                        <LinkSimpleIcon size={12} />
                      </Box>
                    )}
                  </Box>

                  <Box
                    sx={{
                      px: 1,
                      textAlign: 'right',
                      fontSize: 12,
                      color: subtle,
                      fontVariantNumeric: 'tabular-nums',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {navigable ? '—' : formatSize(entry.size)}
                  </Box>

                  <Box
                    sx={{
                      px: 1,
                      fontSize: 12,
                      color: subtle,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {entry.mtime || '—'}
                  </Box>

                  {!compact && (
                    <Tooltip title={entry.perms} enterDelay={500}>
                      <Box
                        sx={{
                          px: 1,
                          fontSize: 11.5,
                          color: subtle,
                          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {octal || entry.perms}
                      </Box>
                    </Tooltip>
                  )}

                  {showOwner && !compact && (
                    <Tooltip
                      title={`${entry.owner || '-'}:${entry.group || '-'}`}
                      enterDelay={500}
                    >
                      <Box
                        sx={{
                          px: 1,
                          fontSize: 11.5,
                          color: subtle,
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {entry.owner || '-'}
                      </Box>
                    </Tooltip>
                  )}
                </Box>
              );
            })}
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
