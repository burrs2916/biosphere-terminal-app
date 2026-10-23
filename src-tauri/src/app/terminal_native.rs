//! Native SSH terminal transport — a russh PTY channel instead of a spawned
//! `ssh.exe`.
//!
//! The old lane put a portable-pty around the system OpenSSH client, so every
//! terminal tab was a child `ssh.exe` whose password prompt had to be matched
//! out of a ConPTY-rendered screen buffer. The native lane opens one SSH
//! session per terminal session and requests a PTY + shell directly:
//!
//! - authentication is protocol-level (no `AuthResponder`, no prompt
//!   matching, no CR/LF feeding) — the same credentials path as SFTP;
//! - host-key verification is the same code as SFTP (shared `known_hosts`,
//!   TOFU, one automatic stale-entry clear + retry on a key change);
//! - output flows from the channel receive loop straight into the same
//!   bounded `TerminalEvent` queue the local ConPTY reader feeds, so the
//!   coalescer / emitter ordering guarantees are unchanged;
//! - resize is a `window_change` request, close is `eof` + `close`.

use std::sync::{Arc, Mutex};
use std::time::Duration;

use russh::client::{Handle, Msg};
use russh::{Channel, ChannelMsg, ChannelReadHalf, ChannelWriteHalf};

use crate::app::ssh_common::{self, SshHostKeyHandler};
use crate::app::terminal_service::{decode_chunk, flush_carry};
use crate::core::types::SshConnectionInfo;
use crate::infra::logging::debug_log;

/// Cap on the whole connect + auth + PTY + shell sequence. The spawn command
/// wraps everything in a 15s budget; this fires first so a slow handshake
/// surfaces as this transport's precise timeout message, and so a session can
/// never be registered *after* the command already timed out and cleaned up
/// (that would leave an orphaned ghost session in the map).
const SESSION_ESTABLISH_TIMEOUT: Duration = Duration::from_secs(14);

/// One event of the native SSH terminal stream. The terminal service maps
/// these onto its own `TerminalEvent` queue so output/closed ordering for a
/// native session is identical to a ConPTY one.
pub enum TerminalStreamEvent {
    Output(String),
    Closed,
}

/// A live interactive shell over one SSH channel.
pub struct SshTerminalSession {
    write: Arc<ChannelWriteHalf<Msg>>,
    /// Ownership only: dropping the handle ends the session. Channel writes
    /// go through `write`, reads through the dedicated receive task.
    _handle: Mutex<Option<Handle<SshHostKeyHandler>>>,
}

impl SshTerminalSession {
    /// Open the connection, authenticate, request a PTY + shell and start the
    /// output forwarder. Synchronous and hard-bounded by
    /// `SESSION_ESTABLISH_TIMEOUT`: the handshake runs on its own thread so a
    /// slow peer can never outlive the caller's budget (the spawn command's
    /// 15s timeout would otherwise fire while we are still connecting, and a
    /// late success would register a ghost session nobody asked for).
    pub fn connect(
        ssh: &SshConnectionInfo,
        session_id: &str,
        cols: u16,
        rows: u16,
        emit: Arc<dyn Fn(TerminalStreamEvent) + Send + Sync>,
    ) -> Result<Arc<Self>, String> {
        debug_log::term(
            "DEBUG",
            "term-native",
            "connect-begin",
            &format!(
                "session={} host={} port={} user={} auth={}",
                session_id, ssh.host, ssh.port, ssh.username, ssh.auth_method
            ),
        );
        let ssh = ssh.clone();
        let sid = session_id.to_string();
        let (res_tx, res_rx) = std::sync::mpsc::sync_channel(1);
        std::thread::Builder::new()
            .name("term-native-connect".to_string())
            .spawn(move || {
                let _ = res_tx.send(Self::connect_inner(&ssh, &sid, cols, rows, emit));
            })
            .map_err(|e| format!("无法启动终端连接线程: {}", e))?;
        match res_rx.recv_timeout(SESSION_ESTABLISH_TIMEOUT) {
            Ok(result) => result,
            Err(_) => Err(format!(
                "连接超时：无法在 {} 秒内建立 SSH 终端会话",
                SESSION_ESTABLISH_TIMEOUT.as_secs()
            )),
        }
    }

