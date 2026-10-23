//! SFTP file-transfer service.
//!
//! Architecture (native protocol lane, since the pty rewrite):
//! - Every remote operation speaks the SFTP protocol directly through
//!   [`sftp_native`] (pure-Rust `russh` + `russh-sftp`). There is no
//!   `sftp.exe` subprocess, no pty, and no transcript parsing: results are
//!   protocol status codes and typed attributes, not echoed console text.
//! - One SSH session is pooled per connection with two SFTP subsystem lanes
//!   (metadata / transfer), so navigating costs milliseconds after the first
//!   connect instead of a full handshake per operation. Host keys are
//!   verified against the system `known_hosts` (trust on first use, matching
//!   the old `accept-new` behaviour).
//! - The public surface below is unchanged from the subprocess era, so the
//!   interface commands and the front end needed no changes.
//! - Commands still dispatch through `spawn_blocking` (see
//!   `interface/commands/sftp.rs`) and bridge onto the transport's dedicated
//!   runtime via `NativeSftp::call`, so a stalled handshake can never pin the
//!   async workers that drive IPC and window events.

use crate::app::sftp_native::{CancelCheck, NativeSftp, UploadFile};
use crate::core::types::SshConnectionInfo;
use crate::infra::logging::debug_log;
use serde::Serialize;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Instant;

/// Ceiling on the number of files whose size is re-checked on the far side
/// after an upload. Recursive sends verify their first N files; a 10k-file
/// drop must not turn into 10k extra round trips.
pub(crate) const UPLOAD_VERIFY_CAP: usize = 20;

/// Message returned when the user aborted a transfer on purpose. The UI
/// matches it verbatim, so it must stay byte-identical.
pub const CANCELLED_MESSAGE: &str = "传输已取消";

#[derive(Debug, Clone, Serialize)]
pub struct SftpEntry {
    pub name: String,
    pub is_dir: bool,
    pub is_symlink: bool,
    /// True when the entry can be *entered*: a real directory, or a symlink
    /// that resolves to one.
    ///
    /// `is_dir` deliberately stays the `lstat` truth so recursive deletes never
    /// walk through a link; this flag is the one navigation is driven by.
    pub target_is_dir: bool,
    pub size: u64,
    /// Normalised "YYYY-MM-DD HH:MM" when the timestamp could be understood,
    /// otherwise an em dash.
    pub mtime: String,
    /// Epoch seconds used for sorting. 0 when unknown.
    pub mtime_ts: i64,
    /// Raw permission string (e.g. "drwxr-xr-x").
    pub perms: String,
    pub owner: String,
    pub group: String,
    /// Target of a symbolic link, when the listing exposed one.
    pub link_target: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SftpListResult {
    /// Absolute path as resolved by the remote host (`realpath`).
    pub path: String,
    pub entries: Vec<SftpEntry>,
}

/// A single directory's listing from a batched [`SftpService::list_dirs`] call.
///
/// `error` is `None` on success. A per-path failure is recorded here rather
/// than aborting the whole batch, so a tree expansion can still render the
/// siblings that resolved fine while flagging the one that did not.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirListing {
    pub path: String,
    pub entries: Vec<SftpEntry>,
    pub error: Option<String>,
}

/// One progress tick of a running transfer, forwarded to the UI.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferProgress {
    pub transfer_id: String,
    /// Name of the file currently on the wire.
    pub file: String,
    /// Progress of *that file*, 0-100.
    pub percent: u8,
    /// Progress of the whole transfer, 0-100. Equal to `percent` when the
    /// total size could not be established.
    pub overall_percent: u8,
    /// True when `overall_percent` is backed by a real total rather than
    /// mirroring the current file. The UI must not promise a completion
    /// figure it cannot stand behind.
    pub overall_known: bool,
    /// 1-based index of the file being moved.
    pub file_no: u32,
    /// Files the transfer expects to move, 0 when unknown.
    pub total_files: u32,
    /// Bytes moved so far across every file of this transfer.
    pub transferred_bytes: u64,
    /// Bytes the transfer expects to move, 0 when unknown.
    pub total_bytes: u64,
    pub transferred: String,
    pub rate: String,
    pub eta: String,
}

pub type ProgressSink = Arc<dyn Fn(TransferProgress) + Send + Sync>;

/// One connection-lifecycle beat pushed to the UI in real time. The phases
/// mirror what the pool actually does: a connect begins, it lands, or a live
/// session was found dead and dropped (the next op reconnects automatically).
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpStatus {
    /// One of "connecting" | "ready" | "dropped".
    pub phase: String,
    /// `host:port` for connect beats, the error digest for a drop.
    pub detail: Option<String>,
}

pub type StatusSink = Arc<dyn Fn(SftpStatus) + Send + Sync>;

