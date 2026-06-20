export interface ProviderDto {
  id: string;
  name: string;
  apiKey: string;
  logo: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface EndpointDto {
  id: string;
  providerId: string;
  name: string;
  apiType: string;
  baseUrl: string;
  authType: string;
  customAuthHeader: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface ModelDto {
  id: string;
  name: string;
  refKey: string;
  endpointId: string;
  reasoning: boolean;
  inputTypes: string[];
  contextWindow: number;
  maxTokens: number;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface AgentDto {
  id: string;
  name: string;
  description: string;
  modelId: string | null;
  systemPrompt: string;
  temperature: number;
  maxIterations: number;
  toolIds: string[];
  triggerType: string;
  autoConfirm: boolean;
  permissionMode: string;
  alwaysAllowedTools: string[];
  fallbackModelId: string | null;
  workspaceDir: string;
  createdAt: number;
  updatedAt: number;
}

export interface ConversationDto {
  id: string;
  agentId: string;
  title: string;
  metadata: string;
  createdAt: number;
  updatedAt: number;
}

export interface MessageDto {
  id: string;
  conversationId: string;
  role: string;
  content: string;
  toolCalls: string;
  isError: number;
  createdAt: number;
}
