use crate::core::error::{Error, Result};
use crate::infra::logging::debug_log;
use crate::core::types::PtyConfig;
use crate::domain::terminal::pty::Pty;
use crate::interface::events::terminal_events;
use std::collections::{HashMap, VecDeque};
use std::io::{Read, Write};
use std::sync::mpsc::{Receiver, RecvTimeoutError};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::AppHandle;

const OUTPUT_BUFFER_MAX_LINES: usize = 500;

/// Maximum time output is held back before it is flushed to the frontend.
///
/// Terminal output arrives in small PTY reads. Emitting one Tauri event per
/// read means one IPC round-trip per 4 KB — a build log or `cat` of a large
/// file produces thousands of events per second, and each one costs a
/// serialize → IPC → React render round trip. That is the dominant cause of
/// "the terminal feels laggy while output is streaming".
///
/// Coalescing on a short time window keeps the visual latency imperceptible
/// (one frame at 60 Hz is 16 ms) while cutting the event count by an order of
/// magnitude on a busy stream.
const OUTPUT_FLUSH_INTERVAL: Duration = Duration::from_millis(16);

/// Maximum number of bytes buffered before an early flush.
///
/// Bounds memory for a pathological stream that never pauses; the flush is
/// triggered by size rather than by the timer so a fast producer cannot build
/// an unbounded backlog.
const OUTPUT_FLUSH_MAX_BYTES: usize = 64 * 1024;

/// Capacity of the reader → emitter queue, in chunks.
///
/// The queue is deliberately bounded: an unbounded queue turns a slow frontend
/// into unbounded memory growth (the classic "the app dies while `cat`ing a
/// huge file" symptom on Windows). When the queue is full the reader thread
/// blocks, which pushes the back-pressure all the way down to the PTY and
/// eventually to the remote process — exactly how a real terminal behaves.
const OUTPUT_QUEUE_CAPACITY: usize = 512;

/// Size of the rolling window used to detect a host key change across chunk
/// boundaries.
const HOSTKEY_WINDOW_BYTES: usize = 4096;

/// A terminal event travelling from the PTY reader thread to the emitter
/// thread.
///
/// All three variants share one queue on purpose: the frontend must observe
/// output, then `terminal-closed` / `terminal-error`, in exactly that order.
/// Separate channels would let a fast "closed" overtake buffered output and
/// the last lines of a command would vanish behind the "process exited"
/// banner.
enum TerminalEvent {
    Output(String),
    Closed(Option<i32>),
    Error(String),
}

struct SessionState {
    pty: std::sync::Arc<Mutex<Pty>>,
    output_buffer: std::sync::Arc<Mutex<VecDeque<String>>>,
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

        let buffer = std::sync::Arc::new(Mutex::new(VecDeque::with_capacity(OUTPUT_BUFFER_MAX_LINES)));
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

        // Reader → emitter queue. Bounded on purpose: see OUTPUT_QUEUE_CAPACITY.
        let (tx, rx) = std::sync::mpsc::sync_channel::<TerminalEvent>(OUTPUT_QUEUE_CAPACITY);

        // The emitter owns the IPC side. It runs on its own thread so that the
        // reader thread is never blocked by a slow frontend, and so that the
        // time-based coalescing window can actually fire while the PTY is
        // silent (the reader thread spends most of its time blocked in
        // `read()`, so a timer living there would never tick).
        {
            let emitter_handle = handle.clone();
            let emitter_sid = sid.clone();
            std::thread::spawn(move || {
                run_output_emitter(emitter_handle, &emitter_sid, rx);
            });
        }

