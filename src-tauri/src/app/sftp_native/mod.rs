//! Native SFTP transport — pure-Rust SSH + SFTP protocol implementation.
//!
//! This module replaces the former `portable-pty` + system `sftp.exe`
//! subprocess lane. That design had two structural ceilings that no amount of
//! patching could lift:
//!
//! 1. **Windows OpenSSH ships no `ControlMaster`**, so every operation paid a
//!    full TCP + SSH handshake (15 s over a slow link, measured in the field)
//!    before a single byte moved. Browsing a directory tree therefore took
//!    minutes.
//! 2. **Driving an interactive line editor through a pty is inherently
//!    racy.** ConPTY re-renders its virtual screen buffer, so echoed commands
//!    arrive fragmented or with characters dropped (`sftp> d "/"` — the `c` of
//!    `cd` never reached the client). Every command then had to be *inferred*
//!    back from the transcript.
//!
//! The native lane speaks the SFTP protocol directly:
//! - one pooled SSH session per connection, two SFTP subsystem channels
//!   (meta / transfer) — operations are milliseconds after the first connect;
//! - no echo parsing: results are protocol status codes and typed attributes;
//! - host-key verification reuses `russh`'s `known_hosts` support (plain,
//!   hashed `|1|` and `[host]:port` forms), with trust-on-first-use identical
//!   to the old `StrictHostKeyChecking=accept-new` behaviour;
//! - progress and cancellation are ours to compute, not meter lines to guess.

pub mod known_hosts;

use std::collections::HashMap;
use std::future::Future;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use russh::client::Handle;
use russh_sftp::client::SftpSession;
use russh_sftp::protocol::{FileAttributes, OpenFlags, StatusCode};
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt};
use tokio::time::timeout;

use crate::app::ssh_common::{self, SshHostKeyHandler};
use crate::core::types::SshConnectionInfo;
use crate::infra::logging::debug_log;

/// Cap for one metadata operation (listing / mkdir / rename / delete / chmod).
/// Generous because a huge directory listing streams continuously, but a hang
/// past this means the peer is gone.
const META_OP_TIMEOUT: Duration = Duration::from_secs(150);

/// Silence budget while a transfer runs. Each chunk resets it; the headroom
/// covers the quiet window before the first byte of a resumed file.
const XFER_STALL: Duration = Duration::from_secs(120);

/// Transfer chunk size. russh-sftp splits writes to the negotiated maximum
/// packet size anyway; 256 KiB keeps syscalls and memory bounded.
const CHUNK: usize = 256 * 1024;

/// How many protocol requests may be in flight when a bulk operation
/// (resume stat sweep, recursive delete, tree walk) fans out.
const BULK_CONCURRENCY: usize = 16;

/// Idle sessions are reaped so a stale pool entry never outlives its peer.
const SESSION_IDLE_TTL: Duration = Duration::from_secs(300);

// ---- error model ----

/// Everything that can go wrong inside one protocol operation, classified
/// coarsely enough to drive the two behaviours that matter: whether a silent
/// reconnect-and-retry is worth it, and which user-facing message to show.
#[derive(Debug)]
pub(crate) enum OpError {
    /// The session/channel died underneath the operation. Worth exactly one
    /// reconnect + retry at the pool level.
    Connection(String),
    /// A protocol status failure (the server said no).
    Status {
        code: StatusCode,
        message: String,
        path: String,
    },
    /// A request exceeded russh-sftp's response timeout.
    Timeout,
    /// Anything else, already a user-facing message.
    Other(String),
}

impl OpError {
    fn is_connection_class(&self) -> bool {
        matches!(self, OpError::Connection(_))
    }

    /// Map onto the stable Chinese error strings the SFTP UI classifies
    /// (hostkey / auth / unreachable / timeout / unknown). Keep the wording in
    /// sync with `useSftpBrowser::classifySftpError` and `backendError.ts`.
    fn into_message(self) -> String {
        match self {
            OpError::Connection(m) => m,
            OpError::Timeout => "远端长时间无响应，操作已中断".to_string(),
            OpError::Status {
                code,
                message,
                path,
            } => friendly_status(code, &message, &path),
            OpError::Other(m) => m,
        }
    }
}

/// Turn an SFTP status code into an actionable Chinese message. Never echoes
/// the server's raw English text into the `Permission denied` case — that
/// string would make the UI classifier file a *file* permission problem
/// under *auth* failures.
fn friendly_status(code: StatusCode, message: &str, path: &str) -> String {
    match code {
        StatusCode::PermissionDenied => format!(
            "权限不足：无法访问 {}（请确认该路径对当前用户可读写）",
            path
        ),
        StatusCode::NoSuchFile => format!("路径不存在：{}", path),
        StatusCode::OpUnsupported => format!("远端服务器不支持该操作：{}", path),
        StatusCode::NoConnection | StatusCode::ConnectionLost => {
            "连接已断开，请重试".to_string()
        }
        _ => {
            if message.is_empty() {
                format!("SFTP 操作失败：{}", path)
            } else {
                format!("SFTP 操作失败：{}（{}）", path, message)
            }
        }
    }
}

// Host-key verification, authentication and error classification live in
// `ssh_common` — one implementation shared with the native terminal so the
// two features cannot drift apart (same known_hosts file, same TOFU rules,
// same user-facing error wording).