/// Cross-file aggregation state for one transfer.
///
/// The remote side gives us exact byte offsets, so the running total here is
/// arithmetic rather than a guess: a folder upload reports one honest
/// "overall %" instead of redrawing 0→100 once per file.
#[derive(Default)]
struct ProgressState {
    total_bytes: u64,
    total_files: u32,
    /// Bytes belonging to files that have already been handed off.
    done_bytes: u64,
    /// Files that have already been handed off.
    done_files: u32,
    current_file: String,
    /// High-water mark for the file on the wire; the total must never walk
    /// backwards.
    current_bytes: u64,
    started: Option<Instant>,
    last_at: Option<Instant>,
    last_bytes: u64,
}

struct ProgressInner {
    transfer_id: String,
    sink: ProgressSink,
    state: Mutex<ProgressState>,
}

/// Progress reporter for one transfer. `Clone` (shared inner state) so the
/// native transport can own it inside its spawned future while the command
/// layer keeps its reference.
#[derive(Clone)]
pub struct ProgressCtx {
    inner: Arc<ProgressInner>,
}

impl ProgressCtx {
    pub fn new(transfer_id: String, sink: ProgressSink) -> Self {
        ProgressCtx {
            inner: Arc::new(ProgressInner {
                transfer_id,
                sink,
                state: Mutex::new(ProgressState::default()),
            }),
        }
    }

    /// Declare how much work the transfer represents. Both values are best
    /// effort: 0 means "unknown", which downgrades the UI to per-file
    /// reporting instead of inventing a percentage.
    pub fn set_totals(&self, bytes: u64, files: u32) {
        let mut st = lock(&self.inner.state);
        st.total_bytes = bytes;
        st.total_files = files;
    }

    /// Fold one byte-position report into the running total and forward it.
    /// Rate and ETA are derived here from the report interval, so no meter
    /// text has to be parsed off the wire.
    pub fn report(&self, file: &str, percent: u8, moved: u64) {
        let computed = {
            let mut st = lock(&self.inner.state);
            if st.current_file != file {
                // A new name on the wire is the only "file finished" signal.
                if !st.current_file.is_empty() {
                    st.done_bytes += st.current_bytes;
                    st.done_files += 1;
                }
                st.current_file = file.to_string();
                st.current_bytes = 0;
            }
            if moved > st.current_bytes {
                st.current_bytes = moved;
            }
            if st.started.is_none() {
                st.started = Some(Instant::now());
            }
            let moved_total = st.done_bytes.saturating_add(st.current_bytes);
            let (overall, known) = if st.total_bytes > 0 {
                (
                    ((moved_total.min(st.total_bytes) * 100) / st.total_bytes) as u8,
                    true,
                )
            } else if st.total_files > 0 {
                // No byte total but the file count is known: each file
                // contributes an equal slice.
                let done = st.done_files.min(st.total_files);
                (
                    ((done as u64 * 100 + percent as u64) / st.total_files as u64).min(100) as u8,
                    true,
                )
            } else {
                (percent, false)
            };
            let now = Instant::now();
            let (dt, db) = match st.last_at {
                Some(prev) => (
                    now.saturating_duration_since(prev).as_secs_f64().max(0.1),
                    moved_total.saturating_sub(st.last_bytes),
                ),
                None => (
                    st.started
                        .map_or(0.1, |s| now.saturating_duration_since(s).as_secs_f64())
                        .max(0.1),
                    moved_total,
                ),
            };
            let rate_bps = db as f64 / dt;
            st.last_at = Some(now);
            st.last_bytes = moved_total;
            let eta = if st.total_bytes > 0 && rate_bps > 0.0 {
                Some(st.total_bytes.saturating_sub(moved_total) as f64 / rate_bps)
            } else {
                None
            };
            (
                overall,
                known,
                st.done_files + 1,
                st.total_files,
                moved_total,
                st.total_bytes,
                human_bytes(moved_total),
                format_rate(rate_bps),
                eta.map(|s| format_eta(s as u64)).unwrap_or_default(),
            )
        };
        let (
            overall,
            known,
            file_no,
            total_files,
            moved_total,
            total_bytes,
            transferred,
            rate,
            eta,
        ) = computed;
        (self.inner.sink)(TransferProgress {
            transfer_id: self.inner.transfer_id.clone(),
            file: file.to_string(),
            percent,
            overall_percent: overall,
            overall_known: known,
            file_no,
            total_files,
            transferred_bytes: moved_total,
            total_bytes,
            transferred,
            rate,
            eta,
        });
    }

    fn is_cancelled_in(&self, registry: &TransferRegistry) -> bool {
        registry.is_cancelled(&self.inner.transfer_id)
    }
}

