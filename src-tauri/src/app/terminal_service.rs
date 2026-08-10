use crate::core::error::{Error, Result};
use crate::core::types::PtyConfig;
use crate::domain::terminal::pty::Pty;
use crate::interface::events::terminal_events;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Mutex;
use tauri::AppHandle;

const OUTPUT_BUFFER_MAX_LINES: usize = 500;

struct SessionState {
    pty: std::sync::Arc<Mutex<Pty>>,
    output_buffer: std::sync::Arc<Mutex<Vec<String>>>,
}

pub struct TerminalService {
    sessions: Mutex<HashMap<String, SessionState>>,
    app_handle: Mutex<Option<AppHandle>>,
}

impl TerminalService {
    pub fn new() -> Self {
        TerminalService {
            sessions: Mutex::new(HashMap::new()),
            app_handle: Mutex::new(None),
        }
    }

    pub fn set_app_handle(&self, handle: AppHandle) -> Result<()> {
        *self.app_handle.lock().map_err(|e| Error::Terminal(format!("App handle lock error: {}", e)))? = Some(handle);
        Ok(())
    }

    pub fn spawn(&self, session_id: &str, config: &PtyConfig) -> Result<()> {
        let pty = Pty::spawn(config)?;
        let reader = pty.reader();
        let writer = pty.writer_clone();

        let password: Option<String> = config
            .ssh
            .as_ref()
            .and_then(|s| s.password.clone())
            .filter(|p| !p.is_empty());

        tracing::info!(
            "[terminal] spawn session={}, conn_type={}, auth_method={}, has_password={}",
            session_id,
            config.connection_type.as_deref().unwrap_or("local"),
            config.ssh.as_ref().map(|s| s.auth_method.as_str()).unwrap_or("n/a"),
            password.is_some()
        );

        let buffer = std::sync::Arc::new(Mutex::new(Vec::with_capacity(OUTPUT_BUFFER_MAX_LINES)));
        // pty 用 Arc<Mutex> 共享：reader 线程检测到 host key 变更（远程重装系统）
        // 需要自动清理旧 key 并重建 pty，write/kill/resize 必须跟着走新 pty。
        let pty_arc = std::sync::Arc::new(Mutex::new(pty));

        self.sessions.lock().map_err(|e| Error::Terminal(format!("Session lock error: {}", e)))?.insert(session_id.to_string(), SessionState {
            pty: pty_arc.clone(),
            output_buffer: buffer.clone(),
        });
        let buffer_clone = buffer.clone();

        let sid = session_id.to_string();
        let handle = self.app_handle.lock().map_err(|e| Error::Terminal(format!("App handle lock error: {}", e)))?.clone();
        let config_owned = config.clone();
        let pty_arc_thread = pty_arc.clone();

        std::thread::spawn(move || {
            let mut buf = [0u8; 4096];
            // 重连时换新 pty 的 reader/writer，故为可变绑定
            let mut reader = reader;
            let mut writer = writer;
            let mut trailing = String::with_capacity(256);
            let mut password_filled = false;
            // host key 变更检测用独立缓冲：报错文本可能跨 chunk
            let mut hostkey_buf = String::with_capacity(1024);
            let mut hostkey_retried = false;

            // 外层循环：host key 变更时自动清理旧 key 并重连（最多一次）
            loop {
                loop {
                    let mut reader_guard = match reader.lock() {
                        Ok(g) => g,
                        Err(_) => return,
                    };
                    match reader_guard.read(&mut buf) {
                        Ok(0) => {
                            drop(reader_guard);
                            if let Some(ref h) = handle {
                                terminal_events::emit_terminal_closed(h, &sid, Some(0));
                            }
                            return;
                        }
                        Ok(n) => {
                            let data = &buf[..n];
                            let output = String::from_utf8_lossy(data).to_string();
                            drop(reader_guard);

                            {
                                if let Ok(mut buf) = buffer_clone.lock() {
                                    for line in output.lines() {
                                        buf.push(line.to_string());
                                        if buf.len() > OUTPUT_BUFFER_MAX_LINES {
                                            buf.remove(0);
                                        }
                                    }
                                }
                            }

                            if let Some(ref h) = handle {
                                terminal_events::emit_terminal_output(h, &sid, &output);
                            }

                            // ---- host key 变更检测（优先于密码检测）----
                            // 远程重装系统后 host key 变化，accept-new 对"已存在但 key 变了"
                            // 的主机直接拒绝并退出（Host key verification failed），此时不会弹
                            // 密码提示。自动清旧 key 并重连一次，而不是让用户手动 ssh-keygen -R。
                            if !hostkey_retried {
                                hostkey_buf.push_str(&output);
                                if hostkey_buf.len() > 4096 {
                                    hostkey_buf = hostkey_buf[hostkey_buf.len() - 4096..].to_string();
                                }
                                let hk_lower = hostkey_buf.to_lowercase();
                                if hk_lower.contains("host key verification failed")
                                    || hk_lower.contains("remote host identification has changed")
                                {
                                    hostkey_retried = true;
                                    if let Some(ref h) = handle {
                                        terminal_events::emit_terminal_output(
                                            h,
                                            &sid,
                                            "\r\n[系统] 检测到远程主机密钥已变更（可能系统已重置），正在自动清除旧密钥并重新连接…\r\n",
                                        );
                                    }
                                    if let Some(ref ssh) = config_owned.ssh {
                                        let _ = crate::core::platform::clear_known_host(&ssh.host, ssh.port);
                                    }
                                    match Pty::spawn(&config_owned) {
                                        Ok(new_pty) => {
                                            {
                                                let mut guard = match pty_arc_thread.lock() {
                                                    Ok(g) => g,
                                                    Err(_) => return,
                                                };
                                                *guard = new_pty;
                                            }
                                            {
                                                let guard = match pty_arc_thread.lock() {
                                                    Ok(g) => g,
                                                    Err(_) => return,
                                                };
                                                reader = guard.reader();
                                                writer = guard.writer_clone();
                                            }
                                        }
                                        Err(e) => {
                                            if let Some(ref h) = handle {
                                                terminal_events::emit_terminal_error(h, &sid, &format!("重新连接失败: {}", e));
                                            }
                                            return;
                                        }
                                    }
                                    // 重连后清状态，重新等密码提示
                                    trailing.clear();
                                    hostkey_buf.clear();
                                    password_filled = false;
                                    break; // 跳出内层循环，继续外层读新 pty
                                }
                            }

                            if !password_filled {
                                if let Some(ref pwd) = password {
                                    trailing.push_str(&output);
                                    if trailing.len() > 256 {
                                        trailing = trailing[trailing.len() - 256..].to_string();
                                    }
                                    if crate::domain::terminal::pty::is_password_prompt(&trailing) {
                                        tracing::info!("[terminal] Detected password prompt for session {}, auto-filling...", sid);
                                        let pw_bytes = format!("{}\n", pwd);
                                        if let Ok(mut w) = writer.lock() {
                                            let _ = w.write_all(pw_bytes.as_bytes());
                                            let _ = w.flush();
                                        }
                                        password_filled = true;
                                        trailing.clear();
                                    }
                                }
                            }
                        }
                        Err(e) => {
                            drop(reader_guard);
                            if let Some(ref h) = handle {
                                terminal_events::emit_terminal_error(h, &sid, &e.to_string());
                            }
                            return;
                        }
                    }
                }
            }
        });

        Ok(())
    }

