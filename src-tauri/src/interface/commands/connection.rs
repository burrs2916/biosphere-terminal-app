use crate::app::connection_service::ConnectionService;
use crate::core::types::{ConnectionConfig, SshConnectionInfo};
use crate::infra::logging::debug_log;
use crate::infra::storage::database::Database;
use tauri::State;
use uuid::Uuid;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use std::net::TcpStream;
use std::thread;
use std::sync::mpsc;
use crate::app::ssh_common;


#[tauri::command]
pub fn list_connections(db: State<'_, Arc<Database>>) -> Result<Vec<ConnectionConfig>, String> {
    ConnectionService::list_connections(&db).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_connection(
    config: ConnectionConfig,
    db: State<'_, Arc<Database>>,
) -> Result<(), String> {
    ConnectionService::save_connection(&db, &config).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_connection(
    id: String,
    db: State<'_, Arc<Database>>,
) -> Result<(), String> {
    ConnectionService::delete_connection(&db, &id).map_err(|e| e.to_string())
}

/// 读取某连接持久化的远程桌面安装档位（"none" | "minimal" | "full"）。
/// 未设置 / 非法时返回 null，前端回退默认 full。
#[tauri::command]
pub fn get_rd_install_flavor(
    connection_id: String,
    db: State<'_, Arc<Database>>,
) -> Result<Option<String>, String> {
    ConnectionService::get_rd_install_flavor(&db, &connection_id).map_err(|e| e.to_string())
}

/// 把用户在安装向导里选择的远程桌面档位写回该连接（持久化到 config_json）。
#[tauri::command]
pub fn set_rd_install_flavor(
    connection_id: String,
    flavor: String,
    db: State<'_, Arc<Database>>,
) -> Result<(), String> {
    ConnectionService::set_rd_install_flavor(&db, &connection_id, &flavor).map_err(|e| e.to_string())
}

/// Test an SSH connection.
///
/// This command waits on a channel with a 15s budget, and on Windows the
/// password branch additionally drives a ConPTY session. Tauri runs
/// *synchronous* commands on the main (event-loop) thread, so a blocking wait
/// here froze the whole app for up to 15 seconds — the window showed "not
/// responding" exactly when the user clicked "测试连接". The blocking wait
/// therefore runs on a worker thread via `spawn_blocking`; the UI thread stays
/// responsive and the frontend keeps showing a spinner.
#[tauri::command]
pub async fn test_connection(ssh: SshConnectionInfo) -> Result<String, String> {
    tracing::info!(
        "[TEST-CONN] test_connection ENTER auth_method={:?} host={} port={} user={}",
        ssh.auth_method, ssh.host, ssh.port, ssh.username
    );
    // 顶层硬超时兜底：无论内部哪条分支（密钥 / 密码 / 仅 TCP）因平台差异或
    // ssh/pty 行为异常而挂起，命令线程最多阻塞 15s 后必定返回，绝不卡死前端 invoke。
    // 内部线程在超时后会被 detached，待其自身结束后退出，不影响命令返回。
    let (tx, rx) = mpsc::channel();
    let ssh_clone = ssh.clone();
    thread::spawn(move || {
        let result = run_test_connection(ssh_clone);
        tracing::info!(
            "[TEST-CONN] run_test_connection returned ok={}",
            result.is_ok()
        );
        let _ = tx.send(result);
    });
    let start = Instant::now();
    match tokio::task::spawn_blocking(move || rx.recv_timeout(Duration::from_secs(15))).await {
        Ok(Ok(r)) => {
            tracing::info!(
                "[TEST-CONN] test_connection RETURN (inner ok={}) elapsed={:?}",
                r.is_ok(),
                start.elapsed()
            );
            debug_log::term(
                if r.is_ok() { "INFO" } else { "ERROR" },
                "conn",
                "result",
                &format!(
                    "ok={} elapsed={:?} err={:?}",
                    r.is_ok(),
                    start.elapsed(),
                    r.as_ref().err()
                ),
            );
            r
        }
        Ok(Err(_)) => {
            tracing::warn!(
                "[TEST-CONN] test_connection HARD-TIMEOUT elapsed={:?} -> returning timeout error (frontend must NOT freeze)",
                start.elapsed()
            );
            debug_log::term(
                "ERROR",
                "conn",
                "result-timeout",
                &format!("elapsed={:?} timeoutMs=15000", start.elapsed()),
            );
            Err("测试连接超时（主机不可达或网络不通），请检查网络后重试".to_string())
        }
        Err(e) => {
            // The blocking worker itself panicked — surface it instead of
            // leaving the invoke pending forever.
            tracing::error!("[TEST-CONN] test_connection wait task failed: {}", e);
            debug_log::term(
                "ERROR",
                "conn",
                "result-task-error",
                &format!("err={}", e),
            );
            Err(format!("测试连接任务异常: {}", e))
        }
    }
}

/// 密码模式：ssh 非零退出时，按「是否见过密码提示 + 会话记录」归类精准文案，
/// 避免把「密码错」和「主机不可达」混成一句误导性的「主机不可达」。
///
/// - 见过密码提示（且已喂）→ 失败发生在认证层：区分 `Permission denied`
///   （密码错 / 账户禁止密码登录）与其余（账户锁定、PAM 拒绝等）。
/// - 从未见过密码提示 → 失败发生在认证之前（主机不可达 / 端口未监听 /
///   防火墙拦截 / DNS 解析失败），此时绝不说是「密码不正确」。
fn classify_password_auth_failure(ssh: &SshConnectionInfo, saw_prompt: bool, diag: &str) -> String {
    if saw_prompt {
        if diag.to_lowercase().contains("permission denied") {
            format!(
                "✗ SSH 密码认证失败（密码不正确，或该账户被禁止密码登录）：{}@{}:{}",
                ssh.username, ssh.host, ssh.port
            )
        } else {
            format!(
                "✗ SSH 密码认证失败（服务器拒绝该凭证）：{}@{}:{}",
                ssh.username, ssh.host, ssh.port
            )
        }
    } else {
        format!(
            "✗ SSH 连接失败（主机不可达、端口未监听，或被防火墙拦截）：{}@{}:{}",
            ssh.username, ssh.host, ssh.port
        )
    }
}

/// 密钥模式：ssh 非零退出时，按 stderr 归类精准文案。OpenSSH 关键错误为英文固定串
/// （与客户端 locale 无关，且本路径已固定 `LC_MESSAGES=C`），故直接子串匹配；
/// 命中失败则回退到「密钥不正确、主机不可达或被拒绝」通用文案（与旧行为一致，不退化）。
fn classify_key_auth_failure(ssh: &SshConnectionInfo, stderr: &str) -> String {
    let stderr = stderr.to_lowercase();
    if stderr.contains("permission denied") {
        format!(
            "✗ SSH 密钥认证失败（密钥不正确，或该账户不允许密钥登录）：{}@{}:{}",
            ssh.username, ssh.host, ssh.port
        )
    } else if stderr.contains("connection refused")
        || stderr.contains("connection timed out")
        || stderr.contains("no route to host")
        || stderr.contains("connection closed")
    {
        format!(
            "✗ SSH 连接失败（主机不可达、端口未监听，或被防火墙拦截）：{}@{}:{}",
            ssh.username, ssh.host, ssh.port
        )
    } else if stderr.starts_with("进程") || stderr.starts_with("连接") {
        format!(
            "✗ SSH 密钥认证失败（无法启动 SSH 或握手超时）：{}@{}:{}",
            ssh.username, ssh.host, ssh.port
        )
    } else {
        format!(
            "✗ SSH 密钥认证失败（密钥不正确、主机不可达或被拒绝）：{}@{}:{}",
            ssh.username, ssh.host, ssh.port
        )
    }
}

fn run_test_connection(ssh: SshConnectionInfo) -> Result<String, String> {
    tracing::info!(
        "[TEST-CONN] run_test_connection ENTER auth_method={:?}",
        ssh.auth_method
    );
    debug_log::term(
        "INFO",
        "conn",
        "enter",
        &format!(
            "auth_method={:?} host={} port={} user={}",
            ssh.auth_method, ssh.host, ssh.port, ssh.username
        ),
    );
    // 非密码 / 密钥（none / local 等）：只做 TCP 端口探测，明确告知未验证身份。
    if ssh.auth_method != "private_key" && ssh.auth_method != "password" {
        return tcp_only_test(&ssh);
    }
    // 密码 / 密钥统一走共享的 russh 握手+认证（与 SFTP / 终端同源），
    // 不再 spawn 系统 ssh.exe + portable-pty。错误已由 ssh_common 按
    // 连接级 / 认证级精确归类，这里再映射到 UI 本地化的 `✗ SSH …` 文案。
    let auth_label = if ssh.auth_method == "private_key" { "密钥" } else { "密码" };
    let s = ssh.clone();
    match ssh_common::wait_on(async move { ssh_common::establish(&s).await }) {
        Ok(Ok(_handle)) => Ok(format!(
            "✓ SSH {}认证成功：{}@{}:{}",
            auth_label, ssh.username, ssh.host, ssh.port
        )),
        Ok(Err(e)) => {
            let msg = map_establish_error(&ssh, &e);
            debug_log::term(
                "ERROR",
                "conn",
                "auth-failed",
                &format!("auth={} msg={}", ssh.auth_method, msg),
            );
            Err(msg)
        }
        Err(e) => Err(format!("SSH 测试连接内部错误：{}", e)),
    }
}

/// 把 `ssh_common::establish` 已归类的错误字符串映射到测试连接的 `✗ SSH …` 文案，
/// 复用既有 `classify_*` 辅助与 backendError.ts 的本地化规则，保持行为一致。
fn map_establish_error(ssh: &SshConnectionInfo, e: &str) -> String {
    // host key 变更：保留专属可操作文案（backendError 规则 `^✗ SSH 主机密钥校验失败`）。
    if e.contains("主机密钥") {
        return format!(
            "✗ SSH 主机密钥校验失败（远程主机密钥已变更，很可能系统已重置）：{}@{}:{}",
            ssh.username, ssh.host, ssh.port
        );
    }
    // 其余按「认证级」vs「连接级」区分：ssh_common 已给出精确的中文归类，
    // 这里只决定落到哪一个 `✗ SSH …` 前缀，避免把「密码错」说成「主机不可达」。
    let is_auth = e.contains("认证失败")
        || e.contains("Permission denied")
        || e.contains("被拒绝")
        || e.contains("未通过")
        || e.contains("未保存密码")
        || e.contains("私钥");
    if is_auth {
        if ssh.auth_method == "private_key" {
            classify_key_auth_failure(ssh, e)
        } else {
            classify_password_auth_failure(ssh, true, e)
        }
    } else {
        classify_password_auth_failure(ssh, false, e)
    }
}



/// 退化方案：仅做 TCP 端口探测，并明确告知用户未验证身份
///
/// 注意：std 的 `TcpStream::connect_timeout` 在 macOS/BSD 上对不可达主机不可靠
/// （可能远超过设定超时），且 `parse::<SocketAddr>()` 不支持域名。这里改为独立线程
/// 执行 connect，主线程用 `recv_timeout` 兜底；超时即返回错误并 detach 连接线程，
/// 避免命令线程卡死。同时直接接受 "host:port" 字符串以正确解析域名。
fn tcp_only_test(ssh: &SshConnectionInfo) -> Result<String, String> {
    let addr = format!("{}:{}", ssh.host, ssh.port);
    tracing::info!("[TEST-CONN] tcp_only_test: connecting {} (timeout 6s)...", addr);
    let (tx, rx) = mpsc::channel();
    let handle = thread::spawn(move || {
        let r = TcpStream::connect(addr.as_str());
        tracing::info!(
            "[TEST-CONN] tcp_only_test: TcpStream::connect returned {}",
            if r.is_ok() { "ok" } else { "err" }
        );
        let _ = tx.send(r.map(|_| ()).map_err(|e| e.to_string()));
    });
    match rx.recv_timeout(Duration::from_secs(6)) {
        Ok(Ok(())) => {
            tracing::info!("[TEST-CONN] tcp_only_test: port reachable (no identity verification)");
            debug_log::term(
                "INFO",
                "conn",
                "tcp-reachable",
                &format!("host={} port={} note=no-auth", ssh.host, ssh.port),
            );
            Err(format!(
                "端口 {}:{} 可达，但未提供密码，无法验证身份。请在连接配置中填写密码，或改用密钥登录。",
                ssh.host, ssh.port
            ))
        }
        Ok(Err(e)) => {
            tracing::warn!("[TEST-CONN] tcp_only_test: connect err: {}", e);
            Err(format!("无法连接到 {}:{} - {}", ssh.host, ssh.port, e))
        }
        Err(_) => {
            // 超时：detach 连接线程（它最终会自行失败退出），主线程立即返回，避免卡死。
            drop(handle);
            tracing::warn!(
                "[TEST-CONN] tcp_only_test: recv_timeout(6s) HIT -> 返回连接超时（detached connect thread）"
            );
            Err(format!(
                "无法连接到 {}:{} - 连接超时（主机不可达或网络不通）",
                ssh.host, ssh.port
            ))
        }
    }
}

/// 一次性凭据暂存：打开 SFTP / 远程桌面子窗口时，前端把含密码/密钥的
/// `SshConnectionInfo` 暂存于此（按随机 token 索引），URL 里只传 token，
/// 不再把明文密码写进 URL query（避免进 devtools / 浏览器历史 / 潜在日志）。
///
/// 子窗口用 token 一次性取回后即删除；并带 5 分钟 TTL 兜底清理（防止异常路径下
/// 残留）。token 是一次性随机数，即便被截获也仅在被合法窗口消费前短暂可用。
///
/// 安全约定：本结构内的密码绝不写入任何日志（见 crate 级「密码绝不入日志」铁律）。
pub struct CredentialStash {
    inner: Mutex<HashMap<String, (SshConnectionInfo, Instant)>>,
}

impl Default for CredentialStash {
    fn default() -> Self {
        Self {
            inner: Mutex::new(HashMap::new()),
        }
    }
}

impl CredentialStash {
    /// 暂存凭据并返回一次性 token。
    fn stash(&self, ssh: SshConnectionInfo) -> String {
        let token = Uuid::new_v4().to_string();
        self.inner
            .lock()
            .expect("credential stash poisoned")
            .insert(token.clone(), (ssh, Instant::now()));
        token
    }

    /// 一次性取回凭据：取回后即从暂存中删除；不存在（已消费 / 不存在 / 已过期）返回 None。
    fn take(&self, token: &str) -> Option<SshConnectionInfo> {
        let mut g = self.inner.lock().expect("credential stash poisoned");
        let now = Instant::now();
        g.retain(|_, (_, t)| now.duration_since(*t) < Duration::from_secs(300));
        g.remove(token).map(|(s, _)| s)
    }
}

/// 把前端传来的含密码/密钥的 SSH 凭据暂存到进程内，返回一次性 token。
/// 调用方（打开子窗口）应只把 token 写进 URL，绝不写密码。
#[tauri::command]
pub fn stash_sftp_credentials(
    ssh: SshConnectionInfo,
    stash: State<'_, CredentialStash>,
) -> Result<String, String> {
    Ok(stash.stash(ssh))
}

/// 子窗口凭一次性 token 取回完整 SSH 凭据。取回即销毁；token 无效 / 已过期返回明确错误。
#[tauri::command]
pub fn take_stashed_credentials(
    token: String,
    stash: State<'_, CredentialStash>,
) -> Result<SshConnectionInfo, String> {
    stash.take(&token).ok_or_else(|| {
        "凭据已失效或不存在，请重新打开文件传输 / 远程桌面窗口".to_string()
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn sample_ssh() -> SshConnectionInfo {
        SshConnectionInfo {
            host: "10.0.0.5".to_string(),
            port: 22,
            username: "ubuntu".to_string(),
            auth_method: "password".to_string(),
            private_key_path: None,
            password: None,
        }
    }

    // --- 密码模式：绝不把「密码错」说成「主机不可达」 ---

    #[test]
    fn password_wrong_password_is_not_host_unreachable() {
        let msg = classify_password_auth_failure(
            &sample_ssh(),
            true,
            "Permission denied, please try again.",
        );
        assert!(msg.contains("密码不正确"), "msg={}", msg);
        assert!(!msg.contains("主机不可达"), "msg={}", msg);
    }

    #[test]
    fn password_auth_rejected_without_permission_denied() {
        let msg = classify_password_auth_failure(
            &sample_ssh(),
            true,
            "Account locked due to 3 failed logins.",
        );
        assert!(msg.contains("服务器拒绝该凭证"), "msg={}", msg);
        assert!(!msg.contains("主机不可达"), "msg={}", msg);
    }

    #[test]
    fn password_no_prompt_means_connection_level_failure() {
        let msg = classify_password_auth_failure(&sample_ssh(), false, "ssh: connect to host ... Connection refused");
        assert!(msg.contains("连接失败（主机不可达"), "msg={}", msg);
        assert!(!msg.contains("密码不正确"), "msg={}", msg);
    }

    // --- 密钥模式：同样区分「密钥错」与「主机不可达」 ---

    #[test]
    fn key_wrong_key_is_not_host_unreachable() {
        let msg = classify_key_auth_failure(
            &sample_ssh(),
            "Permission denied (publickey,password).",
        );
        assert!(msg.contains("密钥不正确"), "msg={}", msg);
        assert!(!msg.contains("主机不可达"), "msg={}", msg);
    }

    #[test]
    fn key_connection_refused_is_host_unreachable() {
        let msg = classify_key_auth_failure(
            &sample_ssh(),
            "ssh: connect to host 10.0.0.5 port 22: Connection refused",
        );
        assert!(msg.contains("连接失败（主机不可达"), "msg={}", msg);
    }

    #[test]
    fn key_connection_timed_out_is_host_unreachable() {
        let msg = classify_key_auth_failure(&sample_ssh(), "Connection timed out");
        assert!(msg.contains("连接失败（主机不可达"), "msg={}", msg);
    }

    #[test]
    fn key_unknown_stderr_falls_back_to_generic() {
        let msg = classify_key_auth_failure(&sample_ssh(), "some opaque libssh error");
        assert!(msg.contains("密钥不正确、主机不可达或被拒绝"), "msg={}", msg);
    }

    // --- 一次性凭据暂存：token 单次可用、二次失效、未知 token 返回 None ---

    #[test]
    fn credential_stash_is_single_use_and_rejects_unknown_token() {
        let stash = CredentialStash::default();
        let ssh = SshConnectionInfo {
            host: "10.0.0.9".to_string(),
            port: 22,
            username: "u".to_string(),
            auth_method: "password".to_string(),
            private_key_path: None,
            password: Some("secret".to_string()),
        };
        let token = stash.stash(ssh);
        let got = stash
            .take(&token)
            .expect("first take must return the stashed credentials");
        assert_eq!(got.password.as_deref(), Some("secret"));

        // 取回后销毁：二次取回必须失败。
        assert!(
            stash.take(&token).is_none(),
            "token must be single-use"
        );
        // 未知 token 必须返回 None（上层据此报「凭据已失效」）。
        assert!(stash.take("does-not-exist").is_none());
    }
}