        std::thread::spawn(move || {
            debug_log::term(
                "DEBUG",
                "reader",
                "started",
                &format!(
                    "session={} conn_type={}",
                    sid,
                    config_owned
                        .connection_type
                        .as_deref()
                        .unwrap_or("local")
                ),
            );
            // 16 KB read buffer: fewer read() syscalls on a busy PTY. ConPTY
            // reads are comparatively expensive on Windows, so the larger
            // buffer pays off exactly when output volume is high.
            let mut buf = [0u8; 16 * 1024];
            // 重连时换新 pty 的 reader/writer，故为可变绑定
            let mut reader = reader;
            let mut writer = writer;
            let mut trailing = String::with_capacity(256);
            let mut password_filled = false;
            // host key 变更检测用独立缓冲：报错文本可能跨 chunk
            let mut hostkey_buf = String::with_capacity(1024);
            // 扫描结束标记：host key 校验只发生在握手阶段，检测到变化 / 出现密码提示 /
            // 输出量超预算后都不需要再扫，避免长会话里每个 chunk 都做一次匹配。
            let mut hostkey_scan_done = false;
            // 跨 read 的残缺 UTF-8 序列（见 decode_chunk）。
            let mut utf8_carry: Vec<u8> = Vec::with_capacity(4);

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
                            debug_log::term(
                                "INFO",
                                "reader",
                                "eof",
                                &format!("session={}", sid),
                            );
                            // 流在多字节字符中间断掉：补一个替换字符，别把字节丢掉。
                            let tail = flush_carry(&mut utf8_carry);
                            if !tail.is_empty() {
                                let _ = tx.send(TerminalEvent::Output(tail));
                            }
                            // EOF 走同一条队列，保证前端先收到剩余输出、再收到
                            // "进程已退出"提示，不会把最后几行盖在提示后面。
                            let _ = tx.send(TerminalEvent::Closed(Some(0)));
                            return;
                        }
                        Ok(n) => {
                            let output = decode_chunk(&mut utf8_carry, &buf[..n]);
                            drop(reader_guard);
                            // 本次 read 只拿到一个残缺的多字节字符头，等下次再解。
                            if output.is_empty() {
                                continue;
                            }

                            {
                                if let Ok(mut buf) = buffer_clone.lock() {
                                    for line in output.lines() {
                                        buf.push_back(line.to_string());
                                        if buf.len() > OUTPUT_BUFFER_MAX_LINES {
                                            buf.pop_front();
                                        }
                                    }
                                }
                            }

                            // ---- host key 变更检测（优先于密码检测）----
                            // 远程重装系统后 host key 变化，accept-new 对"已存在但 key 变了"
                            // 的主机直接拒绝并退出（Host key verification failed），此时不会弹
                            // 密码提示。自动清旧 key 并重连一次，而不是让用户手动 ssh-keygen -R。
                            //
                            // 该检测只在握手阶段有意义：host key 校验发生在认证之前，一旦出现
                            // 密码提示就说明握手已通过；输出量超过预算同样说明早已连上。
                            // 因此扫描会适时停止，避免在长会话里对每个 chunk 都做匹配。
                            let mut hostkey_changed = false;
                            if !hostkey_scan_done {
                                hostkey_buf.push_str(&output);
                                if hostkey_buf.len() > HOSTKEY_WINDOW_BYTES {
                                    let keep = hostkey_buf.len() - HOSTKEY_WINDOW_BYTES;
                                    hostkey_buf.drain(..keep);
                                }
                                if contains_ignore_ascii_case(
                                    &hostkey_buf,
                                    "host key verification failed",
                                ) || contains_ignore_ascii_case(
                                    &hostkey_buf,
                                    "remote host identification has changed",
                                ) {
                                    hostkey_scan_done = true;
                                    hostkey_changed = true;
                                    debug_log::term(
                                        "WARN",
                                        "reader",
                                        "host-key-changed",
                                        &format!(
                                            "session={} action=clear-known-host-and-reconnect",
                                            sid
                                        ),
                                    );
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
                                        // 出现密码提示说明 host key 校验已通过，无需再扫。
                                        hostkey_scan_done = true;
                                    }
                                }
                            }

                            // 输出统一入队，由 emitter 线程按时间/大小窗口合并成
                            // 少量 IPC 事件。
                            if tx.send(TerminalEvent::Output(output)).is_err() {
                                // emitter 已退出（会话被关闭），reader 收工。
                                return;
                            }

                            if hostkey_changed {
                                // 系统提示也走同一条队列，保证与前序输出的顺序一致。
                                let _ = tx.send(TerminalEvent::Output(
                                    "\r\n[系统] 检测到远程主机密钥已变更（可能系统已重置），正在自动清除旧密钥并重新连接…\r\n"
                                        .to_string(),
                                ));
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
                                        let _ = tx.send(TerminalEvent::Error(format!("重新连接失败: {}", e)));
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
                        Err(e) => {
                            drop(reader_guard);
                            debug_log::term(
                                "ERROR",
                                "reader",
                                "read-error",
                                &format!("session={} err={}", sid, e),
                            );
                            let _ = tx.send(TerminalEvent::Error(e.to_string()));
                            return;
                        }
                    }
                }
            }
        });

        Ok(())
    }

    pub fn write(&self, session_id: &str, data: &[u8]) -> Result<usize> {        let sessions = self.sessions.lock().map_err(|e| Error::Terminal(format!("Session lock error: {}", e)))?;
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
        // VecDeque has no O(1) random access, so slice the tail by skipping
        // the leading entries instead of indexing into the deque.
        let start = if buffer.len() > max_lines {
            buffer.len() - max_lines
        } else {
            0
        };
        let tail: Vec<&str> = buffer.iter().skip(start).map(|s| s.as_str()).collect();
        Ok(tail.join("\n"))
    }

    pub fn get_cwd(&self, session_id: &str) -> Result<Option<String>> {
        let sessions = self.sessions.lock().map_err(|e| Error::Terminal(format!("Session lock error: {}", e)))?;
        // cwd is only consumed by the cosmetic status-bar path and command-history
        // tagging. A missing session is NOT an error worth surfacing: it races with
        // spawn on first connect / tab switch / Enter / paste and would otherwise
        // pop a spurious "Terminal error: session not found" even though the
        // terminal works fine. Return None instead of erroring.
        let state = match sessions.get(session_id) {
            Some(s) => s,
            None => return Ok(None),
        };

        if let Some(pid) = state.pty.lock().ok().and_then(|p| p.process_id()) {
            return Ok(Self::resolve_process_cwd(pid));
        }
        Ok(None)
    }

    /// Resolve the PTY child process's current working directory by PID.
    ///
    /// Implementations are platform-specific (see the two `cfg` variants
    /// below); the public `get_cwd` just dispatches here. Every failure path
    /// returns `None` so a missing cwd never surfaces as an error — it is only
    /// used for the cosmetic status-bar path display.
    #[cfg(target_os = "windows")]
    fn resolve_process_cwd(pid: u32) -> Option<String> {
        use std::os::raw::c_void;

        // Minimal PEB / RTL_USER_PROCESS_PARAMETERS layouts for x64. The app
        // ships 64-bit Windows binaries; these offsets are stable across
        // Win8.1/Win10/Win11. (ProcessParameters is at PEB+0x20, CurrentDirectory
        // is at RTL_USER_PROCESS_PARAMETERS+0x38.)
        #[repr(C)]
        struct Curdir {
            handle: *mut c_void,
            dos_path: *mut u16,
            length: u32,
        }
        #[repr(C)]
        struct ProcessBasicInformation {
            exit_status: i32,
            peb_base: *mut c_void,
            affinity: usize,
            base_priority: i32,
            unique_pid: usize,
            inherited_pid: usize,
        }

        #[link(name = "kernel32")]
        extern "system" {
            fn OpenProcess(dwDesiredAccess: u32, bInheritHandle: i32, dwProcessId: u32) -> *mut c_void;
            fn CloseHandle(h: *mut c_void) -> i32;
            fn ReadProcessMemory(
                hProcess: *mut c_void,
                lpBaseAddress: *const c_void,
                lpBuffer: *mut c_void,
                nSize: usize,
                lpNumberOfBytesRead: *mut usize,
            ) -> i32;
            fn GetFinalPathNameByHandleW(hFile: *mut c_void, lpszFilePath: *mut u16, cchFilePath: u32, dwFlags: u32) -> u32;
        }
        #[link(name = "ntdll")]
        extern "system" {
            fn NtQueryInformationProcess(
                hProcess: *mut c_void,
                infoClass: u32,
                pInfo: *mut c_void,
                infoLen: u32,
                pReturnLen: *mut u32,
            ) -> i32;
        }

        const PROCESS_QUERY_INFORMATION: u32 = 0x0400;
        const PROCESS_VM_READ: u32 = 0x0010;
        const PROCESS_BASIC_INFORMATION_CLASS: u32 = 0;
        const FILE_NAME_NORMALIZED: u32 = 0;

        unsafe {
            let handle = OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, 0, pid);
            if handle.is_null() {
                return None;
            }
            let mut pbi = ProcessBasicInformation {
                exit_status: 0,
                peb_base: std::ptr::null_mut(),
                affinity: 0,
                base_priority: 0,
                unique_pid: 0,
                inherited_pid: 0,
            };
            let mut ret: u32 = 0;
            if NtQueryInformationProcess(
                handle,
                PROCESS_BASIC_INFORMATION_CLASS,
                &mut pbi as *mut _ as *mut c_void,
                std::mem::size_of::<ProcessBasicInformation>() as u32,
                &mut ret,
            ) != 0
            {
                CloseHandle(handle);
                return None;
            }
            let peb = pbi.peb_base;
            if peb.is_null() {
                CloseHandle(handle);
                return None;
            }
            // Read ProcessParameters pointer (PEB + 0x20).
            let mut params: *mut c_void = std::ptr::null_mut();
            let mut bytes = 0usize;
            if ReadProcessMemory(
                handle,
                (peb as usize + 0x20) as *const c_void,
                &mut params as *mut _ as *mut c_void,
                std::mem::size_of::<*mut c_void>(),
                &mut bytes,
            ) == 0
                || params.is_null()
            {
                CloseHandle(handle);
                return None;
            }
            // Read CURDIR (RTL_USER_PROCESS_PARAMETERS + 0x38).
            let mut curdir = Curdir {
                handle: std::ptr::null_mut(),
                dos_path: std::ptr::null_mut(),
                length: 0,
            };
            if ReadProcessMemory(
                handle,
                (params as usize + 0x38) as *const c_void,
                &mut curdir as *mut _ as *mut c_void,
                std::mem::size_of::<Curdir>(),
                &mut bytes,
            ) == 0
                || curdir.handle.is_null()
            {
                CloseHandle(handle);
                return None;
            }
            let mut buf = [0u16; 1024];
            let len = GetFinalPathNameByHandleW(curdir.handle, buf.as_mut_ptr(), buf.len() as u32, FILE_NAME_NORMALIZED);
            CloseHandle(handle);
            if len == 0 || (len as usize) >= buf.len() {
                return None;
            }
            let path = String::from_utf16_lossy(&buf[..len as usize]);
            // GetFinalPathNameByHandleW returns a \\?\ verbatim-path prefix; strip it.
            let stripped = path.strip_prefix("\\\\?\\").unwrap_or(&path);
            if stripped.is_empty() {
                None
            } else {
                Some(stripped.to_string())
            }
        }
    }

    #[cfg(not(target_os = "windows"))]
    fn resolve_process_cwd(pid: u32) -> Option<String> {
        let cwd_path = std::path::PathBuf::from(format!("/proc/{}/cwd", pid));
        if cwd_path.exists() {
            return std::fs::read_link(cwd_path)
                .ok()
                .map(|p| p.to_string_lossy().to_string());
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
                return Some(cwd);
            }
        }
        None
    }
}

