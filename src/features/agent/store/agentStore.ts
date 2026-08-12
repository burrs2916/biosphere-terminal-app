import { create } from 'zustand';
import type { ProviderDto, EndpointDto, ModelDto, AgentDto, ConversationDto, MessageDto } from '../../../proto/agent';
import * as agentService from '../../../core/services/agent.service';
import { localizeBackendError } from '../../../core/backendError';

// 空 toolIds 表示「全部工具」。前端统一规范化为全部内置工具名，
// 保证各处 `agent.toolIds.includes(...)` 判断在「全部」语义下正确（文件附件、插件 tab、笔记等）。
const ALL_AGENT_TOOLS = ['terminal', 'notebook', 'file', 'command_history', 'terminal_session', 'plugin_manager', 'memory'];

function genId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

interface AgentState {
  providers: ProviderDto[];
  endpoints: EndpointDto[];
  models: ModelDto[];
  agents: AgentDto[];
  conversations: ConversationDto[];
  messages: MessageDto[];
  activeConversationId: string | null;
  activeAgentId: string | null;
  loading: boolean;
  error: string | null;

  loadProviders: () => Promise<void>;
  saveProvider: (provider: ProviderDto) => Promise<void>;
  deleteProvider: (id: string) => Promise<void>;
  loadEndpoints: () => Promise<void>;
  loadEndpointsByProvider: (providerId: string) => Promise<void>;
  saveEndpoint: (endpoint: EndpointDto) => Promise<void>;
  deleteEndpoint: (id: string) => Promise<void>;
  loadModels: () => Promise<void>;
  loadModelsByEndpoint: (endpointId: string) => Promise<void>;
  saveModel: (model: ModelDto) => Promise<void>;
  deleteModel: (id: string) => Promise<void>;
  testEndpointConnection: (endpointId: string) => Promise<string>;
  testModelChat: (modelId: string) => Promise<string>;
  loadAgents: () => Promise<void>;
  saveAgent: (agent: AgentDto) => Promise<void>;
  deleteAgent: (id: string) => Promise<void>;
  loadConversations: (agentId: string) => Promise<void>;
  createConversation: (agentId: string, title: string) => Promise<ConversationDto | null>;
  deleteConversation: (id: string) => Promise<void>;
  updateConversationTitle: (id: string, title: string) => Promise<void>;
  loadMessages: (conversationId: string) => Promise<void>;
  addMessage: (msg: MessageDto) => void;
  updateMessage: (id: string, content: string) => void;
  setActiveConversation: (id: string | null) => void;
  setActiveAgent: (id: string | null) => void;
  pendingAgentEditorId: string | null;
  pendingHighlightTool: string | null;
  requestAgentEditor: (agentId: string, toolId?: string | null) => void;
  clearPendingAgentEditor: () => void;
  deleteMessagesAfter: (conversationId: string, afterMessageId: string) => Promise<void>;
}

