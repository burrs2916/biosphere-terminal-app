use crate::app::connection_service::ConnectionService;
use crate::core::types::{ConnectionConfig, SshConnectionInfo};
use crate::infra::storage::database::Database;
use tauri::State;
use std::sync::Arc;
use std::net::TcpStream;
use std::time::{Duration, Instant};
use std::io::{Read, Write};
use std::process::{Command, Stdio};
use std::thread;
use std::sync::mpsc;

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

#[tauri::command]
pub fn test_connection(ssh: SshConnectionInfo) -> Result<String, String> {
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
    match rx.recv_timeout(Duration::from_secs(15)) {
        Ok(r) => {
            tracing::info!(
                "[TEST-CONN] test_connection RETURN (inner ok={}) elapsed={:?}",
                r.is_ok(),
                start.elapsed()
            );
            r
        }
        Err(_) => {
            tracing::warn!(
                "[TEST-CONN] test_connection HARD-TIMEOUT elapsed={:?} -> returning timeout error (frontend must NOT freeze)",
                start.elapsed()
            );
            Err("测试连接超时（主机不可达或网络不通），请检查网络后重试".to_string())
        }
    }
}

fn run_test_connection(ssh: SshConnectionInfo) -> Result<String, String> {
    tracing::info!(
        "[TEST-CONN] run_test_connection ENTER auth_method={:?}",
        ssh.auth_method
    );
    // 密钥模式：BatchMode=yes 跑一次真实握手+认证（零外部依赖，仅系统自带 ssh）
    if ssh.auth_method == "private_key" {
        let mut args: Vec<String> = vec![
            "-o".to_string(),
            "StrictHostKeyChecking=accept-new".to_string(),
            "-o".to_string(),
            "BatchMode=yes".to_string(),
            "-o".to_string(),
            "ConnectTimeout=5".to_string(),
        ];
        if ssh.port != 22 {
            args.push("-p".to_string());
            args.push(ssh.port.to_string());
        }
        if let Some(key) = &ssh.private_key_path {
            args.push("-i".to_string());
            args.push(key.clone());
        }
        args.push(format!("{}@{}", ssh.username, ssh.host));
        args.push("true".to_string());

        let ssh_bin = crate::core::platform::resolve_ssh_binary()
            .map_err(|e| format!("无法定位 ssh 程序: {}", e))?;
        return match run_command_with_timeout(&ssh_bin, &args, Duration::from_secs(8)) {
            Ok(true) => Ok(format!(
                "✓ SSH 密钥认证成功：{}@{}:{}",
                ssh.username, ssh.host, ssh.port
            )),
            Ok(false) => Err(format!(
                "✗ SSH 认证失败（密钥不正确、主机不可达或被拒绝）{}@{}:{}",
                ssh.username, ssh.host, ssh.port
            )),
            Err(e) => Err(e),
        };
    }

    // 密码模式：用 pty 起 ssh 会话，Rust 线程匹配密码提示自动喂密码
    // （sshpass 的零依赖实现，仅系统 ssh + portable-pty，跨平台零额外安装）
    if ssh.auth_method == "password" {
        tracing::info!("[TEST-CONN] branch=password (has_pw={})", ssh.password.is_some());
        return match &ssh.password {
            Some(pw) => match test_ssh_password(&ssh, pw, false) {
                Ok(true) => Ok(format!(
                    "✓ SSH 密码认证成功：{}@{}:{}",
                    ssh.username, ssh.host, ssh.port
                )),
                Ok(false) => Err(format!(
                    "✗ SSH 密码认证失败（密码不正确或主机不可达）{}@{}:{}",
                    ssh.username, ssh.host, ssh.port
                )),
                Err(e) => Err(e),
            },
            None => tcp_only_test(&ssh),
        };
    }

    // 其它（如 none / local）：退化为 TCP 端口探测
    tracing::info!("[TEST-CONN] branch=fallback -> tcp_only_test");
    tcp_only_test(&ssh)
}

