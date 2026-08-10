//! Platform-specific helpers for cross-platform compatibility.
//!
//! Targets macOS (parity baseline) and modern Windows 10/11.

use std::path::PathBuf;

/// Return the default interactive shell to spawn for the local terminal.
///
/// Selection strategy:
/// - macOS:  $SHELL → /bin/zsh
/// - Linux:  $SHELL → /bin/bash
/// - Windows: pwsh.exe → powershell.exe → %COMSPEC% → cmd.exe
pub fn default_shell() -> String {
    if cfg!(target_os = "windows") {
        for candidate in ["pwsh.exe", "powershell.exe"] {
            if find_executable(candidate).is_some() {
                return candidate.to_string();
            }
        }
        return std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".to_string());
    }

    if cfg!(target_os = "macos") {
        return std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    }

    std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string())
}

/// Resolve the ssh client binary to use for SSH terminals and remote-desktop tunnels.
///
/// On Windows the OpenSSH client lives at C:\Windows\System32\OpenSSH\ssh.exe on
/// modern Win10 1809+ and Win11. We probe PATH first, then the well-known
/// system location, and finally return a structured error so the UI can guide
/// the user to enable the optional feature.
pub fn resolve_ssh_binary() -> Result<String, String> {
    let exe = if cfg!(target_os = "windows") { "ssh.exe" } else { "ssh" };

    if let Some(p) = find_executable(exe) {
        return Ok(p.to_string_lossy().into_owned());
    }

    #[cfg(target_os = "windows")]
    {
        let system_root = std::env::var("SystemRoot").unwrap_or_else(|_| r"C:\Windows".to_string());
        let candidate = std::path::Path::new(&system_root)
            .join("System32")
            .join("OpenSSH")
            .join("ssh.exe");
        if candidate.exists() {
            return Ok(candidate.to_string_lossy().into_owned());
        }
    }

    Err(ssh_missing_hint())
}

fn ssh_missing_hint() -> String {
    if cfg!(target_os = "windows") {
        "SSH client not found.\n\n\
         Please enable OpenSSH Client on Windows:\n\
         1. Open Settings → Apps → Optional features\n\
         2. Add the 'OpenSSH Client' feature\n\n\
         Or run as Administrator in PowerShell:\n\
         Add-WindowsCapability -Online -Name OpenSSH.Client~~~~0.0.1.0"
            .to_string()
    } else {
        "SSH client (ssh) not found in PATH. Please install OpenSSH.".to_string()
    }
}

/// Resolve the `sftp` client binary used for file transfers (put/get/rm/rename/mkdir).
///
/// `sftp` ships in the same OpenSSH Client package as `ssh`, so the probe logic
/// mirrors [`resolve_ssh_binary`]. On Windows it lives right next to ssh.exe at
/// `C:\Windows\System32\OpenSSH\sftp.exe`.
pub fn resolve_sftp_binary() -> Result<String, String> {
    let exe = if cfg!(target_os = "windows") { "sftp.exe" } else { "sftp" };

    if let Some(p) = find_executable(exe) {
        return Ok(p.to_string_lossy().into_owned());
    }

    #[cfg(target_os = "windows")]
    {
        let system_root = std::env::var("SystemRoot").unwrap_or_else(|_| r"C:\Windows".to_string());
        let candidate = std::path::Path::new(&system_root)
            .join("System32")
            .join("OpenSSH")
            .join("sftp.exe");
        if candidate.exists() {
            return Ok(candidate.to_string_lossy().into_owned());
        }
    }

    Err(sftp_missing_hint())
}

fn sftp_missing_hint() -> String {
    if cfg!(target_os = "windows") {
        "SFTP client not found.\n\n\
         Please enable OpenSSH Client on Windows:\n\
         1. Open Settings → Apps → Optional features\n\
         2. Add the 'OpenSSH Client' feature\n\n\
         Or run as Administrator in PowerShell:\n\
         Add-WindowsCapability -Online -Name OpenSSH.Client~~~~0.0.1.0"
            .to_string()
    } else {
        "SFTP client (sftp) not found in PATH. Please install OpenSSH.".to_string()
    }
}

