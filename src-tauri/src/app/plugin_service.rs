#![allow(dead_code)]

use std::path::PathBuf;
use std::sync::Arc;

use crate::plugins::domain::plugin::{PluginManifest, PluginTool};
use crate::plugins::domain::usage_log::UsageLogEntry;
use crate::plugins::repo::plugin_repo::PluginRepo;
use crate::plugins::repo::usage_log_repo::UsageLogRepo;
use crate::infra::storage::agent_repo::{PluginGroupRepo, PluginGroupRow, PluginCategoryRepo, PluginCategoryRow};
use crate::infra::storage::database::Database;

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

pub struct PluginService {
    data_dir: PathBuf,
    plugin_repo: PluginRepo,
    usage_log_repo: UsageLogRepo,
    db: Arc<Database>,
}

impl PluginService {
    pub fn new(data_dir: PathBuf, db: Arc<Database>) -> Self {
        let plugins_dir = data_dir.join("plugins");
        let plugin_repo = PluginRepo::new(plugins_dir);
        let usage_log_repo = UsageLogRepo::new(db.clone());
        let _ = usage_log_repo.ensure_table();
        let service = PluginService { data_dir, plugin_repo, usage_log_repo, db };
        let _ = service.ensure_default_groups();
        service
    }

    pub fn data_dir(&self) -> &PathBuf {
        &self.data_dir
    }

    pub fn list_plugins(&self) -> Result<Vec<PluginManifest>, String> {
        self.plugin_repo.list()
    }

    pub fn get_plugin(&self, id: &str) -> Result<Option<PluginManifest>, String> {
        self.plugin_repo.get(id)
    }

    pub fn save_plugin(&self, manifest: &PluginManifest) -> Result<(), String> {
        self.plugin_repo.save(manifest)
    }

    pub fn delete_plugin(&self, id: &str) -> Result<(), String> {
        self.plugin_repo.delete(id)
    }

    pub fn toggle_plugin(&self, id: &str, enabled: bool) -> Result<(), String> {
        self.plugin_repo.toggle(id, enabled)
    }

    pub fn list_enabled_tools(&self) -> Result<Vec<PluginTool>, String> {
        self.plugin_repo.list_enabled_tools()
    }

    pub fn find_enabled_tool(&self, tool_name: &str) -> Result<Option<(String, PluginTool)>, String> {
        let plugins = self.plugin_repo.list()?;
        for plugin in plugins {
            if plugin.enabled {
                if let Some(tool) = plugin.tools.into_iter().find(|t| t.name == tool_name) {
                    return Ok(Some((plugin.id, tool)));
                }
            }
        }
        Ok(None)
    }

    pub fn log_usage(&self, entry: &UsageLogEntry) -> Result<(), String> {
        self.usage_log_repo.insert(entry)
    }

    pub fn get_usage_metrics(&self, plugin_id: &str) -> Result<crate::plugins::domain::usage_log::ExecutionMetrics, String> {
        self.usage_log_repo.get_metrics(plugin_id)
    }

    pub fn list_usage_logs(&self, plugin_id: &str, limit: i64) -> Result<Vec<UsageLogEntry>, String> {
        self.usage_log_repo.list_by_plugin(plugin_id, limit)
    }

    pub fn get_recent_fail_count(&self, plugin_id: &str, since_ms: i64) -> Result<usize, String> {
        self.usage_log_repo.get_recent_fail_count(plugin_id, since_ms)
    }

    pub fn get_common_errors(&self, plugin_id: &str, limit: i64) -> Result<Vec<String>, String> {
        self.usage_log_repo.get_common_errors(plugin_id, limit)
    }

    pub fn clear_usage_logs(&self, plugin_id: &str) -> Result<usize, String> {
        self.usage_log_repo.clear_by_plugin(plugin_id)
    }


    fn ensure_default_groups(&self) -> Result<(), String> {
        let existing = PluginGroupRepo::list(&self.db)?;
        if !existing.is_empty() {
            return Ok(());
        }

        let defaults = vec![
            ("network", "网络服务", "🌐", "#4FC3F7"),
            ("dev", "开发工具", "🛠️", "#81C784"),
            ("data", "数据分析", "📊", "#FFD740"),
            ("creative", "创意工具", "🎨", "#CE93D8"),
            ("utility", "实用工具", "🔧", "#FF8A65"),
        ];

        let now = now_ms();
        for (idx, (id, name, icon, color)) in defaults.iter().enumerate() {
            let group = PluginGroupRow {
                id: id.to_string(),
                name: name.to_string(),
                icon: icon.to_string(),
                color: color.to_string(),
                sort_order: idx as i64,
                plugin_count: 0,
                created_at: now,
                updated_at: now,
            };
            PluginGroupRepo::save(&self.db, &group)?;

            let default_cat = PluginCategoryRow {
                id: format!("{}-default", id),
                name: "通用".to_string(),
                group_id: id.to_string(),
                is_default: true,
                sort_order: 0,
                created_at: now,
                updated_at: now,
            };
            PluginCategoryRepo::save(&self.db, &default_cat)?;
        }
        Ok(())
    }

