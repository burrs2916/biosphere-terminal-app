import { useState, useEffect } from 'react';
import {
  Box, Typography, Paper, IconButton, TextField, Button, Select, MenuItem,
  FormControl, InputLabel, Slider, Chip, Dialog, DialogTitle, DialogContent,
  DialogActions, Card, CardContent, Snackbar, Alert,
  FormHelperText, Tooltip,
} from '@mui/material';
import {
  PlusIcon, TrashIcon, RobotIcon, FloppyDiskIcon, XIcon, FolderOpenIcon,
} from '@phosphor-icons/react';
import { useAgentStore } from '../store/agentStore';
import { usePluginStore } from '../store/pluginStore';
import { updateAgentAllowedTools, listConversations } from '../../../core/services/agent.service';
import type { AgentDto } from '../../../proto/agent';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@mui/material/styles';
import { open } from '@tauri-apps/plugin-dialog';

const BUILTIN_TOOLS = ['terminal', 'notebook', 'file', 'command_history', 'terminal_session', 'plugin_manager'];

interface AgentFormData {
  id: string;
  name: string;
  description: string;
  modelId: string;
  systemPrompt: string;
  temperature: number;
  maxIterations: number;
  toolIds: string[];
  triggerType: string;
  autoConfirm: boolean;
  permissionMode: string;
  alwaysAllowedTools: string[];
  fallbackModelId: string;
  workspaceDir: string;
  createdAt: number;
}

function defaultFormData(): AgentFormData {
  return {
    id: '',
    name: '',
    description: '',
    modelId: '',
    systemPrompt: '',
    temperature: 0.7,
    maxIterations: 10,
    toolIds: ['terminal'],
    triggerType: 'manual',
    autoConfirm: false,
    permissionMode: 'confirm',
    alwaysAllowedTools: [],
    fallbackModelId: '',
    workspaceDir: '',
    createdAt: 0,
  };
}