export const useAgentStore = create<AgentState>((set, get) => ({
  providers: [],
  endpoints: [],
  models: [],
  agents: [],
  conversations: [],
  messages: [],
  activeConversationId: null,
  activeAgentId: null,
  loading: false,
  error: null,

  loadProviders: async () => {
    set({ loading: true, error: null });
    try {
      const providers = await agentService.listProviders();
      set({ providers, loading: false, error: null });
    } catch (e) {
      set({ error: localizeBackendError(e), loading: false });
    }
  },

  saveProvider: async (provider: ProviderDto) => {
    try {
      await agentService.saveProvider(provider);
      await get().loadProviders();
    } catch (e) {
      set({ error: localizeBackendError(e) });
    }
  },

  deleteProvider: async (id: string) => {
    try {
      await agentService.deleteProvider(id);
      await get().loadProviders();
      await get().loadEndpoints();
      await get().loadModels();
    } catch (e) {
      set({ error: localizeBackendError(e) });
    }
  },

  loadEndpoints: async () => {
    try {
      const endpoints = await agentService.listEndpoints();
      set({ endpoints, error: null });
    } catch (e) {
      set({ error: localizeBackendError(e) });
    }
  },

  loadEndpointsByProvider: async (providerId: string) => {
    try {
      const endpoints = await agentService.listEndpointsByProvider(providerId);
      set({ endpoints, error: null });
    } catch (e) {
      set({ error: localizeBackendError(e) });
    }
  },

  saveEndpoint: async (endpoint: EndpointDto) => {
    try {
      await agentService.saveEndpoint(endpoint);
      await get().loadEndpoints();
    } catch (e) {
      set({ error: localizeBackendError(e) });
    }
  },

  deleteEndpoint: async (id: string) => {
    try {
      await agentService.deleteEndpoint(id);
      await get().loadEndpoints();
      await get().loadModels();
    } catch (e) {
      set({ error: localizeBackendError(e) });
    }
  },

  loadModels: async () => {
    try {
      const models = await agentService.listModels();
      set({ models, error: null });
    } catch (e) {
      set({ error: localizeBackendError(e) });
    }
  },

  loadModelsByEndpoint: async (endpointId: string) => {
    try {
      const models = await agentService.listModelsByEndpoint(endpointId);
      set({ models, error: null });
    } catch (e) {
      set({ error: localizeBackendError(e) });
    }
  },

  saveModel: async (model: ModelDto) => {
    try {
      await agentService.saveModel(model);
      await get().loadModels();
    } catch (e) {
      set({ error: localizeBackendError(e) });
    }
  },

  deleteModel: async (id: string) => {
    try {
      await agentService.deleteModel(id);
      await get().loadModels();
    } catch (e) {
      set({ error: localizeBackendError(e) });
    }
  },

  testEndpointConnection: async (endpointId: string) => {
    try {
      return await agentService.testEndpointConnection(endpointId);
    } catch (e) {
      throw e;
    }
  },

  testModelChat: async (modelId: string) => {
    try {
      return await agentService.testModelChat(modelId);
    } catch (e) {
      throw e;
    }
  },

  loadAgents: async () => {
    set({ loading: true, error: null });
    try {
      const agents = await agentService.listAgents();
      const normalized = agents.map((a) =>
        !a.toolIds || a.toolIds.length === 0 ? { ...a, toolIds: [...ALL_AGENT_TOOLS] } : a,
      );
      set({ agents: normalized, loading: false, error: null });
    } catch (e) {
      set({ error: localizeBackendError(e), loading: false });
    }
  },

  saveAgent: async (agent: AgentDto) => {
    try {
      await agentService.saveAgent(agent);
      await get().loadAgents();
    } catch (e) {
      set({ error: localizeBackendError(e) });
    }
  },

  deleteAgent: async (id: string) => {
    try {
      await agentService.deleteAgent(id);
      await get().loadAgents();
    } catch (e) {
      set({ error: localizeBackendError(e) });
    }
  },

  loadConversations: async (agentId: string) => {
    try {
      const conversations = await agentService.listConversations(agentId);
      set({ conversations, error: null });
    } catch (e) {
      set({ error: localizeBackendError(e) });
    }
  },

  createConversation: async (agentId: string, title: string) => {
    try {
      const conv = await agentService.createConversation(agentId, title);
      const conversations = [...get().conversations, conv];
      set({ conversations, activeConversationId: conv.id });
      return conv;
    } catch (e) {
      set({ error: localizeBackendError(e) });
      return null;
    }
  },

  deleteConversation: async (id: string) => {
    try {
      await agentService.deleteConversation(id);
      const conversations = get().conversations.filter((c) => c.id !== id);
      const activeConversationId = get().activeConversationId === id ? null : get().activeConversationId;
      set({ conversations, activeConversationId, messages: [] });
    } catch (e) {
      set({ error: localizeBackendError(e) });
    }
  },

  updateConversationTitle: async (id: string, title: string) => {
    try {
      await agentService.updateConversationTitle(id, title);
      const conversations = get().conversations.map((c) => c.id === id ? { ...c, title } : c);
      set({ conversations });
    } catch (e) {
      set({ error: localizeBackendError(e) });
    }
  },

  loadMessages: async (conversationId: string) => {
    try {
      const messages = await agentService.listMessages(conversationId);
      set({ messages, error: null });
    } catch (e) {
      set({ error: localizeBackendError(e) });
    }
  },

  addMessage: (msg: MessageDto) => {
    const messages = [...get().messages, msg];
    set({ messages });
  },

  updateMessage: (id: string, content: string) => {
    const messages = get().messages.map((m) =>
      m.id === id ? { ...m, content } : m
    );
    set({ messages });
  },

  setActiveConversation: (id: string | null) => set({ activeConversationId: id }),
  setActiveAgent: (id: string | null) => set({ activeAgentId: id }),

  pendingAgentEditorId: null,
  pendingHighlightTool: null,
  requestAgentEditor: (agentId: string, toolId: string | null = null) =>
    set({ pendingAgentEditorId: agentId, pendingHighlightTool: toolId }),
  clearPendingAgentEditor: () => set({ pendingAgentEditorId: null, pendingHighlightTool: null }),

  deleteMessagesAfter: async (conversationId: string, afterMessageId: string) => {
    await agentService.deleteMessagesAfter(conversationId, afterMessageId);
    const msgs = get().messages;
    const afterIdx = msgs.findIndex((m) => m.id === afterMessageId);
    if (afterIdx === -1) {
      set({ messages: [] });
      return;
    }
    const remaining = msgs.slice(0, afterIdx);
    set({ messages: remaining });
  },
}));

export { genId };
