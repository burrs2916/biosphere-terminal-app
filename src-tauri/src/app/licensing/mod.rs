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
use tokio::sync::RwLock;

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
        #[cfg_attr(not(target_os = "windows"), allow(unused_mut))]
        let mut state = state;
        #[cfg(target_os = "windows")]
        if state.trial_started_at.is_none() {
            state.trial_started_at = Some(Utc::now().to_rfc3339());
            if let Err(err) = Self::save_state(&state_path, &state) {
                tracing::warn!("[licensing] failed to persist initial trial start: {}", err);
            }
            tracing::info!("[licensing] trial started at first launch");
        }

        LicensingService {
            state: Arc::new(RwLock::new(state)),
            state_path,
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
        std::fs::write(path, json)
            .map_err(|e| format!("write license state: {}", e))?;
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
        let remaining = (expires_at - now).num_days();

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
    pub async fn unlock_pro(
        &self,
        store_order_id: Option<String>,
        license_key: Option<String>,
    ) -> Result<LicenseStatus, String> {
        let mut state = self.state.write().await;
        state.pro_unlocked_at = Some(Utc::now().to_rfc3339());
        state.store_order_id = store_order_id;
        state.license_key = license_key;
        let snapshot = state.clone();
        drop(state);

        Self::save_state(&self.state_path, &snapshot)?;
        tracing::info!("[licensing] Pro unlocked");

        Ok(Self::compute_status(&snapshot))
    }

    /// Reset the license state. Used by restore-purchase flows when the Store
    /// reports no active entitlement, or for development/testing.
    pub async fn reset(&self) -> Result<LicenseStatus, String> {
        let mut state = self.state.write().await;
        *state = LicenseState {
            trial_started_at: Some(Utc::now().to_rfc3339()),
            pro_unlocked_at: None,
            store_order_id: None,
            license_key: None,
        };
        let snapshot = state.clone();
        drop(state);

        Self::save_state(&self.state_path, &snapshot)?;
        tracing::info!("[licensing] license state reset");

        Ok(Self::compute_status(&snapshot))
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
        // Shift the start time forward by `days` to extend the window.
        let new_start = base + chrono::Duration::days(days);
        state.trial_started_at = Some(new_start.to_rfc3339());
        let snapshot = state.clone();
        drop(state);

        Self::save_state(&self.state_path, &snapshot)?;
        tracing::info!("[licensing] trial extended by {} days", days);

        Ok(Self::compute_status(&snapshot))
    }
}
