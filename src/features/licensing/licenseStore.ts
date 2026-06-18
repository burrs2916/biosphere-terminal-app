import { create } from 'zustand';
import type { LicenseStatus, ProFeature } from '../../proto/licensing';
import { checkProStatus, purchaseProLifetime, restoreProLicense, resetLicense } from '../../core/services/licensing.service';

/// All Pro features gated by the license system. Keep in sync with
/// `ProFeature` in `proto/licensing.ts`.
export const PRO_FEATURES: ProFeature[] = [
  'unlimited_ssh',
  'unlimited_notes',
  'ai_assistant',
  'remote_desktop',
  'plugin_workshop',
  'sync_settings',
];

/// Human-readable labels for each Pro feature, used in the upgrade dialog.
export const PRO_FEATURE_LABELS: Record<ProFeature, string> = {
  unlimited_ssh: 'Unlimited SSH connections',
  unlimited_notes: 'Unlimited notes & notebooks',
  ai_assistant: 'AI assistant (unlimited messages)',
  remote_desktop: 'Remote desktop (VNC)',
  plugin_workshop: 'Plugin workshop',
  sync_settings: 'Cloud settings sync',
};

interface LicenseState {
  status: LicenseStatus | null;
  loading: boolean;
  error: string | null;
  /// Fetch the latest status from the backend.
  refresh: () => Promise<void>;
  /// Trigger the purchase flow. On Windows this calls the Store IAP API;
  /// on other platforms it falls back to a manual unlock for testing.
  purchase: () => Promise<void>;
  /// Restore previous purchases.
  restore: () => Promise<void>;
  /// Reset the license state (development/testing only).
  reset: () => Promise<void>;
  /// Convenience selector: is the user allowed to use a Pro feature?
  canUse: (feature: ProFeature) => boolean;
}

const DEFAULT_STATUS: LicenseStatus = {
  tier: 'free',
  isPro: false,
  isTrial: false,
  isExpired: false,
  trialDaysRemaining: 0,
  trialStartedAt: null,
  trialExpiresAt: null,
  proUnlockedAt: null,
  reason: 'Not initialized',
};

export const useLicenseStore = create<LicenseState>((set, get) => ({
  status: null,
  loading: false,
  error: null,

  refresh: async () => {
    set({ loading: true, error: null });
    try {
      const status = await checkProStatus();
      set({ status, loading: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      set({ loading: false, error: message });
      // Fall back to a default status so the UI can still render.
      set({ status: DEFAULT_STATUS });
    }
  },

  purchase: async () => {
    set({ loading: true, error: null });
    try {
      // On Windows, the frontend would first call the Store IAP API and
      // pass the resulting order ID here. For now we record a local unlock
      // so the flow works on all platforms during development.
      const status = await purchaseProLifetime();
      set({ status, loading: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      set({ loading: false, error: message });
      throw err;
    }
  },

  restore: async () => {
    set({ loading: true, error: null });
    try {
      const status = await restoreProLicense();
      set({ status, loading: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      set({ loading: false, error: message });
      throw err;
    }
  },

  reset: async () => {
    set({ loading: true, error: null });
    try {
      const status = await resetLicense();
      set({ status, loading: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      set({ loading: false, error: message });
      throw err;
    }
  },

  canUse: (feature: ProFeature) => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    void feature;
    const status = get().status;
    if (!status) return false;
    // Pro users can use everything.
    if (status.isPro) return true;
    // During the trial, all Pro features are unlocked.
    if (status.isTrial) return true;
    // Free / expired users: nothing is unlocked.
    // Note: feature-specific limits (e.g. 3 SSH connections) are enforced
    // at the call site, not here.
    return false;
  },
}));
