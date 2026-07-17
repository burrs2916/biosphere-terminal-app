//! Microsoft Store In-App Purchase 集成。
//!
//! 仅 Windows 平台编译。所有调用都通过 `windows` crate (0.61) 提供的
//! `Windows.Services.Store` 命名空间绑定。
//!
//! ## 关键 API
//! - `StoreContext::GetDefault` —— 获取当前用户/应用上下文。
//! - `StoreContext::GetStoreProductsAsync(kinds, ids)` —— 拉取指定产品
//!   元数据；只有拿到 `StoreProduct` 才能弹出购买窗口。
//! - `StoreProduct::RequestPurchaseAsync` —— 触发 Store 购买弹窗。
//! - `StoreContext::GetAppLicenseAsync` —— 查询 add-on entitlement。
//!
//! ## 必须条件
//! 1. 应用必须以 MSIX 包形式从 Microsoft Store 安装运行；侧载或开发模式
//!    会得到 `ERROR_NO_PACKAGE_IDENTITY (0x80073D54)`。
//! 2. AppxManifest 必须声明 `internetClient` capability。
//! 3. 加载项必须先在 Partner Center 提交并通过认证（即 9NZ4NSFLW6RW）。
//!
//! ## UI 线程
//! `StoreContext::GetDefault()` 必须在**真正初始化了 WinRT 的 UI 线程**
//! 上调用，普通 STA 线程不够。Tauri 应用的 UI 线程就是托管 webview 的
//! 主线程，所以我们通过 `app_handle.run_on_main_thread()` 把所有
//! Store API 调用投递到这条线程上。
//!
//! ## 版本注意
//! - 本文件锁定使用 `windows = "0.61"` + `windows-collections = "0.2"`。
//!   IIterable 在 windows 0.61 没有 re-export 到 `windows::Foundation::Collections`，
//!   必须从独立 crate `windows_collections` 导入。
//! - windows 0.61 内部就依赖 windows-collections 0.2，因此显式声明 0.2 不会
//!   制造多版本冲突。
//! - 之前尝试过 0.62，会与依赖图里 tauri 引入的 0.61 形成 trait 冲突
//!   （`HSTRING: RuntimeType` not satisfied），最终切回 0.61 解决。

use std::collections::HashSet;

use tauri::AppHandle;

use windows::Services::Store::{StoreContext, StorePurchaseStatus};
use windows::core::HSTRING;
use windows_collections::IIterable;

use super::PRO_LIFETIME_PRODUCT_ID;

/// IAP 操作错误，前端会以字符串形式收到。
#[derive(Debug)]
pub enum StoreIapError {
    /// 当前进程没有 Package Identity（侧载 / 开发模式）。
    NoPackageIdentity,
    /// 找不到指定的 Store 产品（产品 ID 错误或加载项尚未通过认证）。
    ProductNotFound,
    /// Store API 调用失败（用户未登录、配置异常等）。
    Api(String),
    /// 用户在 Store 弹窗中取消了购买。
    UserCancelled,
    /// 网络错误。
    NetworkError(String),
    /// 购买流程返回了未知/异常状态。
    UnexpectedStatus(String),
    /// 未能把任务投递到 UI 线程（run_on_main_thread 返回错误）。
    UiThreadDispatch(String),
}

impl std::fmt::Display for StoreIapError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            StoreIapError::NoPackageIdentity => write!(
                f,
                "App is not running as a Microsoft Store package. \
                Install from the Store before purchasing."
            ),
            StoreIapError::ProductNotFound => write!(
                f,
                "The Pro add-on was not found in the Microsoft Store. \
                It may still be in certification."
            ),
            StoreIapError::Api(msg) => write!(f, "Store API error: {}", msg),
            StoreIapError::UserCancelled => write!(f, "User cancelled the purchase"),
            StoreIapError::NetworkError(msg) => write!(f, "Network error: {}", msg),
            StoreIapError::UnexpectedStatus(s) => write!(f, "Unexpected purchase status: {}", s),
            StoreIapError::UiThreadDispatch(msg) => {
                write!(f, "Failed to dispatch Store call to UI thread: {}", msg)
            }
        }
    }
}

impl std::error::Error for StoreIapError {}

impl From<StoreIapError> for String {
    fn from(e: StoreIapError) -> Self {
        e.to_string()
    }
}

