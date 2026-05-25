import { TerminalIcon } from '@phosphor-icons/react';
import { createAssistantTab } from './AssistantTabTemplate';

const STORAGE_KEY = 'biosphere_terminal_copilot_agent_id';

export { getTerminalCopilotAgentId, setTerminalCopilotAgentId } from '../../../pages/AiCopilotPage';

export const TerminalCopilotTab = createAssistantTab({
  storageKey: STORAGE_KEY,
  icon: <TerminalIcon size={20} weight="duotone" />,
  titleKey: 'copilot.title',
  descriptionKey: 'copilot.description',
  selectAgentKey: 'copilot.select_agent',
  accentColor: (isDark) => isDark ? '#81C784' : '#2E7D32',
  accentGradientEnd: (isDark) => isDark ? '#66BB6A' : '#1B5E20',
  requiredToolId: ['terminal', 'terminal_session'],
  toolLabel: 'Terminal',
  hasToolKey: 'copilot.has_terminal_tool',
  noToolKey: 'copilot.no_terminal_tool',
  hasToolDescKey: 'copilot.has_terminal_tool_desc',
  noToolDescKey: 'copilot.no_terminal_tool_desc',
  howToUseKey: 'copilot.how_to_use',
  stepKeys: ['copilot.step1', 'copilot.step2', 'copilot.step3'],
});