/// 从 `~/.ssh/known_hosts` 删除指定主机的旧 host key 记录。
///
/// 典型场景：远程主机重装系统后 host key 变更，`StrictHostKeyChecking=accept-new`
/// 对"已存在但 key 变了"的主机是直接拒绝的（`Host key verification failed`），
/// 必须先清掉旧记录再重连。连接链路（terminal_service / test_connection）在
/// 检测到 host key 失败时自动调用本函数，然后自动重连/重试。
pub fn clear_known_host(host: &str, port: u16) -> std::result::Result<(), String> {
    let bin = if cfg!(target_os = "windows") {
        "ssh-keygen.exe"
    } else {
        "ssh-keygen"
    };
    let bin = find_executable(bin)
        .ok_or_else(|| "ssh-keygen 未找到（需要 OpenSSH Client）".to_string())?;
    let target = known_hosts_entry(host, port);
    let status = std::process::Command::new(&bin)
        .arg("-R")
        .arg(target)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map_err(|e| format!("执行 ssh-keygen -R 失败: {}", e))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!(
            "ssh-keygen -R 退出码 {}",
            status.code().unwrap_or(-1)
        ))
    }
}

/// 判断一段 SSH 输出是否为「主机密钥变更」导致的中断。
///
/// `StrictHostKeyChecking=accept-new` 只对「全新」主机自动接受，对「已存在但
/// key 变了」的主机（典型场景：云服务器重装系统）直接拒绝并退出，输出中会出现
/// 下面两类文本之一。连接链路在检测到后调用 [`clear_known_host`] 清掉旧记录再
/// 重试一次，行为需与 terminal_service / test_connection 保持一致。
pub fn is_host_key_error(output: &str) -> bool {
    let low = output.to_lowercase();
    low.contains("host key verification failed")
        || low.contains("remote host identification has changed")
}

/// known_hosts 条目格式：IPv6 恒加方括号；非 22 端口为 `[host]:port`。
fn known_hosts_entry(host: &str, port: u16) -> String {
    let is_v6 = host.contains(':');
    if port == 22 {
        if is_v6 {
            format!("[{}]", host)
        } else {
            host.to_string()
        }
    } else {
        format!("[{}]:{}", host, port)
    }
}

/// Look up an executable by name. Honors PATH and (on Windows) PATHEXT.
pub fn find_executable(name: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    let exts: Vec<String> = if cfg!(target_os = "windows") {
        std::env::var("PATHEXT")
            .unwrap_or_else(|_| ".EXE;.CMD;.BAT;.COM".to_string())
            .split(';')
            .map(|s| s.to_lowercase())
            .collect()
    } else {
        vec![String::new()]
    };

    for dir in std::env::split_paths(&path) {
        let candidate = dir.join(name);
        if candidate.is_file() {
            return Some(candidate);
        }
        // If `name` has no extension on Windows, try appending PATHEXT entries.
        if cfg!(target_os = "windows")
            && std::path::Path::new(name).extension().is_none()
        {
            for ext in &exts {
                if ext.is_empty() {
                    continue;
                }
                let with_ext = dir.join(format!("{}{}", name, ext));
                if with_ext.is_file() {
                    return Some(with_ext);
                }
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::{is_host_key_error, known_hosts_entry};

    #[test]
    fn known_hosts_entry_formats() {
        // IPv4 默认端口：裸主机名
        assert_eq!(known_hosts_entry("1.2.3.4", 22), "1.2.3.4");
        // IPv4 非默认端口：[host]:port
        assert_eq!(known_hosts_entry("1.2.3.4", 2222), "[1.2.3.4]:2222");
        // IPv6 恒加括号
        assert_eq!(known_hosts_entry("2001:db8::1", 22), "[2001:db8::1]");
        assert_eq!(known_hosts_entry("2001:db8::1", 2222), "[2001:db8::1]:2222");
    }

    #[test]
    fn is_host_key_error_detects_known_variants() {
        assert!(is_host_key_error(
            "@@@    WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!     @@@\n\
             Host key verification failed."
        ));
        assert!(is_host_key_error(
            "Host key verification failed."
        ));
        assert!(is_host_key_error(
            "REMOTE HOST IDENTIFICATION HAS CHANGED!"
        ));
        // 普通认证失败不应误判为 host key 问题
        assert!(!is_host_key_error(
            "Permission denied (publickey,password)."
        ));
        assert!(!is_host_key_error(""));
    }
}
