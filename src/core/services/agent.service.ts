import { invoke } from '@tauri-apps/api/core';
import type { ProviderDto, EndpointDto, ModelDto, AgentDto, ConversationDto, MessageDto } from '../../proto/agent';

export async function listProviders(): Promise<ProviderDto[]> {
  return invoke('list_providers');
}

export async function saveProvider(provider: ProviderDto): Promise<void> {
  return invoke('save_provider', { provider });
}

export async function deleteProvider(id: string): Promise<void> {
  return invoke('delete_provider', { id });
}

export async function listEndpoints(): Promise<EndpointDto[]> {
  return invoke('list_endpoints');
}

export async function listEndpointsByProvider(providerId: string): Promise<EndpointDto[]> {
  return invoke('list_endpoints_by_provider', { providerId });
}

export async function saveEndpoint(endpoint: EndpointDto): Promise<void> {
  return invoke('save_endpoint', { endpoint });
}

export async function deleteEndpoint(id: string): Promise<void> {
  return invoke('delete_endpoint', { id });
}

export async function listModels(): Promise<ModelDto[]> {
  return invoke('list_models');
}

export async function listModelsByEndpoint(endpointId: string): Promise<ModelDto[]> {
  return invoke('list_models_by_endpoint', { endpointId });
}

export async function saveModel(model: ModelDto): Promise<void> {
  return invoke('save_model', { model });
}

export async function deleteModel(id: string): Promise<void> {
  return invoke('delete_model', { id });
}

export async function testEndpointConnection(endpointId: string): Promise<string> {
  return invoke('test_endpoint_connection', { endpointId });
}

export async function testModelChat(modelId: string): Promise<string> {
  return invoke('test_model_chat', { modelId });
}

export async function listAgents(): Promise<AgentDto[]> {
  return invoke('list_agents');
}

export async function saveAgent(agent: AgentDto): Promise<void> {
  return invoke('save_agent', { agent });
}

export async function deleteAgent(id: string): Promise<void> {
  return invoke('delete_agent', { id });
}

export async function listConversations(agentId: string): Promise<ConversationDto[]> {
  return invoke('list_conversations', { agentId });
}

export async function createConversation(agentId: string, title: string, metadata?: Record<string, unknown>): Promise<ConversationDto> {
  return invoke('create_conversation', { agentId, title, metadata: metadata ? JSON.stringify(metadata) : undefined });
}

export async function deleteConversation(id: string): Promise<void> {
  return invoke('delete_conversation', { id });
}

export async function updateConversationTitle(id: string, title: string): Promise<void> {
  return invoke('update_conversation_title', { id, title });
}

export async function listMessages(conversationId: string): Promise<MessageDto[]> {
  return invoke('list_messages', { conversationId });
}

export async function saveMessage(msg: MessageDto): Promise<void> {
  return invoke('save_message', { msg });
}

export async function deleteMessagesAfter(conversationId: string, afterMessageId: string): Promise<void> {
  return invoke('delete_messages_after', { conversationId, afterMessageId });
}

export async function runAgent(agentId: string, message: string, conversationId?: string, disableTools?: boolean): Promise<string> {
  return invoke('run_agent', { agentId, message, conversationId: conversationId ?? null, disableTools: disableTools ?? null });
}

export async function stopAgent(conversationId: string): Promise<boolean> {
  return invoke('stop_agent', { conversationId });
}

export async function writeFrontendLog(level: string, tag: string, message: string): Promise<void> {
  try {
    return invoke('write_frontend_log', { level, tag, message });
  } catch {
    console.log(`[${level}][${tag}] ${message}`);
  }
}

export async function respondPermission(conversationId: string, approved: boolean, alwaysAllow: boolean): Promise<void> {
  return invoke('respond_permission', { conversationId, approved, alwaysAllow });
}

export async function updateAgentAllowedTools(agentId: string, alwaysAllowedTools: string[]): Promise<void> {
  return invoke('update_agent_allowed_tools', { agentId, alwaysAllowedTools });
}

/// 确保「远程桌面安装助手」专用 Agent 存在（后端幂等播种），返回其固定 id。
/// lang：用户界面语言（如 'zh-CN' / 'en-US'），决定播种时写入的提示词语言版本。
export async function ensureRemoteDesktopSetupAgent(modelId?: string, lang?: string): Promise<string> {
  return invoke('ensure_remote_desktop_setup_agent', { modelId: modelId ?? null, lang: lang ?? null });
}
