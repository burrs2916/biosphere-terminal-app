//! Licensing service for Biosphere Terminal.
//!
//! Implements a 14-day free trial followed by a one-time Pro unlock.
//! The trial start time and unlock state are persisted to a JSON file
//! inside the app data directory so they survive restarts.
//!
//! On Windows, when running as an MSIX package from the Microsoft Store,
//! the actual purchase verification is delegated to the Windows.Services.Store
//! API via a separate command. On other platforms (or while no Store license
//! is present), the unlock is recorded locally so the app can still be used
//! in development and on macOS/Linux.

use std::path::PathBuf;
use std::sync::Arc;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tokio::sync::RwLock;

#[cfg(target_os = "windows")]
pub mod windows_store;

/// Number of days the free trial lasts (Windows only - macOS/Linux are free Pro).
#[cfg(target_os = "windows")]
pub const TRIAL_DAYS: i64 = 14;

/// Product ID for the lifetime Pro add-on registered in Partner Center.
pub const PRO_LIFETIME_PRODUCT_ID: &str = "9NZ4NSFLW6RW";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LicenseState {
    /// ISO-8601 timestamp when the trial started. `None` means the trial has
    /// not been initialized yet (the user has not launched the app for the
    /// first time).
    pub trial_started_at: Option<String>,
    /// ISO-8601 timestamp when the Pro license was unlocked. `None` means
    /// the user is still on the free tier (or trial).
    pub pro_unlocked_at: Option<String>,
    /// Optional receipt / order ID returned by the Store IAP flow. Stored for
    /// debugging and restore-purchase flows.
    pub store_order_id: Option<String>,
    /// Optional license key for non-Store distribution channels.
    pub license_key: Option<String>,
}

