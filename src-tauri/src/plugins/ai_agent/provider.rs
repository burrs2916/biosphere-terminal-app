#![allow(dead_code)]

use async_trait::async_trait;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_calls: Option<Vec<ToolCall>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCall {
    pub id: String,
    #[serde(rename = "type")]
    pub call_type: String,
    pub function: FunctionCall,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FunctionCall {
    pub name: String,
    pub arguments: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatOptions {
    pub model: String,
    pub temperature: f64,
    pub max_tokens: i64,
    pub tools: Option<Vec<ToolDefinition>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolDefinition {
    #[serde(rename = "type")]
    pub def_type: String,
    pub function: ToolFunctionDef,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolFunctionDef {
    pub name: String,
    pub description: String,
    pub parameters: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatResponse {
    pub role: String,
    pub content: Option<String>,
    pub tool_calls: Option<Vec<ToolCall>>,
    pub finish_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatChunk {
    pub content: Option<String>,
    pub tool_calls: Option<Vec<ToolCallDelta>>,
    pub finish_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCallDelta {
    pub index: i32,
    pub id: Option<String>,
    pub function: Option<FunctionCallDelta>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FunctionCallDelta {
    pub name: Option<String>,
    pub arguments: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderConfig {
    pub api_key: String,
    pub base_url: String,
    #[serde(default = "default_api_type")]
    pub api_type: String,
    #[serde(default = "default_auth_type")]
    pub auth_type: String,
    #[serde(default)]
    pub custom_auth_header: String,
}

fn default_api_type() -> String {
    "openai-completions".to_string()
}

fn default_auth_type() -> String {
    "bearer".to_string()
}

#[async_trait]
pub trait LlmProvider: Send + Sync {
    async fn chat(
        &self,
        messages: &[ChatMessage],
        options: &ChatOptions,
    ) -> Result<ChatResponse, String>;

    async fn chat_stream(
        &self,
        messages: &[ChatMessage],
        options: &ChatOptions,
    ) -> Result<Vec<ChatChunk>, String>;

    fn validate_config(&self, config: &ProviderConfig) -> Result<(), String>;
}