/// What the emitter thread must do after folding one event into the
/// coalescing buffer.
#[derive(Debug, PartialEq, Eq)]
enum EmitterAction {
    /// Nothing to emit yet — keep buffering.
    Idle,
    /// Emit this payload as one `terminal-output` event.
    Emit(String),
    /// Emit the payload, then `terminal-closed`.
    EmitThenClosed(String, Option<i32>),
    /// Emit the payload, then `terminal-error`.
    EmitThenError(String, String),
}

/// Pure state machine that folds terminal events into coalesced output.
///
/// Split out of the emitter thread so it can be unit-tested without an
/// `AppHandle`. The rules it encodes:
///
///  * output is merged into one payload per coalescing window;
///  * a terminal-ending event always flushes the pending output FIRST, so the
///    last lines of a command are never painted after the "process exited"
///    banner;
///  * when the producer goes quiet the buffer is flushed on the next tick, so
///    a prompt shows up immediately instead of lingering.
struct OutputCoalescer {
    pending: String,
    last_flush: Instant,
}

impl OutputCoalescer {
    fn new() -> Self {
        Self {
            pending: String::with_capacity(8192),
            last_flush: Instant::now(),
        }
    }

    /// Fold one event into the buffer and report what to emit.
    fn push(&mut self, event: TerminalEvent) -> EmitterAction {
        match event {
            TerminalEvent::Output(chunk) => {
                self.pending.push_str(&chunk);
                // Early flush when the buffer grows large, so a runaway
                // producer cannot build an unbounded backlog.
                if self.pending.len() >= OUTPUT_FLUSH_MAX_BYTES {
                    EmitterAction::Emit(self.take())
                } else {
                    EmitterAction::Idle
                }
            }
            TerminalEvent::Closed(code) => {
                let payload = self.take();
                if payload.is_empty() {
                    EmitterAction::EmitThenClosed(String::new(), code)
                } else {
                    EmitterAction::EmitThenClosed(payload, code)
                }
            }
            TerminalEvent::Error(err) => {
                let payload = self.take();
                EmitterAction::EmitThenError(payload, err)
            }
        }
    }