    pub fn list_plugin_groups(&self) -> Result<Vec<PluginGroupRow>, String> {
        let mut groups = PluginGroupRepo::list(&self.db)?;
        let plugins = self.list_plugins()?;
        for group in &mut groups {
            group.plugin_count = plugins.iter().filter(|p| p.group_id == group.id).count() as i64;
        }
        Ok(groups)
    }

    pub fn create_plugin_group(&self, id: String, name: String, icon: String, color: String, sort_order: i64) -> Result<PluginGroupRow, String> {
        let now = now_ms();
        let group = PluginGroupRow {
            id,
            name,
            icon,
            color,
            sort_order,
            created_at: now,
            updated_at: now,
            plugin_count: 0,
        };
        PluginGroupRepo::save(&self.db, &group)?;
        Ok(group)
    }

    pub fn update_plugin_group(&self, id: String, name: String, icon: String, color: String, sort_order: i64) -> Result<PluginGroupRow, String> {
        let mut group = PluginGroupRepo::get(&self.db, &id)?
            .ok_or_else(|| format!("Group '{}' not found", id))?;
        group.name = name;
        group.icon = icon;
        group.color = color;
        group.sort_order = sort_order;
        group.updated_at = now_ms();
        PluginGroupRepo::save(&self.db, &group)?;
        Ok(group)
    }

    pub fn delete_plugin_group(&self, id: &str) -> Result<(), String> {
        if let Ok(categories) = PluginCategoryRepo::list_by_group(&self.db, id) {
            for cat in &categories {
                let _ = PluginCategoryRepo::delete(&self.db, &cat.id);
            }
        }
        PluginGroupRepo::delete(&self.db, id)
    }

    pub fn list_plugin_categories(&self, group_id: &str) -> Result<Vec<PluginCategoryRow>, String> {
        PluginCategoryRepo::list_by_group(&self.db, group_id)
    }

    pub fn create_plugin_category(&self, id: String, name: String, group_id: String, sort_order: i64) -> Result<PluginCategoryRow, String> {
        let now = now_ms();
        let cat = PluginCategoryRow {
            id,
            name,
            group_id,
            is_default: false,
            sort_order,
            created_at: now,
            updated_at: now,
        };
        PluginCategoryRepo::save(&self.db, &cat)?;
        Ok(cat)
    }

    pub fn update_plugin_category(&self, id: String, name: String, sort_order: i64) -> Result<PluginCategoryRow, String> {
        let groups = PluginGroupRepo::list(&self.db)?;
        let mut found: Option<PluginCategoryRow> = None;
        for g in &groups {
            let cats = PluginCategoryRepo::list_by_group(&self.db, &g.id)?;
            if let Some(c) = cats.iter().find(|c| c.id == id) {
                found = Some(c.clone());
                break;
            }
        }
        let mut cat = found.ok_or_else(|| format!("Category '{}' not found", id))?;
        cat.name = name;
        cat.sort_order = sort_order;
        cat.updated_at = now_ms();
        PluginCategoryRepo::save(&self.db, &cat)?;
        Ok(cat)
    }

    pub fn delete_plugin_category(&self, id: &str) -> Result<(), String> {
        let groups = PluginGroupRepo::list(&self.db)?;
        for g in &groups {
            let cats = PluginCategoryRepo::list_by_group(&self.db, &g.id)?;
            if let Some(cat) = cats.iter().find(|c| c.id == id) {
                if cat.is_default {
                    return Err("Cannot delete a default category".to_string());
                }
                break;
            }
        }
        PluginCategoryRepo::delete(&self.db, id)
    }

    pub fn cleanup_empty_groups_and_categories(&self) -> Result<(), String> {
        let plugins = self.list_plugins()?;
        let groups = PluginGroupRepo::list(&self.db)?;

        for group in &groups {
            let group_plugins: Vec<_> = plugins.iter().filter(|p| p.group_id == group.id).collect();
            if group_plugins.is_empty() {
                let categories = PluginCategoryRepo::list_by_group(&self.db, &group.id)?;
                for cat in &categories {
                    let _ = PluginCategoryRepo::delete(&self.db, &cat.id);
                }
                let _ = PluginGroupRepo::delete(&self.db, &group.id);
            }
        }

        let remaining = PluginGroupRepo::list(&self.db)?;
        if remaining.is_empty() {
            let _ = self.ensure_default_groups();
        }

        Ok(())
    }
}
