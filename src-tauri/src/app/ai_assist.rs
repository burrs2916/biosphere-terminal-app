use serde::Serialize;

/// 诊断结果：描述发现的问题并提供修复命令
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VncDiagnosis {
    /// 是否识别出已知问题
    pub has_diagnosis: bool,
    /// 问题简述（如"EPEL 仓库未启用"）
    pub issue: String,
    /// 问题详细说明
    pub detail: String,
    /// 修复命令（可直接在终端执行）
    pub fix_command: String,
    /// 置信度 0.0~1.0
    pub confidence: f64,
}

/// 常见的 VNC 安装错误模式匹配与修复建议
///
/// 这是一个基于规则的症状诊断引擎，覆盖绝大多数主流发行版的安装错误。
/// 对于无法识别的错误，返回 has_diagnosis=false，前端可降级为通用提示。
pub fn diagnose_vnc_error(os_name: &str, terminal_output: &str, _command_was: &str) -> VncDiagnosis {
    let output = terminal_output.to_lowercase();
    let os = os_name.to_lowercase();

    // ── Debian / Ubuntu ──────────────────────────────────────────────
    if os.contains("debian") || os.contains("ubuntu") {
        // dpkg 锁
        if contains_any(&output, &[
            "dpkg: error: dpkg frontend is locked",
            "could not get lock",
            "dpkg: error: dpkg was interrupted",
            "dpkg: error: dpkg backend is locked",
            "is locked by another process",
            "unable to lock the administration directory",
        ]) {
            return VncDiagnosis {
                has_diagnosis: true,
                issue: "dpkg 包管理器被锁定".into(),
                detail: "另一个 APT/dpkg 进程正在运行，导致安装命令无法执行。常见原因：后台正在自动更新（unattended-upgrades），或上次安装中断留有锁文件。".into(),
                fix_command: "sudo rm -f /var/lib/dpkg/lock-frontend /var/lib/dpkg/lock /var/cache/apt/archives/lock /var/lib/apt/lists/lock 2>/dev/null; sudo DEBIAN_FRONTEND=noninteractive dpkg --configure -a 2>/dev/null; sudo DEBIAN_FRONTEND=noninteractive apt update -y 2>/dev/null".into(),
                confidence: 0.95,
            };
        }

        // 软件包找不到
        if contains_any(&output, &[
            "unable to locate package",
            "package 'tigervnc' has no installation candidate",
            "e: package '",
            "has no installation candidate",
            "e: unable to fetch some archives",
        ]) {
            return VncDiagnosis {
                has_diagnosis: true,
                issue: "软件包未找到或仓库源不可用".into(),
                detail: "APT 仓库中找不到指定的 VNC 包，可能是因为系统没有启用 universe 仓库，或网络无法访问 Ubuntu/Debian 镜像源。".into(),
                fix_command: "sudo apt update 2>/dev/null; sudo apt install -y software-properties-common 2>/dev/null; sudo add-apt-repository -y universe 2>/dev/null; sudo apt update 2>/dev/null".into(),
                confidence: 0.9,
            };
        }

        // 网络问题
        if contains_any(&output, &[
            "temporary failure resolving",
            "could not resolve",
            "failed to fetch",
            "connection timed out",
            "connection refused",
            "network is unreachable",
        ]) {
            return VncDiagnosis {
                has_diagnosis: true,
                issue: "网络连接问题".into(),
                detail: "远程服务器无法访问 APT 仓库，可能是 DNS 解析失败、网络不通或防火墙拦截了 80/443 端口。".into(),
                fix_command: "curl -s --connect-timeout 5 https://deb.debian.org >/dev/null 2>&1 && echo 'NETWORK_OK' || echo 'NETWORK_FAILED'; ping -c 1 -W 3 8.8.8.8 >/dev/null 2>&1 && echo 'PING_OK' || echo 'PING_FAILED'".into(),
                confidence: 0.85,
            };
        }
    }

    // ── RHEL / CentOS / Rocky / AlmaLinux / Oracle / Amazon Linux ──
    if os.contains("rhel") || os.contains("centos") || os.contains("rocky")
        || os.contains("almalinux") || os.contains("ol") || os.contains("oracle")
        || os.contains("amzn")
    {
        // EPEL 仓库未启用（TigerVNC 包找不到）
        // 注意：此检查必须放在 EPEL-release 检查之后，避免"no match for argument"等宽泛模式抢匹配
        if contains_any(&output, &[
            "no package tigervnc-server available",
            "nothing matches tigervnc-server",
            "no match for argument: tigervnc-server",
            "no match for argument: tigervnc",
            "no package tigervnc available",
            "nothing matches",
            "no package matched",
            "cannot find a valid baseurl for repo",
            "not in any repository",
            "no package found for",
        ]) {
            let epel_cmd = if os.contains("amzn") {
                "sudo amazon-linux-extras install -y epel 2>/dev/null || sudo yum install -y https://dl.fedoraproject.org/pub/epel/epel-release-latest-7.noarch.rpm 2>/dev/null || true".to_string()
            } else {
                let epel_ver = if os.contains("centos") || os.contains("rocky") || os.contains("almalinux") || os.contains("ol") {
                    // 尝试自动检测版本并安装对应 EPEL
                    "rpm -q epel-release 2>/dev/null || (sudo yum install -y epel-release 2>/dev/null || (sudo yum install -y https://dl.fedoraproject.org/pub/epel/epel-release-latest-$(rpm -E %rhel 2>/dev/null).noarch.rpm 2>/dev/null || sudo yum install -y https://dl.fedoraproject.org/pub/epel/epel-release-latest-8.noarch.rpm 2>/dev/null) || echo '[WARN] EPEL install failed; try manually: sudo yum install epel-release')".to_string()
                } else {
                    "sudo yum install -y epel-release 2>/dev/null || echo '[WARN] Failed to install epel-release; check your subscription'.to_string()".to_string()
                };
                epel_ver
            };

            return VncDiagnosis {
                has_diagnosis: true,
                issue: "EPEL 仓库未启用".into(),
                detail: "TigerVNC 包在 RHEL 家族的 EPEL（Extra Packages for Enterprise Linux）仓库中。当前系统没有启用 EPEL 仓库，导致 yum 找不到 tigervnc-server。".into(),
                fix_command: format!("{} && sudo yum install -y tigervnc-server dbus-x11 xterm 2>/dev/null", epel_cmd),
                confidence: 0.95,
            };
        }

        // EPEL 仓库本身找不到（epel-release 包不存在）
        // 常见于 Rocky Linux 9 / RHEL 9：需要先启用 CRB 仓库才能安装 epel-release
        if contains_any(&output, &[
            "no match for argument: epel-release",
            "unable to find a match: epel-release",
            "no package epel-release available",
            "nothing matches epel-release",
        ]) {
            // 检测是否为 RHEL 9 系列（需要 CRB）
            let crb_step = "sudo dnf install -y dnf-plugins-core 2>/dev/null; sudo dnf config-manager --set-enabled crb 2>/dev/null || true";
            return VncDiagnosis {
                has_diagnosis: true,
                issue: "EPEL 仓库无法安装（需要先启用 CRB）".into(),
                detail: "Rocky Linux 9 / RHEL 9 系列需要先启用 CRB（Code Ready Builder）仓库，然后才能安装 EPEL。当前 EPEL 仓库未配置，导致 Xfce 桌面环境无法安装，VNC 回退到无桌面模式（xterm）。".into(),
                fix_command: format!("{} && sudo dnf install -y epel-release 2>/dev/null && sudo dnf groupinstall -y 'Xfce' 2>/dev/null || (sudo dnf install -y https://dl.fedoraproject.org/pub/epel/epel-release-latest-9.noarch.rpm 2>/dev/null && sudo dnf groupinstall -y 'Xfce' 2>/dev/null) || echo '[WARN] Xfce group install failed; EPEL may need manual setup'", crb_step),
                confidence: 0.95,
            };
        }

        // Xfce 桌面组安装失败（安装脚本的 fallback 日志）
        if contains_any(&output, &[
            "xfce group unavailable",
            "xfce group not available",
            "xfce install failed",
            "warning: group xfce does not exist",
            "no group named xfce",
            "no match for group",
            "group xfce is not installed",
        ]) {
            return VncDiagnosis {
                has_diagnosis: true,
                issue: "Xfce 桌面组未安装".into(),
                detail: "安装脚本检测到 Xfce 桌面组不可用，自动回退到无桌面模式（xterm）。常见原因：EPEL 仓库未配置或网络问题。VNC 服务器已安装，但无法提供完整桌面环境。".into(),
                fix_command: "sudo dnf install -y dnf-plugins-core 2>/dev/null; sudo dnf config-manager --set-enabled crb 2>/dev/null || true; sudo dnf install -y epel-release 2>/dev/null || sudo dnf install -y https://dl.fedoraproject.org/pub/epel/epel-release-latest-9.noarch.rpm 2>/dev/null; sudo dnf groupinstall -y 'Xfce' 2>/dev/null || sudo dnf install -y xfce4-session xfce4-panel xfwm4 xfdesktop 2>/dev/null || echo '[WARN] Xfce packages not available; xterm session will be used'".into(),
                confidence: 0.95,
            };
        }

        // 仓库问题
        if contains_any(&output, &[
            "cannot find a valid baseurl for repo",
            "failure: repodata/repomd.xml",
            "could not resolve host",
            "peer certificate cannot be authenticated",
            "download failed",
        ]) {
            return VncDiagnosis {
                has_diagnosis: true,
                issue: "YUM 仓库源不可用".into(),
                detail: "YUM 无法连接到仓库服务器，可能是网络问题、DNS 解析失败，或 SSL 证书过期。".into(),
                fix_command: "sudo yum clean all 2>/dev/null; sudo yum makecache 2>/dev/null || echo '[WARN] Repository cache refresh failed; check network connectivity'".into(),
                confidence: 0.85,
            };
        }
    }

    // ── Fedora ──────────────────────────────────────────────────────
    if os.contains("fedora") {
        if contains_any(&output, &[
            "no match for argument",
            "unable to find a match",
            "no package matched",
        ]) {
            return VncDiagnosis {
                has_diagnosis: true,
                issue: "软件包未找到".into(),
                detail: "DNF 找不到指定的软件包，可能是 Fedora 版本较新导致包名变更，或需要启用额外的仓库（如 RPM Fusion）。".into(),
                fix_command: "sudo dnf install -y tigervnc-server dbus-x11 xterm 2>/dev/null || sudo dnf install -y tigervnc-server-minimal 2>/dev/null || echo '[WARN] Package not found; check: sudo dnf search tigervnc'".into(),
                confidence: 0.85,
            };
        }
    }

    // ── Arch Linux / Manjaro ────────────────────────────────────────
    if os.contains("arch") || os.contains("manjaro") {
        if contains_any(&output, &[
            "error: target not found",
            "error: failed to commit transaction",
            "could not find or read package",
            "error: package was not found",
            "error: failed to synchronize all databases",
            "error: failed to init transaction",
            "unable to lock database",
        ]) {
            let sync_cmd = if contains_any(&output, &["could not find or read package", "failed to synchronize all databases"]) {
                "sudo pacman -Sy 2>/dev/null || echo '[WARN] Pacman sync failed; check network'".to_string()
            } else if contains_any(&output, &["unable to lock database", "failed to init transaction"]) {
                "sudo rm -f /var/lib/pacman/db.lck 2>/dev/null && sudo pacman -Sy 2>/dev/null".to_string()
            } else {
                String::new()
            };
            let fix = if sync_cmd.is_empty() {
                "sudo pacman -S --noconfirm tigervnc xterm 2>/dev/null || echo '[WARN] Package not found; try: sudo pacman -Ss tigervnc'".to_string()
            } else {
                format!("{} && sudo pacman -S --noconfirm tigervnc xterm 2>/dev/null", sync_cmd)
            };
            return VncDiagnosis {
                has_diagnosis: true,
                issue: "Pacman 同步或包查找失败".into(),
                detail: "pacman 无法找到或安装指定的软件包，可能是数据库未同步、网络问题或包名变更。".into(),
                fix_command: fix,
                confidence: 0.85,
            };
        }
    }

    // ── macOS ────────────────────────────────────────────────────────
    if os.contains("macos") {
        if contains_any(&output, &[
            "brew: command not found",
            "homebrew not found",
            "zsh: command not found: brew",
        ]) {
            return VncDiagnosis {
                has_diagnosis: true,
                issue: "Homebrew 未安装".into(),
                detail: "macOS 上需要通过 Homebrew 安装 TigerVNC，但当前系统未安装 Homebrew。Homebrew 是 macOS 最流行的包管理器。".into(),
                fix_command: "/bin/bash -c \"$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\"".into(),
                confidence: 0.95,
            };
        }

        if contains_any(&output, &[
            "xquartz: no such file or directory",
            "xquartz is not installed",
            "cask 'xquartz' is not installed",
        ]) {
            return VncDiagnosis {
                has_diagnosis: true,
                issue: "XQuartz 未安装".into(),
                detail: "TigerVNC 在 macOS 上依赖 XQuartz（X11 环境），但 XQuartz 未安装或未正确安装。".into(),
                fix_command: "brew install --cask xquartz 2>/dev/null || echo '[WARN] XQuartz install failed; download from https://www.xquartz.org'".into(),
                confidence: 0.9,
            };
        }
    }

    // ── VNC 服务启动失败（跨发行版） ─────────────────────────────────
    // 所有 vncserver 错误消息都以 "vncserver:" 为前缀，先用 sentinel 线排除安装阶段的输出误匹配。
    // 注意：终端输出可能包含命令回显（如 "vncserver :1 -geometry..."），所以不能只匹配"vncserver:"。
    // 我们匹配更具区分度的 vncserver 错误模式。
    let has_vncserver_error = contains_any(&output, &[
        "vncserver: a ",
        "vncserver: could not",
        "vncserver: failed",
        "vncserver: bad option",
        "vncserver: unrecognized",
        "vncserver: error",
        "vncserver: no",
        "vncserver: permission",
        "vncserver: warning",
        "could not start xvnc",
        "xvnc:",
        "xauth:  file",
        "xauth: timeout",
        "xstartup: permission denied",
        "xstartup: not found",
        "xstartup: no such file",
        "startxfce4: command not found",
        "xfce4-session: command not found",
        "could not open default font",
        "could not open display",
        "vnc children crashed",
        "session cleanly exited",
        "vncserver is already running",
        "a vnc server is already running",
        "already running as :1",
        "locking file",
        "unable to open display",
        "vncext:",
        "vnc extension",
    ]);
    if has_vncserver_error {
        // 显示端口被占用
        if contains_any(&output, &[
            "already running as :1",
            "vnc server is already running",
            "a vnc server is already running",
        ]) {
            return VncDiagnosis {
                has_diagnosis: true,
                issue: "VNC 显示端口 :1 已被占用".into(),
                detail: "VNC 服务器已经在显示端口 :1 上运行，因此无法再次启动。可能是之前启动的 VNC 会话没有正确关闭。需要先杀掉旧会话再重新启动。".into(),
                fix_command: "vncserver -kill :1 2>/dev/null; sleep 1; rm -f /tmp/.X11-unix/X1 /tmp/.X1-lock ~/.vnc/*.pid ~/.vnc/*.lock 2>/dev/null; vncserver :1 -geometry 1280x800 -depth 24 -localhost no".into(),
                confidence: 0.95,
            };
        }
        // 桌面环境/startup 脚本问题
        if contains_any(&output, &[
            "startxfce4: command not found",
            "xfce4-session: command not found",
            "xstartup: permission denied",
            "xstartup: not found",
            "xstartup: no such file",
        ]) {
            let xstartup_script = "mkdir -p ~/.vnc && printf '#!/bin/sh\\nunset SESSION_MANAGER\\nunset DBUS_SESSION_BUS_ADDRESS\\nif command -v startxfce4 >/dev/null 2>&1; then\\n  exec startxfce4\\nelif command -v gnome-session >/dev/null 2>&1; then\\n  exec gnome-session\\nelse\\n  exec xterm\\nfi\\n' > ~/.vnc/xstartup && chmod +x ~/.vnc/xstartup";
            if contains_any(&output, &["startxfce4: command not found", "xfce4-session: command not found"]) {
                return VncDiagnosis {
                    has_diagnosis: true,
                    issue: "桌面环境未安装，xstartup 无法启动 Xfce".into(),
                    detail: "VNC 的 ~/.vnc/xstartup 启动脚本尝试启动 Xfce 桌面环境，但系统中没有安装 startxfce4。需要安装桌面环境，或修改 xstartup 使用 xterm 兜底。".into(),
                    fix_command: format!("which startxfce4 2>/dev/null || echo 'Xfce not installed'; ls -la ~/.vnc/xstartup 2>/dev/null; {} ; echo '[INFO] Re-run the start step after fixing'", xstartup_script),
                    confidence: 0.85,
                };
            }
            return VncDiagnosis {
                has_diagnosis: true,
                issue: "VNC 启动脚本 ~/.vnc/xstartup 缺失或权限错误".into(),
                detail: "VNC 启动时需要执行 ~/.vnc/xstartup 脚本，但该文件不存在或没有执行权限。需要创建该脚本并赋予可执行权限。".into(),
                fix_command: xstartup_script.into(),
                confidence: 0.9,
            };
        }
        // 参数不兼容
        if contains_any(&output, &[
            "vncserver: bad option",
            "vncserver: unrecognized",
            "unrecognized option",
        ]) {
            return VncDiagnosis {
                has_diagnosis: true,
                issue: "VNC 服务器版本与启动参数不兼容".into(),
                detail: "当前安装的 TigerVNC 版本不支持启动命令中的某些参数（如 -geometry 或 -depth）。常见于较旧的 TigerVNC 版本（< 1.8）或 TightVNC。".into(),
                fix_command: "vncserver --version 2>&1; vncserver :1 -localhost no 2>&1 || echo '[WARN] Try without -geometry/-depth flags'".into(),
                confidence: 0.85,
            };
        }
        // Xvnc / Xauthority 问题
        if contains_any(&output, &[
            "could not start xvnc",
            "xvnc:",
            "vncserver: could not start",
            "vncserver: failed to create xauthority",
            "xauth:  file",
            "xauth: timeout",
        ]) {
            return VncDiagnosis {
                has_diagnosis: true,
                issue: "Xvnc 或 Xauthority 配置错误".into(),
                detail: "vncserver 无法启动 Xvnc 进程或创建 Xauthority 文件。常见原因：TigerVNC 安装不完整（缺少 Xvnc 二进制）、~/.vnc 目录权限问题、或 SELinux 限制。".into(),
                fix_command: "which Xvnc 2>/dev/null || echo 'Xvnc binary not found!'; ls -la ~/.vnc/ 2>/dev/null; vncserver -kill :1 2>/dev/null; sleep 1; rm -f /tmp/.X11-unix/X1 /tmp/.X1-lock 2>/dev/null; vncserver :1 -localhost no 2>&1 | head -20".into(),
                confidence: 0.85,
            };
        }
        // 锁文件问题
        if contains_any(&output, &[
            "locking file",
            "unable to open display",
            "vncext:",
            "vnc extension",
        ]) {
            return VncDiagnosis {
                has_diagnosis: true,
                issue: "VNC 锁文件或显示残留问题".into(),
                detail: "VNC 启动时发现锁文件或显示残留，可能是上次 VNC 会话异常退出导致。需要清理锁文件和临时目录后重试。".into(),
                fix_command: "vncserver -kill :1 2>/dev/null; sleep 1; rm -f /tmp/.X11-unix/X1 /tmp/.X1-lock ~/.vnc/*.pid ~/.vnc/*.lock 2>/dev/null; ls -la ~/.vnc/ 2>/dev/null; vncserver :1 -geometry 1280x800 -depth 24 -localhost no".into(),
                confidence: 0.85,
            };
        }
        // 通用 VNC 启动失败
        return VncDiagnosis {
            has_diagnosis: true,
            issue: "VNC 服务器启动失败".into(),
            detail: "vncserver 命令未能成功启动。可能原因：Xvnc 二进制文件缺失、显示端口被占用、~/.vnc 目录权限问题、或系统缺少必要的 X11 依赖。正在检查 VNC 日志文件以获取更多信息。".into(),
            fix_command: "vncserver --version 2>&1; ls -la ~/.vnc/ 2>/dev/null; cat ~/.vnc/*.log 2>/dev/null | tail -30; vncserver -kill :1 2>/dev/null; sleep 1; rm -f /tmp/.X11-unix/X1 /tmp/.X1-lock 2>/dev/null; vncserver :1 -localhost no 2>&1 || echo '[WARN] VNC start failed; check ~/.vnc/*.log for details'".into(),
            confidence: 0.75,
        };
    }

    // ── 通用模式（跨发行版） ─────────────────────────────────────────
    // sudo 不存在
    if contains_any(&output, &[
        "sudo: command not found",
        "sudo: not found",
    ]) {
        return VncDiagnosis {
            has_diagnosis: true,
            issue: "sudo 命令缺失".into(),
            detail: "当前系统没有安装 sudo，或 root 用户的 PATH 中不包含 sudo。容器环境或精简系统常见此问题。".into(),
            fix_command: "su -c 'apt update && apt install -y sudo' 2>/dev/null || su -c 'yum install -y sudo' 2>/dev/null || su -c 'dnf install -y sudo' 2>/dev/null || echo '[WARN] Install sudo manually'".into(),
            confidence: 0.9,
        };
    }

    // 权限不足
    if contains_any(&output, &[
        "permission denied",
        "authentication failure",
        "sorry, try again",
        "sudo: 1 incorrect password attempt",
    ]) {
        return VncDiagnosis {
            has_diagnosis: true,
            issue: "sudo 权限或密码错误".into(),
            detail: "当前用户没有 sudo 权限，或输入的 sudo 密码不正确。安装软件包需要 root 权限。".into(),
            fix_command: "echo '[INFO] Check that the user has sudo privileges or the correct sudo password was provided'".into(),
            confidence: 0.8,
        };
    }

    // 磁盘空间不足
    if contains_any(&output, &[
        "no space left on device",
        "disk full",
        "not enough free disk space",
        "insufficient disk space",
        "write error: disk full",
    ]) {
        return VncDiagnosis {
            has_diagnosis: true,
            issue: "磁盘空间不足".into(),
            detail: "远程服务器的磁盘空间已满，无法安装新软件包。需要清理磁盘空间。".into(),
            fix_command: "df -h / 2>/dev/null; sudo apt autoremove --purge -y 2>/dev/null; sudo apt autoclean -y 2>/dev/null; sudo yum autoremove -y 2>/dev/null; sudo dnf autoremove -y 2>/dev/null; echo '[INFO] Check disk usage above; free up space if needed'".into(),
            confidence: 0.9,
        };
    }

    // ── 未识别 ────────────────────────────────────────────────────────
    VncDiagnosis {
        has_diagnosis: false,
        issue: String::new(),
        detail: String::new(),
        fix_command: String::new(),
        confidence: 0.0,
    }
}

