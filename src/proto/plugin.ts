export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  tools: ToolDefinition[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: ToolParameter[];
}

export interface ToolParameter {
  name: string;
  param_type: string;
  required: boolean;
  description: string;
  default_value?: unknown;
}
