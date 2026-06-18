use crate::app::licensing::{LicenseStatus, LicensingService, PRO_LIFETIME_PRODUCT_ID};
use tauri::State;
use std::sync::Arc;

/// Return the current license status (trial / free / pro).
#[tauri::command]
pub async fn check_pro_status(
    service: State<'_, Arc<LicensingService>>,
) -> Result<LicenseStatus, String> {
    Ok(service.status().await)
}

/// Mark the Pro license as unlocked. Called by the frontend after a
/// successful Microsoft Store in-app purchase, or after a license key is
/// validated. The optional `storeOrderId` is recorded for restore flows.
#[tauri::command]
pub async fn purchase_pro_lifetime(
    store_order_id: Option<String>,
    license_key: Option<String>,
    service: State<'_, Arc<LicensingService>>,
) -> Result<LicenseStatus, String> {
    service.unlock_pro(store_order_id, license_key).await
}

/// Restore previous purchases. On Windows this is typically preceded by a
/// call to the Windows.Services.Store API to query the user's entitlements;
/// if no entitlement is found the frontend should call this with `None` to
/// reset to the trial/free state.
#[tauri::command]
pub async fn restore_pro_license(
    store_order_id: Option<String>,
    license_key: Option<String>,
    service: State<'_, Arc<LicensingService>>,
) -> Result<LicenseStatus, String> {
    match (store_order_id.as_ref(), license_key.as_ref()) {
        (Some(_), _) | (_, Some(_)) => {
            service.unlock_pro(store_order_id, license_key).await
        }
        (None, None) => {
            // No entitlement found: reset to trial/free.
            service.reset().await
        }
    }
}

/// Reset the license state. Intended for development/testing and for the
/// "deactivate this device" flow.
#[tauri::command]
pub async fn reset_license(
    service: State<'_, Arc<LicensingService>>,
) -> Result<LicenseStatus, String> {
    service.reset().await
}

/// Extend the trial by a given number of days. Intended for promotional
/// campaigns or support-granted extensions.
#[tauri::command]
pub async fn extend_trial(
    days: i64,
    service: State<'_, Arc<LicensingService>>,
) -> Result<LicenseStatus, String> {
    service.extend_trial(days).await
}

/// Return the configured Microsoft Store product ID for the Pro lifetime
/// add-on. The frontend uses this when calling the Store IAP API.
#[tauri::command]
pub fn get_pro_product_id() -> String {
    PRO_LIFETIME_PRODUCT_ID.to_string()
}