/// 检查 output 中是否包含任意一个 pattern（不区分大小写已在调用前处理）
fn contains_any(output: &str, patterns: &[&str]) -> bool {
    patterns.iter().any(|p| output.contains(p))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_dpkg_lock() {
        let r = diagnose_vnc_error("ubuntu", "dpkg: error: dpkg frontend is locked", "");
        assert!(r.has_diagnosis);
        assert!(r.issue.contains("dpkg"));
        assert!(!r.fix_command.is_empty());
    }

    #[test]
    fn test_epel_missing() {
        let r = diagnose_vnc_error("rocky", "No package tigervnc-server available.", "");
        assert!(r.has_diagnosis);
        assert!(r.issue.contains("EPEL"));
    }

    #[test]
    fn test_epel_release_not_found() {
        // Rocky Linux 9: epel-release 包找不到（需要先启用 CRB）
        let r = diagnose_vnc_error("rocky", "No match for argument: epel-release\nError: Unable to find a match: epel-release", "");
        assert!(r.has_diagnosis, "expected diagnosis for epel-release not found");
        assert!(r.issue.contains("EPEL") || r.issue.contains("CRB"), "issue should mention EPEL or CRB, got: {}", r.issue);
        assert!(r.fix_command.contains("crb"), "fix_command should mention crb, got: {}", r.fix_command);
    }

    #[test]
    fn test_xfce_group_unavailable() {
        // 安装脚本 fallback 日志
        let r = diagnose_vnc_error("rocky", "[WARN] Xfce group unavailable; VNC will start an xterm session\n__RD:install:1:0", "");
        assert!(r.has_diagnosis);
        assert!(r.issue.contains("Xfce"));
        assert!(r.fix_command.contains("epel-release"));
    }

    #[test]
    fn test_brew_missing() {
        let r = diagnose_vnc_error("macos", "brew: command not found", "");
        assert!(r.has_diagnosis);
        assert!(r.issue.contains("Homebrew"));
    }

    #[test]
    fn test_unknown() {
        let r = diagnose_vnc_error("unknown", "some random error", "");
        assert!(!r.has_diagnosis);
    }
}