/// Cancellation probe handed to long-running transfers. `Off` for metadata
/// operations (they are bounded by `META_OP_TIMEOUT` anyway).
pub enum CancelCheck {
    Off,
    Watch(Box<dyn Fn() -> bool + Send + Sync + 'static>),
}

impl CancelCheck {
    fn is_cancelled(&self) -> bool {
        match self {
            CancelCheck::Off => false,
            CancelCheck::Watch(f) => f(),
        }
    }
}

// ---- session pool ----

/// One live SSH session with its two SFTP subsystem lanes. Lanes are created
/// eagerly at connect so a transfer never has to open a channel mid-flight,
/// and browsing never waits behind one.
pub(crate) struct NativeSession {
    /// Ownership only: dropping the handle ends the session. All channel
    /// traffic goes through the `SftpSession` lanes, which are `Sync`.
    handle: Mutex<Option<Handle<SshHostKeyHandler>>>,
    meta: Arc<SftpSession>,
    xfer: Arc<SftpSession>,
    last_used: Mutex<Instant>,
}

impl NativeSession {
    fn lane(&self, lane: Lane) -> Arc<SftpSession> {
        match lane {
            Lane::Meta => Arc::clone(&self.meta),
            Lane::Xfer => Arc::clone(&self.xfer),
        }
    }

    fn touch(&self) {
        *crate::app::sftp_service::lock(&self.last_used) = Instant::now();
    }

    fn idle_for(&self) -> Duration {
        crate::app::sftp_service::lock(&self.last_used).elapsed()
    }

    fn is_dead(&self) -> bool {
        let guard = crate::app::sftp_service::lock(&self.handle);
        guard.as_ref().map_or(true, |h| h.is_closed())
    }
}

#[derive(Clone, Copy, PartialEq)]
pub(crate) enum Lane {
    /// Listings and metadata: short ops that must stay responsive while a
    /// transfer runs.
    Meta,
    /// Uploads / downloads: long ops.
    Xfer,
}

fn pool_key(ssh: &SshConnectionInfo) -> String {
    format!("{}@{}:{}", ssh.username, ssh.host, ssh.port)
}

/// The native transport: a dedicated runtime plus the session pool.
///
/// The runtime is deliberately **not** Tauri's. Commands dispatch onto
/// `spawn_blocking` threads (see `interface/commands/sftp.rs`) and bridge
/// here through [`NativeSftp::call`], which spawns onto this runtime and waits
/// on a std channel — so a stalled handshake can never pin the async workers
/// that drive IPC and window events.
pub struct NativeSftp {
    rt: tokio::runtime::Runtime,
    sessions: Mutex<HashMap<String, Arc<NativeSession>>>,
    /// Connection-lifecycle broadcaster, injected once from setup. `None`
    /// simply means the beats are not observed by anyone.
    status: Mutex<Option<crate::app::sftp_service::StatusSink>>,
}

impl Default for NativeSftp {
    fn default() -> Self {
        Self::new()
    }
}

impl NativeSftp {
    pub fn new() -> Self {
        let rt = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .thread_name("sftp-native")
            .enable_all()
            .build()
            .expect("sftp native runtime");
        NativeSftp {
            rt,
            sessions: Mutex::new(HashMap::new()),
            status: Mutex::new(None),
        }
    }

    /// Install the connection-lifecycle emitter (see `SftpService`).
    pub fn set_status_sink(&self, sink: crate::app::sftp_service::StatusSink) {
        *crate::app::sftp_service::lock(&self.status) = Some(sink);
    }

    /// Broadcast one lifecycle beat. Fire-and-forget: a slow or failed UI
    /// update must never back-pressure the transport.
    fn emit_status(&self, phase: &str, detail: Option<String>) {
        if let Some(sink) = crate::app::sftp_service::lock(&self.status).as_ref() {
            sink(crate::app::sftp_service::SftpStatus {
                phase: phase.to_string(),
                detail,
            });
        }
    }

    /// Run an async op from any thread: spawns a future onto the dedicated
    /// runtime and blocks on a std channel. Unlike `Handle::block_on` this
    /// never panics, even if a future runtime thread ends up calling back in,
    /// and it keeps the spawned future `'static` by handing it an `Arc` of the
    /// transport instead of a borrow.
    pub fn call<T, F, Fut>(self: &Arc<Self>, make: F) -> Result<T, String>
    where
        F: FnOnce(Arc<NativeSftp>) -> Fut + Send + 'static,
        Fut: Future<Output = Result<T, String>> + Send + 'static,
        T: Send + 'static,
    {
        let (tx, rx) = std::sync::mpsc::sync_channel(1);
        let handle = self.rt.handle().clone();
        let this = Arc::clone(self);
        handle.spawn(async move {
            let _ = tx.send(make(this).await);
        });
        rx.recv()
            .map_err(|_| "SFTP 内部运行时已关闭".to_string())?
    }

    /// Drop the pooled session for a connection (window close / logout).
    pub fn disconnect(&self, ssh: &SshConnectionInfo) {
        let key = pool_key(ssh);
        let session = crate::app::sftp_service::lock(&self.sessions).remove(&key);
        if let Some(s) = session {
            let handle = crate::app::sftp_service::lock(&s.handle).take();
            drop(handle);
        }
    }

    /// Drop every session (app shutdown).
    pub fn shutdown_all(&self) {
        let mut map = crate::app::sftp_service::lock(&self.sessions);
        for (_, s) in map.drain() {
            let handle = crate::app::sftp_service::lock(&s.handle).take();
            drop(handle);
        }
    }

    fn drop_session(&self, key: &str) {
        let session = crate::app::sftp_service::lock(&self.sessions).remove(key);
        if let Some(s) = session {
            let handle = crate::app::sftp_service::lock(&s.handle).take();
            drop(handle);
        }
    }

    fn reap_idle(&self) {
        let mut map = crate::app::sftp_service::lock(&self.sessions);
        map.retain(|_, s| s.idle_for() < SESSION_IDLE_TTL);
    }

    /// Acquire the pooled session for a connection, connecting if needed.
    /// Sessions that died underneath us (peer closed, network dropped) are
    /// replaced transparently.
    async fn acquire(&self, ssh: &SshConnectionInfo) -> Result<Arc<NativeSession>, String> {
        let key = pool_key(ssh);
        {
            let mut map = crate::app::sftp_service::lock(&self.sessions);
            if let Some(s) = map.get(&key) {
                if !s.is_dead() {
                    s.touch();
                    return Ok(s.clone());
                }
                map.remove(&key);
            }
        }
        let session = self.connect_session(ssh).await?;
        crate::app::sftp_service::lock(&self.sessions).insert(key, session.clone());
        Ok(session)
    }