impl Default for LicenseState {
    fn default() -> Self {
        LicenseState {
            trial_started_at: None,
            pro_unlocked_at: None,
            store_order_id: None,
            license_key: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LicenseStatus {
    /// Current tier: `trial`, `free`, or `pro`.
    pub tier: String,
    /// True if the user has unlocked Pro.
    pub is_pro: bool,
    /// True if the user is inside the 14-day trial window.
    pub is_trial: bool,
    /// True if the trial has expired and Pro has not been unlocked.
    pub is_expired: bool,
    /// Days remaining in the trial (clamped to >= 0). 0 when not in trial.
    pub trial_days_remaining: i64,
    /// ISO-8601 timestamp when the trial started (if ever).
    pub trial_started_at: Option<String>,
    /// ISO-8601 timestamp when the trial expires (if started).
    pub trial_expires_at: Option<String>,
    /// ISO-8601 timestamp when Pro was unlocked (if purchased).
    pub pro_unlocked_at: Option<String>,
    /// Reason for the current tier, useful for debugging.
    pub reason: String,
}

pub struct LicensingService {
    state: Arc<RwLock<LicenseState>>,
    state_path: PathBuf,
}

impl LicensingService {
    /// Create a new service. The state file is stored at `data_dir/license.json`.
    pub fn new(data_dir: PathBuf) -> Self {
        let state_path = data_dir.join("license.json");
        let state = Self::load_state(&state_path).unwrap_or_else(|err| {
            tracing::warn!("[licensing] failed to load state from {:?}: {}", state_path, err);
            LicenseState::default()
        });

        // First launch: initialize the trial start time immediately so the
        // 14-day clock starts ticking the first time the user opens the app.
        // 仅 Windows 平台需要试用期；macOS/Linux 默认全 Pro 解锁，无需写入。
        //
        // 关键安全性：必须 **先写盘成功** 才在内存里设置 trial_started_at。
        // 否则磁盘满 / 权限不足时，每次启动都会重置 trial 起点 = 无限试用。
        #[cfg_attr(not(target_os = "windows"), allow(unused_mut))]
        let mut state = state;
        #[cfg(target_os = "windows")]
        if state.trial_started_at.is_none() {
            let mut candidate = state.clone();
            candidate.trial_started_at = Some(Utc::now().to_rfc3339());
            match Self::save_state(&state_path, &candidate) {
                Ok(()) => {
                    state = candidate;
                    tracing::info!("[licensing] trial started at first launch");
                }
                Err(err) => {
                    // 写盘失败：保持 trial_started_at 为 None。compute_status
                    // 会把这种状态当做 free tier，比错误地"无限试用"更安全。
                    tracing::error!(
                        "[licensing] failed to persist initial trial start: {} \
                        — leaving trial uninitialized; user will be treated as free tier",
                        err
                    );
                }
            }
        }

        LicensingService {
            state: Arc::new(RwLock::new(state)),
            state_path,
        }
    }

    /// 启动后异步与 Microsoft Store 同步 entitlement 状态：
    ///
    /// **策略（v0.4.9 起）：只加不减。**
    /// - 若 Store 报告已购买但本地未标记 Pro → 自动 unlock 并 emit
    ///   `license-changed` 事件通知前端刷新。
    /// - 若 Store 报告未购买但本地标记 Pro → **不做任何撤销**。
    ///   理由：Store server 端 entitlement 同步偶发性会跨天（甚至更久，
    ///   且没有官方 SLA）。撤销真实付费用户的 Pro 状态，无论宽限期设多长，
    ///   都会造成商业上极坏的体验（用户已付款却被降级）。本地 license.json
    ///   的写保护成本远低于错杀成本。
    ///   如果确实出现"退款/欺诈"场景，需要走客服人工处理（未来可加
    ///   服务端签名 receipt 才能真正判断是否应撤销）。
    /// - 若 Store API 不可用（侧载、网络异常）→ 保留本地状态，不做改动。
    ///
    /// 仅在 Windows 平台上有意义，其他平台是 no-op。
    ///
    /// `app_handle` 用途：
    /// 1. 传给 windows_store 用于把调用投递到 UI 线程；
    /// 2. 自动解锁成功后用于 emit 前端事件。
    pub async fn sync_with_store(&self, app_handle: &AppHandle) {
        // 非 Windows 平台整个函数体是 no-op，参数未被读取——显式消费一次以
        // 避免非 Windows 编译时出现 unused_variable 警告。Windows 分支里
        // 会真正用到 app_handle。
        #[cfg(not(target_os = "windows"))]
        #[allow(clippy::needless_return)]
        {
            let _ = app_handle;
            return;
        }
        #[cfg(target_os = "windows")]
        {
            let owned = match windows_store::verify_pro_entitlement(app_handle).await {
                Ok(v) => v,
                Err(err) => {
                    tracing::info!(
                        "[licensing] skipping store sync (likely sideloaded or offline): {}",
                        err
                    );
                    return;
                }
            };

            let mut state = self.state.write().await;
            let local_pro = state.pro_unlocked_at.is_some();

            if owned && !local_pro {
                // 先构造新状态并写盘，写盘成功后才修改内存状态，确保两者一致。
                let mut new_state = state.clone();
                new_state.pro_unlocked_at = Some(Utc::now().to_rfc3339());
                new_state.store_order_id = Some(format!(
                    "store-sync:{}:{}",
                    PRO_LIFETIME_PRODUCT_ID,
                    Utc::now().to_rfc3339()
                ));
                if let Err(e) = Self::save_state(&self.state_path, &new_state) {
                    tracing::warn!("[licensing] failed to persist store sync: {}", e);
                    // 写盘失败：不修改内存状态，保持与磁盘一致。
                    return;
                }
                let new_status = Self::compute_status(&new_state);
                *state = new_state;
                drop(state);
                tracing::info!(
                    "[licensing] store sync: Pro auto-unlocked from Store entitlement"
                );
                // 通知前端：新的 LicenseStatus 需要立刻在 UI 刷新，
                // 不然用户在 Store 网页买完 → 装 MSIX 版启动，UI 还会一直
                // 停留在 trial 状态，直到手动 Restore / 重启，体验极差。
                use tauri::Emitter;
                if let Err(e) = app_handle.emit("license-changed", &new_status) {
                    tracing::warn!(
                        "[licensing] failed to emit license-changed event: {}",
                        e
                    );
                }
            } else {
                tracing::debug!(
                    "[licensing] store sync: no auto-unlock needed (owned={}, local_pro={})",
                    owned,
                    local_pro
                );
            }
        }
    }

    fn load_state(path: &PathBuf) -> Result<LicenseState, String> {
        let content = std::fs::read_to_string(path)
            .map_err(|e| format!("read license state: {}", e))?;
        let state: LicenseState = serde_json::from_str(&content)
            .map_err(|e| format!("parse license state: {}", e))?;
        Ok(state)
    }

    fn save_state(path: &PathBuf, state: &LicenseState) -> Result<(), String> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("create license dir: {}", e))?;
        }
        let json = serde_json::to_string_pretty(state)
            .map_err(|e| format!("serialize license state: {}", e))?;
        // 原子写入：先写到临时文件，再 rename 覆盖目标文件。
        // 这样即使写入过程中崩溃（断电、panic），目标文件也保持完整。
        // rename 在同一文件系统上是原子的（POSIX / Windows NTFS 均保证）。
        let tmp_path = path.with_extension("json.tmp");
        std::fs::write(&tmp_path, &json)
            .map_err(|e| format!("write license state (tmp): {}", e))?;
        std::fs::rename(&tmp_path, path)
            .map_err(|e| {
                // rename 失败时尝试清理临时文件，避免残留。
                let _ = std::fs::remove_file(&tmp_path);
                format!("rename license state: {}", e)
            })?;
        Ok(())
    }