/// A remote path plus the type we already know from the listing, so deletes
/// and downloads can pick the right protocol verb without an extra stat.
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteItem {
    pub path: String,
    #[serde(default)]
    pub is_dir: bool,
}

/// Transfer bookkeeping shared between the service (which decides) and the
/// transport's spawned futures (which observe).
#[derive(Default)]
pub struct TransferRegistry {
    /// Every transfer the service has accepted and not yet finished, claimed
    /// *before* anything can block, so a cancel can never arrive for an id
    /// the service is not working on.
    inflight: Mutex<HashSet<String>>,
    /// Transfers the user called off. Metadata operations are never claimed,
    /// so they can never be cancelled mid-flight — they are bounded by the
    /// transport's own op timeout instead.
    cancelled: Mutex<HashSet<String>>,
}

impl TransferRegistry {
    fn is_cancelled(&self, id: &str) -> bool {
        lock(&self.cancelled).contains(id)
    }

    fn claim(&self, id: &str) {
        lock(&self.inflight).insert(id.to_string());
        // A retry reuses the id: drop the verdict from the previous attempt,
        // otherwise the replay would abort on a cancel the user already saw.
        lock(&self.cancelled).remove(id);
    }

    fn release(&self, id: &str) {
        lock(&self.inflight).remove(id);
        lock(&self.cancelled).remove(id);
    }
}

/// Holds one transfer id in the registry for the duration of an operation and
/// guarantees the bookkeeping is released on every exit path, including a
/// panic.
struct TransferSlot<'a> {
    registry: &'a TransferRegistry,
    id: String,
}

impl Drop for TransferSlot<'_> {
    fn drop(&mut self) {
        self.registry.release(&self.id);
    }
}

/// Lock a mutex, recovering from poisoning: a panicked transfer must not make
/// every later operation fail on `PoisonError`.
pub(crate) fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    match m.lock() {
        Ok(g) => g,
        Err(p) => p.into_inner(),
    }
}

pub struct SftpService {
    native: Arc<NativeSftp>,
    registry: Arc<TransferRegistry>,
}

impl Default for SftpService {
    fn default() -> Self {
        Self::new()
    }
}

impl SftpService {
    pub fn new() -> Self {
        SftpService {
            native: Arc::new(NativeSftp::new()),
            registry: Arc::new(TransferRegistry::default()),
        }
    }

    /// Wire the connection-lifecycle emitter (called once from setup, where
    /// the `AppHandle` lives). Without a sink the pool stays fully functional
    /// and simply does not broadcast status.
    pub fn set_status_sink(&self, sink: StatusSink) {
        self.native.set_status_sink(sink);
    }

    // ---- public API ----

    /// List a remote directory, resolving which entries can be entered.
    /// `path` of "" / "." means the user's home.
    pub fn list_dir(&self, ssh: &SshConnectionInfo, path: &str) -> Result<SftpListResult, String> {
        let started = Instant::now();
        let out = {
            let native = self.native.clone();
            let ssh = ssh.clone();
            let path = path.to_string();
            native.call(move |native| async move { native.list_dir(&ssh, &path).await })
        };
        match &out {
            Ok(r) => debug_log::term(
                "DEBUG",
                "sftp",
                "sftp-list",
                &format!(
                    "path={} entries={} elapsed_ms={}",
                    r.path,
                    r.entries.len(),
                    started.elapsed().as_millis()
                ),
            ),
            Err(e) => debug_log::term(
                "ERROR",
                "sftp",
                "sftp-list-failed",
                &format!(
                    "path={} err={} elapsed_ms={}",
                    path,
                    e,
                    started.elapsed().as_millis()
                ),
            ),
        }
        out
    }

    /// List several directories concurrently. The directory tree expands an
    /// ancestor chain at once; batching the listings into one round of
    /// concurrent protocol requests keeps a deep expansion from serialising
    /// behind the meta lane.
    pub fn list_dirs(
        &self,
        ssh: &SshConnectionInfo,
        paths: &[String],
    ) -> Result<Vec<DirListing>, String> {
        if paths.is_empty() {
            return Ok(vec![]);
        }
        let started = Instant::now();
        let out = {
            let native = self.native.clone();
            let ssh = ssh.clone();
            let paths = paths.to_vec();
            native.call(move |native| async move { native.list_dirs(&ssh, &paths).await })
        };
        if let Err(e) = &out {
            debug_log::term(
                "ERROR",
                "sftp",
                "sftp-list-many-failed",
                &format!(
                    "n={} err={} elapsed_ms={}",
                    paths.len(),
                    e,
                    started.elapsed().as_millis()
                ),
            );
        }
        out
    }

