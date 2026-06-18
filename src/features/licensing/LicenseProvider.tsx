import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useLicenseStore } from './licenseStore';

interface LicenseContextValue {
  /// Force-refresh the license status from the backend.
  refresh: () => Promise<void>;
}

const LicenseContext = createContext<LicenseContextValue | null>(null);

/// Top-level provider that bootstraps the license status on app startup
/// and re-fetches it whenever the main window regains focus. This ensures
/// that purchases completed in the Microsoft Store popup (a separate
/// system-level surface) are reflected immediately when the user comes
/// back to the app.
export function LicenseProvider({ children }: { children: ReactNode }) {
  const refresh = useLicenseStore((s) => s.refresh);

  useEffect(() => {
    // 1) Initial fetch on mount.
    refresh().catch(() => {
      /* swallowed: store already recorded the error */
    });

    // 2) Refresh when the window regains focus. 使用 Tauri 的 window event
    //    而不是浏览器 `focus` 事件，能更可靠地捕捉到从 Store 弹窗返回的场景。
    let unlisten: (() => void) | null = null;
    let cancelled = false;
    (async () => {
      try {
        const win = getCurrentWindow();
        const handler = await win.onFocusChanged(({ payload: focused }) => {
          if (focused) {
            refresh().catch(() => {
              /* swallowed */
            });
          }
        });
        if (cancelled) {
          handler();
        } else {
          unlisten = handler;
        }
      } catch {
        // 非 Tauri 环境（例如纯浏览器调试）忽略。
      }
    })();

    return () => {
      cancelled = true;
      if (unlisten) {
        unlisten();
      }
    };
  }, [refresh]);

  const value = useMemo<LicenseContextValue>(() => ({ refresh }), [refresh]);

  return <LicenseContext.Provider value={value}>{children}</LicenseContext.Provider>;
}

export function useLicenseContext(): LicenseContextValue {
  const ctx = useContext(LicenseContext);
  if (!ctx) {
    throw new Error('useLicenseContext must be used within a LicenseProvider');
  }
  return ctx;
}
