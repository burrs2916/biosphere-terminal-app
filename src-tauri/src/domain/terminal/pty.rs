#![allow(dead_code)]

use crate::core::error::Result;
use crate::core::types::{PtyConfig, SshConnectionInfo};
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};

pub struct Pty {
    master: Arc<Mutex<Box<dyn MasterPty + Send>>>,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    child: Arc<Mutex<Box<dyn portable_pty::Child + Send>>>,
}

impl Pty {
    pub fn spawn(config: &PtyConfig) -> Result<Self> {
        let pty_system = native_pty_system();

        let pair = pty_system
            .openpty(PtySize {
                rows: config.rows,
                cols: config.cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| crate::core::error::Error::Terminal(format!("openpty failed: {}", e)))?;

        let cmd = Self::build_command(config)
            .map_err(|e| crate::core::error::Error::Terminal(e))?;

        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| crate::core::error::Error::Terminal(format!("spawn failed: {}", e)))?;

        drop(pair.slave);

        let _reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| crate::core::error::Error::Terminal(format!("clone reader failed: {}", e)))?;

        let writer = pair
            .master
            .take_writer()
            .map_err(|e| crate::core::error::Error::Terminal(format!("take writer failed: {}", e)))?;

        Ok(Pty {
            master: Arc::new(Mutex::new(pair.master)),
            writer: Arc::new(Mutex::new(writer)),
            child: Arc::new(Mutex::new(child)),
        })
    }

    fn build_command(config: &PtyConfig) -> std::result::Result<CommandBuilder, String> {
        let conn_type = config.connection_type.as_deref().unwrap_or("local");

        if conn_type == "ssh" {
            if let Some(ssh) = &config.ssh {
                return Self::build_ssh_command(ssh, config.x11_forwarding.unwrap_or(false), None, None);
            }
        }

        Ok(Self::build_local_command(config))
    }

    fn build_local_command(config: &PtyConfig) -> CommandBuilder {
        let shell = config
            .shell
            .clone()
            .filter(|s| !s.trim().is_empty() && shell_exists(s))
            .unwrap_or_else(crate::core::platform::default_shell);
        let mut cmd = CommandBuilder::new(&shell);
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");

        // Windows 控制台默认 OEM 代码页 936(GBK)，而本应用/ConPTY 全程 UTF-8：
        // 不切换到 UTF-8 代码页的话，中文（以及其它非 ASCII）输入会按 GBK 解读成
        // 乱码/无效命令（现象：输入中文后按回车"没有效果"）。
        // - cmd.exe：`/K chcp 65001` 保留交互并切 UTF-8 代码页；
        // - powershell.exe(5.1)：同样受 chcp 影响（`-NoExit -Command` 保留交互）；
        // - pwsh(7+)：默认 UTF-8，无需处理。
        #[cfg(target_os = "windows")]
        {
            let name = std::path::Path::new(&shell)
                .file_name()
                .map(|s| s.to_string_lossy().to_lowercase())
                .unwrap_or_default();
            if name.ends_with("cmd.exe") || name == "cmd" {
                cmd.args(&["/K", "chcp", "65001>nul"]);
            } else if name.ends_with("powershell.exe") {
                cmd.args(&["-NoExit", "-Command", "chcp 65001>nul"]);
            }
        }

        if let Some(cwd) = &config.cwd {
            cmd.cwd(cwd);
        }

        if let Some(env) = &config.env {
            for (key, value) in env {
                cmd.env(key, value);
            }
        }

        cmd
    }

    fn build_ssh_command(
        ssh: &SshConnectionInfo,
        x11_forwarding: bool,
        remote_command: Option<&str>,
        connect_timeout: Option<u64>,
    ) -> std::result::Result<CommandBuilder, String> {
        let ssh_bin = crate::core::platform::resolve_ssh_binary()?;

        let mut args: Vec<String> = Vec::new();

        args.push("-o".to_string());
        args.push("StrictHostKeyChecking=accept-new".to_string());

        // 仅测试会话（密码模式）传入 connect_timeout：给 ssh 设 TCP 连接超时，
        // 避免主机不可达时 ssh 一直重试 SYN 导致测试线程卡死。
        // ssh 用非阻塞 connect + select 实现 ConnectTimeout，跨平台可靠（区别于 std 的不可靠 connect_timeout）。
        if let Some(secs) = connect_timeout {
            args.push("-o".to_string());
            args.push(format!("ConnectTimeout={}", secs));
        }

        if x11_forwarding {
            args.push("-X".to_string());
        }

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
        if let Some(remote) = remote_command {
            args.push(remote.to_string());
        }

        let mut cmd = CommandBuilder::new(ssh_bin);
        cmd.args(&args);
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");
        // 强制 ssh 客户端用英文消息目录：OpenSSH 会把密码提示本地化成客户端
        // locale（中文系统下是 "user@host 的密码："），只匹配英文 "password:"
        // 的自动喂密码逻辑会漏检，导致认证失败。LC_MESSAGES=C 让提示恒为
        // 英文 "Password: "，是确定性修复（与 sftp 的 locale_env 同一哲学）。
        cmd.env("LC_MESSAGES", "C");
        Ok(cmd)
    }

    /// 用于 `test_connection` 的密码模式：用 pty 起一个带远端命令（如 `true`）的 ssh 会话，
    /// 以便通过 pty-expect 自动喂密码完成真实身份认证。
    /// 零外部依赖，仅用系统自带 ssh + portable-pty。
    pub fn spawn_ssh_command_session(
        ssh: &SshConnectionInfo,
        remote_command: &str,
    ) -> Result<Self> {
        let cmd = Self::build_ssh_command(ssh, false, Some(remote_command), Some(10))
            .map_err(|e| crate::core::error::Error::Terminal(e))?;
        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| {
                crate::core::error::Error::Terminal(format!("openpty failed: {}", e))
            })?;

        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| {
                crate::core::error::Error::Terminal(format!("spawn failed: {}", e))
            })?;
        drop(pair.slave);

        let writer = pair
            .master
            .take_writer()
            .map_err(|e| {
                crate::core::error::Error::Terminal(format!("take writer failed: {}", e))
            })?;

        Ok(Pty {
            master: Arc::new(Mutex::new(pair.master)),
            writer: Arc::new(Mutex::new(writer)),
            child: Arc::new(Mutex::new(child)),
        })
    }

    /// 阻塞等待 ssh 子进程退出，返回退出码。
    pub fn wait(&self) -> Result<i32> {
        let mut child = self.child.lock().unwrap();
        child
            .wait()
            .map(|s| s.exit_code() as i32)
            .map_err(|e| crate::core::error::Error::Terminal(format!("wait failed: {}", e)))
    }

    /// Establish an SSH ControlMaster (`ssh -M -N`) via a pty so password auth can
    /// be fed interactively — the exact same proven path as `spawn_ssh_command_session`
    /// (same `TERM` env, same `StrictHostKeyChecking`/`ConnectTimeout` flags). The
    /// control socket at `control_path` is created by ssh only AFTER successful
    /// authentication; the caller must keep the returned `Pty` alive for the transfer
    /// and `kill()` it afterwards.
    pub fn spawn_ssh_master(ssh: &SshConnectionInfo, control_path: &str) -> Result<Self> {
        let mut cmd = Self::build_ssh_command(ssh, false, None, Some(10))
            .map_err(|e| crate::core::error::Error::Terminal(e))?;

        // Master mode: stay alive (-N, no remote command) and own the control socket.
        // ServerAlive* keeps the shared connection up across NAT/firewall idle
        // timeouts so a long transfer multiplexed over it is not cut halfway.
        let master_args: Vec<String> = vec![
            "-M".to_string(),
            "-N".to_string(),
            "-o".to_string(),
            "ControlMaster=yes".to_string(),
            "-o".to_string(),
            format!("ControlPath={}", control_path),
            "-o".to_string(),
            "ServerAliveInterval=20".to_string(),
            "-o".to_string(),
            "ServerAliveCountMax=6".to_string(),
        ];
        cmd.args(&master_args);

        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| {
                crate::core::error::Error::Terminal(format!("openpty failed: {}", e))
            })?;

        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| {
                crate::core::error::Error::Terminal(format!("spawn failed: {}", e))
            })?;
        drop(pair.slave);

        let writer = pair
            .master
            .take_writer()
            .map_err(|e| {
                crate::core::error::Error::Terminal(format!("take writer failed: {}", e))
            })?;

        Ok(Pty {
            master: Arc::new(Mutex::new(pair.master)),
            writer: Arc::new(Mutex::new(writer)),
            child: Arc::new(Mutex::new(child)),
        })
    }

    /// Spawn an arbitrary program attached to a pty.
    ///
    /// Used by the SFTP transfer path: OpenSSH's `sftp` only renders its
    /// progress meter when stdout is a tty, so a plain piped child would leave
    /// the UI with no way to report upload/download progress.
    pub fn spawn_program(program: &str, args: &[String], cols: u16) -> Result<Self> {
        Self::spawn_program_with_env(program, args, cols, &[("TERM", "xterm-256color")])
    }

    /// Same as [`spawn_program`] but with an explicit environment overlay.
    ///
    /// The interactive SFTP session asks for `TERM=dumb`: OpenSSH's `sftp`
    /// enables libedit whenever stdin is a tty, and a dumb terminal keeps the
    /// echoed prompt free of cursor-movement escapes we would have to strip.
    pub fn spawn_program_with_env(
        program: &str,
        args: &[String],
        cols: u16,
        envs: &[(&str, &str)],
    ) -> Result<Self> {
        let mut cmd = CommandBuilder::new(program);
        cmd.args(args);
        for (k, v) in envs {
            cmd.env(k, v);
        }

        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows: 24,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| crate::core::error::Error::Terminal(format!("openpty failed: {}", e)))?;

        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| crate::core::error::Error::Terminal(format!("spawn failed: {}", e)))?;
        drop(pair.slave);

        let writer = pair.master.take_writer().map_err(|e| {
            crate::core::error::Error::Terminal(format!("take writer failed: {}", e))
        })?;

        Ok(Pty {
            master: Arc::new(Mutex::new(pair.master)),
            writer: Arc::new(Mutex::new(writer)),
            child: Arc::new(Mutex::new(child)),
        })
    }

    pub fn reader(&self) -> Arc<Mutex<Box<dyn Read + Send>>> {
        let master = self.master.lock().unwrap();
        match master.try_clone_reader() {
            Ok(reader) => Arc::new(Mutex::new(reader)),
            Err(_) => {
                let pty_system = native_pty_system();
                let _ = pty_system.openpty(PtySize {
                    rows: 24,
                    cols: 80,
                    pixel_width: 0,
                    pixel_height: 0,
                });
                Arc::new(Mutex::new(Box::new(std::io::empty())))
            }
        }
    }

    pub fn writer_clone(&self) -> Arc<Mutex<Box<dyn Write + Send>>> {
        Arc::clone(&self.writer)
    }

    pub fn write(&self, data: &[u8]) -> Result<usize> {
        let mut writer = self.writer.lock().unwrap();
        writer
            .write(data)
            .map_err(|e| crate::core::error::Error::Terminal(format!("write failed: {}", e)))
    }

    pub fn resize(&self, rows: u16, cols: u16) -> Result<()> {
        let master = self.master.lock().unwrap();
        master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| crate::core::error::Error::Terminal(format!("resize failed: {}", e)))
    }

    pub fn kill(&self) -> Result<()> {
        let mut child = self.child.lock().unwrap();
        child
            .kill()
            .map_err(|e| crate::core::error::Error::Terminal(format!("kill failed: {}", e)))
    }

    pub fn try_wait(&self) -> Result<Option<i32>> {
        let mut child = self.child.lock().unwrap();
        match child.try_wait() {
            Ok(Some(status)) => Ok(Some(status.exit_code() as i32)),
            Ok(None) => Ok(None),
            Err(e) => Err(crate::core::error::Error::Terminal(format!(
                "wait failed: {}",
                e
            ))),
        }
    }

    pub fn process_id(&self) -> Option<u32> {
        let child = self.child.lock().unwrap();
        child.process_id()
    }
}