    /// Upload local files/directories into a remote directory.
    ///
    /// `remote_names` lets the UI keep both copies on a name clash by
    /// uploading the incoming file under a fresh name (`report (1).pdf`)
    /// instead of clobbering the original. `resume` skips files the far side
    /// already holds at full length and continues the rest from the last
    /// confirmed byte.
    pub fn upload(
        &self,
        ssh: &SshConnectionInfo,
        local_paths: &[String],
        remote_dir: &str,
        progress: Option<&ProgressCtx>,
        remote_names: Option<&[String]>,
        resume: bool,
    ) -> Result<(), String> {
        if local_paths.is_empty() {
            return Ok(());
        }
        // Claimed before any blocking work so the row the user just saw appear
        // can be cancelled straight away.
        let _slot = self.claim_transfer(progress);
        if let Some(p) = progress {
            if p.is_cancelled_in(&self.registry) {
                return Err(CANCELLED_MESSAGE.to_string());
            }
        }

        let started = Instant::now();
        let dir = normalize_remote_dir(remote_dir);
        let plan = build_upload_plan(local_paths, &dir, remote_names)?;
        if plan.is_empty() {
            return Ok(());
        }
        debug_log::term(
            "DEBUG",
            "sftp",
            "sftp-upload-begin",
            &format!("dir={} files={} resume={}", dir, plan.len(), resume),
        );

        let plan_bytes = plan_bytes(&plan);
        let out = {
            let native = self.native.clone();
            let ssh = ssh.clone();
            let ctx = progress.cloned();
            let registry = self.registry.clone();
            let transfer_id = ctx
                .as_ref()
                .map(|c| c.inner.transfer_id.clone())
                .unwrap_or_default();
            native.call(move |native| async move {
                let cancel = if transfer_id.is_empty() {
                    CancelCheck::Off
                } else {
                    CancelCheck::Watch(Box::new(move || registry.is_cancelled(&transfer_id)))
                };
                native.upload_files(&ssh, plan, resume, ctx, cancel).await
            })
        };
        self.log_transfer("sftp-upload", &out, started, plan_bytes);
        out
    }

    /// Download remote files/directories into a local directory.
    ///
    /// `resume` continues an interrupted download: a missing local file is
    /// fetched in full, a short one is continued from its last byte, a
    /// complete one is left alone.
    pub fn download(
        &self,
        ssh: &SshConnectionInfo,
        items: &[RemoteItem],
        local_dir: &str,
        progress: Option<&ProgressCtx>,
        resume: bool,
    ) -> Result<(), String> {
        if items.is_empty() {
            return Ok(());
        }
        let _slot = self.claim_transfer(progress);
        if let Some(p) = progress {
            if p.is_cancelled_in(&self.registry) {
                return Err(CANCELLED_MESSAGE.to_string());
            }
        }

        let started = Instant::now();
        debug_log::term(
            "DEBUG",
            "sftp",
            "sftp-download-begin",
            &format!("items={} dir={} resume={}", items.len(), local_dir, resume),
        );
        let out = {
            let native = self.native.clone();
            let ssh = ssh.clone();
            let items = items.to_vec();
            let local_dir = local_dir.to_string();
            let ctx = progress.cloned();
            let registry = self.registry.clone();
            let transfer_id = ctx
                .as_ref()
                .map(|c| c.inner.transfer_id.clone())
                .unwrap_or_default();
            let moved: Result<u64, String> = native.call(move |native| async move {
                let cancel = if transfer_id.is_empty() {
                    CancelCheck::Off
                } else {
                    CancelCheck::Watch(Box::new(move || registry.is_cancelled(&transfer_id)))
                };
                native
                    .download_items(&ssh, items, local_dir, resume, ctx, cancel)
                    .await
            });
            moved
        };
        // Split bytes from the verdict once: the log needs both, the caller
        // only the verdict.
        let (bytes, res) = match out {
            Ok(n) => (n, Ok(())),
            Err(e) => (0, Err(e)),
        };
        self.log_transfer("sftp-download", &res, started, bytes);
        res
    }

    /// Delete remote files and directories. Directories are removed
    /// recursively (the tree is walked first).
    pub fn remove(&self, ssh: &SshConnectionInfo, items: &[RemoteItem]) -> Result<(), String> {
        if items.is_empty() {
            return Ok(());
        }
        let started = Instant::now();
        let out = {
            let native = self.native.clone();
            let ssh = ssh.clone();
            let items = items.to_vec();
            native.call(move |native| async move { native.remove(&ssh, &items).await })
        };
        if let Err(e) = &out {
            debug_log::term(
                "ERROR",
                "sftp",
                "sftp-remove-failed",
                &format!(
                    "items={} err={} elapsed_ms={}",
                    items.len(),
                    e,
                    started.elapsed().as_millis()
                ),
            );
        }
        out
    }

