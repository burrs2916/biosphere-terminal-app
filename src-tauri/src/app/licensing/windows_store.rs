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
//! ## UI 线程（为什么需要专用线程）
//! `StoreContext::GetDefault()` 返回的 `IStoreContext` 在 WinRT 里是
//! **UI-thread bound** 的：它要求在已用 `RoInitialize(RO_INIT_SINGLETHREADED)`
//! 初始化的线程上调用，否则抛 `0x80070578 (RPC_E_NO_UI_THREAD)`。
//!
//! 0.4.2 / 0.4.3 各自尝试过两种修法，都被日志验证不生效：
//!
//! - 0.4.2：在 tokio `spawn_blocking` 里 `CoInitializeEx(COINIT_APARTMENTTHREADED)`。
//!   —— `CoInitializeEx(STA)` ≠ UI thread。StoreContext 仍报 0x80070578。
//! - 0.4.3：投递到 `app.run_on_main_thread()`，闭包跑在 tao 事件循环线程上。
//!   —— tao 主线程虽然也 `CoInitializeEx(STA)` 过一次，但没
//!   `RoInitialize(RO_INIT_SINGLETHREADED)`，且事件循环不是 WinRT
//!   视角的 UI 线程，StoreContext 仍然报 0x80070578。
//!
//! 当前方案：自建一条**专用 UI 线程**。在 `std::thread::spawn` 的线程上
//! 先 `CoInitializeEx(COINIT_APARTMENTTHREADED)`，再 `RoInitialize(RO_INIT_SINGLETHREADED)`，
//! 然后跑一个 Win32 消息泵。所有 Store 调用都通过一个 std::mpsc channel
//! 投递给这条线程执行，结果通过 std::mpsc::SyncSender 拿回。
//!
//! 这条线程在第一次需要 Store API 时按需启动，常驻到进程结束。
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
use std::sync::{mpsc, OnceLock};
use std::thread;
use std::time::Duration;

use tauri::{AppHandle, Manager};

use windows::core::{Interface, HSTRING};
use windows::Win32::Foundation::HWND;
use windows::Win32::System::Com::{CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED};
use windows::Win32::System::WinRT::{RoInitialize, RoUninitialize, RO_INIT_SINGLETHREADED};
use windows::Win32::UI::Shell::IInitializeWithWindow;
use windows::Win32::UI::WindowsAndMessaging::{
    DispatchMessageW, PeekMessageW, TranslateMessage, MSG, PM_REMOVE,
};
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

// ---------------------------------------------------------------------------
// 专用 UI 线程基础设施
// ---------------------------------------------------------------------------

/// UI 线程上一次初始化结果。用于诊断如果初始化失败就彻底放弃整条线程。
#[derive(Debug, Clone, Copy)]
enum UiThreadInit {
    Ok,
    CoInitFailed(u32),
    RoInitFailed(u32),
}

/// 任务项：闭包在 UI 线程上执行，调用方通过 oneshot 拿回结果。
type UiTask = Box<dyn FnOnce() + Send + 'static>;

/// 持有 UI 线程的 channel sender 端。第一次访问时按需 spawn 线程。
fn ui_thread_tx() -> &'static mpsc::SyncSender<UiTask> {
    static TX: OnceLock<mpsc::SyncSender<UiTask>> = OnceLock::new();
    TX.get_or_init(|| {
        let (tx, rx) = mpsc::sync_channel::<UiTask>(32);
        // 用普通 std::mpsc 的 sync_channel(0) 替代 Win32 Event 做 ready 通知，
        // 避免引入 Win32_Security feature 才能用的 CreateEventW。
        let (ready_tx, ready_rx) = mpsc::sync_channel::<()>(0);

        thread::Builder::new()
            .name("store-ui-thread".to_string())
            .spawn(move || ui_thread_main(rx, ready_tx))
            .expect("failed to spawn store UI thread");

        // 等待 UI 线程完成 COM+WinRT 初始化再返回 tx。5 秒超时兜底。
        if ready_rx.recv_timeout(Duration::from_secs(5)).is_err() {
            tracing::warn!(
                "[licensing] store-ui-thread did not signal ready within 5s"
            );
        }
        tx
    })
}

