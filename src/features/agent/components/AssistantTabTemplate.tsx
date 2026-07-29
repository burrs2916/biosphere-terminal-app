import { useState, useEffect, ReactNode } from 'react';
import {
  Box, Typography, Select, MenuItem, FormControl, Chip, Paper, Divider, Button,
} from '@mui/material';
import {
  RobotIcon, Sparkle, ChatCircleDotsIcon,
} from '@phosphor-icons/react';
import { useAgentStore } from '../store/agentStore';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@mui/material/styles';

export interface AssistantTabConfig {
  storageKey: string;
  icon: ReactNode;
  titleKey: string;
  descriptionKey: string;
  selectAgentKey: string;
  accentColor: (isDark: boolean) => string;
  accentGradientEnd: (isDark: boolean) => string;
  requiredToolId: string | string[];
  toolLabel: string;
  hasToolKey: string;
  noToolKey: string;
  hasToolDescKey: string;
  noToolDescKey: string;
  howToUseKey: string;
  stepKeys: string[];
  extraLoadDeps?: () => void[];
}

export function createAssistantTab(config: AssistantTabConfig) {
  return function AssistantTab({ onStartChat, onManageAgent }: { onStartChat: (agentId: string) => void; onManageAgent?: (agentId: string, toolId?: string) => void }) {
    const { t } = useTranslation('agent');
    const theme = useTheme();
    const isDark = theme.palette.mode === 'dark';
    const accentColor = config.accentColor(isDark);
    const accentGradientEnd = config.accentGradientEnd(isDark);
    const primaryColor = isDark ? '#6C63FF' : '#5B54E0';
    const successColor = isDark ? '#81C784' : '#2E7D32';
    const warningColor = isDark ? '#FFB74D' : '#E65100';
    const dividerColor = isDark ? 'rgba(48,54,61,0.4)' : 'rgba(0,0,0,0.08)';

    const { agents, models, loadAgents, loadModels } = useAgentStore();

    const [selectedAgentId, setSelectedAgentId] = useState<string | null>(
      () => localStorage.getItem(config.storageKey)
    );

    const extraDeps = config.extraLoadDeps ? config.extraLoadDeps() : [];

    useEffect(() => {
      loadAgents();
      loadModels();
    }, [loadAgents, loadModels, ...extraDeps]);

    const handleAgentChange = (agentId: string) => {
      setSelectedAgentId(agentId);
      localStorage.setItem(config.storageKey, agentId);
    };

    const selectedAgent = agents.find((a) => a.id === selectedAgentId);
    const requiredToolIds = Array.isArray(config.requiredToolId) ? config.requiredToolId : [config.requiredToolId];
    const hasRequiredTool = selectedAgent
      ? requiredToolIds.some((tid) => selectedAgent.toolIds.includes(tid))
      : false;

    return (
      <Box sx={{ height: '100%', width: '100%', display: 'flex', flexDirection: 'column', p: 2, minWidth: 0, minHeight: 0, overflow: 'auto' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
          {config.icon}
          <Typography variant="subtitle2" sx={{ fontWeight: 700, fontSize: 14 }}>
            {t(config.titleKey)}
          </Typography>
        </Box>

        <Typography variant="caption" sx={{ color: 'text.secondary', mb: 1.5, lineHeight: 1.6 }}>
          {t(config.descriptionKey)}
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
                      {t(config.selectAgentKey)}
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
                      background: `linear-gradient(135deg, ${config.accentColor} 0%, ${config.accentGradientEnd} 100%)`,
                      color: '#fff', flexShrink: 0,
                    }}
                  >
                    <RobotIcon size={11} weight="bold" />
                  </Box>
                  <Typography variant="body2" sx={{ fontWeight: 600, fontSize: 13 }}>
                    {agent?.name || ''}
                  </Typography>
                  {model && (
                    <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: 10, bgcolor: `${config.accentColor}15`, px: 0.75, py: 0.25, borderRadius: 1 }}>
                      {model.name}
                    </Typography>
                  )}
                </Box>
              );
            }}
            sx={{
              borderRadius: 2,
              bgcolor: `${config.accentColor}06`,
              '& .MuiSelect-select': { py: 0.75, pr: 3 },
              '& .MuiOutlinedInput-notchedOutline': { borderColor: `${config.accentColor}20` },
              '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: `${config.accentColor}40` },
              '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: `${config.accentColor}60` },
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
              const agentHasTool = requiredToolIds.some((tid) => agent.toolIds.includes(tid));
              return (
                <MenuItem key={agent.id} value={agent.id}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
                    <Box
                      sx={{
                        width: 24, height: 24, borderRadius: '50%',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: `linear-gradient(135deg, ${config.accentColor} 0%, ${config.accentGradientEnd} 100%)`,
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
                        {agentHasTool && (
                          <Chip label={config.toolLabel} size="small" sx={{ height: 16, fontSize: 9, bgcolor: `${successColor}15`, color: successColor }} />
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
              borderColor: hasRequiredTool ? `${successColor}40` : `${warningColor}40`,
              bgcolor: hasRequiredTool ? `${successColor}08` : `${warningColor}08`,
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
              <Typography variant="caption" sx={{ color: hasRequiredTool ? successColor : warningColor, fontWeight: 600, fontSize: 11 }}>
                {hasRequiredTool ? `✓ ${t(config.hasToolKey)}` : `⚠ ${t(config.noToolKey)}`}
              </Typography>
            </Box>
            <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: 10, lineHeight: 1.5 }}>
              {hasRequiredTool ? t(config.hasToolDescKey) : t(config.noToolDescKey)}
            </Typography>
            {!hasRequiredTool && onManageAgent && (
              <Button
                size="small"
                variant="outlined"
                fullWidth
                onClick={() => onManageAgent(selectedAgentId!, requiredToolIds[0])}
                sx={{
                  mt: 1, textTransform: 'none', fontSize: 11, borderRadius: 2,
                  borderColor: warningColor, color: warningColor,
                  '&:hover': { borderColor: warningColor, bgcolor: `${warningColor}10` },
                }}
              >
                {t('assistant.enable_tool')}
              </Button>
            )}
          </Paper>
        )}

        {selectedAgentId && (
          <Button
            fullWidth
            size="small"
            variant="contained"
            startIcon={<ChatCircleDotsIcon size={14} weight="bold" />}
            onClick={() => onStartChat(selectedAgentId)}
            sx={{
              mt: 2, borderRadius: 2, textTransform: 'none', fontSize: 12, fontWeight: 600,
              bgcolor: accentColor, '&:hover': { bgcolor: accentGradientEnd },
            }}
          >
            {t('assistant.start_chat')}
          </Button>
        )}

        <Divider sx={{ my: 2, borderColor: dividerColor }} />

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
          <Sparkle size={16} weight="duotone" color={primaryColor} />
          <Typography variant="caption" sx={{ fontWeight: 600, fontSize: 12 }}>
            {t(config.howToUseKey)}
          </Typography>
        </Box>

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {config.stepKeys.map((stepKey) => (
            <Paper key={stepKey} variant="outlined" sx={{ p: 1.5, borderRadius: 2, borderColor: `${primaryColor}20`, bgcolor: `${primaryColor}06` }}>
              <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: 11, lineHeight: 1.6 }}>
                {t(stepKey)}
              </Typography>
            </Paper>
          ))}
        </Box>
      </Box>
    );
  };
}