    /// Full connect: TCP (async DNS, per-address attempts) → SSH handshake
    /// (host-key decision inside the handler) → auth → two SFTP lanes.
    async fn connect_session(&self, ssh: &SshConnectionInfo) -> Result<Arc<NativeSession>, String> {
        let started = Instant::now();
        debug_log::term(
            "DEBUG",
            "sftp",
            "sftp-connect-begin",
            &format!(
                "host={} port={} user={} auth={}",
                ssh.host, ssh.port, ssh.username, ssh.auth_method
            ),
        );
        self.emit_status(
            "connecting",
            Some(format!("{}:{}", ssh.host, ssh.port)),
        );

        // Full handshake: TCP (async DNS, per-address attempts, host-key
        // change clears the stale entry and retries once) → SSH handshake
        // (host-key decision inside the shared handler) → auth.
        let handle = ssh_common::establish(ssh).await?;

        // ---- open both lanes up front ----
        let meta = open_sftp_lane(&handle).await?;
        let xfer = open_sftp_lane(&handle).await?;
        let session = Arc::new(NativeSession {
            handle: Mutex::new(Some(handle)),
            meta,
            xfer,
            last_used: Mutex::new(Instant::now()),
        });
        debug_log::term(
            "DEBUG",
            "sftp",
            "sftp-connect-done",
            &format!(
                "host={} port={} elapsed_ms={}",
                ssh.host,
                ssh.port,
                started.elapsed().as_millis()
            ),
        );
        self.emit_status("ready", Some(format!("{}:{}", ssh.host, ssh.port)));
        Ok(session)
    }

    /// Run one protocol operation on a pooled session.
    ///
    /// Stale-session handling is *acquire-side*: [`NativeSftp::acquire`]
    /// replaces a session the SSH layer already flagged closed, and a
    /// connection-class failure here drops the pool entry so the very next
    /// operation reconnects. Reconnecting *inside* this call would need a
    /// re-callable op; the frontend already retries transient failures once
    /// (with resume for transfers), so one clean error is the right contract.
    async fn run_op<T, F, Fut>(
        &self,
        ssh: &SshConnectionInfo,
        lane: Lane,
        op: F,
    ) -> Result<T, String>
    where
        F: FnOnce(Arc<SftpSession>) -> Fut + Send,
        Fut: Future<Output = Result<T, OpError>> + Send,
        T: Send + 'static,
    {
        self.reap_idle();
        let session = self.acquire(ssh).await?;
        let sftp = session.lane(lane);
        let outcome = match lane {
            // Browsing must not hang forever on a half-dead peer; a transfer
            // is bounded by its own per-chunk stall guard instead.
            Lane::Meta => match timeout(META_OP_TIMEOUT, op(sftp)).await {
                Ok(r) => r,
                Err(_) => {
                    self.drop_session(&pool_key(ssh));
                    return Err("远端长时间无响应，操作已中断".to_string());
                }
            },
            Lane::Xfer => op(sftp).await,
        };
        match outcome {
            Ok(v) => {
                session.touch();
                Ok(v)
            }
            Err(e) => {
                if e.is_connection_class() {
                    // Half-dead TCP is closed by the keepalive; drop now so the
                    // next call reconnects instead of re-using a corpse.
                    self.drop_session(&pool_key(ssh));
                    let msg = e.into_message();
                    self.emit_status("dropped", Some(msg.clone()));
                    Err(msg)
                } else {
                    Err(e.into_message())
                }
            }
        }
    }

    // ---- operations ----

    /// List one directory. `path` of "" / "." means the user's home.
    pub async fn list_dir(
        &self,
        ssh: &SshConnectionInfo,
        path: &str,
    ) -> Result<crate::app::sftp_service::SftpListResult, String> {
        let target = crate::app::sftp_service::normalize_remote_dir(path);
        let want_canonical = target == "." || !target.starts_with('/');
        self.run_op(ssh, Lane::Meta, move |sftp| async move {
            let resolved = if want_canonical {
                sftp.canonicalize(&target)
                    .await
                    .map_err(|e| op_error(&e, &target))?
            } else {
                target.clone()
            };
            let entries = collect_entries(&sftp, &resolved).await?;
            Ok(crate::app::sftp_service::SftpListResult {
                path: resolved,
                entries,
            })
        })
        .await
    }

    /// List several directories concurrently — the directory tree expands an
    /// ancestor chain in one call. A per-path failure is recorded against that
    /// path so one unreadable node cannot poison its siblings.
    pub async fn list_dirs(
        &self,
        ssh: &SshConnectionInfo,
        paths: &[String],
    ) -> Result<Vec<crate::app::sftp_service::DirListing>, String> {
        if paths.is_empty() {
            return Ok(vec![]);
        }
        let owned: Vec<String> = paths.to_vec();
        self.run_op(ssh, Lane::Meta, move |sftp| async move {
            let mut out = Vec::with_capacity(owned.len());
            for chunk in owned.chunks(BULK_CONCURRENCY) {
                let futs: Vec<_> = chunk
                    .iter()
                    .map(|p| {
                        let sftp = sftp.clone();
                        let p = p.clone();
                        // The requested path travels in BOTH branches so a
                        // failure is attributed to the exact node the UI
                        // asked about, not guessed out of the error text.
                        async move {
                            let resolved = match sftp.canonicalize(&p).await {
                                Ok(r) => r,
                                Err(e) => {
                                    let err = op_error(&e, &p);
                                    return Err((p, err));
                                }
                            };
                            match collect_entries(&sftp, &resolved).await {
                                Ok(entries) => Ok((p, resolved, entries)),
                                Err(e) => Err((p, e)),
                            }
                        }
                    })
                    .collect();
                for result in futures::future::join_all(futs).await {
                    match result {
                        Ok((requested, _resolved, entries)) => out.push(
                            crate::app::sftp_service::DirListing {
                                path: requested,
                                entries,
                                error: None,
                            },
                        ),
                        Err((requested, e)) => {
                            out.push(crate::app::sftp_service::DirListing {
                                path: requested,
                                entries: vec![],
                                error: Some(e.into_message()),
                            });
                        }
                    }
                }
            }
            Ok(out)
        })
        .await
    }

