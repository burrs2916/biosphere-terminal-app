import { create } from 'zustand';
import type { LicenseStatus, ProFeature } from '../../proto/licensing';
import { checkProStatus, purchaseProLifetime, restoreProLicense, resetLicense } from '../../core/services/licensing.service';

/// All Pro features gated by the license system. Keep in sync with
/// `ProFeature` in `proto/licensing.ts`.
///
/// 商业模式：试用期 14 天内全部开放，试用结束后需 $9.99 一次性买断解锁。
export const PRO_FEATURES: ProFeature[] = [
  'remote_desktop',
  'plugin_workshop',
  'ai_copilot',
  'note_ai_optimize',
  'note_reference',
];

/// Human-readable labels for each Pro feature, used in the upgrade dialog.
export const PRO_FEATURE_LABELS: Record<ProFeature, string> = {
  remote_desktop: 'Remote desktop (VNC)',
  plugin_workshop: 'Plugin workshop',
  ai_copilot: 'AI Copilot & Agent chat',
  note_ai_optimize: 'AI-powered note optimization',
  note_reference: 'AI note references & command linking',
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
  /// Clear the last error. Used when closing the upgrade dialog to avoid
  /// showing stale errors on the next open.
  clearError: () => void;
  /// Convenience selector: is the user allowed to use a Pro feature?
  canUse: (feature: ProFeature) => boolean;
}

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
      // 保留原有 status，不重置为 DEFAULT_STATUS。
      // 重置会导致 Pro/Trial 用户在后端调用失败时被误判为 free，
      // 启动时出现 LockedScreen 闪烁。error 仍被记录供 UI 显示。
      set({ loading: false, error: message });
    }
  },

  purchase: async () => {
    set({ loading: true, error: null });
    try {
      // 调用后端，由 Rust 侧通过 Windows.Services.Store API 触发真实购买。
      // 用户在 Store 弹窗中支付完成后，后端会复核 entitlement 再返回 Pro 状态。
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

  clearError: () => {
    set({ error: null });
  },

  canUse: (feature: ProFeature) => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    void feature;
    const status = get().status;
    // 启动初期 status 还在加载（异步从后端拉取）。这段时间内（通常 < 200ms）
    // 我们 **乐观放行** —— 否则刚启动应用的 trial / pro 用户会看到 LockedScreen
    // 闪烁一下再变正常，体验非常糟糕。
    // 真正的拦截发生在 status 加载完成后，由 React 自动重渲染收紧权限。
    if (!status) return true;
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