/// 在专用 UI 线程上同步执行 `f`，把 `Result<T, StoreIapError>` 拿回。
///
/// `StoreContext::GetDefault()` 是 WinRT UI-thread-bound API，必须在用
/// `RoInitialize(RO_INIT_SINGLETHREADED)` 初始化过 WinRT 的线程上调用。
/// 这条函数把闭包投递到我们自建的 UI 线程上执行，闭包跑完后再把结果
/// send 回原线程的 oneshot channel。
///
/// **未打包 desktop app 关键**：Tauri 应用是 sideloaded exe，没有 MSIX
/// identity，Store API 会走一条要求"关联窗口"的路径。因此我们把主窗口
/// 的 HWND 也塞进闭包，闭包里对 `StoreContext` 调
/// `IInitializeWithWindow::Initialize(hwnd)`——这样 Store 弹窗才有 owner，
/// StoreContext 也才不会报 0x80070578（未打包情况下 0x80070578 的真正
/// 原因是"缺少 initializer window"，不是"线程模式不对"）。
/// 在专用 UI 线程上同步执行 `f`，把 `Result<T, StoreIapError>` 拿回。
///
/// `timeout` 控制我们等 UI 线程完成任务的最大时间：
/// - `None` = 无限等待。用于会弹出 Store 购买/登录窗口的调用
///   （`RequestPurchaseAsync`）——用户可能花几十分钟登录 Microsoft
///   账号 + 绑定支付方式；任何有限超时都可能在用户已经付款后中断链路，
///   造成"付了钱但显示失败"的商业灾难。
/// - `Some(dur)` = 有限超时。用于纯查询性质、不弹窗的调用
///   （`GetAppLicenseAsync` / `verify_pro_entitlement`）——这些调用
///   在网络异常时应当尽快 fallback 到"保留本地状态"，避免启动
///   同步任务永远挂着。
fn run_on_ui_thread<F, T>(
    app: &AppHandle,
    timeout: Option<Duration>,
    f: F,
) -> Result<T, StoreIapError>
where
    F: FnOnce(HWND) -> Result<T, StoreIapError> + Send + 'static,
    T: Send + 'static,
{
    let caller_tid = thread::current().id();
    tracing::info!(
        "[licensing] run_on_ui_thread called from thread {:?}",
        caller_tid
    );

    // 拿主窗口 HWND。HWND 内部是 *mut c_void，不 impl Send；跨线程时用它
    // 的 isize 表示搬运，进入 store-ui-thread 后再包回 HWND。
    let hwnd_isize: isize = match app.get_webview_window("main") {
        Some(win) => match win.hwnd() {
            Ok(h) => {
                let v = h.0 as isize;
                tracing::info!("[licensing] main window HWND = 0x{:X}", v);
                v
            }
            Err(e) => {
                tracing::error!("[licensing] failed to get HWND: {}", e);
                return Err(StoreIapError::UiThreadDispatch(format!(
                    "get HWND failed: {}",
                    e
                )));
            }
        },
        None => {
            tracing::error!("[licensing] main webview window not found");
            return Err(StoreIapError::UiThreadDispatch(
                "main webview window not found".to_string(),
            ));
        }
    };

    let (tx, rx) = mpsc::sync_channel::<Result<T, StoreIapError>>(1);
    let task: UiTask = Box::new(move || {
        let tid = thread::current().id();
        tracing::info!("[licensing] store-ui-thread {:?} executing task", tid);
        let hwnd = HWND(hwnd_isize as *mut _);
        let result = f(hwnd);
        tracing::info!(
            "[licensing] store-ui-thread task finished, result ok={}",
            result.is_ok()
        );
        // 发送失败说明接收方已经 drop，忽略即可——通常意味着调用方已经超时返回。
        let _ = tx.send(result);
    });

    let dispatcher = ui_thread_tx();
    tracing::info!("[licensing] dispatching task to store-ui-thread");
    dispatcher
        .send(task)
        .map_err(|e| StoreIapError::UiThreadDispatch(format!("send: {}", e)))?;

    // 闭包里的 Store 调用可能耗时——特别是购买流程要等用户登录 + 输入支付
    // + 确认。若 `timeout=None` 我们无限等待，永远不打断用户；若
    // `timeout=Some(dur)` 则超过时返回错误。
    match timeout {
        None => {
            // recv() 返回 Result<Result<T, StoreIapError>, RecvError>
            let inner = rx
                .recv()
                .map_err(|e| StoreIapError::UiThreadDispatch(format!("recv: {}", e)))?;
            inner
        }
        Some(dur) => match rx.recv_timeout(dur) {
            Ok(result) => result,
            Err(mpsc::RecvTimeoutError::Timeout) => {
                tracing::error!(
                    "[licensing] store-ui-thread task did not complete in {:?}",
                    dur
                );
                Err(StoreIapError::UiThreadDispatch(format!(
                    "store-ui-thread did not return within {:?}",
                    dur
                )))
            }
            Err(e) => Err(StoreIapError::UiThreadDispatch(format!("recv: {}", e))),
        },
    }
}

