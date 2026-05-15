#![allow(dead_code)]

use tauri::Emitter;

pub fn emit_session_created(app_handle: &tauri::AppHandle, session_id: &str, name: &str) {
    let _ = app_handle.emit("session-created", serde_json::json!({
        "session_id": session_id,
        "name": name,
    }));
}

pub fn emit_session_closed(app_handle: &tauri::AppHandle, session_id: &str) {
    let _ = app_handle.emit("session-closed", serde_json::json!({
        "session_id": session_id,
    }));
}