/// 构造 IIterable<HSTRING>。
/// windows 0.61 中 `HSTRING` 实现 `Type<HSTRING, CloneType>`，
/// 因此 `HSTRING::Default == HSTRING`，`IIterable::from` 接受 `Vec<HSTRING>`。
/// (与 InterfaceType 类型不同，那些 Default 才是 `Option<T>`。)
fn hstring_iterable(values: &[&str]) -> IIterable<HSTRING> {
    let vec: Vec<HSTRING> = values.iter().map(|v| HSTRING::from(*v)).collect();
    IIterable::<HSTRING>::from(vec)
}

/// 在 UI 线程上同步执行闭包 `f`，并把结果返回给调用方。
///
/// `StoreContext::GetDefault()` 必须在真正初始化 WinRT 的 UI 线程上调用，
/// 把当前线程（哪怕是 STA）当成 UI 线程会得到 0x80070578
/// （RPC_E_NO_UI_THREAD）。Tauri 把 webview 跑在主线程上，所以我们把任务
/// 投递到那条线程，闭包跑完后再把结果 send 回原线程的 channel。
fn run_on_ui_thread<F, T>(app: &AppHandle, f: F) -> Result<T, StoreIapError>
where
    F: FnOnce() -> Result<T, StoreIapError> + Send + 'static,
    T: Send + 'static,
{
    let (tx, rx) = std::sync::mpsc::channel::<Result<T, StoreIapError>>();
    app.run_on_main_thread(move || {
        // 闭包已经在 UI 线程上了；直接执行，不再额外 CoInitializeEx：
        // Tauri 启动时主线程已经初始化好 COM / WinRT，再初始化反而会 RPC_E_CHANGED_MODE。
        let result = f();
        // 发送失败说明接收方已经 drop，忽略即可——通常意味着调用方已经超时返回。
        let _ = tx.send(result);
    })
    .map_err(|e| StoreIapError::UiThreadDispatch(e.to_string()))?;
    rx.recv().map_err(|e| {
        StoreIapError::UiThreadDispatch(format!("UI thread channel closed: {}", e))
    })?
}

/// 触发 Microsoft Store 购买弹窗。
///
/// 阻塞等待用户在 Store 弹窗中完成购买。前端应保持 UI 在 loading 状态。
/// 成功返回订单标识字符串（用作本地缓存的 store_order_id）。
///
/// **重要**：Windows Store API 要求在 UI 线程上调用。我们通过
/// `app.run_on_main_thread()` 把整个 Store 流程投递到托管 webview 的
/// 主线程上执行。
pub async fn request_purchase_pro_lifetime(
    app: &AppHandle,
) -> Result<String, StoreIapError> {
    let app_clone = app.clone();
    tokio::task::spawn_blocking(move || {
        run_on_ui_thread(&app_clone, || -> Result<String, StoreIapError> {
            let ctx = StoreContext::GetDefault().map_err(classify_error)?;

            // 1. 拉取 Pro 加载项的 Store 元数据。
            let kinds = hstring_iterable(&["Durable"]);
            let ids = hstring_iterable(&[PRO_LIFETIME_PRODUCT_ID]);
            let query_op = ctx
                .GetStoreProductsAsync(&kinds, &ids)
                .map_err(classify_error)?;
            let query_result = query_op.get().map_err(classify_error)?;

            let products = query_result.Products().map_err(classify_error)?;
            let product = products
                .Lookup(&HSTRING::from(PRO_LIFETIME_PRODUCT_ID))
                .map_err(|_| StoreIapError::ProductNotFound)?;

            // 2. 触发购买弹窗，阻塞等待用户操作。
            let purchase_op = product.RequestPurchaseAsync().map_err(classify_error)?;
            let result = purchase_op.get().map_err(classify_error)?;
            let status = result.Status().map_err(classify_error)?;

            match status {
                StorePurchaseStatus::Succeeded | StorePurchaseStatus::AlreadyPurchased => {
                    Ok(format!(
                        "store:{}:{}",
                        PRO_LIFETIME_PRODUCT_ID,
                        chrono::Utc::now().to_rfc3339()
                    ))
                }
                StorePurchaseStatus::NotPurchased => Err(StoreIapError::UserCancelled),
                StorePurchaseStatus::NetworkError => Err(StoreIapError::NetworkError(
                    "Could not reach the Microsoft Store".to_string(),
                )),
                StorePurchaseStatus::ServerError => Err(StoreIapError::Api(
                    "Microsoft Store server error".to_string(),
                )),
                other => Err(StoreIapError::UnexpectedStatus(format!("{:?}", other))),
            }
        })
    })
    .await
    .map_err(|e| StoreIapError::Api(format!("blocking task panicked: {}", e)))?
}

