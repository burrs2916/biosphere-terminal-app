use crate::app::licensing::{LicenseStatus, LicensingService, PRO_LIFETIME_PRODUCT_ID};
use std::sync::Arc;
use tauri::{AppHandle, State};

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
/// 2. 用户支付完成后，Store 弹窗本身就已经原子性地确认了 entitlement，
///    我们直接信任 `StorePurchaseStatus::Succeeded` 返回值，立即写入本地缓存。
///
/// 注意：此处 **不** 立即调用 `verify_pro_entitlement` 复核，因为
/// `Windows.Services.Store` 的 add-on entitlement 后台同步通常有
/// 5-30 秒延迟，刚买完立刻 verify 几乎必然返回 false，会导致 UI 误报失败、
/// 让用户以为没买成功。复核交给应用启动时的 `sync_with_store` 慢慢做。
///
/// 在非 Windows 平台或没有 Package Identity 的开发环境，调用会返回错误，
/// 前端应当显示"请通过 Microsoft Store 安装"的提示。
#[tauri::command]
pub async fn purchase_pro_lifetime(
    service: State<'_, Arc<LicensingService>>,
    app_handle: AppHandle,
) -> Result<LicenseStatus, String> {
    #[cfg(target_os = "windows")]
    {
        use crate::app::licensing::windows_store;
        // Step 1: 弹出 Store 购买窗口，等待用户支付。
        // RequestPurchaseAsync 返回 Succeeded 时，Store 客户端已经原子性
        // 确认了支付与 entitlement 授权（即使 server 端同步还没传播过来）。
        // app_handle 用于把 Store 调用投递到 UI 线程，否则 0x80070578。
        let order_id = windows_store::request_purchase_pro_lifetime(&app_handle)
            .await
            .map_err(String::from)?;
        // Step 2: 直接写入本地缓存。后续启动 sync_with_store 会慢慢核对
        // server 端 entitlement 并校正状态（详见 sync_with_store 的宽限期逻辑）。
        service.unlock_pro(Some(order_id), None).await
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = (service, app_handle);
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
    app_handle: AppHandle,
) -> Result<LicenseStatus, String> {
    #[cfg(target_os = "windows")]
    {
        use crate::app::licensing::windows_store;
        // app_handle 用于把 Store 调用投递到 UI 线程，否则 0x80070578。
        let owned = windows_store::verify_pro_entitlement(&app_handle)
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
        let _ = (service, app_handle);
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
