use crate::app::sftp_service::{
    DirListing, ProgressCtx, RemoteItem, SftpListResult, SftpService, TransferProgress,
};
use crate::core::types::SshConnectionInfo;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};

/// Every SFTP command body does blocking I/O (pty round trips, file reads,
/// child-process control), so it is dispatched through `spawn_blocking` on the
/// dedicated blocking pool.
///
/// Why not `#[tauri::command(async)] pub fn`: that form keeps the body on a
/// **tokio worker thread** for its whole duration. A stalled or slow handshake
/// (10-25s over a flaky link) pins workers; when the directory tree fires a
/// batch of `list_many`/`list` calls concurrently, the bounded worker pool
/// saturates, tokio can no longer drive IPC dispatch or event delivery, and the
/// whole app freezes (the "close button does not respond" symptom is the
/// onCloseRequested event failing to be delivered). The blocking pool is
/// separate from the async runtime and grows on demand, so a stuck sftp
/// handshake can never stall the event loop again.

fn progress_ctx(app: &AppHandle, transfer_id: Option<String>) -> Option<ProgressCtx> {
    let id = transfer_id?;
    let handle = app.clone();
    Some(ProgressCtx::new(
        id,
        Arc::new(move |p: TransferProgress| {
            let _ = handle.emit("sftp-progress", &p);
        }),
    ))
}

/// Tauri's sync-command error mapping turns panics into `Err` automatically,
/// but `spawn_blocking`'s `JoinError` is its own type — flatten it explicitly.
macro_rules! spawn_blocking_flatten {
    ($body:expr) => {
        tokio::task::spawn_blocking(move || $body)
            .await
            .map_err(|e| format!("SFTP 任务异常: {}", e))?
    };
}

#[tauri::command]
pub async fn sftp_list(
    ssh: SshConnectionInfo,
    path: String,
    service: State<'_, Arc<SftpService>>,
) -> Result<SftpListResult, String> {
    let svc = service.inner().clone();
    spawn_blocking_flatten!(svc.list_dir(&ssh, &path))
}

/// List several directories in one sftp session. The directory tree expands an
/// ancestor chain at once; batching the `ls` calls into a single process spawn
/// keeps a deep expansion from serialising N round trips behind the META lock.
#[tauri::command]
pub async fn sftp_list_many(
    ssh: SshConnectionInfo,
    paths: Vec<String>,
    service: State<'_, Arc<SftpService>>,
) -> Result<Vec<DirListing>, String> {
    let svc = service.inner().clone();
    spawn_blocking_flatten!(svc.list_dirs(&ssh, &paths))
}

/// `resume` continues an interrupted upload: only the bytes the far side is
/// still missing are sent. Absent (older front end) it defaults to a full send.
#[tauri::command]
pub async fn sftp_upload(
    app: AppHandle,
    ssh: SshConnectionInfo,
    local_paths: Vec<String>,
    remote_dir: String,
    transfer_id: Option<String>,
    remote_names: Option<Vec<String>>,
    resume: Option<bool>,
    service: State<'_, Arc<SftpService>>,
) -> Result<(), String> {
    let ctx = progress_ctx(&app, transfer_id);
    let svc = service.inner().clone();
    spawn_blocking_flatten!(svc.upload(
        &ssh,
        &local_paths,
        &remote_dir,
        ctx.as_ref(),
        remote_names.as_deref(),
        resume.unwrap_or(false),
    ))
}

#[tauri::command]
pub async fn sftp_download(
    app: AppHandle,
    ssh: SshConnectionInfo,
    items: Vec<RemoteItem>,
    local_dir: String,
    transfer_id: Option<String>,
    resume: Option<bool>,
    service: State<'_, Arc<SftpService>>,
) -> Result<(), String> {
    let ctx = progress_ctx(&app, transfer_id);
    let svc = service.inner().clone();
    spawn_blocking_flatten!(svc.download(
        &ssh,
        &items,
        &local_dir,
        ctx.as_ref(),
        resume.unwrap_or(false),
    ))
}

#[tauri::command]
pub async fn sftp_remove(
    ssh: SshConnectionInfo,
    items: Vec<RemoteItem>,
    service: State<'_, Arc<SftpService>>,
) -> Result<(), String> {
    let svc = service.inner().clone();
    spawn_blocking_flatten!(svc.remove(&ssh, &items))
}

#[tauri::command]
pub async fn sftp_rename(
    ssh: SshConnectionInfo,
    from: String,
    to: String,
    service: State<'_, Arc<SftpService>>,
) -> Result<(), String> {
    let svc = service.inner().clone();
    spawn_blocking_flatten!(svc.rename(&ssh, &from, &to))
}

#[tauri::command]
pub async fn sftp_mkdir(
    ssh: SshConnectionInfo,
    remote_path: String,
    service: State<'_, Arc<SftpService>>,
) -> Result<(), String> {
    let svc = service.inner().clone();
    spawn_blocking_flatten!(svc.mkdir(&ssh, &remote_path))
}

/// Apply an octal permission mode to remote paths. POSIX-only in practice;
/// Windows servers reject the request and the error reaches the UI unchanged.
#[tauri::command]
pub async fn sftp_chmod(
    ssh: SshConnectionInfo,
    paths: Vec<String>,
    mode: String,
    service: State<'_, Arc<SftpService>>,
) -> Result<(), String> {
    let svc = service.inner().clone();
    spawn_blocking_flatten!(svc.chmod(&ssh, &paths, &mode))
}

/// Abort a running upload/download. Returns false when the transfer already
/// finished, so the UI can drop a stale cancel silently.
#[tauri::command]
pub async fn sftp_cancel(
    transfer_id: String,
    service: State<'_, Arc<SftpService>>,
) -> Result<bool, String> {
    Ok(service.cancel(&transfer_id))
}

/// Drop the pooled SSH multiplex masters for this connection. Called when the
/// transfer window closes so no `ssh -M -N` process is left running.
#[tauri::command]
pub async fn sftp_disconnect(
    ssh: SshConnectionInfo,
    service: State<'_, Arc<SftpService>>,
) -> Result<(), String> {
    let svc = service.inner().clone();
    spawn_blocking_flatten!({
        svc.disconnect(&ssh);
        Ok(())
    })
}
