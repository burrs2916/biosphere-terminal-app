import { create } from 'zustand';
import type { LicenseStatus, ProFeature } from '../../proto/licensing';
import { checkProStatus, purchaseProLifetime, restoreProLicense, resetLicense } from '../../core/services/licensing.service';
import { localizeBackendError } from '../../core/backendError';

/// All Pro features gated by the license system. Keep in sync with
/// `ProFeature` in `proto/licensing.ts`.
///
/// 商业模式：试用期 14 天内全部开放，试用结束后需 $9.99 一次性买断解锁。
export const PRO_FEATURES: ProFeature[] = [
  'remote_desktop',
  'sftp',
  'ai_copilot',
  'note_ai_optimize',
  'note_reference',
];

/// Human-readable labels for each Pro feature, used in the upgrade dialog.
export const PRO_FEATURE_LABELS: Record<ProFeature, string> = {
  remote_desktop: 'Remote desktop (VNC)',
  sftp: 'SFTP file transfer',
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

/// Module-level in-flight marker for refresh(). 防止快速切换窗口时
/// 多个并发 refresh 请求产生竞态（后到的旧响应覆盖新响应）。
/// 放在模块作用域而非 store state，避免触发不必要的重渲染。
let refreshInFlight: Promise<void> | null = null;

/// 记录是否已经至少尝试过一次加载 status。
/// canUse 在 status === null 时乐观放行以避免启动闪烁，
/// 但若后端持续故障，我们需要在尝试加载后回退到保守拒绝，
/// 防止 Pro 功能永久免费开放。
let refreshAttempted = false;

/// purchase 进行中标记。防止 Store 弹窗关闭后窗口聚焦触发 refresh，
/// 用旧状态覆盖刚写入的 Pro 状态。
let purchaseInProgress = false;

export const useLicenseStore = create<LicenseState>((set, get) => ({
  status: null,
  loading: false,
  error: null,

  refresh: async () => {
    // 购买进行中时跳过 refresh，避免用旧状态覆盖刚写入的 Pro 状态。
    if (purchaseInProgress) return;
    // 如果已有 refresh 在进行中，复用同一个 Promise，避免并发竞态。
    if (refreshInFlight) {
      return refreshInFlight;
    }
    const run = async () => {
      set({ loading: true });
      try {
        const status = await checkProStatus();
        set({ status, loading: false });
      } catch (err) {
        // refresh 是后台静默操作（启动、窗口聚焦时触发），不应把错误
        // 写入 error 字段——UpgradeDialog 读取同一个 error 来显示购买/
        // 恢复操作的失败信息，后台 refresh 失败会让用户误以为购买失败。
        // 保留原有 status，仅记录 loading=false。
        const message = err instanceof Error ? err.message : localizeBackendError(err);
        console.warn('[license] refresh failed:', message);
        set({ loading: false });
      } finally {
        // 标记已尝试加载，后续 canUse 不再乐观放行。
        refreshAttempted = true;
      }
    };
    refreshInFlight = run().finally(() => {
      refreshInFlight = null;
    });
    return refreshInFlight;
  },

  purchase: async () => {
    purchaseInProgress = true;
    set({ loading: true, error: null });
    try {
      const status = await purchaseProLifetime();
      set({ status, loading: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : localizeBackendError(err);
      set({ loading: false, error: message });
      throw err;
    } finally {
      purchaseInProgress = false;
    }
  },

  restore: async () => {
    set({ loading: true, error: null });
    try {
      const status = await restoreProLicense();
      set({ status, loading: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : localizeBackendError(err);
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
      const message = err instanceof Error ? err.message : localizeBackendError(err);
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
    if (!status) {
      // 若已经尝试过加载但仍无 status（后端持续故障），回退到保守拒绝，
      // 防止 Pro 功能永久免费开放。首次加载期间（refreshAttempted=false）仍乐观放行。
      return !refreshAttempted;
    }
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