    pub fn write(&self, session_id: &str, data: &[u8]) -> Result<usize> {
        let sessions = self.sessions.lock().map_err(|e| Error::Terminal(format!("Session lock error: {}", e)))?;
        let state = sessions
            .get(session_id)
            .ok_or_else(|| crate::core::error::Error::Terminal("session not found".into()))?;
        let pty = state.pty.lock().map_err(|e| Error::Terminal(format!("pty lock error: {}", e)))?;
        pty.write(data)
    }

    pub fn kill(&self, session_id: &str) -> Result<()> {
        let mut sessions = self.sessions.lock().map_err(|e| Error::Terminal(format!("Session lock error: {}", e)))?;
        if let Some(state) = sessions.get(session_id) {
            let pty = state.pty.lock().map_err(|e| Error::Terminal(format!("pty lock error: {}", e)))?;
            pty.kill()?;
        }
        sessions.remove(session_id);
        Ok(())
    }

    pub fn resize(&self, session_id: &str, rows: u16, cols: u16) -> Result<()> {
        let sessions = self.sessions.lock().map_err(|e| Error::Terminal(format!("Session lock error: {}", e)))?;
        let state = sessions
            .get(session_id)
            .ok_or_else(|| crate::core::error::Error::Terminal("session not found".into()))?;
        let pty = state.pty.lock().map_err(|e| Error::Terminal(format!("pty lock error: {}", e)))?;
        pty.resize(rows, cols)
    }

    pub fn list_sessions(&self) -> Result<Vec<String>> {
        let sessions = self.sessions.lock().map_err(|e| Error::Terminal(format!("Session lock error: {}", e)))?;
        Ok(sessions.keys().cloned().collect())
    }

    pub fn get_output_buffer(&self, session_id: &str, max_lines: usize) -> Result<String> {
        let sessions = self.sessions.lock().map_err(|e| Error::Terminal(format!("Session lock error: {}", e)))?;
        let state = sessions
            .get(session_id)
            .ok_or_else(|| crate::core::error::Error::Terminal("session not found".into()))?;

        let buffer = state.output_buffer.lock().map_err(|e| Error::Terminal(format!("Buffer lock error: {}", e)))?;
        let start = if buffer.len() > max_lines {
            buffer.len() - max_lines
        } else {
            0
        };
        Ok(buffer[start..].join("\n"))
    }

    pub fn get_cwd(&self, session_id: &str) -> Result<Option<String>> {
        let sessions = self.sessions.lock().map_err(|e| Error::Terminal(format!("Session lock error: {}", e)))?;
        let state = sessions
            .get(session_id)
            .ok_or_else(|| crate::core::error::Error::Terminal("session not found".into()))?;

        if let Some(pid) = state.pty.lock().ok().and_then(|p| p.process_id()) {
            let cwd_path = std::path::PathBuf::from(format!("/proc/{}/cwd", pid));
            if cwd_path.exists() {
                return Ok(std::fs::read_link(cwd_path)
                    .ok()
                    .map(|p| p.to_string_lossy().to_string()));
            }
            let lsof = std::process::Command::new("lsof")
                .args(["-Ffn", "-p", &pid.to_string()])
                .output();
            if let Ok(output) = lsof {
                let stdout = String::from_utf8_lossy(&output.stdout);
                let mut found_cwd: Option<String> = None;
                let mut current_fd: Option<String> = None;
                for line in stdout.lines() {
                    let line = line.trim();
                    if line.starts_with('f') {
                        current_fd = Some(line[1..].to_string());
                    } else if line.starts_with('n') && current_fd.as_deref() == Some("cwd") {
                        found_cwd = Some(line[1..].to_string());
                        break;
                    }
                }
                if let Some(cwd) = found_cwd {
                    return Ok(Some(cwd));
                }
            }
        }
        Ok(None)
    }
}
