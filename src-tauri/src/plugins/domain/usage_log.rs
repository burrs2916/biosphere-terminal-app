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
