#![allow(dead_code)]

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolOutput {
    pub success: bool,
    pub result: String,
    #[serde(default)]
    pub metadata: Value,
}

#[async_trait]
pub trait AgentTool: Send + Sync {
    fn name(&self) -> &str;
    fn description(&self) -> &str;
    fn parameters(&self) -> Value;
    async fn execute(&self, params: Value) -> Result<ToolOutput, String>;
}

pub struct ToolRegistry {
    tools: HashMap<String, Arc<dyn AgentTool>>,
}

impl ToolRegistry {
    pub fn new() -> Self {
        ToolRegistry {
            tools: HashMap::new(),
        }
    }

    pub fn register(&mut self, tool: Arc<dyn AgentTool>) {
        self.tools.insert(tool.name().to_string(), tool);
    }

    pub fn get(&self, name: &str) -> Option<&Arc<dyn AgentTool>> {
        self.tools.get(name)
    }

    pub fn list_definitions(&self) -> Vec<super::provider::ToolDefinition> {
        self.tools.iter().map(|(_, tool)| {
            super::provider::ToolDefinition {
                def_type: "function".to_string(),
                function: super::provider::ToolFunctionDef {
                    name: tool.name().to_string(),
                    description: tool.description().to_string(),
                    parameters: tool.parameters(),
                },
            }
        }).collect()
    }

    pub fn list_names(&self) -> Vec<String> {
        self.tools.keys().cloned().collect()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCallEvent {
    pub tool_name: String,
    pub arguments: Value,
    pub result: Option<String>,
    pub success: Option<bool>,
    pub status: String,
}

pub struct AgentEngine {
    provider: Arc<dyn super::provider::LlmProvider>,
    tools: Arc<Mutex<ToolRegistry>>,
    model: String,
    system_prompt: String,
    temperature: f64,
    max_iterations: i32,
    max_tokens: i64,
}

impl AgentEngine {
    pub fn new(
        provider: Arc<dyn super::provider::LlmProvider>,
        tools: Arc<Mutex<ToolRegistry>>,
        model: String,
        system_prompt: String,
        temperature: f64,
        max_iterations: i32,
    ) -> Self {
        AgentEngine {
            provider,
            tools,
            model,
            system_prompt,
            temperature,
            max_iterations,
            max_tokens: 4096,
        }
    }

    pub async fn run(
        &self,
        user_message: &str,
        history: Vec<super::provider::ChatMessage>,
        on_chunk: impl Fn(String),
        on_tool_call: impl Fn(ToolCallEvent),
    ) -> Result<String, String> {
        let mut messages: Vec<super::provider::ChatMessage> = Vec::new();

        messages.push(super::provider::ChatMessage {
            role: "system".to_string(),
            content: self.system_prompt.clone(),
            tool_calls: None,
            tool_call_id: None,
        });

        for msg in history {
            if msg.role == "system" {
                continue;
            }
            messages.push(msg);
        }

        messages.push(super::provider::ChatMessage {
            role: "user".to_string(),
            content: user_message.to_string(),
            tool_calls: None,
            tool_call_id: None,
        });

        let tool_defs = {
            let tools = self.tools.lock().await;
            tools.list_definitions()
        };

        let tools_opt = if tool_defs.is_empty() { None } else { Some(tool_defs) };

        for iteration in 0..self.max_iterations {
            let options = super::provider::ChatOptions {
                model: self.model.clone(),
                temperature: self.temperature,
                max_tokens: self.max_tokens,
                tools: tools_opt.clone(),
            };

            let use_stream = true;
            let response = if use_stream {
                self.chat_stream_collect(&messages, &options, &on_chunk).await?
            } else {
                self.provider.chat(&messages, &options).await?
            };

            let assistant_msg = super::provider::ChatMessage {
                role: "assistant".to_string(),
                content: response.content.clone().unwrap_or_default(),
                tool_calls: response.tool_calls.clone(),
                tool_call_id: None,
            };
            messages.push(assistant_msg);

            match &response.tool_calls {
                Some(tool_calls) if !tool_calls.is_empty() => {
                    for tc in tool_calls {
                        let tool_name = &tc.function.name;
                        let args: Value = serde_json::from_str(&tc.function.arguments)
                            .unwrap_or(Value::Null);

                        on_tool_call(ToolCallEvent {
                            tool_name: tool_name.clone(),
                            arguments: args.clone(),
                            result: None,
                            success: None,
                            status: "running".to_string(),
                        });

                        let tool_result = {
                            let tools = self.tools.lock().await;
                            if let Some(tool) = tools.get(tool_name) {
                                tool.execute(args).await.unwrap_or_else(|e| ToolOutput {
                                    success: false,
                                    result: format!("Error: {}", e),
                                    metadata: Value::Null,
                                })
                            } else {
                                ToolOutput {
                                    success: false,
                                    result: format!("Tool '{}' not found", tool_name),
                                    metadata: Value::Null,
                                }
                            }
                        };

                        on_tool_call(ToolCallEvent {
                            tool_name: tool_name.clone(),
                            arguments: Value::Null,
                            result: Some(tool_result.result.clone()),
                            success: Some(tool_result.success),
                            status: "done".to_string(),
                        });

                        messages.push(super::provider::ChatMessage {
                            role: "tool".to_string(),
                            content: tool_result.result,
                            tool_calls: None,
                            tool_call_id: Some(tc.id.clone()),
                        });
                    }
                }
                _ => {
                    break;
                }
            }

            if iteration >= self.max_iterations - 1 {
                on_chunk("\n[Max iterations reached]\n".to_string());
                break;
            }
        }

        let last_content = messages.iter()
            .rev()
            .find(|m| m.role == "assistant")
            .and_then(|m| if m.content.is_empty() { None } else { Some(m.content.clone()) })
            .unwrap_or_else(|| "No response".to_string());

        Ok(last_content)
    }

    async fn chat_stream_collect(
        &self,
        messages: &[super::provider::ChatMessage],
        options: &super::provider::ChatOptions,
        on_chunk: &impl Fn(String),
    ) -> Result<super::provider::ChatResponse, String> {
        let chunks = self.provider.chat_stream(messages, options).await?;

        let mut full_content = String::new();
        let mut tool_calls_map: std::collections::BTreeMap<i32, (Option<String>, String, String)> = std::collections::BTreeMap::new();
        let mut finish_reason: Option<String> = None;

        for chunk in chunks {
            if let Some(content) = &chunk.content {
                if !content.is_empty() {
                    on_chunk(content.clone());
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
        }

        let tool_calls: Vec<super::provider::ToolCall> = tool_calls_map
            .into_iter()
            .map(|(_, (id, name, arguments))| super::provider::ToolCall {
                id: id.unwrap_or_default(),
                call_type: "function".to_string(),
                function: super::provider::FunctionCall {
                    name,
                    arguments,
                },
            })
            .collect();

        let has_content = !full_content.is_empty();
        let has_tool_calls = !tool_calls.is_empty();

        Ok(super::provider::ChatResponse {
            role: "assistant".to_string(),
            content: if has_content { Some(full_content) } else { None },
            tool_calls: if has_tool_calls { Some(tool_calls) } else { None },
            finish_reason,
        })
    }
}
