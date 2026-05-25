use std::path::PathBuf;
use std::sync::Arc;
use tauri::State;
use serde_json::Value;

use crate::app::agent_service::AgentService;
use crate::app::plugin_service::PluginService;
use crate::plugins::domain::plugin::{PluginManifest, PluginTool};
use crate::plugins::domain::usage_log::UsageLogEntry;
use crate::plugins::engine::executor::ExecutionResult;
use crate::plugins::service::plugin_runner_service::PluginRunnerService;
use crate::plugins::service::usage_analytics_service::UsageAnalyticsService;
use crate::infra::storage::agent_repo::{PluginGroupRow, PluginCategoryRow};

#[tauri::command]
pub fn list_plugins(service: State<'_, Arc<PluginService>>) -> Result<Vec<PluginManifest>, String> {
    service.list_plugins()
}

#[tauri::command]
pub fn get_plugin(service: State<'_, Arc<PluginService>>, id: String) -> Result<Option<PluginManifest>, String> {
    service.get_plugin(&id)
}

#[tauri::command]
pub fn save_plugin(service: State<'_, Arc<PluginService>>, manifest: PluginManifest) -> Result<(), String> {
    service.save_plugin(&manifest)
}

#[tauri::command]
pub fn delete_plugin(
    service: State<'_, Arc<PluginService>>,
    agent_service: State<'_, Arc<AgentService>>,
    id: String,
) -> Result<(), String> {
    let plugin = service.get_plugin(&id)?;
    let tool_names: Vec<String> = plugin
        .as_ref()
        .map(|p| p.tools.iter().map(|t| t.name.clone()).collect())
        .unwrap_or_default();

    service.delete_plugin(&id)?;

    let mut agents = agent_service.list_agents()?;
    for agent in &mut agents {
        let before_len = agent.tool_ids.len();
        agent.tool_ids.retain(|t| !tool_names.contains(t));
        let before_allowed = agent.always_allowed_tools.len();
        agent.always_allowed_tools.retain(|t| !tool_names.contains(t));
        if agent.tool_ids.len() != before_len || agent.always_allowed_tools.len() != before_allowed {
            agent_service.save_agent(agent.clone())?;
        }
    }

    if let Err(e) = service.cleanup_empty_groups_and_categories() {
        tracing::warn!("[delete_plugin] cleanup_empty_groups failed: {}", e);
    }

    Ok(())
}

#[tauri::command]
pub fn toggle_plugin(service: State<'_, Arc<PluginService>>, id: String, enabled: bool) -> Result<(), String> {
    service.toggle_plugin(&id, enabled)
}

#[tauri::command]
pub fn list_plugin_tools(service: State<'_, Arc<PluginService>>) -> Result<Vec<PluginTool>, String> {
    service.list_enabled_tools()
}

#[tauri::command]
pub fn list_plugin_groups(service: State<'_, Arc<PluginService>>) -> Result<Vec<PluginGroupRow>, String> {
    service.list_plugin_groups()
}

#[tauri::command]
pub fn create_plugin_group(service: State<'_, Arc<PluginService>>, id: String, name: String, icon: String, color: String, sort_order: i64) -> Result<PluginGroupRow, String> {
    service.create_plugin_group(id, name, icon, color, sort_order)
}

#[tauri::command]
pub fn update_plugin_group(service: State<'_, Arc<PluginService>>, id: String, name: String, icon: String, color: String, sort_order: i64) -> Result<PluginGroupRow, String> {
    service.update_plugin_group(id, name, icon, color, sort_order)
}

#[tauri::command]
pub fn delete_plugin_group(service: State<'_, Arc<PluginService>>, id: String) -> Result<(), String> {
    service.delete_plugin_group(&id)
}

#[tauri::command]
pub fn list_plugin_categories(service: State<'_, Arc<PluginService>>, group_id: String) -> Result<Vec<PluginCategoryRow>, String> {
    service.list_plugin_categories(&group_id)
}

#[tauri::command]
pub fn create_plugin_category(service: State<'_, Arc<PluginService>>, id: String, name: String, group_id: String, sort_order: i64) -> Result<PluginCategoryRow, String> {
    service.create_plugin_category(id, name, group_id, sort_order)
}

#[tauri::command]
pub fn update_plugin_category(service: State<'_, Arc<PluginService>>, id: String, name: String, sort_order: i64) -> Result<PluginCategoryRow, String> {
    service.update_plugin_category(id, name, sort_order)
}

