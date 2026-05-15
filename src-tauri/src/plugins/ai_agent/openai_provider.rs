#![allow(dead_code)]

use async_trait::async_trait;
use serde_json::Value;

use super::provider::{ChatMessage, ChatOptions, ChatResponse, ProviderConfig, LlmProvider};

pub struct OpenAiCompatProvider {
    config: ProviderConfig,
    client: reqwest::Client,
}

impl OpenAiCompatProvider {
    pub fn new(config: ProviderConfig) -> Self {
        OpenAiCompatProvider {
            config,
            client: reqwest::Client::new(),
        }
    }

    fn build_auth_header(&self) -> (String, String) {
        match self.config.auth_type.as_str() {
            "x-api-key" => ("x-api-key".to_string(), self.config.api_key.clone()),
            "custom" => {
                let header_name = if self.config.custom_auth_header.is_empty() {
                    "Authorization".to_string()
                } else {
                    self.config.custom_auth_header.clone()
                };
                (header_name, self.config.api_key.clone())
            }
            _ => ("Authorization".to_string(), format!("Bearer {}", self.config.api_key)),
        }
    }

    fn build_chat_url(&self) -> String {
        let base = self.config.base_url.trim_end_matches('/');
        match self.config.api_type.as_str() {
            "anthropic-messages" => format!("{}/v1/messages", base),
            "openai-responses" => format!("{}/v1/responses", base),
            _ => format!("{}/chat/completions", base),
        }
    }

    fn build_chat_body(&self, messages: &[ChatMessage], options: &ChatOptions, stream: bool) -> Value {
        match self.config.api_type.as_str() {
            "anthropic-messages" => {
                let mut body = serde_json::json!({
                    "model": options.model,
                    "messages": messages.iter().filter(|m| m.role != "system").collect::<Vec<_>>(),
                    "max_tokens": options.max_tokens,
                    "stream": stream,
                });
                if options.temperature > 0.0 {
                    body["temperature"] = serde_json::to_value(options.temperature).unwrap_or_default();
                }
                let system_msg = messages.iter().find(|m| m.role == "system");
                if let Some(sys) = system_msg {
                    body["system"] = serde_json::Value::String(sys.content.clone());
                }
                if let Some(tools) = &options.tools {
                    body["tools"] = serde_json::to_value(
                        tools.iter().map(|t| serde_json::json!({
                            "name": t.function.name,
                            "description": t.function.description,
                            "input_schema": t.function.parameters,
                        })).collect::<Vec<_>>()
                    ).unwrap_or_default();
                }
                body
            }
            _ => {
                let mut body = serde_json::json!({
                    "model": options.model,
                    "messages": messages,
                    "temperature": options.temperature,
                    "max_tokens": options.max_tokens,
                    "stream": stream,
                });
                if let Some(tools) = &options.tools {
                    body["tools"] = serde_json::to_value(tools).unwrap_or_default();
                }
                body
            }
        }
    }

    fn parse_anthropic_response(&self, json: &Value) -> Result<ChatResponse, String> {
        let content_blocks = json["content"].as_array().ok_or("Invalid Anthropic response: missing content")?;
        let mut text_content = String::new();
        let mut tool_calls = Vec::new();

        for block in content_blocks {
            match block["type"].as_str() {
                Some("text") => {
                    if let Some(text) = block["text"].as_str() {
                        text_content.push_str(text);
                    }
                }
                Some("tool_use") => {
                    tool_calls.push(super::provider::ToolCall {
                        id: block["id"].as_str().unwrap_or("").to_string(),
                        call_type: "function".to_string(),
                        function: super::provider::FunctionCall {
                            name: block["name"].as_str().unwrap_or("").to_string(),
                            arguments: serde_json::to_string(&block["input"]).unwrap_or_else(|_| "{}".to_string()),
                        },
                    });
                }
                _ => {}
            }
        }

        let stop_reason = json["stop_reason"].as_str().map(|s| s.to_string());

        Ok(ChatResponse {
            role: "assistant".to_string(),
            content: if text_content.is_empty() { None } else { Some(text_content) },
            tool_calls: if tool_calls.is_empty() { None } else { Some(tool_calls) },
            finish_reason: stop_reason,
        })
    }

    fn parse_anthropic_chunk(&self, json: &Value) -> Option<super::provider::ChatChunk> {
        let event_type = json["type"].as_str()?;

        match event_type {
            "content_block_delta" => {
                let delta = &json["delta"];
                let delta_type = delta["type"].as_str().unwrap_or("");
                match delta_type {
                    "text_delta" => {
                        Some(super::provider::ChatChunk {
                            content: delta["text"].as_str().map(|s| s.to_string()),
                            tool_calls: None,
                            finish_reason: None,
                        })
                    }
                    "input_json_delta" => {
                        Some(super::provider::ChatChunk {
                            content: None,
                            tool_calls: Some(vec![super::provider::ToolCallDelta {
                                index: json["index"].as_i64().unwrap_or(0) as i32,
                                id: None,
                                function: Some(super::provider::FunctionCallDelta {
                                    name: None,
                                    arguments: delta["partial_json"].as_str().map(|s| s.to_string()),
                                }),
                            }]),
                            finish_reason: None,
                        })
                    }
                    _ => None
                }
            }
            "message_delta" => {
                let stop_reason = json["delta"]["stop_reason"].as_str().map(|s| s.to_string());
                Some(super::provider::ChatChunk {
                    content: None,
                    tool_calls: None,
                    finish_reason: stop_reason,
                })
            }
            "content_block_start" => {
                let content_block = &json["content_block"];
                if content_block["type"].as_str() == Some("tool_use") {
                    Some(super::provider::ChatChunk {
                        content: None,
                        tool_calls: Some(vec![super::provider::ToolCallDelta {
                            index: json["index"].as_i64().unwrap_or(0) as i32,
                            id: content_block["id"].as_str().map(|s| s.to_string()),
                            function: Some(super::provider::FunctionCallDelta {
                                name: content_block["name"].as_str().map(|s| s.to_string()),
                                arguments: None,
                            }),
                        }]),
                        finish_reason: None,
                    })
                } else {
                    None
                }
            }
            _ => None
        }
    }
}