/// UI 线程主循环：初始化 COM + WinRT，跑消息泵，处理任务。
///
/// 关键点：
/// 1. 必须先 `CoInitializeEx(COINIT_APARTMENTTHREADED)`（在调用任何 COM
///    之前），再 `RoInitialize(RO_INIT_SINGLETHREADED)`（在调用任何 WinRT
///    之前）。颠倒顺序会得到 `RPC_E_CHANGED_MODE`。
/// 2. 持续用 `GetQueueStatus(QS_ALLPOSTMESSAGE) + PeekMessageW(PM_REMOVE)`
///    把 pending 的 Win32 消息 pump 掉——这是 WinRT `IAsyncOperation`
///    回调派发的载体；不 pump 的话某些 `get()` 会永远阻塞。
/// 3. 任务按顺序串行执行，保证 StoreContext 的线程亲和性不被破坏。
fn ui_thread_main(
    rx: mpsc::Receiver<UiTask>,
    ready_tx: mpsc::SyncSender<()>,
) {
    // 1) COM STA 必须先于 WinRT 初始化。
    // CoInitializeEx 返回 HRESULT（不是 Result）。RPC_E_CHANGED_MODE
    // (0x80010106) 表示线程已经以另一种模式初始化过 COM。
    let com_hr = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) };
    let com_code = com_hr.0 as u32;
    let com_result = if com_hr.is_ok() {
        tracing::info!(
            "[licensing] store-ui-thread: CoInitializeEx(STA) ok (hr=0x{:08X})",
            com_code
        );
        UiThreadInit::Ok
    } else if com_code == 0x80010106 {
        // 线程已经初始化过 COM（比如 dllmain 中）。继续。
        tracing::warn!(
            "[licensing] store-ui-thread: CoInitializeEx returned RPC_E_CHANGED_MODE; continuing"
        );
        UiThreadInit::CoInitFailed(com_code)
    } else {
        tracing::error!(
            "[licensing] store-ui-thread: CoInitializeEx failed 0x{:08X}",
            com_code
        );
        UiThreadInit::CoInitFailed(com_code)
    };

    // 2) RoInitialize(RO_INIT_SINGLETHREADED) 把线程标记为 WinRT UI 线程。
    // 这正是 StoreContext::GetDefault() 需要的。
    // RoInitialize 返回 windows_core::Result<()>（内部已经处理了 S_FALSE）。
    let ro_result = match unsafe { RoInitialize(RO_INIT_SINGLETHREADED) } {
        Ok(()) => {
            tracing::info!("[licensing] store-ui-thread: RoInitialize(STA) ok");
            UiThreadInit::Ok
        }
        Err(e) => {
            let code = e.code().0 as u32;
            tracing::error!(
                "[licensing] store-ui-thread: RoInitialize failed 0x{:08X}: {}",
                code,
                e.message()
            );
            UiThreadInit::RoInitFailed(code)
        }
    };

    // 通知主线程我们已经初始化好了（无论成功失败都通知，避免永远阻塞）。
    let _ = ready_tx.send(());
    drop(ready_tx);

    // 主循环：串行处理任务 + 间歇 pump Win32 消息。
    loop {
        // 用 recv_timeout 短间隔轮询，方便周期性 pump 消息。
        match rx.recv_timeout(Duration::from_millis(100)) {
            Ok(task) => {
                // 先 pump 一次消息把之前残留的 WinRT 回调消化掉。
                pump_pending_messages();
                if matches!(com_result, UiThreadInit::Ok) && matches!(ro_result, UiThreadInit::Ok) {
                    task();
                } else {
                    // 初始化失败，任务直接返回错误。
                    // 由于拿不到任务的 oneshot（被闭包捕获了），这里只能在日志里报告。
                    tracing::error!(
                        "[licensing] store-ui-thread dropping task: init failed com={:?} ro={:?}",
                        com_result,
                        ro_result
                    );
                }
                // 任务执行后再 pump 一次，回收 IAsyncOperation 的回调。
                pump_pending_messages();
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                // 100ms 空闲窗口：pump 消息、然后继续等。
                pump_pending_messages();
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                tracing::info!("[licensing] store-ui-thread: dispatcher disconnected, exiting");
                break;
            }
        }
    }

    // 清理：先 RoUninitialize 再 CoUninitialize。
    unsafe {
        RoUninitialize();
        if matches!(com_result, UiThreadInit::Ok) {
            CoUninitialize();
        }
    }
}

