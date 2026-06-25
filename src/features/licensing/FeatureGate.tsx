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
export function FeatureGate({
  feature,
  children,
  fallback,
}: FeatureGateProps) {
  const canUse = useLicenseStore((s) => s.canUse);

  if (canUse(feature)) {
    return <>{children}</>;
  }

  if (fallback !== undefined) {
    return <>{fallback}</>;
  }

  return null;
}
