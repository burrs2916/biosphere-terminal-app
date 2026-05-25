use crate::core::error::Result;
use crate::core::types::PtyConfig;
use crate::domain::terminal::pty::Pty;
use crate::interface::events::terminal_events;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Mutex;
use tauri::AppHandle;

const OUTPUT_BUFFER_MAX_LINES: usize = 500;

struct SessionState {
    pty: Pty,
    output_buffer: Vec<String>,
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

    pub fn set_app_handle(&self, handle: AppHandle) {
        *self.app_handle.lock().unwrap() = Some(handle);
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

        self.sessions.lock().unwrap().insert(session_id.to_string(), SessionState {
            pty,
            output_buffer: Vec::with_capacity(OUTPUT_BUFFER_MAX_LINES),
        });

        let sid = session_id.to_string();
        let handle = self.app_handle.lock().unwrap().clone();

        let buffer: std::sync::Arc<Mutex<Vec<String>>> = std::sync::Arc::new(Mutex::new(Vec::with_capacity(OUTPUT_BUFFER_MAX_LINES)));
        let buffer_clone = buffer.clone();

        std::thread::spawn(move || {
            let mut buf = [0u8; 4096];
            let mut trailing = String::with_capacity(256);
            let mut password_filled = false;

            loop {
                let mut reader_guard = match reader.lock() {
                    Ok(g) => g,
                    Err(_) => break,
                };
                match reader_guard.read(&mut buf) {
                    Ok(0) => {
                        drop(reader_guard);
                        if let Some(ref h) = handle {
                            terminal_events::emit_terminal_closed(h, &sid, Some(0));
                        }
                        break;
                    }
                    Ok(n) => {
                        let data = &buf[..n];
                        let output = String::from_utf8_lossy(data).to_string();
                        drop(reader_guard);

                        {
                            let mut buf = buffer_clone.lock().unwrap();
                            for line in output.lines() {
                                buf.push(line.to_string());
                                if buf.len() > OUTPUT_BUFFER_MAX_LINES {
                                    buf.remove(0);
                                }
                            }
                        }

                        if let Some(ref h) = handle {
                            terminal_events::emit_terminal_output(h, &sid, &output);
                        }

                        if !password_filled {
                            if let Some(ref pwd) = password {
                                trailing.push_str(&output);
                                if trailing.len() > 256 {
                                    trailing = trailing[trailing.len() - 256..].to_string();
                                }
                                let lower = trailing.to_lowercase();
                                let needs_password = lower.ends_with("password:")
                                    || lower.ends_with("password: ")
                                    || lower.contains("password:")
                                        && trailing.trim_end().ends_with(':');

                                if needs_password {
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
                        break;
                    }
                }
            }
        });

        Ok(())
    }

    pub fn write(&self, session_id: &str, data: &[u8]) -> Result<usize> {
        let sessions = self.sessions.lock().unwrap();
        let state = sessions
            .get(session_id)
            .ok_or_else(|| crate::core::error::Error::Terminal("session not found".into()))?;
        state.pty.write(data)
    }

    pub fn kill(&self, session_id: &str) -> Result<()> {
        let mut sessions = self.sessions.lock().unwrap();
        if let Some(state) = sessions.get(session_id) {
            state.pty.kill()?;
        }
        sessions.remove(session_id);
        Ok(())
    }

    pub fn resize(&self, session_id: &str, rows: u16, cols: u16) -> Result<()> {
        let sessions = self.sessions.lock().unwrap();
        let state = sessions
            .get(session_id)
            .ok_or_else(|| crate::core::error::Error::Terminal("session not found".into()))?;
        state.pty.resize(rows, cols)
    }

    pub fn list_sessions(&self) -> Vec<String> {
        let sessions = self.sessions.lock().unwrap();
        sessions.keys().cloned().collect()
    }

    pub fn get_output_buffer(&self, session_id: &str, max_lines: usize) -> Result<String> {
        let sessions = self.sessions.lock().unwrap();
        let state = sessions
            .get(session_id)
            .ok_or_else(|| crate::core::error::Error::Terminal("session not found".into()))?;

        let buffer = &state.output_buffer;
        let start = if buffer.len() > max_lines {
            buffer.len() - max_lines
        } else {
            0
        };
        Ok(buffer[start..].join("\n"))
    }

    pub fn get_cwd(&self, session_id: &str) -> Result<Option<String>> {
        let sessions = self.sessions.lock().unwrap();
        let state = sessions
            .get(session_id)
            .ok_or_else(|| crate::core::error::Error::Terminal("session not found".into()))?;

        if let Some(pid) = state.pty.process_id() {
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
