use crate::core::types::PluginManifest;

#[tauri::command]
pub fn list_plugins() -> Result<Vec<PluginManifest>, String> {
    Ok(vec![])
}

#[tauri::command]
pub fn load_plugin(_plugin_id: String) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
pub fn unload_plugin(_plugin_id: String) -> Result<(), String> {
    Ok(())
}