    /// Compute the current license status from the persisted state.
    pub async fn status(&self) -> LicenseStatus {
        let state = self.state.read().await.clone();
        Self::compute_status(&state)
    }

    fn compute_status(state: &LicenseState) -> LicenseStatus {
        // 平台策略：macOS 与 Linux 当前未上线付费渠道，所有 Pro 功能默认开放，
        // 用户体验等同于已购买 Pro。仅 Windows 走 14 天试用 + Microsoft Store
        // 一次性购买的商业模式。
        #[cfg(not(target_os = "windows"))]
        {
            // 在非 Windows 平台直接返回 Pro 状态。
            // 注意：用 `let _ = ...` 抑制后续 Windows-only 代码的未使用变量警告。
            let _ = state;
            return LicenseStatus {
                tier: "pro".to_string(),
                is_pro: true,
                is_trial: false,
                is_expired: false,
                trial_days_remaining: 0,
                trial_started_at: None,
                trial_expires_at: None,
                pro_unlocked_at: None,
                reason: "Free Pro on macOS/Linux".to_string(),
            };
        }

        #[cfg(target_os = "windows")]
        {
            Self::compute_status_windows(state)
        }
    }

    /// Windows 平台的许可证状态计算逻辑：14 天试用 + Pro 解锁状态。
    #[cfg(target_os = "windows")]
    fn compute_status_windows(state: &LicenseState) -> LicenseStatus {
        // Pro unlocked takes precedence over trial state.
        if let Some(unlocked_at) = &state.pro_unlocked_at {
            return LicenseStatus {
                tier: "pro".to_string(),
                is_pro: true,
                is_trial: false,
                is_expired: false,
                trial_days_remaining: 0,
                trial_started_at: state.trial_started_at.clone(),
                trial_expires_at: Self::trial_expires_at(state),
                pro_unlocked_at: Some(unlocked_at.clone()),
                reason: "Pro license unlocked".to_string(),
            };
        }

        let Some(started_at_str) = &state.trial_started_at else {
            // Should not happen because we initialize on first launch, but
            // handle it gracefully by treating the user as free tier.
            return LicenseStatus {
                tier: "free".to_string(),
                is_pro: false,
                is_trial: false,
                is_expired: false,
                trial_days_remaining: 0,
                trial_started_at: None,
                trial_expires_at: None,
                pro_unlocked_at: None,
                reason: "Trial not started".to_string(),
            };
        };

        let started_at = match DateTime::parse_from_rfc3339(started_at_str) {
            Ok(dt) => dt.with_timezone(&Utc),
            Err(_) => {
                return LicenseStatus {
                    tier: "free".to_string(),
                    is_pro: false,
                    is_trial: false,
                    is_expired: true,
                    trial_days_remaining: 0,
                    trial_started_at: state.trial_started_at.clone(),
                    trial_expires_at: None,
                    pro_unlocked_at: None,
                    reason: "Invalid trial start timestamp".to_string(),
                };
            }
        };

        let now = Utc::now();
        let expires_at = started_at + chrono::Duration::days(TRIAL_DAYS);
        // 用 ceil 而非 num_days() 整除：剩 8 小时也应显示 "1 day"，
        // 这样不会出现「最后一天显示 Trial · 0d」的诡异 UI。
        let remaining_secs = (expires_at - now).num_seconds();
        let remaining = if remaining_secs <= 0 {
            0
        } else {
            ((remaining_secs as f64) / 86400.0).ceil() as i64
        };

        if now < expires_at {
            LicenseStatus {
                tier: "trial".to_string(),
                is_pro: false,
                is_trial: true,
                is_expired: false,
                trial_days_remaining: remaining.max(0),
                trial_started_at: Some(started_at.to_rfc3339()),
                trial_expires_at: Some(expires_at.to_rfc3339()),
                pro_unlocked_at: None,
                reason: format!("Trial active, {} days remaining", remaining.max(0)),
            }
        } else {
            LicenseStatus {
                tier: "free".to_string(),
                is_pro: false,
                is_trial: false,
                is_expired: true,
                trial_days_remaining: 0,
                trial_started_at: Some(started_at.to_rfc3339()),
                trial_expires_at: Some(expires_at.to_rfc3339()),
                pro_unlocked_at: None,
                reason: "Trial expired".to_string(),
            }
        }
    }

