#![allow(dead_code)]

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

use super::permission::{self, PermissionMode, PermissionRequest};

const COMPACT_PRESERVE_RECENT: usize = 6;
const COMPACT_MAX_ESTIMATED_TOKENS: usize = 80_000;
const CHARS_PER_TOKEN: usize = 4;
const MAX_PROVIDER_RETRIES: usize = 2;
const PROVIDER_RETRY_BASE_DELAY_MS: u64 = 1000;

#[derive(Debug, Clone, Copy)]
pub struct CompactionConfig {
    pub preserve_recent: usize,
    pub max_estimated_tokens: usize,
}

impl Default for CompactionConfig {
    fn default() -> Self {
        Self {
            preserve_recent: COMPACT_PRESERVE_RECENT,
            max_estimated_tokens: COMPACT_MAX_ESTIMATED_TOKENS,
        }
    }
}

fn estimate_tokens(text: &str) -> usize {
    text.len().max(1) / CHARS_PER_TOKEN
}

fn estimate_messages_tokens(messages: &[super::provider::ChatMessage]) -> usize {
    messages.iter().map(|m| estimate_tokens(&m.content)).sum()
}

fn should_compact(messages: &[super::provider::ChatMessage], config: &CompactionConfig) -> bool {
    if messages.len() <= config.preserve_recent + 1 {
        return false;
    }
    let total = estimate_messages_tokens(messages);
    total >= config.max_estimated_tokens
}

fn validate_compacted_messages(messages: &[super::provider::ChatMessage]) -> Result<(), String> {
    if messages.is_empty() {
        return Err("Compacted messages is empty".to_string());
    }
    if messages[0].role != "system" {
        return Err(format!("First message is not system, got: {}", messages[0].role));
    }
    let tool_call_ids: std::collections::HashSet<String> = messages.iter()
        .filter(|m| m.role == "assistant")
        .filter_map(|m| m.tool_calls.as_ref())
        .flat_map(|tcs| tcs.iter().map(|tc| tc.id.clone()))
        .collect();
    let tool_msg_ids: std::collections::HashSet<String> = messages.iter()
        .filter(|m| m.role == "tool")
        .filter_map(|m| m.tool_call_id.clone())
        .collect();
    let orphan_tool_msgs: Vec<&str> = tool_msg_ids.iter()
        .filter(|id| !tool_call_ids.contains(*id))
        .map(|id| id.as_str())
        .collect();
    if !orphan_tool_msgs.is_empty() && orphan_tool_msgs.len() > 3 {
        return Err(format!("Too many orphan tool messages after compaction: {}", orphan_tool_msgs.len()));
    }
    Ok(())
}