    /// Flush whatever is pending; `None` when there is nothing to send.
    fn flush(&mut self) -> Option<String> {
        self.last_flush = Instant::now();
        if self.pending.is_empty() {
            None
        } else {
            Some(self.take())
        }
    }

    /// Take the pending payload, keeping the allocation for the next round.
    fn take(&mut self) -> String {
        std::mem::replace(&mut self.pending, String::with_capacity(8192))
    }
}

/// Coalesce terminal events and emit them to the frontend.
///
/// Runs on its own thread so that:
///  1. the PTY reader thread never blocks on the IPC round-trip;
///  2. the time-based flush window can actually fire while the PTY is silent
///     (the reader spends most of its time blocked in `read()`, so a timer
///     living there would never tick and the last output would sit in the
///     buffer forever — the "terminal looks frozen" symptom);
///  3. output / closed / error keep their relative order, because they all
///     travel through one FIFO queue.
fn run_output_emitter(
    handle: Option<AppHandle>,
    session_id: &str,
    rx: Receiver<TerminalEvent>,
) {
    let mut coalescer = OutputCoalescer::new();
    loop {
        match rx.recv_timeout(OUTPUT_FLUSH_INTERVAL) {
            Ok(event) => {
                match coalescer.push(event) {
                    EmitterAction::Idle => {}
                    EmitterAction::Emit(payload) => {
                        if let Some(ref h) = handle {
                            terminal_events::emit_terminal_output(h, session_id, &payload);
                        }
                    }
                    EmitterAction::EmitThenClosed(payload, code) => {
                        if let Some(ref h) = handle {
                            if !payload.is_empty() {
                                terminal_events::emit_terminal_output(h, session_id, &payload);
                            }
                            terminal_events::emit_terminal_closed(h, session_id, code);
                        }
                        return;
                    }
                    EmitterAction::EmitThenError(payload, err) => {
                        if let Some(ref h) = handle {
                            if !payload.is_empty() {
                                terminal_events::emit_terminal_output(h, session_id, &payload);
                            }
                            terminal_events::emit_terminal_error(h, session_id, &err);
                        }
                        return;
                    }
                }
            }
            Err(RecvTimeoutError::Timeout) => {
                // The PTY went quiet: flush whatever is pending so the user
                // sees the prompt immediately instead of up to 16 ms later.
                if let Some(payload) = coalescer.flush() {
                    if let Some(ref h) = handle {
                        terminal_events::emit_terminal_output(h, session_id, &payload);
                    }
                }
            }
            Err(RecvTimeoutError::Disconnected) => {
                // The reader thread is gone: flush the remainder and stop.
                if let Some(payload) = coalescer.flush() {
                    if let Some(ref h) = handle {
                        terminal_events::emit_terminal_output(h, session_id, &payload);
                    }
                }
                return;
            }
        }
    }
}