/// 查询用户当前拥有的 add-on entitlements（用于 Restore Purchase / 启动同步）。
///
/// 通过 `StoreContext::GetAppLicenseAsync` 获取应用的 License，
/// 然后遍历 `AddOnLicenses`，收集所有 `IsActive=true` 的产品 ID。
///
/// **重要**：Windows Store API 要求在 UI 线程上调用。
pub async fn get_user_owned_addons(
    app: &AppHandle,
) -> Result<HashSet<String>, StoreIapError> {
    let app_clone = app.clone();
    tokio::task::spawn_blocking(move || {
        run_on_ui_thread(&app_clone, || -> Result<HashSet<String>, StoreIapError> {
            let ctx = StoreContext::GetDefault().map_err(classify_error)?;

            let app_license_op = ctx.GetAppLicenseAsync().map_err(classify_error)?;
            let app_license = app_license_op.get().map_err(classify_error)?;

            let mut owned = HashSet::new();
            let addon_licenses = app_license.AddOnLicenses().map_err(classify_error)?;
            let iter = addon_licenses.First().map_err(classify_error)?;
            loop {
                if !iter.HasCurrent().map_err(classify_error)? {
                    break;
                }
                let kvp = iter.Current().map_err(classify_error)?;
                let key = kvp.Key().map_err(classify_error)?.to_string();
                let license = kvp.Value().map_err(classify_error)?;
                if license.IsActive().map_err(classify_error)? {
                    if !key.is_empty() {
                        owned.insert(key);
                    }
                    if let Ok(token) = license.InAppOfferToken() {
                        let token_str = token.to_string();
                        if !token_str.is_empty() {
                            owned.insert(token_str);
                        }
                    }
                    if let Ok(sku) = license.SkuStoreId() {
                        let sku_str = sku.to_string();
                        if !sku_str.is_empty() {
                            owned.insert(sku_str);
                        }
                    }
                }
                iter.MoveNext().map_err(classify_error)?;
            }
            Ok(owned)
        })
    })
    .await
    .map_err(|e| StoreIapError::Api(format!("blocking task panicked: {}", e)))?
}

/// 复核当前用户是否拥有 Pro 加载项 entitlement。
/// 返回 `true` 表示 Store 确认已购买；`false` 表示未购买；
/// `Err` 表示无法获取（侧载、网络异常等）—— 此时调用方应保留本地缓存状态。
///
/// 实现策略：由于本应用目前只销售单一 Pro 加载项 (9NZ4NSFLW6RW)，
/// 任何 `IsActive=true` 的 add-on entitlement 都视为有效 Pro。
/// 这避免了 Store API 返回的 key 可能是 SkuStoreId / InAppOfferToken 等
/// 多种格式时的精确字符串匹配难题。如果将来引入第二个加载项，需要改为
/// 精确比较 product.StoreId。
pub async fn verify_pro_entitlement(
    app: &AppHandle,
) -> Result<bool, StoreIapError> {
    let owned = get_user_owned_addons(app).await?;
    if owned.is_empty() {
        return Ok(false);
    }
    // 精确匹配优先（防御未来扩展）；找不到时退回到"任意 active addon"判定。
    if owned.contains(PRO_LIFETIME_PRODUCT_ID) {
        return Ok(true);
    }
    tracing::info!(
        "[licensing] active add-on entitlement found but its key did not match \
        PRO_LIFETIME_PRODUCT_ID; treating user as Pro because we currently sell \
        only one add-on. owned keys: {:?}",
        owned
    );
    Ok(true)
}

/// 把 windows::core::Error 翻译成更友好的 StoreIapError。
fn classify_error(err: windows::core::Error) -> StoreIapError {
    let code = err.code().0 as u32;
    // 0x80073D54 = ERROR_NO_PACKAGE_IDENTITY: 进程没有 MSIX identity
    if code == 0x80073D54 {
        return StoreIapError::NoPackageIdentity;
    }
    StoreIapError::Api(format!("HRESULT 0x{:08X}: {}", code, err.message()))
}