    pub fn rename(&self, ssh: &SshConnectionInfo, from: &str, to: &str) -> Result<(), String> {
        let native = self.native.clone();
        let ssh = ssh.clone();
        let (from, to) = (from.to_string(), to.to_string());
        native.call(move |native| async move { native.rename(&ssh, &from, &to).await })
    }

    pub fn mkdir(&self, ssh: &SshConnectionInfo, remote_path: &str) -> Result<(), String> {
        let native = self.native.clone();
        let ssh = ssh.clone();
        let remote_path = remote_path.to_string();
        native.call(move |native| async move { native.mkdir(&ssh, &remote_path).await })
    }

    /// Create an empty file at `path` on the remote. The frontend is
    /// responsible for the existence check, exactly as it is for `mkdir`.
    pub fn create_file(&self, ssh: &SshConnectionInfo, remote_path: &str) -> Result<(), String> {
        if remote_path.trim().is_empty() {
            return Err("目标路径为空".to_string());
        }
        let native = self.native.clone();
        let ssh = ssh.clone();
        let remote_path = remote_path.to_string();
        native.call(move |native| async move { native.create_file(&ssh, &remote_path).await })
    }

    /// Apply a POSIX permission mode to remote paths.
    ///
    /// `mode` is an octal string ("755", "0644"). Windows servers answer
    /// SETSTAT with a failure or silently ignore the mode bits — the error is
    /// surfaced rather than pretended away.
    pub fn chmod(
        &self,
        ssh: &SshConnectionInfo,
        paths: &[String],
        mode: &str,
    ) -> Result<(), String> {
        if paths.is_empty() {
            return Ok(());
        }
        let normalized = normalize_octal_mode(mode)?;
        let native = self.native.clone();
        let ssh = ssh.clone();
        let paths = paths.to_vec();
        native.call(move |native| async move { native.chmod(&ssh, &paths, normalized).await })
    }

    /// Tear down the pooled session for a connection (called when the SFTP
    /// window closes) so no half-open SSH session is left behind.
    pub fn disconnect(&self, ssh: &SshConnectionInfo) {
        self.native.disconnect(ssh);
    }

    /// Drop every pooled session regardless of connection (app shutdown).
    pub fn shutdown_all(&self) {
        self.native.shutdown_all();
    }

    /// Abort a transfer, whether or not it has started.
    ///
    /// A transfer spends real time queued before its first byte and then
    /// waits on the network; recording the verdict makes the cancel stick
    /// across both windows. The transport's copy loop observes the flag
    /// between chunks, so an in-flight transfer stops within one chunk.
    ///
    /// Returns false only for ids the service is not working on, so a stale
    /// cancel cannot leave an unread verdict behind forever.
    pub fn cancel(&self, transfer_id: &str) -> bool {
        if !lock(&self.registry.inflight).contains(transfer_id) {
            return false;
        }
        lock(&self.registry.cancelled).insert(transfer_id.to_string());
        true
    }

    // ---- internals ----

    /// Claim a transfer id for one operation. Called before any blocking
    /// work, so the transfer is cancellable from the instant the UI queues it.
    fn claim_transfer(&self, progress: Option<&ProgressCtx>) -> Option<TransferSlot<'_>> {
        let ctx = progress?;
        self.registry.claim(&ctx.inner.transfer_id);
        Some(TransferSlot {
            registry: &self.registry,
            id: ctx.inner.transfer_id.clone(),
        })
    }

    fn log_transfer(&self, evt: &str, out: &Result<(), String>, started: Instant, bytes: u64) {
        match out {
            Ok(()) => debug_log::term(
                "DEBUG",
                "sftp",
                evt,
                &format!(
                    "ok bytes={} elapsed_ms={}",
                    bytes,
                    started.elapsed().as_millis()
                ),
            ),
            Err(e) => debug_log::term(
                "ERROR",
                "sftp",
                &format!("{}-failed", evt),
                &format!("err={} elapsed_ms={}", e, started.elapsed().as_millis()),
            ),
        }
    }
}

fn plan_bytes(plan: &[UploadFile]) -> u64 {
    plan.iter().map(|f| f.size).sum()
}

// ---- local walk (runs on the blocking pool) ----