    /// The actual handshake, run on the dedicated SSH runtime. Owns its inputs
    /// so the future stays `'static` for `wait_on`.
    fn connect_inner(
        ssh: &SshConnectionInfo,
        session_id: &str,
        cols: u16,
        rows: u16,
        emit: Arc<dyn Fn(TerminalStreamEvent) + Send + Sync>,
    ) -> Result<Arc<Self>, String> {
        let sid = session_id.to_string();
        // Own the config: the future must be 'static for `wait_on`, and a
        // borrowed capture would tie it to this call's lifetime.
        let ssh = ssh.clone();
        let session = ssh_common::wait_on(async move {
            let handle = ssh_common::establish(&ssh).await?;
            let mut channel = handle
                .channel_open_session()
                .await
                .map_err(|e| format!("无法打开终端通道: {}", e))?;

            // PTY + shell, each with an explicit reply check. Data can legally
            // arrive before a reply (a fast MOTD), so collect and forward
            // anything seen while waiting.
            let mut early: Vec<Vec<u8>> = Vec::new();
            channel
                .request_pty(true, "xterm-256color", cols as u32, rows as u32, 0, 0, &[])
                .await
                .map_err(|e| format!("PTY 请求失败: {}", e))?;
            wait_for_success(&mut channel, &mut early).await?;
            channel
                .request_shell(true)
                .await
                .map_err(|e| format!("shell 请求失败: {}", e))?;
            wait_for_success(&mut channel, &mut early).await?;

            let (read_half, write_half) = channel.split();
            // The receive loop outlives this future — fire and forget.
            ssh_common::spawn_on(async move {
                forward_output(read_half, emit, early).await;
            })?;
            debug_log::term(
                "DEBUG",
                "term-native",
                "connect-done",
                &format!("session={}", sid),
            );
            Ok::<Arc<SshTerminalSession>, String>(Arc::new(SshTerminalSession {
                write: Arc::new(write_half),
                _handle: Mutex::new(Some(handle)),
            }))
        })??;
        Ok(session)
    }

    /// Write raw bytes into the shell's stdin. The frontend sends what a real
    /// terminal sends (CR for Enter); no newline translation here.
    pub fn write(&self, data: Vec<u8>) -> Result<(), String> {
        let write = Arc::clone(&self.write);
        ssh_common::wait_on(async move { write.data_bytes(data).await })
            .map_err(|e| format!("写入终端失败: {}", e))?
            .map_err(|e| format!("写入终端失败: {}", e))
    }

    /// Resize the remote PTY. Column-first — the russh argument order is
    /// (cols, rows, pix_w, pix_h).
    pub fn resize(&self, cols: u16, rows: u16) -> Result<(), String> {
        let write = Arc::clone(&self.write);
        ssh_common::wait_on(async move { write.window_change(cols as u32, rows as u32, 0, 0).await })
            .map_err(|e| format!("调整终端失败: {}", e))?
            .map_err(|e| format!("调整终端失败: {}", e))
    }

    /// Close the channel and drop the session. Best effort — the handle drop
    /// is the real teardown.
    pub fn close(&self) {
        let write = Arc::clone(&self.write);
        let _ = ssh_common::wait_on(async move {
            let _ = write.eof().await;
            let _ = write.close().await;
        });
    }
}

/// Wait for the reply of a `want_reply` request. Any data seen before the
/// reply is buffered and forwarded afterwards.
async fn wait_for_success(
    channel: &mut Channel<Msg>,
    early: &mut Vec<Vec<u8>>,
) -> Result<(), String> {
    loop {
        match channel.wait().await {
            Some(ChannelMsg::Success) => return Ok(()),
            Some(ChannelMsg::Failure) => {
                return Err("远端拒绝了终端/Shell 请求（PTY 或 shell 不可用）".to_string())
            }
            Some(ChannelMsg::Data { data }) => early.push(data.to_vec()),
            Some(ChannelMsg::ExtendedData { data, .. }) => early.push(data.to_vec()),
            Some(_) => continue,
            None => return Err("SSH 通道在握手完成前关闭".to_string()),
        }
    }
}

/// Forward channel output into the terminal event queue until the channel
/// closes. UTF-8 sequences that span chunk boundaries are carried over —
/// the same guarantees the ConPTY reader provides for local shells.
async fn forward_output(
    mut read_half: ChannelReadHalf,
    emit: Arc<dyn Fn(TerminalStreamEvent) + Send + Sync>,
    mut early: Vec<Vec<u8>>,
) {
    let mut carry: Vec<u8> = Vec::with_capacity(4);
    for chunk in early.drain(..) {
        let text = decode_chunk(&mut carry, &chunk);
        if !text.is_empty() {
            emit(TerminalStreamEvent::Output(text));
        }
    }
    loop {
        match read_half.wait().await {
            Some(ChannelMsg::Data { data }) => {
                let text = decode_chunk(&mut carry, &data);
                if !text.is_empty() {
                    emit(TerminalStreamEvent::Output(text));
                }
            }
            Some(ChannelMsg::ExtendedData { data, .. }) => {
                // stderr merges into the visible stream; an interactive shell
                // interleaves it anyway.
                let text = decode_chunk(&mut carry, &data);
                if !text.is_empty() {
                    emit(TerminalStreamEvent::Output(text));
                }
            }
            Some(ChannelMsg::Eof) | Some(ChannelMsg::Close) | None => {
                let tail = flush_carry(&mut carry);
                if !tail.is_empty() {
                    emit(TerminalStreamEvent::Output(tail));
                }
                emit(TerminalStreamEvent::Closed);
                return;
            }
            Some(_) => continue,
        }
    }
}

// ---- UTF-8 chunk decoding ----
// decode_chunk / flush_carry live in `terminal_service` and carry their own
// regression tests; the native receive loop uses the exact same implementation
// so a native SSH session and a local ConPTY session garble nothing and
// identically.
