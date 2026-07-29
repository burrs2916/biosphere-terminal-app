import { type ReactNode } from 'react';
import type { ProFeature } from '../../proto/licensing';
import { useLicenseStore } from './licenseStore';

interface FeatureGateProps {
  feature: ProFeature;
  /// Content to render when the feature is unlocked (Pro or trial).
  children: ReactNode;
  /// Optional fallback rendered when the feature is locked. When omitted and
  /// the feature is locked, the gate renders nothing.
  fallback?: ReactNode;
  /// Unused after refactor. Kept for API compatibility.
  showUpgradeOnLock?: boolean;
}

/// Conditionally renders children based on the current license status.
///
/// - Pro users: always render children.
/// - Trial users: always render children (trial = full access).
/// - Free / expired users: render `fallback` if provided, otherwise render
///   nothing.
///
/// **订阅注意**：必须 selector 选 `s.status`（对象引用，每次 set 都变），
/// 不能选 `s.canUse`（函数引用，恒定不变，会导致 status 变化时本组件
/// 永远不重渲染——是已修复的 P1-3 bug 的复发点）。`useFeatureGate` hook
/// 走 `s.status` 订阅是正确做法，本组件须保持一致。
export function FeatureGate({
  feature,
  children,
  fallback,
}: FeatureGateProps) {
  // 订阅 status 对象本身（不是 canUse 函数），保证付费/试用状态变化时
  // 组件会重新评估，避免 P1-3 那类"买了 Pro 但 UI 仍是 LockedScreen"的死代码陷阱。
  const status = useLicenseStore((s) => s.status);
  const canUse = useLicenseStore((s) => s.canUse);
  // status 作为依赖项触发重渲染；功能判断仍走 canUse
  void status;

  if (canUse(feature)) {
    return <>{children}</>;
  }

  if (fallback !== undefined) {
    return <>{fallback}</>;
  }

  return null;
}
