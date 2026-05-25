#![allow(dead_code)]

use std::sync::Arc;
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

    async fn chat_stream_realtime(
        &self,
        messages: &[ChatMessage],
        options: &ChatOptions,
        on_chunk: Arc<dyn Fn(ChatChunk) + Send + Sync>,
    ) -> Result<ChatResponse, String> {
        let chunks = self.chat_stream(messages, options).await?;
        let mut full_content = String::new();
        let mut tool_calls_map: std::collections::BTreeMap<i32, (Option<String>, String, String)> = std::collections::BTreeMap::new();
        let mut finish_reason: Option<String> = None;

        for chunk in chunks {
            if let Some(content) = &chunk.content {
                if !content.is_empty() {
                    full_content.push_str(content);
                }
            }
            if let Some(tc_deltas) = &chunk.tool_calls {
                for delta in tc_deltas {
                    let entry = tool_calls_map
                        .entry(delta.index)
                        .or_insert((None, String::new(), String::new()));
                    if let Some(id) = &delta.id {
                        entry.0 = Some(id.clone());
                    }
                    if let Some(func) = &delta.function {
                        if let Some(name) = &func.name {
                            entry.1 = name.clone();
                        }
                        if let Some(args) = &func.arguments {
                            entry.2.push_str(args);
                        }
                    }
                }
            }
            if let Some(fr) = &chunk.finish_reason {
                finish_reason = Some(fr.clone());
            }
            on_chunk(chunk);
        }

        let tool_calls: Vec<ToolCall> = tool_calls_map
            .into_iter()
            .map(|(_, (id, name, arguments))| ToolCall {
                id: id.unwrap_or_default(),
                call_type: "function".to_string(),
                function: FunctionCall { name, arguments },
            })
            .collect();

        Ok(ChatResponse {
            role: "assistant".to_string(),
            content: if full_content.is_empty() { None } else { Some(full_content) },
            tool_calls: if tool_calls.is_empty() { None } else { Some(tool_calls) },
            finish_reason,
        })
    }

    fn validate_config(&self, config: &ProviderConfig) -> Result<(), String>;
}
