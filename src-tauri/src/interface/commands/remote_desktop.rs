use crate::app::ai_assist::VncDiagnosis;
use crate::app::remote_desktop_service::{RemoteDesktopService, RemoteDesktopSession, VncSetupResult};
use crate::core::types::SshConnectionInfo;
use crate::infra::logging::debug_log;
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
    debug_log::rd(
        "INFO",
        &session_id,
        "ready",
        "cmd.create_remote_desktop.enter",
        &format!(
            "session_id={} host={} port={} user={} auth={} vnc_port_arg={:?} vnc_port_effective={}",
            session_id, ssh.host, ssh.port, ssh.username, ssh.auth_method, vnc_port, port
        ),
    );

    let started = std::time::Instant::now();
    let result = service.create_session(&session_id, &ssh, port).await;

    match &result {
        Ok(session) => debug_log::rd(
            "INFO",
            &session_id,
            "ready",
            "cmd.create_remote_desktop.ok",
            &format!(
                "elapsed_ms={} ws_url={} local_port={} vnc_port={}",
                started.elapsed().as_millis(),
                session.ws_url,
                session.local_port,
                session.vnc_port
            ),
        ),
        Err(e) => debug_log::rd(
            "ERROR",
            &session_id,
            "ready",
            "cmd.create_remote_desktop.err",
            &format!("elapsed_ms={} error={}", started.elapsed().as_millis(), e),
        ),
    }

    result
}

#[tauri::command]
pub async fn close_remote_desktop(
    session_id: String,
    service: State<'_, Arc<RemoteDesktopService>>,
) -> Result<(), String> {
    debug_log::rd(
        "INFO",
        &session_id,
        "-",
        "cmd.close_remote_desktop.enter",
        &format!("session_id={}", session_id),
    );
    let result = service.close_session(&session_id).await;
    match &result {
        Ok(()) => debug_log::rd("INFO", &session_id, "-", "cmd.close_remote_desktop.ok", "closed"),
        Err(e) => debug_log::rd(
            "ERROR",
            &session_id,
            "-",
            "cmd.close_remote_desktop.err",
            &format!("error={}", e),
        ),
    }
    result
}

#[tauri::command]
pub async fn setup_remote_desktop(
    ssh: SshConnectionInfo,
    vnc_port: Option<u16>,
    run_id: Option<String>,
    service: State<'_, Arc<RemoteDesktopService>>,
) -> Result<VncSetupResult, String> {
    let port = vnc_port.unwrap_or(5900);
    // The run id is minted by the frontend guide so a whole multi-step session
    // (probe → install → password → start → connect) shares one correlation key.
    let run = run_id.unwrap_or_else(|| "-".to_string());

    debug_log::rd(
        "INFO",
        &run,
        "probe",
        "cmd.setup_remote_desktop.enter",
        &format!(
            "host={} port={} user={} auth={} vnc_port_arg={:?} vnc_port_effective={}",
            ssh.host, ssh.port, ssh.username, ssh.auth_method, vnc_port, port
        ),
    );

    let started = std::time::Instant::now();
    let result = service.setup_vnc_traced(&ssh, port, &run).await;

    match &result {
        Ok(r) => debug_log::rd(
            "INFO",
            &run,
            "probe",
            "cmd.setup_remote_desktop.ok",
            &format!(
                "elapsed_ms={} installed={} running={} vnc_port={} display={:?} needs_password={} os={}",
                started.elapsed().as_millis(),
                r.vnc_installed,
                r.vnc_running,
                r.vnc_port,
                r.display,
                r.needs_password,
                r.os_name
            ),
        ),
        Err(e) => debug_log::rd(
            "ERROR",
            &run,
            "probe",
            "cmd.setup_remote_desktop.err",
            &format!("elapsed_ms={} error={}", started.elapsed().as_millis(), e),
        ),
    }

    result
}

/// Bridge that lets the frontend setup guide append to the *same* debug.log as
/// the backend.
///
/// Without this, the guide's decision logic (which lives entirely in React —
/// phase transitions, branch selection, poll ticks, user clicks) would be
/// invisible on disk, and a bug report would only ever show the backend half of
/// a workflow whose misbehaviour is usually a frontend state-machine issue.
///
/// Secrets are redacted on the frontend before the call; this command never
/// receives raw passwords.
#[tauri::command]
pub fn append_remote_desktop_log(
    level: String,
    run_id: String,
    phase: String,
    event: String,
    detail: String,
) {
    let normalized = match level.to_ascii_uppercase().as_str() {
        "ERROR" => "ERROR",
        "WARN" => "WARN",
        "DEBUG" => "DEBUG",
        _ => "INFO",
    };
    debug_log::rd_frontend(normalized, &run_id, &phase, &event, &detail);
}

/// 诊断 VNC 安装过程中的错误，返回诊断结果和修复建议。
/// 纯同步函数，无需 Tauri State，直接调用 ai_assist 模块。
#[tauri::command]
pub fn diagnose_vnc_error(
    os_name: String,
    terminal_output: String,
    command_was: String,
) -> VncDiagnosis {
    crate::app::ai_assist::diagnose_vnc_error(&os_name, &terminal_output, &command_was)
}