    /// Create an empty file.
    pub async fn create_file(&self, ssh: &SshConnectionInfo, remote_path: &str) -> Result<(), String> {
        let path = remote_path.to_string();
        self.run_op(ssh, Lane::Meta, move |sftp| async move {
            sftp.open_with_flags(&path, OpenFlags::CREATE | OpenFlags::WRITE | OpenFlags::TRUNCATE)
                .await
                .map_err(|e| op_error(&e, &path))?;
            Ok(())
        })
        .await
    }

    pub async fn mkdir(&self, ssh: &SshConnectionInfo, remote_path: &str) -> Result<(), String> {
        let path = remote_path.to_string();
        self.run_op(ssh, Lane::Meta, move |sftp| async move {
            sftp.create_dir(&path).await.map_err(|e| op_error(&e, &path))
        })
        .await
    }

    pub async fn rename(&self, ssh: &SshConnectionInfo, from: &str, to: &str) -> Result<(), String> {
        let (f, t) = (from.to_string(), to.to_string());
        self.run_op(ssh, Lane::Meta, move |sftp| async move {
            sftp.rename(&f, &t).await.map_err(|e| op_error(&e, &f))
        })
        .await
    }

    /// Apply an octal permission mode. Windows servers answer SETSTAT with a
    /// failure or ignore the mode bits; the error is surfaced verbatim.
    pub async fn chmod(
        &self,
        ssh: &SshConnectionInfo,
        paths: &[String],
        mode: u32,
    ) -> Result<(), String> {
        let owned = paths.to_vec();
        self.run_op(ssh, Lane::Meta, move |sftp| async move {
            for p in &owned {
                let mut attrs = FileAttributes::empty();
                attrs.permissions = Some(mode);
                sftp.set_metadata(p, attrs)
                    .await
                    .map_err(|e| op_error(&e, p))?;
            }
            Ok(())
        })
        .await
    }

    /// Delete files and directories. Directories are walked first (never
    /// through a symlink), files removed, then the directories bottom-up.
    pub async fn remove(
        &self,
        ssh: &SshConnectionInfo,
        items: &[crate::app::sftp_service::RemoteItem],
    ) -> Result<(), String> {
        let owned: Vec<(String, bool)> = items
            .iter()
            .map(|i| (i.path.clone(), i.is_dir))
            .collect();
        self.run_op(ssh, Lane::Meta, move |sftp| async move {
            for (path, is_dir) in owned {
                if !is_dir {
                    // Trust the caller's type for files; a stale `is_dir` is
                    // corrected by the server's own status code.
                    sftp.remove_file(&path)
                        .await
                        .map_err(|e| op_error(&e, &path))?;
                    continue;
                }
                let (files, dirs) = walk_tree(&sftp, &path).await?;
                for chunk in files.chunks(BULK_CONCURRENCY) {
                    let futs: Vec<_> = chunk
                        .iter()
                        .map(|f| {
                            let sftp = sftp.clone();
                            let f = f.clone();
                            async move { sftp.remove_file(&f).await.map_err(|e| op_error(&e, &f)) }
                        })
                        .collect();
                    for r in futures::future::join_all(futs).await {
                        r?;
                    }
                }
                // Deepest first: a parent can only be removed once empty.
                for d in dirs.iter().rev() {
                    sftp.remove_dir(d).await.map_err(|e| op_error(&e, d))?;
                }
                sftp.remove_dir(&path)
                    .await
                    .map_err(|e| op_error(&e, &path))?;
            }
            Ok(())
        })
        .await
    }

