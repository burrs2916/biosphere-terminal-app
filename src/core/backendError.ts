import i18n from './i18n';

/**
 * Front-end localization layer for backend (Rust) error messages.
 *
 * The Rust backend returns error text in two languages depending on the code
 * path: most paths return Chinese, a few (licensing / agent connection test /
 * remote-desktop tunnel) return English. This module maps the known, stable
 * backend error strings to localized messages via the existing i18next
 * pipeline, in BOTH directions:
 *   - Chinese raw  -> localized (Stage A, covers most paths)
 *   - English raw  -> localized (reverse direction, covers the English paths)
 *
 * Design guarantees (low-risk, no data loss, no regression):
 *  - CJK strings are matched against RULES (Chinese prefixes).
 *  - Non-CJK strings are matched against EN_RULES (English prefixes).
 *  - Unknown / unmatched errors are returned unchanged (graceful fallback).
 *  - If a locale key is somehow missing, the original string is returned.
 */

interface BackendErrorRule {
  /** Anchored at the start; matches the stable prefix of the error. */
  re: RegExp;
  key: string;
  ns?: string;
}

const RULES: BackendErrorRule[] = [
  // --- connection / SSH / TCP (src-tauri/src/interface/commands/connection.rs) ---
  { re: /^测试连接超时/, key: 'connection.test_timeout' },
  { re: /^无法建立测试会话/, key: 'connection.test_session_failed' },
  { re: /^SSH 连接超时/, key: 'connection.ssh_connect_timeout' },
  { re: /^SSH 认证超时/, key: 'connection.ssh_auth_timeout' },
  { re: /^无法定位 ssh 程序/, key: 'connection.ssh_not_found' },
  { re: /^无法启动进程/, key: 'connection.process_start_failed' },
  { re: /^进程 .* 错误/, key: 'connection.process_error' },
  { re: /^连接 .* 超时/, key: 'connection.connect_timeout' },
  { re: /^无法连接到/, key: 'connection.connect_failed' },
  { re: /^端口 .* 可达，但未提供密码/, key: 'connection.tcp_no_sshpass' },
  // 测试连接：密钥 / 密码认证失败（返回 Err，英文 UI 会露中文）
  // 注意：源码 connection.rs:107 实际文案为「✗ SSH 认证失败（密钥不正确…）」（密钥分支），
  // 仅前缀「SSH 认证失败」稳定，故用宽松前缀匹配（不会误中「SSH 密码认证失败」）。
  { re: /^✗ SSH 认证失败/, key: 'connection.ssh_key_auth_failed' },
  { re: /^✗ SSH 密码认证失败/, key: 'connection.ssh_password_auth_failed' },
  // 测试连接：host key 变更（云服务器重置系统后最常见）。专属可操作报错，
  // 避免被误判为「密码不正确或主机不可达」，误导用户。
  { re: /^✗ SSH 主机密钥校验失败/, key: 'connection.ssh_host_key_changed' },
  // 测试连接：密钥 / 密码认证成功（返回 Ok，英文 UI 会露中文）
  { re: /^✓ SSH 密钥认证成功/, key: 'connection.ssh_key_auth_success' },
  { re: /^✓ SSH 密码认证成功/, key: 'connection.ssh_password_auth_success' },

  // --- notebook (src-tauri/src/app/notebook_service.rs) --- reuses existing key
  { re: /^默认分组/, key: 'group.delete_protected', ns: 'notebook' },
  { re: /^目标分组不存在/, key: 'group.target_not_found', ns: 'notebook' },

  // --- crypto (src-tauri/src/infra/security/crypto.rs) ---
  { re: /^crypto 未初始化，无法加密/, key: 'crypto_not_init_encrypt' },
  { re: /^crypto 未初始化，无法解密/, key: 'crypto_not_init_decrypt' },
  { re: /^无法读取密钥文件/, key: 'crypto_keyfile_read_failed' },
  { re: /^密钥文件损坏/, key: 'crypto_keyfile_corrupted' },
  { re: /^生成密钥失败/, key: 'crypto_keygen_failed' },
  { re: /^无法写入密钥文件/, key: 'crypto_keyfile_write_failed' },
  { re: /^无法设置密钥文件权限/, key: 'crypto_keyfile_chmod_failed' },
  { re: /^密码加密失败/, key: 'crypto_encrypt_failed' },
  { re: /^密文 base64 解码失败/, key: 'crypto_base64_decode_failed' },
  { re: /^密码解密失败/, key: 'crypto_decrypt_failed' },
  { re: /^解密结果非 UTF-8/, key: 'crypto_decrypt_not_utf8' },
  { re: /^hex 字符串长度为奇数/, key: 'hex_odd_length' },
  { re: /^非法 hex 字符/, key: 'hex_invalid_char' },
  { re: /^密钥长度异常/, key: 'crypto_key_length_invalid' },
  { re: /^密文长度异常/, key: 'crypto_cipher_too_short' },
];

/**
 * Reverse-direction rules: stable English backend error prefixes that leak
 * into a non-English (e.g. Chinese) UI. Mapping them to keys lets i18next
 * return the Chinese translation in a Chinese UI while still showing English
 * in an English UI (the en value equals / approximates the original text).
 *
 * Sources:
 *   - src-tauri/src/interface/commands/licensing.rs (L51/L82/L89)
 *   - src-tauri/src/app/remote_desktop_service.rs (L475)
 *   - src-tauri/src/app/agent_service.rs (connection / model test)
 */
