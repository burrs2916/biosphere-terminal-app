import React, { createContext, useContext, useState, useCallback, useMemo, useEffect, useRef } from 'react';
import Box from '@mui/material/Box';
import Alert from '@mui/material/Alert';
import IconButton from '@mui/material/IconButton';
import Grow from '@mui/material/Grow';
import { XIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@mui/material/styles';

type Severity = 'success' | 'error' | 'warning' | 'info';

interface ToastItem {
  id: number;
  message: string;
  severity: Severity;
  /** Total display time (ms) for this item. */
  duration: number;
  /** Remaining time (ms); decremented by the heartbeat unless paused. */
  remaining: number;
  /** Timestamp (ms) when this toast was created — used to drop stale queued items. */
  createdAt: number;
}

interface ToastState {
  /** At most MAX_VISIBLE on screen; the rest wait in `pending`. */
  visible: ToastItem[];
  pending: ToastItem[];
}

interface NotificationContextValue {
  notify: (message: string, severity?: Severity) => void;
}

const NotificationContext = createContext<NotificationContextValue>({
  notify: () => {},
});

export function useNotify() {
  return useContext(NotificationContext);
}

/** Hard cap on simultaneously displayed toasts; extra ones queue up. */
const MAX_VISIBLE = 3;
/** Identical message+severity within this window is dropped (no spam loops). */
const DEDUPE_WINDOW = 5000;
/** Heartbeat granularity for the countdown / progress bar. */
const TICK_MS = 200;
/** A queued toast older than this when a slot frees up is dropped — never
 *  surface a stale "past event" popup seconds after the fact. */
const STALE_TOAST_MS = 2500;

function durationFor(severity: Severity): number {
  // Failures deserve more reading time than routine confirmations.
  return severity === 'error' || severity === 'warning' ? 8000 : 5000;
}

/**
 * Desktop-grade notification layer (L2 in the feedback pyramid).
 *
 * Replaces the old single-slot toast, which dropped messages (a new notify
 * overwrote the previous one before it was read) and covered the status bars
 * from the bottom-center. This version:
 * - queues toasts (max 3 stacked, extras wait their turn instead of being lost)
 * - anchors top-right, clear of the header, sidebar and both status bars
 * - auto-dismisses with a per-item countdown, pauses while hovered
 * - de-duplicates identical messages within 5s (flapping retries must not spam)
 * - keeps errors/warnings on screen twice as long as success/info
 *
 * The `notify(message, severity)` signature is unchanged, so all existing
 * call sites keep working untouched.
 */
export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation('common');
  const theme = useTheme();
  const [state, setState] = useState<ToastState>({ visible: [], pending: [] });
  // Hovering the stack pauses every countdown (manual pause beats per-item
  // timer bookkeeping and matches how users read stacked notifications).
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  pausedRef.current = paused;
  const nextIdRef = useRef(1);
  // Last-shown timestamps for de-duplication, keyed by `severity:message`.
  const recentRef = useRef<Map<string, number>>(new Map());

  const notify = useCallback((message: string, severity: Severity = 'info') => {
    const now = Date.now();
    const key = `${severity}:${message}`;
    const recent = recentRef.current;
    const lastAt = recent.get(key);
    if (lastAt !== undefined && now - lastAt < DEDUPE_WINDOW) return;
    recent.set(key, now);
    // Keep the map bounded: drop fully aged entries whenever it grows large.
    if (recent.size > 64) {
      for (const [k, at] of recent) {
        if (now - at >= DEDUPE_WINDOW) recent.delete(k);
      }
    }
    const duration = durationFor(severity);
    const item: ToastItem = { id: nextIdRef.current++, message, severity, duration, remaining: duration, createdAt: now };
    setState((s) =>
      s.visible.length < MAX_VISIBLE
        ? { visible: [...s.visible, item], pending: s.pending }
        : { visible: s.visible, pending: [...s.pending, item] },
    );
  }, []);

  const dismiss = useCallback((id: number) => {
    setState((s) => {
      if (!s.visible.some((v) => v.id === id)) return s;
      const kept = s.visible.filter((v) => v.id !== id);
      const room = MAX_VISIBLE - kept.length;
      const now = Date.now();
      const fresh = s.pending.filter((p) => now - p.createdAt <= STALE_TOAST_MS);
      const promoted = fresh.slice(0, room);
      return {
        visible: [...kept, ...promoted],
        pending: fresh.slice(room),
      };
    });
  }, []);

  // Single heartbeat drives every countdown; it only runs while toasts exist.
  useEffect(() => {
    if (state.visible.length === 0) return;
    const timer = setInterval(() => {
      if (pausedRef.current) return;
      setState((s) => {
        const kept: ToastItem[] = [];
        for (const item of s.visible) {
          const remaining = item.remaining - TICK_MS;
          if (remaining > 0) kept.push({ ...item, remaining });
        }
        if (kept.length === s.visible.length && kept.every((k, i) => k.remaining === s.visible[i].remaining)) {
          return s; // nothing changed — keep referential identity
        }
        const room = MAX_VISIBLE - kept.length;
        const now = Date.now();
        const fresh = s.pending.filter((p) => now - p.createdAt <= STALE_TOAST_MS);
        const promoted = fresh.slice(0, room);
        return {
          visible: [...kept, ...promoted],
          pending: fresh.slice(room),
        };
      });
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [state.visible.length]);

  // The context value must stay referentially stable: an inline `{{ notify }}`
  // would re-render every `useNotify()` consumer on each toast show/dismiss.
  const value = useMemo<NotificationContextValue>(() => ({ notify }), [notify]);

  const progressColor = (severity: Severity): string =>
    severity === 'error'
      ? theme.palette.error.main
      : severity === 'warning'
        ? theme.palette.warning.main
        : severity === 'success'
          ? theme.palette.success.main
          : theme.palette.info.main;

  return (
    <NotificationContext.Provider value={value}>
      {children}
      {state.visible.length > 0 && (
        <Box
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
          sx={{
            position: 'fixed',
            // Below the fixed 48px header (+12px gap), clear of both status bars.
            top: 60,
            right: 16,
            zIndex: theme.zIndex.snackbar,
            display: 'flex',
            flexDirection: 'column',
            gap: 1,
            width: 360,
            maxWidth: 'calc(100vw - 32px)',
          }}
        >
          {state.visible.map((item) => (
            <Grow in key={item.id}>
              <Box
                sx={{
                  position: 'relative',
                  borderRadius: 1.5,
                  overflow: 'hidden',
                  boxShadow: theme.shadows[3],
                }}
              >
                <Alert
                  severity={item.severity}
                  variant="standard"
                  sx={{
                    width: '100%',
                    alignItems: 'center',
                    fontSize: 13,
                    pr: 5,
                    '& .MuiAlert-message': { py: 0.25 },
                  }}
                  action={
                    <IconButton
                      size="small"
                      aria-label={t('action.close')}
                      onClick={() => dismiss(item.id)}
                      sx={{ position: 'absolute', top: 6, right: 6, p: 0.5, color: 'text.secondary' }}
                    >
                      <XIcon size={14} />
                    </IconButton>
                  }
                >
                  {item.message}
                </Alert>
                {/* Countdown progress bar — freezes on hover with the stack. */}
                <Box sx={{ height: 2, bgcolor: 'action.disabledBackground' }}>
                  <Box
                    sx={{
                      height: '100%',
                      width: `${(item.remaining / item.duration) * 100}%`,
                      bgcolor: progressColor(item.severity),
                      transition: `width ${TICK_MS}ms linear`,
                    }}
                  />
                </Box>
              </Box>
            </Grow>
          ))}
        </Box>
      )}
    </NotificationContext.Provider>
  );
}