    /// Execute an upload plan. Resume decisions (what the far side already
    /// holds) are made here, on the wire, so the sync caller only has to walk
    /// the local tree.
    pub async fn upload_files(
        &self,
        ssh: &SshConnectionInfo,
        plan: Vec<UploadFile>,
        resume: bool,
        ctx: Option<crate::app::sftp_service::ProgressCtx>,
        cancel: CancelCheck,
    ) -> Result<(), String> {
        self.run_op(ssh, Lane::Xfer, move |sftp| async move {
            // ---- resume sweep: what does the far side already hold? ----
            // A fresh send needs no remote stats at all — skip the round trips.
            let mut remote_sizes: Vec<Option<u64>> = Vec::with_capacity(plan.len());
            if resume {
                for chunk in plan.chunks(BULK_CONCURRENCY) {
                    let futs: Vec<_> = chunk
                        .iter()
                        .map(|f| {
                            let sftp = sftp.clone();
                            let remote = f.remote.clone();
                            async move { sftp.metadata(&remote).await.ok().and_then(|m| m.size) }
                        })
                        .collect();
                    remote_sizes.extend(futures::future::join_all(futs).await);
                }
            }

            let mut work: Vec<(&UploadFile, u64)> = Vec::with_capacity(plan.len());
            for (f, remote_size) in plan.iter().zip(remote_sizes.into_iter().chain(std::iter::repeat(None))) {
                if resume && remote_size.unwrap_or(0) >= f.size {
                    continue; // already complete on the far side
                }
                let offset = if resume {
                    remote_size.unwrap_or(0).min(f.size)
                } else {
                    0
                };
                work.push((f, offset));
            }
            if work.is_empty() {
                return Ok(());
            }

            // ---- create the destination directories (idempotent) ----
            let mut dirs: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();
            for (f, _) in &work {
                let mut p = f.remote.as_str();
                while let Some(i) = p.rfind('/') {
                    if i == 0 {
                        break;
                    }
                    p = &p[..i];
                    dirs.insert(p.to_string());
                }
            }
            for d in &dirs {
                if sftp.create_dir(d).await.is_err() {
                    // Exists already is the expected case; anything else will
                    // surface with a real message when the file is opened.
                    let _ = sftp.metadata(d).await;
                }
            }

            // ---- honest totals: only what still has to move ----
            if let Some(ctx) = &ctx {
                let bytes: u64 = work.iter().map(|(f, off)| f.size - off).sum();
                ctx.set_totals(bytes, work.len() as u32);
            }

            // ---- transfer ----
            // Actual bytes that reached the far side, per file. For files that
            // keep growing while they upload (e.g. logs this very app is
            // writing) the wire total legitimately exceeds the plan-time
            // snapshot — verification must judge the transfer itself, not a
            // moving target.
            let mut actuals: std::collections::HashMap<String, u64> =
                std::collections::HashMap::new();
            let mut chmod_done: std::collections::HashSet<String> =
                std::collections::HashSet::new();
            for (f, offset) in &work {
                let parent = parent_of(&f.remote);
                let mut attempt = 0u8;
                loop {
                    match put_file(&sftp, &f.local, &f.remote, *offset, f.size, ctx.as_ref(), &cancel)
                        .await
                    {
                        Ok(actual) => {
                            actuals.insert(f.remote.clone(), actual);
                            break;
                        }
                        Err(OpError::Status {
                            code: StatusCode::PermissionDenied,
                            ..
                        }) if attempt == 0 && !chmod_done.contains(&parent) => {
                            chmod_done.insert(parent.clone());
                            match ensure_dir_writable(&sftp, &parent).await {
                                Ok(true) => {
                                    attempt += 1;
                                    continue;
                                }
                                Ok(false) => {
                                    return Err(OpError::Other(format!(
                                        "目标目录无写权限，且无法自动赋予（目录不属于当前用户或文件系统只读）：{}。\
                                         请使用有权限的账号（如 root）连接，或上传到你有写权限的目录。",
                                        parent
                                    )))
                                }
                                Err(e) => return Err(e),
                            }
                        }
                        Err(e) => return Err(e),
                    }
                }
            }

            // ---- post-transfer size verification (capped) ----
            // 判据是写侧自洽：远端大小必须等于 put_file 实际写入的字节数。
            // 快照大小（计划时刻 stat 的本地值）不构成判据——读到 EOF 时本地
            // 可能已追加新内容（典型：上传本应用正在写的 debug.log），差值
            // 是文件自身在变，不是传输错误。
            for (f, _) in work.iter().take(crate::app::sftp_service::UPLOAD_VERIFY_CAP) {
                let expected = match actuals.get(&f.remote) {
                    Some(v) => *v,
                    None => continue,
                };
                match sftp.metadata(&f.remote).await {
                    Ok(m) => {
                        let got = m.size.unwrap_or(0);
                        if got != expected {
                            let hint = if got < expected {
                                "写入可能被服务端截断，请重试"
                            } else {
                                "远端存在并发写入，请确认没有其他进程同时写这个文件"
                            };
                            return Err(OpError::Other(format!(
                                "上传后校验失败：{} 实际写入 {} 字节，远端现为 {} 字节，{}。",
                                crate::app::sftp_service::remote_basename(&f.remote),
                                expected,
                                got,
                                hint
                            )));
                        }
                    }
                    // A stat that fails must not fail a transfer that worked.
                    Err(_) => {}
                }
            }
            Ok(())
        })
        .await
    }

