/// License tier reported by the backend.
export type LicenseTier = 'trial' | 'free' | 'pro';

export interface LicenseStatus {
  tier: LicenseTier;
  isPro: boolean;
  isTrial: boolean;
  isExpired: boolean;
  trialDaysRemaining: number;
  trialStartedAt: string | null;
  trialExpiresAt: string | null;
  proUnlockedAt: string | null;
  reason: string;
}

/// Pro feature identifiers used by FeatureGate. Keep these in sync with the
/// `PRO_FEATURES` list in `licenseStore.ts`.
export type ProFeature =
  | 'unlimited_ssh'
  | 'unlimited_notes'
  | 'ai_assistant'
  | 'remote_desktop'
  | 'plugin_workshop'
  | 'sync_settings';

/// Free-tier limits enforced client-side. These mirror the limits documented
/// in the upgrade dialog and the Microsoft Store listing.
export interface FreeTierLimits {
  maxSshConnections: number;
  maxNotes: number;
  maxAiMessagesPerDay: number;
  remoteDesktopEnabled: boolean;
  pluginWorkshopEnabled: boolean;
  syncSettingsEnabled: boolean;
}

export const FREE_TIER_LIMITS: FreeTierLimits = {
  maxSshConnections: 3,
  maxNotes: 20,
  maxAiMessagesPerDay: 10,
  remoteDesktopEnabled: false,
  pluginWorkshopEnabled: false,
  syncSettingsEnabled: false,
};