const EN_RULES: BackendErrorRule[] = [
  // --- licensing command (src-tauri/src/interface/commands/licensing.rs) ---
  { re: /^In-app purchases are only available on the Windows Microsoft Store build\./, key: 'licensing_store_only' },
  { re: /^No active Pro entitlement found on this Microsoft account\./, key: 'licensing_no_entitlement' },
  { re: /^Restore Purchase is only available on the Windows Microsoft Store build\./, key: 'licensing_restore_store_only' },

  // --- remote desktop tunnel (src-tauri/src/app/remote_desktop_service.rs) ---
  { re: /^SSH tunnel failed to establish\./, key: 'remote_desktop_ssh_tunnel_failed' },

  // --- agent provider connection / model test (src-tauri/src/app/agent_service.rs) ---
  { re: /^Connection failed/, key: 'agent_connection_failed' },
  { re: /^Request failed/, key: 'agent_request_failed' },
  { re: /^Endpoint not found/, key: 'agent_endpoint_not_found' },
  { re: /^Provider not found/, key: 'agent_provider_not_found' },
  // 注意：源串为 "Model {} not found"（含 {} 插值），故前缀需容忍任意字符，
  // 否则 /^Model not found/ 无法匹配 "Model {} not found"（R47 修正）。
  { re: /^Model .*not found/, key: 'agent_model_not_found' },

  // --- icon service (src-tauri/src/app/icon_service.rs) ---
  { re: /^Icon file size cannot exceed 512KB/, key: 'icon_file_size' },
  { re: /^Icon group not found/, key: 'icon_group_not_found' },
  { re: /^Icon file not found/, key: 'icon_file_not_found' },

  // --- Windows Store IAP (src-tauri/src/app/licensing/windows_store.rs) ---
  { re: /^The Pro add-on was not found in the Microsoft Store/, key: 'store_addon_not_found' },
  { re: /^Could not reach the Microsoft Store/, key: 'store_unreachable' },
  { re: /^Microsoft Store server error/, key: 'store_server_error' },
  { re: /^Store API error:/, key: 'store_api_error' },
  { re: /^Unexpected purchase status:/, key: 'store_unexpected_status' },
  { re: /^User cancelled the purchase/, key: 'store_user_cancelled' },
  { re: /^HRESULT 0x/, key: 'store_api_error' },

  // --- notebook not-found (src-tauri/src/app/notebook_service.rs) ---
  { re: /^Note not found/, key: 'note_not_found' },
  { re: /^Group not found/, key: 'group_not_found' },
  { re: /^Tag not found/, key: 'tag_not_found' },
  { re: /^Category not found/, key: 'category_not_found' },
  // 重命名冲突：源串含 {} 插值（Tag name 'xxx' already exists in this group）
  { re: /^Tag name '.*' already exists in this group/, key: 'notebook_tag_exists' },
  { re: /^Category name '.*' already exists in this group/, key: 'notebook_category_exists' },

  // --- agent (src-tauri/src/app/agent_service.rs, interface/commands/agent.rs) ---
  { re: /^Agent not found/, key: 'agent_not_found' },
  { re: /^Model test failed/, key: 'agent_model_test_failed' },

  // --- remote desktop tunnel (src-tauri/src/app/remote_desktop_service.rs) ---
  { re: /^SSH connection failed/, key: 'remote_desktop_ssh_connection_failed' },
  { re: /^Failed to bind WS port/, key: 'remote_desktop_bind_ws_port_failed' },
  { re: /^WS handshake failed/, key: 'remote_desktop_ws_handshake_failed' },
  { re: /^TCP connect to/, key: 'remote_desktop_tcp_connect_failed' },
  { re: /^Failed to find available port/, key: 'remote_desktop_port_not_found' },
  { re: /^openpty failed/, key: 'remote_desktop_openpty_failed' },
  { re: /^SSH spawn failed/, key: 'remote_desktop_ssh_spawn_failed' },

  // --- icon service (src-tauri/src/app/icon_service.rs) ---
  { re: /^Failed to create icon directory/, key: 'icon_create_dir_failed' },
  { re: /^Failed to write icon file/, key: 'icon_write_failed' },
  { re: /^Failed to read icon file/, key: 'icon_read_failed' },

  // --- platform (src-tauri/src/core/platform.rs): EN counterpart of connection.ssh_not_found ---
  { re: /^SSH client \(ssh\) not found/, key: 'ssh_client_not_found' },
];

const CJK_RE = /[一-鿿]/;

/**
 * Returns a localized version of a backend error, or the original string when
 * no rule matches (so no diagnostic detail is ever lost).
 */
export function localizeBackendError(raw: unknown): string {
  const s =
    raw instanceof Error
      ? raw.message
      : typeof raw === 'string'
        ? raw
        : String(raw);

  if (!s) return s;

  const apply = (rules: BackendErrorRule[]): string | null => {
    for (const r of rules) {
      if (r.re.test(s)) {
        const ns = r.ns ?? 'backend';
        const t = i18n.t(r.key, { ns });
        const fallbackId = `${ns}:${r.key}`;
        if (t && t !== r.key && t !== fallbackId) return t;
      }
    }
    return null;
  };

  // Stage A: Chinese raw -> localized.
  if (CJK_RE.test(s)) {
    return apply(RULES) ?? s;
  }

  // Reverse direction: English raw -> localized (so Chinese UI shows Chinese).
  return apply(EN_RULES) ?? s;
}

export default localizeBackendError;
