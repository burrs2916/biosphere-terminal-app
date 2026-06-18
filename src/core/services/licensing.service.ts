import { invoke } from '@tauri-apps/api/core';
import type { LicenseStatus } from '../../proto/licensing';

/// Fetch the current license status from the backend.
export async function checkProStatus(): Promise<LicenseStatus> {
  return invoke<LicenseStatus>('check_pro_status');
}

/// Mark the Pro license as unlocked after a successful Store IAP flow or
/// license-key activation.
export async function purchaseProLifetime(
  storeOrderId?: string,
  licenseKey?: string,
): Promise<LicenseStatus> {
  return invoke<LicenseStatus>('purchase_pro_lifetime', {
    storeOrderId: storeOrderId ?? null,
    licenseKey: licenseKey ?? null,
  });
}

/// Restore previous purchases. Pass `undefined` for both arguments to reset
/// to the trial/free state when no Store entitlement is found.
export async function restoreProLicense(
  storeOrderId?: string,
  licenseKey?: string,
): Promise<LicenseStatus> {
  return invoke<LicenseStatus>('restore_pro_license', {
    storeOrderId: storeOrderId ?? null,
    licenseKey: licenseKey ?? null,
  });
}

/// Reset the license state. Intended for development/testing and the
/// "deactivate this device" flow.
export async function resetLicense(): Promise<LicenseStatus> {
  return invoke<LicenseStatus>('reset_license');
}

/// Extend the trial by a given number of days.
export async function extendTrial(days: number): Promise<LicenseStatus> {
  return invoke<LicenseStatus>('extend_trial', { days });
}

/// Return the configured Microsoft Store product ID for the Pro lifetime
/// add-on. Used by the frontend when calling the Store IAP API.
export async function getProProductId(): Promise<string> {
  return invoke<string>('get_pro_product_id');
}
