import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { listen } from '@tauri-apps/api/event';
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
  // 使用 getState().refresh 稳定引用，避免 store 重建时 refresh 变化
  // 导致 useEffect 重新执行。refresh 内部已有 in-flight 去重。
  const refreshRef = useRef(useLicenseStore.getState().refresh);
  refreshRef.current = useLicenseStore.getState().refresh;

  useEffect(() => {
    // 1) Initial fetch on mount.
    refreshRef.current().catch(() => {
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
            refreshRef.current().catch(() => {
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

    // 3) 监听后端 `license-changed` 事件。
    //    后端 sync_with_store 在自动解锁 Pro 后会 emit 这条事件，
    //    我们立刻 refresh() 把最新 LicenseStatus 拉进 store，
    //    UI 中的 trial 提示 / 功能门禁会同步刷新，用户无需重启或手动 Restore。
    let unlistenLicense: (() => void) | null = null;
    (async () => {
      try {
        const handler = await listen('license-changed', () => {
          refreshRef.current().catch(() => {
            /* swallowed */
          });
        });
        if (cancelled) {
          handler();
        } else {
          unlistenLicense = handler;
        }
      } catch {
        /* 非 Tauri 环境忽略 */
      }
    })();

    return () => {
      cancelled = true;
      if (unlisten) {
        unlisten();
      }
      if (unlistenLicense) {
        unlistenLicense();
      }
    };
  }, []);

  const value = useMemo<LicenseContextValue>(() => ({
    refresh: () => refreshRef.current(),
  }), []);

  return <LicenseContext.Provider value={value}>{children}</LicenseContext.Provider>;
}

export function useLicenseContext(): LicenseContextValue {
  const ctx = useContext(LicenseContext);
  if (!ctx) {
    throw new Error('useLicenseContext must be used within a LicenseProvider');
  }
  return ctx;
}