    /// 计算试用过期时间，仅 Windows 平台用于状态计算。
    #[cfg(target_os = "windows")]
    fn trial_expires_at(state: &LicenseState) -> Option<String> {
        let started = state.trial_started_at.as_ref()?;
        let started_at = DateTime::parse_from_rfc3339(started).ok()?;
        let expires_at = started_at.with_timezone(&Utc) + chrono::Duration::days(TRIAL_DAYS);
        Some(expires_at.to_rfc3339())
    }

    /// Mark the Pro license as unlocked. Used by the Store IAP flow once a
    /// successful purchase is confirmed, or by a manual license-key activation.
    #[cfg_attr(not(target_os = "windows"), allow(dead_code))]
    pub async fn unlock_pro(
        &self,
        store_order_id: Option<String>,
        license_key: Option<String>,
    ) -> Result<LicenseStatus, String> {
        let mut state = self.state.write().await;
        // 先构造新状态并写盘，写盘成功后才修改内存状态，确保两者一致。
        let mut new_state = state.clone();
        new_state.pro_unlocked_at = Some(Utc::now().to_rfc3339());
        new_state.store_order_id = store_order_id;
        new_state.license_key = license_key;

        Self::save_state(&self.state_path, &new_state)?;

        let status = Self::compute_status(&new_state);
        *state = new_state;
        drop(state);

        tracing::info!("[licensing] Pro unlocked");
        Ok(status)
    }

    /// Reset the license state. Used by restore-purchase flows when the Store
    /// reports no active entitlement, or for development/testing.
    pub async fn reset(&self) -> Result<LicenseStatus, String> {
        let mut state = self.state.write().await;
        // 先构造新状态并写盘，写盘成功后才修改内存状态，确保两者一致。
        let new_state = LicenseState {
            trial_started_at: Some(Utc::now().to_rfc3339()),
            pro_unlocked_at: None,
            store_order_id: None,
            license_key: None,
        };

        Self::save_state(&self.state_path, &new_state)?;

        let status = Self::compute_status(&new_state);
        *state = new_state;
        drop(state);

        tracing::info!("[licensing] license state reset");
        Ok(status)
    }

    /// Extend the trial by a given number of days. Useful as a promotional
    /// mechanic or for users who request an extension via support.
    pub async fn extend_trial(&self, days: i64) -> Result<LicenseStatus, String> {
        if days <= 0 {
            return Err("extension days must be positive".to_string());
        }
        let mut state = self.state.write().await;
        let now = Utc::now();
        let base = state
            .trial_started_at
            .as_ref()
            .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
            .map(|dt| dt.with_timezone(&Utc))
            .unwrap_or(now);
        // 先构造新状态并写盘，写盘成功后才修改内存状态，确保两者一致。
        let mut new_state = state.clone();
        // Shift the start time forward by `days` to extend the window.
        let new_start = base + chrono::Duration::days(days);
        new_state.trial_started_at = Some(new_start.to_rfc3339());

        Self::save_state(&self.state_path, &new_state)?;

        let status = Self::compute_status(&new_state);
        *state = new_state;
        drop(state);

        tracing::info!("[licensing] trial extended by {} days", days);
        Ok(status)
    }
}
