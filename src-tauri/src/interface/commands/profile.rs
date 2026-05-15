use crate::app::profile_service::ProfileService;
use crate::core::types::TerminalProfile;
use crate::infra::storage::database::Database;
use tauri::State;
use std::sync::Arc;

#[tauri::command]
pub fn list_profiles(db: State<'_, Arc<Database>>) -> Result<Vec<TerminalProfile>, String> {
    ProfileService::list_profiles(&db).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_profile(
    profile: TerminalProfile,
    db: State<'_, Arc<Database>>,
) -> Result<(), String> {
    ProfileService::save_profile(&db, &profile).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_profile(
    id: String,
    db: State<'_, Arc<Database>>,
) -> Result<(), String> {
    ProfileService::delete_profile(&db, &id).map_err(|e| e.to_string())
}
