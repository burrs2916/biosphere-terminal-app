import { NotebookIcon } from '@phosphor-icons/react';
import { createAssistantTab } from './AssistantTabTemplate';

const STORAGE_KEY = 'biosphere_note_assistant_agent_id';

export function getNoteAssistantAgentId(): string | null {
  return localStorage.getItem(STORAGE_KEY);
}

export function setNoteAssistantAgentId(id: string | null) {
  if (id) {
    localStorage.setItem(STORAGE_KEY, id);
  } else {
    localStorage.removeItem(STORAGE_KEY);
  }
}

export const NoteAssistantTab = createAssistantTab({
  storageKey: STORAGE_KEY,
  icon: <NotebookIcon size={20} weight="duotone" />,
  titleKey: 'note_assistant.title',
  descriptionKey: 'note_assistant.description',
  selectAgentKey: 'note_assistant.select_agent',
  accentColor: (isDark) => isDark ? '#CE93D8' : '#7B1FA2',
  accentGradientEnd: (isDark) => isDark ? '#BA68C8' : '#6A1B9A',
  requiredToolId: 'notebook',
  toolLabel: 'Notebook',
  hasToolKey: 'note_assistant.has_notebook_tool',
  noToolKey: 'note_assistant.no_notebook_tool',
  hasToolDescKey: 'note_assistant.has_notebook_tool_desc',
  noToolDescKey: 'note_assistant.no_notebook_tool_desc',
  howToUseKey: 'note_assistant.how_to_use',
  stepKeys: ['note_assistant.step1', 'note_assistant.step2', 'note_assistant.step3'],
});
