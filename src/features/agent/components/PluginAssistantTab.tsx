import { PackageIcon } from '@phosphor-icons/react';
import { createAssistantTab } from './AssistantTabTemplate';

const STORAGE_KEY = 'biosphere_plugin_assistant_agent_id';

export function getPluginAssistantAgentId(): string | null {
  return localStorage.getItem(STORAGE_KEY);
}

export function setPluginAssistantAgentId(id: string | null) {
  if (id) {
    localStorage.setItem(STORAGE_KEY, id);
  } else {
    localStorage.removeItem(STORAGE_KEY);
  }
}

export const PluginAssistantTab = createAssistantTab({
  storageKey: STORAGE_KEY,
  icon: <PackageIcon size={20} weight="duotone" />,
  titleKey: 'plugin_assistant.title',
  descriptionKey: 'plugin_assistant.description',
  selectAgentKey: 'plugin_assistant.select_agent',
  accentColor: (isDark) => isDark ? '#4FC3F7' : '#0288D1',
  accentGradientEnd: (isDark) => isDark ? '#29B6F6' : '#0277BD',
  requiredToolId: 'plugin_manager',
  toolLabel: 'Plugin Mgr',
  hasToolKey: 'plugin_assistant.has_plugin_manager',
  noToolKey: 'plugin_assistant.no_plugin_manager',
  hasToolDescKey: 'plugin_assistant.has_plugin_manager_desc',
  noToolDescKey: 'plugin_assistant.no_plugin_manager_desc',
  howToUseKey: 'plugin_assistant.how_to_use',
  stepKeys: ['plugin_assistant.step1', 'plugin_assistant.step2', 'plugin_assistant.step3', 'plugin_assistant.step4'],
});
