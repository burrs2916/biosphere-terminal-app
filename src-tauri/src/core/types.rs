#![allow(dead_code)]

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalSession {
    pub id: String,
    pub name: String,
    pub profile_id: Option<String>,
    pub cwd: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PtyConfig {
    pub rows: u16,
    pub cols: u16,
    pub shell: Option<String>,
    pub cwd: Option<String>,
    pub env: Option<std::collections::HashMap<String, String>>,
    pub connection_type: Option<String>,
    pub ssh: Option<SshConnectionInfo>,
    pub x11_forwarding: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalSize {
    pub rows: u16,
    pub cols: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkedNoteInfo {
    pub link_id: String,
    pub note_id: String,
    pub title: String,
    pub category: String,
    pub group_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommandHistoryEntry {
    pub id: String,
    pub session_id: Option<String>,
    pub command: String,
    pub cwd: String,
    pub exit_code: Option<i32>,
    pub executed_at: i64,
    #[serde(default)]
    pub linked: bool,
    #[serde(default)]
    pub linked_notes: Vec<LinkedNoteInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommandSnippet {
    pub id: String,
    pub name: String,
    pub command: String,
    pub description: String,
    pub tags: Vec<String>,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalProfile {
    pub id: String,
    pub name: String,
    pub config_json: String,
    pub is_default: bool,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionConfig {
    pub id: String,
    pub name: String,
    pub connection_type: String,
    pub config_json: String,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SshConnectionInfo {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth_method: String,
    pub private_key_path: Option<String>,
    pub password: Option<String>,
}

#[allow(unused_imports)]
pub use crate::plugins::domain::plugin::PluginManifest;
#[allow(unused_imports)]
pub use crate::plugins::domain::plugin::PluginTool;
#[allow(unused_imports)]
pub use crate::plugins::domain::plugin::ToolParameter;
#[allow(unused_imports)]
pub use crate::plugins::domain::plugin::PluginScenario;
#[allow(unused_imports)]
pub use crate::plugins::domain::changelog::ChangelogEntry;
#[allow(unused_imports)]
pub use crate::plugins::domain::changelog::ToolChange;
#[allow(unused_imports)]
pub use crate::plugins::domain::ui_schema::UiSchema;
#[allow(unused_imports)]
pub use crate::plugins::domain::ui_schema::UiField;
#[allow(unused_imports)]
pub use crate::plugins::domain::ui_schema::QuickAction;
#[allow(unused_imports)]
pub use crate::plugins::domain::ui_schema::ResultViewSpec;
#[allow(unused_imports)]
pub use crate::plugins::domain::ui_schema::TableColumn;
#[allow(unused_imports)]
pub use crate::plugins::domain::usage_log::UsageLogEntry;
#[allow(unused_imports)]
pub use crate::plugins::domain::usage_log::ExecutionMetrics;
