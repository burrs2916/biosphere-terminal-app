import { type ReactNode, useCallback } from 'react';
import type { ProFeature } from '../../proto/licensing';
import { useLicenseStore } from './licenseStore';
import { useUpgradeDialogStore } from './upgradeDialogStore';

interface FeatureGateProps {
  feature: ProFeature;
  /// Content to render when the feature is unlocked (Pro or trial).
  children: ReactNode;
  /// Optional fallback rendered when the feature is locked. When omitted and
  /// the feature is locked, the gate renders nothing and opens the upgrade
  /// dialog instead.
  fallback?: ReactNode;
  /// When true (default), clicking a locked gate opens the upgrade dialog.
  /// Set to false to render the fallback silently.
  showUpgradeOnLock?: boolean;
}

/// Conditionally renders children based on the current license status.
///
/// - Pro users: always render children.
/// - Trial users: always render children (trial = full access).
/// - Free / expired users: render `fallback` if provided, otherwise render
///   nothing and open the upgrade dialog.
export function FeatureGate({
  feature,
  children,
  fallback,
  showUpgradeOnLock = true,
}: FeatureGateProps) {
  const canUse = useLicenseStore((s) => s.canUse);
  const openUpgrade = useUpgradeDialogStore((s) => s.openDialog);

  const handleLocked = useCallback(() => {
    if (showUpgradeOnLock) {
      openUpgrade(feature);
    }
  }, [feature, openUpgrade, showUpgradeOnLock]);

  if (canUse(feature)) {
    return <>{children}</>;
  }

  if (fallback !== undefined) {
    return <>{fallback}</>;
  }

  // No fallback: render an invisible placeholder that opens the upgrade
  // dialog when clicked. This lets us wrap disabled UI elements without
  // removing them from the layout.
  return (
    <div
      onClick={handleLocked}
      style={{
        cursor: showUpgradeOnLock ? 'pointer' : 'default',
        display: 'contents',
      }}
      aria-disabled="true"
      data-feature-gate={feature}
    >
      {null}
    </div>
  );
}