/// 判断一段终端输出是否处于 SSH/sftp 密码提示，locale 无关。
///
/// OpenSSH 会把密码提示本地化为客户端语言：中文系统下是
/// "user@host 的密码："（全角冒号结尾），英文系统下是 "user@host's password: "。
/// 各处自动喂密码逻辑（交互式连接 / 测试连接 / SFTP / 远程桌面）统一走这里，
/// 避免只匹配英文导致中文 locale 漏检、密码不喂、认证失败。
///
/// `trailing` 传未小写的滚动输出窗口即可；函数内部自行 lower。
pub fn is_password_prompt(trailing: &str) -> bool {
    let lower = trailing.to_lowercase();
    // 英文提示：password / passphrase（含 OpenSSH 兼容的 "password: " 尾空格变体）
    let english = lower.ends_with("password:")
        || lower.ends_with("password: ")
        || lower.ends_with("passphrase:")
        || lower.ends_with("passphrase for key:")
        || (lower.contains("password:") && trailing.trim_end().ends_with(':'));
    // 中文提示："user@host 的密码：" —— 要求全角冒号结尾，避免 motd/banner
    // 里恰好出现"密码"字样时误触发。
    let chinese = lower.contains("密码") && trailing.trim_end().ends_with('：');
    english || chinese
}

/// Returns true if `shell` is a runnable command for the current platform.
///
/// - If `shell` contains a path separator, we require the file to exist.
/// - Otherwise we defer to `default_shell()` resolution via PATH/PATHEXT
///   (handled by `crate::core::platform::find_executable`).
fn shell_exists(shell: &str) -> bool {
    let trimmed = shell.trim();
    if trimmed.is_empty() {
        return false;
    }
    if trimmed.contains(std::path::MAIN_SEPARATOR) || trimmed.contains('/') || trimmed.contains('\\') {
        return std::path::Path::new(trimmed).exists();
    }
    crate::core::platform::find_executable(trimmed).is_some()
}
