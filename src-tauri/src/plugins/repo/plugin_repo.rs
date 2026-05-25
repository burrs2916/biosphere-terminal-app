use std::fs;
use std::path::PathBuf;

use crate::plugins::domain::plugin::{PluginManifest, PluginTool};

pub struct PluginRepo {
    plugins_dir: PathBuf,
}

impl PluginRepo {
    pub fn new(plugins_dir: PathBuf) -> Self {
        let _ = fs::create_dir_all(&plugins_dir);
        PluginRepo { plugins_dir }
    }

    pub fn list(&self) -> Result<Vec<PluginManifest>, String> {
        let mut plugins = Vec::new();
        let entries = fs::read_dir(&self.plugins_dir).map_err(|e| e.to_string())?;
        for entry in entries {
            let entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path();
            if path.is_dir() {
                let manifest_path = path.join("manifest.json");
                if manifest_path.exists() {
                    let content = fs::read_to_string(&manifest_path).map_err(|e| e.to_string())?;
                    let manifest: PluginManifest = serde_json::from_str(&content).map_err(|e| e.to_string())?;
                    plugins.push(manifest);
                }
            }
        }
        plugins.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(plugins)
    }

    pub fn get(&self, id: &str) -> Result<Option<PluginManifest>, String> {
        let manifest_path = self.plugins_dir.join(id).join("manifest.json");
        if !manifest_path.exists() {
            return Ok(None);
        }
        let content = fs::read_to_string(&manifest_path).map_err(|e| e.to_string())?;
        let manifest: PluginManifest = serde_json::from_str(&content).map_err(|e| e.to_string())?;
        Ok(Some(manifest))
    }

    pub fn save(&self, manifest: &PluginManifest) -> Result<(), String> {
        let plugin_dir = self.plugins_dir.join(&manifest.id);
        let _ = fs::create_dir_all(&plugin_dir);
        let manifest_path = plugin_dir.join("manifest.json");
        let content = serde_json::to_string_pretty(manifest).map_err(|e| e.to_string())?;
        fs::write(manifest_path, content).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn delete(&self, id: &str) -> Result<(), String> {
        let plugin_dir = self.plugins_dir.join(id);
        if plugin_dir.exists() {
            fs::remove_dir_all(plugin_dir).map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    pub fn list_enabled_tools(&self) -> Result<Vec<PluginTool>, String> {
        let plugins = self.list()?;
        let mut tools = Vec::new();
        for plugin in plugins {
            if plugin.enabled {
                for tool in plugin.tools {
                    tools.push(tool);
                }
            }
        }
        Ok(tools)
    }

    pub fn toggle(&self, id: &str, enabled: bool) -> Result<(), String> {
        let mut manifest = self.get(id)?
            .ok_or_else(|| format!("Plugin {} not found", id))?;
        manifest.enabled = enabled;
        manifest.updated_at = now_ms();
        self.save(&manifest)
    }
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}
