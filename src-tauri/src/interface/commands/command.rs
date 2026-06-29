use crate::app::command_service::CommandService;
use crate::core::types::{CommandHistoryEntry, CommandSnippet};
use crate::domain::command::executor::{CommandExecutor, ParsedCommandResult};
use crate::infra::storage::database::Database;
use tauri::State;
use std::sync::Arc;

#[tauri::command]
pub fn get_command_history(
    limit: Option<usize>,
    db: State<'_, Arc<Database>>,
) -> Result<Vec<CommandHistoryEntry>, String> {
    CommandService::get_history(&db, limit.unwrap_or(100)).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_command_history(
    entry: CommandHistoryEntry,
    db: State<'_, Arc<Database>>,
) -> Result<(), String> {
    CommandService::save_history(&db, &entry).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn search_command_history(
    query: String,
    db: State<'_, Arc<Database>>,
) -> Result<Vec<CommandHistoryEntry>, String> {
    CommandService::search_history(&db, &query).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_snippets(
    db: State<'_, Arc<Database>>,
) -> Result<Vec<CommandSnippet>, String> {
    CommandService::list_snippets(&db).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_snippet(
    snippet: CommandSnippet,
    db: State<'_, Arc<Database>>,
) -> Result<(), String> {
    CommandService::save_snippet(&db, &snippet).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_snippet(
    id: String,
    db: State<'_, Arc<Database>>,
) -> Result<(), String> {
    CommandService::delete_snippet(&db, &id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn parse_command(
    command: String,
    session_id: Option<String>,
    cwd: Option<String>,
    executor: State<'_, Arc<CommandExecutor>>,
) -> Result<ParsedCommandResult, String> {
    executor
        .parse_and_record(&command, session_id.as_deref(), cwd.as_deref().unwrap_or("/"))
        .map_err(|e| e.to_string())
}

/// 只解析命令，不写入历史（用于命令面板预览）
#[tauri::command]
pub fn parse_command_only(
    command: String,
    executor: State<'_, Arc<CommandExecutor>>,
) -> Result<ParsedCommandResult, String> {
    executor
        .parse_only(&command)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn record_exit_code(
    entry_id: String,
    exit_code: i32,
    executor: State<'_, Arc<CommandExecutor>>,
) -> Result<(), String> {
    executor
        .record_exit_code(&entry_id, exit_code)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_command_history(
    id: String,
    db: State<'_, Arc<Database>>,
) -> Result<(), String> {
    CommandService::delete_history(&db, &id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn clear_command_history(
    db: State<'_, Arc<Database>>,
) -> Result<(), String> {
    CommandService::clear_history(&db).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_command_history_batch(
    ids: Vec<String>,
    db: State<'_, Arc<Database>>,
) -> Result<(), String> {
    CommandService::delete_many(&db, &ids).map_err(|e| e.to_string())
}
