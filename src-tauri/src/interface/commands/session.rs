use crate::app::session_service::SessionService;
use crate::core::types::TerminalSession;
use crate::infra::storage::database::Database;
use tauri::State;
use std::sync::Arc;

#[tauri::command]
pub fn list_sessions(db: State<'_, Arc<Database>>) -> Result<Vec<TerminalSession>, String> {
    SessionService::list_sessions(&db).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_session(
    session: TerminalSession,
    db: State<'_, Arc<Database>>,
) -> Result<(), String> {
    SessionService::create_session(&db, &session).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_session(
    id: String,
    db: State<'_, Arc<Database>>,
) -> Result<(), String> {
    SessionService::delete_session(&db, &id).map_err(|e| e.to_string())
}
