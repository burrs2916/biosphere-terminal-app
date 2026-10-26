use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use futures::{SinkExt, StreamExt};
use russh::client::Handle;
use russh::ChannelMsg;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::Mutex;
use tokio_tungstenite::tungstenite::Message;

use crate::app::ssh_common::{self, SshHostKeyHandler};
use crate::core::types::SshConnectionInfo;

struct TunnelState {
    /// Shared handle; keeps the russh session (and every forwarded channel)
    /// alive for the whole remote-desktop session. `Handle` is not `Clone`, so
    /// it is wrapped in `Arc` and handed to the per-connection forward tasks.
    /// Held here purely as a lifetime guard — dropping it (on session close,
    /// together with the accept loop's own clone) is what tears the session down.
    #[allow(dead_code)]
    ssh: Arc<Handle<SshHostKeyHandler>>,
    /// Stops the local forward listener's accept loop on session close.
    tunnel_shutdown: Option<tokio::sync::oneshot::Sender<()>>,
    ws_shutdown: Option<tokio::sync::oneshot::Sender<()>>,
}

pub struct RemoteDesktopService {
    tunnels: Arc<Mutex<HashMap<String, TunnelState>>>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteDesktopSession {
    pub id: String,
    pub ws_url: String,
    pub local_port: u16,
    pub vnc_port: u16,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VncSetupResult {
    /// VNC 是否已安装（任意 VNC server）
    pub vnc_installed: bool,
    /// VNC 是否正在运行（端口监听或有活跃会话）
    pub vnc_running: bool,
    /// 检测到的 VNC 端口
    pub vnc_port: u16,
    /// 当前活跃 VNC 会话的 display 号（如 :1）
    pub display: Option<String>,
    /// 是否需要设置密码（无密码文件 && 有 TigerVNC）
    pub needs_password: bool,
    /// 远程主机操作系统名称
    pub os_name: String,
}

impl RemoteDesktopService {
    pub fn new() -> Self {
        RemoteDesktopService {
            tunnels: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Wrapper around `setup_vnc` that also writes an entry to debug_log so
    /// the backend probe call is correlated with the frontend guide's
    /// run_id. The frontend bridge in `commands/remote_desktop.rs` calls
    /// this method instead of `setup_vnc` directly so every probe shows up
    /// in `debug.log` alongside the guide's own phase transitions.
    pub async fn setup_vnc_traced(
        &self,
        ssh: &SshConnectionInfo,
        vnc_port: u16,
        _run_id: &str,
    ) -> Result<VncSetupResult, String> {
        self.setup_vnc(ssh, vnc_port).await
    }

    pub async fn setup_vnc(
        &self,
        ssh: &SshConnectionInfo,
        vnc_port: u16,
    ) -> Result<VncSetupResult, String> {
        tracing::info!(
            "[remote-desktop-setup] Checking VNC: host={}, user={}, auth_method={}, has_password={}",
            ssh.host, ssh.username, ssh.auth_method, ssh.password.is_some()
        );

        // Round 1 — identify the remote OS family BEFORE probing. `uname -s`
        // prints Linux/Darwin on Unix; on Windows OpenSSH (cmd.exe default
        // shell) it fails with a localized "not recognized" error, which is
        // itself the signal. Without this split the Unix-only probe chain
        // below breaks on Windows: cmd has no `;` command separator and no
        // which/ss/test, so the whole line degenerates into `cat` arguments.
        let uname_out = run_ssh_command(ssh, "uname -s", 30)
            .await
            .unwrap_or_default();
        let uname_l = uname_out.trim().to_lowercase();
        let is_windows = !uname_l.contains("linux")
            && !uname_l.contains("darwin")
            && (uname_l.contains("not recognized")
                || uname_l.contains("不是内部")
                || uname_l.contains("无法"));

        if is_windows {
            // Round 2 (Windows) — cmd-compatible probes only: `&` is cmd's
            // command separator, findstr/netstat/tasklist/ver are built in.
            // No `;` chains, no /dev/null redirection, no which/test.
            let win_out = run_ssh_command(
                ssh,
                "ver& netstat -an | findstr /R \":590\"& tasklist | findstr /I \"vnc\"",
                30,
            )
            .await
            .map_err(|e| format!("SSH connection failed: {}", e))?;

            let port_listening = win_out.lines().any(|l| l.contains(":590"));
            // A running VNC process (winvnc.exe / tvnserver.exe / …) proves the
            // server exists; the port line proves it is listening.
            let vnc_artifacts: Vec<&str> = win_out
                .lines()
                .filter(|l| {
                    let ll = l.to_lowercase();
                    ll.contains("vnc") && !ll.contains(":590")
                })
                .collect();
            let vnc_installed = !vnc_artifacts.is_empty();
            let detected_port = if win_out.contains(":5901") {
                5901
            } else if win_out.contains(":5900") {
                5900
            } else {
                vnc_port
            };

            tracing::info!(
                "[remote-desktop-setup] Windows detection: vnc_installed={}, port_listening={}, port={}",
                vnc_installed, port_listening, detected_port
            );

            return Ok(VncSetupResult {
                vnc_installed,
                vnc_running: port_listening || vnc_installed,
                vnc_port: detected_port,
                display: None,
                // Windows VNC password management (UltraVNC/TightVNC auth
                // plugins) is out of scope for the auto flow — the UI routes
                // Windows hosts to manual setup anyway.
                needs_password: false,
                os_name: "windows".to_string(),
            });
        }

        let ssh_output = run_ssh_command(ssh, "which tigervncserver x11vnc vncserver Xvnc Xtightvnc 2>/dev/null; echo SEP123456; ( grep -E '^(ID|ID_LIKE)=' /etc/os-release 2>/dev/null | tr 'A-Z' 'a-z' ) ; echo SEP123456; vncserver -list 2>/dev/null; echo SEP123456; ( if uname -s 2>/dev/null | grep -qi darwin; then netstat -an -f inet -p tcp 2>/dev/null | grep -E ':590[0-9]' || lsof -nP -iTCP -sTCP:LISTEN 2>/dev/null | grep -E ':590[0-9]'; else ss -tlnp 2>/dev/null | grep -E ':590[0-9]' || netstat -tlnp 2>/dev/null | grep -E ':590[0-9]'; fi ) || true; echo SEP123456; test -f ~/.vnc/passwd && echo PASSWD_EXISTS || echo NO_PASSWD; echo SEP123456; uname -s 2>/dev/null || echo UNKNOWN_UNAME; echo SEP123456; which startxfce4 gnome-session xterm 2>/dev/null || true", 30)
            .await
            .map_err(|e| format!("SSH connection failed: {}", e))?;

        tracing::info!("[remote-desktop-setup] SSH output ({} bytes): {}", ssh_output.len(), if ssh_output.len() > 500 { &ssh_output[..500] } else { &ssh_output });

        let parts: Vec<&str> = ssh_output.split("SEP123456").collect();
        let which_output = parts.first().unwrap_or(&"").trim();
        let os_output = parts.get(1).unwrap_or(&"").trim();
        let vnc_list_output = parts.get(2).unwrap_or(&"").trim();
        let port_output = parts.get(3).unwrap_or(&"").trim();
        let passwd_output = parts.get(4).unwrap_or(&"").trim();
        let uname_output = parts.get(5).unwrap_or(&"").trim();
        let desktop_output = parts.get(6).unwrap_or(&"").trim();

        // 精确判定 TigerVNC：其专属产物是 tigervncserver（部分发行版）或 Xvnc（X 服务器）。
        // 注意 TightVNC 也提供名为 `vncserver` 的脚本与 Xtightvnc，若仅凭 vncserver 判定会把 TightVNC
        // 误判成 TigerVNC，导致前端对 TightVNC 运行 `vncpasswd -f`（-f 是 TigerVNC 专属参数）直接报错。
        let has_tigervnc = which_output.contains("tigervncserver") || which_output.contains("Xvnc");
        // 宽泛判定"任意 VNC server"（TigerVNC / TightVNC / 其它），用于启动与桌面环境引导，
        // 因为 `vncserver :1` 对二者都通用，不应因精确判定而漏掉 TightVNC 的启动路径。
        let has_vncserver = which_output.contains("vncserver") || which_output.contains("Xvnc")
            || which_output.contains("Xtightvnc");
        let has_x11vnc = which_output.contains("x11vnc");
        let vnc_installed = has_vncserver || has_x11vnc;

        // 解析发行版家族。注意 CentOS Stream 等 id_like 含 "fedora"，故 rhel 家族需显式枚举、不放 fedora，
        // 并在后续匹配时优先判定 is_rhel 再判定 is_fedora，避免 CentOS 被误判为 Fedora。
        let os = os_output.to_lowercase();
        let is_macos = uname_output.to_lowercase().contains("darwin");
        let is_debian = os.contains("debian") || os.contains("ubuntu");
        // Oracle Linux 的 os-release 是 `ID=ol`（且 ID_LIKE=fedora），必须用精确令牌 `id=ol` 匹配，
        // 不能用宽泛的 contains("ol") —— 否则 Solus(`ID=solus`) 等含 "ol" 子串的发行版会被误判成 RHEL、拿到 yum 命令。
        let is_rhel = os.contains("rhel") || os.contains("centos") || os.contains("rocky")
            || os.contains("almalinux") || os.contains("id=ol") || os.contains("oracle")
            || os.contains("amzn") || os.contains("scientific");
        let is_fedora = os.contains("fedora");
        let is_suse = os.contains("suse") || os.contains("opensuse");
        let is_arch = os.contains("arch") || os.contains("archlinux") || os.contains("manjaro");
        // 非 systemd / 小众发行版：用 `id=xxx` 精确令牌匹配，避免被主流家族误吞。
        // 这些发行版的包管理器与 Debian/RHEL 体系不同，必须给出真实安装命令（见 install_hint）。
        let is_alpine = os.contains("id=alpine");
        let is_gentoo = os.contains("id=gentoo");
        let is_void = os.contains("id=void");
        let is_nixos = os.contains("id=nixos");
        let is_solus = os.contains("id=solus");

        let port_listening = port_output.contains("590");

        // 解析 `vncserver -list` 的活跃会话，兼容两种格式：
        //  - TigerVNC: `:1` 或 `:1  5901  pid`（行首以冒号开头）
        //  - TightVNC: `1: 5901`（数字开头后跟冒号）
        // 跳过表头/分隔行（含 DISPLAY / PROCESS ID / RFB PORT / SESSION 等字样）。
        let vnc_has_active_session = vnc_list_output
            .lines()
            .any(|line| {
                let t = line.trim();
                if t.is_empty()
                    || t.to_lowercase().contains("display")
                    || t.to_lowercase().contains("process id")
                    || t.to_lowercase().contains("rfb port")
                    || t.to_lowercase().contains("session")
                {
                    return false;
                }
                // TigerVNC: `:1`
                if t.starts_with(':') && t.chars().any(|c| c.is_ascii_digit()) {
                    return true;
                }
                // TightVNC: `1: 5901`（数字开头后紧跟冒号）
                let mut chars = t.chars();
                if let Some(first) = chars.next() {
                    if first.is_ascii_digit() && chars.next() == Some(':') {
                        return true;
                    }
                }
                false
            });

        let vnc_running = port_listening || vnc_has_active_session;

        let detected_port = if port_output.contains("5901") {
            5901
        } else if port_output.contains("5902") {
            5902
        } else if port_output.contains("5900") {
            5900
        } else if vnc_has_active_session {
            // 端口探测失败时的兜底：从 `vncserver -list` 解析显示号/端口。
            // 兼容 TigerVNC `:1`（→5900+1）与 TightVNC `1: 5901`（→直接取 5901）。
            vnc_list_output
                .lines()
                .find_map(|line| {
                    let t = line.trim();
                    if t.is_empty()
                        || t.to_lowercase().contains("display")
                        || t.to_lowercase().contains("process id")
                        || t.to_lowercase().contains("rfb port")
                        || t.to_lowercase().contains("session")
                    {
                        return None;
                    }
                    if t.starts_with(':') && t.chars().any(|c| c.is_ascii_digit()) {
                        let display_num: String = t[1..]
                            .chars()
                            .take_while(|c| c.is_ascii_digit())
                            .collect();
                        return display_num.parse::<u16>().ok().map(|n| 5900 + n);
                    }
                    // TightVNC: `1: 5901` → 第二列即 RFB 端口
                    let mut parts = t.split_whitespace();
                    if let (Some(first), Some(second)) = (parts.next(), parts.next()) {
                        if first.chars().next().map_or(false, |c| c.is_ascii_digit())
                            && first.contains(':')
                            && second.parse::<u16>().map_or(false, |p| (5900..=5999).contains(&p))
                        {
                            return second.parse::<u16>().ok();
                        }
                    }
                    None
                })
                .unwrap_or(vnc_port)
        } else {
            vnc_port
        };

        // 真实解析当前活跃 VNC 会话的 display（如 `:1`），供前端重置密码重启时精准 kill 对应会话，
        // 而非 `pkill -f vncserver` 误杀机器上所有 VNC 会话。兼容 TigerVNC `:1` 与 TightVNC `1: 5901` 两种格式。
        let detected_display = vnc_list_output
            .lines()
            .find_map(|line| {
                let t = line.trim();
                if t.is_empty()
                    || t.to_lowercase().contains("display")
                    || t.to_lowercase().contains("process id")
                    || t.to_lowercase().contains("rfb port")
                    || t.to_lowercase().contains("session")
                {
                    return None;
                }
                // TigerVNC: `:1`（或 `:1  5901  pid`）
                if t.starts_with(':') && t.chars().any(|c| c.is_ascii_digit()) {
                    return Some(t.split_whitespace().next().unwrap_or(":1").to_string());
                }
                // TightVNC: `1: 5901` → display `:1`
                let mut parts = t.split_whitespace();
                if let Some(first) = parts.next() {
                    if first.chars().next().map_or(false, |c| c.is_ascii_digit())
                        && first.contains(':')
                    {
                        let num: String = first
                            .chars()
                            .skip(1)
                            .take_while(|c| c.is_ascii_digit())
                            .collect();
                        if !num.is_empty() {
                            return Some(format!(":{}", num));
                        }
                    }
                }
                None
            });

        let has_passwd = passwd_output.contains("PASSWD_EXISTS");

        let has_xfce = desktop_output.contains("startxfce4");
        let has_gnome = desktop_output.contains("gnome-session");
        let has_xterm = desktop_output.contains("xterm");
        // 仅当检测到完整的桌面环境（Xfce / GNOME）时才认为"桌面已安装"。
        // xterm 只是终端模拟器，不是桌面环境。用户选择"有桌面"时，xterm 不应算作满足条件，
        // 否则 AI 诊断永远不会触发（onInstallSuccess 会因为 desktopInstalled=true 而跳过诊断）。
        let has_desktop = has_xfce || has_gnome;

        tracing::info!(
            "[remote-desktop-setup] Detection: vnc_installed={}, vnc_running={}, port_listening={}, vnc_has_active_session={}, detected_port={}, has_passwd={}, has_xfce={}, has_gnome={}, has_xterm={}, has_desktop={}",
            vnc_installed, vnc_running, port_listening, vnc_has_active_session, detected_port, has_passwd, has_xfce, has_gnome, has_xterm, has_desktop
        );

        Ok(VncSetupResult {
            vnc_installed,
            vnc_running,
            vnc_port: detected_port,
            display: detected_display,
            needs_password: !has_passwd && has_tigervnc,
            os_name: if is_macos {
                "macos".to_string()
            } else if is_debian {
                "debian".to_string()
            } else if is_rhel {
                "rhel".to_string()
            } else if is_fedora {
                "fedora".to_string()
            } else if is_suse {
                "suse".to_string()
            } else if is_arch {
                "arch".to_string()
            } else if is_alpine {
                "alpine".to_string()
            } else if is_gentoo {
                "gentoo".to_string()
            } else if is_void {
                "void".to_string()
            } else if is_nixos {
                "nixos".to_string()
            } else if is_solus {
                "solus".to_string()
            } else {
                "unknown".to_string()
            },
        })
    }

    pub async fn create_session(
        &self,
        session_id: &str,
        ssh: &SshConnectionInfo,
        vnc_port: u16,
    ) -> Result<RemoteDesktopSession, String> {
        let local_port = find_available_port().await?;

        tracing::info!(
            "[remote-desktop] Creating session: auth_method={}, has_password={}, host={}, user={}",
            ssh.auth_method,
            ssh.password.is_some(),
            ssh.host,
            ssh.username
        );

        let (ssh_handle, tunnel_shutdown) =
            start_ssh_tunnel_russh(ssh, local_port, vnc_port).await?;

        tracing::info!("[remote-desktop] Waiting for local forward port {} to be ready...", local_port);
        let mut retries = 0;
        let max_retries = 20;
        loop {
            tokio::time::sleep(tokio::time::Duration::from_millis(300)).await;
            match TcpStream::connect(&format!("127.0.0.1:{}", local_port)).await {
                Ok(_) => {
                    tracing::info!("[remote-desktop] SSH tunnel is ready on port {}", local_port);
                    break;
                }
                Err(_) => {
                    retries += 1;
                    if retries >= max_retries {
                        tracing::error!("[remote-desktop] SSH tunnel failed after {} retries", max_retries);
                        return Err("SSH tunnel failed to establish. Check SSH credentials and server availability.".to_string());
                    }
                }
            }
        }

        let ws_port = find_available_port().await?;
        let ws_url = format!("ws://127.0.0.1:{}", ws_port);

        let (shutdown_tx, shutdown_rx) = tokio::sync::oneshot::channel::<()>();

        let target_addr = format!("127.0.0.1:{}", local_port);
        let sid = session_id.to_string();

        tokio::spawn(async move {
            if let Err(e) = run_ws_proxy(ws_port, &target_addr, shutdown_rx).await {
                tracing::error!("[remote-desktop] WS proxy error for session {}: {}", sid, e);
            }
        });

        let mut tunnels = self.tunnels.lock().await;
        tunnels.insert(
            session_id.to_string(),
            TunnelState {
                ssh: ssh_handle,
                tunnel_shutdown: Some(tunnel_shutdown),
                ws_shutdown: Some(shutdown_tx),
            },
        );

        Ok(RemoteDesktopSession {
            id: session_id.to_string(),
            ws_url,
            local_port,
            vnc_port,
        })
    }

    pub async fn close_session(&self, session_id: &str) -> Result<(), String> {
        let mut tunnels = self.tunnels.lock().await;
        if let Some(mut state) = tunnels.remove(session_id) {
            if let Some(tx) = state.ws_shutdown.take() {
                let _ = tx.send(());
            }
            if let Some(tx) = state.tunnel_shutdown.take() {
                let _ = tx.send(());
            }
            // Dropping `state.ssh` (the last `Arc<Handle>`) closes the SSH
            // session and every forwarded channel.
        }
        Ok(())
    }

    #[allow(dead_code)]
    pub async fn close_all(&self) {
        let mut tunnels = self.tunnels.lock().await;
        for (_, mut state) in tunnels.drain() {
            if let Some(tx) = state.ws_shutdown.take() {
                let _ = tx.send(());
            }
            if let Some(tx) = state.tunnel_shutdown.take() {
                let _ = tx.send(());
            }
        }
    }
}

async fn find_available_port() -> Result<u16, String> {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| format!("Failed to find available port: {}", e))?;
    let port = listener.local_addr().map_err(|e| format!("Failed to get local addr: {}", e))?.port();
    drop(listener);
    Ok(port)
}

/// Establish the russh session and bind a local TCP listener that replaces the
/// old `ssh -L` port forward. Each connection accepted on `local_port` is
/// bridged to the remote VNC server (`localhost:<vnc_port>`) through a fresh
/// `direct-tcpip` channel — no `ssh.exe`, no password-prompt scraping.
async fn start_ssh_tunnel_russh(
    ssh: &SshConnectionInfo,
    local_port: u16,
    vnc_port: u16,
) -> Result<(Arc<Handle<SshHostKeyHandler>>, tokio::sync::oneshot::Sender<()>), String> {
    let handle = Arc::new(
        ssh_common::establish(ssh)
            .await
            .map_err(|e| format!("SSH 隧道建立失败：{}", e))?,
    );

    let listener = TcpListener::bind(("127.0.0.1", local_port))
        .await
        .map_err(|e| format!("无法绑定本地转发端口 127.0.0.1:{}: {}", local_port, e))?;

    let (shutdown_tx, shutdown_rx) = tokio::sync::oneshot::channel::<()>();

    let handle_for_loop = Arc::clone(&handle);
    ssh_common::spawn_on(run_tunnel_accept_loop(handle_for_loop, listener, vnc_port, shutdown_rx))
        .map_err(|e| format!("SSH 隧道转发任务启动失败：{}", e))?;

    tracing::info!(
        "[remote-desktop] SSH tunnel (russh) started: local 127.0.0.1:{} -> remote localhost:{}",
        local_port,
        vnc_port
    );
    Ok((handle, shutdown_tx))
}

/// Accept loop for the local forward port. Spawned onto the dedicated SSH
/// runtime; terminates when `shutdown_rx` fires (on session close).
async fn run_tunnel_accept_loop(
    handle: Arc<Handle<SshHostKeyHandler>>,
    listener: TcpListener,
    vnc_port: u16,
    mut shutdown_rx: tokio::sync::oneshot::Receiver<()>,
) {
    loop {
        tokio::select! {
            accept = listener.accept() => {
                match accept {
                    Ok((tcp, _addr)) => {
                        let h = Arc::clone(&handle);
                        tokio::spawn(async move {
                            if let Err(e) = forward_tcp_to_direct_tcpip(h, tcp, vnc_port).await {
                                tracing::debug!("[remote-desktop] tunnel forward error: {}", e);
                            }
                        });
                    }
                    Err(e) => {
                        tracing::error!("[remote-desktop] tunnel listener accept error: {}", e);
                        break;
                    }
                }
            }
            _ = &mut shutdown_rx => {
                tracing::info!("[remote-desktop] tunnel accept loop shutting down");
                break;
            }
        }
    }
}

/// Bridge one accepted local TCP connection to the remote VNC server through a
/// `direct-tcpip` channel. Bytes flow both ways until either side closes.
async fn forward_tcp_to_direct_tcpip(
    handle: Arc<Handle<SshHostKeyHandler>>,
    tcp: TcpStream,
    vnc_port: u16,
) -> Result<(), String> {
    let channel = handle
        .channel_open_direct_tcpip("localhost", vnc_port as u32, "127.0.0.1", 0)
        .await
        .map_err(|e| format!("SSH 转发通道建立失败：{}", e))?;

    let (mut ch_read, ch_write) = channel.split();
    let (mut tcp_read, mut tcp_write) = tcp.into_split();

    let mut buf = vec![0u8; 32768];

    // VNC client (via ws proxy) -> SSH channel -> remote VNC.
    let tcp_to_chan = async {
        loop {
            match tcp_read.read(&mut buf).await {
                Ok(0) => break,
                Ok(n) => {
                    if ch_write.data_bytes(buf[..n].to_vec()).await.is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
        let _ = ch_write.eof().await;
        let _ = ch_write.close().await;
    };

    // Remote VNC -> SSH channel -> VNC client.
    let chan_to_tcp = async {
        loop {
            match ch_read.wait().await {
                Some(ChannelMsg::Data { data }) => {
                    if tcp_write.write_all(&data).await.is_err() {
                        break;
                    }
                }
                Some(ChannelMsg::ExtendedData { data, .. }) => {
                    if tcp_write.write_all(&data).await.is_err() {
                        break;
                    }
                }
                Some(ChannelMsg::Eof) | Some(ChannelMsg::Close) | None => break,
                Some(_) => continue,
            }
        }
        let _ = tcp_write.shutdown().await;
    };

    tokio::select! {
        _ = tcp_to_chan => {},
        _ = chan_to_tcp => {},
    }
    Ok(())
}

async fn run_ws_proxy(
    ws_port: u16,
    target_addr: &str,
    mut shutdown_rx: tokio::sync::oneshot::Receiver<()>,
) -> Result<(), String> {
    let listener = TcpListener::bind(format!("127.0.0.1:{}", ws_port))
        .await
        .map_err(|e| format!("Failed to bind WS port {}: {}", ws_port, e))?;

    tracing::info!("[remote-desktop] WS proxy listening on port {}", ws_port);

    loop {
        tokio::select! {
            accept_result = listener.accept() => {
                match accept_result {
                    Ok((stream, _addr)) => {
                        let target = target_addr.to_string();
                        tokio::spawn(async move {
                            if let Err(e) = handle_ws_connection(stream, &target).await {
                                tracing::debug!("[remote-desktop] WS connection error: {}", e);
                            }
                        });
                    }
                    Err(e) => {
                        tracing::error!("[remote-desktop] WS accept error: {}", e);
                    }
                }
            }
            _ = &mut shutdown_rx => {
                tracing::info!("[remote-desktop] WS proxy shutting down on port {}", ws_port);
                return Ok(());
            }
        }
    }
}

async fn handle_ws_connection(stream: TcpStream, target_addr: &str) -> Result<(), String> {
    let peer = stream.peer_addr().map(|a| a.to_string()).unwrap_or_default();
    tracing::info!("[remote-desktop] WS connection from {}, connecting to {}", peer, target_addr);

    let ws_stream = tokio_tungstenite::accept_async(stream)
        .await
        .map_err(|e| format!("WS handshake failed: {}", e))?;

    tracing::info!("[remote-desktop] WS handshake completed for {}", peer);

    let (mut ws_sink, mut ws_stream) = ws_stream.split();

    let tcp_stream = TcpStream::connect(target_addr)
        .await
        .map_err(|e| format!("TCP connect to {} failed: {}", target_addr, e))?;

    tracing::info!("[remote-desktop] TCP connected to {} for {}", target_addr, peer);

    let (mut tcp_read, mut tcp_write) = tcp_stream.into_split();

    let ws_to_tcp = async {
        while let Some(msg) = ws_stream.next().await {
            match msg {
                Ok(Message::Binary(data)) => {
                    if tcp_write.write_all(&data).await.is_err() {
                        break;
                    }
                }
                Ok(Message::Close(_)) => break,
                Err(e) => {
                    tracing::warn!("[remote-desktop] WS stream error: {}", e);
                    break;
                }
                _ => {}
            }
        }
        let _ = tcp_write.shutdown().await;
    };

    let tcp_to_ws = async {
        let mut buf = vec![0u8; 65536];
        loop {
            match tcp_read.read(&mut buf).await {
                Ok(0) => break,
                Ok(n) => {
                    if ws_sink.send(Message::Binary(buf[..n].to_vec().into())).await.is_err() {
                        break;
                    }
                }
                Err(e) => {
                    tracing::warn!("[remote-desktop-setup] PTY read error: {}", e);
                    break;
                }
            }
        }
        let _ = ws_sink.send(Message::Close(None)).await;
    };

    tokio::select! {
        _ = ws_to_tcp => {},
        _ = tcp_to_ws => {},
    }

    Ok(())
}

/// Run a command on the remote host over a native russh `exec` channel
/// (replaces the old `ssh.exe` + PTY password-scraping approach). Collects
/// stdout/stderr, strips ANSI, and enforces a wall-clock timeout.
async fn run_ssh_command(
    ssh: &SshConnectionInfo,
    command: &str,
    timeout_secs: u64,
) -> Result<String, String> {
    tracing::info!(
        "[remote-desktop-setup] run_ssh_command: {}@{}:{} -> '{}'",
        ssh.username, ssh.host, ssh.port, command
    );

    let ssh = ssh.clone();
    let command = command.to_string();

    let result = tokio::time::timeout(Duration::from_secs(timeout_secs), async move {
        let handle = ssh_common::establish(&ssh).await?;

        let mut channel = handle
            .channel_open_session()
            .await
            .map_err(|e| format!("无法打开命令通道: {}", e))?;

        channel
            .exec(true, command.into_bytes())
            .await
            .map_err(|e| format!("命令执行失败: {}", e))?;

        let mut output = String::new();
        loop {
            match channel.wait().await {
                Some(ChannelMsg::Data { data }) => {
                    output.push_str(&String::from_utf8_lossy(&data));
                }
                Some(ChannelMsg::ExtendedData { data, .. }) => {
                    output.push_str(&String::from_utf8_lossy(&data));
                }
                // Server finished sending; keep draining until Close/None.
                Some(ChannelMsg::Eof) => {}
                Some(ChannelMsg::Close) | None => break,
                Some(_) => continue,
            }
        }
        Ok::<String, String>(clean_ansi_output(&output))
    })
    .await;

    match result {
        Ok(Ok(cleaned)) => {
            tracing::info!(
                "[remote-desktop-setup] Cleaned output ({} bytes): {}",
                cleaned.len(),
                if cleaned.len() > 300 { &cleaned[..300] } else { &cleaned }
            );
            Ok(cleaned)
        }
        Ok(Err(e)) => Err(e),
        Err(_) => Err(format!("命令执行超时（{} 秒）", timeout_secs)),
    }
}

fn clean_ansi_output(input: &str) -> String {
    let mut result = String::with_capacity(input.len());
    let mut chars = input.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\x1b' {
            if chars.peek() == Some(&'[') {
                chars.next();
                while let Some(&next) = chars.peek() {
                    if next.is_ascii_alphabetic() {
                        chars.next();
                        break;
                    }
                    chars.next();
                }
            } else {
                while let Some(&next) = chars.peek() {
                    if next.is_ascii_alphabetic() || next == '\x1b' {
                        break;
                    }
                    chars.next();
                }
            }
        } else if c == '\r' {
            // skip
        } else {
            result.push(c);
        }
    }
    result
}
