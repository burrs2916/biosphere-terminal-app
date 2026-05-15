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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginManifest {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: String,
    pub tools: Vec<ToolDefinition>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolDefinition {
    pub name: String,
    pub description: String,
    pub parameters: Vec<ToolParameter>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolParameter {
    pub name: String,
    pub param_type: String,
    pub required: bool,
    pub description: String,
    pub default_value: Option<serde_json::Value>,
}
