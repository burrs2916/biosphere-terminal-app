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
///
/// 商业模式：
/// - 终端、SSH（无数量限制）、笔记（无数量限制）属于免费基础功能
/// - 以下 4 项为 Pro 高级功能，试用期内全部开放，试用结束后需付费解锁
export type ProFeature =
  | 'remote_desktop'      // 远程桌面 (VNC)
  | 'sftp'                // SFTP 文件传输
  | 'ai_copilot'          // AI Copilot 终端助手 / Agent 对话
  | 'note_ai_optimize'    // 笔记 AI 优化
  | 'note_reference';     // 笔记参考 / 命令-笔记 AI 关联
