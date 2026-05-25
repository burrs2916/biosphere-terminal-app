use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangelogEntry {
    pub version: String,
    pub date: i64,
    pub changes: Vec<String>,
    #[serde(default)]
    pub tool_changes: Vec<ToolChange>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolChange {
    pub tool_name: String,
    pub field: String,
    pub before: String,
    pub after: String,
}
