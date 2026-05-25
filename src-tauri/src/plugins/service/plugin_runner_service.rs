use serde_json::Value;
use std::path::PathBuf;
use std::sync::Arc;

use crate::app::plugin_service::PluginService;
use crate::plugins::domain::plugin::PluginTool;
use crate::plugins::domain::usage_log::UsageLogEntry;
use crate::plugins::domain::ui_schema::UiSchema;
use crate::plugins::engine::executor::{execute_script, ExecutionContext, ExecutionSource, ExecutionResult};

pub fn truncate_str(s: &str, max_chars: usize) -> String {
    if s.chars().count() <= max_chars {
        s.to_string()
    } else {
        s.chars().take(max_chars).collect()
    }
}

pub struct PluginRunnerService {
    plugin_service: Arc<PluginService>,
}

impl PluginRunnerService {
    pub fn new(plugin_service: Arc<PluginService>) -> Self {
        PluginRunnerService { plugin_service }
    }

    pub async fn run_tool(
        &self,
        plugin_id: &str,
        tool_name: &str,
        params: Value,
        workspace_dir: Option<PathBuf>,
    ) -> Result<ExecutionResult, String> {
        let plugin = self.plugin_service.get_plugin(plugin_id)?
            .ok_or_else(|| format!("Plugin '{}' not found", plugin_id))?;

        if !plugin.enabled {
            return Err(format!("Plugin '{}' is disabled", plugin_id));
        }

        let tool = plugin.tools.iter()
            .find(|t| t.name == tool_name)
            .ok_or_else(|| format!("Tool '{}' not found in plugin '{}'", tool_name, plugin_id))?;

        let ctx = ExecutionContext {
            tool_name: tool.name.clone(),
            plugin_id: Some(plugin_id.to_string()),
            source: ExecutionSource::User,
        };

        let effective_workspace = workspace_dir.unwrap_or_else(|| {
            let data_dir = self.plugin_service.data_dir().join("workspaces").join(plugin_id);
            let _ = std::fs::create_dir_all(&data_dir);
            data_dir
        });

        let result = execute_script(&tool.script, &params, &ctx, &effective_workspace).await;

        self.log_execution(plugin_id, tool_name, &params, &result);

        Ok(result)
    }

    pub fn get_tool_ui_schema(&self, plugin_id: &str, tool_name: &str) -> Result<Option<Value>, String> {
        let plugin = self.plugin_service.get_plugin(plugin_id)?
            .ok_or_else(|| format!("Plugin '{}' not found", plugin_id))?;

        let tool = plugin.tools.iter()
            .find(|t| t.name == tool_name)
            .ok_or_else(|| format!("Tool '{}' not found in plugin '{}'", tool_name, plugin_id))?;

        if let Some(ref ui_schema) = tool.ui_schema {
            Ok(Some(serde_json::to_value(ui_schema).map_err(|e| e.to_string())?))
        } else if !tool.parameters.is_empty() {
            let generated = UiSchema::from_tool_parameters(&tool.parameters);
            Ok(Some(serde_json::to_value(generated).map_err(|e| e.to_string())?))
        } else {
            Ok(None)
        }
    }

    #[allow(dead_code)]
    pub fn get_plugin_tools(&self, plugin_id: &str) -> Result<Vec<PluginTool>, String> {
        let plugin = self.plugin_service.get_plugin(plugin_id)?
            .ok_or_else(|| format!("Plugin '{}' not found", plugin_id))?;

        if !plugin.enabled {
            return Err(format!("Plugin '{}' is disabled", plugin_id));
        }

        Ok(plugin.tools)
    }

    fn log_execution(
        &self,
        plugin_id: &str,
        tool_name: &str,
        params: &Value,
        result: &ExecutionResult,
    ) {
        let output_summary = if !result.output.is_empty() {
            Some(result.output.clone())
        } else {
            None
        };

        let log_entry = UsageLogEntry {
            id: uuid::Uuid::new_v4().to_string(),
            plugin_id: plugin_id.to_string(),
            tool_name: tool_name.to_string(),
            params_summary: summarize_params(params),
            source: "user".to_string(),
            success: result.success,
            duration_ms: result.duration_ms,
            error_message: if result.success { None } else { Some(result.output.clone()) },
            output_summary,
            created_at: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as i64,
        };
        let _ = self.plugin_service.log_usage(&log_entry);
    }
}

pub fn summarize_params(params: &Value) -> String {
    if let Some(obj) = params.as_object() {
        let parts: Vec<String> = obj.iter().map(|(k, v)| {
            let val_str = sanitize_param_value(v);
            format!("{}={}", k, val_str)
        }).collect();
        parts.join(", ")
    } else {
        String::from("non-object params")
    }
}

pub fn sanitize_param_value(v: &Value) -> String {
    match v {
        Value::String(s) => {
            let truncated = if s.chars().count() > 200 { format!("{}...", truncate_str(s, 200)) } else { s.clone() };
            let sanitized = truncated.replace('\n', "\\n").replace('\r', "\\r");
            format!("\"{}\"", sanitized)
        }
        Value::Number(n) => n.to_string(),
        Value::Bool(b) => b.to_string(),
        Value::Null => "null".to_string(),
        Value::Array(arr) => {
            if arr.len() > 5 {
                format!("[array:{}items]", arr.len())
            } else {
                let items: Vec<String> = arr.iter().map(|item| sanitize_param_value(item)).collect();
                format!("[{}]", items.join(", "))
            }
        }
        Value::Object(_) => "[object]".to_string(),
    }
}
