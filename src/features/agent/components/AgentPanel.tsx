import { useState } from 'react';
import { Box, Tabs, Tab, Divider } from '@mui/material';
import { ChatCircleDotsIcon, GearSixIcon, RobotIcon, NotebookIcon } from '@phosphor-icons/react';
import { AgentChat } from './AgentChat';
import { ModelConfigPage } from './ModelConfigPage';
import { AgentManager } from './AgentManager';
import { NoteAssistantTab } from './NoteAssistantTab';
import { useTranslation } from 'react-i18next';

export function AgentPanel() {
  const [tab, setTab] = useState(0);
  const { t } = useTranslation('agent');

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Tabs
        value={tab}
        onChange={(_, v) => setTab(v)}
        sx={{
          minHeight: 36,
          '& .MuiTab-root': { minHeight: 36, py: 0, fontSize: 12 },
        }}
      >
        <Tab
          icon={<ChatCircleDotsIcon size={16} color="#CE93D8" />}
          iconPosition="start"
          label={t('chat.label')}
        />
        <Tab
          icon={<RobotIcon size={16} color="#81C784" />}
          iconPosition="start"
          label={t('agent.label')}
        />
        <Tab
          icon={<NotebookIcon size={16} color="#6C63FF" />}
          iconPosition="start"
          label={t('note_assistant.label')}
        />
        <Tab
          icon={<GearSixIcon size={16} color="#90A4AE" />}
          iconPosition="start"
          label={t('config.model_config')}
        />
      </Tabs>
      <Divider sx={{ borderColor: 'rgba(48, 54, 61, 0.6)' }} />
      <Box sx={{ flex: 1, overflow: 'auto', minWidth: 0, minHeight: 0 }}>
        {tab === 0 && <AgentChat />}
        {tab === 1 && <AgentManager />}
        {tab === 2 && <NoteAssistantTab />}
        {tab === 3 && <ModelConfigPage />}
      </Box>
    </Box>
  );
}