async fn compact_messages(
    provider: &Arc<dyn super::provider::LlmProvider>,
    messages: &[super::provider::ChatMessage],
    config: &CompactionConfig,
    model: &str,
) -> Result<(Vec<super::provider::ChatMessage>, String), String> {
    if messages.len() <= config.preserve_recent + 1 {
        return Ok((messages.to_vec(), String::new()));
    }

    let split_point = messages.len().saturating_sub(config.preserve_recent);
    let old_messages = &messages[1..split_point];
    let recent_messages = &messages[split_point..];

    if old_messages.is_empty() {
        return Ok((messages.to_vec(), String::new()));
    }

    let conversation_text: String = old_messages
        .iter()
        .map(|m| format!("[{}]: {}", m.role, m.content))
        .collect::<Vec<_>>()
        .join("\n\n");

    let summary_prompt = format!(
        "Summarize the following conversation concisely. Preserve key facts, decisions, user preferences, tool results, and any important context. Do not add information not present in the conversation.\n\nConversation:\n{}",
        conversation_text
    );

    let summary_messages = vec![
        super::provider::ChatMessage {
            role: "system".to_string(),
            content: "You are a conversation summarizer. Produce a concise, factual summary that preserves all important context, decisions, and results.".to_string(),
            tool_calls: None,
            tool_call_id: None,
        },
        super::provider::ChatMessage {
            role: "user".to_string(),
            content: summary_prompt,
            tool_calls: None,
            tool_call_id: None,
        },
    ];

    let options = super::provider::ChatOptions {
        model: model.to_string(),
        temperature: 0.3,
        max_tokens: 2048,
        tools: None,
    };

    let response = provider.chat(&summary_messages, &options).await?;
    let summary = response.content.unwrap_or_default();

    let compacted_system = format!(
        "{}\n\n[Conversation Summary]\nThe following is a summary of earlier conversation:\n{}\n[/Conversation Summary]",
        messages[0].content,
        summary.trim()
    );

    let mut result = vec![
        super::provider::ChatMessage {
            role: "system".to_string(),
            content: compacted_system,
            tool_calls: None,
            tool_call_id: None,
        },
    ];
    result.extend(recent_messages.to_vec());
    Ok((result, summary.trim().to_string()))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolOutput {
    pub success: bool,
    pub result: String,
    #[serde(default)]
    pub metadata: Value,
}

pub struct RunResult {
    pub final_content: String,
    pub messages: Vec<super::provider::ChatMessage>,
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

    pub fn unregister(&mut self, name: &str) -> bool {
        self.tools.remove(name).is_some()
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

fn last_assistant_content(messages: &[super::provider::ChatMessage]) -> String {
    messages.iter()
        .rev()
        .find(|m| m.role == "assistant")
        .and_then(|m| if m.content.is_empty() { None } else { Some(m.content.clone()) })
        .unwrap_or_else(|| "No response".to_string())
}

pub struct AgentEngine {
    agent_id: String,
    provider: Arc<dyn super::provider::LlmProvider>,
    fallback_provider: Option<Arc<dyn super::provider::LlmProvider>>,
    fallback_model: Option<String>,
    tools: Arc<Mutex<ToolRegistry>>,
    model: String,
    system_prompt: String,
    temperature: f64,
    max_iterations: i32,
    max_tokens: i64,
    cancel_token: Option<CancellationToken>,
    permission_mode: PermissionMode,
    always_allowed_tools: Arc<tokio::sync::Mutex<Vec<String>>>,
    permission_requester: Option<Arc<dyn Fn(PermissionRequest) -> Pin<Box<dyn Future<Output = (bool, bool)> + Send>> + Send + Sync>>,
    message_persister: Option<Arc<dyn Fn(PersistMessage) + Send + Sync>>,
    /// 自主任务模式：当模型返回纯文本（无工具调用）但任务尚未完成时，自动注入提醒并继续循环，
    /// 避免每完成一小步就停下等用户点"继续"。仅对明确开启的会话（如远程桌面安装）生效。
    auto_continue: bool,
}

pub type PermissionRequesterFn = Arc<dyn Fn(PermissionRequest) -> Pin<Box<dyn Future<Output = (bool, bool)> + Send>> + Send + Sync>;

#[derive(Debug, Clone)]
pub struct PersistMessage {
    pub role: String,
    pub content: String,
    pub tool_calls: Option<Vec<super::provider::ToolCall>>,
    pub tool_call_id: Option<String>,
    pub is_error: bool,
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
            agent_id: String::new(),
            provider,
            fallback_provider: None,
            fallback_model: None,
            tools,
            model,
            system_prompt,
            temperature,
            max_iterations,
            max_tokens: 4096,
            cancel_token: None,
            permission_mode: PermissionMode::Confirm,
            always_allowed_tools: Arc::new(tokio::sync::Mutex::new(Vec::new())),
            permission_requester: None,
            message_persister: None,
            auto_continue: false,
        }
    }

    pub fn with_agent_id(mut self, id: String) -> Self {
        self.agent_id = id;
        self
    }

    pub fn with_cancel_token(mut self, token: CancellationToken) -> Self {
        self.cancel_token = Some(token);
        self
    }

    pub fn with_permission_mode(mut self, mode: PermissionMode) -> Self {
        self.permission_mode = mode;
        self
    }

    pub fn with_always_allowed_tools(mut self, tools: Vec<String>) -> Self {
        self.always_allowed_tools = Arc::new(tokio::sync::Mutex::new(tools));
        self
    }

    pub fn with_permission_requester(mut self, requester: PermissionRequesterFn) -> Self {
        self.permission_requester = Some(requester);
        self
    }

    pub fn with_fallback(mut self, provider: Arc<dyn super::provider::LlmProvider>, model: String) -> Self {
        self.fallback_provider = Some(provider);
        self.fallback_model = Some(model);
        self
    }

    pub fn with_auto_continue(mut self, enabled: bool) -> Self {
        self.auto_continue = enabled;
        self
    }

    pub fn with_message_persister(mut self, persister: Arc<dyn Fn(PersistMessage) + Send + Sync>) -> Self {
        self.message_persister = Some(persister);
        self
    }

    pub fn with_system_prompt(mut self, prompt: String) -> Self {
        self.system_prompt = prompt;
        self
    }

    pub async fn run(
        &self,
        user_message: &str,
        history: Vec<super::provider::ChatMessage>,
        on_chunk: impl Fn(String),
        on_tool_call: impl Fn(ToolCallEvent),
    ) -> Result<RunResult, String> {
        tracing::info!("[AgentEngine] run() called, agent_id={}, message_len={}, history_count={}", self.agent_id, user_message.len(), history.len());
        tracing::debug!("[AgentEngine] user_message preview: {}...", &user_message[..user_message.len().min(200)]);
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

        tracing::info!("[AgentEngine] total messages before compaction check: {}", messages.len());

        let compaction_config = CompactionConfig::default();
        if should_compact(&messages, &compaction_config) {
            tracing::warn!("[AgentEngine] compaction triggered, estimated_tokens={}, threshold={}", estimate_messages_tokens(&messages), compaction_config.max_estimated_tokens);
            on_chunk("[Auto-compacting conversation history...]\n".to_string());
            match compact_messages(&self.provider, &messages, &compaction_config, &self.model).await {
                Ok((compacted, summary)) => {
                    let removed = messages.len().saturating_sub(compacted.len());
                    tracing::info!("[AgentEngine] compaction ok, removed={}, remaining={}", removed, compacted.len());
                    on_chunk(format!("[Compacted: {} messages summarized, {} recent preserved]\n", removed, compacted.len().saturating_sub(1)));
                    if let Some(ref persister) = self.message_persister {
                        persister(PersistMessage {
                            role: "system_compaction".to_string(),
                            content: summary,
                            tool_calls: None,
                            tool_call_id: None,
                            is_error: false,
                        });
                    }
                    match validate_compacted_messages(&compacted) {
                        Ok(()) => {
                            messages = compacted;
                        }
                        Err(ve) => {
                            tracing::error!("[AgentEngine] compaction validation failed: {}", ve);
                            on_chunk(format!("[Compaction validation failed: {}, keeping full history]\n", ve));
                        }
                    }
                }
                Err(e) => {
                    tracing::error!("[AgentEngine] compaction failed: {}", e);
                    on_chunk(format!("[Compaction failed: {}, continuing with full history]\n", e));
                }
            }
        }

        let tool_defs = {
            let tools = self.tools.lock().await;
            tools.list_definitions()
        };

        let tools_opt = if tool_defs.is_empty() { None } else { Some(tool_defs) };

        let mut iteration = 0;
        let mut force_tool_attempts = 0;
        let mut tool_call_count = 0;
        let mut auto_continue_count = 0;
        const MAX_AUTO_CONTINUE: i32 = 10;
        tracing::info!("[AgentEngine] starting loop, max_iterations={}, tools_count={}", self.max_iterations, tools_opt.as_ref().map(|t| t.len()).unwrap_or(0));
        let result = 'outer: loop {
            if iteration >= self.max_iterations {
                tracing::warn!("[AgentEngine] max iterations reached ({})", self.max_iterations);
                on_chunk("\n[Max iterations reached]\n".to_string());
                break 'outer Ok(last_assistant_content(&messages));
            }

            if let Some(ref token) = self.cancel_token {
                if token.is_cancelled() {
                    tracing::info!("[AgentEngine] cancelled by user at iteration {}", iteration);
                    on_chunk("\n[Stopped by user]\n".to_string());
                    break 'outer Ok(last_assistant_content(&messages));
                }
            }

            let options = super::provider::ChatOptions {
                model: self.model.clone(),
                temperature: self.temperature,
                max_tokens: self.max_tokens,
                tools: tools_opt.clone(),
            };

            let _use_stream = true;
            tracing::info!("[AgentEngine] iteration={}, calling chat_stream_with_retry, model={}", iteration, self.model);
            let response = match self.chat_stream_with_retry(&messages, &options, &on_chunk).await {
                Ok(r) => {
                    tracing::info!("[AgentEngine] chat_stream_with_retry ok, content_len={}, tool_calls={}", r.content.as_ref().map(|c| c.len()).unwrap_or(0), r.tool_calls.as_ref().map(|tc| tc.len()).unwrap_or(0));
                    r
                }
                Err(e) => {
                    tracing::error!("[AgentEngine] chat_stream_with_retry failed at iteration {}: {}", iteration, &e[..e.len().min(200)]);
                    if e.contains("context_length_exceeded") || e.contains("max_tokens") || e.contains("too many tokens") || e.contains("token limit") {
                        tracing::warn!("[AgentEngine] context too long, truncating history (current {} messages)", messages.len());
                        on_chunk("[Context too long, truncating history and retrying...]\n".to_string());
                        let truncated = self.truncate_messages(&messages);
                        tracing::info!("[AgentEngine] truncated to {} messages", truncated.len());
                        match self.chat_stream_with_retry(&truncated, &options, &on_chunk).await {
                            Ok(r) => r,
                            Err(e2) => {
                                tracing::warn!("[AgentEngine] retry after truncation also failed, trying fallback");
                                let retried = self.try_fallback(&truncated, &options, &on_chunk, &e2).await;
                                match retried {
                                    Ok(r) => {
                                        on_chunk("[Switched to fallback model after truncation]\n".to_string());
                                        r
                                    }
                                    Err(fe) => {
                                        tracing::error!("[AgentEngine] fallback also failed after truncation: {}", fe);
                                        on_chunk(format!("[Provider error after truncation: {}]\n", fe));
                                        return Err(fe);
                                    }
                                }
                            }
                        }
                    } else {
                        let retried = self.try_fallback(&messages, &options, &on_chunk, &e).await;
                        match retried {
                            Ok(r) => {
                                on_chunk("[Switched to fallback model]\n".to_string());
                                r
                            }
                            Err(fallback_err) => {
                                on_chunk(format!("[Provider error: {}]\n", fallback_err));
                                return Err(fallback_err);
                            }
                        }
                    }
                }
            };

            if let Some(ref token) = self.cancel_token {
                if token.is_cancelled() {
                    on_chunk("\n[Stopped by user]\n".to_string());
                    break 'outer Ok(last_assistant_content(&messages));
                }
            }

            // 某些 OpenAI 兼容模型（如 deepseek-v4-flash-0731）在流式响应中会省略
            // tool_calls[].function.name（只返回 arguments），导致 `Tool '' is not available`。
            // 依据上下文修复空工具名：注册表只有 1 个工具时直接用该工具名（绝对安全）；
            // 多工具时按参数特征推断（session_id 是 terminal_session 的独有特征）。
            let mut response_tool_calls = response.tool_calls.clone();
            if let Some(ref mut tcs) = response_tool_calls {
                let registry_names: Vec<String> = {
                    let tools = self.tools.lock().await;
                    tools.list_names()
                };
                for tc in tcs.iter_mut() {
                    if tc.function.name.trim().is_empty() {
                        let inferred = if registry_names.len() == 1 {
                            Some(registry_names[0].clone())
                        } else if let Ok(v) = serde_json::from_str::<Value>(&tc.function.arguments) {
                            if v.get("session_id").is_some() {
                                Some("terminal_session".to_string())
                            } else if v.get("command").is_some() && (v.get("working_dir").is_some() || v.get("cwd").is_some()) {
                                Some("terminal".to_string())
                            } else {
                                None
                            }
                        } else {
                            None
                        };
                        if let Some(name) = inferred {
                            tracing::warn!(
                                "[AgentEngine] empty tool name inferred as '{}' from context (args={})",
                                name,
                                &tc.function.arguments[..tc.function.arguments.len().min(80)]
                            );
                            tc.function.name = name;
                        }
                    }
                }
            }

            let assistant_msg = super::provider::ChatMessage {
                role: "assistant".to_string(),
                content: response.content.clone().unwrap_or_default(),
                tool_calls: response_tool_calls.clone(),
                tool_call_id: None,
            };
            messages.push(assistant_msg.clone());
            if let Some(ref persister) = self.message_persister {
                persister(PersistMessage {
                    role: assistant_msg.role.clone(),
                    content: assistant_msg.content.clone(),
                    tool_calls: assistant_msg.tool_calls.clone(),
                    tool_call_id: assistant_msg.tool_call_id.clone(),
                    is_error: false,
                });
            }

            match &response_tool_calls {
                Some(tool_calls) if !tool_calls.is_empty() => {
                    tracing::info!("[AgentEngine] iteration={}, processing {} tool calls", iteration, tool_calls.len());

                    let mut approved_calls: Vec<(super::provider::ToolCall, Value)> = Vec::new();
                    let mut denied_results: Vec<(super::provider::ToolCall, String)> = Vec::new();

                    for tc in tool_calls {
                        let tool_name = &tc.function.name;
                        let args: Value = serde_json::from_str(&tc.function.arguments)
                            .unwrap_or(Value::Null);

                        tracing::info!("[AgentEngine] tool_call: name={}, args_preview={}", tool_name, &serde_json::to_string(&args).unwrap_or_default()[..serde_json::to_string(&args).unwrap_or_default().len().min(200)]);

                        let needs_confirm = {
                            let allowed_guard = self.always_allowed_tools.lock().await;
                            permission::should_confirm(self.permission_mode, tool_name, &args, &allowed_guard)
                        };

                        if needs_confirm {
                            tracing::info!("[AgentEngine] permission required for tool: {}", tool_name);
                            let risk = permission::classify_tool_risk(tool_name, &args);
                            let desc = permission::build_permission_description(tool_name, &args);

                            let (approved, always_allow) = if let Some(ref requester) = self.permission_requester {
                                let req = PermissionRequest {
                                    conversation_id: String::new(),
                                    agent_id: self.agent_id.clone(),
                                    tool_name: tool_name.clone(),
                                    arguments: args.clone(),
                                    risk_level: risk,
                                    description: desc,
                                };
                                let result = requester(req).await;
                                tracing::info!("[AgentEngine] permission result for {}: approved={}, always_allow={}", tool_name, result.0, result.1);
                                result
                            } else {
                                tracing::warn!("[AgentEngine] no permission_requester, denying tool: {}", tool_name);
                                (false, false)
                            };

                            if approved && always_allow {
                                let mut allowed = self.always_allowed_tools.lock().await;
                                if !allowed.contains(tool_name) {
                                    allowed.push(tool_name.clone());
                                }
                            }

                            if !approved {
                                tracing::warn!("[AgentEngine] tool '{}' denied by user", tool_name);
                                on_tool_call(ToolCallEvent {
                                    tool_name: tool_name.clone(),
                                    arguments: args.clone(),
                                    result: None,
                                    success: None,
                                    status: "running".to_string(),
                                });
                                let deny_msg = format!("Permission denied for tool '{}'. User did not approve this action.", tool_name);
                                on_tool_call(ToolCallEvent {
                                    tool_name: tool_name.clone(),
                                    arguments: Value::Null,
                                    result: Some(deny_msg.clone()),
                                    success: Some(false),
                                    status: "denied".to_string(),
                                });
                                denied_results.push((tc.clone(), deny_msg));
                                continue;
                            }
                        }

                        approved_calls.push((tc.clone(), args));
                    }

                    for (tc, _) in &approved_calls {
                        on_tool_call(ToolCallEvent {
                            tool_name: tc.function.name.clone(),
                            arguments: serde_json::from_str(&tc.function.arguments).unwrap_or(Value::Null),
                            result: None,
                            success: None,
                            status: "running".to_string(),
                        });
                    }

                    let mut tool_futures = Vec::new();
                    for (tc, args) in &approved_calls {
                        let tool_name = tc.function.name.clone();
                        let args = args.clone();
                        let tools = self.tools.lock().await;
                        let tool_arc = tools.get(&tool_name).cloned();
                        drop(tools);
                        let cancel_token = self.cancel_token.clone();
                        tool_futures.push(async move {
                            let result = match tool_arc {
                                Some(tool) => {
                                    let mut output = tool.execute(args.clone()).await;
                                    if let Err(ref e) = output {
                                        let err_msg = format!("{}", e);
                                        let is_retryable = err_msg.contains("timeout")
                                            || err_msg.contains("timed out")
                                            || err_msg.contains("connection")
                                            || err_msg.contains("ECONNREFUSED")
                                            || err_msg.contains("ECONNRESET")
                                            || err_msg.contains("ETIMEDOUT")
                                            || err_msg.contains("temporary")
                                            || err_msg.contains("retry");
                                        if is_retryable {
                                            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                                            output = tool.execute(args.clone()).await;
                                        }
                                    }
                                    match output {
                                        Ok(output) => output,
                                        Err(e) => {
                                            let err_msg = format!("{}", e);
                                            let degraded = if err_msg.contains("not found") || err_msg.contains("No such file") {
                                                format!("Tool '{}' failed: {}. The target does not exist. Please verify the path or name and try again.", tool_name, err_msg)
                                            } else if err_msg.contains("permission") || err_msg.contains("Permission denied") || err_msg.contains("access denied") {
                                                format!("Tool '{}' failed due to permission error: {}. Try a different approach or check access rights.", tool_name, err_msg)
                                            } else if err_msg.contains("timeout") || err_msg.contains("timed out") {
                                                format!("Tool '{}' timed out: {}. The operation took too long. Try a simpler or more specific request.", tool_name, err_msg)
                                            } else if err_msg.contains("ModuleNotFoundError") || err_msg.contains("ImportError") || err_msg.contains("No module named") {
                                                format!("Tool '{}' failed because a Python dependency is missing: {}. Install it with 'pip install <package>' and retry, or modify the script to avoid this dependency.", tool_name, err_msg)
                                            } else if err_msg.contains("SyntaxError") || err_msg.contains("syntax error") {
                                                format!("Tool '{}' failed due to a script syntax error: {}. Fix the script syntax and use the refine action to update the plugin.", tool_name, err_msg)
                                            } else if err_msg.contains("command not found") || err_msg.contains("not recognized") {
                                                format!("Tool '{}' failed because the interpreter/command is not installed: {}. Install the required program or use a different script type.", tool_name, err_msg)
                                            } else {
                                                format!("Tool '{}' execution failed: {}. Please try an alternative approach.", tool_name, err_msg)
                                            };
                                            ToolOutput {
                                                success: false,
                                                result: degraded,
                                                metadata: Value::Null,
                                            }
                                        }
                                    }
                                }
                                None => ToolOutput {
                                    success: false,
                                    result: format!("Tool '{}' is not available. Available tools may differ from what you expect. Try using a different tool or approach.", tool_name),
                                    metadata: Value::Null,
                                }
                            };
                            (tool_name, result, cancel_token)
                        });
                    }

                    let tool_results = futures::future::join_all(tool_futures).await;

                    for (tc, deny_msg) in &denied_results {
                        messages.push(super::provider::ChatMessage {
                            role: "tool".to_string(),
                            content: deny_msg.clone(),
                            tool_calls: None,
                            tool_call_id: Some(tc.id.clone()),
                        });
                        if let Some(ref persister) = self.message_persister {
                            persister(PersistMessage {
                                role: "tool".to_string(),
                                content: deny_msg.clone(),
                                tool_calls: None,
                                tool_call_id: Some(tc.id.clone()),
                                is_error: true,
                            });
                        }
                    }

                    for (idx, (tool_name, tool_result, cancel_token)) in tool_results.iter().enumerate() {
                        let tc = &approved_calls[idx].0;
                        on_tool_call(ToolCallEvent {
                            tool_name: tool_name.clone(),
                            arguments: Value::Null,
                            result: Some(tool_result.result.clone()),
                            success: Some(tool_result.success),
                            status: "done".to_string(),
                        });

                        tracing::info!("[AgentEngine] tool '{}' execution done, success={}, result_len={}", tool_name, tool_result.success, tool_result.result.len());

                        if let Some(ref token) = cancel_token {
                            if token.is_cancelled() {
                                on_chunk("\n[Stopped by user]\n".to_string());
                                break 'outer Ok(last_assistant_content(&messages));
                            }
                        }

                        let tool_result_content = if tool_result.success {
                            tool_call_count += 1;
                            if tool_call_count == 1 {
                                format!("{}\n\n---\nAnalyze the above data and answer the user's question based on the actual results. Do NOT use your own knowledge to override the data.", tool_result.result)
                            } else {
                                tool_result.result.clone()
                            }
                        } else {
                            format!("Tool execution failed: {}\n\nIf this tool is not suitable, try a different approach or explain the limitation to the user.", tool_result.result)
                        };

                        messages.push(super::provider::ChatMessage {
                            role: "tool".to_string(),
                            content: tool_result_content.clone(),
                            tool_calls: None,
                            tool_call_id: Some(tc.id.clone()),
                        });
                        if let Some(ref persister) = self.message_persister {
                            persister(PersistMessage {
                                role: "tool".to_string(),
                                content: tool_result_content,
                                tool_calls: None,
                                tool_call_id: Some(tc.id.clone()),
                                is_error: !tool_result.success,
                            });
                        }
                    }
                }
                _ => {
                    let has_tools = tools_opt.as_ref().map(|t| !t.is_empty()).unwrap_or(false);
                    let should_force_tool = has_tools
                        && iteration == 0
                        && self.system_prompt.contains("MUST call the corresponding tool")
                        && force_tool_attempts < 3;

                    if should_force_tool {
                        force_tool_attempts += 1;
                        tracing::warn!("[AgentEngine] forcing tool call at iteration {}, attempt {}", iteration, force_tool_attempts);
                        let tool_names: Vec<String> = tools_opt.as_ref()
                            .map(|defs| defs.iter().map(|d| d.function.name.clone()).collect())
                            .unwrap_or_default();
                        let reminder = format!(
                            "IMPORTANT: You did not call any tool in your previous response, but tools are available: {}. You MUST call one of these tools to get real data. Do NOT answer from your own knowledge. Please retry with a tool call.",
                            tool_names.join(", ")
                        );
                        messages.push(super::provider::ChatMessage {
                            role: "user".to_string(),
                            content: reminder,
                            tool_calls: None,
                            tool_call_id: None,
                        });
                        iteration += 1;
                        continue;
                    }

                    // 自主任务模式：模型返回纯文本但未给出完成结论时，自动注入提醒继续驱动终端，
                    // 避免每一步都停下等用户点"继续"。受 MAX_AUTO_CONTINUE 与 max_iterations 双重兜底，不会死循环。
                    if self.auto_continue && auto_continue_count < MAX_AUTO_CONTINUE {
                        let last = response.content.clone().unwrap_or_default().to_lowercase();
                        let looks_done = last.contains("完成")
                            || last.contains("已完成")
                            || last.contains("done")
                            || last.contains("finished")
                            || last.contains("complete")
                            || last.contains("completed")
                            || last.contains("vnc is ready")
                            || last.contains("is ready")
                            || last.contains("已达到")
                            || last.contains("可以连接")
                            || last.contains("可连接");
                        // 等待用户确认：检测到"检查结论标记"或模型在征询用户意见时，绝不自动续跑，
                        // 必须先交还用户（如远程桌面安装前的"是否安装"确认）。
                        // 词表覆盖中英文常见征询说法（英文环境下模型可能用 would you like / shall i 等）。
                        let awaiting_user = last.contains("rd_status:")
                            || last.contains("需要我")
                            || last.contains("要我")
                            || last.contains("是否")
                            || last.contains("请确认")
                            || last.contains("确认吗")
                            || last.contains("安装吗")
                            || last.contains("do you want")
                            || last.contains("would you like")
                            || last.contains("want me to")
                            || last.contains("shall i")
                            || last.contains("shall we")
                            || last.contains("may i")
                            || last.contains("should i")
                            || last.contains("proceed with")
                            || last.contains("ready to install")
                            || last.contains("do you agree")
                            || last.contains("please confirm");
                        if !looks_done && !awaiting_user {
                            auto_continue_count += 1;
                            tracing::info!("[AgentEngine] auto-continue ({}/{}), nudging model to keep driving the terminal", auto_continue_count, MAX_AUTO_CONTINUE);
                            on_chunk("\n[auto-continue: installation not finished yet, resuming...]\n".to_string());
                            messages.push(super::provider::ChatMessage {
                                role: "user".to_string(),
                                content: "[System] The remote desktop setup is NOT complete yet. Do NOT stop and do NOT end your turn with a plain-text summary. Continue calling the `terminal_session` tool: write the next command, then read_output to verify. Only output a final summary once the VNC server is verified running and reachable (e.g. listening on 5901 and serving a desktop).".to_string(),
                                tool_calls: None,
                                tool_call_id: None,
                            });
                            iteration += 1;
                            continue;
                        }
                    }

                    tracing::info!("[AgentEngine] loop completed at iteration {}, no more tool calls, total messages={}", iteration, messages.len());
                    break 'outer Ok(last_assistant_content(&messages));
                }
            }

            iteration += 1;
        };

        tracing::info!("[AgentEngine] run() finished, result is_ok={}", result.is_ok());
        result.map(|content| RunResult {
            final_content: content,
            messages,
        })
    }

    async fn try_fallback(
        &self,
        messages: &[super::provider::ChatMessage],
        options: &super::provider::ChatOptions,
        on_chunk: &impl Fn(String),
        original_error: &str,
    ) -> Result<super::provider::ChatResponse, String> {
        if !original_error.contains("429") && !original_error.contains("500") && !original_error.contains("503") {
            return Err(original_error.to_string());
        }

        if let (Some(ref fallback_provider), Some(ref fallback_model)) = (&self.fallback_provider, &self.fallback_model) {
            on_chunk(format!("[Primary provider error ({}), trying fallback model: {}]\n", original_error.chars().take(80).collect::<String>(), fallback_model));
            let fallback_options = super::provider::ChatOptions {
                model: fallback_model.clone(),
                temperature: options.temperature,
                max_tokens: options.max_tokens,
                tools: options.tools.clone(),
            };
            self.chat_stream_collect_with_provider(fallback_provider, messages, &fallback_options, on_chunk).await
        } else {
            Err(original_error.to_string())
        }
    }

    fn truncate_messages(&self, messages: &[super::provider::ChatMessage]) -> Vec<super::provider::ChatMessage> {
        if messages.len() <= 3 {
            return messages.to_vec();
        }
        let mut result = Vec::new();
        if let Some(first) = messages.first() {
            if first.role == "system" {
                result.push(first.clone());
            }
        }
        let keep_count = (messages.len() / 2).max(4);
        let start = messages.len().saturating_sub(keep_count);
        for msg in messages.iter().skip(start) {
            if msg.role == "system" && result.first().map_or(false, |f| f.role == "system") {
                continue;
            }
            result.push(msg.clone());
        }
        result
    }

    async fn chat_stream_with_retry(
        &self,
        messages: &[super::provider::ChatMessage],
        options: &super::provider::ChatOptions,
        on_chunk: &impl Fn(String),
    ) -> Result<super::provider::ChatResponse, String> {
        let mut last_error = String::new();
        for attempt in 0..=MAX_PROVIDER_RETRIES {
            match self.chat_stream_collect(messages, options, on_chunk).await {
                Ok(r) => return Ok(r),
                Err(e) => {
                    last_error = e.clone();
                    let is_retryable = e.contains("429") || e.contains("500") || e.contains("503") || e.contains("timeout") || e.contains("connection");
                    if !is_retryable || attempt >= MAX_PROVIDER_RETRIES {
                        return Err(last_error);
                    }
                    let delay = PROVIDER_RETRY_BASE_DELAY_MS * 2u64.pow(attempt as u32);
                    on_chunk(format!("[Provider error, retrying in {}ms (attempt {}/{})]\n", delay, attempt + 1, MAX_PROVIDER_RETRIES));
                    tokio::time::sleep(std::time::Duration::from_millis(delay)).await;
                }
            }
        }
        Err(last_error)
    }

    async fn chat_stream_collect(
        &self,
        messages: &[super::provider::ChatMessage],
        options: &super::provider::ChatOptions,
        on_chunk: &impl Fn(String),
    ) -> Result<super::provider::ChatResponse, String> {
        self.chat_stream_collect_with_provider(&self.provider, messages, options, on_chunk).await
    }

    async fn chat_stream_collect_with_provider(
        &self,
        provider: &Arc<dyn super::provider::LlmProvider>,
        messages: &[super::provider::ChatMessage],
        options: &super::provider::ChatOptions,
        on_chunk: &impl Fn(String),
    ) -> Result<super::provider::ChatResponse, String> {
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<String>();
        let on_chunk_forwarder: Arc<dyn Fn(super::provider::ChatChunk) + Send + Sync> = Arc::new(move |chunk: super::provider::ChatChunk| {
            if let Some(content) = &chunk.content {
                if !content.is_empty() {
                    let _ = tx.send(content.clone());
                }
            }
        });

        let provider_clone = provider.clone();
        let messages_clone = messages.to_vec();
        let options_clone = options.clone();

        let handle = tokio::spawn(async move {
            provider_clone.chat_stream_realtime(&messages_clone, &options_clone, on_chunk_forwarder).await
        });

        while let Some(content) = rx.recv().await {
            on_chunk(content);
        }

        handle.await.map_err(|e| format!("Task join error: {}", e))?
    }
}
