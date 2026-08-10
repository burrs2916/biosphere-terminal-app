import Box from '@mui/material/Box';
import Collapse from '@mui/material/Collapse';
import IconButton from '@mui/material/IconButton';
import LinearProgress from '@mui/material/LinearProgress';
import Tooltip from '@mui/material/Tooltip';
import {
  ArrowClockwiseIcon,
  CaretDownIcon,
  CaretUpIcon,
  CheckCircleIcon,
  ClockIcon,
  DownloadIcon,
  PlayIcon,
  ProhibitIcon,
  StopCircleIcon,
  UploadIcon,
  XCircleIcon,
  XIcon,
} from '@phosphor-icons/react';

export interface TransferItem {
  id: string;
  kind: 'upload' | 'download';
  label: string;
  count: number;
  /** `queued` means waiting for the single transfer slot, nothing on the wire yet. */
  status: 'queued' | 'running' | 'done' | 'error' | 'cancelled';
  percent: number;
  currentFile?: string;
  /** Index (1-based) of the file currently on the wire, counted from progress ticks. */
  fileNo?: number;
  /** 1-based place in the waiting line, only set while `status` is `queued`. */
  queuePos?: number;
  rate?: string;
  eta?: string;
  error?: string;
  startedAt: number;
  /** Set when the queue still holds everything needed to replay this transfer. */
  retryable?: boolean;
  /** This attempt is continuing an interrupted one rather than starting over. */
  resuming?: boolean;
}

/** Transfers that are on the wire or waiting for their turn. */
export function isActiveTransfer(item: TransferItem): boolean {
  return item.status === 'running' || item.status === 'queued';
}

/**
 * "3/8" while the item count is known and still plausible, otherwise just the
 * running index — a recursive folder expands into more files than the caller
 * queued, and showing "12/1" would look broken.
 */
function fileCounter(item: TransferItem): string {
  if (!item.fileNo || item.status !== 'running') return '';
  if (item.count > 1 && item.fileNo <= item.count) return `${item.fileNo}/${item.count} · `;
  if (item.fileNo > 1) return `${item.fileNo} · `;
  return '';
}

interface TransferQueueProps {
  items: TransferItem[];
  collapsed: boolean;
  isDark: boolean;
  labels: {
    title: string;
    clear: string;
    done: string;
    failed: string;
    cancelled: string;
    cancel: string;
    collapse: string;
    expand: string;
    dismiss: string;
    retry: string;
    resume: string;
    resuming: string;
    queued: string;
    /** Takes a `pos` interpolation. */
    queuedAt: (pos: number) => string;
  };
  onToggle: () => void;
  onClearFinished: () => void;
  onDismiss: (id: string) => void;
  onCancel: (id: string) => void;
  /** `resume` continues the interrupted attempt instead of restarting it. */
  onRetry: (id: string, resume?: boolean) => void;
}

