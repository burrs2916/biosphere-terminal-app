use std::sync::Arc;
use serde::{Deserialize, Serialize};
use tauri::{State, Emitter};

use crate::app::agent_service::AgentService;
use crate::infra::storage::agent_repo::{
    AiProviderRow, AiEndpointRow, AiModelRow, AiAgentRow,
    AiConversationRow, AiMessageRow,
};

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
    pub linked_note_ids: Vec<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationDto {
    pub id: String,
    pub agent_id: String,
    pub title: String,
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
        linked_note_ids: a.linked_note_ids.clone(),
        created_at: a.created_at,
        updated_at: a.updated_at,
    }
}

fn to_conversation_dto(c: &AiConversationRow) -> ConversationDto {
    ConversationDto {
        id: c.id.clone(),
        agent_id: c.agent_id.clone(),
        title: c.title.clone(),
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
        linked_note_ids: agent.linked_note_ids,
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
pub fn create_conversation(service: State<'_, Arc<AgentService>>, agent_id: String, title: String) -> Result<ConversationDto, String> {
    let conv = service.create_conversation(&agent_id, &title)?;
    Ok(to_conversation_dto(&conv))
}

#[tauri::command]
pub fn delete_conversation(service: State<'_, Arc<AgentService>>, id: String) -> Result<(), String> {
    service.delete_conversation(&id)
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
        created_at: msg.created_at,
    })
}

#[tauri::command]
pub async fn run_agent(
    agent_id: String,
    message: String,
    conversation_id: Option<String>,
    app_handle: tauri::AppHandle,
    service: State<'_, Arc<AgentService>>,
) -> Result<String, String> {
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

    let mut tool_registry = crate::plugins::ai_agent::engine::ToolRegistry::new();
    let db = service.db();
    let notebook = service.notebook();
    let terminal_svc = service.terminal();
    for tool_id in &agent.tool_ids {
        match tool_id.as_str() {
            "terminal" => {
                tool_registry.register(Arc::new(crate::plugins::ai_agent::terminal_tool::TerminalTool::new()));
            }
            "notebook" => {
                tool_registry.register(Arc::new(crate::plugins::ai_agent::notebook_tool::NotebookTool::with_notebook(db.clone(), notebook.clone())));
            }
            "file" => {
                tool_registry.register(Arc::new(crate::plugins::ai_agent::file_tool::FileTool::new()));
            }
            "command_history" => {
                tool_registry.register(Arc::new(crate::plugins::ai_agent::command_history_tool::CommandHistoryTool::new(db.clone())));
            }
            "terminal_session" => {
                tool_registry.register(Arc::new(crate::plugins::ai_agent::terminal_session_tool::TerminalSessionTool::new(terminal_svc.clone())));
            }
            _ => {}
        }
    }
    let tools = Arc::new(tokio::sync::Mutex::new(tool_registry));

    // Load linked notes and append to system prompt
    let mut system_prompt = agent.system_prompt.clone();
    if !agent.linked_note_ids.is_empty() {
        let notebook_service = service.notebook();
        let mut notes_context = String::new();
        notes_context.push_str("\n\n---\nLinked Notes:\n");
        
        for note_id in &agent.linked_note_ids {
            if let Ok(Some(note_detail)) = notebook_service.get_note(note_id) {
                notes_context.push_str(&format!("\n--- Note: {} ---\n{}\n", note_detail.0.title, note_detail.1));
            }
        }
        notes_context.push_str("---\n");
        system_prompt.push_str(&notes_context);
    }

    let engine = crate::plugins::ai_agent::engine::AgentEngine::new(
        llm_provider_arc,
        tools,
        model.ref_key.clone(),
        system_prompt,
        agent.temperature,
        agent.max_iterations,
    );

    let conv_id = conversation_id.unwrap_or_else(|| {
        uuid::Uuid::new_v4().to_string()
    });

    let history = if let Ok(db_msgs) = service.list_messages(&conv_id) {
        db_msgs.iter().map(|m| crate::plugins::ai_agent::provider::ChatMessage {
            role: m.role.clone(),
            content: m.content.clone(),
            tool_calls: None,
            tool_call_id: None,
        }).collect::<Vec<_>>()
    } else {
        Vec::new()
    };

    let emit_handle = app_handle.clone();
    let conv_id_clone = conv_id.clone();
    let emit_tool = app_handle.clone();
    let conv_id_tool = conv_id.clone();
    let result = engine.run(&message, history,
        move |chunk| {
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

    match result {
        Ok(response) => {
            let _ = app_handle.emit("agent-done", serde_json::json!({
                "conversationId": conv_id,
                "response": response,
            }));
            Ok(response)
        }
        Err(e) => {
            let _ = app_handle.emit("agent-error", serde_json::json!({
                "conversationId": conv_id,
                "error": e,
            }));
            Err(e)
        }
    }
}