/// Flatten the local selection into upload targets.
///
/// A directory merges into its destination (the same rule the old
/// `put -r <dir>/.` batch implemented): `data` uploaded into `/srv` lands at
/// `/srv/data/...`, never `/srv/data/data/...`. Symlinks are transferred as
/// regular files — the SFTP protocol has no client verb for recreating one.
fn build_upload_plan(
    local_paths: &[String],
    remote_dir: &str,
    remote_names: Option<&[String]>,
) -> Result<Vec<UploadFile>, String> {
    let mut plan: Vec<UploadFile> = Vec::new();
    for (i, local) in local_paths.iter().enumerate() {
        let p = Path::new(local);
        let name = p
            .file_name()
            .map(|s| s.to_string_lossy().to_string())
            .ok_or_else(|| format!("无法解析本地文件名: {}", local))?;
        let size_of = |path: &Path| std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);
        if p.is_dir() {
            let dest_root = join_remote(remote_dir, &name);
            let mut files: Vec<(PathBuf, String)> = Vec::new();
            walk_local_files(p, "", &mut files)
                .map_err(|e| format!("无法读取本地目录 {}: {}", local, e))?;
            for (abs, rel) in files {
                plan.push(UploadFile {
                    local: abs.clone(),
                    remote: join_remote(&dest_root, &rel),
                    size: size_of(&abs),
                });
            }
        } else {
            // `remote_names` keeps both copies on a name clash.
            let dest_name = match remote_names {
                Some(names) if i < names.len() && !names[i].is_empty() => names[i].clone(),
                _ => name,
            };
            let abs = p.to_path_buf();
            plan.push(UploadFile {
                local: abs.clone(),
                remote: join_remote(remote_dir, &dest_name),
                size: size_of(&abs),
            });
        }
    }
    Ok(plan)
}

/// Depth-first walk that never follows a symlinked directory (loop safety),
/// collecting `(absolute local path, '/'-separated relative path)` pairs.
fn walk_local_files(
    root: &Path,
    prefix: &str,
    out: &mut Vec<(PathBuf, String)>,
) -> std::io::Result<()> {
    let mut stack: Vec<(PathBuf, String)> = vec![(root.to_path_buf(), prefix.to_string())];
    while let Some((dir, rel)) = stack.pop() {
        let entries = std::fs::read_dir(&dir)?;
        for entry in entries.flatten() {
            let ep = entry.path();
            let fname = entry.file_name().to_string_lossy().to_string();
            let child_rel = if rel.is_empty() {
                fname
            } else {
                format!("{}/{}", rel, fname)
            };
            let meta = match entry.metadata() {
                Ok(m) => m,
                Err(_) => continue,
            };
            if meta.is_dir() {
                stack.push((ep, child_rel));
            } else if meta.is_file() {
                out.push((ep, child_rel));
            }
            // Anything else (symlink, socket, …) is transferred by content
            // through the parent's read path; skipping exotic types keeps a
            // broken link from failing a whole-tree upload.
        }
    }
    Ok(())
}

// ---- pure helpers ----

/// True for a Win32-OpenSSH drive root: `/C:/` or `C:/`.
///
/// The distinction matters because `cd "/C:"` (no trailing slash) means "the
/// working directory of drive C" in Win32 semantics, which is *not* the root
/// of the drive. Keeping the slash makes "go up from /C:/Users" land where a
/// user expects.
fn is_drive_root(p: &str) -> bool {
    let t = p.strip_prefix('/').unwrap_or(p);
    let b = t.as_bytes();
    b.len() == 3 && b[0].is_ascii_alphabetic() && b[1] == b':' && b[2] == b'/'
}

pub(crate) fn normalize_remote_dir(path: &str) -> String {
    let t = path.trim();
    if t.is_empty() || t == "." {
        ".".to_string()
    } else if is_drive_root(t) {
        t.to_string()
    } else if t.len() > 1 && t.ends_with('/') {
        t.trim_end_matches('/').to_string()
    } else {
        t.to_string()
    }
}

/// Windows local paths use backslashes; SFTP and our own joiners use `/`.
pub(crate) fn normalize_local_path(p: &str) -> String {
    if cfg!(target_os = "windows") {
        p.replace('\\', "/")
    } else {
        p.to_string()
    }
}

pub(crate) fn remote_basename(path: &str) -> String {
    path.trim_end_matches('/')
        .rsplit('/')
        .next()
        .unwrap_or(path)
        .to_string()
}

pub(crate) fn join_remote(base: &str, name: &str) -> String {
    if base == "." || base.is_empty() {
        name.to_string()
    } else if base.ends_with('/') {
        format!("{}{}", base, name)
    } else {
        format!("{}/{}", base, name)
    }
}

/// Validate and canonicalise a permission mode for the SFTP SETSTAT request.
/// Only octal digits are accepted: anything else would be parsed as a number
/// from user input and silently mis-applied.
fn normalize_octal_mode(mode: &str) -> Result<u32, String> {
    let t = mode.trim();
    let digits: &str = t.strip_prefix("0o").unwrap_or(t);
    if digits.is_empty()
        || digits.len() > 4
        || !digits.chars().all(|c| ('0'..='7').contains(&c))
    {
        return Err(format!("无效的权限值: {}", mode));
    }
    u32::from_str_radix(digits, 8).map_err(|_| format!("无效的权限值: {}", mode))
}

