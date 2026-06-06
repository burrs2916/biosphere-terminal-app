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

/// Look up an executable by name. Honors PATH and (on Windows) PATHEXT.
fn find_executable(name: &str) -> Option<PathBuf> {
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
