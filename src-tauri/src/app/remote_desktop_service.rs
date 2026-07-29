use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Arc;

use futures::{SinkExt, StreamExt};
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::Mutex;
use tokio_tungstenite::tungstenite::Message;

use crate::core::types::SshConnectionInfo;

struct TunnelState {
    pty_master: Option<Box<dyn MasterPty + Send>>,
    pty_child: Option<Box<dyn portable_pty::Child + Send>>,
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
    pub vnc_installed: bool,
    pub vnc_running: bool,
    pub vnc_port: u16,
    pub display: Option<String>,
    pub messages: Vec<String>,
    pub needs_password: bool,
    pub install_hint: String,
    pub start_hint: String,
    pub setup_hint: String,
    pub passwd_hint: String,
    pub os_name: String,
}

impl RemoteDesktopService {
    pub fn new() -> Self {
        RemoteDesktopService {
            tunnels: Arc::new(Mutex::new(HashMap::new())),
        }
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

        let ssh_output = run_ssh_command(ssh, "which tigervncserver x11vnc vncserver Xvnc Xtightvnc 2>/dev/null; echo SEP123456; ( grep -E '^(ID|ID_LIKE)=' /etc/os-release 2>/dev/null | tr 'A-Z' 'a-z' ) ; echo SEP123456; vncserver -list 2>/dev/null; echo SEP123456; ( if uname -s 2>/dev/null | grep -qi darwin; then netstat -an -f inet -p tcp 2>/dev/null | grep -E ':590[0-9]' || lsof -nP -iTCP -sTCP:LISTEN 2>/dev/null | grep -E ':590[0-9]'; else ss -tlnp 2>/dev/null | grep -E ':590[0-9]' || netstat -tlnp 2>/dev/null | grep -E ':590[0-9]'; fi ) || true; echo SEP123456; test -f ~/.vnc/passwd && echo PASSWD_EXISTS || echo NO_PASSWD; echo SEP123456; uname -s 2>/dev/null || echo UNKNOWN_UNAME; echo SEP123456; which startxfce4 gnome-session xterm 2>/dev/null || true")
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
        let has_desktop = has_xfce || has_gnome || has_xterm;

        tracing::info!(
            "[remote-desktop-setup] Detection: vnc_installed={}, vnc_running={}, port_listening={}, vnc_has_active_session={}, detected_port={}, has_passwd={}, has_xfce={}, has_gnome={}, has_xterm={}, has_desktop={}",
            vnc_installed, vnc_running, port_listening, vnc_has_active_session, detected_port, has_passwd, has_xfce, has_gnome, has_xterm, has_desktop
        );

        let install_hint = if is_macos {
            // macOS 原生屏幕共享使用独立的 VNC 密码机制（非 ~/.vnc/passwd），本工具统一在 macOS 上
            // 安装 TigerVNC（Homebrew）来管理，故走与 Linux 一致的 TigerVNC 路径。TigerVNC 依赖 X11，
            // 故同时装 XQuartz（Homebrew cask）。若未装 Homebrew 给出可读的兜底提示。
            "brew install --cask xquartz; brew install tigervnc || echo '[WARN] Homebrew not found. Install from https://brew.sh then retry the step.'".to_string()
        } else if is_debian {
            "sudo apt update && sudo apt install -y tigervnc-standalone-server tigervnc-common xfce4 dbus-x11".to_string()
        } else if is_rhel {
            // Xfce 组来自 EPEL，默认源里没有会导致 `groupinstall` 失败并因 && 短路连 tigervnc-server 都不装。
            // 改为：始终先装 tigervnc-server + dbus-x11 + xterm（基础源必有，xterm 作 xstartup 兜底），
            // Xfce 组作为可选步骤非致命安装，失败也不影响 VNC 起一个可用的 xterm 会话。
            "sudo yum install -y tigervnc-server dbus-x11 xterm; (sudo yum install -y epel-release && sudo yum groupinstall -y 'Xfce') || echo '[WARN] Xfce group unavailable; VNC will start an xterm session'".to_string()
        } else if is_fedora {
            "sudo dnf install -y tigervnc-server dbus-x11 xterm; sudo dnf groupinstall -y 'Xfce' || echo '[WARN] Xfce unavailable; xterm session will be used'".to_string()
        } else if is_suse {
            "sudo zypper install -y tigervnc xterm; sudo zypper install -y patterns-xfce || sudo zypper install -y xfce4-session || echo '[WARN] Xfce unavailable; xterm session will be used'".to_string()
        } else if is_arch {
            "sudo pacman -S --noconfirm tigervnc xterm; sudo pacman -S --noconfirm xfce4 || echo '[WARN] xfce4 unavailable; xterm session will be used'".to_string()
        } else if is_alpine {
            "sudo apk add --update tigervnc xterm || echo '[WARN] Failed to install TigerVNC via apk'".to_string()
        } else if is_gentoo {
            "sudo emerge --ask tigervnc xterm || echo '[WARN] Failed to install TigerVNC via emerge'".to_string()
        } else if is_void {
            "sudo xbps-install -S tigervnc xterm || echo '[WARN] Failed to install TigerVNC via xbps'".to_string()
        } else if is_nixos {
            "nix-env -iA nixos.tigervnc || echo '[WARN] Failed to install TigerVNC via nix-env'".to_string()
        } else if is_solus {
            "sudo eopkg it tigervnc xterm || echo '[WARN] Failed to install TigerVNC via eopkg'".to_string()
        } else {
            "Install TigerVNC (package tigervnc-server / tigervnc) and a desktop environment (e.g. Xfce), then run: vncserver :1 -geometry 1280x800 -depth 24 -localhost no".to_string()
        };

        let start_hint = if is_macos && has_vncserver {
            // macOS 上 TigerVNC/TightVNC 依赖 XQuartz（X11 环境）。若 XQuartz 未运行，
            // `vncserver :1` 会立即失败且无明确原因，故在启动前先拉起 XQuartz。
            "open -a XQuartz && vncserver :1 -geometry 1280x800 -depth 24 -localhost no".to_string()
        } else if has_vncserver {
            "vncserver :1 -geometry 1280x800 -depth 24 -localhost no".to_string()
        } else if has_x11vnc {
            "x11vnc -display :0 -forever -shared -rfbport 5900".to_string()
        } else {
            install_hint.clone()
        };

        let setup_hint = if has_tigervnc {
            let mut cmds = Vec::new();
            cmds.push("mkdir -p ~/.vnc".to_string());
            if !has_desktop {
                if is_debian {
                    cmds.push("sudo apt update && sudo apt install -y xfce4 dbus-x11".to_string());
                } else if is_rhel {
                    // 与 install_hint 一致：始终装 xterm 兜底，Xfce 组非致命
                    cmds.push("sudo yum install -y dbus-x11 xterm; (sudo yum install -y epel-release && sudo yum groupinstall -y 'Xfce') || echo '[WARN] Xfce unavailable; xterm session will be used'".to_string());
                } else if is_fedora {
                    cmds.push("sudo dnf install -y dbus-x11 xterm; sudo dnf groupinstall -y 'Xfce' || echo '[WARN] Xfce unavailable; xterm session will be used'".to_string());
                } else if is_suse {
                    cmds.push("sudo zypper install -y dbus-x11 xterm; sudo zypper install -y patterns-xfce || sudo zypper install -y xfce4-session || echo '[WARN] Xfce unavailable; xterm session will be used'".to_string());
                } else if is_arch {
                    cmds.push("sudo pacman -S --noconfirm dbus xterm; sudo pacman -S --noconfirm xfce4 || echo '[WARN] xfce4 unavailable; xterm session will be used'".to_string());
                }
            }
            // xstartup 自检式多兜底：不依赖探测时的桌面状态，实际装了什么就启动什么，
            // 彻底避免「装了 xterm 却仍 exec startxfce4」的错配（Xfce 组缺失时尤其关键）。
            let xstartup = "#!/bin/sh\nunset SESSION_MANAGER\nunset DBUS_SESSION_BUS_ADDRESS\nif command -v startxfce4 >/dev/null 2>&1; then\n  exec startxfce4\nelif command -v gnome-session >/dev/null 2>&1; then\n  exec gnome-session\nelif command -v xterm >/dev/null 2>&1; then\n  exec xterm\nelse\n  exec xterm\nfi\n";
            cmds.push(format!("printf '{}\\n' > ~/.vnc/xstartup && chmod +x ~/.vnc/xstartup", xstartup.replace('\n', "\\n")));
            cmds.join(" && ")
        } else if has_vncserver {
            // TightVNC / Xtightvnc：同样使用 ~/.vnc/xstartup 机制，但避免猜测发行版专属桌面包名，
            // 仅建 ~/.vnc 与自检式 xstartup（装了什么就起什么，否则回落 xterm）。
            let xstartup = "#!/bin/sh\nunset SESSION_MANAGER\nunset DBUS_SESSION_BUS_ADDRESS\nif command -v startxfce4 >/dev/null 2>&1; then\n  exec startxfce4\nelif command -v gnome-session >/dev/null 2>&1; then\n  exec gnome-session\nelif command -v xterm >/dev/null 2>&1; then\n  exec xterm\nelse\n  exec xterm\nfi\n";
            format!("mkdir -p ~/.vnc && printf '{}\\n' > ~/.vnc/xstartup && chmod +x ~/.vnc/xstartup", xstartup.replace('\n', "\\n"))
        } else if is_macos {
            // macOS + TigerVNC(Homebrew)：brew 不提供标准 Linux 桌面环境，仅建 ~/.vnc 与自检式 xstartup，
            // 优先起用户已装的 DE（startxfce4/gnome-session），都没有则回落 xterm，保证 VNC 至少可用。
            let xstartup = "#!/bin/sh\nunset SESSION_MANAGER\nunset DBUS_SESSION_BUS_ADDRESS\nif command -v startxfce4 >/dev/null 2>&1; then\n  exec startxfce4\nelif command -v gnome-session >/dev/null 2>&1; then\n  exec gnome-session\nelif command -v xterm >/dev/null 2>&1; then\n  exec xterm\nelse\n  exec xterm\nfi\n";
            format!("mkdir -p ~/.vnc && printf '{}\\n' > ~/.vnc/xstartup && chmod +x ~/.vnc/xstartup", xstartup.replace('\n', "\\n"))
        } else {
            String::new()
        };

        let passwd_hint = if has_tigervnc && !has_passwd {
            // 自动设置走前端的 `vncpasswd -f`；此处仅作手动兜底提示
            "vncpasswd".to_string()
        } else if has_vncserver && !has_passwd {
            // TightVNC / 其它 VNC 实现的 vncpasswd 不支持 -f（TigerVNC 专属），只能交互式设置；
            // 该情况 needs_password 为 false（前端不会跑 -f），改为在 UI 提示用户手动执行。
            "vncpasswd ~/.vnc/passwd".to_string()
        } else {
            String::new()
        };

        // macOS 平台提示：TigerVNC 跑在 XQuartz 上，且 brew 不提供 Linux 风格桌面环境，
        // 默认只会起一个 xterm 会话——这与用户预期「看到完整桌面」不同，需提前告知以免困惑。
        let mut messages: Vec<String> = Vec::new();
        if is_macos {
            messages.push(
                "macOS note: TigerVNC on macOS requires XQuartz (auto-launched before start). Without a Linux-style desktop (Xfce/GNOME) installed, the VNC session shows a terminal (xterm) window — this is expected, not an error.".to_string()
            );
        }

        Ok(VncSetupResult {
            vnc_installed,
            vnc_running,
            vnc_port: detected_port,
            display: detected_display,
            messages,
            needs_password: !has_passwd && has_tigervnc,
            install_hint,
            start_hint,
            setup_hint,
            passwd_hint,
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

        let (master, reader, writer, child) = start_ssh_tunnel_pty(ssh, local_port, vnc_port)?;

        let password = ssh.password.clone();
        let password_auth = ssh.auth_method == "password" && password.is_some();

        tracing::info!("[remote-desktop] password_auth={}, starting auto-fill thread", password_auth);

        if password_auth {
            let pwd = password.unwrap();
            let mut trailing = String::with_capacity(256);
            let mut password_filled = false;

            std::thread::spawn(move || {
                let mut buf = [0u8; 4096];
                let mut reader = reader;
                let mut writer = writer;
                tracing::info!("[remote-desktop] Password auto-fill thread started, waiting for prompt...");
                loop {
                    match reader.read(&mut buf) {
                        Ok(0) => {
                            tracing::info!("[remote-desktop] PTY reader EOF");
                            break;
                        }
                        Ok(n) => {
                            let output = String::from_utf8_lossy(&buf[..n]).to_string();
                            tracing::debug!("[remote-desktop] PTY output: {}", output.trim());
                            if password_filled {
                                continue;
                            }
                            trailing.push_str(&output);
                            if trailing.len() > 512 {
                                trailing = trailing[trailing.len() - 512..].to_string();
                            }
                            let lower = trailing.to_lowercase();
                            let needs_password = lower.ends_with("password:")
                                || lower.ends_with("password: ")
                                || (lower.contains("password:") && trailing.trim_end().ends_with(':'))
                                || lower.ends_with("passphrase:")
                                || lower.ends_with("passphrase for key:");

                            if needs_password {
                                tracing::info!("[remote-desktop] Detected password prompt, auto-filling...");
                                let pw_bytes = format!("{}\n", pwd);
                                if let Err(e) = writer.write_all(pw_bytes.as_bytes()) {
                                    tracing::error!("[remote-desktop] Failed to write password: {}", e);
                                }
                                if let Err(e) = writer.flush() {
                                    tracing::error!("[remote-desktop] Failed to flush: {}", e);
                                }
                                password_filled = true;
                                trailing.clear();
                                tracing::info!("[remote-desktop] Password auto-filled successfully");
                            }
                        }
                        Err(e) => {
                            tracing::error!("[remote-desktop] PTY read error: {}", e);
                            break;
                        }
                    }
                }
            });
        } else {
            drop(reader);
            drop(writer);
        }

        tracing::info!("[remote-desktop] Waiting for SSH tunnel to be ready on port {}...", local_port);
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
                pty_master: Some(master),
                pty_child: Some(child),
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
            if let Some(ref mut child) = state.pty_child {
                let _ = child.kill();
            }
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
            if let Some(ref mut child) = state.pty_child {
                let _ = child.kill();
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

fn start_ssh_tunnel_pty(
    ssh: &SshConnectionInfo,
    local_port: u16,
    vnc_port: u16,
) -> Result<
    (
        Box<dyn MasterPty + Send>,
        Box<dyn Read + Send>,
        Box<dyn Write + Send>,
        Box<dyn portable_pty::Child + Send>,
    ),
    String,
> {
    let pty_system = native_pty_system();

    let pair = pty_system
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("openpty failed: {}", e))?;

    let ssh_bin = crate::core::platform::resolve_ssh_binary()?;

    let mut args: Vec<String> = Vec::new();

    args.push("-o".to_string());
    args.push("StrictHostKeyChecking=accept-new".to_string());
    args.push("-o".to_string());
    args.push("ServerAliveInterval=30".to_string());
    args.push("-o".to_string());
    args.push("ServerAliveCountMax=3".to_string());
    args.push("-N".to_string());
    args.push("-L".to_string());
    args.push(format!("{}:localhost:{}", local_port, vnc_port));

    if ssh.port != 22 {
        args.push("-p".to_string());
        args.push(ssh.port.to_string());
    }

    if ssh.auth_method == "private_key" {
        if let Some(key_path) = &ssh.private_key_path {
            args.push("-i".to_string());
            args.push(key_path.clone());
        }
    }

    args.push(format!("{}@{}", ssh.username, ssh.host));

    tracing::info!("[remote-desktop] Starting SSH tunnel PTY: {} {}", &ssh_bin, args.join(" "));

    let mut cmd = CommandBuilder::new(ssh_bin);
    cmd.args(&args);
    cmd.env("TERM", "xterm-256color");

    let mut child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("SSH spawn failed: {}", e))?;

    drop(pair.slave);

    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("clone reader failed: {}", e))?;

    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("take writer failed: {}", e))?;

    let master = pair.master;

    tracing::info!("[remote-desktop] SSH tunnel PTY started: local {} -> remote localhost:{}", local_port, vnc_port);
    Ok((master, reader, writer, child))
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

fn run_ssh_command(ssh: &SshConnectionInfo, command: &str) -> Result<String, String> {
    run_ssh_command_with_timeout(ssh, command, 30)
}

fn run_ssh_command_with_timeout(ssh: &SshConnectionInfo, command: &str, timeout_secs: u64) -> Result<String, String> {
    tracing::info!("[remote-desktop-setup] run_ssh_command: {}@{}:{} -> '{}'", ssh.username, ssh.host, ssh.port, command);

    let pty_system = native_pty_system();

    let pair = pty_system
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("openpty failed: {}", e))?;

    let ssh_bin = crate::core::platform::resolve_ssh_binary()?;

    let mut args: Vec<String> = Vec::new();
    args.push("-o".to_string());
    args.push("StrictHostKeyChecking=accept-new".to_string());
    args.push("-o".to_string());
    args.push(format!("ConnectTimeout=10"));

    if ssh.port != 22 {
        args.push("-p".to_string());
        args.push(ssh.port.to_string());
    }

    if ssh.auth_method == "private_key" {
        if let Some(key_path) = &ssh.private_key_path {
            args.push("-i".to_string());
            args.push(key_path.clone());
        }
    }

    args.push(format!("{}@{}", ssh.username, ssh.host));
    args.push(command.to_string());

    let mut cmd = CommandBuilder::new(ssh_bin);
    cmd.args(&args);
    cmd.env("TERM", "xterm-256color");

    let mut child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("SSH spawn failed: {}", e))?;