/// Render an SFTP mode word as the familiar 10-character permission string.
pub(crate) fn format_perms(mode: Option<u32>) -> String {
    let mode = match mode {
        Some(m) => m,
        None => return "----------".to_string(),
    };
    let type_char = match mode & 0o170000 {
        0o040000 => 'd',
        0o120000 => 'l',
        0o020000 => 'c',
        0o060000 => 'b',
        0o010000 => 'p',
        0o140000 => 's',
        _ => '-',
    };
    let mut s = String::with_capacity(10);
    s.push(type_char);
    for shift in [6, 3, 0] {
        let bits = (mode >> shift) & 7;
        s.push(if bits & 4 != 0 { 'r' } else { '-' });
        s.push(if bits & 2 != 0 { 'w' } else { '-' });
        s.push(if bits & 1 != 0 { 'x' } else { '-' });
    }
    s
}

/// Render an mtime as "YYYY-MM-DD HH:MM". The SFTP protocol only carries
/// epoch seconds, so the rendering is UTC — deterministic across servers,
/// unlike the old `ls` output which used whatever timezone the far side was
/// set to.
pub(crate) fn format_mtime(secs: Option<u32>) -> String {
    match secs.and_then(|s| chrono::DateTime::from_timestamp(s as i64, 0)) {
        Some(dt) => dt.format("%Y-%m-%d %H:%M").to_string(),
        None => "—".to_string(),
    }
}

/// Human byte count in the same 1000-based units the OpenSSH meter used.
fn human_bytes(b: u64) -> String {
    const UNITS: [&str; 5] = ["B", "KB", "MB", "GB", "TB"];
    if b < 1000 {
        return format!("{}B", b);
    }
    let mut v = b as f64 / 1000.0;
    let mut i = 1;
    while v >= 1000.0 && i < UNITS.len() - 1 {
        v /= 1000.0;
        i += 1;
    }
    format!("{:.1}{}", v, UNITS[i])
}

fn format_rate(bps: f64) -> String {
    if bps <= 0.0 {
        "0B/s".to_string()
    } else {
        format!("{}/s", human_bytes(bps as u64))
    }
}