#[async_trait]
impl LlmProvider for OpenAiCompatProvider {
    async fn chat(
        &self,
        messages: &[ChatMessage],
        options: &ChatOptions,
    ) -> Result<ChatResponse, String> {
        let url = self.build_chat_url();
        let body = self.build_chat_body(messages, options, false);
        let (auth_header_name, auth_header_value) = self.build_auth_header();

        let mut req = self.client
            .post(&url)
            .header(&auth_header_name, &auth_header_value)
            .header("Content-Type", "application/json");

        if self.config.api_type == "anthropic-messages" {
            req = req.header("anthropic-version", "2023-06-01");
        }

        let response = req
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("HTTP error: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let text = response.text().await.unwrap_or_default();
            return Err(format!("API error {}: {}", status, text));
        }

        let json: Value = response.json().await.map_err(|e| e.to_string())?;

        if self.config.api_type == "anthropic-messages" {
            return self.parse_anthropic_response(&json);
        }

        let choice = json["choices"][0].clone();
        let message = &choice["message"];

        let content = message["content"].as_str().map(|s| s.to_string());
        let tool_calls: Option<Vec<super::provider::ToolCall>> = if let Some(tc) = message["tool_calls"].as_array() {
            Some(tc.iter().map(|t| serde_json::from_value(t.clone()).unwrap_or_else(|_| {
                super::provider::ToolCall {
                    id: t["id"].as_str().unwrap_or("").to_string(),
                    call_type: "function".to_string(),
                    function: super::provider::FunctionCall {
                        name: t["function"]["name"].as_str().unwrap_or("").to_string(),
                        arguments: t["function"]["arguments"].as_str().unwrap_or("{}").to_string(),
                    },
                }
            })).collect())
        } else {
            None
        };

        let finish_reason = choice["finish_reason"].as_str().map(|s| s.to_string());

        Ok(ChatResponse {
            role: "assistant".to_string(),
            content,
            tool_calls,
            finish_reason,
        })
    }

    async fn chat_stream(
        &self,
        messages: &[ChatMessage],
        options: &ChatOptions,
    ) -> Result<Vec<super::provider::ChatChunk>, String> {
        let url = self.build_chat_url();
        let body = self.build_chat_body(messages, options, true);
        let (auth_header_name, auth_header_value) = self.build_auth_header();

        let mut req = self.client
            .post(&url)
            .header(&auth_header_name, &auth_header_value)
            .header("Content-Type", "application/json");

        if self.config.api_type == "anthropic-messages" {
            req = req.header("anthropic-version", "2023-06-01");
        }

        let response = req
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("HTTP error: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let text = response.text().await.unwrap_or_default();
            return Err(format!("API error {}: {}", status, text));
        }

        let text = response.text().await.map_err(|e| e.to_string())?;
        let mut chunks = Vec::new();

        for line in text.lines() {
            let line = line.trim();
            if line.is_empty() || !line.starts_with("data: ") {
                if self.config.api_type == "anthropic-messages" && line.starts_with("event: ") {
                    continue;
                }
                continue;
            }
            let data = &line[6..];
            if data == "[DONE]" {
                break;
            }
            if let Ok(json) = serde_json::from_str::<Value>(data) {
                if self.config.api_type == "anthropic-messages" {
                    if let Some(chunk) = self.parse_anthropic_chunk(&json) {
                        chunks.push(chunk);
                    }
                    continue;
                }

                let choice = &json["choices"][0];
                let delta = &choice["delta"];

                let content = delta["content"].as_str().map(|s| s.to_string());
                let finish_reason = choice["finish_reason"].as_str().map(|s| s.to_string());

                let tool_calls = if let Some(tc) = delta["tool_calls"].as_array() {
                    Some(tc.iter().map(|t| super::provider::ToolCallDelta {
                        index: t["index"].as_i64().unwrap_or(0) as i32,
                        id: t["id"].as_str().map(|s| s.to_string()),
                        function: if t["function"].is_object() {
                            Some(super::provider::FunctionCallDelta {
                                name: t["function"]["name"].as_str().map(|s| s.to_string()),
                                arguments: t["function"]["arguments"].as_str().map(|s| s.to_string()),
                            })
                        } else {
                            None
                        },
                    }).collect())
                } else {
                    None
                };

                chunks.push(super::provider::ChatChunk {
                    content,
                    tool_calls,
                    finish_reason,
                });
            }
        }

        Ok(chunks)
    }

    fn validate_config(&self, config: &ProviderConfig) -> Result<(), String> {
        if config.base_url.is_empty() {
            return Err("Base URL is required".to_string());
        }
        if config.auth_type == "custom" && config.custom_auth_header.is_empty() {
            return Err("Custom auth header name is required when auth type is 'custom'".to_string());
        }
        Ok(())
    }
}
