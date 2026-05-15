import { useState, useEffect } from 'react';
import {
  Box, Typography, Select, MenuItem, FormControl, Chip, Paper, Divider,
} from '@mui/material';
import {
  RobotIcon, NotebookIcon, Sparkle,
} from '@phosphor-icons/react';
import { useAgentStore } from '../store/agentStore';
import { useNotebookStore } from '../../notebook/store/notebookStore';
import { useTranslation } from 'react-i18next';

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

export function NoteAssistantTab() {
  const { t } = useTranslation('agent');
  const {
    agents, models, loadAgents, loadModels,
  } = useAgentStore();
  const {
    loadGroups,
  } = useNotebookStore();

  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(getNoteAssistantAgentId());

  useEffect(() => {
    loadAgents();
    loadModels();
    loadGroups();
  }, [loadAgents, loadModels, loadGroups]);

  const handleAgentChange = (agentId: string) => {
    setSelectedAgentId(agentId);
    setNoteAssistantAgentId(agentId);
  };

  const selectedAgent = agents.find((a) => a.id === selectedAgentId);
  const hasNotebookTool = selectedAgent ? selectedAgent.toolIds.includes('notebook') : false;

  return (
    <Box sx={{ height: '100%', width: '100%', display: 'flex', flexDirection: 'column', p: 2, minWidth: 0, minHeight: 0, overflow: 'auto' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <NotebookIcon size={20} weight="duotone" color="#CE93D8" />
        <Typography variant="subtitle2" sx={{ fontWeight: 700, fontSize: 14 }}>
          {t('note_assistant.title')}
        </Typography>
      </Box>

      <Typography variant="caption" sx={{ color: 'text.secondary', mb: 1.5, lineHeight: 1.6 }}>
        {t('note_assistant.description')}
      </Typography>

      <FormControl size="small" fullWidth sx={{ mb: 2 }}>
        <Select
          value={selectedAgentId || ''}
          displayEmpty
          onChange={(e) => handleAgentChange(e.target.value)}
          renderValue={(value) => {
            if (!value) {
              return (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, color: 'text.secondary' }}>
                  <Sparkle size={16} />
                  <Typography variant="body2" sx={{ fontSize: 13 }}>
                    {t('note_assistant.select_agent')}
                  </Typography>
                </Box>
              );
            }
            const agent = agents.find((a) => a.id === value);
            const model = agent ? models.find((m) => m.id === agent.modelId) : null;
            return (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Box
                  sx={{
                    width: 22, height: 22, borderRadius: '50%',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: 'linear-gradient(135deg, #CE93D8 0%, #EA80FC 100%)',
                    color: '#fff', flexShrink: 0,
                  }}
                >
                  <RobotIcon size={11} weight="bold" />
                </Box>
                <Typography variant="body2" sx={{ fontWeight: 600, fontSize: 13 }}>
                  {agent?.name || ''}
                </Typography>
                {model && (
                  <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: 10, bgcolor: 'rgba(206,147,216,0.1)', px: 0.75, py: 0.25, borderRadius: 1 }}>
                    {model.name}
                  </Typography>
                )}
              </Box>
            );
          }}
          sx={{
            borderRadius: 2,
            bgcolor: 'rgba(206,147,216,0.04)',
            '& .MuiSelect-select': { py: 0.75, pr: 3 },
            '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(206,147,216,0.15)' },
            '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(206,147,216,0.3)' },
            '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(206,147,216,0.5)' },
          }}
        >
          {agents.length === 0 && (
            <MenuItem disabled value="">
              <Typography variant="body2" sx={{ color: 'text.secondary', fontSize: 12 }}>
                {t('agent.no_agents')}
              </Typography>
            </MenuItem>
          )}
          {agents.map((agent) => {
            const model = models.find((m) => m.id === agent.modelId);
            const hasNotebook = agent.toolIds.includes('notebook');
            return (
              <MenuItem key={agent.id} value={agent.id}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
                  <Box
                    sx={{
                      width: 24, height: 24, borderRadius: '50%',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      background: 'linear-gradient(135deg, #CE93D8 0%, #EA80FC 100%)',
                      color: '#fff', flexShrink: 0,
                    }}
                  >
                    <RobotIcon size={12} weight="bold" />
                  </Box>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      <Typography variant="body2" sx={{ fontWeight: 600, fontSize: 13 }}>
                        {agent.name}
                      </Typography>
                      {hasNotebook && (
                        <Chip label="Notebook" size="small" sx={{ height: 16, fontSize: 9, bgcolor: 'rgba(129,199,132,0.1)', color: '#81C784' }} />
                      )}
                    </Box>
                    {agent.description && (
                      <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: 10, display: 'block' }} noWrap>
                        {agent.description}
                      </Typography>
                    )}
                  </Box>
                  {model && (
                    <Chip label={model.name} size="small" sx={{ height: 18, fontSize: 9, flexShrink: 0 }} />
                  )}
                </Box>
              </MenuItem>
            );
          })}
        </Select>
      </FormControl>

      {selectedAgent && (
        <Paper
          variant="outlined"
          sx={{
            p: 1.5,
            borderRadius: 2,
            borderColor: hasNotebookTool ? 'rgba(129,199,132,0.3)' : 'rgba(255,183,77,0.3)',
            bgcolor: hasNotebookTool ? 'rgba(129,199,132,0.04)' : 'rgba(255,183,77,0.04)',
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
            {hasNotebookTool ? (
              <Typography variant="caption" sx={{ color: '#81C784', fontWeight: 600, fontSize: 11 }}>
                ✓ {t('note_assistant.has_notebook_tool')}
              </Typography>
            ) : (
              <Typography variant="caption" sx={{ color: '#FFB74D', fontWeight: 600, fontSize: 11 }}>
                ⚠ {t('note_assistant.no_notebook_tool')}
              </Typography>
            )}
          </Box>
          <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: 10, lineHeight: 1.5 }}>
            {hasNotebookTool
              ? t('note_assistant.has_notebook_tool_desc')
              : t('note_assistant.no_notebook_tool_desc')}
          </Typography>
        </Paper>
      )}

      <Divider sx={{ my: 2, borderColor: 'rgba(48,54,61,0.4)' }} />

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
        <Sparkle size={16} weight="duotone" color="#6C63FF" />
        <Typography variant="caption" sx={{ fontWeight: 600, fontSize: 12 }}>
          {t('note_assistant.how_to_use')}
        </Typography>
      </Box>

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2, borderColor: 'rgba(108,99,255,0.15)', bgcolor: 'rgba(108,99,255,0.03)' }}>
          <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: 11, lineHeight: 1.6 }}>
            {t('note_assistant.step1')}
          </Typography>
        </Paper>
        <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2, borderColor: 'rgba(108,99,255,0.15)', bgcolor: 'rgba(108,99,255,0.03)' }}>
          <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: 11, lineHeight: 1.6 }}>
            {t('note_assistant.step2')}
          </Typography>
        </Paper>
        <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2, borderColor: 'rgba(108,99,255,0.15)', bgcolor: 'rgba(108,99,255,0.03)' }}>
          <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: 11, lineHeight: 1.6 }}>
            {t('note_assistant.step3')}
          </Typography>
        </Paper>
      </Box>
    </Box>
  );
}