fn format_eta(secs: u64) -> String {
    let h = secs / 3600;
    let m = (secs % 3600) / 60;
    let s = secs % 60;
    if h > 0 {
        format!("{}:{:02}:{:02}", h, m, s)
    } else {
        format!("{:02}:{:02}", m, s)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ctx_with_sink(sink: ProgressSink) -> ProgressCtx {
        ProgressCtx::new("t1".to_string(), sink)
    }

    #[test]
    fn remote_path_helpers() {
        assert_eq!(normalize_remote_dir(""), ".");
        assert_eq!(normalize_remote_dir("."), ".");
        assert_eq!(normalize_remote_dir("/home/dfy/"), "/home/dfy");
        assert_eq!(normalize_remote_dir("/"), "/");
        assert_eq!(normalize_remote_dir("/C:/"), "/C:/");
        assert_eq!(normalize_remote_dir("/C:"), "/C:");
        assert_eq!(remote_basename("/home/dfy/report.pdf"), "report.pdf");
        assert_eq!(remote_basename("/home/dfy/"), "dfy");
        assert_eq!(join_remote(".", "a"), "a");
        assert_eq!(join_remote("/srv", "a"), "/srv/a");
        assert_eq!(join_remote("/srv/", "a"), "/srv/a");
    }

    #[test]
    fn octal_modes_are_validated() {
        assert_eq!(normalize_octal_mode("755").unwrap(), 0o755);
        assert_eq!(normalize_octal_mode("0644").unwrap(), 0o644);
        assert_eq!(normalize_octal_mode("7").unwrap(), 0o007);
        assert_eq!(normalize_octal_mode("0o600").unwrap(), 0o600);
        assert!(normalize_octal_mode("").is_err());
        assert!(normalize_octal_mode("888").is_err());
        assert!(normalize_octal_mode("75555").is_err());
        assert!(normalize_octal_mode("rwx").is_err());
    }

    #[test]
    fn perms_render_like_ls() {
        assert_eq!(format_perms(Some(0o040755)), "drwxr-xr-x");
        assert_eq!(format_perms(Some(0o100644)), "-rw-r--r--");
        assert_eq!(format_perms(Some(0o120777)), "lrwxrwxrwx");
        assert_eq!(format_perms(Some(0o040700)), "drwx------");
        assert_eq!(format_perms(None), "----------");
    }

    #[test]
    fn mtime_renders_utc() {
        // 2026-01-01 00:00:00 UTC
        assert_eq!(format_mtime(Some(1767225600)), "2026-01-01 00:00");
        assert_eq!(format_mtime(None), "—");
    }

    #[test]
    fn human_sizes_and_eta() {
        assert_eq!(human_bytes(0), "0B");
        assert_eq!(human_bytes(999), "999B");
        assert_eq!(human_bytes(1_000), "1.0KB");
        assert_eq!(human_bytes(1_500_000), "1.5MB");
        assert_eq!(format_eta(0), "00:00");
        assert_eq!(format_eta(83), "01:23");
        assert_eq!(format_eta(3723), "1:02:03");
        assert_eq!(format_rate(0.0), "0B/s");
    }

    #[test]
    fn progress_folds_files_into_one_total() {
        let seen: Arc<Mutex<Vec<TransferProgress>>> = Arc::new(Mutex::new(Vec::new()));
        let sink_seen = seen.clone();
        let ctx = ctx_with_sink(Arc::new(move |p| sink_seen.lock().unwrap().push(p)));

        ctx.set_totals(300, 2);
        ctx.report("a.bin", 50, 150);
        ctx.report("a.bin", 100, 300); // file 1 complete
        ctx.report("b.bin", 0, 0); // file 2 starts

        let ticks = seen.lock().unwrap();
        assert_eq!(ticks.len(), 3);
        // First tick: half of a 300-byte transfer.
        assert_eq!(ticks[0].overall_percent, 50);
        assert_eq!(ticks[0].file_no, 1);
        assert_eq!(ticks[0].overall_known, true);
        // Second tick: file 1 done, still 100% of the total.
        assert_eq!(ticks[1].overall_percent, 100);
        assert_eq!(ticks[1].percent, 100);
        // Third tick: banking moves to file 2 without the total walking back.
        assert_eq!(ticks[2].file_no, 2);
        assert_eq!(ticks[2].transferred_bytes, 300);
        assert!(!ticks[0].rate.is_empty());
    }

    #[test]
    fn progress_without_totals_mirrors_the_file() {
        let seen: Arc<Mutex<Vec<TransferProgress>>> = Arc::new(Mutex::new(Vec::new()));
        let sink_seen = seen.clone();
        let ctx = ctx_with_sink(Arc::new(move |p| sink_seen.lock().unwrap().push(p)));
        ctx.report("only.bin", 40, 40);
        let ticks = seen.lock().unwrap();
        assert_eq!(ticks[0].overall_percent, 40);
        assert_eq!(ticks[0].overall_known, false);
        assert_eq!(ticks[0].total_files, 0);
    }

    #[test]
    fn cancel_only_answers_for_claimed_transfers() {
        let svc = SftpService::new();
        // Unknown id: nothing to cancel.
        assert!(!svc.cancel("nope"));
        // Claimed, then cancelled.
        svc.registry.claim("job-1");
        assert!(svc.cancel("job-1"));
        assert!(svc.registry.is_cancelled("job-1"));
        // Releasing clears the verdict so a retry of the same id starts clean.
        svc.registry.release("job-1");
        assert!(!svc.registry.is_cancelled("job-1"));
        assert!(!svc.cancel("job-1"));
    }

    #[test]
    fn upload_plan_merges_directories_and_honours_overrides() {
        let dir = std::env::temp_dir().join(format!("biosphere-plan-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("data/sub")).unwrap();
        std::fs::write(dir.join("data/a.txt"), b"aa").unwrap();
        std::fs::write(dir.join("data/sub/b.txt"), b"bbbb").unwrap();
        std::fs::write(dir.join("top.bin"), b"0123456789").unwrap();

        let plan = build_upload_plan(
            &[
                dir.join("data").to_string_lossy().to_string(),
                dir.join("top.bin").to_string_lossy().to_string(),
            ],
            "/srv",
            None,
        )
        .unwrap();
        let remotes: Vec<&str> = plan.iter().map(|f| f.remote.as_str()).collect();
        // The folder merges into /srv/data instead of nesting /srv/data/data.
        assert!(remotes.contains(&"/srv/data/a.txt"));
        assert!(remotes.contains(&"/srv/data/sub/b.txt"));
        assert!(remotes.contains(&"/srv/top.bin"));
        let sizes: Vec<u64> = plan.iter().map(|f| f.size).collect();
        assert!(sizes.contains(&2) && sizes.contains(&4) && sizes.contains(&10));

        // Name-clash override renames the incoming file only.
        let plan = build_upload_plan(
            &[dir.join("top.bin").to_string_lossy().to_string()],
            "/srv",
            Some(&["top (1).bin".to_string()]),
        )
        .unwrap();
        assert_eq!(plan[0].remote, "/srv/top (1).bin");
        assert_eq!(plan.len(), 1);

        let _ = std::fs::remove_dir_all(&dir);
    }
}
