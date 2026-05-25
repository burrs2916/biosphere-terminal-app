import { invoke } from '@tauri-apps/api/core';
import type { PluginManifest, PluginTool, PluginGroupDto, PluginCategoryDto, UsageLogEntry, ExecutionMetrics, RefineSuggestion, StructuredRefineResult } from '../../proto/plugin';

export async function listPlugins(): Promise<PluginManifest[]> {
  return invoke('list_plugins');
}

export async function getPlugin(id: string): Promise<PluginManifest | null> {
  return invoke('get_plugin', { id });
}

export async function savePlugin(manifest: PluginManifest): Promise<void> {
  return invoke('save_plugin', { manifest });
}

export async function deletePlugin(id: string): Promise<void> {
  return invoke('delete_plugin', { id });
}

export async function togglePlugin(id: string, enabled: boolean): Promise<void> {
  return invoke('toggle_plugin', { id, enabled });
}

export async function listPluginTools(): Promise<PluginTool[]> {
  return invoke('list_plugin_tools');
}

export async function listPluginGroups(): Promise<PluginGroupDto[]> {
  return invoke('list_plugin_groups');
}

export async function createPluginGroup(id: string, name: string, icon: string, color: string, sortOrder: number): Promise<PluginGroupDto> {
  return invoke('create_plugin_group', { id, name, icon, color, sortOrder });
}

export async function updatePluginGroup(id: string, name: string, icon: string, color: string, sortOrder: number): Promise<PluginGroupDto> {
  return invoke('update_plugin_group', { id, name, icon, color, sortOrder });
}

export async function deletePluginGroup(id: string): Promise<void> {
  return invoke('delete_plugin_group', { id });
}

export async function listPluginCategories(groupId: string): Promise<PluginCategoryDto[]> {
  return invoke('list_plugin_categories', { groupId });
}

export async function createPluginCategory(id: string, name: string, groupId: string, sortOrder: number): Promise<PluginCategoryDto> {
  return invoke('create_plugin_category', { id, name, groupId, sortOrder });
}

export async function updatePluginCategory(id: string, name: string, sortOrder: number): Promise<PluginCategoryDto> {
  return invoke('update_plugin_category', { id, name, sortOrder });
}

export async function deletePluginCategory(id: string): Promise<void> {
  return invoke('delete_plugin_category', { id });
}

export async function runPluginTool(pluginId: string, toolName: string, params: Record<string, unknown>, workspaceDir?: string): Promise<{
  success: boolean;
  output: string;
  scriptType: string;
  durationMs: number;
  metadata: unknown;
}> {
  return invoke('run_plugin_tool', { pluginId, toolName, params, workspaceDir: workspaceDir ?? null });
}

export async function getPluginToolUiSchema(pluginId: string, toolName: string): Promise<unknown | null> {
  return invoke('get_plugin_tool_ui_schema', { pluginId, toolName });
}

export async function getPluginUsageMetrics(pluginId: string): Promise<ExecutionMetrics> {
  return invoke('get_plugin_usage_metrics', { pluginId });
}

export async function getPluginRefineSuggestions(pluginId: string): Promise<RefineSuggestion | null> {
  return invoke('get_plugin_refine_suggestions', { pluginId });
}

export async function getPluginStructuredRefine(pluginId: string): Promise<StructuredRefineResult> {
  return invoke('get_plugin_structured_refine', { pluginId });
}

export async function listPluginUsageLogs(pluginId: string, limit?: number): Promise<UsageLogEntry[]> {
  return invoke('list_plugin_usage_logs', { pluginId, limit });
}

export async function clearPluginUsageLogs(pluginId: string): Promise<number> {
  return invoke('clear_plugin_usage_logs', { pluginId });
}

export async function clearUsageLogsBefore(beforeMs: number): Promise<number> {
  return invoke('clear_usage_logs_before', { beforeMs });
}

export async function clearFailedLogsBefore(beforeMs: number): Promise<number> {
  return invoke('clear_failed_logs_before', { beforeMs });
}

export async function purgeAllUsageLogs(): Promise<number> {
  return invoke('purge_all_usage_logs');
}

export async function countPluginUsageLogs(pluginId: string): Promise<number> {
  return invoke('count_plugin_usage_logs', { pluginId });
}

export async function countAllUsageLogs(): Promise<number> {
  return invoke('count_all_usage_logs');
}

export async function usageLogsSizeEstimate(): Promise<number> {
  return invoke('usage_logs_size_estimate');
}

export async function exportPluginUsageLogs(pluginId: string): Promise<UsageLogEntry[]> {
  return invoke('export_plugin_usage_logs', { pluginId });
}

export async function exportAllUsageLogs(): Promise<UsageLogEntry[]> {
  return invoke('export_all_usage_logs');
}