    drop(pair.slave);

    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("clone reader failed: {}", e))?;

    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("take writer failed: {}", e))?;

    let password = ssh.password.clone();
    let password_auth = ssh.auth_method == "password" && password.is_some();

    let output_arc: Arc<std::sync::Mutex<String>> = Arc::new(std::sync::Mutex::new(String::new()));
    let done_arc = Arc::new(std::sync::atomic::AtomicBool::new(false));

    let output_clone = output_arc.clone();
    let done_clone = done_arc.clone();

    let read_thread = std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        let mut trailing = String::with_capacity(512);
        let mut password_filled = !password_auth;
        let mut local_writer = writer;

        loop {
            match reader.read(&mut buf) {
                Ok(0) => {
                    tracing::info!("[remote-desktop-setup] PTY reader EOF, total output so far: {} bytes", output_clone.lock().map(|o| o.len()).unwrap_or(0));
                    break;
                }
                Ok(n) => {
                    let chunk = String::from_utf8_lossy(&buf[..n]).to_string();

                    if let Ok(mut out) = output_clone.lock() {
                        out.push_str(&chunk);
                    }

                    tracing::info!("[remote-desktop-setup] Read {} bytes, total: {}, password_filled: {}", n, output_clone.lock().map(|o| o.len()).unwrap_or(0), password_filled);

                    if !password_filled {
                        trailing.push_str(&chunk);
                        if trailing.len() > 1024 {
                            trailing = trailing[trailing.len() - 512..].to_string();
                        }
                        let lower = trailing.to_lowercase();
                        let needs_password = lower.ends_with("password:")
                            || lower.ends_with("password: ")
                            || lower.ends_with("passphrase:")
                            || (lower.contains("password:") && trailing.trim_end().ends_with(':'));

                        if needs_password {
                            tracing::info!("[remote-desktop-setup] Detected password prompt, auto-filling...");
                            if let Some(ref pwd) = password {
                                let pw_bytes = format!("{}\n", pwd);
                                let _ = local_writer.write_all(pw_bytes.as_bytes());
                                let _ = local_writer.flush();
                            }
                            password_filled = true;
                            trailing.clear();
                            tracing::info!("[remote-desktop-setup] Password auto-filled, continuing to read output...");
                        }
                    }

                    if password_filled {
                        tracing::debug!("[remote-desktop-setup] Post-fill output chunk ({} bytes): {}", chunk.len(), chunk.trim());
                    }
                }
                Err(_) => break,
            }
        }
        done_clone.store(true, std::sync::atomic::Ordering::Relaxed);
    });

    let start = std::time::Instant::now();
    loop {
        std::thread::sleep(std::time::Duration::from_millis(100));
        if done_arc.load(std::sync::atomic::Ordering::Relaxed) {
            break;
        }
        if start.elapsed().as_secs() > timeout_secs {
            tracing::warn!("[remote-desktop-setup] Command timed out after {}s", timeout_secs);
            let _ = child.kill();
            break;
        }
    }

    let _ = read_thread.join();
    let exit_status = child.wait();
    tracing::info!("[remote-desktop-setup] SSH child exit status: {:?}", exit_status);

    let output = output_arc.lock().unwrap().clone();
    tracing::info!("[remote-desktop-setup] Raw output ({} bytes): {}", output.len(), if output.len() > 300 { &output[..300] } else { &output });

    let cleaned = clean_ansi_output(&output);
    tracing::info!("[remote-desktop-setup] Cleaned output ({} bytes): {}", cleaned.len(), if cleaned.len() > 300 { &cleaned[..300] } else { &cleaned });

    Ok(cleaned)
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