export function AgentManager() {
  const {
    agents, models, loadAgents, loadModels, saveAgent, deleteAgent,
  } = useAgentStore();
  const { pluginTools, loadPluginTools, plugins, groups, loadGroups } = usePluginStore();
  const { t } = useTranslation('agent');
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const agentColor = isDark ? '#CE93D8' : '#7B1FA2';

  const [editing, setEditing] = useState<AgentFormData | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; name: string; convCount: number } | null>(null);
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({
    open: false,
    message: '',
    severity: 'success',
  });

  useEffect(() => {
    loadAgents();
    loadModels();
    loadPluginTools();
    loadGroups();

    const interval = setInterval(() => {
      loadPluginTools();
    }, 60000);

    return () => clearInterval(interval);
  }, [loadAgents, loadModels, loadPluginTools, loadGroups]);

  const handleNew = () => {
    setEditing({
      ...defaultFormData(),
      id: crypto.randomUUID(),
    });
  };

  const handleEdit = (agent: AgentDto) => {
    setEditing({
      id: agent.id,
      name: agent.name,
      description: agent.description,
      modelId: agent.modelId,
      systemPrompt: agent.systemPrompt,
      temperature: agent.temperature,
      maxIterations: agent.maxIterations,
      toolIds: [...agent.toolIds],
      triggerType: agent.triggerType || 'manual',
      autoConfirm: agent.autoConfirm || false,
      permissionMode: agent.permissionMode || 'confirm',
      alwaysAllowedTools: agent.alwaysAllowedTools || [],
      fallbackModelId: agent.fallbackModelId || '',
      workspaceDir: agent.workspaceDir || '',
      createdAt: agent.createdAt || 0,
    });
  };

  const handleSave = async () => {
    if (!editing || !editing.name.trim()) {
      setSnackbar({ open: true, message: t('agent.name_required'), severity: 'error' });
      return;
    }
    if (!editing.modelId) {
      setSnackbar({ open: true, message: t('agent.model_required'), severity: 'error' });
      return;
    }

    try {
      await saveAgent({
        id: editing.id,
        name: editing.name,
        description: editing.description,
        modelId: editing.modelId,
        systemPrompt: editing.systemPrompt,
        temperature: editing.temperature,
        maxIterations: editing.maxIterations,
        toolIds: editing.toolIds,
        triggerType: editing.triggerType,
        autoConfirm: editing.autoConfirm,
        permissionMode: editing.permissionMode,
        alwaysAllowedTools: editing.alwaysAllowedTools,
        fallbackModelId: editing.fallbackModelId,
        workspaceDir: editing.workspaceDir,
        createdAt: editing.createdAt || Date.now(),
        updatedAt: Date.now(),
      });
      setSnackbar({ open: true, message: t('agent.save_success'), severity: 'success' });
      setEditing(null);
    } catch (error) {
      setSnackbar({ open: true, message: 'Save failed', severity: 'error' });
    }
  };

  const handleCancel = () => {
    setEditing(null);
  };

  const handleDelete = async (id: string) => {
    await deleteAgent(id);
    setDeleteConfirm(null);
    if (editing?.id === id) {
      setEditing(null);
    }
    setSnackbar({ open: true, message: 'Deleted successfully', severity: 'success' });
  };

  const toggleTool = (toolId: string) => {
    if (!editing) return;
    const toolIds = editing.toolIds.includes(toolId)
      ? editing.toolIds.filter((t) => t !== toolId)
      : [...editing.toolIds, toolId];
    setEditing({ ...editing, toolIds });
  };

  const getToolLabel = (toolId: string) => {
    const key = `agent.tool_${toolId}`;
    const translated = t(key, { defaultValue: toolId });
    return translated === key ? toolId : translated;
  };

  const getTriggerTypeLabel = (value: string) => {
    const key = `agent.trigger_type_${value}`;
    const translated = t(key, { defaultValue: value });
    return translated === key ? value : translated;
  };

  const enabledModels = models.filter((m) => m.enabled);
  const triggerTypes = [
    { value: 'manual', label: getTriggerTypeLabel('manual') },
    { value: 'auto_failure', label: getTriggerTypeLabel('auto_failure') },
    { value: 'auto_save', label: getTriggerTypeLabel('auto_save') },
    { value: 'auto_both', label: getTriggerTypeLabel('auto_both') },
  ];

  return (
    <Box sx={{ height: '100%', width: '100%', display: 'flex', flexDirection: 'column', p: 3, minWidth: 0, minHeight: 0 }}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 3 }}>
        <Typography variant="h6" sx={{ flex: 1, fontWeight: 700, fontSize: 18 }}>
          {t('agent.manager_title')}
        </Typography>
        <Tooltip title={t('agent.new_agent')}>
          <IconButton
            onClick={handleNew}
            sx={{
              background: `linear-gradient(135deg, ${agentColor} 0%, ${isDark ? '#EA80FC' : '#9C27B0'} 100%)`,
              color: '#fff',
              '&:hover': { opacity: 0.9 },
            }}
          >
            <PlusIcon size={20} weight="bold" />
          </IconButton>
        </Tooltip>
      </Box>

      <Box sx={{ flex: 1, overflow: 'hidden', display: 'flex', gap: 3, minHeight: 0 }}>
        <Box sx={{ width: { xs: '100%', md: 280 }, minWidth: 200, flexShrink: 0, overflow: 'auto' }}>
          {agents.length === 0 ? (
            <Paper
              variant="outlined"
              sx={{
                p: 3,
                textAlign: 'center',
                borderStyle: 'dashed',
                borderColor: 'divider',
              }}
            >
              <RobotIcon size={48} color={isDark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.2)'} />
              <Typography variant="body2" sx={{ color: 'text.secondary', mt: 1 }}>
                {t('agent.no_agents')}
              </Typography>
              <Button
                size="small"
                onClick={handleNew}
                sx={{ mt: 2, textTransform: 'none' }}
              >
                {t('agent.new_agent')}
              </Button>
            </Paper>
          ) : (
            agents.map((agent) => {
              const model = models.find((m) => m.id === agent.modelId);
              const isSelected = editing?.id === agent.id;
              return (
                <Paper
                  key={agent.id}
                  variant="outlined"
                  onClick={() => handleEdit(agent)}
                  sx={{
                    p: 2,
                    mb: 1.5,
                    cursor: 'pointer',
                    borderRadius: 2,
                    borderColor: isSelected ? 'primary.main' : 'divider',
                    bgcolor: isSelected ? `${agentColor}10` : 'transparent',
                    transition: 'all 0.2s',
                    '&:hover': {
                      borderColor: 'primary.main',
                      bgcolor: `${agentColor}08`,
                    },
                  }}
                >
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1 }}>
                    <Box
                      sx={{
                        width: 36,
                        height: 36,
                        borderRadius: 2,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        background: isSelected
                          ? `linear-gradient(135deg, ${agentColor} 0%, ${isDark ? '#EA80FC' : '#9C27B0'} 100%)`
                          : (isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'),
                        color: isSelected ? '#fff' : (isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.4)'),
                      }}
                    >
                      <RobotIcon size={18} weight="bold" />
                    </Box>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="subtitle2" sx={{ fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {agent.name}
                      </Typography>
                      <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: 11 }}>
                        {model?.name || t('agent.no_model')}
                      </Typography>
                    </Box>
                    <IconButton
                      size="small"
                      onClick={(e) => {
                        e.stopPropagation();
                        listConversations(agent.id).then((convs) => {
                          setDeleteConfirm({ id: agent.id, name: agent.name, convCount: convs.length });
                        }).catch(() => {
                          setDeleteConfirm({ id: agent.id, name: agent.name, convCount: 0 });
                        });
                      }}
                      sx={{
                        p: 0.5,
                        opacity: 0.6,
                        '&:hover': { opacity: 1, color: 'error.main' },
                      }}
                    >
                      <TrashIcon size={16} />
                    </IconButton>
                  </Box>
                  {agent.description && (
                    <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {agent.description}
                    </Typography>
                  )}
                  <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                    {agent.toolIds.slice(0, 3).map((tid) => (
                      <Chip
                        key={tid}
                        label={getToolLabel(tid)}
                        size="small"
                        sx={{ height: 20, fontSize: 10 }}
                      />
                    ))}
                    {agent.toolIds.length > 3 && (
                      <Chip
                        label={`+${agent.toolIds.length - 3}`}
                        size="small"
                        sx={{ height: 20, fontSize: 10 }}
                      />
                    )}
                  </Box>
                </Paper>
              );
            })
          )}
        </Box>

        <Box sx={{ flex: 1, minWidth: 0, overflow: 'auto' }}>
          {editing ? (
            <Card sx={{ borderRadius: 2, boxShadow: '0 4px 20px rgba(0,0,0,0.15)' }}>
              <CardContent sx={{ p: 3 }}>
                {/* Editor Header */}
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 3 }}>
                  <Typography variant="h6" sx={{ flex: 1, fontSize: 16, fontWeight: 600 }}>
                    {agents.find((a) => a.id === editing.id)
                      ? t('agent.edit_agent')
                      : t('agent.new_agent')}
                  </Typography>
                  <Button
                    size="small"
                    onClick={handleCancel}
                    startIcon={<XIcon size={16} />}
                    sx={{ textTransform: 'none', color: 'text.secondary' }}
                  >
                    {t('agent.cancel')}
                  </Button>
                  <Button
                    size="small"
                    variant="contained"
                    startIcon={<FloppyDiskIcon size={16} weight="bold" />}
                    onClick={handleSave}
                    disabled={!editing.name.trim() || !editing.modelId}
                    sx={{
                      background: `linear-gradient(135deg, ${agentColor} 0%, ${isDark ? '#EA80FC' : '#9C27B0'} 100%)`,
                      textTransform: 'none',
                      fontSize: 13,
                      '&:disabled': { opacity: 0.5 },
                    }}
                  >
                    {t('agent.save')}
                  </Button>
                </Box>

                {/* Basic Info Section */}
                <Typography variant="subtitle2" sx={{ mb: 2, color: 'primary.main', fontWeight: 600 }}>
                  {t('agent.basic_info')}
                </Typography>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, mb: 3 }}>
                  <Box sx={{ flex: { xs: '1 1 100%', md: '1 1 calc(50% - 8px)' } }}>
                    <TextField
                      fullWidth
                      size="small"
                      label={t('agent.name_label')}
                      value={editing.name}
                      onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                      error={!editing.name.trim()}
                      helperText={!editing.name.trim() ? t('agent.name_required') : ''}
                    />
                  </Box>
                  <Box sx={{ flex: { xs: '1 1 100%', md: '1 1 calc(50% - 8px)' } }}>
                    <FormControl fullWidth size="small" error={!editing.modelId}>
                      <InputLabel>{t('agent.model_label')}</InputLabel>
                      <Select
                        value={editing.modelId}
                        label={t('agent.model_label')}
                        onChange={(e) => setEditing({ ...editing, modelId: e.target.value })}
                      >
                        <MenuItem value="">{t('agent.select_model')}</MenuItem>
                        {enabledModels.map((model) => (
                          <MenuItem key={model.id} value={model.id}>
                            {model.name} ({model.refKey})
                          </MenuItem>
                        ))}
                      </Select>
                      {!editing.modelId && (
                        <FormHelperText error>{t('agent.model_required')}</FormHelperText>
                      )}
                    </FormControl>
                  </Box>
                  <Box sx={{ flex: '1 1 100%' }}>
                    <TextField
                      fullWidth
                      size="small"
                      label={t('agent.description_label')}
                      value={editing.description}
                      onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                      multiline
                      rows={2}
                      placeholder={t('agent.system_prompt_placeholder')}
                    />
                  </Box>
                </Box>

                {/* Model Config Section */}
                <Typography variant="subtitle2" sx={{ mb: 2, color: 'primary.main', fontWeight: 600 }}>
                  {t('agent.model_config')}
                </Typography>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, mb: 3 }}>
                  <Box sx={{ flex: { xs: '1 1 100%', md: '1 1 calc(50% - 8px)' } }}>
                    <FormControl fullWidth size="small">
                      <InputLabel>{t('agent.trigger_type_label')}</InputLabel>
                      <Select
                        value={editing.triggerType}
                        label={t('agent.trigger_type_label')}
                        onChange={(e) => setEditing({ ...editing, triggerType: e.target.value })}
                      >
                        {triggerTypes.map((tt) => (
                          <MenuItem key={tt.value} value={tt.value}>
                            {tt.label}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  </Box>
                  <Box sx={{ flex: { xs: '1 1 100%', md: '1 1 calc(50% - 8px)' }, display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                      {t('agent.auto_confirm_label')}
                    </Typography>
                    <Chip
                      label={editing.autoConfirm ? 'ON' : 'OFF'}
                      size="small"
                      variant={editing.autoConfirm ? 'filled' : 'outlined'}
                      color={editing.autoConfirm ? 'success' : 'default'}
                      onClick={() => setEditing({ ...editing, autoConfirm: !editing.autoConfirm })}
                      sx={{ cursor: 'pointer' }}
                    />
                  </Box>
                  <Box sx={{ flex: { xs: '1 1 100%', md: '1 1 calc(50% - 8px)' } }}>
                    <FormControl fullWidth size="small">
                      <InputLabel>Permission Mode</InputLabel>
                      <Select
                        value={editing.permissionMode}
                        label="Permission Mode"
                        onChange={(e) => setEditing({ ...editing, permissionMode: e.target.value })}
                      >
                        <MenuItem value="confirm">
                          Confirm — Ask before high-risk actions
                        </MenuItem>
                        <MenuItem value="auto">
                          Auto — Execute all actions without confirmation
                        </MenuItem>
                      </Select>
                    </FormControl>
                  </Box>
                  <Box sx={{ flex: { xs: '1 1 100%', md: '1 1 calc(50% - 8px)' } }}>
                    <FormControl fullWidth size="small">
                      <InputLabel>Fallback Model</InputLabel>
                      <Select
                        value={editing.fallbackModelId}
                        label="Fallback Model"
                        onChange={(e) => setEditing({ ...editing, fallbackModelId: e.target.value })}
                      >
                        <MenuItem value="">
                          <em>None</em>
                        </MenuItem>
                        {models.filter((m) => m.id !== editing.modelId).map((m) => (
                          <MenuItem key={m.id} value={m.id}>
                            {m.name || m.refKey}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  </Box>
                  <Box sx={{ flex: { xs: '1 1 100%', md: '1 1 calc(50% - 8px)' } }}>
                    <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'flex-start' }}>
                      <TextField
                        fullWidth
                        size="small"
                        label={t('agent.workspace_dir')}
                        placeholder={t('agent.workspace_dir_placeholder')}
                        value={editing.workspaceDir}
                        onChange={(e) => setEditing({ ...editing, workspaceDir: e.target.value })}
                        helperText={t('agent.workspace_dir_helper')}
                        sx={{ '& .MuiFormHelperText-root': { fontSize: '0.7rem' } }}
                      />
                      <Tooltip title={t('agent.select_workspace_dir')}>
                        <IconButton
                          size="small"
                          sx={{ mt: 0.5 }}
                          onClick={async () => {
                            try {
                              const selected = await open({
                                directory: true,
                                title: t('agent.select_workspace_dir'),
                              });
                              if (selected && typeof selected === 'string') {
                                setEditing({ ...editing, workspaceDir: selected });
                              }
                            } catch (err) { console.error('AgentManager: operation failed', err); }
                          }}
                        >
                          <FolderOpenIcon size={20} />
                        </IconButton>
                      </Tooltip>
                    </Box>
                  </Box>
                  <Box sx={{ flex: { xs: '1 1 100%', md: '1 1 calc(50% - 8px)' } }}>
                    <Box sx={{ mb: 2 }}>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
                        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                          {t('agent.temperature_label')}
                        </Typography>
                        <Typography variant="caption" sx={{ fontFamily: 'monospace', fontWeight: 600 }}>
                          {editing.temperature.toFixed(1)}
                        </Typography>
                      </Box>
                      <Slider
                        value={editing.temperature}
                        onChange={(_, v) => setEditing({ ...editing, temperature: v as number })}
                        min={0}
                        max={2}
                        step={0.1}
                        size="small"
                        sx={{ color: 'primary.main' }}
                      />
                    </Box>
                  </Box>
                  <Box sx={{ flex: { xs: '1 1 100%', md: '1 1 calc(50% - 8px)' } }}>
                    <Box sx={{ mb: 2 }}>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
                        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                          {t('agent.max_iterations_label')}
                        </Typography>
                        <Typography variant="caption" sx={{ fontFamily: 'monospace', fontWeight: 600 }}>
                          {editing.maxIterations}
                        </Typography>
                      </Box>
                      <Slider
                        value={editing.maxIterations}
                        onChange={(_, v) => setEditing({ ...editing, maxIterations: v as number })}
                        min={1}
                        max={50}
                        step={1}
                        size="small"
                        sx={{ color: 'primary.main' }}
                      />
                    </Box>
                  </Box>
                </Box>

                {/* Tools Section */}
                <Typography variant="subtitle2" sx={{ mb: 2, color: 'primary.main', fontWeight: 600 }}>
                  {t('agent.tools_label')}
                </Typography>
                <Box sx={{ display: 'flex', gap: 1, mb: 1, flexWrap: 'wrap' }}>
                  {BUILTIN_TOOLS.map((toolId) => (
                    <Chip
                      key={toolId}
                      label={getToolLabel(toolId)}
                      size="medium"
                      variant={editing.toolIds.includes(toolId) ? 'filled' : 'outlined'}
                      color={editing.toolIds.includes(toolId) ? 'primary' : 'default'}
                      onClick={() => toggleTool(toolId)}
                      sx={{
                        cursor: 'pointer',
                        transition: 'all 0.2s',
                        '&:hover': { transform: 'translateY(-2px)' },
                      }}
                    />
                  ))}
                </Box>
                {pluginTools.length > 0 && (
                  <>
                    <Typography variant="caption" sx={{ mb: 1, color: 'text.secondary', display: 'block' }}>
                      {t('agent.plugin_tools_label')}
                    </Typography>
                    {groups.length > 0 && groups.map((group) => {
                      const groupPluginIds = plugins
                        .filter((p) => p.groupId === group.id && p.enabled)
                        .map((p) => p.id);
                      const groupTools = pluginTools.filter((pt) => {
                        const parentPlugin = plugins.find((p) => p.tools.some((t) => t.name === pt.name));
                        return parentPlugin && groupPluginIds.includes(parentPlugin.id);
                      });
                      if (groupTools.length === 0) return null;
                      return (
                        <Box key={group.id} sx={{ mb: 1 }}>
                          <Typography variant="caption" sx={{ fontSize: 10, color: group.color, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 0.3, mb: 0.5 }}>
                            <span style={{ fontSize: 12 }}>{group.icon}</span> {group.name}
                          </Typography>
                          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                            {groupTools.map((pt) => (
                              <Chip
                                key={pt.name}
                                label={pt.name}
                                size="medium"
                                variant={editing.toolIds.includes(pt.name) ? 'filled' : 'outlined'}
                                color={editing.toolIds.includes(pt.name) ? 'secondary' : 'default'}
                                onClick={() => toggleTool(pt.name)}
                                sx={{ cursor: 'pointer', transition: 'all 0.2s', '&:hover': { transform: 'translateY(-2px)' } }}
                              />
                            ))}
                          </Box>
                        </Box>
                      );
                    })}
                    {(() => {
                      const groupedPluginIds = new Set(
                        groups.flatMap((g) => plugins.filter((p) => p.groupId === g.id && p.enabled).map((p) => p.id))
                      );
                      const ungroupedTools = pluginTools.filter((pt) => {
                        const parentPlugin = plugins.find((p) => p.tools.some((t) => t.name === pt.name));
                        return parentPlugin && !groupedPluginIds.has(parentPlugin.id);
                      });
                      if (ungroupedTools.length === 0) return null;
                      return (
                        <Box sx={{ mb: 3 }}>
                          {groups.length > 0 && (
                            <Typography variant="caption" sx={{ fontSize: 10, color: 'text.disabled', fontWeight: 600, mb: 0.5, display: 'block' }}>
                              {t('ungrouped')}
                            </Typography>
                          )}
                          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                            {ungroupedTools.map((pt) => (
                              <Chip
                                key={pt.name}
                                label={pt.name}
                                size="medium"
                                variant={editing.toolIds.includes(pt.name) ? 'filled' : 'outlined'}
                                color={editing.toolIds.includes(pt.name) ? 'secondary' : 'default'}
                                onClick={() => toggleTool(pt.name)}
                                sx={{ cursor: 'pointer', transition: 'all 0.2s', '&:hover': { transform: 'translateY(-2px)' } }}
                              />
                            ))}
                          </Box>
                        </Box>
                      );
                    })()}
                  </>
                )}

                {editing.toolIds.length > 0 && (
                  <>
                    <Typography variant="subtitle2" sx={{ mb: 1, mt: 1, color: 'warning.main', fontWeight: 600 }}>
                      {t('agent.allowed_tools_label')}
                    </Typography>
                    <Typography variant="caption" sx={{ mb: 1, color: 'text.secondary', display: 'block' }}>
                      {t('agent.allowed_tools_desc')}
                    </Typography>
                    {editing.alwaysAllowedTools.length > 0 && (
                      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 1 }}>
                        {editing.alwaysAllowedTools.map((toolName) => (
                          <Chip
                            key={toolName}
                            label={toolName}
                            size="small"
                            color="warning"
                            variant="outlined"
                            onDelete={() => {
                              const newAllowed = editing.alwaysAllowedTools.filter((t) => t !== toolName);
                              setEditing({ ...editing, alwaysAllowedTools: newAllowed });
                              updateAgentAllowedTools(editing.id, newAllowed);
                            }}
                            deleteIcon={<XIcon size={14} />}
                          />
                        ))}
                      </Box>
                    )}
                    {(() => {
                      const candidates = editing.toolIds.filter((t) => !editing.alwaysAllowedTools.includes(t));
                      if (candidates.length === 0) return null;
                      return (
                        <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                          {candidates.map((toolName) => (
                            <Chip
                              key={toolName}
                              label={toolName}
                              size="small"
                              variant="outlined"
                              sx={{ fontSize: 10, borderColor: 'divider', color: 'text.secondary', '&:hover': { borderColor: 'warning.main', color: 'warning.main' } }}
                              onClick={() => {
                                const newAllowed = [...editing.alwaysAllowedTools, toolName];
                                setEditing({ ...editing, alwaysAllowedTools: newAllowed });
                                updateAgentAllowedTools(editing.id, newAllowed);
                              }}
                            />
                          ))}
                        </Box>
                      );
                    })()}
                  </>
                )}

                {/* System Prompt Section */}
                <Typography variant="subtitle2" sx={{ mb: 2, color: 'primary.main', fontWeight: 600 }}>
                  {t('agent.system_prompt_label')}
                </Typography>
                <TextField
                  fullWidth
                  size="small"
                  value={editing.systemPrompt}
                  onChange={(e) => setEditing({ ...editing, systemPrompt: e.target.value })}
                  multiline
                  rows={8}
                  placeholder={t('agent.system_prompt_placeholder')}
                  sx={{
                    '& .MuiOutlinedInput-root': {
                      fontFamily: 'monospace',
                      fontSize: 13,
                    },
                  }}
                />
              </CardContent>
            </Card>
          ) : (
            <Box
              sx={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                height: '100%',
                opacity: 0.7,
              }}
            >
              <RobotIcon size={64} color={isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.15)'} />
              <Typography variant="h6" sx={{ color: 'text.secondary', mt: 2, mb: 1 }}>
                {t('agent.select_or_create')}
              </Typography>
              <Button
                variant="outlined"
                startIcon={<PlusIcon size={16} />}
                onClick={handleNew}
                sx={{ textTransform: 'none', borderRadius: 2 }}
              >
                {t('agent.new_agent')}
              </Button>
            </Box>
          )}
        </Box>
      </Box>

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deleteConfirm} onClose={() => setDeleteConfirm(null)}>
        <DialogTitle>{t('agent.delete_confirm_title')}</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            {t('agent.delete_confirm_message_with_info', {
              name: deleteConfirm?.name || '',
              convCount: deleteConfirm?.convCount || 0,
              defaultValue: `Are you sure you want to delete agent "${deleteConfirm?.name || ''}"?${deleteConfirm?.convCount ? ` This will also delete ${deleteConfirm.convCount} conversation(s) and all associated messages.` : ''}`,
            })}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button size="small" onClick={() => setDeleteConfirm(null)}>
            {t('agent.cancel')}
          </Button>
          <Button
            size="small"
            color="error"
            variant="contained"
            onClick={() => deleteConfirm && handleDelete(deleteConfirm.id)}
          >
            {t('agent.delete')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Snackbar for notifications */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={4000}
        onClose={() => setSnackbar({ ...snackbar, open: false })}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <Alert
          onClose={() => setSnackbar({ ...snackbar, open: false })}
          severity={snackbar.severity}
          sx={{ width: '100%' }}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
}
