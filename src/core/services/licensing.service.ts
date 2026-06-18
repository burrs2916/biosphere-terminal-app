import { invoke } from '@tauri-apps/api/core';
import type { LicenseStatus } from '../../proto/licensing';

/// Fetch the current license status from the backend.
export async function checkProStatus(): Promise<LicenseStatus> {
  return invoke<LicenseStatus>('check_pro_status');
}

/// 触发 Microsoft Store 真实购买流程（仅 Windows 商店版本可用）。
/// 后端会调用 Windows.Services.Store.RequestPurchaseAsync 弹出 Store 窗口，
/// 用户支付完成后再复核 entitlement，全部成功才返回新的 LicenseStatus。
/// 错误情况：用户取消、网络异常、未登录、侧载等都会以 throw 形式上抛。
export async function purchaseProLifetime(): Promise<LicenseStatus> {
  return invoke<LicenseStatus>('purchase_pro_lifetime');
}

/// Restore previous purchases from Microsoft Store.
/// 后端调用 GetUserCollectionAsync 查询当前 Microsoft 账号的 entitlement，
/// 仅当 Store 确认拥有 Pro add-on 时才解锁本地状态。
/// 没有有效订单时返回错误，UI 应当提示"未找到购买记录"。
export async function restoreProLicense(): Promise<LicenseStatus> {
  return invoke<LicenseStatus>('restore_pro_license');
}

/// Reset the license state. Production builds will return an error string;
/// only debug builds actually perform the reset.
export async function resetLicense(): Promise<LicenseStatus> {
  return invoke<LicenseStatus>('reset_license');
}

/// Extend the trial by a given number of days. Production builds reject this.
export async function extendTrial(days: number): Promise<LicenseStatus> {
  return invoke<LicenseStatus>('extend_trial', { days });
}

/// Return the configured Microsoft Store product ID for the Pro lifetime
/// add-on. Used for "View on Store" deep links.
export async function getProProductId(): Promise<string> {
  return invoke<string>('get_pro_product_id');
}
