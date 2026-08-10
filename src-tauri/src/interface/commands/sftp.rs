use crate::app::sftp_service::{
    DirListing, ProgressCtx, RemoteItem, SftpListResult, SftpService, TransferProgress,
};
use crate::core::types::SshConnectionInfo;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};

/// Every SFTP command is declared `async` so Tauri runs it on a worker thread.
/// Without this a listing or a multi-gigabyte upload would block the main
/// thread and freeze the whole window.

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

#[tauri::command(async)]
pub fn sftp_list(
    ssh: SshConnectionInfo,
    path: String,
    service: State<'_, Arc<SftpService>>,
) -> Result<SftpListResult, String> {
    service.list_dir(&ssh, &path)
}

/// List several directories in one sftp session. The directory tree expands an
/// ancestor chain at once; batching the `ls` calls into a single process spawn
/// keeps a deep expansion from serialising N round trips behind the META lock.
#[tauri::command(async)]
pub fn sftp_list_many(
    ssh: SshConnectionInfo,
    paths: Vec<String>,
    service: State<'_, Arc<SftpService>>,
) -> Result<Vec<DirListing>, String> {
    service.list_dirs(&ssh, &paths)
}

/// `resume` continues an interrupted upload: only the bytes the far side is
/// still missing are sent. Absent (older front end) it defaults to a full send.
#[tauri::command(async)]
pub fn sftp_upload(
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
    service.upload(
        &ssh,
        &local_paths,
        &remote_dir,
        ctx.as_ref(),
        remote_names.as_deref(),
        resume.unwrap_or(false),
    )
}

#[tauri::command(async)]
pub fn sftp_download(
    app: AppHandle,
    ssh: SshConnectionInfo,
    items: Vec<RemoteItem>,
    local_dir: String,
    transfer_id: Option<String>,
    resume: Option<bool>,
    service: State<'_, Arc<SftpService>>,
) -> Result<(), String> {
    let ctx = progress_ctx(&app, transfer_id);
    service.download(
        &ssh,
        &items,
        &local_dir,
        ctx.as_ref(),
        resume.unwrap_or(false),
    )
}

#[tauri::command(async)]
pub fn sftp_remove(
    ssh: SshConnectionInfo,
    items: Vec<RemoteItem>,
    service: State<'_, Arc<SftpService>>,
) -> Result<(), String> {
    service.remove(&ssh, &items)
}

#[tauri::command(async)]
pub fn sftp_rename(
    ssh: SshConnectionInfo,
    from: String,
    to: String,
    service: State<'_, Arc<SftpService>>,
) -> Result<(), String> {
    service.rename(&ssh, &from, &to)
}

#[tauri::command(async)]
pub fn sftp_mkdir(
    ssh: SshConnectionInfo,
    remote_path: String,
    service: State<'_, Arc<SftpService>>,
) -> Result<(), String> {
    service.mkdir(&ssh, &remote_path)
}

/// Apply an octal permission mode to remote paths. POSIX-only in practice;
/// Windows servers reject the request and the error reaches the UI unchanged.
#[tauri::command(async)]
pub fn sftp_chmod(
    ssh: SshConnectionInfo,
    paths: Vec<String>,
    mode: String,
    service: State<'_, Arc<SftpService>>,
) -> Result<(), String> {
    service.chmod(&ssh, &paths, &mode)
}

/// Abort a running upload/download. Returns false when the transfer already
/// finished, so the UI can drop a stale cancel silently.
#[tauri::command(async)]
pub fn sftp_cancel(transfer_id: String, service: State<'_, Arc<SftpService>>) -> Result<bool, String> {
    Ok(service.cancel(&transfer_id))
}

/// Drop the pooled SSH multiplex masters for this connection. Called when the
/// transfer window closes so no `ssh -M -N` process is left running.
#[tauri::command(async)]
pub fn sftp_disconnect(
    ssh: SshConnectionInfo,
    service: State<'_, Arc<SftpService>>,
) -> Result<(), String> {
    service.disconnect(&ssh);
    Ok(())
}