    /// Download remote files/directories into a local directory. The remote
    /// tree is walked first so resume, skip-complete and an honest overall
    /// percentage are all decided before the first byte moves.
    pub async fn download_items(
        &self,
        ssh: &SshConnectionInfo,
        items: Vec<crate::app::sftp_service::RemoteItem>,
        local_dir: String,
        resume: bool,
        ctx: Option<crate::app::sftp_service::ProgressCtx>,
        cancel: CancelCheck,
    ) -> Result<u64, String> {
        self.run_op(ssh, Lane::Xfer, move |sftp| async move {
            let base = crate::app::sftp_service::normalize_local_path(&local_dir);

            // ---- flatten the selection into (remote, local) pairs ----
            let mut files: Vec<(String, String)> = Vec::new();
            for item in &items {
                let name = crate::app::sftp_service::remote_basename(&item.path);
                let dest = join_local(&base, &name);
                if item.is_dir {
                    let (remote_files, _dirs) = walk_tree(&sftp, &item.path).await?;
                    let prefix = format!("{}/", item.path);
                    for rf in remote_files {
                        let rel = rf.strip_prefix(&prefix).unwrap_or(&rf).to_string();
                        files.push((rf, join_local(&dest, &rel)));
                    }
                } else {
                    files.push((item.path.clone(), dest));
                }
            }
            if files.is_empty() {
                return Ok(0);
            }

            // ---- resume sweep: remote size vs what is already local ----
            let mut remote_sizes: Vec<Option<u64>> = Vec::with_capacity(files.len());
            for chunk in files.chunks(BULK_CONCURRENCY) {
                let futs: Vec<_> = chunk
                    .iter()
                    .map(|(remote, _)| {
                        let sftp = sftp.clone();
                        let remote = remote.clone();
                        async move { sftp.metadata(&remote).await.ok().and_then(|m| m.size) }
                    })
                    .collect();
                remote_sizes.extend(futures::future::join_all(futs).await);
            }

            let mut work: Vec<(&(String, String), u64, u64)> = Vec::new();
            for (entry, remote_size) in files.iter().zip(remote_sizes) {
                let remote_size = remote_size.ok_or_else(|| {
                    OpError::Status {
                        code: StatusCode::NoSuchFile,
                        message: String::new(),
                        path: entry.0.clone(),
                    }
                })?;
                let local_size = tokio::fs::metadata(&entry.1)
                    .await
                    .ok()
                    .map(|m| m.len())
                    .unwrap_or(0);
                if resume && local_size >= remote_size {
                    continue; // already complete locally
                }
                let offset = if resume {
                    local_size.min(remote_size)
                } else {
                    0
                };
                work.push((entry, offset, remote_size));
            }
            if work.is_empty() {
                return Ok(0);
            }

            // ---- local directories, then honest totals ----
            let mut dirs: std::collections::BTreeSet<std::path::PathBuf> =
                std::collections::BTreeSet::new();
            for (entry, _, _) in &work {
                if let Some(parent) = std::path::Path::new(&entry.1).parent() {
                    if !parent.as_os_str().is_empty() {
                        dirs.insert(parent.to_path_buf());
                    }
                }
            }
            for d in &dirs {
                tokio::fs::create_dir_all(d)
                    .await
                    .map_err(|e| OpError::Other(format!("无法创建本地目录 {}: {}", d.display(), e)))?;
            }
            if let Some(ctx) = &ctx {
                let bytes: u64 = work.iter().map(|(_, off, size)| size - off).sum();
                ctx.set_totals(bytes, work.len() as u32);
            }

            // ---- transfer ----
            let mut moved_total: u64 = 0;
            for (entry, offset, total) in work {
                moved_total += get_file(
                    &sftp,
                    &entry.0,
                    std::path::Path::new(&entry.1),
                    offset,
                    total,
                    ctx.as_ref(),
                    &cancel,
                )
                .await?;
            }
            Ok(moved_total)
        })
        .await
    }
}

/// Parent directory of a remote path (POSIX rules, SFTP is always POSIX).
fn parent_of(path: &str) -> String {
    match path.rfind('/') {
        Some(i) if i > 0 => path[..i].to_string(),
        _ => "/".to_string(),
    }
}

fn join_local(base: &str, name: &str) -> String {
    if base.ends_with('/') {
        format!("{}{}", base, name)
    } else {
        format!("{}/{}", base, name)
    }
}

// ---- free helpers ----

async fn open_sftp_lane(
    handle: &Handle<SshHostKeyHandler>,
) -> Result<Arc<SftpSession>, String> {
    let channel = handle
        .channel_open_session()
        .await
        .map_err(|e| format!("无法打开 SFTP 通道: {}", e))?;
    channel
        .request_subsystem(true, "sftp")
        .await
        .map_err(|e| format!("无法启动 SFTP 子系统: {}", e))?;
    let session = SftpSession::new(channel.into_stream())
        .await
        .map_err(|e| format!("SFTP 协议初始化失败: {}", e))?;
    Ok(Arc::new(session))
}

/// Convert a russh-sftp client error into our classified model. `path` names
/// the operation's target for the user-facing message.
fn op_error(e: &russh_sftp::client::error::Error, path: &str) -> OpError {
    use russh_sftp::client::error::Error::*;
    match e {
        Status(status) => match status.status_code {
            // Client-side pseudo errors: the channel/session is gone.
            StatusCode::NoConnection | StatusCode::ConnectionLost => {
                OpError::Connection(format!("连接已断开：{}", path))
            }
            _ => OpError::Status {
                code: status.status_code,
                message: status.error_message.clone(),
                path: path.to_string(),
            },
        },
        Timeout => OpError::Timeout,
        IO(msg) => {
            let low = msg.to_lowercase();
            if low.contains("connection")
                || low.contains("closed")
                || low.contains("reset")
                || low.contains("broken pipe")
                || low.contains("channel")
            {
                OpError::Connection(format!("{}: {}", path, msg))
            } else {
                OpError::Other(format!("{}: {}", path, msg))
            }
        }
        other => OpError::Other(format!("{}: {}", path, other)),
    }
}

/// Read one directory into UI entries. The readdir attributes are lstat-like
/// on every mainstream server (OpenSSH, Dropbear), so `is_symlink` needs no
/// extra round trip; only *enterable* symlinks cost one stat.
async fn collect_entries(
    sftp: &SftpSession,
    dir: &str,
) -> Result<Vec<crate::app::sftp_service::SftpEntry>, OpError> {
    let read = sftp
        .read_dir(dir)
        .await
        .map_err(|e| op_error(&e, dir))?;
    let mut out = Vec::with_capacity(read.size_hint().0);
    for entry in read {
        let name = entry.file_name();
        let meta = entry.metadata();
        let is_symlink = meta.is_symlink();
        let is_dir = meta.is_dir();
        let full = entry.path();

        // A symlink that resolves to a directory is enterable; the listing's
        // `is_dir` stays the lstat truth so recursive deletes never walk
        // through a link. One extra stat, only for symlinks.
        let target_is_dir = if is_symlink {
            sftp.metadata(&full)
                .await
                .map(|m| m.is_dir())
                .unwrap_or(false)
        } else {
            is_dir
        };

        let link_target = if is_symlink {
            sftp.read_link(&full).await.ok()
        } else {
            None
        };

        out.push(crate::app::sftp_service::SftpEntry {
            name,
            is_dir,
            is_symlink,
            target_is_dir,
            size: meta.size.unwrap_or(0),
            mtime: crate::app::sftp_service::format_mtime(meta.mtime),
            mtime_ts: meta.mtime.unwrap_or(0) as i64,
            perms: crate::app::sftp_service::format_perms(meta.permissions),
            owner: meta.uid.unwrap_or(0).to_string(),
            group: meta.gid.unwrap_or(0).to_string(),
            link_target,
        });
    }
    Ok(out)
}

/// Walk a directory tree for deletion. Returns (files, dirs) with `dirs`
/// ordered parents-before-children (the caller reverses for removal).
/// Symlinks are never followed: a link is removed as a file, whatever it
/// points at.
async fn walk_tree(sftp: &SftpSession, root: &str) -> Result<(Vec<String>, Vec<String>), OpError> {
    let mut files: Vec<String> = Vec::new();
    let mut dirs: Vec<String> = Vec::new();
    let mut stack = vec![root.to_string()];
    while let Some(dir) = stack.pop() {
        let read = sftp.read_dir(&dir).await.map_err(|e| op_error(&e, &dir))?;
        for entry in read {
            let path = entry.path();
            let meta = entry.metadata();
            if meta.is_dir() && !meta.is_symlink() {
                dirs.push(path.clone());
                stack.push(path);
            } else {
                files.push(path);
            }
        }
    }
    Ok((files, dirs))
}

// ---- transfers ----

/// One file of an upload plan, resolved on the local side.
pub struct UploadFile {
    pub local: std::path::PathBuf,
    /// Absolute remote destination path.
    pub remote: String,
    pub size: u64,
}

/// Map a tokio io error from the SFTP file handle onto our model. Write
/// failures arrive here flattened (russh-sftp turns a failed write status
/// into `io::Error::other(message)`), so the message is the only clue left.
fn io_op_error(e: std::io::Error, path: &str) -> OpError {
    let low = e.to_string().to_lowercase();
    if low.contains("permission denied") {
        return OpError::Status {
            code: StatusCode::PermissionDenied,
            message: low,
            path: path.to_string(),
        };
    }
    if low.contains("no space") {
        return OpError::Status {
            code: StatusCode::Failure,
            message: "远端磁盘空间不足".to_string(),
            path: path.to_string(),
        };
    }
    if low.contains("no such file") {
        return OpError::Status {
            code: StatusCode::NoSuchFile,
            message: low,
            path: path.to_string(),
        };
    }
    if low.contains("connection")
        || low.contains("closed")
        || low.contains("reset")
        || low.contains("broken pipe")
        || low.contains("write channel closed")
    {
        return OpError::Connection(low);
    }
    OpError::Other(format!("{}: {}", path, low))
}

/// Copy one local file to the remote. `offset` > 0 continues a resumed
/// transfer: the handle is opened without TRUNCATE and positioned at the
/// bytes the far side already holds. Returns the bytes written.
async fn put_file(
    sftp: &SftpSession,
    local: &Path,
    remote: &str,
    offset: u64,
    total: u64,
    ctx: Option<&crate::app::sftp_service::ProgressCtx>,
    cancel: &CancelCheck,
) -> Result<u64, OpError> {
    let mut reader = tokio::fs::File::open(local)
        .await
        .map_err(|e| OpError::Other(format!("无法读取本地文件 {}: {}", local.display(), e)))?;
    reader
        .seek(tokio::io::SeekFrom::Start(offset))
        .await
        .map_err(|e| OpError::Other(format!("本地文件定位失败: {}", e)))?;

    let flags = if offset > 0 {
        OpenFlags::WRITE | OpenFlags::CREATE
    } else {
        OpenFlags::WRITE | OpenFlags::CREATE | OpenFlags::TRUNCATE
    };
    let mut file = sftp
        .open_with_flags(remote, flags)
        .await
        .map_err(|e| op_error(&e, remote))?;
    if offset > 0 {
        use tokio::io::AsyncSeekExt as _;
        file.seek(tokio::io::SeekFrom::Start(offset))
            .await
            .map_err(|e| OpError::Other(format!("远端文件定位失败: {}", e)))?;
    }

    let mut buf = vec![0u8; CHUNK];
    let mut moved = offset;
    let mut last_report = Instant::now();
    loop {
        if cancel.is_cancelled() {
            let _ = file.close().await;
            return Err(OpError::Other(crate::app::sftp_service::CANCELLED_MESSAGE.to_string()));
        }
        // Stall guard: one chunk (read local + write remote) that takes longer
        // than the silence budget means the peer is gone, not slow.
        let chunk_started = Instant::now();
        let n = reader
            .read(&mut buf)
            .await
            .map_err(|e| OpError::Other(format!("读取本地文件失败: {}", e)))?;
        if n == 0 {
            break;
        }
        if let Err(e) = file.write_all(&buf[..n]).await {
            let _ = file.close().await;
            return Err(io_op_error(e, remote));
        }
        if chunk_started.elapsed() > XFER_STALL {
            let _ = file.close().await;
            return Err(OpError::Other("传输长时间无响应，已中断".to_string()));
        }
        moved += n as u64;
        if let Some(ctx) = ctx {
            if last_report.elapsed() >= Duration::from_millis(250) {
                ctx.report(
                    &crate::app::sftp_service::remote_basename(remote),
                    percent(moved, total),
                    moved,
                );
                last_report = Instant::now();
            }
        }
    }
    // Write acknowledgements only drain on flush/close — without this a
    // silently failed write (permissions, quota) would report success.
    if let Err(e) = file.flush().await {
        let _ = file.close().await;
        return Err(io_op_error(e, remote));
    }
    if let Err(e) = file.close().await {
        return Err(io_op_error(e, remote));
    }
    if let Some(ctx) = ctx {
        ctx.report(
            &crate::app::sftp_service::remote_basename(remote),
            percent(moved, total),
            moved,
        );
    }
    Ok(moved)
}

/// Fetch one remote file into a local path. `offset` > 0 appends to a
/// partially downloaded local file.
async fn get_file(
    sftp: &SftpSession,
    remote: &str,
    local: &Path,
    offset: u64,
    total: u64,
    ctx: Option<&crate::app::sftp_service::ProgressCtx>,
    cancel: &CancelCheck,
) -> Result<u64, OpError> {
    let mut file = sftp
        .open(remote)
        .await
        .map_err(|e| op_error(&e, remote))?;
    if offset > 0 {
        use tokio::io::AsyncSeekExt as _;
        file.seek(tokio::io::SeekFrom::Start(offset))
            .await
            .map_err(|e| OpError::Other(format!("远端文件定位失败: {}", e)))?;
    }

    let mut out = if offset > 0 {
        // Continue where the local copy stopped; trim anything beyond it
        // first so a shrunk remote file does not leave a stale tail.
        let mut f = tokio::fs::OpenOptions::new()
            .write(true)
            .open(local)
            .await
            .map_err(|e| OpError::Other(format!("无法写入本地文件 {}: {}", local.display(), e)))?;
        f.set_len(offset)
            .await
            .map_err(|e| OpError::Other(format!("本地文件截断失败: {}", e)))?;
        // A freshly opened file positions at 0 — without this seek the first
        // resumed chunk would overwrite the file head and corrupt the copy.
        use tokio::io::AsyncSeekExt as _;
        f.seek(tokio::io::SeekFrom::Start(offset))
            .await
            .map_err(|e| OpError::Other(format!("本地文件定位失败: {}", e)))?;
        f
    } else {
        tokio::fs::File::create(local)
            .await
            .map_err(|e| OpError::Other(format!("无法创建本地文件 {}: {}", local.display(), e)))?
    };

    let mut buf = vec![0u8; CHUNK];
    let mut moved = offset;
    let mut last_report = Instant::now();
    loop {
        if cancel.is_cancelled() {
            let _ = out.flush().await;
            let _ = file.close().await;
            return Err(OpError::Other(crate::app::sftp_service::CANCELLED_MESSAGE.to_string()));
        }
        // Stall guard: one chunk that takes longer than the silence budget
        // means the peer is gone, not slow.
        let chunk_started = Instant::now();
        let n = match file.read(&mut buf).await {
            Ok(n) => n,
            Err(e) => {
                let _ = out.flush().await;
                let _ = file.close().await;
                return Err(io_op_error(e, remote));
            }
        };
        if n == 0 {
            break;
        }
        if let Err(e) = out.write_all(&buf[..n]).await {
            let _ = out.flush().await;
            let _ = file.close().await;
            return Err(OpError::Other(format!("写入本地文件失败: {}", e)));
        }
        if chunk_started.elapsed() > XFER_STALL {
            let _ = out.flush().await;
            let _ = file.close().await;
            return Err(OpError::Other("传输长时间无响应，已中断".to_string()));
        }
        moved += n as u64;
        if let Some(ctx) = ctx {
            if last_report.elapsed() >= Duration::from_millis(250) {
                ctx.report(
                    &crate::app::sftp_service::remote_basename(remote),
                    percent(moved, total),
                    moved,
                );
                last_report = Instant::now();
            }
        }
    }
    if let Err(e) = out.flush().await {
        return Err(OpError::Other(format!("写入本地文件失败: {}", e)));
    }
    let _ = file.close().await;
    if let Some(ctx) = ctx {
        ctx.report(
            &crate::app::sftp_service::remote_basename(remote),
            percent(moved, total),
            moved,
        );
    }
    Ok(moved)
}

fn percent(moved: u64, total: u64) -> u8 {
    if total == 0 {
        0
    } else {
        ((moved.min(total) * 100) / total) as u8
    }
}

/// Read a target directory's mode, adding owner write+execute when missing.
/// `Ok(true)` means the chmod landed; `Ok(false)` means the directory already
/// had the bits and the failure is something else; `Err` when the stat or
/// chmod itself failed.
async fn ensure_dir_writable(sftp: &SftpSession, dir: &str) -> Result<bool, OpError> {
    let meta = sftp.metadata(dir).await.map_err(|e| op_error(&e, dir))?;
    let mode = meta.permissions.unwrap_or(0);
    let needed = mode | 0o300;
    if needed == mode {
        return Ok(false);
    }
    let mut attrs = FileAttributes::empty();
    attrs.permissions = Some(needed);
    sftp.set_metadata(dir, attrs)
        .await
        .map_err(|e| op_error(&e, dir))?;
    tracing::info!(
        "[SFTP] added owner write permission to {} ({:o} -> {:o})",
        dir,
        mode,
        needed
    );
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use russh_sftp::client::error::Error as SftpClientError;

    #[test]
    fn parent_of_strips_last_segment() {
        assert_eq!(parent_of("/a/b/c"), "/a/b");
        assert_eq!(parent_of("/a"), "/");
        // A bare filename (no slash) lives at the FS root for our purposes.
        assert_eq!(parent_of("name"), "/");
        // Trailing slash yields the segment before it; a single root stays root.
        assert_eq!(parent_of("/only/"), "/only");
    }

    #[test]
    fn join_local_preserves_trailing_slash() {
        assert_eq!(join_local("/tmp", "x"), "/tmp/x");
        assert_eq!(join_local("/tmp/", "x"), "/tmp/x");
        assert_eq!(join_local("/tmp/", "y/z"), "/tmp/y/z");
    }

    #[test]
    fn percent_is_bounded_and_zero_aware() {
        assert_eq!(percent(0, 0), 0);
        assert_eq!(percent(50, 100), 50);
        assert_eq!(percent(100, 100), 100);
        // Never exceeds 100 even if the wire reports more than the total.
        assert_eq!(percent(120, 100), 100);
    }

    #[test]
    fn op_error_classifies_connection_failures() {
        // A dropped TCP / reset channel must surface as a reconnectable error.
        let io = op_error(&SftpClientError::IO("connection reset by peer".into()), "/x");
        assert!(io.is_connection_class());

        // russh-sftp's own Timeout is not a connection-level fault but a
        // per-request stall; it must NOT be lumped into the reconnect class.
        let timeout = op_error(&SftpClientError::Timeout, "/x");
        assert!(!timeout.is_connection_class());

        // A status code carries the server's denial; here a permission refusal.
        let status = op_error(
            &SftpClientError::Status(russh_sftp::protocol::Status {
                id: 0,
                status_code: StatusCode::PermissionDenied,
                error_message: "Permission denied".into(),
                language_tag: String::new(),
            }),
            "/x",
        );
        assert!(!status.is_connection_class());
        // And the message must name the offending path, not the raw English.
        let msg = status.into_message();
        assert!(msg.contains("/x"));
        assert!(!msg.contains("Permission denied"));
    }
}
