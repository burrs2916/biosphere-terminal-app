use crate::app::terminal_service::TerminalService;
use crate::core::types::PtyConfig;
use tauri::{Emitter, State};
use std::sync::Arc;

#[tauri::command]
pub fn spawn_terminal(
    session_id: String,
    config: PtyConfig,
    terminal_service: State<'_, Arc<TerminalService>>,
) -> Result<(), String> {
    terminal_service.spawn(&session_id, &config).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn write_to_terminal(
    session_id: String,
    data: Vec<u8>,
    terminal_service: State<'_, Arc<TerminalService>>,
) -> Result<usize, String> {
    terminal_service.write(&session_id, &data).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn kill_terminal(
    session_id: String,
    terminal_service: State<'_, Arc<TerminalService>>,
) -> Result<(), String> {
    terminal_service.kill(&session_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn resize_terminal(
    session_id: String,
    rows: u16,
    cols: u16,
    terminal_service: State<'_, Arc<TerminalService>>,
) -> Result<(), String> {
    terminal_service.resize(&session_id, rows, cols).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn relay_execute_command(
    command: String,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    app_handle.emit("execute-command", serde_json::json!({
        "command": command,
    })).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_terminal_cwd(
    session_id: String,
    terminal_service: State<'_, Arc<TerminalService>>,
) -> Result<Option<String>, String> {
    terminal_service.get_cwd(&session_id).map_err(|e| e.to_string())
}
