use crate::app::remote_desktop_service::{RemoteDesktopService, RemoteDesktopSession, VncSetupResult};
use crate::core::types::SshConnectionInfo;
use tauri::State;
use std::sync::Arc;

#[tauri::command]
pub async fn create_remote_desktop(
    session_id: String,
    ssh: SshConnectionInfo,
    vnc_port: Option<u16>,
    service: State<'_, Arc<RemoteDesktopService>>,
) -> Result<RemoteDesktopSession, String> {
    let port = vnc_port.unwrap_or(5900);
    service.create_session(&session_id, &ssh, port).await
}

#[tauri::command]
pub async fn close_remote_desktop(
    session_id: String,
    service: State<'_, Arc<RemoteDesktopService>>,
) -> Result<(), String> {
    service.close_session(&session_id).await
}

#[tauri::command]
pub async fn setup_remote_desktop(
    ssh: SshConnectionInfo,
    vnc_port: Option<u16>,
    service: State<'_, Arc<RemoteDesktopService>>,
) -> Result<VncSetupResult, String> {
    let port = vnc_port.unwrap_or(5900);
    service.setup_vnc(&ssh, port).await
}