export function TransferQueue({
  items,
  collapsed,
  isDark,
  labels,
  onToggle,
  onClearFinished,
  onDismiss,
  onCancel,
  onRetry,
}: TransferQueueProps) {
  if (items.length === 0) return null;

  const active = items.filter(isActiveTransfer).length;
  const failed = items.filter((i) => i.status === 'error').length;
  const border = isDark ? 'rgba(240,246,252,0.10)' : 'rgba(27,31,36,0.12)';
  const bg = isDark ? '#12171D' : '#FBFCFD';
  const text = isDark ? '#C9D1D9' : '#24292F';
  const subtle = isDark ? '#7D8590' : '#6E7781';

  return (
    <Box sx={{ borderTop: `1px solid ${border}`, bgcolor: bg, flexShrink: 0 }}>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          px: 1.25,
          height: 34,
          cursor: 'pointer',
          userSelect: 'none',
        }}
        onClick={onToggle}
      >
        <Box sx={{ fontSize: 12.5, fontWeight: 600, color: text }}>
          {labels.title}
          <Box component="span" sx={{ ml: 0.75, fontWeight: 400, color: subtle }}>
            {active > 0 ? `${active} / ${items.length}` : `${items.length}`}
            {failed > 0 ? ` · ${failed} ${labels.failed}` : ''}
          </Box>
        </Box>
        <Box sx={{ flex: 1 }} />
        <Tooltip title={labels.clear}>
          <IconButton
            size="small"
            onClick={(e) => {
              e.stopPropagation();
              onClearFinished();
            }}
            sx={{ width: 24, height: 24 }}
          >
            <XIcon size={13} color={subtle} />
          </IconButton>
        </Tooltip>
        <Box sx={{ display: 'flex', color: subtle }}>
          {collapsed ? <CaretUpIcon size={13} /> : <CaretDownIcon size={13} />}
        </Box>
      </Box>

      <Collapse in={!collapsed}>
        <Box sx={{ maxHeight: 172, overflow: 'auto', px: 1.25, pb: 1 }}>
          {items.map((item) => (
            <Box key={item.id} sx={{ py: 0.6 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                <Box sx={{ display: 'flex', flexShrink: 0 }}>
                  {item.status === 'done' ? (
                    <CheckCircleIcon size={14} weight="fill" color={isDark ? '#3FB950' : '#1A7F37'} />
                  ) : item.status === 'error' ? (
                    <XCircleIcon size={14} weight="fill" color={isDark ? '#F85149' : '#CF222E'} />
                  ) : item.status === 'cancelled' ? (
                    <ProhibitIcon size={14} color={subtle} />
                  ) : item.status === 'queued' ? (
                    <ClockIcon size={14} color={subtle} />
                  ) : item.kind === 'upload' ? (
                    <UploadIcon size={14} color={isDark ? '#58A6FF' : '#0969DA'} />
                  ) : (
                    <DownloadIcon size={14} color={isDark ? '#3FB950' : '#1A7F37'} />
                  )}
                </Box>
                <Box
                  sx={{
                    fontSize: 12,
                    color: text,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    flex: 1,
                    minWidth: 0,
                  }}
                >
                  {item.currentFile && item.status === 'running' ? item.currentFile : item.label}
                </Box>
                <Box sx={{ fontSize: 11.5, color: subtle, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                  {/* Saying so matters: a resumed transfer can jump to a high
                      percentage or finish instantly, which looks like a bug
                      unless the row explains why. */}
                  {item.resuming && (item.status === 'running' || item.status === 'queued')
                    ? `${labels.resuming} · `
                    : ''}
                  {item.status === 'running'
                    ? `${fileCounter(item)}${item.percent}%${item.rate ? ` · ${item.rate}` : ''}${item.eta ? ` · ${item.eta}` : ''}`
                    : item.status === 'queued'
                      ? item.queuePos
                        ? labels.queuedAt(item.queuePos)
                        : labels.queued
                      : item.status === 'done'
                        ? labels.done
                        : item.status === 'cancelled'
                          ? labels.cancelled
                          : labels.failed}
                </Box>
                {isActiveTransfer(item) ? (
                  <Tooltip title={labels.cancel}>
                    <IconButton
                      size="small"
                      onClick={() => onCancel(item.id)}
                      sx={{ width: 20, height: 20 }}
                    >
                      <StopCircleIcon size={13} color={isDark ? '#F85149' : '#CF222E'} />
                    </IconButton>
                  </Tooltip>
                ) : (
                  <>
                    {/* Continuing is almost always what the user wants after a
                        dropped connection: the bytes already on the far side
                        stay put and only the remainder moves. Offered next to
                        a plain restart rather than instead of it, because a
                        transfer that failed for a *different* reason (a bad
                        source file) is better off starting clean. */}
                    {item.retryable && item.status !== 'done' && (
                      <Tooltip title={labels.resume}>
                        <IconButton
                          size="small"
                          onClick={() => onRetry(item.id, true)}
                          sx={{ width: 20, height: 20 }}
                        >
                          <PlayIcon size={12} weight="fill" color={isDark ? '#3FB950' : '#1A7F37'} />
                        </IconButton>
                      </Tooltip>
                    )}
                    {/* A dropped connection is the usual reason a transfer
                        fails, and re-picking the same files by hand is the
                        last thing the user wants to do about it. */}
                    {item.retryable && item.status !== 'done' && (
                      <Tooltip title={labels.retry}>
                        <IconButton
                          size="small"
                          onClick={() => onRetry(item.id)}
                          sx={{ width: 20, height: 20 }}
                        >
                          <ArrowClockwiseIcon size={12} color={isDark ? '#58A6FF' : '#0969DA'} />
                        </IconButton>
                      </Tooltip>
                    )}
                    <Tooltip title={labels.dismiss}>
                      <IconButton
                        size="small"
                        onClick={() => onDismiss(item.id)}
                        sx={{ width: 20, height: 20 }}
                      >
                        <XIcon size={11} color={subtle} />
                      </IconButton>
                    </Tooltip>
                  </>
                )}
              </Box>
              {/* A queued row gets a flat empty bar: an indeterminate sweep
                  there would claim work is happening when the transfer has
                  not even been handed to the backend yet. */}
              <LinearProgress
                variant={item.status === 'running' && item.percent === 0 ? 'indeterminate' : 'determinate'}
                value={item.status === 'running' ? item.percent : item.status === 'queued' ? 0 : 100}
                color={
                  item.status === 'error'
                    ? 'error'
                    : item.status === 'done'
                      ? 'success'
                      : item.status === 'cancelled'
                        ? 'inherit'
                        : 'primary'
                }
                sx={{
                  height: 3,
                  borderRadius: 2,
                  mt: 0.4,
                  opacity: item.status === 'cancelled' || item.status === 'queued' ? 0.45 : 1,
                }}
              />
              {item.status === 'error' && item.error && (
                <Box sx={{ fontSize: 11, color: isDark ? '#F85149' : '#CF222E', mt: 0.35, pl: 2.5 }}>
                  {item.error}
                </Box>
              )}
            </Box>
          ))}
        </Box>
      </Collapse>
    </Box>
  );
}