/// 把当前线程消息队列里所有待处理的 Win32 消息 pump 掉。
///
/// 必须在 store-ui-thread 主循环中周期性调用，否则 `IAsyncOperation` 完成
/// 时的回调（通过 PostThreadMessage 派发）会堆积，最终导致 `get()` 永不返回。
fn pump_pending_messages() {
    unsafe {
        let mut msg = MSG::default();
        // PM_REMOVE = 把消息从队列里拿出来。
        // 第二/三个 0 表示所有 hwnd、所有 message range。
        while PeekMessageW(&mut msg, None, 0, 0, PM_REMOVE).as_bool() {
            let _ = TranslateMessage(&msg);
            let _ = DispatchMessageW(&msg);
        }
    }
}

// ---------------------------------------------------------------------------
// Store API 入口
// ---------------------------------------------------------------------------

/// 构造 IIterable<HSTRING>。
/// windows 0.61 中 `HSTRING` 实现 `Type<HSTRING, CloneType>`，
/// 因此 `HSTRING::Default == HSTRING`，`IIterable::from` 接受 `Vec<HSTRING>`。
/// (与 InterfaceType 类型不同，那些 Default 才是 `Option<T>`。)
fn hstring_iterable(values: &[&str]) -> IIterable<HSTRING> {
    let vec: Vec<HSTRING> = values.iter().map(|v| HSTRING::from(*v)).collect();
    IIterable::<HSTRING>::from(vec)
}

