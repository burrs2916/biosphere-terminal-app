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
    use super::known_hosts_entry;

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
}