#[tauri::command]
pub fn delete_plugin_category(service: State<'_, Arc<PluginService>>, id: String) -> Result<(), String> {
    service.delete_plugin_category(&id)
}

#[tauri::command]
pub async fn run_plugin_tool(
    service: State<'_, Arc<PluginService>>,
    plugin_id: String,
    tool_name: String,
    params: Value,
    workspace_dir: Option<String>,
) -> Result<ExecutionResult, String> {
    let runner = PluginRunnerService::new(service.inner().clone());
    let ws = workspace_dir.map(PathBuf::from);
    runner.run_tool(&plugin_id, &tool_name, params, ws).await
}

#[tauri::command]
pub fn get_plugin_tool_ui_schema(
    service: State<'_, Arc<PluginService>>,
    plugin_id: String,
    tool_name: String,
) -> Result<Option<Value>, String> {
    let runner = PluginRunnerService::new(service.inner().clone());
    runner.get_tool_ui_schema(&plugin_id, &tool_name)
}

#[tauri::command]
pub fn get_plugin_usage_metrics(
    service: State<'_, Arc<PluginService>>,
    plugin_id: String,
) -> Result<crate::plugins::domain::usage_log::ExecutionMetrics, String> {
    let analytics = UsageAnalyticsService::new(service.inner().clone());
    analytics.get_plugin_metrics(&plugin_id)
}

#[tauri::command]
pub fn get_plugin_refine_suggestions(
    service: State<'_, Arc<PluginService>>,
    plugin_id: String,
) -> Result<Option<crate::plugins::domain::usage_log::RefineSuggestion>, String> {
    let analytics = UsageAnalyticsService::new(service.inner().clone());
    analytics.get_refine_suggestions(&plugin_id)
}

#[tauri::command]
pub fn get_plugin_structured_refine(
    service: State<'_, Arc<PluginService>>,
    plugin_id: String,
) -> Result<crate::plugins::domain::usage_log::StructuredRefineResult, String> {
    let analytics = UsageAnalyticsService::new(service.inner().clone());
    analytics.get_structured_refine(&plugin_id)
}

#[tauri::command]
pub fn list_plugin_usage_logs(
    service: State<'_, Arc<PluginService>>,
    plugin_id: String,
    limit: Option<i64>,
) -> Result<Vec<UsageLogEntry>, String> {
    service.list_usage_logs(&plugin_id, limit.unwrap_or(50))
}

#[tauri::command]
pub fn clear_plugin_usage_logs(
    service: State<'_, Arc<PluginService>>,
    plugin_id: String,
) -> Result<usize, String> {
    service.clear_usage_logs(&plugin_id)
}

#[tauri::command]
pub fn clear_usage_logs_before(
    service: State<'_, Arc<PluginService>>,
    before_ms: i64,
) -> Result<usize, String> {
    service.clear_usage_logs_before(before_ms)
}

#[tauri::command]
pub fn clear_failed_logs_before(
    service: State<'_, Arc<PluginService>>,
    before_ms: i64,
) -> Result<usize, String> {
    service.clear_failed_logs_before(before_ms)
}

#[tauri::command]
pub fn purge_all_usage_logs(
    service: State<'_, Arc<PluginService>>,
) -> Result<usize, String> {
    service.purge_all_usage_logs()
}

#[tauri::command]
pub fn count_plugin_usage_logs(
    service: State<'_, Arc<PluginService>>,
    plugin_id: String,
) -> Result<i64, String> {
    service.count_usage_logs(&plugin_id)
}

#[tauri::command]
pub fn count_all_usage_logs(
    service: State<'_, Arc<PluginService>>,
) -> Result<i64, String> {
    service.count_all_usage_logs()
}

#[tauri::command]
pub fn usage_logs_size_estimate(
    service: State<'_, Arc<PluginService>>,
) -> Result<i64, String> {
    service.usage_logs_size_estimate()
}

#[tauri::command]
pub fn export_plugin_usage_logs(
    service: State<'_, Arc<PluginService>>,
    plugin_id: String,
) -> Result<Vec<UsageLogEntry>, String> {
    service.export_usage_logs(&plugin_id)
}

#[tauri::command]
pub fn export_all_usage_logs(
    service: State<'_, Arc<PluginService>>,
) -> Result<Vec<UsageLogEntry>, String> {
    service.export_all_usage_logs()
}