/// Decode a PTY byte chunk into text, carrying over an incomplete trailing
/// UTF-8 sequence into the next chunk.
///
/// A multi-byte character (e.g. Chinese) can be split across two `read()`
/// boundaries. Decoding each chunk independently turns the split character
/// into U+FFFD, which the user sees as a garbled character in the terminal.
/// `carry` holds the incomplete tail (at most 3 bytes) until it can be
/// completed.
fn decode_chunk(carry: &mut Vec<u8>, data: &[u8]) -> String {
    // Fast path: nothing carried over and the chunk is already valid UTF-8.
    if carry.is_empty() {
        if let Ok(s) = std::str::from_utf8(data) {
            return s.to_string();
        }
    }

    let mut buf = Vec::with_capacity(carry.len() + data.len());
    buf.extend_from_slice(carry);
    buf.extend_from_slice(data);
    carry.clear();

    // Decode as far as possible, stopping at the first *incomplete* sequence.
    let mut out = String::with_capacity(buf.len());
    let mut rest: &[u8] = &buf;
    loop {
        match std::str::from_utf8(rest) {
            Ok(s) => {
                out.push_str(s);
                break;
            }
            Err(e) => {
                let valid_up_to = e.valid_up_to();
                // `from_utf8` guarantees the prefix up to `valid_up_to` is
                // valid UTF-8, so this cannot fail.
                if let Ok(s) = std::str::from_utf8(&rest[..valid_up_to]) {
                    out.push_str(s);
                }
                match e.error_len() {
                    // Truncated sequence at the end of the buffer: carry it
                    // over to the next chunk instead of emitting U+FFFD.
                    None => {
                        carry.extend_from_slice(&rest[valid_up_to..]);
                        break;
                    }
                    // Definitely invalid bytes: emit one replacement char and
                    // resume after them.
                    Some(len) => {
                        out.push('\u{FFFD}');
                        rest = &rest[valid_up_to + len..];
                    }
                }
            }
        }
    }
    out
}

