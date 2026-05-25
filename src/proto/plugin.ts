export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  enabled: boolean;
  tools: PluginTool[];
  scenarios?: PluginScenario[];
  triggerKeywords?: string[];
  changelog?: ChangelogEntry[];
  groupId: string;
  category: string;
  createdAt: number;
  updatedAt: number;
}

export interface ChangelogEntry {
  version: string;
  date: number;
  changes: string[];
  toolChanges?: ToolChange[];
}

export interface ToolChange {
  toolName: string;
  field: string;
  before: string;
  after: string;
}

export interface PluginScenario {
  name: string;
  description: string;
  examplePrompt: string;
  category?: string;
  toolName?: string;
}

export interface PluginTool {
  name: string;
  description: string;
  parameters: ToolParameter[];
  script: string;
  uiSchema?: UiSchema;
  resultView?: ResultViewSpec;
}

export interface ToolParameter {
  name: string;
  paramType: string;
  required: boolean;
  description: string;
  defaultValue?: unknown;
  uiWidget?: string;
  uiLabel?: string;
  uiPlaceholder?: string;
  uiOptions?: string[];
  uiAccept?: string;
  uiGroup?: string;
  uiOrder?: number;
}

export interface UiSchema {
  layout: string;
  fields: UiField[];
  submitLabel: string;
  quickActions?: QuickAction[];
  interaction?: InteractionSpec;
}

export interface InteractionSpec {
  steps: InteractionStep[];
  resultActions: ResultAction[];
  streaming?: StreamingSpec;
}

export interface InteractionStep {
  id: string;
  title: string;
  description?: string;
  fields: string[];
  autoAdvance: boolean;
}

export interface ResultAction {
  id: string;
  label: string;
  icon?: string;
  actionType: string;
  params?: unknown;
  toolName?: string;
  description?: string;
}

export interface StreamingSpec {
  progressPattern: string;
  statusField?: string;
  showProgress: boolean;
}

export interface UiField {
  name: string;
  label?: string;
  widget: string;
  placeholder?: string;
  options?: string[];
  accept?: string;
  multiple?: boolean;
  group?: string;
  order?: number;
  minValue?: number;
  maxValue?: number;
  step?: number;
}

export interface QuickAction {
  name: string;
  description?: string;
  presetParams?: Record<string, unknown>;
}

export interface ResultViewSpec {
  viewType: string;
  columns?: TableColumn[];
  actions?: string[];
}

export interface TableColumn {
  key: string;
  label: string;
  width?: string;
}

export interface UsageLogEntry {
  id: string;
  pluginId: string;
  toolName: string;
  paramsSummary: string;
  source: string;
  success: boolean;
  durationMs: number;
  errorMessage?: string;
  outputSummary?: string;
  createdAt: number;
}

export interface ExecutionMetrics {
  pluginId: string;
  totalExecutions: number;
  successCount: number;
  failCount: number;
  avgDurationMs: number;
  lastExecutedAt: number;
}

export interface RefineSuggestion {
  pluginId: string;
  failRate: number;
  recentFailCount: number;
  commonErrors: string[];
  suggestedAction: string;
}

export interface FixRecipe {
  errorType: FixErrorType;
  toolName: string;
  description: string;
  confidence: number;
  patch: FixPatch;
}

export type FixErrorType =
  | 'MissingDependency'
  | 'SyntaxError'
  | 'FileNotFound'
  | 'PermissionDenied'
  | 'Timeout'
  | 'NetworkError'
  | 'RuntimeError'
  | 'OutputPathError'
  | 'UnknownError';

export interface FixPatch {
  patchType: FixPatchType;
  toolName: string;
  newScript?: string;
  newParameters?: ToolParameterPatch[];
  description: string;
}

export type FixPatchType =
  | 'ScriptReplace'
  | 'ScriptPrefix'
  | 'ParameterAdd'
  | 'ParameterModify'
  | 'ManualReview';

export interface ToolParameterPatch {
  name: string;
  action: ParameterPatchAction;
  defaultValue?: unknown;
  uiWidget?: string;
  uiLabel?: string;
}

export type ParameterPatchAction = 'Add' | 'Modify' | 'Remove';

export interface StructuredRefineResult {
  pluginId: string;
  failRate: number;
  totalExecutions: number;
  recipes: FixRecipe[];
  healthStatus: PluginHealthStatus;
}

export type PluginHealthStatus = 'Healthy' | 'Degraded' | 'Failed';

export interface PluginGroupDto {
  id: string;
  name: string;
  icon: string;
  color: string;
  sortOrder: number;
  pluginCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface PluginCategoryDto {
  id: string;
  name: string;
  groupId: string;
  isDefault: boolean;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}