/// 用 pty + expect 实现 sshpass 等效逻辑：起 `ssh user@host true` 会话，
/// 监控 pty 输出，匹配到密码提示时自动把密码写回。零外部依赖（仅系统 ssh + portable-pty）。
/// `retried` 为 true 表示已因 host key 变更自动清理并重试过一次。
fn test_ssh_password(
    ssh: &SshConnectionInfo,
    pw: &str,
    retried: bool,
) -> std::result::Result<bool, String> {
    tracing::info!("[TEST-CONN] test_ssh_password: spawning pty ssh session...");
    let pty = match crate::domain::terminal::pty::Pty::spawn_ssh_command_session(ssh, "true") {
        Ok(p) => Arc::new(p),
        Err(e) => {
            tracing::error!("[TEST-CONN] test_ssh_password: spawn_ssh_command_session FAILED: {}", e);
            return Err(format!("无法建立测试会话: {}", e));
        }
    };
    tracing::info!("[TEST-CONN] test_ssh_password: pty spawned ok, getting reader/writer");
    let reader = pty.reader();
    let writer = pty.writer_clone();
    let pw_owned = pw.to_string();

    // 退出检测线程：用 try_wait（底层 waitpid(WNOHANG)，绝不阻塞）轮询退出码，
    // 避免 portable-pty 的 wait() 在 PTY 仍被 feeder 持有时会因等待 EOF/回收而挂死
    // （实测：macOS 上 pty.wait() 对不可达/挂起主机 15s+ 不返回，导致测试卡死）。
    let pty_wait = pty.clone();
    let (tx, rx) = mpsc::channel();
    let (hk_tx, hk_rx) = mpsc::channel::<bool>();
    let hk_tx_feeder = hk_tx.clone();
    drop(hk_tx);
    thread::spawn(move || {
        let start = Instant::now();
        let overall = Duration::from_secs(12);
        let mut code: Option<i32> = None;
        while start.elapsed() < overall {
            match pty_wait.try_wait() {
                Ok(Some(c)) => {
                    code = Some(c);
                    break;
                }
                Ok(None) => {
                    thread::sleep(Duration::from_millis(250));
                }
                Err(e) => {
                    tracing::warn!("[TEST-CONN] test_ssh_password: try_wait error: {}", e);
                    break;
                }
            }
        }
        if code.is_none() {
            let _ = pty_wait.kill();
            tracing::warn!(
                "[TEST-CONN] test_ssh_password: try_wait loop ended without exit ({}s) -> killed, treat as timeout",
                overall.as_secs()
            );
        } else {
            tracing::info!(
                "[TEST-CONN] test_ssh_password: try_wait got exit code={:?}",
                code
            );
        }
        let _ = tx.send(code);
    });

    // 监控输出并自动喂密码的线程
    tracing::info!("[TEST-CONN] test_ssh_password: spawning feeder thread");
    let feeder = thread::spawn(move || {
        let mut buf = [0u8; 4096];
        let mut trailing = String::with_capacity(256);
        let mut hostkey_buf = String::with_capacity(1024);
        let mut filled = false;
        let mut guard = match reader.lock() {
            Ok(g) => g,
            Err(_) => return,
        };
        let deadline = Instant::now() + Duration::from_secs(8);
        while Instant::now() < deadline {
            match guard.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let output = String::from_utf8_lossy(&buf[..n]).to_string();
                    // 累积全部输出用于 host key 变更检测（host key 报错发生在握手阶段、
                    // 不弹密码提示，若只靠 trailing 256 字可能被截断，故用独立缓冲）。
                    hostkey_buf.push_str(&output);
                    if hostkey_buf.len() > 4096 {
                        hostkey_buf = hostkey_buf[hostkey_buf.len() - 4096..].to_string();
                    }
                    let hk_lower = hostkey_buf.to_lowercase();
                    if hk_lower.contains("host key verification failed")
                        || hk_lower.contains("remote host identification has changed")
                    {
                        let _ = hk_tx_feeder.send(true);
                        break;
                    }
                    if !filled {
                        trailing.push_str(&output);
                        if trailing.len() > 256 {
                            trailing = trailing[trailing.len() - 256..].to_string();
                        }
                        let needs = crate::domain::terminal::pty::is_password_prompt(&trailing);
                        if needs {
                            let bytes = format!("{}\n", pw_owned).into_bytes();
                            if let Ok(mut w) = writer.lock() {
                                let _ = w.write_all(&bytes);
                                let _ = w.flush();
                            }
                            filled = true;
                            trailing.clear();
                        }
                    }
                }
                Err(_) => break,
            }
        }
        // 兜底：未检测到 host key 变更，通知主线程（false 不影响退出码判断）。
        let _ = hk_tx_feeder.send(false);
    });

    let mut result = match rx.recv_timeout(Duration::from_secs(13)) {
        Ok(Some(0)) => {
            tracing::info!("[TEST-CONN] test_ssh_password: auth OK (exit 0)");
            Ok(true)
        }
        Ok(Some(code)) => {
            tracing::info!("[TEST-CONN] test_ssh_password: auth FAILED (exit {})", code);
            Ok(false)
        }
        Ok(None) => {
            let _ = pty.kill();
            tracing::warn!("[TEST-CONN] test_ssh_password: process still running after 12s -> killed as connection/auth timeout");
            Err("SSH 连接超时（主机不可达、网络不通，或认证长时间无响应）".to_string())
        }
        Err(_) => {
            let _ = pty.kill();
            tracing::warn!("[TEST-CONN] test_ssh_password: recv_timeout(13s) hit -> 认证超时");
            Err("SSH 认证超时（握手/网络过慢，或密码提示未出现）".to_string())
        }
    };
    // host key 变更优先于退出码判断：ssh 在握手阶段直接报错退出，不会弹密码提示，
    // 否则会被误判为「密码不正确或主机不可达」，误导用户（典型场景：云服务器重置系统后 host key 变了）。
    if let Ok(true) = hk_rx.try_recv() {
        if !retried {
            // 自动清除旧 key 并整体重试一次（等价于用户手动 ssh-keygen -R 后重连）
            let _ = crate::core::platform::clear_known_host(&ssh.host, ssh.port);
            return test_ssh_password(ssh, pw, true);
        }
        result = Err(format!(
            "✗ SSH 主机密钥校验失败（远程主机密钥已变更，很可能系统已重置）。已自动清除旧密钥并重试，但仍失败：{}@{}:{}",
            ssh.username, ssh.host, ssh.port
        ));
    }
    // 绝不无限等待 feeder 线程：ssh 已被 kill 或自行退出后读端会返回 EOF，
    // 但为绝对避免 join 阻塞导致命令线程卡死，这里 detach（丢弃 JoinHandle），
    // feeder 线程会在读端返回后自行结束。
    drop(feeder);
    result
}

