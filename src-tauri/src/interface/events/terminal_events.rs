use tauri::Emitter;

pub fn emit_terminal_output(app_handle: &tauri::AppHandle, session_id: &str, data: &str) {
    let _ = app_handle.emit("terminal-output", serde_json::json!({
        "session_id": session_id,
        "data": data,
    }));
}

pub fn emit_terminal_closed(app_handle: &tauri::AppHandle, session_id: &str, exit_code: Option<i32>) {
    let _ = app_handle.emit("terminal-closed", serde_json::json!({
        "session_id": session_id,
        "exit_code": exit_code,
    }));
}

pub fn emit_terminal_error(app_handle: &tauri::AppHandle, session_id: &str, error: &str) {
    let _ = app_handle.emit("terminal-error", serde_json::json!({
        "session_id": session_id,
        "error": error,
    }));
}
