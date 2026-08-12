use std::sync::Arc;
use std::collections::HashMap;
use serde::{Deserialize, Serialize};
use tauri::{State, Emitter};
use tokio_util::sync::CancellationToken;

use crate::app::agent_service::AgentService;
use crate::app::plugin_service::PluginService;
use crate::infra::storage::agent_repo::{
    AiProviderRow, AiEndpointRow, AiModelRow, AiAgentRow,
    AiConversationRow, AiMessageRow,
};

static CANCEL_TOKENS: std::sync::LazyLock<tokio::sync::Mutex<HashMap<String, CancellationToken>>> =
    std::sync::LazyLock::new(|| tokio::sync::Mutex::new(HashMap::new()));

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderDto {
    pub id: String,
    pub name: String,
    pub api_key: String,
    pub logo: String,
    pub enabled: bool,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EndpointDto {
    pub id: String,
    pub provider_id: String,
    pub name: String,
    pub api_type: String,
    pub base_url: String,
    pub auth_type: String,
    pub custom_auth_header: String,
    pub enabled: bool,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelDto {
    pub id: String,
    pub name: String,
    pub ref_key: String,
    pub endpoint_id: String,
    pub reasoning: bool,
    pub input_types: Vec<String>,
    pub context_window: i64,
    pub max_tokens: i64,
    pub enabled: bool,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentDto {
    pub id: String,
    pub name: String,
    pub description: String,
    pub model_id: Option<String>,
    pub system_prompt: String,
    pub temperature: f64,
    pub max_iterations: i32,
    pub tool_ids: Vec<String>,
    pub trigger_type: String,
    pub auto_confirm: bool,
    pub permission_mode: String,
    pub always_allowed_tools: Vec<String>,
    pub fallback_model_id: Option<String>,
    pub workspace_dir: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationDto {
    pub id: String,
    pub agent_id: String,
    pub title: String,
    pub metadata: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageDto {
    pub id: String,
    pub conversation_id: String,
    pub role: String,
    pub content: String,
    pub tool_calls: String,
    pub is_error: i32,
    pub created_at: i64,
}

fn to_provider_dto(p: &AiProviderRow) -> ProviderDto {
    ProviderDto {
        id: p.id.clone(),
        name: p.name.clone(),
        api_key: p.api_key.clone(),
        logo: p.logo.clone(),
        enabled: p.enabled,
        created_at: p.created_at,
        updated_at: p.updated_at,
    }
}

fn to_endpoint_dto(e: &AiEndpointRow) -> EndpointDto {
    EndpointDto {
        id: e.id.clone(),
        provider_id: e.provider_id.clone(),
        name: e.name.clone(),
        api_type: e.api_type.clone(),
        base_url: e.base_url.clone(),
        auth_type: e.auth_type.clone(),
        custom_auth_header: e.custom_auth_header.clone(),
        enabled: e.enabled,
        created_at: e.created_at,
        updated_at: e.updated_at,
    }
}

fn to_model_dto(m: &AiModelRow) -> ModelDto {
    ModelDto {
        id: m.id.clone(),
        name: m.name.clone(),
        ref_key: m.ref_key.clone(),
        endpoint_id: m.endpoint_id.clone(),
        reasoning: m.reasoning,
        input_types: m.input_types.clone(),
        context_window: m.context_window,
        max_tokens: m.max_tokens,
        enabled: m.enabled,
        created_at: m.created_at,
        updated_at: m.updated_at,
    }
}

fn to_agent_dto(a: &AiAgentRow) -> AgentDto {
    AgentDto {
        id: a.id.clone(),
        name: a.name.clone(),
        description: a.description.clone(),
        model_id: a.model_id.clone(),
        system_prompt: a.system_prompt.clone(),
        temperature: a.temperature,
        max_iterations: a.max_iterations,
        tool_ids: a.tool_ids.clone(),
        trigger_type: a.trigger_type.clone(),
        auto_confirm: a.auto_confirm,
        permission_mode: a.permission_mode.clone(),
        always_allowed_tools: a.always_allowed_tools.clone(),
        fallback_model_id: a.fallback_model_id.clone(),
        workspace_dir: a.workspace_dir.clone(),
        created_at: a.created_at,
        updated_at: a.updated_at,
    }
}

fn to_conversation_dto(c: &AiConversationRow) -> ConversationDto {
    ConversationDto {
        id: c.id.clone(),
        agent_id: c.agent_id.clone(),
        title: c.title.clone(),
        metadata: c.metadata.clone(),
        created_at: c.created_at,
        updated_at: c.updated_at,
    }
}

fn to_message_dto(m: &AiMessageRow) -> MessageDto {
    MessageDto {
        id: m.id.clone(),
        conversation_id: m.conversation_id.clone(),
        role: m.role.clone(),
        content: m.content.clone(),
        tool_calls: m.tool_calls.clone(),
        is_error: m.is_error,
        created_at: m.created_at,
    }
}

#[tauri::command]
pub fn list_providers(service: State<'_, Arc<AgentService>>) -> Result<Vec<ProviderDto>, String> {
    let providers = service.list_providers()?;
    Ok(providers.iter().map(to_provider_dto).collect())
}

#[tauri::command]
pub fn save_provider(service: State<'_, Arc<AgentService>>, provider: ProviderDto) -> Result<(), String> {
    service.save_provider(AiProviderRow {
        id: provider.id,
        name: provider.name,
        api_key: provider.api_key,
        logo: provider.logo,
        enabled: provider.enabled,
        created_at: provider.created_at,
        updated_at: provider.updated_at,
    })
}

#[tauri::command]
pub fn delete_provider(service: State<'_, Arc<AgentService>>, id: String) -> Result<(), String> {
    service.delete_provider(&id)
}

#[tauri::command]
pub fn list_endpoints(service: State<'_, Arc<AgentService>>) -> Result<Vec<EndpointDto>, String> {
    let endpoints = service.list_endpoints()?;
    Ok(endpoints.iter().map(to_endpoint_dto).collect())
}

#[tauri::command]
pub fn list_endpoints_by_provider(service: State<'_, Arc<AgentService>>, provider_id: String) -> Result<Vec<EndpointDto>, String> {
    let endpoints = service.list_endpoints_by_provider(&provider_id)?;
    Ok(endpoints.iter().map(to_endpoint_dto).collect())
}

#[tauri::command]
pub fn save_endpoint(service: State<'_, Arc<AgentService>>, endpoint: EndpointDto) -> Result<(), String> {
    service.save_endpoint(AiEndpointRow {
        id: endpoint.id,
        provider_id: endpoint.provider_id,
        name: endpoint.name,
        api_type: endpoint.api_type,
        base_url: endpoint.base_url,
        auth_type: endpoint.auth_type,
        custom_auth_header: endpoint.custom_auth_header,
        enabled: endpoint.enabled,
        created_at: endpoint.created_at,
        updated_at: endpoint.updated_at,
    })
}

#[tauri::command]
pub fn delete_endpoint(service: State<'_, Arc<AgentService>>, id: String) -> Result<(), String> {
    service.delete_endpoint(&id)
}

#[tauri::command]
pub fn list_models(service: State<'_, Arc<AgentService>>) -> Result<Vec<ModelDto>, String> {
    let models = service.list_models()?;
    Ok(models.iter().map(to_model_dto).collect())
}

#[tauri::command]
pub fn list_models_by_endpoint(service: State<'_, Arc<AgentService>>, endpoint_id: String) -> Result<Vec<ModelDto>, String> {
    let models = service.list_models_by_endpoint(&endpoint_id)?;
    Ok(models.iter().map(to_model_dto).collect())
}

#[tauri::command]
pub fn save_model(service: State<'_, Arc<AgentService>>, model: ModelDto) -> Result<(), String> {
    service.save_model(AiModelRow {
        id: model.id,
        name: model.name,
        ref_key: model.ref_key,
        endpoint_id: model.endpoint_id,
        reasoning: model.reasoning,
        input_types: model.input_types,
        context_window: model.context_window,
        max_tokens: model.max_tokens,
        enabled: model.enabled,
        created_at: model.created_at,
        updated_at: model.updated_at,
    })
}

#[tauri::command]
pub fn delete_model(service: State<'_, Arc<AgentService>>, id: String) -> Result<(), String> {
    service.delete_model(&id)
}

#[tauri::command]
pub async fn test_endpoint_connection(service: State<'_, Arc<AgentService>>, endpoint_id: String) -> Result<String, String> {
    service.test_endpoint_connection(&endpoint_id).await
}

#[tauri::command]
pub async fn test_model_chat(service: State<'_, Arc<AgentService>>, model_id: String) -> Result<String, String> {
    service.test_model_chat(&model_id).await
}

#[tauri::command]
pub fn list_agents(service: State<'_, Arc<AgentService>>) -> Result<Vec<AgentDto>, String> {
    let agents = service.list_agents()?;
    Ok(agents.iter().map(to_agent_dto).collect())
}

#[tauri::command]
pub fn save_agent(service: State<'_, Arc<AgentService>>, agent: AgentDto) -> Result<(), String> {
    service.save_agent(AiAgentRow {
        id: agent.id,
        name: agent.name,
        description: agent.description,
        model_id: agent.model_id,
        system_prompt: agent.system_prompt,
        temperature: agent.temperature,
        max_iterations: agent.max_iterations,
        tool_ids: agent.tool_ids,
        trigger_type: agent.trigger_type,
        auto_confirm: agent.auto_confirm,
        permission_mode: agent.permission_mode,
        always_allowed_tools: agent.always_allowed_tools,
        fallback_model_id: agent.fallback_model_id,
        workspace_dir: agent.workspace_dir,
        created_at: agent.created_at,
        updated_at: agent.updated_at,
    })
}

#[tauri::command]
pub fn delete_agent(service: State<'_, Arc<AgentService>>, id: String) -> Result<(), String> {
    service.delete_agent(&id)
}

#[tauri::command]
pub fn list_conversations(service: State<'_, Arc<AgentService>>, agent_id: String) -> Result<Vec<ConversationDto>, String> {
    let convs = service.list_conversations(&agent_id)?;
    Ok(convs.iter().map(to_conversation_dto).collect())
}

#[tauri::command]
pub fn create_conversation(service: State<'_, Arc<AgentService>>, agent_id: String, title: String, metadata: Option<String>) -> Result<ConversationDto, String> {
    let meta = metadata.unwrap_or_else(|| "{}".to_string());
    let conv = service.create_conversation_with_metadata(&agent_id, &title, &meta)?;
    Ok(to_conversation_dto(&conv))
}

#[tauri::command]
pub fn delete_conversation(service: State<'_, Arc<AgentService>>, id: String) -> Result<(), String> {
    service.delete_conversation(&id)
}

#[tauri::command]
pub fn update_conversation_title(service: State<'_, Arc<AgentService>>, id: String, title: String) -> Result<(), String> {
    service.update_conversation_title(&id, &title)
}

#[tauri::command]
pub fn list_messages(service: State<'_, Arc<AgentService>>, conversation_id: String) -> Result<Vec<MessageDto>, String> {
    let msgs = service.list_messages(&conversation_id)?;
    Ok(msgs.iter().map(to_message_dto).collect())
}

#[tauri::command]
pub fn save_message(service: State<'_, Arc<AgentService>>, msg: MessageDto) -> Result<(), String> {
    service.save_message(AiMessageRow {
        id: msg.id,
        conversation_id: msg.conversation_id,
        role: msg.role,
        content: msg.content,
        tool_calls: msg.tool_calls,
        is_error: msg.is_error,
        created_at: msg.created_at,
    })
}

#[tauri::command]
pub fn delete_messages_after(service: State<'_, Arc<AgentService>>, conversation_id: String, after_message_id: String) -> Result<(), String> {
    service.delete_messages_after(&conversation_id, &after_message_id)
}

#[tauri::command]
pub async fn run_agent(
    agent_id: String,
    message: String,
    conversation_id: Option<String>,
    disable_tools: Option<bool>,
    app_handle: tauri::AppHandle,
    service: State<'_, Arc<AgentService>>,
    plugin_service: State<'_, Arc<PluginService>>,
) -> Result<String, String> {
    let skip_tools = disable_tools.unwrap_or(false);
    tracing::info!("[run_agent] called agent_id={}, conv_id={:?}, message_len={}, disable_tools={}", agent_id, conversation_id, message.len(), skip_tools);
    tracing::debug!("[run_agent] message preview: {}...", &message[..message.len().min(200)]);
    let agent = service.get_agent_by_id(&agent_id)?
        .ok_or_else(|| "Agent not found".to_string())?;

    let model_id = agent.model_id.as_ref()
        .ok_or_else(|| "Agent has no model configured".to_string())?;
    let model = service.get_model_by_id(model_id)?
        .ok_or_else(|| "Model not found".to_string())?;

    let endpoint = service.get_endpoint_by_id(&model.endpoint_id)?
        .ok_or_else(|| "Endpoint not found".to_string())?;

    let provider = service.get_provider_by_id(&endpoint.provider_id)?
        .ok_or_else(|| "Provider not found".to_string())?;

    let config = crate::plugins::ai_agent::provider::ProviderConfig {
        api_key: provider.api_key.clone(),
        base_url: endpoint.base_url.clone(),
        api_type: endpoint.api_type.clone(),
        auth_type: endpoint.auth_type.clone(),
        custom_auth_header: endpoint.custom_auth_header.clone(),
    };

    let llm_provider = crate::plugins::ai_agent::openai_provider::OpenAiCompatProvider::new(config);
    let llm_provider_arc: Arc<dyn crate::plugins::ai_agent::provider::LlmProvider> = Arc::new(llm_provider);

    let fallback_provider_and_model: Option<(Arc<dyn crate::plugins::ai_agent::provider::LlmProvider>, String)> = if let Some(fb_model_id) = &agent.fallback_model_id {
        if let Ok(Some(fb_model)) = service.get_model_by_id(fb_model_id) {
            if let Ok(Some(fb_endpoint)) = service.get_endpoint_by_id(&fb_model.endpoint_id) {
                if let Ok(Some(fb_provider_row)) = service.get_provider_by_id(&fb_endpoint.provider_id) {
                    let fb_config = crate::plugins::ai_agent::provider::ProviderConfig {
                        api_key: fb_provider_row.api_key.clone(),
                        base_url: fb_endpoint.base_url.clone(),
                        api_type: fb_endpoint.api_type.clone(),
                        auth_type: fb_endpoint.auth_type.clone(),
                        custom_auth_header: fb_endpoint.custom_auth_header.clone(),
                    };
                    let fb_provider = crate::plugins::ai_agent::openai_provider::OpenAiCompatProvider::new(fb_config);
                    Some((Arc::new(fb_provider) as Arc<dyn crate::plugins::ai_agent::provider::LlmProvider>, fb_model.ref_key.clone()))
                } else {
                    None
                }
            } else {
                None
            }
        } else {
            None
        }
    } else {
        None
    };

    let tool_registry = crate::plugins::ai_agent::engine::ToolRegistry::new();
    let db = service.db();
    let notebook = service.notebook();
    let terminal_svc = service.terminal();

    let tools = Arc::new(tokio::sync::Mutex::new(tool_registry));

    // 空 tool_ids 表示「全部工具」：注册所有内置工具 + 全部已启用插件工具。
    // 这样任何未显式配置工具的 agent（默认新建 / seed 残留空值）都能调用项目所有工具，
    // 不会再出现 `Tool '' is not available`。
    let builtin_tool_ids = ["terminal", "notebook", "file", "command_history", "terminal_session", "plugin_manager", "memory"];
    let mut effective_tool_ids: Vec<String> = if agent.tool_ids.is_empty() {
        builtin_tool_ids.iter().map(|s| s.to_string()).collect()
    } else {
        agent.tool_ids.clone()
    };
    if agent.tool_ids.is_empty() {
        if let Ok(plugins) = plugin_service.list_plugins() {
            for p in &plugins {
                if p.enabled {
                    for t in &p.tools {
                        if !effective_tool_ids.contains(&t.name) {
                            effective_tool_ids.push(t.name.clone());
                        }
                    }
                }
            }
        }
    }

    // 统一判断某工具是否对该 agent 可用：空 tool_ids 视为全部可用。
    let agent_uses_tool = |name: &str| -> bool {
        agent.tool_ids.is_empty() || agent.tool_ids.iter().any(|t| t == name)
    };
    let uses_any_except = |excluded: &[&str]| -> bool {
        if agent.tool_ids.is_empty() { return true; }
        agent.tool_ids.iter().any(|t| !excluded.contains(&t.as_str()))
    };

    if !skip_tools {
        for tool_id in &effective_tool_ids {
            match tool_id.as_str() {
                "terminal" => {
                    let ws_dir = crate::plugins::ai_agent::file_tool::resolve_workspace_dir(&agent.workspace_dir, &agent.id);
                    let mut reg = tools.lock().await;
                    reg.register(Arc::new(crate::plugins::ai_agent::terminal_tool::TerminalTool::new().with_working_dir(ws_dir.to_string_lossy().to_string())));
                }
                "notebook" => {
                    let mut reg = tools.lock().await;
                    reg.register(Arc::new(crate::plugins::ai_agent::notebook_tool::NotebookTool::with_notebook(db.clone(), notebook.clone())));
                }
                "file" => {
                    let ws_dir = crate::plugins::ai_agent::file_tool::resolve_workspace_dir(&agent.workspace_dir, &agent.id);
                    let mut reg = tools.lock().await;
                    reg.register(Arc::new(crate::plugins::ai_agent::file_tool::FileTool::new(ws_dir)));
                }
                "command_history" => {
                    let mut reg = tools.lock().await;
                    reg.register(Arc::new(crate::plugins::ai_agent::command_history_tool::CommandHistoryTool::new(db.clone())));
                }
                "terminal_session" => {
                    let mut reg = tools.lock().await;
                    reg.register(Arc::new(crate::plugins::ai_agent::terminal_session_tool::TerminalSessionTool::new(terminal_svc.clone())));
                }
                "plugin_manager" => {
                    let ws_dir = crate::plugins::ai_agent::file_tool::resolve_workspace_dir(&agent.workspace_dir, &agent.id);
                    let mut reg = tools.lock().await;
                    reg.register(Arc::new(crate::plugins::ai_agent::plugin_manager_tool::PluginManagerTool::with_context(
                        plugin_service.inner().clone(),
                        tools.clone(),
                        service.inner().clone(),
                        agent.id.clone(),
                        ws_dir,
                    )));
                }
                "memory" => {
                    let agent_memory_dir = plugin_service.inner().data_dir()
                        .join("agents").join(&agent.id);
                    let mut reg = tools.lock().await;
                    reg.register(Arc::new(crate::plugins::ai_agent::memory_tool::MemoryTool::new(agent_memory_dir)));
                }
                _ => {
                    if let Ok(Some((pid, plugin_tool))) = plugin_service.inner().find_enabled_tool(tool_id) {
                        let ws_dir = crate::plugins::ai_agent::file_tool::resolve_workspace_dir(&agent.workspace_dir, &agent.id);
                        let mut reg = tools.lock().await;
                        let agent_tool = crate::plugins::ai_agent::plugin_tool::PluginAgentTool::new(plugin_tool, ws_dir)
                            .with_logging(plugin_service.inner().clone(), pid);
                        reg.register(Arc::new(agent_tool));
                    }
                }
            }
        }
    }

    let conv_id = conversation_id.unwrap_or_else(|| {
        uuid::Uuid::new_v4().to_string()
    });

    let cancel_token = CancellationToken::new();
    let cancel_token_clone = cancel_token.clone();
    {
        let mut tokens = CANCEL_TOKENS.lock().await;
        tokens.insert(conv_id.clone(), cancel_token_clone);
    }

    let mut system_prompt = agent.system_prompt.clone();

    // Add conversation continuity instruction — critical for polish/refine mode
    system_prompt.push_str("\n\n## Conversation Continuity — CRITICAL\n\
You are in an ongoing conversation session. All previous messages in this conversation are part of your context.\n\
\n\
CRITICAL RULES FOR MAINTAINING CONTEXT:\n\
- ALWAYS review the conversation history before responding. The user's requests build on prior exchanges.\n\
- When the user says \"refine this\" or \"improve that\", they are referring to something discussed or built earlier in THIS conversation.\n\
- DO NOT start from scratch — always build on what was previously established.\n\
- If the user references a previous change, decision, or result, look back through the conversation to find it.\n\
- When working on iterative improvements (polish mode), maintain awareness of:\n\
  * What the original state was\n\
  * What changes were already applied\n\
  * What the current state is\n\
  * What the user wants to improve next\n\
- YOU ARE NOT starting a new conversation each time the user sends a message. This is ONE continuous session.\n\
- Previous tool results, analysis, and decisions are all part of your current context — use them.\n");


    if !skip_tools {
        if let Ok(enabled_plugins) = plugin_service.list_plugins() {
        let agent_tool_set: std::collections::HashSet<String> = effective_tool_ids.iter().cloned().collect();

        let relevant_plugins: Vec<_> = enabled_plugins
            .iter()
            .filter(|p| p.enabled && p.tools.iter().any(|t| agent_tool_set.contains(&t.name)))
            .collect();

        if !relevant_plugins.is_empty() {
            let mut scenario_section = String::from("\n\n## Available Plugin Capabilities\n");
            scenario_section.push_str(
                "CRITICAL RULE — YOU MUST OBEY:\n\
1. When a user's request matches ANY plugin scenario below, you MUST call the corresponding tool FIRST to get real data.\n\
2. You are FORBIDDEN from answering based on your own knowledge when a relevant tool is available.\n\
3. Your response MUST be based on the actual tool results, not your training data.\n\
4. If you are unsure whether to use a tool, ALWAYS use the tool — it is better to call a tool unnecessarily than to skip it.\n\
5. After receiving tool results, analyze them and provide your answer based on the actual data.\n\n"
            );
            scenario_section.push_str("The following plugins and their tools are available to you:\n");

            for plugin in &relevant_plugins {
                scenario_section.push_str(&format!("\n### {} (v{})\n{}\n", plugin.name, plugin.version, plugin.description));

                let agent_owned_tools: Vec<_> = plugin.tools.iter()
                    .filter(|t| agent_tool_set.contains(&t.name))
                    .collect();
                scenario_section.push_str(&format!("Tools: {}\n",
                    agent_owned_tools.iter().map(|t| format!("`{}` — {}", t.name, t.description)).collect::<Vec<_>>().join("; ")
                ));

                if !plugin.scenarios.is_empty() {
                    scenario_section.push_str("Usage scenarios:\n");
                    for scenario in &plugin.scenarios {
                        let tool_name = if !scenario.tool_name.is_empty() {
                            scenario.tool_name.as_str()
                        } else {
                            agent_owned_tools.first().map(|t| t.name.as_str()).unwrap_or("unknown")
                        };
                        let mut s = scenario.clone();
                        s.sanitize();
                        scenario_section.push_str(&format!("- **{}**: {} → Use tool: `{}` (example: \"{}\")\n",
                            s.name, s.description,
                            tool_name,
                            s.example_prompt));
                    }
                }
                if !plugin.trigger_keywords.is_empty() {
                    scenario_section.push_str(&format!("Trigger keywords: {}\n", plugin.trigger_keywords.join(", ")));
                }
            }

            system_prompt.push_str(&scenario_section);
        }
    }

    if agent_uses_tool("plugin_manager") {
        system_prompt.push_str("\n\n## Plugin Refinement Workflow\n\
When the user asks you to refine, improve, or fix a plugin, you MUST follow this exact workflow:\n\
1. **READ**: Use the `plugin_manager` tool with action `get` and the plugin_id to read the plugin's full code, tools, and configuration.\n\
2. **ANALYZE**: Review the code for issues: missing error handling, edge cases, performance problems, unclear descriptions, or missing parameters.\n\
3. **REFINE**: Use the `plugin_manager` tool with action `refine` to apply improvements. Include `changelog_changes` to document what was changed.\n\
4. **TEST**: Use the `plugin_manager` tool with action `test` to verify the refined tool works correctly with sample parameters.\n\
NEVER skip the READ step and answer from memory. ALWAYS call the actual tools to get real data and make real changes.\n");
    }

    if agent_uses_tool("file") {
        let ws_dir = crate::plugins::ai_agent::file_tool::resolve_workspace_dir(&agent.workspace_dir, &agent.id);
        system_prompt.push_str(&format!("\n\n## File & Document Analysis\n\
When the user's message contains file attachment paths in the format `[附件: /path/to/file]`, you MUST:\n\
1. Use the `file` tool with action `analyze` and the file path to extract the document content.\n\
2. For text files (txt, md, json, yaml, code files), you can also use action `read`.\n\
3. For documents (PDF, DOCX, XLSX, CSV), use action `analyze` which will auto-detect the format and extract text.\n\
4. After reading the file content, analyze it and respond based on the actual file data.\n\
5. NEVER skip reading the file and answer from your own knowledge — always read the actual file first.\n\
6. If the file tool returns an error (e.g., unsupported format), inform the user about the limitation.\n\n\
## Agent Workspace\n\
Your workspace directory is: `{}`\n\
- When you need to write or save files, use the `file` tool with action `write` and a relative path (e.g., `report.md`, `output/data.json`).\n\
- Relative paths are automatically resolved under your workspace output directory.\n\
- You can also use absolute paths if needed, but prefer relative paths for workspace outputs.\n\
- The `{{{{output_path}}}}` variable in plugin scripts resolves to your workspace directory.\n", ws_dir.display()));
    } else if !agent.workspace_dir.is_empty() || uses_any_except(&["memory", "plugin_manager", "command_history"]) {
        let ws_dir = crate::plugins::ai_agent::file_tool::resolve_workspace_dir(&agent.workspace_dir, &agent.id);
        system_prompt.push_str(&format!("\n\n## Agent Workspace\n\
Your workspace directory is: `{}`\n\
- When plugin tools produce output files, they are saved in this directory.\n\
- The `{{{{output_path}}}}` variable in plugin scripts resolves to this directory.\n", ws_dir.display()));
    }

    if agent_uses_tool("memory") {
        let agent_memory_dir = plugin_service.inner().data_dir()
            .join("agents").join(&agent.id);
        let memory_tool = crate::plugins::ai_agent::memory_tool::MemoryTool::new(agent_memory_dir);
        let memory_context = memory_tool.load_memory_for_prompt();
        if !memory_context.is_empty() {
            system_prompt.push_str(&memory_context);
        }
    }
    }

    {
        let mut context_parts = Vec::new();

        if let Ok(cwd) = std::env::current_dir() {
            context_parts.push(format!("Working Directory: {}", cwd.display()));
        }

        if let Ok(hostname) = hostname::get() {
            context_parts.push(format!("Host: {}", hostname.to_string_lossy()));
        }

        if let Ok(output) = std::process::Command::new("git")
            .args(["rev-parse", "--is-inside-work-tree"])
            .output()
        {
            if output.status.success() {
                let is_git = String::from_utf8_lossy(&output.stdout).trim() == "true";
                if is_git {
                    if let Ok(branch_output) = std::process::Command::new("git")
                        .args(["branch", "--show-current"])
                        .output()
                    {
                        let branch = String::from_utf8_lossy(&branch_output.stdout).trim().to_string();
                        if !branch.is_empty() {
                            context_parts.push(format!("Git Branch: {}", branch));
                        }
                    }

                    if let Ok(status_output) = std::process::Command::new("git")
                        .args(["status", "--short"])
                        .output()
                    {
                        let status = String::from_utf8_lossy(&status_output.stdout).trim().to_string();
                        if !status.is_empty() {
                            let lines: Vec<&str> = status.lines().take(20).collect();
                            context_parts.push(format!("Git Status ({} changes):\n{}", lines.len(), lines.join("\n")));
                        } else {
                            context_parts.push("Git Status: clean".to_string());
                        }
                    }
                }
            }
        }

        if !context_parts.is_empty() {
            system_prompt.push_str(&format!("\n\n--- Project Context ---\n{}\n--- End Context ---", context_parts.join("\n")));
        }
    }

    let permission_mode = match agent.permission_mode.as_str() {
        "auto" => crate::plugins::ai_agent::permission::PermissionMode::Auto,
        _ => crate::plugins::ai_agent::permission::PermissionMode::Confirm,
    };

    let conv_id_for_perm = conv_id.clone();
    let agent_id_for_perm = agent.id.clone();
    let app_handle_for_perm = app_handle.clone();
    let permission_requester: crate::plugins::ai_agent::engine::PermissionRequesterFn = Arc::new(
        move |req: crate::plugins::ai_agent::permission::PermissionRequest| {
            let mut req_with_id = req;
            req_with_id.conversation_id = conv_id_for_perm.clone();
            let handle = app_handle_for_perm.clone();
            let agent_id = agent_id_for_perm.clone();

            Box::pin(async move {
                let (tx, rx) = tokio::sync::oneshot::channel::<(bool, bool)>();

                {
                    let mut pending = PENDING_PERMISSIONS.lock().await;
                    pending.insert(req_with_id.conversation_id.clone(), (tx, agent_id.clone(), req_with_id.tool_name.clone()));
                }

                if let Err(e) = handle.emit("agent-permission-request", serde_json::json!({
                    "conversationId": req_with_id.conversation_id,
                    "agentId": agent_id,
                    "toolName": req_with_id.tool_name,
                    "arguments": req_with_id.arguments,
                    "riskLevel": match req_with_id.risk_level {
                        crate::plugins::ai_agent::permission::ToolRiskLevel::Low => "low",
                        crate::plugins::ai_agent::permission::ToolRiskLevel::High => "high",
                    },
                    "description": req_with_id.description,
                })) {
                    tracing::warn!("[run_agent] failed to emit agent-permission-request: {}", e);
                }

                match tokio::time::timeout(std::time::Duration::from_secs(60), rx).await {
                    Ok(Ok(result)) => result,
                    _ => (false, false),
                }
            })
        }
    );

    // 远程桌面安装助手：把会话 metadata 中的目标终端会话注入 system prompt，
    // 让 agent 知道该驱动哪个 terminal_session。普通对话无 rdSetup 字段，不受影响。
    let mut auto_continue_rd = false;
    if let Ok(Some(conv_row)) = service.find_conversation(&conv_id) {
        if !conv_row.compaction_summary.is_empty() {
            system_prompt.push_str(&format!(
                "\n\n[Previous Conversation Summary]\n{}\n[/Previous Conversation Summary]",
                conv_row.compaction_summary
            ));
        }
        if !conv_row.metadata.is_empty() && conv_row.metadata != "{}" {
            if let Ok(meta) = serde_json::from_str::<serde_json::Value>(&conv_row.metadata) {
                if let Some(rd) = meta.get("rdSetup") {
                    let session_id = rd.get("sessionId").and_then(|v| v.as_str()).unwrap_or("");
                    let host = rd.get("host").and_then(|v| v.as_str()).unwrap_or("");
                    let username = rd.get("username").and_then(|v| v.as_str()).unwrap_or("");
                    let install_mode = rd.get("installMode").and_then(|v| v.as_str()).unwrap_or("basic");
                    let install_mode_guide = match install_mode {
                        "headless" => "`headless` (无桌面版): packages = VNC Server + xterm only, NO desktop environment.",
                        "full" => "`full` (全量安装): packages = TigerVNC + XFCE desktop + common apps (Debian: xfce4 xfce4-terminal thunar xfce4-goodies; RHEL/Arch: xfce4 xfce4-terminal thunar).",
                        _ => "`basic` (基础桌面版): packages = TigerVNC + minimal XFCE (Debian/Ubuntu: `--no-install-recommends xfce4 xfce4-terminal`).",
                    };
                    // 提示词国际化：会话 metadata 携带用户界面语言，en → 英文注入，其余 → 中文注入。
                    let is_en = rd.get("lang").and_then(|v| v.as_str()).map(|l| l.starts_with("en")).unwrap_or(false);
                    if !session_id.is_empty() {
                        if is_en {
                            system_prompt.push_str(&format!(
                                "\n\n## Remote Desktop Setup Context\n\
You are helping set up a VNC remote desktop on a remote server.\n\
- Active terminal session id to drive: `{}`\n\
- Target host: `{}` (user: `{}`)\n\
- Install mode (user-selected): `{}` — install exactly this variant, nothing more, nothing less.\n\
ALWAYS use the `terminal_session` tool with action `write`, `session_id` set to the id above, and the command to run. After writing, use action `read_output` to read the result. Do NOT use any other session id.\n\
The remote server's sudo password prompts are auto-answered by the terminal session — just run sudo commands normally.\n\
\n\
Besides installing/configuring VNC, the user may also ask you to do other remote-server maintenance or answer questions (change passwords, check port usage, explain commands, clean disk, chat). Treat those as normal requests and assist via `terminal_session`.\n\
\n\
WORKFLOW (strict three-phase, do NOT skip or merge):\n\
\n\
PHASE 0 — RECON (read-only, NO system changes, mandatory first): Gather the environment profile with a few non-destructive commands, e.g. \
`cat /etc/os-release; uname -a; for pm in apt apt-get dnf yum zypper pacman apk; do command -v $pm && break; done; command -v vncserver Xvnc tigervncserver; command -v xfce4-session gnome-session startkde; ss -ltn 2>/dev/null | grep -q ':5901' && echo PORT_OPEN || echo PORT_CLOSED; id -u; sudo -n true 2>/dev/null && echo SUDO_OK || echo SUDO_NEED_PW`. \
Capture: distro + version, architecture, available package manager, whether a desktop environment already exists, current VNC status, sudo availability, and any obvious dependency conflicts. Do NOT install or modify anything in this phase.\n\
\n\
PHASE 1 — REPORT + CONSENT: Summarize the environment profile in a few lines, then end with EXACTLY one line: `RD_STATUS: installed` (VNC already configured & listening) or `RD_STATUS: not_installed`. \
If not_installed, briefly state the install plan for the chosen mode: which packages, the exact non-interactive install command for THIS distro's package manager, how you will set the VNC password and write xstartup, and how you will start/verify. **Ask the user which VNC password they want to use for connecting (so they can actually log in afterwards).** STOP here and wait for the user. Do NOT begin installing.\n\
\n\
PHASE 2 — INSTALL ONLY AFTER EXPLICIT CONSENT: Only after the user clearly agrees (同意 / 开始安装 / yes) do you execute the planned commands. \
You ALREADY know the distro and package manager from PHASE 0 — do NOT re-detect them; run the correct commands directly. Install exactly per the selected mode: {}\n\
Use the VNC password the user provided in PHASE 1 when running `vncpasswd`; if they did not provide one, generate a simple password and **state it clearly in your final summary** so they can connect. \
Follow the non-interactive HARD RULES from your system prompt (any command that stops to ask is a bug): Debian/Ubuntu must use the full guardrail chain (DEBIAN_FRONTEND=noninteractive + DEBIAN_PRIORITY=critical + --force-confdef --force-confold + -o DPkg::Lock::Timeout=600 + dpkg --configure -a self-heal + debconf pre-seed for keyboard-configuration only if not installed; NEVER pre-seed tzdata; NEVER add `< /dev/null`; NEVER use `apt`, use `apt-get`). SUSE must use `zypper --non-interactive --gpg-auto-import-keys install --auto-agree-with-licenses`. Gentoo must use `emerge --ask=n`, never `--ask`. Set the VNC password (answer `Password:` then `Verify:`; if asked about a view-only password, answer `n`), write ~/.vnc/xstartup, start vncserver, verify it listens on 5901. \
Drive the terminal autonomously: keep issuing `terminal_session` calls until verified, and do NOT end your turn with a plain-text status update or speculative progress claims (e.g. do NOT say 'download finished, will auto-continue'). When fully verified, output a single final summary containing the word 完成 (or \"done\").\n\
If the user does not consent, stop and do nothing.\n\
LANGUAGE RULE: The user's UI language is English — ALWAYS reply entirely in English. Only the `RD_STATUS:` marker line is machine-parsed and must stay exactly as specified.\n",
                                session_id, host, username, install_mode, install_mode_guide
                            ));
                        } else {
                            system_prompt.push_str(&format!(
                                "\n\n## Remote Desktop Setup Context\n\
你在帮助用户在远程服务器上安装配置 VNC 远程桌面。\n\
- 需要驱动的活动终端会话 id：`{}`\n\
- 目标主机：`{}`（用户：`{}`）\n\
- 安装模式（用户选择）：`{}` —— 严格按该模式安装，不多不少。\n\
务必使用 `terminal_session` 工具，action 为 `write`，session_id 用上面的 id，并带上要执行的命令；写完后用 `read_output` 读取结果。不要使用其它 session_id。\n\
远程服务器的 sudo 密码提示会被终端自动应答 —— 正常执行 sudo 命令即可。\n\
\n\
除安装/配置 VNC 外，用户也可能让你做其它远程维护或问答（改密码、查端口、解释命令、清理磁盘、聊天等），都通过 `terminal_session` 正常协助。\n\
\n\
工作流（严格三阶段，不要跳过或合并）：\n\
\n\
PHASE 0 — 侦察（只读，不改动系统，必须先做）：用几条非破坏性命令收集环境画像，例如 \
`cat /etc/os-release; uname -a; for pm in apt apt-get dnf yum zypper pacman apk; do command -v $pm && break; done; command -v vncserver Xvnc tigervncserver; command -v xfce4-session gnome-session startkde; ss -ltn 2>/dev/null | grep -q ':5901' && echo PORT_OPEN || echo PORT_CLOSED; id -u; sudo -n true 2>/dev/null && echo SUDO_OK || echo SUDO_NEED_PW`。\
记录：发行版+版本、架构、可用的包管理器、是否已有桌面环境、当前 VNC 状态、sudo 可用性、明显的依赖冲突。本阶段不要安装或修改任何东西。\n\
\n\
PHASE 1 — 汇报 + 征求同意：用几行总结环境画像，然后以**恰好一行**结束：`RD_STATUS: installed`（VNC 已配置且在监听）或 `RD_STATUS: not_installed`。\
若为 not_installed，简要说明所选模式的安装计划：装哪些包、针对本发行版包管理器的确切非交互安装命令、如何设置 VNC 密码和写 xstartup、如何启动并验证。**询问用户希望用哪个 VNC 密码连接（这样之后才能登录）**。停在这里等待用户，不要开始安装。\n\
\n\
PHASE 2 — 仅在用户明确同意后安装（同意 / 开始安装 / yes）：用户明确同意后才执行计划命令。\
你已经从 PHASE 0 知道发行版和包管理器 —— 不要重新探测，直接执行正确命令。严格按所选模式安装：{}\n\
设置 VNC 密码时使用用户在 PHASE 1 提供的密码；未提供则生成简单密码并在**最终总结中明确告知**。\
遵守系统提示词中的「无人值守铁律」（任何会停下来问的命令都是 bug）：Debian/Ubuntu 必须用全套护栏（DEBIAN_FRONTEND=noninteractive + DEBIAN_PRIORITY=critical + --force-confdef --force-confold + -o DPkg::Lock::Timeout=600 + dpkg --configure -a 自愈 + 仅在未安装时 debconf 预置 keyboard-configuration；绝不预置 tzdata；绝不加 `< /dev/null`；用 apt-get 不用 apt）。SUSE 必须用 `zypper --non-interactive --gpg-auto-import-keys install --auto-agree-with-licenses`。Gentoo 必须用 `emerge --ask=n`，绝不用 `--ask`。写 ~/.vnc/xstartup，启动 vncserver，验证 5901 在监听。\
自主驱动终端：持续调用 `terminal_session` 直到验证完成，不要用纯文本状态更新或猜测性进度来结束回合（例如不要说「下载完成，将自动继续」）。全部验证通过后，输出一条包含「完成」（或 \"done\"）的最终总结。\n\
如果用户不同意，停止且什么都不做。\n\
语言规则：用户界面为中文 —— 请始终用简体中文回复；`RD_STATUS:` 标记行按原样输出，语言无关。\n",
                                session_id, host, username, install_mode, install_mode_guide
                            ));
                        }
                        // 安装是长任务，开启引擎自动续跑：模型中途返回纯文本也不停下，
                        // 由引擎注入提醒继续驱动终端，避免每步都等用户点"继续"。
                        // 但检查结论 / 征询用户意见时引擎不会自动续跑（见 engine.rs awaiting_user 判定）。
                        auto_continue_rd = true;
                    }
                }
            }
        }
    }

    // 输出语言跟随用户界面语言（最终指令，放在 system prompt 最末尾最有效）。
    // 对用户自定义 System Prompt 的智能体（终端助手等）同样生效：不翻译用户 prompt 内容，
    // 只锁定回复语言。会话 metadata 由前端 AiCopilotPage 写入 lang 字段。
    if let Ok(Some(conv_meta_row)) = service.find_conversation(&conv_id) {
        if let Ok(meta) = serde_json::from_str::<serde_json::Value>(&conv_meta_row.metadata) {
            let ui_is_en = meta.get("lang").and_then(|v| v.as_str()).map(|l| l.starts_with("en")).unwrap_or(false);
            if ui_is_en {
                system_prompt.push_str("\n\nLANGUAGE RULE (final, overrides everything above): The user's UI language is English. ALWAYS write your ENTIRE reply in English, regardless of the language of the user's message or any instruction above. Keep machine-parsed markers (e.g. RD_STATUS) as specified.");
            } else {
                system_prompt.push_str("\n\n语言规则（最终指令，覆盖以上所有内容）：用户界面语言为中文，请始终用简体中文回复，无论用户消息或以上任何指令是什么语言。机器解析标记（如 RD_STATUS）保持原样。");
            }
        }
    }

    let mut engine_builder = crate::plugins::ai_agent::engine::AgentEngine::new(
        llm_provider_arc,
        tools,
        model.ref_key.clone(),
        system_prompt,
        agent.temperature,
        agent.max_iterations,
    )
    .with_cancel_token(cancel_token)
    .with_agent_id(agent.id.clone())
    .with_permission_mode(permission_mode)
    .with_always_allowed_tools(agent.always_allowed_tools.clone())
    .with_permission_requester(permission_requester)
    .with_auto_continue(auto_continue_rd);

    if let Some((fb_provider, fb_model)) = fallback_provider_and_model {
        engine_builder = engine_builder.with_fallback(fb_provider, fb_model);
    }

    let engine = engine_builder;

    let mut history: Vec<crate::plugins::ai_agent::provider::ChatMessage> = if let Ok(db_msgs) = service.list_messages(&conv_id) {
        tracing::info!("[run_agent] loaded {} messages from DB for conv_id={}", db_msgs.len(), conv_id);
        db_msgs.iter().map(|m| {
            let tool_calls: Option<Vec<crate::plugins::ai_agent::provider::ToolCall>> = 
                if m.tool_calls.is_empty() || m.tool_calls == "[]" {
                    None
                } else {
                    serde_json::from_str(&m.tool_calls).ok()
                };
            let tool_call_id = if m.role == "tool" {
                Some(m.id.strip_prefix("tool-")
                    .map(|s| {
                        let parts: Vec<&str> = s.splitn(2, '-').collect();
                        parts.get(1).map(|p| p.to_string()).unwrap_or_else(|| m.id.clone())
                    })
                    .unwrap_or_else(|| m.id.clone()))
            } else {
                None
            };
            crate::plugins::ai_agent::provider::ChatMessage {
                role: m.role.clone(),
                content: m.content.clone(),
                tool_calls,
                tool_call_id,
            }
        }).collect::<Vec<_>>()
    } else {
        Vec::new()
    };

    // Deduplicate: the frontend saves the user message to DB before calling run_agent,
    // so the same message appears in both history and the `message` parameter.
    // Remove the last message from history if it's a user message matching the current input,
    // to avoid sending duplicate messages to the LLM.
    if let Some(last) = history.last() {
        if last.role == "user" && last.content == message {
            tracing::info!("[run_agent] deduplicating: removing last user message from history (matches current input)");
            history.pop();
        }
    }

    let old_fingerprints: std::collections::HashSet<u64> = history.iter()
        .filter(|m| m.role == "assistant" || m.role == "tool")
        .map(|m| {
            use std::hash::{Hash, Hasher};
            let mut hasher = std::collections::hash_map::DefaultHasher::new();
            m.role.hash(&mut hasher);
            m.content.hash(&mut hasher);
            hasher.finish()
        })
        .collect();

    tracing::info!("[run_agent] history after dedup: {} messages, old_fingerprints: {}", history.len(), old_fingerprints.len());

    let persister_conv_id = conv_id.clone();
    let persister_service: Arc<AgentService> = service.inner().clone();
    let persisted_ids: Arc<std::sync::Mutex<Vec<String>>> = Arc::new(std::sync::Mutex::new(Vec::new()));
    let persisted_ids_clone = persisted_ids.clone();
    let persister_run_ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64;
    let persister_asst_counter: Arc<std::sync::Mutex<u32>> = Arc::new(std::sync::Mutex::new(0));
    let persister_tool_counter: Arc<std::sync::Mutex<u32>> = Arc::new(std::sync::Mutex::new(0));

    let message_persister = Arc::new(move |pm: crate::plugins::ai_agent::engine::PersistMessage| {
        if pm.role == "system_compaction" {
            if let Err(e) = persister_service.update_compaction_summary(&persister_conv_id, &pm.content) {
                tracing::warn!("[run_agent] persister: failed to update compaction summary: {}", e);
            }
            return;
        }
        let msg_id = if pm.role == "tool" {
            let tc_id = pm.tool_call_id.as_deref().filter(|s| !s.is_empty());
            if let Some(id) = tc_id {
                format!("tool-{}-{}", persister_conv_id, id)
            } else {
                let counter = match persister_tool_counter.lock() {
                    Ok(mut guard) => {
                        let c = *guard;
                        *guard += 1;
                        c
                    }
                    Err(_) => return,
                };
                tracing::warn!("[run_agent] persister: tool_call_id is empty for tool message, using counter={}", counter);
                format!("tool-{}-auto-{}", persister_conv_id, counter)
            }
        } else {
            let counter = match persister_asst_counter.lock() {
                Ok(mut guard) => {
                    let c = *guard;
                    *guard += 1;
                    c
                }
                Err(_) => return,
            };
            let id = format!("asst-{}-{}-{}", persister_conv_id, persister_run_ts, counter);
            id
        };
        let tool_calls_str = pm.tool_calls.as_ref()
            .map(|tc| serde_json::to_string(tc).unwrap_or_default())
            .unwrap_or_default();
        let msg_created_at = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as i64;
        let id_for_track = msg_id.clone();
        match persister_service.save_message(AiMessageRow {
            id: msg_id,
            conversation_id: persister_conv_id.clone(),
            role: pm.role.clone(),
            content: pm.content.clone(),
            tool_calls: tool_calls_str,
            is_error: if pm.is_error { 1 } else { 0 },
            created_at: msg_created_at,
        }) {
            Ok(()) => {
                tracing::info!("[run_agent] persister: saved message id={}, role={}, conv_id={}", id_for_track, pm.role, persister_conv_id);
                if let Ok(mut ids) = persisted_ids_clone.lock() {
                    ids.push(id_for_track);
                }
            }
            Err(e) => {
                tracing::error!("[run_agent] persister: FAILED to save message id={}, role={}, conv_id={}, error={}", id_for_track, pm.role, persister_conv_id, e);
            }
        }
    });

    let engine = engine.with_message_persister(message_persister);

    let emit_handle = app_handle.clone();
    let conv_id_clone = conv_id.clone();
    let emit_compaction = app_handle.clone();
    let conv_id_compaction = conv_id.clone();
    let emit_tool = app_handle.clone();
    let conv_id_tool = conv_id.clone();
    let result = engine.run(&message, history,
        move |chunk| {
            if chunk.starts_with("[Auto-compacting") || chunk.starts_with("[Compacted:") || chunk.starts_with("[Compaction") || chunk.starts_with("[Context too long") {
                if let Err(e) = emit_compaction.emit("agent-compaction", serde_json::json!({
                    "conversationId": conv_id_compaction,
                    "message": chunk.trim(),
                })) {
                    tracing::warn!("[run_agent] failed to emit agent-compaction: {}", e);
                }
            }
            if let Err(e) = emit_handle.emit("agent-chunk", serde_json::json!({
                "conversationId": conv_id_clone,
                "chunk": chunk,
            })) {
                tracing::warn!("[run_agent] failed to emit agent-chunk: {}", e);
            }
        },
        move |tool_event| {
            if let Err(e) = emit_tool.emit("agent-tool-call", serde_json::json!({
                "conversationId": conv_id_tool,
                "toolCall": tool_event,
            })) {
                tracing::warn!("[run_agent] failed to emit agent-tool-call: {}", e);
            }
        },
    ).await;

    tracing::info!("[run_agent] engine.run completed, result={}, conv_id={}", result.is_ok(), conv_id);

    {
        let mut tokens = CANCEL_TOKENS.lock().await;
        tokens.remove(&conv_id);
    }

    match result {
        Ok(run_result) => {
            tracing::info!("[run_agent] run_result: final_content_len={}, total_messages={}", run_result.final_content.len(), run_result.messages.len());
            let already_persisted: Vec<String> = persisted_ids.lock()
                .map_err(|e| format!("Agent persister error: {}", e))?.drain(..).collect();
            tracing::info!(
                "[run_agent] {} messages already persisted incrementally, checking for any missed",
                already_persisted.len()
            );
            // Counter that mirrors the incremental persister's counter.
            // The incremental persister starts at 0 and increments per NEW assistant message.
            // The final sweep must generate IDs that match the ones already saved,
            // so the already_persisted check can correctly skip them.
            let mut final_sweep_asst_idx: u32 = 0;
            let mut final_sweep_tool_idx: u32 = 0;
            for msg in &run_result.messages {
                if msg.role == "assistant" || msg.role == "tool" {
                    {
                        use std::hash::{Hash, Hasher};
                        let mut hasher = std::collections::hash_map::DefaultHasher::new();
                        msg.role.hash(&mut hasher);
                        msg.content.hash(&mut hasher);
                        let fingerprint = hasher.finish();
                        if old_fingerprints.contains(&fingerprint) {
                            continue;
                        }
                    }
                    let expected_id = if msg.role == "tool" {
                        let tc_id = msg.tool_call_id.as_deref().filter(|s| !s.is_empty());
                        if let Some(id) = tc_id {
                            format!("tool-{}-{}", conv_id, id)
                        } else {
                            let idx = final_sweep_tool_idx;
                            final_sweep_tool_idx += 1;
                            format!("tool-{}-auto-{}", conv_id, idx)
                        }
                    } else {
                        // Use the same counter scheme as the incremental persister:
                        // only count NEW assistant messages (history ones are already
                        // filtered out by the fingerprint check above).
                        let idx = final_sweep_asst_idx;
                        final_sweep_asst_idx += 1;
                        format!("asst-{}-{}-{}", conv_id, persister_run_ts, idx)
                    };
                    if already_persisted.contains(&expected_id) {
                        continue;
                    }
                    let run_ts = std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_millis() as i64;
                    let tool_calls_str = msg.tool_calls.as_ref()
                        .map(|tc| serde_json::to_string(tc).unwrap_or_default())
                        .unwrap_or_default();
                    let id_for_log = expected_id.clone();
                    match service.save_message(AiMessageRow {
                        id: expected_id,
                        conversation_id: conv_id.clone(),
                        role: msg.role.clone(),
                        content: msg.content.clone(),
                        tool_calls: tool_calls_str,
                        is_error: 0,
                        created_at: run_ts,
                    }) {
                        Ok(()) => {
                            tracing::info!("[run_agent] final_sweep: saved message id={}, role={}", id_for_log, msg.role);
                        }
                        Err(e) => {
                            tracing::error!("[run_agent] final_sweep: FAILED to save message id={}, role={}, error={}", id_for_log, msg.role, e);
                        }
                    }
                }
            }

            if let Err(e) = service.touch_conversation(&conv_id) {
                tracing::warn!("[run_agent] failed to touch conversation {}: {}", conv_id, e);
            }

            tracing::info!("[run_agent] emitting agent-done, conv_id={}, response_len={}", conv_id, run_result.final_content.len());
            if let Err(e) = app_handle.emit("agent-done", serde_json::json!({
                "conversationId": conv_id,
                "response": run_result.final_content,
            })) {
                tracing::warn!("[run_agent] failed to emit agent-done for {}: {}", conv_id, e);
            }
            tracing::info!("[run_agent] agent-done emitted successfully, conv_id={}", conv_id);
            Ok(run_result.final_content)
        }
        Err(e) => {
            tracing::error!("[run_agent] engine.run failed: {}, conv_id={}", e, conv_id);
            if let Err(emit_err) = app_handle.emit("agent-error", serde_json::json!({
                "conversationId": conv_id,
                "error": e,
            })) {
                tracing::warn!("[run_agent] failed to emit agent-error for {}: {}", conv_id, emit_err);
            }
            tracing::info!("[run_agent] agent-error emitted, conv_id={}", conv_id);
            Err(e)
        }
    }
}

#[tauri::command]
pub async fn stop_agent(
    conversation_id: String,
) -> Result<bool, String> {
    tracing::info!("[stop_agent] called, conversation_id={}", conversation_id);
    let tokens: tokio::sync::MutexGuard<'_, HashMap<String, CancellationToken>> = CANCEL_TOKENS.lock().await;
    if let Some(token) = tokens.get(&conversation_id) {
        token.cancel();
        tracing::info!("[stop_agent] cancellation token triggered for {}", conversation_id);
        Ok(true)
    } else {
        tracing::warn!("[stop_agent] no cancellation token found for {}", conversation_id);
        Ok(false)
    }
}

#[tauri::command]
pub fn write_frontend_log(level: String, tag: String, message: String) {
    match level.as_str() {
        "error" => tracing::error!("[Frontend:{}] {}", tag, message),
        "warn" => tracing::warn!("[Frontend:{}] {}", tag, message),
        "info" => tracing::info!("[Frontend:{}] {}", tag, message),
        _ => tracing::debug!("[Frontend:{}] {}", tag, message),
    }
}

static PENDING_PERMISSIONS: std::sync::LazyLock<tokio::sync::Mutex<HashMap<String, (tokio::sync::oneshot::Sender<(bool, bool)>, String, String)>>> =
    std::sync::LazyLock::new(|| tokio::sync::Mutex::new(HashMap::new()));

#[tauri::command]
pub async fn respond_permission(
    conversation_id: String,
    approved: bool,
    always_allow: bool,
    service: State<'_, Arc<AgentService>>,
) -> Result<(), String> {
    let mut pending = PENDING_PERMISSIONS.lock().await;
    if let Some((tx, agent_id, tool_name)) = pending.remove(&conversation_id) {
        let _ = tx.send((approved, always_allow));

        if approved && always_allow {
            if let Ok(mut agents) = service.list_agents() {
                if let Some(agent) = agents.iter_mut().find(|a| a.id == agent_id) {
                    if !agent.always_allowed_tools.contains(&tool_name) {
                        let tool_name_clone = tool_name.clone();
                        agent.always_allowed_tools.push(tool_name);
                        if let Err(e) = service.save_agent(agent.clone()) {
                            tracing::error!("[respond_permission] failed to persist always_allowed for agent '{}', tool '{}': {}", agent_id, tool_name_clone, e);
                        }
                    }
                }
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub fn update_agent_allowed_tools(
    agent_id: String,
    always_allowed_tools: Vec<String>,
    service: State<'_, Arc<AgentService>>,
) -> Result<(), String> {
    let mut agents = service.list_agents()?;
    let agent = agents.iter_mut().find(|a| a.id == agent_id)
        .ok_or_else(|| format!("Agent '{}' not found", agent_id))?;
    agent.always_allowed_tools = always_allowed_tools;
    service.save_agent(agent.clone())
}

/// 专用「远程桌面安装助手」Agent 的固定 id（幂等播种，避免重复插入）。
const RD_SETUP_AGENT_ID: &str = "rd-setup-assistant";

/// 该 Agent 的领域提示词：指导其通过 terminal_session 在远程服务器上安装/配置 VNC。
/// 安装内容（无桌面 / 基础桌面 / 全量）由 run_agent 注入的「Install Mode」区块动态指定，
/// 用户可在设置指南中选择；除安装外，助手也可协助其它远程维护操作（改密码、查端口等）。
/// 中文版（默认）；英文版见 RD_SETUP_SYSTEM_PROMPT_EN，按会话语言（metadata.rdSetup.lang）选择。
const RD_SETUP_SYSTEM_PROMPT_ZH: &str = r#"你是「远程桌面安装助手」，专门帮助用户在远程 Linux 服务器上安装并配置 VNC 远程桌面（TigerVNC），以便本应用的远程桌面功能通过 VNC 连接过去进行图形化操作。

## 工作环境
- 你通过 `terminal_session` 工具操作一个已经建立好的远程服务器 SSH 终端会话。
- 会话 id、目标主机、用户名以及「安装模式」会在「Remote Desktop Setup Context」区块里提供，请严格使用该 session_id，不要编造其它 id。
- 该 SSH 会话的 sudo 密码提示会被终端自动应答，直接正常执行 sudo 命令即可，无需交互输入密码。
- 工具自带安全护栏，会拦截 `rm -rf /`、`mkfs`、`dd if=`、`fork 炸弹`、`> /dev/sd` 等危险命令；你也应避免任何破坏性操作。

## 工作步骤（按此推进）
1. 探测环境：用 `terminal_session` 的 `write` 执行 `cat /etc/os-release` 与 `uname -m`，再用 `read_output` 读取结果，判断发行版与架构。
2. 根据「Remote Desktop Setup Context」中的安装模式（Install Mode）决定安装内容：
   - `headless`（无桌面版）：只安装 VNC Server 与 xterm，不装桌面环境，连接后进入一个远程终端窗口。
   - `basic`（基础桌面版）：安装 VNC Server + XFCE 轻量桌面（最小依赖）。
   - `full`（全量安装）：安装 VNC Server + XFCE 桌面 + 常用应用。
   具体包清单见 Context 的「Install Mode」区块；安装命令必须遵守下方「无人值守铁律」。

## 无人值守铁律（CRITICAL —— 任何会停下来问的命令都是 bug，终端只自动应答 sudo 密码提示）
- Debian/Ubuntu（xfce4 会拉进 keyboard-configuration/tzdata，debconf 交互会卡死安装，务必全套护栏）：
  1) 先自愈上次中断留下的半配置态（`;` 非致命）：`sudo dpkg --configure -a;`
  2) 预置键盘布局（仅在包未装时喂，绝不覆盖已有布局；**不要预置 tzdata**，noninteractive 本就保留原时区）：
     `if ! dpkg -s keyboard-configuration >/dev/null 2>&1; then echo 'keyboard-configuration keyboard-configuration/layout select us' | sudo debconf-set-selections; fi;`
  3) 主安装（整条**单行**；`sudo env` 用真二进制，绕过 sudoers 无 SETENV 时拒绝命令行变量）：
     `sudo env DEBIAN_FRONTEND=noninteractive DEBIAN_PRIORITY=critical NEEDRESTART_MODE=l apt-get -o DPkg::Lock::Timeout=600 -o Acquire::Retries=3 -y --force-confdef --force-confold --no-install-recommends update && sudo env DEBIAN_FRONTEND=noninteractive DEBIAN_PRIORITY=critical NEEDRESTART_MODE=l apt-get -o DPkg::Lock::Timeout=600 -o Acquire::Retries=3 -y --force-confdef --force-confold --no-install-recommends install <packages>`
  - 用 `apt-get` 而非 `apt`（apt 的重绘进度条会让终端日志不可读）。
- RHEL/CentOS：`sudo dnf install -y <packages>`；若报 `No match for argument: xfce4`（RHEL 9 桌面依赖 CRB 仓库），先 `sudo dnf config-manager --set-enabled crb` 再重试。
- Arch：`sudo pacman -S --noconfirm <packages>`
- SUSE：`sudo zypper --non-interactive --gpg-auto-import-keys install --auto-agree-with-licenses <packages>`（`--non-interactive` 必须在子命令**之前**）
- Gentoo：`sudo emerge --ask=n <packages>`（**绝不能用 `--ask`，那会停下来问**）
- Void：`sudo xbps-install -Sy <packages>`
- Solus：`sudo eopkg install -y <packages>`
- Alpine：`sudo apk add --no-interactive <packages>`
- 其它发行版：先探测包管理器（`which apt` / `dnf` / `yum` / `pacman` / `zypper` / `emerge` / `xbps-install` / `eopkg` / `apk`），再查其无人值守开关。
- **禁止**给命令加 `< /dev/null` 重定向——会掐断 sudo 密码自动应答，导致永久阻塞。
- 安装命令必须**单行、可自动结束**；`update && install` 保持 `&&`，让 install 的退出码留在链尾。
3. 配置 VNC 密码：使用**用户在确认安装时提供的 VNC 密码**（PHASE 1 询问得到）。执行 `vncpasswd`，交互序列：提示 `Password:` 发送该密码 → 提示 `Verify:` 再发一次 → **若出现 view-only password 提示（`Would you like to enter a view-only password (y/n)?`）发送 `n`**。除密码提示外的任何提示都不要继续输入。若用户未提供密码，生成一个简单的（8 位左右），设置后**在最终总结里醒目告知用户**。
4. 写入 `~/.vnc/xstartup`（先 `mkdir -p ~/.vnc` 确保目录存在，避免步骤顺序变化时失败）：
   - headless 模式：启动 `xterm`（如 `xterm -geometry 160x50`）；
   - basic / full 模式：启动 XFCE（`exec startxfce4`）。
   并用 `chmod +x ~/.vnc/xstartup`。
5. 启动 VNC 服务：`vncserver :1 -geometry 1280x720`，并确认监听端口（默认 5901）。可用 `ss -ltnp 2>/dev/null | grep 590` 验证。
6. 完成后用 `read_output` 复核：确认 `vncserver` / `Xtigervnc` 进程存在、5901 端口在监听、vncpasswd 已设置；**若 PHASE 0 显示端口未开放（PORT_CLOSED）而装完仍不通，提醒用户放行 5901 的防火墙/云安全组规则**。

## 输出规范
- 每执行一步先简要说明要做什么，再调用工具。
- 遇到报错先 `read_output` 看完整信息，判断是网络/依赖/权限问题，给出修复命令重试；不要无脑重复同一条命令。
- 全部完成后，明确告诉用户：安装配置已完成，请回到设置指南点击「重新检查」以刷新状态并连接。

## 注意
- 只使用 `terminal_session` 工具，不要尝试其它工具。
- 主要职责是安装/配置 VNC；除此之外，当用户请求其它远程服务器维护操作（如修改密码、查看端口占用、解释命令、清理磁盘等）时，也通过 terminal_session 正常协助执行。
- 语言：始终用简体中文回复（用户的界面语言为中文）；`RD_STATUS:` 标记行按原样输出，语言无关。
"#;

/// 英文版（会话语言为 en 时由 seed 写入 / run_agent 动态选用）。
const RD_SETUP_SYSTEM_PROMPT_EN: &str = r#"You are the "Remote Desktop Setup Assistant", helping users install and configure a VNC remote desktop (TigerVNC) on a remote Linux server, so the app's Remote Desktop feature can connect via VNC for graphical access.

## Working Environment
- You operate an already-established SSH terminal session on the remote server via the `terminal_session` tool.
- The session id, target host, username, and the "Install Mode" are provided in the "Remote Desktop Setup Context" block — strictly use that session_id, never invent another.
- The SSH session's sudo password prompts are auto-answered by the terminal session, so run sudo commands normally without interactive password entry.
- The tool has built-in safety guards that block `rm -rf /`, `mkfs`, `dd if=`, fork bombs, `> /dev/sd`, etc.; you must also avoid any destructive operation.

## Steps (proceed in this order)
1. Probe the environment: use `terminal_session` action `write` to run `cat /etc/os-release` and `uname -m`, then `read_output` to determine the distro and architecture.
2. Pick the packages per the "Install Mode" from the "Remote Desktop Setup Context":
   - `headless` (no desktop): VNC Server + xterm only, no desktop environment; connection lands in a remote terminal window.
   - `basic` (basic desktop): VNC Server + minimal XFCE (e.g. `--no-install-recommends xfce4 xfce4-terminal`).
   - `full` (full install): VNC Server + XFCE desktop + common apps (xfce4, xfce4-terminal, thunar, etc.).
   The exact package list is in the "Install Mode" block of the Context. Install commands MUST follow the "Non-interactive HARD RULES" below.

## Non-interactive HARD RULES (CRITICAL — any command that stops to ask is a bug; the terminal only auto-answers sudo password prompts)
- Debian/Ubuntu (xfce4 pulls in keyboard-configuration/tzdata whose debconf prompts can freeze the install; use the full guardrail chain):
  1) Self-heal a half-configured state left by an interrupted install (`;` non-fatal): `sudo dpkg --configure -a;`
  2) Pre-seed the keyboard layout (only if the package is not installed; never overwrite an existing layout; **do NOT pre-seed tzdata** — noninteractive already keeps the original timezone):
     `if ! dpkg -s keyboard-configuration >/dev/null 2>&1; then echo 'keyboard-configuration keyboard-configuration/layout select us' | sudo debconf-set-selections; fi;`
  3) Main install (single line; `sudo env` uses the real binary, bypassing sudoers lacking SETENV):
     `sudo env DEBIAN_FRONTEND=noninteractive DEBIAN_PRIORITY=critical NEEDRESTART_MODE=l apt-get -o DPkg::Lock::Timeout=600 -o Acquire::Retries=3 -y --force-confdef --force-confold --no-install-recommends update && sudo env DEBIAN_FRONTEND=noninteractive DEBIAN_PRIORITY=critical NEEDRESTART_MODE=l apt-get -o DPkg::Lock::Timeout=600 -o Acquire::Retries=3 -y --force-confdef --force-confold --no-install-recommends install <packages>`
  - Use `apt-get`, never `apt` (apt's redrawn progress bar makes the terminal log unreadable).
- RHEL/CentOS: `sudo dnf install -y <packages>`; if you get `No match for argument: xfce4` (RHEL 9 desktops need the CRB repo), run `sudo dnf config-manager --set-enabled crb` first and retry.
- Arch: `sudo pacman -S --noconfirm <packages>`
- SUSE: `sudo zypper --non-interactive --gpg-auto-import-keys install --auto-agree-with-licenses <packages>` (`--non-interactive` must come BEFORE the subcommand)
- Gentoo: `sudo emerge --ask=n <packages>` (**never `--ask`**, it stops to ask)
- Void: `sudo xbps-install -Sy <packages>`
- Solus: `sudo eopkg install -y <packages>`
- Alpine: `sudo apk add --no-interactive <packages>`
- Other distros: probe the package manager first (`which apt` / `dnf` / `yum` / `pacman` / `zypper` / `emerge` / `xbps-install` / `eopkg` / `apk`), then find its non-interactive flag.
- **NEVER** append `< /dev/null` to commands — it kills the sudo password auto-answer and causes a permanent block.
- Install commands must be **single-line and self-terminating**; keep `update && install` chained with `&&` so the install exit code stays at the end.
3. Set the VNC password: use **the VNC password the user provided when consenting** (asked in PHASE 1). Run `vncpasswd`; interaction: on `Password:` send that password, on `Verify:` send it again, **and if asked about a view-only password (`Would you like to enter a view-only password (y/n)?`) answer `n`**. Never type anything for prompts other than the password prompts. If the user did not provide a password, generate a simple one (~8 chars) and **state it clearly in the final summary**.
4. Write `~/.vnc/xstartup` (first `mkdir -p ~/.vnc` to ensure the directory exists):
   - headless mode: launch `xterm` (e.g. `xterm -geometry 160x50`);
   - basic / full mode: launch XFCE (`exec startxfce4`).
   Then `chmod +x ~/.vnc/xstartup`.
5. Start the VNC server: `vncserver :1 -geometry 1280x720`, confirm the listening port (5901 by default) with `ss -ltnp 2>/dev/null | grep 590`.
6. After finishing, `read_output` to verify: `vncserver`/`Xtigervnc` process exists, port 5901 is listening, and vncpasswd is set; **if PHASE 0 reported PORT_CLOSED and it still does not connect after install, remind the user to open port 5901 in the firewall/cloud security group**.

## Output Style
- Before each step, briefly say what you are about to do, then call the tool.
- On errors, `read_output` first to see the full message, diagnose (network/dependency/permission), and retry with a fixed command; do not blindly repeat the same command.
- When everything is done, tell the user clearly: installation is complete — go back to the setup guide and click "Re-check" to refresh the status and connect.

## Notes
- Only use the `terminal_session` tool; do not try other tools.
- Your main job is installing/configuring VNC; in addition, when the user asks for other remote-server maintenance (changing passwords, checking port usage, explaining commands, cleaning disk, etc.), assist them via `terminal_session` as normal.
- Language: the user's UI language is English — ALWAYS reply entirely in English; the `RD_STATUS:` marker line is machine-parsed and stays exactly as specified.
"#;

/// 确保「远程桌面安装助手」Agent 存在（幂等）。该 Agent 仅拥有 `terminal_session` 工具，
/// 且其 `always_allowed_tools` 含 `terminal_session`（配合 `permission_mode=auto`），因此驱动设置指南
/// 里的 SSH 终端时不会每次弹出权限确认。返回该 Agent 的固定 id。
#[tauri::command]
pub fn ensure_remote_desktop_setup_agent(
    model_id: Option<String>,
    lang: Option<String>,
    service: State<'_, Arc<AgentService>>,
) -> Result<String, String> {
    fn now_ms() -> i64 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as i64
    }

    // 按会话语言选择提示词版本（en → 英文，其余 → 中文）。
    let system_prompt = if lang.as_deref().map(|l| l.starts_with("en")).unwrap_or(false) {
        RD_SETUP_SYSTEM_PROMPT_EN
    } else {
        RD_SETUP_SYSTEM_PROMPT_ZH
    };

    // 已存在则强制修复关键接线字段，避免早期残存的旧记录（tool_ids 为空 / 权限未授予）
    // 导致 agent 调不动 terminal_session（表现为 Tool '' is not available、左侧终端无输出）。
    // 保留用户可改的 name/description/model_id/created_at；强制覆盖功能性接线字段。
    if let Some(mut existing) = service.get_agent_by_id(RD_SETUP_AGENT_ID)? {
        existing.tool_ids = vec!["terminal_session".to_string()];
        existing.always_allowed_tools = vec!["terminal_session".to_string()];
        existing.permission_mode = "auto".to_string();
        existing.auto_confirm = true;
        existing.trigger_type = "manual".to_string();
        existing.system_prompt = system_prompt.to_string();
        existing.temperature = 0.2;
        existing.max_iterations = 80;
        existing.fallback_model_id = None;
        existing.workspace_dir = crate::plugins::ai_agent::file_tool::get_default_workspace_dir(RD_SETUP_AGENT_ID)
            .to_string_lossy()
            .to_string();
        existing.updated_at = now_ms();
        service.save_agent(existing)?;
        return Ok(RD_SETUP_AGENT_ID.to_string());
    }

    // 解析模型：优先使用传入的 model_id，否则取库中第一个可用 model。
    let resolved_model = match model_id {
        Some(m) if !m.is_empty() => Some(m),
        _ => service.list_models()?.first().map(|m| m.id.clone()),
    };

    // 按会话语言选择名称/描述（新建时生效；已存在的记录保留用户可能改过的 name/description）。
    let (agent_name, agent_desc) = if lang.as_deref().map(|l| l.starts_with("en")).unwrap_or(false) {
        ("Remote Desktop Setup Assistant", "Dedicated assistant for installing and configuring VNC remote desktop on a remote server; drives the setup guide's SSH terminal via the terminal_session tool.")
    } else {
        ("远程桌面安装助手", "用于在远程服务器上自动安装并配置 VNC 远程桌面的专用助手，通过 terminal_session 工具驱动设置指南中的 SSH 终端。")
    };

    let agent = AiAgentRow {
        id: RD_SETUP_AGENT_ID.to_string(),
        name: agent_name.to_string(),
        description: agent_desc.to_string(),
        model_id: resolved_model,
        system_prompt: system_prompt.to_string(),
        temperature: 0.2,
        max_iterations: 80,
        tool_ids: vec!["terminal_session".to_string()],
        trigger_type: "manual".to_string(),
        auto_confirm: true,
        permission_mode: "auto".to_string(),
        always_allowed_tools: vec!["terminal_session".to_string()],
        fallback_model_id: None,
        workspace_dir: crate::plugins::ai_agent::file_tool::get_default_workspace_dir(RD_SETUP_AGENT_ID)
            .to_string_lossy()
            .to_string(),
        created_at: now_ms(),
        updated_at: now_ms(),
    };

    service.save_agent(agent)?;
    Ok(RD_SETUP_AGENT_ID.to_string())
}
