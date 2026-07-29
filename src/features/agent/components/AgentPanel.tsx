import { useState, useCallback } from 'react';
import { Box, Tabs, Tab, Divider } from '@mui/material';
import { ChatCircleDotsIcon, GearSixIcon, RobotIcon, NotebookIcon, TerminalIcon } from '@phosphor-icons/react';
import { AgentChat } from './AgentChat';
import { ModelConfigPage } from './ModelConfigPage';
import { AgentManager } from './AgentManager';
import { NoteAssistantTab } from './NoteAssistantTab';
import { TerminalCopilotTab } from './TerminalCopilotTab';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@mui/material/styles';
import { useAgentStore } from '../store/agentStore';

export function AgentPanel() {
  const [tab, setTab] = useState(0);
  const { t } = useTranslation('agent');
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const setActiveAgent = useAgentStore((s) => s.setActiveAgent);
  const requestAgentEditor = useAgentStore((s) => s.requestAgentEditor);

  const handleStartChat = useCallback((agentId: string) => {
    setActiveAgent(agentId);
    setTab(0);
  }, [setActiveAgent]);

  const handleManageAgent = useCallback((agentId: string, toolId?: string) => {
    requestAgentEditor(agentId, toolId ?? null);
    setTab(1);
  }, [requestAgentEditor]);

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Tabs
        value={tab}
        onChange={(_, v) => setTab(v)}
        variant="scrollable"
        scrollButtons="auto"
        sx={{
          minHeight: 36,
          '& .MuiTab-root': { minHeight: 36, py: 0, fontSize: 11, minWidth: 'auto', px: 1.5 },
        }}
      >
        <Tab
          icon={<ChatCircleDotsIcon size={16} color={isDark ? '#CE93D8' : '#7B1FA2'} />}
          iconPosition="start"
          label={t('chat.label')}
        />
        <Tab
          icon={<RobotIcon size={16} color={isDark ? '#81C784' : '#2E7D32'} />}
          iconPosition="start"
          label={t('agent.label')}
        />
        <Tab
          icon={<NotebookIcon size={16} color={isDark ? '#6C63FF' : '#5B54E0'} />}
          iconPosition="start"
          label={t('note_assistant.label')}
        />
        <Tab
          icon={<TerminalIcon size={16} color={isDark ? '#81C784' : '#2E7D32'} />}
          iconPosition="start"
          label={t('copilot.label')}
        />
        <Tab
          icon={<GearSixIcon size={16} color={isDark ? '#90A4AE' : '#546E7A'} />}
          iconPosition="start"
          label={t('config.model_config')}
        />
      </Tabs>
      <Divider />
      <Box sx={{ flex: 1, overflow: 'auto', minWidth: 0, minHeight: 0 }}>
        {tab === 0 && <AgentChat />}
        {tab === 1 && <AgentManager />}
        {tab === 2 && <NoteAssistantTab onStartChat={handleStartChat} onManageAgent={handleManageAgent} />}
        {tab === 3 && <TerminalCopilotTab onStartChat={handleStartChat} onManageAgent={handleManageAgent} />}
        {tab === 4 && <ModelConfigPage />}
      </Box>
    </Box>
  );
}