/// 带超时的命令执行：成功返回退出码是否为 0
fn run_command_with_timeout(
    bin: &str,
    args: &[String],
    timeout: Duration,
) -> std::result::Result<bool, String> {
    tracing::info!(
        "[TEST-CONN] run_command_with_timeout: spawning {} with {} args, timeout={:?}",
        bin,
        args.len(),
        timeout
    );
    let mut child = Command::new(bin)
        .args(args)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .stdin(Stdio::null())
        .spawn()
        .map_err(|e| format!("无法启动进程 {}: {}", bin, e))?;

    let (tx, rx) = mpsc::channel();
    thread::spawn(move || {
        let _ = tx.send(child.wait());
    });

    match rx.recv_timeout(timeout) {
        Ok(Ok(status)) => {
            tracing::info!(
                "[TEST-CONN] run_command_with_timeout: {} exited success={}",
                bin,
                status.success()
            );
            Ok(status.success())
        }
        Ok(Err(e)) => {
            tracing::warn!("[TEST-CONN] run_command_with_timeout: {} error: {}", bin, e);
            Err(format!("进程 {} 错误: {}", bin, e))
        }
        Err(_) => {
            tracing::warn!("[TEST-CONN] run_command_with_timeout: {} TIMEOUT after {:?}", bin, timeout);
            Err(format!("连接 {} 超时（握手/认证过慢）", bin))
        }
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
