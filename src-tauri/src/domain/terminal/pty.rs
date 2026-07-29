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
