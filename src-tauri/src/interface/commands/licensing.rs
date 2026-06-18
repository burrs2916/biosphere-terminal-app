use crate::app::licensing::{LicenseStatus, LicensingService, PRO_LIFETIME_PRODUCT_ID};
use std::sync::Arc;
use tauri::State;

/// Return the current license status (trial / free / pro).
#[tauri::command]
pub async fn check_pro_status(
    service: State<'_, Arc<LicensingService>>,
) -> Result<LicenseStatus, String> {
    Ok(service.status().await)
}

/// 触发真实的 Microsoft Store 购买流程。
///
/// 流程：
/// 1. 通过 `Windows.Services.Store.StoreContext::RequestPurchaseAsync` 弹出
///    Store 购买对话框；
/// 2. 用户支付完成后，再调用 `verify_pro_entitlement` 复核 Store 端
///    entitlement 是否真实生效；
/// 3. 双重确认通过后才把本地状态标记为 Pro。
///
/// 在非 Windows 平台或没有 Package Identity 的开发环境，调用会返回错误，
/// 前端应当显示"请通过 Microsoft Store 安装"的提示。
#[tauri::command]
pub async fn purchase_pro_lifetime(
    service: State<'_, Arc<LicensingService>>,
) -> Result<LicenseStatus, String> {
    #[cfg(target_os = "windows")]
    {
        use crate::app::licensing::windows_store;
        // Step 1: 弹出 Store 购买窗口
        let order_id = windows_store::request_purchase_pro_lifetime()
            .await
            .map_err(String::from)?;
        // Step 2: 复核 entitlement，避免因 Store 端尚未同步导致误判
        let owned = windows_store::verify_pro_entitlement()
            .await
            .map_err(String::from)?;
        if !owned {
            return Err(
                "Purchase reported success but entitlement is not yet active. \
                Please restart the app or click Restore Purchase in a moment."
                    .to_string(),
            );
        }
        // Step 3: 写入本地缓存
        service.unlock_pro(Some(order_id), None).await
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = service;
        Err("In-app purchases are only available on the Windows Microsoft Store build.".to_string())
    }
}

/// Restore previous purchases by querying Microsoft Store.
///
/// 真实流程：
/// 1. 调用 `verify_pro_entitlement` 查询当前 Microsoft 账号的 entitlement；
/// 2. 如果确实拥有 Pro add-on，则把本地状态标记为 Pro；
/// 3. 否则保留当前状态（不会清空已购买的本地缓存）。
#[tauri::command]
pub async fn restore_pro_license(
    service: State<'_, Arc<LicensingService>>,
) -> Result<LicenseStatus, String> {
    #[cfg(target_os = "windows")]
    {
        use crate::app::licensing::windows_store;
        let owned = windows_store::verify_pro_entitlement()
            .await
            .map_err(String::from)?;
        if owned {
            // 用 Store 标识写入本地缓存
            let order_id = format!(
                "store-restore:{}:{}",
                PRO_LIFETIME_PRODUCT_ID,
                chrono::Utc::now().to_rfc3339()
            );
            service.unlock_pro(Some(order_id), None).await
        } else {
            Err("No active Pro entitlement found on this Microsoft account.".to_string())
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = service;
        Err("Restore Purchase is only available on the Windows Microsoft Store build.".to_string())
    }
}

/// Reset the license state. Intended for development/testing only.
/// 仅在 debug 构建中暴露，生产环境调用直接返回错误。
#[tauri::command]
pub async fn reset_license(
    service: State<'_, Arc<LicensingService>>,
) -> Result<LicenseStatus, String> {
    #[cfg(debug_assertions)]
    {
        service.reset().await
    }
    #[cfg(not(debug_assertions))]
    {
        let _ = service;
        Err("reset_license is disabled in production builds.".to_string())
    }
}

/// Extend the trial by a given number of days. 仅在 debug 构建中暴露。
#[tauri::command]
pub async fn extend_trial(
    days: i64,
    service: State<'_, Arc<LicensingService>>,
) -> Result<LicenseStatus, String> {
    #[cfg(debug_assertions)]
    {
        service.extend_trial(days).await
    }
    #[cfg(not(debug_assertions))]
    {
        let _ = (days, service);
        Err("extend_trial is disabled in production builds.".to_string())
    }
}

/// Return the configured Microsoft Store product ID for the Pro lifetime
/// add-on. 前端用于在 Store 一览链接里直跳。
#[tauri::command]
pub fn get_pro_product_id() -> String {
    PRO_LIFETIME_PRODUCT_ID.to_string()
}