/// 触发 Microsoft Store 购买弹窗。
///
/// 阻塞等待用户在 Store 弹窗中完成购买。前端应保持 UI 在 loading 状态。
/// 成功返回订单标识字符串（用作本地缓存的 store_order_id）。
///
/// **重要**：Windows Store API 要求在 UI 线程上调用。我们通过自建的
/// `store-ui-thread`（用 `RoInitialize(RO_INIT_SINGLETHREADED)` 初始化
/// 过 WinRT 的专用线程）执行整个 Store 流程。
pub async fn request_purchase_pro_lifetime(
    app: &AppHandle,
) -> Result<String, StoreIapError> {
    let app_clone = app.clone();
    tokio::task::spawn_blocking(move || {
        // 购买流程会弹出 Store 窗口等用户交互，可能耗时数十分钟；
        // 传 None 表示无限等待，避免用户已经付款后被超时中断。
        run_on_ui_thread(&app_clone, None, |hwnd| -> Result<String, StoreIapError> {
            tracing::info!("[licensing] purchase: StoreContext::GetDefault start");
            let ctx = windows::Services::Store::StoreContext::GetDefault()
                .map_err(classify_error)?;
            tracing::info!("[licensing] purchase: StoreContext::GetDefault ok");
            associate_with_window(&ctx, hwnd)?;

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
                windows::Services::Store::StorePurchaseStatus::Succeeded
                | windows::Services::Store::StorePurchaseStatus::AlreadyPurchased => {
                    Ok(format!(
                        "store:{}:{}",
                        PRO_LIFETIME_PRODUCT_ID,
                        chrono::Utc::now().to_rfc3339()
                    ))
                }
                windows::Services::Store::StorePurchaseStatus::NotPurchased => {
                    Err(StoreIapError::UserCancelled)
                }
                windows::Services::Store::StorePurchaseStatus::NetworkError => {
                    Err(StoreIapError::NetworkError(
                        "Could not reach the Microsoft Store".to_string(),
                    ))
                }
                windows::Services::Store::StorePurchaseStatus::ServerError => {
                    Err(StoreIapError::Api(
                        "Microsoft Store server error".to_string(),
                    ))
                }
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
        // Entitlement 查询是纯网络调用，不弹窗；60s 超时足够，超时则视为
        // 网络异常 fallback（不影响用户本地已有的 Pro 状态）。
        run_on_ui_thread(&app_clone, Some(Duration::from_secs(60)), |hwnd| -> Result<HashSet<String>, StoreIapError> {
            tracing::info!("[licensing] entitlement: StoreContext::GetDefault start");
            let ctx = windows::Services::Store::StoreContext::GetDefault()
                .map_err(classify_error)?;
            tracing::info!("[licensing] entitlement: StoreContext::GetDefault ok");
            associate_with_window(&ctx, hwnd)?;

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

/// 把 StoreContext 关联到主窗口。
///
/// 为什么必须做这一步：
/// 未打包（sideloaded / not from Microsoft Store）的 desktop app 里，
/// `StoreContext` 属于 Windows 官方文档明确说需要 `IInitializeWithWindow`
/// 关联的 WinRT 对象——因为 Store 相关 UI（购买弹窗、登录弹窗）都要弹在
/// 应用窗口之上，Windows 用这个接口来知道 owner HWND。如果不关联，
/// StoreContext 内部的 broker 找不到宿主窗口就会返回 0x80070578
/// (`RPC_E_NO_UI_THREAD`)——这个错误码在这里的含义其实是"缺少 initializer
/// window"，而不是字面意思的"线程模式不对"。
///
/// MSIX 打包运行时 Windows 会自动帮我们做这个关联，`Initialize` 是无害的
/// no-op，所以两种情况都调是安全的。
fn associate_with_window(
    ctx: &windows::Services::Store::StoreContext,
    hwnd: HWND,
) -> Result<(), StoreIapError> {
    tracing::info!(
        "[licensing] IInitializeWithWindow::Initialize(hwnd=0x{:X}) start",
        hwnd.0 as isize
    );
    let init: IInitializeWithWindow = ctx.cast().map_err(|e| {
        tracing::error!("[licensing] StoreContext.cast::<IInitializeWithWindow> failed: {}", e);
        classify_error(e)
    })?;
    unsafe { init.Initialize(hwnd) }.map_err(|e| {
        tracing::error!(
            "[licensing] IInitializeWithWindow::Initialize failed 0x{:08X}: {}",
            e.code().0 as u32,
            e.message()
        );
        classify_error(e)
    })?;
    tracing::info!("[licensing] IInitializeWithWindow::Initialize ok");
    Ok(())
}

/// 把 windows::core::Error 翻译成更友好的 StoreIapError。
fn classify_error(err: windows::core::Error) -> StoreIapError {
    let code = err.code().0 as u32;
    // 0x80073D54 = ERROR_NO_PACKAGE_IDENTITY: 进程没有 MSIX identity
    if code == 0x80073D54 {
        return StoreIapError::NoPackageIdentity;
    }
    // 0x80070578 = RPC_E_NO_UI_THREAD: 调用不在 WinRT UI 线程
    if code == 0x80070578 {
        tracing::error!(
            "[licensing] Got 0x80070578 (RPC_E_NO_UI_THREAD) — store-ui-thread \
            was supposed to be initialized as a WinRT UI thread but Store API \
            still says otherwise. Check CoInitializeEx / RoInitialize logs above."
        );
    }
    StoreIapError::Api(format!("HRESULT 0x{:08X}: {}", code, err.message()))
}
