use async_trait::async_trait;
use serde_json::{Value, json};
use std::path::PathBuf;
use std::sync::Arc;

use crate::app::plugin_service::PluginService;
use crate::plugins::domain::plugin::PluginTool as PluginToolDef;
use crate::plugins::domain::usage_log::UsageLogEntry;
use crate::plugins::engine::executor::{execute_script, ExecutionContext, ExecutionSource};
use crate::plugins::service::plugin_runner_service::summarize_params;
use super::engine::{AgentTool, ToolOutput};

pub struct PluginAgentTool {
    definition: PluginToolDef,
    workspace_dir: PathBuf,
    plugin_service: Option<Arc<PluginService>>,
    plugin_id: Option<String>,
}

impl PluginAgentTool {
    pub fn new(definition: PluginToolDef, workspace_dir: PathBuf) -> Self {
        let _ = std::fs::create_dir_all(&workspace_dir);
        PluginAgentTool { definition, workspace_dir, plugin_service: None, plugin_id: None }
    }

    pub fn with_logging(mut self, plugin_service: Arc<PluginService>, plugin_id: String) -> Self {
        self.plugin_service = Some(plugin_service);
        self.plugin_id = Some(plugin_id);
        self
    }

    fn build_parameters_schema(&self) -> Value {
        let mut properties = serde_json::Map::new();
        let mut required = Vec::new();

        for param in &self.definition.parameters {
            let mut prop = serde_json::Map::new();
            let json_type = match param.param_type.as_str() {
                "number" => "number",
                "boolean" => "boolean",
                "object" => "object",
                "array" => "array",
                _ => "string",
            };
            prop.insert("type".to_string(), json!(json_type));
            prop.insert("description".to_string(), json!(param.description));
            if let Some(default) = &param.default_value {
                prop.insert("default".to_string(), default.clone());
            }
            properties.insert(param.name.clone(), Value::Object(prop));
            if param.required {
                required.push(json!(param.name));
            }
        }

        json!({
            "type": "object",
            "properties": properties,
            "required": required,
        })
    }
}

#[async_trait]
impl AgentTool for PluginAgentTool {
    fn name(&self) -> &str {
        &self.definition.name
    }

    fn description(&self) -> &str {
        &self.definition.description
    }

    fn parameters(&self) -> Value {
        self.build_parameters_schema()
    }

    async fn execute(&self, params: Value) -> Result<ToolOutput, String> {
        let ctx = ExecutionContext {
            tool_name: self.definition.name.clone(),
            plugin_id: self.plugin_id.clone(),
            source: ExecutionSource::Agent,
        };

        let result = execute_script(
            &self.definition.script,
            &params,
            &ctx,
            &self.workspace_dir,
        )
        .await;

        if let (Some(svc), Some(pid)) = (&self.plugin_service, &self.plugin_id) {
            let output_summary = if !result.output.is_empty() {
                Some(result.output.clone())
            } else {
                None
            };

            let log_entry = UsageLogEntry {
                id: uuid::Uuid::new_v4().to_string(),
                plugin_id: pid.clone(),
                tool_name: self.definition.name.clone(),
                params_summary: summarize_params(&params),
                source: "ai_agent".to_string(),
                success: result.success,
                duration_ms: result.duration_ms,
                error_message: if result.success { None } else { Some(result.output.clone()) },
                output_summary,
                created_at: std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_millis() as i64,
            };
            let _ = svc.log_usage(&log_entry);
        }

        Ok(ToolOutput {
            success: result.success,
            result: result.output,
            metadata: result.metadata,
        })
    }
}