/// Decode a leftover incomplete sequence at end-of-stream.
///
/// The PTY closed in the middle of a multi-byte character. The bytes can
/// never be completed, so emit a replacement char instead of dropping them.
fn flush_carry(carry: &mut Vec<u8>) -> String {
    if carry.is_empty() {
        return String::new();
    }
    let out = String::from_utf8_lossy(carry).into_owned();
    carry.clear();
    out
}

/// Case-insensitive substring search that does not allocate.
///
/// The obvious `haystack.to_lowercase().contains(needle)` allocates a fresh
/// copy of the whole haystack on every call. The host-key check runs on every
/// PTY chunk, so on a busy stream that is one 4 KB allocation per chunk for
/// nothing. ASCII case folding is enough here: the needles are pure ASCII
/// ("host key verification failed" / "remote host identification has changed")
/// and the only case variants that matter are ASCII letters.
fn contains_ignore_ascii_case(haystack: &str, needle: &str) -> bool {
    if needle.is_empty() {
        return true;
    }
    let hay = haystack.as_bytes();
    let ned = needle.as_bytes();
    if ned.len() > hay.len() {
        return false;
    }
    hay.windows(ned.len()).any(|window| {
        window
            .iter()
            .zip(ned.iter())
            .all(|(h, n)| h.eq_ignore_ascii_case(n))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decode_chunk_keeps_split_multibyte_character_intact() {
        // "中" is E4 B8 AD. Split it across two reads, exactly like a PTY
        // read boundary can do.
        let mut carry: Vec<u8> = Vec::new();
        let first = decode_chunk(&mut carry, &[0xE4, 0xB8]);
        assert_eq!(first, "", "an incomplete sequence must not be emitted yet");
        assert_eq!(carry, vec![0xE4, 0xB8]);

        let second = decode_chunk(&mut carry, &[0xAD, b'a', b'b']);
        assert_eq!(second, "中ab");
        assert!(carry.is_empty());
    }

    #[test]
    fn decode_chunk_passes_through_valid_utf8_unchanged() {
        let mut carry: Vec<u8> = Vec::new();
        let out = decode_chunk(&mut carry, "hello 世界".as_bytes());
        assert_eq!(out, "hello 世界");
        assert!(carry.is_empty());
    }

    #[test]
    fn decode_chunk_replaces_genuinely_invalid_bytes() {
        let mut carry: Vec<u8> = Vec::new();
        // 0xFF is never valid UTF-8.
        let out = decode_chunk(&mut carry, &[b'a', 0xFF, b'b']);
        assert!(out.contains('a'));
        assert!(out.contains('b'));
        assert!(out.contains('\u{FFFD}'));
        assert!(carry.is_empty());
    }

    #[test]
    fn flush_carry_emits_replacement_for_truncated_tail() {
        let mut carry: Vec<u8> = vec![0xE4, 0xB8];
        let out = flush_carry(&mut carry);
        assert!(!out.is_empty());
        assert!(carry.is_empty(), "carry must be cleared after flushing");
    }

    #[test]
    fn contains_ignore_ascii_case_matches_mixed_case() {
        assert!(contains_ignore_ascii_case(
            "Host Key Verification Failed.",
            "host key verification failed"
        ));
        assert!(contains_ignore_ascii_case(
            "REMOTE HOST IDENTIFICATION HAS CHANGED",
            "remote host identification has changed"
        ));
        assert!(!contains_ignore_ascii_case(
            "everything is fine",
            "host key verification failed"
        ));
        assert!(!contains_ignore_ascii_case("short", "a much longer needle"));
    }

    /// The output path must stay coalesced. A direct per-chunk
    /// `emit_terminal_output` call in the reader thread would reintroduce the
    /// "one IPC round-trip per 4 KB" behaviour that made the Windows terminal
    /// feel laggy under load.
    #[test]
    fn reader_thread_does_not_emit_output_directly() {
        let src = include_str!("terminal_service.rs");
        // Isolate the reader thread body: it starts at `std::thread::spawn`
        // and ends before `pub fn write`.
        let start = src
            .find("std::thread::spawn(move || {")
            .expect("reader thread spawn not found");
        let end = src
            .find("pub fn write(&self")
            .expect("write() not found");
        let reader = &src[start..end];

        assert!(
            !reader.contains("emit_terminal_output"),
            "the reader thread must not emit output directly; it must enqueue \
             TerminalEvent::Output so the emitter can coalesce it"
        );
        assert!(
            !reader.contains("emit_terminal_closed"),
            "the reader thread must not emit terminal-closed directly; \
             ordering with the trailing output depends on the single queue"
        );
        assert!(
            !reader.contains("emit_terminal_error"),
            "the reader thread must not emit terminal-error directly; \
             ordering with the trailing output depends on the single queue"
        );
    }

    /// The coalescing window must be short enough to stay imperceptible
    /// (one 60 Hz frame is ~16.7 ms) and the byte cap must exist so a
    /// runaway producer cannot build an unbounded backlog.
    #[test]
    fn output_coalescing_window_is_bounded() {
        assert!(
            OUTPUT_FLUSH_INTERVAL <= Duration::from_millis(33),
            "the flush window must stay within ~2 frames, got {:?}",
            OUTPUT_FLUSH_INTERVAL
        );
        assert!(
            OUTPUT_FLUSH_MAX_BYTES >= 16 * 1024,
            "the byte cap must allow a meaningful batch"
        );
        assert!(
            OUTPUT_QUEUE_CAPACITY > 0,
            "the reader → emitter queue must be bounded and non-zero"
        );
    }

    /// A burst of PTY reads must collapse into far fewer frontend events.
    ///
    /// This is the core of the Windows "the terminal lags while output is
    /// streaming" fix: every event is a full IPC round-trip (serialize →
    /// IPC → JS listener → xterm write → repaint).
    #[test]
    fn coalescer_merges_a_burst_into_one_payload() {
        let mut c = OutputCoalescer::new();
        let mut emits = 0usize;
        for i in 0..1000 {
            match c.push(TerminalEvent::Output(format!("line-{}\n", i))) {
                EmitterAction::Idle => {}
                EmitterAction::Emit(_) => emits += 1,
                other => panic!("unexpected action: {other:?}"),
            }
        }
        // Nothing should have been emitted yet: the burst is still inside the
        // coalescing window.
        assert_eq!(emits, 0, "the burst must be buffered, not emitted per read");

        let flushed = c.flush().expect("the burst must flush on the next tick");
        assert!(flushed.contains("line-0\n"));
        assert!(flushed.contains("line-999\n"));
        // 1000 reads → 1 event.
        assert_eq!(emits + 1, 1);
    }

    /// A terminal-ending event must flush the pending output FIRST.
    ///
    /// Otherwise the last lines of a command are painted after the "process
    /// exited" banner and the output looks truncated.
    #[test]
    fn coalescer_flushes_output_before_the_closed_event() {
        let mut c = OutputCoalescer::new();
        assert_eq!(c.push(TerminalEvent::Output("AAA".into())), EmitterAction::Idle);
        assert_eq!(c.push(TerminalEvent::Output("BBB".into())), EmitterAction::Idle);
        match c.push(TerminalEvent::Closed(Some(0))) {
            EmitterAction::EmitThenClosed(payload, code) => {
                assert_eq!(payload, "AAABBB");
                assert_eq!(code, Some(0));
            }
            other => panic!("unexpected action: {other:?}"),
        }
    }

    #[test]
    fn coalescer_flushes_output_before_the_error_event() {
        let mut c = OutputCoalescer::new();
        assert_eq!(c.push(TerminalEvent::Output("before".into())), EmitterAction::Idle);
        match c.push(TerminalEvent::Error("boom".into())) {
            EmitterAction::EmitThenError(payload, err) => {
                assert_eq!(payload, "before");
                assert_eq!(err, "boom");
            }
            other => panic!("unexpected action: {other:?}"),
        }
    }

    /// The byte cap must force an early flush so a runaway producer cannot
    /// build an unbounded backlog.
    #[test]
    fn coalescer_flushes_early_when_the_buffer_overflows() {
        let mut c = OutputCoalescer::new();
        let big = "x".repeat(OUTPUT_FLUSH_MAX_BYTES + 1);
        match c.push(TerminalEvent::Output(big)) {
            EmitterAction::Emit(payload) => {
                assert!(payload.len() >= OUTPUT_FLUSH_MAX_BYTES);
            }
            other => panic!("unexpected action: {other:?}"),
        }
    }

    /// Flushing an empty buffer must emit nothing.
    #[test]
    fn coalescer_flush_on_empty_buffer_emits_nothing() {
        let mut c = OutputCoalescer::new();
        assert_eq!(c.flush(), None);
    }
}
