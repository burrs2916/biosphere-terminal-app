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
    pub model_id: String,
    pub system_prompt: String,
    pub temperature: f64,
    pub max_iterations: i32,
    pub tool_ids: Vec<String>,
    pub trigger_type: String,
    pub auto_confirm: bool,
    pub permission_mode: String,
    pub always_allowed_tools: Vec<String>,
    pub fallback_model_id: String,
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
    let agents = service.list_agents()?;
    let agent = agents.iter().find(|a| a.id == agent_id)
        .ok_or_else(|| "Agent not found".to_string())?;

    let models = service.list_models()?;
    let model = models.iter().find(|m| m.id == agent.model_id)
        .ok_or_else(|| "Model not found".to_string())?;

    let endpoints = service.list_endpoints()?;
    let endpoint = endpoints.iter().find(|e| e.id == model.endpoint_id)
        .ok_or_else(|| "Endpoint not found".to_string())?;

    let providers = service.list_providers()?;
    let provider = providers.iter().find(|p| p.id == endpoint.provider_id)
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

    let fallback_provider_and_model: Option<(Arc<dyn crate::plugins::ai_agent::provider::LlmProvider>, String)> = if !agent.fallback_model_id.is_empty() {
        if let Some(fb_model) = models.iter().find(|m| m.id == agent.fallback_model_id) {
            if let Some(fb_endpoint) = endpoints.iter().find(|e| e.id == fb_model.endpoint_id) {
                if let Some(fb_provider_row) = providers.iter().find(|p| p.id == fb_endpoint.provider_id) {
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

    if !skip_tools {
        for tool_id in &agent.tool_ids {
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
        let agent_tool_set: std::collections::HashSet<String> = agent.tool_ids.iter().cloned().collect();

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

    if agent.tool_ids.iter().any(|t| t == "plugin_manager") {
        system_prompt.push_str("\n\n## Plugin Refinement Workflow\n\
When the user asks you to refine, improve, or fix a plugin, you MUST follow this exact workflow:\n\
1. **READ**: Use the `plugin_manager` tool with action `get` and the plugin_id to read the plugin's full code, tools, and configuration.\n\
2. **ANALYZE**: Review the code for issues: missing error handling, edge cases, performance problems, unclear descriptions, or missing parameters.\n\
3. **REFINE**: Use the `plugin_manager` tool with action `refine` to apply improvements. Include `changelog_changes` to document what was changed.\n\
4. **TEST**: Use the `plugin_manager` tool with action `test` to verify the refined tool works correctly with sample parameters.\n\
NEVER skip the READ step and answer from memory. ALWAYS call the actual tools to get real data and make real changes.\n");
    }

    if agent.tool_ids.iter().any(|t| t == "file") {
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
    } else if !agent.workspace_dir.is_empty() || agent.tool_ids.iter().any(|t| t != "memory" && t != "plugin_manager" && t != "command_history") {
        let ws_dir = crate::plugins::ai_agent::file_tool::resolve_workspace_dir(&agent.workspace_dir, &agent.id);
        system_prompt.push_str(&format!("\n\n## Agent Workspace\n\
Your workspace directory is: `{}`\n\
- When plugin tools produce output files, they are saved in this directory.\n\
- The `{{{{output_path}}}}` variable in plugin scripts resolves to this directory.\n", ws_dir.display()));
    }

    if agent.tool_ids.iter().any(|t| t == "memory") {
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

                let _ = handle.emit("agent-permission-request", serde_json::json!({
                    "conversationId": req_with_id.conversation_id,
                    "agentId": agent_id,
                    "toolName": req_with_id.tool_name,
                    "arguments": req_with_id.arguments,
                    "riskLevel": match req_with_id.risk_level {
                        crate::plugins::ai_agent::permission::ToolRiskLevel::Low => "low",
                        crate::plugins::ai_agent::permission::ToolRiskLevel::High => "high",
                    },
                    "description": req_with_id.description,
                }));

                match tokio::time::timeout(std::time::Duration::from_secs(60), rx).await {
                    Ok(Ok(result)) => result,
                    _ => (false, false),
                }
            })
        }
    );

    if let Ok(Some(conv_row)) = service.find_conversation(&conv_id) {
        if !conv_row.compaction_summary.is_empty() {
            system_prompt.push_str(&format!(
                "\n\n[Previous Conversation Summary]\n{}\n[/Previous Conversation Summary]",
                conv_row.compaction_summary
            ));
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
    .with_permission_requester(permission_requester);

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
            let _ = persister_service.update_compaction_summary(&persister_conv_id, &pm.content);
            return;
        }
        let msg_id = if pm.role == "tool" {
            let tc_id = pm.tool_call_id.as_deref().filter(|s| !s.is_empty());
            if let Some(id) = tc_id {
                format!("tool-{}-{}", persister_conv_id, id)
            } else {
                let counter = *persister_tool_counter.lock().unwrap();
                *persister_tool_counter.lock().unwrap() += 1;
                tracing::warn!("[run_agent] persister: tool_call_id is empty for tool message, using counter={}", counter);
                format!("tool-{}-auto-{}", persister_conv_id, counter)
            }
        } else {
            let counter = *persister_asst_counter.lock().unwrap();
            let id = format!("asst-{}-{}-{}", persister_conv_id, persister_run_ts, counter);
            *persister_asst_counter.lock().unwrap() += 1;
            id
        };
        let tool_calls_str = pm.tool_calls.as_ref()
            .map(|tc| serde_json::to_string(tc).unwrap_or_default())
            .unwrap_or_default();
        let id_for_track = msg_id.clone();
        match persister_service.save_message(AiMessageRow {
            id: msg_id,
            conversation_id: persister_conv_id.clone(),
            role: pm.role.clone(),
            content: pm.content.clone(),
            tool_calls: tool_calls_str,
            is_error: if pm.is_error { 1 } else { 0 },
            created_at: persister_run_ts,
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
                let _ = emit_compaction.emit("agent-compaction", serde_json::json!({
                    "conversationId": conv_id_compaction,
                    "message": chunk.trim(),
                }));
            }
            let _ = emit_handle.emit("agent-chunk", serde_json::json!({
                "conversationId": conv_id_clone,
                "chunk": chunk,
            }));
        },
        move |tool_event| {
            let _ = emit_tool.emit("agent-tool-call", serde_json::json!({
                "conversationId": conv_id_tool,
                "toolCall": tool_event,
            }));
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
            let already_persisted: Vec<String> = persisted_ids.lock().unwrap().drain(..).collect();
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

            // Update conversation timestamp for proper ordering
            let _ = service.touch_conversation(&conv_id);

            tracing::info!("[run_agent] emitting agent-done, conv_id={}, response_len={}", conv_id, run_result.final_content.len());
            let _ = app_handle.emit("agent-done", serde_json::json!({
                "conversationId": conv_id,
                "response": run_result.final_content,
            }));
            tracing::info!("[run_agent] agent-done emitted successfully, conv_id={}", conv_id);
            Ok(run_result.final_content)
        }
        Err(e) => {
            tracing::error!("[run_agent] engine.run failed: {}, conv_id={}", e, conv_id);
            let _ = app_handle.emit("agent-error", serde_json::json!({
                "conversationId": conv_id,
                "error": e,
            }));
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneratedScenario {
    pub name: String,
    pub description: String,
    pub example_prompt: String,
    pub category: String,
    #[serde(default)]
    pub tool_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginScenariosResult {
    pub plugin_id: String,
    pub plugin_name: String,
    pub scenarios: Vec<GeneratedScenario>,
}

fn parse_scenarios_from_markdown(text: &str) -> Result<Vec<GeneratedScenario>, String> {
    let mut scenarios = Vec::new();
    let mut current_name = String::new();
    let mut current_desc = String::new();
    let mut current_prompt = String::new();
    let mut current_category = String::from("practical");
    let mut current_tool = String::new();

    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        let lower = trimmed.to_lowercase();

        if lower.contains("name:") || lower.contains("**name**") {
            if !current_name.is_empty() && !current_desc.is_empty() {
                scenarios.push(GeneratedScenario {
                    name: current_name.clone(),
                    description: current_desc.clone(),
                    example_prompt: if current_prompt.is_empty() { format!("请使用{}工具", current_name) } else { current_prompt.clone() },
                    category: current_category.clone(),
                    tool_name: current_tool.clone(),
                });
            }
            current_name = trimmed
                .replace('*', "").replace('`', "")
                .split(':').nth(1)
                .map(|s| s.trim().to_string())
                .unwrap_or_default();
            current_desc.clear();
            current_prompt.clear();
            current_category = String::from("practical");
            current_tool.clear();
        } else if lower.contains("description:") || lower.contains("**description**") {
            current_desc = trimmed
                .replace('*', "").replace('`', "")
                .splitn(2, ':').nth(1)
                .map(|s| s.trim().to_string())
                .unwrap_or_default();
        } else if lower.contains("exampleprompt:") || lower.contains("example prompt:") || lower.contains("example_prompt:") || lower.contains("prompt:") || lower.contains("**example prompt**") || lower.contains("**prompt**") {
            current_prompt = trimmed
                .replace('*', "").replace('`', "")
                .splitn(2, ':').nth(1)
                .map(|s| s.trim().to_string())
                .unwrap_or_default();
        } else if lower.contains("category:") || lower.contains("**category**") {
            let cat = trimmed
                .replace('*', "").replace('`', "")
                .splitn(2, ':').nth(1)
                .map(|s| s.trim().to_lowercase())
                .unwrap_or_default();
            if cat.contains("creative") {
                current_category = String::from("creative");
            } else if cat.contains("combination") || cat.contains("combo") {
                current_category = String::from("combination");
            }
        } else if lower.contains("toolname:") || lower.contains("tool_name:") || lower.contains("tool:") || lower.contains("**tool**") {
            current_tool = trimmed
                .replace('*', "").replace('`', "")
                .splitn(2, ':').nth(1)
                .map(|s| s.trim().to_string())
                .unwrap_or_default();
        }
    }

    if !current_name.is_empty() && !current_desc.is_empty() {
        scenarios.push(GeneratedScenario {
            name: current_name,
            description: current_desc,
            example_prompt: if current_prompt.is_empty() { String::from("请帮我使用这个工具") } else { current_prompt },
            category: current_category,
            tool_name: current_tool,
        });
    }

    if scenarios.is_empty() {
        Err("Could not extract any scenarios from AI response".to_string())
    } else {
        Ok(scenarios)
    }
}

#[tauri::command]
pub async fn generate_plugin_scenarios(
    plugin_id: String,
    agent_id: String,
    category: Option<String>,
    replace: Option<bool>,
    service: State<'_, Arc<AgentService>>,
    plugin_service: State<'_, Arc<PluginService>>,
) -> Result<PluginScenariosResult, String> {
    let plugin = plugin_service.get_plugin(&plugin_id)?
        .ok_or_else(|| format!("Plugin '{}' not found", plugin_id))?;

    let agents = service.list_agents()?;
    let agent = agents.iter().find(|a| a.id == agent_id)
        .ok_or_else(|| format!("Agent '{}' not found", agent_id))?;

    let cat = category.unwrap_or_else(|| "all".to_string());

    let tools_desc: Vec<String> = plugin.tools.iter().map(|t| {
        let params: Vec<String> = t.parameters.iter().map(|p| {
            format!("  - {} ({}): {}", p.name, p.param_type, p.description)
        }).collect();
        format!("Tool: {}\n  Description: {}\n  Output: This tool produces content/data that can be further analyzed\n  Parameters:\n{}", t.name, t.description, params.join("\n"))
    }).collect();

    let existing_names_str = if plugin.scenarios.is_empty() {
        String::new()
    } else {
        format!("\n\nIMPORTANT — The following scenario names already exist and MUST NOT be reused:\n{}\nGenerate scenarios with COMPLETELY DIFFERENT names from the above.",
            plugin.scenarios.iter().map(|s| format!("- {}", s.name)).collect::<Vec<_>>().join("\n"))
    };

    let agent_tools: Vec<String> = agent.tool_ids.iter()
        .filter(|t| !plugin.tools.iter().any(|pt| pt.name == **t))
        .cloned()
        .collect();
    let agent_tools_str = if agent_tools.is_empty() {
        "None (this plugin's tools are the only tools available)".to_string()
    } else {
        agent_tools.join(", ")
    };

    let ws_dir = crate::plugins::ai_agent::file_tool::resolve_workspace_dir(&agent.workspace_dir, &agent.id);
    let workspace_info = format!(
        "Workspace directory: {}\n  - Relative paths like 'output/report.md' resolve to '{}/output/report.md'\n  - The {{output_path}} variable resolves to the workspace directory",
        ws_dir.display(),
        ws_dir.display()
    );

    let all_plugins = plugin_service.list_plugins()?;
    let other_plugins_info: Vec<String> = all_plugins.iter()
        .filter(|p| p.id != plugin_id && p.enabled)
        .map(|p| {
            let tool_names: Vec<String> = p.tools.iter().map(|t| t.name.clone()).collect();
            format!("  - {} (v{}): {} — Tools: {}", p.name, p.version, p.description, tool_names.join(", "))
        })
        .collect();
    let other_plugins_str = if other_plugins_info.is_empty() {
        "No other plugins available".to_string()
    } else {
        other_plugins_info.join("\n")
    };

    let prompt = format!(
r#"Analyze the following plugin and generate CONTENT ANALYSIS scenarios for it.

The user will FIRST execute a tool in the PluginRunner to get results, THEN ask the AI agent to analyze those results.
Your scenarios should be about ANALYZING the tool's output, NOT about invoking the tool itself.

Plugin: {} (v{})
Description: {}
Author: {}

Available Tools (user operates these directly):
{}

Current Agent Context:
- Agent name: {}
- Agent description: {}
- Other tools available to this agent: {}
- Permission mode: {}
- {}

Other enabled plugins available for combination scenarios:
{}

Generate scenarios in the category: {}

Categories:
- practical: Practical analysis questions about tool output data — summaries, key findings, data extraction
- creative: Creative interpretations and insights — pattern discovery, novel perspectives, storytelling
- combination: Cross-analysis combining tool output with other data sources or plugins

CRITICAL RULES:
- examplePrompt MUST be an ANALYSIS QUESTION about the tool's output, NOT a tool invocation instruction
- The user already has the tool's output in front of them — they want the AI to THINK about it, not re-run it
- When category is "all", generate at least 1 scenario from EACH category (practical, creative, combination)
- Each scenario name MUST be unique and descriptive

EXAMPLE PROMPT GUIDELINES:
- BAD (tool invocation): "Extract text from the PPT file and save to output.txt"
- BAD (tool invocation): "Convert this document to PDF"
- BAD (generic): "Analyze this data"
- GOOD (specific analysis): "What are the core arguments presented in this document?"
- GOOD (specific analysis): "Summarize the key findings from this data and identify any surprising patterns"
- GOOD (specific analysis): "Compare the viewpoints in sections 2 and 5 — are they contradictory?"
- GOOD (creative): "If this data were a story, what narrative arc would it follow?"
- GOOD (combination): "Cross-reference these findings with the web search results about the same topic"

OUTPUT FORMAT:
- Each toolName MUST match exactly one of the tool names listed above
- Each examplePrompt MUST be a specific, natural question a user would ask AFTER seeing the tool's output
{}
Session seed: {} — Use this to ensure unique and diverse scenarios each time.

Generate 3-5 DIFFERENT and UNIQUE analysis scenarios. Respond ONLY with valid JSON array, no markdown:
[{{"name":"...","description":"...","examplePrompt":"...","category":"...","toolName":"..."}}]"#,
        plugin.name, plugin.version, plugin.description, plugin.author,
        tools_desc.join("\n\n"),
        agent.name, agent.description,
        agent_tools_str,
        agent.permission_mode,
        workspace_info,
        other_plugins_str,
        cat,
        existing_names_str,
        std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis()
    );

    let models = service.list_models()?;
    let model = models.iter().find(|m| m.id == agent.model_id)
        .ok_or_else(|| "Model not found".to_string())?;

    let endpoints = service.list_endpoints()?;
    let endpoint = endpoints.iter().find(|e| e.id == model.endpoint_id)
        .ok_or_else(|| "Endpoint not found".to_string())?;

    let providers = service.list_providers()?;
    let provider = providers.iter().find(|p| p.id == endpoint.provider_id)
        .ok_or_else(|| "Provider not found".to_string())?;

    let config = crate::plugins::ai_agent::provider::ProviderConfig {
        api_key: provider.api_key.clone(),
        base_url: endpoint.base_url.clone(),
        api_type: endpoint.api_type.clone(),
        auth_type: endpoint.auth_type.clone(),
        custom_auth_header: endpoint.custom_auth_header.clone(),
    };

    let llm_provider: Arc<dyn crate::plugins::ai_agent::provider::LlmProvider> = Arc::new(
        crate::plugins::ai_agent::openai_provider::OpenAiCompatProvider::new(config)
    );

    let messages = vec![
        crate::plugins::ai_agent::provider::ChatMessage {
            role: "system".to_string(),
            content: "You are a plugin analysis expert. You MUST respond with ONLY a valid JSON array. No explanations, no markdown, no text before or after the JSON array. Start your response with [ and end with ].".to_string(),
            tool_calls: None,
            tool_call_id: None,
        },
        crate::plugins::ai_agent::provider::ChatMessage {
            role: "user".to_string(),
            content: prompt,
            tool_calls: None,
            tool_call_id: None,
        },
    ];

    let temperature = 1.0 + (std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_nanos() % 300) as f64 / 1000.0;
    let options = crate::plugins::ai_agent::provider::ChatOptions {
        model: model.ref_key.clone(),
        temperature,
        max_tokens: 2000,
        tools: None,
    };

    let response = llm_provider.chat(&messages, &options).await
        .map_err(|e| format!("Failed to generate scenarios: {}", e))?;

    let content = response.content.unwrap_or_default();

    let cleaned = content.trim()
        .trim_start_matches("```json").trim_start_matches("```")
        .trim_end_matches("```")
        .trim();

    let json_str = match serde_json::from_str::<serde_json::Value>(cleaned) {
        Ok(_) => cleaned.to_string(),
        Err(_) => {
            let start = cleaned.find('[');
            let end = cleaned.rfind(']');
            match (start, end) {
                (Some(s), Some(e)) if e > s => cleaned[s..=e].to_string(),
                _ => cleaned.to_string(),
            }
        }
    };

    let scenarios: Vec<GeneratedScenario> = match serde_json::from_str(&json_str) {
        Ok(s) => s,
        Err(_) => {
            parse_scenarios_from_markdown(cleaned)
                .map_err(|e| format!("Failed to parse scenarios: {}. Raw: {}", e, &cleaned[..cleaned.len().min(300)]))?
        }
    };

    let new_plugin_scenarios: Vec<crate::plugins::domain::plugin::PluginScenario> = scenarios.iter().map(|s| {
        let mut scenario = crate::plugins::domain::plugin::PluginScenario {
            name: s.name.clone(),
            description: s.description.clone(),
            example_prompt: s.example_prompt.clone(),
            category: s.category.clone(),
            tool_name: s.tool_name.clone(),
        };
        scenario.sanitize();
        scenario
    }).collect();

    // Build sanitized result for frontend BEFORE merging (avoids move-after-move)
    let sanitized_result: Vec<GeneratedScenario> = new_plugin_scenarios.iter().map(|s| GeneratedScenario {
        name: s.name.clone(),
        description: s.description.clone(),
        example_prompt: s.example_prompt.clone(),
        category: s.category.clone(),
        tool_name: s.tool_name.clone(),
    }).collect();

    let merged_scenarios = if replace.unwrap_or(false) {
        new_plugin_scenarios
    } else {
        let mut existing_names: Vec<String> = plugin.scenarios.iter().map(|s| s.name.clone()).collect();
        let mut merged = plugin.scenarios.clone();
        for ns in &new_plugin_scenarios {
            if !existing_names.contains(&ns.name) {
                existing_names.push(ns.name.clone());
                merged.push(ns.clone());
            }
        }
        merged
    };

    let mut updated_plugin = plugin.clone();
    updated_plugin.scenarios = merged_scenarios;
    updated_plugin.updated_at = chrono::Utc::now().timestamp_millis();
    plugin_service.save_plugin(&updated_plugin)?;

    // Return sanitized scenarios to frontend, not the raw AI output
    Ok(PluginScenariosResult {
        plugin_id: updated_plugin.id.clone(),
        plugin_name: updated_plugin.name.clone(),
        scenarios: sanitized_result,
    })
}

#[tauri::command]
pub async fn save_plugin_scenarios(
    plugin_id: String,
    mut scenarios: Vec<crate::plugins::domain::plugin::PluginScenario>,
    plugin_service: State<'_, Arc<PluginService>>,
) -> Result<(), String> {
    let mut plugin = plugin_service.get_plugin(&plugin_id)?
        .ok_or_else(|| format!("Plugin '{}' not found", plugin_id))?;
    // Sanitize all scenarios before saving to prevent system instructions and absolute paths
    for scenario in &mut scenarios {
        scenario.sanitize();
    }
    plugin.scenarios = scenarios;
    plugin.updated_at = chrono::Utc::now().timestamp_millis();
    plugin_service.save_plugin(&plugin)
}

#[tauri::command]
pub async fn delete_plugin_scenario(
    plugin_id: String,
    scenario_name: String,
    plugin_service: State<'_, Arc<PluginService>>,
) -> Result<(), String> {
    let mut plugin = plugin_service.get_plugin(&plugin_id)?
        .ok_or_else(|| format!("Plugin '{}' not found", plugin_id))?;
    plugin.scenarios.retain(|s| s.name != scenario_name);
    plugin.updated_at = chrono::Utc::now().timestamp_millis();
    plugin_service.save_plugin(&plugin)
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
