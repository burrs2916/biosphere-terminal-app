#![allow(dead_code)]

use crate::core::error::Result;
use crate::infra::logging::debug_log;
use crate::core::types::PtyConfig;
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
        let conn_type = config.connection_type.as_deref().unwrap_or("local");
        let shell = config
            .shell
            .clone()
            .filter(|s| !s.trim().is_empty() && shell_exists(s))
            .unwrap_or_else(crate::core::platform::default_shell);
        debug_log::term(
            "DEBUG",
            "pty",
            "spawn-begin",
            &format!(
                "conn_type={} shell={} rows={} cols={}",
                conn_type, shell, config.rows, config.cols
            ),
        );

        let pair = pty_system
            .openpty(PtySize {
                rows: config.rows,
                cols: config.cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| {
                let msg = format!("openpty failed: {}", e);
                debug_log::term("ERROR", "pty", "openpty-failed", &msg);
                crate::core::error::Error::Terminal(msg)
            })?;

        let cmd = Self::build_command(config)
            .map_err(|e| crate::core::error::Error::Terminal(e))?;

        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| {
                let msg = format!("spawn failed: {}", e);
                debug_log::term(
                    "ERROR",
                    "pty",
                    "spawn-command-failed",
                    &format!("shell={} err={}", shell, msg),
                );
                crate::core::error::Error::Terminal(msg)
            })?;
        debug_log::term("DEBUG", "pty", "spawn-ok", &format!("conn_type={}", conn_type));

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
        // SSH sessions no longer route through a `ssh.exe` child — the native
        // russh transport (app/terminal_native.rs) owns every SSH terminal.
        // What remains here is the local shell lane only.
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

        // Windows 本地终端底层是 ConPTY（`portable_pty` 在 Windows 恒用
        // `win::conpty::ConPtySystem`），ConPTY 原生 UTF-8/VT100，无需也不应
        // 切代码页。曾经注入的 `chcp 65001` 会去写控制台屏幕缓冲，与 ConPTY
        // 初始化握手竞态，导致 cmd/powershell 启动阶段概率性死锁（本地终端
        // 卡死）。现代 Win10/11 目标用户下删除该注入，中文输入/回显由 ConPTY
        // 的 UTF-8 默认保证，功能不受影响。
        //
        // 仅支持现代 Windows（Win10 1809+ / Win11），不考虑 legacy conhost 兜底。

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

    /// 阻塞等待子进程退出，返回退出码。
    pub fn wait(&self) -> Result<i32> {
        let mut child = self.child.lock().unwrap();
        child
            .wait()
            .map(|s| s.exit_code() as i32)
            .map_err(|e| crate::core::error::Error::Terminal(format!("wait failed: {}", e)))
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

    /// Write one logical line to the pty and commit it.
    ///
    /// The terminator is platform-correct on purpose. ConPTY does **not**
    /// translate a bare LF into Enter: conhost's Enter is CR, and a written
    /// `\n` arrives at the child as Ctrl+Enter (a VK_RETURN record carrying
    /// the CTRL modifier), which OpenSSH's `read_passphrase` and the sftp
    /// command reader do not treat as "the user pressed Enter". The line then
    /// sits in the input buffer unsubmitted and the child waits forever —
    /// which is the "command phase sat silent for the full idle limit"
    /// symptom. Windows therefore needs CR (CRLF is also accepted; the CR is
    /// what commits, the LF is ignored).
    pub fn write_line(&self, text: &str) -> Result<usize> {
        let line = if cfg!(target_os = "windows") {
            format!("{}\r", text)
        } else {
            format!("{}\n", text)
        };
        self.write(line.as_bytes())
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
