import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { useLicenseStore } from './licenseStore';

interface LicenseContextValue {
  /// Force-refresh the license status from the backend.
  refresh: () => Promise<void>;
}

const LicenseContext = createContext<LicenseContextValue | null>(null);

/// Top-level provider that bootstraps the license status on app startup.
/// Place this high in the tree (e.g. inside AppTheme) so that all feature
/// gates and the upgrade dialog have access to the latest status.
export function LicenseProvider({ children }: { children: ReactNode }) {
  const refresh = useLicenseStore((s) => s.refresh);

  useEffect(() => {
    // Fetch the license status once on mount. Errors are handled inside the
    // store (it falls back to a default free-tier status).
    refresh().catch(() => {
      /* swallowed: store already recorded the error */
    });
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
