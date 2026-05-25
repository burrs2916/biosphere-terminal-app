use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageLogEntry {
    pub id: String,
    pub plugin_id: String,
    pub tool_name: String,
    #[serde(default)]
    pub params_summary: String,
    #[serde(default = "default_source")]
    pub source: String,
    pub success: bool,
    #[serde(default)]
    pub duration_ms: i64,
    #[serde(default)]
    pub error_message: Option<String>,
    #[serde(default)]
    pub output_summary: Option<String>,
    pub created_at: i64,
}

fn default_source() -> String {
    "ai_agent".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionMetrics {
    pub plugin_id: String,
    pub total_executions: i64,
    pub success_count: i64,
    pub fail_count: i64,
    pub avg_duration_ms: f64,
    pub last_executed_at: i64,
}

impl ExecutionMetrics {
    pub fn fail_rate(&self) -> f64 {
        if self.total_executions == 0 {
            0.0
        } else {
            self.fail_count as f64 / self.total_executions as f64
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RefineSuggestion {
    pub plugin_id: String,
    pub fail_rate: f64,
    pub recent_fail_count: usize,
    pub common_errors: Vec<String>,
    pub suggested_action: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FixRecipe {
    pub error_type: FixErrorType,
    pub tool_name: String,
    pub description: String,
    pub confidence: f64,
    pub patch: FixPatch,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub enum FixErrorType {
    MissingDependency,
    SyntaxError,
    FileNotFound,
    PermissionDenied,
    Timeout,
    NetworkError,
    RuntimeError,
    OutputPathError,
    UnknownError,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FixPatch {
    pub patch_type: FixPatchType,
    pub tool_name: String,
    pub new_script: Option<String>,
    pub new_parameters: Option<Vec<ToolParameterPatch>>,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FixPatchType {
    ScriptReplace,
    ScriptPrefix,
    ParameterAdd,
    ParameterModify,
    ManualReview,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolParameterPatch {
    pub name: String,
    pub action: ParameterPatchAction,
    #[serde(default)]
    pub default_value: Option<serde_json::Value>,
    #[serde(default)]
    pub ui_widget: Option<String>,
    #[serde(default)]
    pub ui_label: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ParameterPatchAction {
    Add,
    Modify,
    Remove,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StructuredRefineResult {
    pub plugin_id: String,
    pub fail_rate: f64,
    pub total_executions: i64,
    pub recipes: Vec<FixRecipe>,
    pub health_status: PluginHealthStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PluginHealthStatus {
    Healthy,
    Degraded,
    Failed,
}
