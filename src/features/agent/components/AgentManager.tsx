import { useState, useEffect, useRef } from 'react';
import type { ReactNode, CSSProperties } from 'react';
import {
  Box, Typography, Paper, IconButton, TextField, Button, Select, MenuItem,
  Slider, Chip, Dialog, DialogTitle, DialogContent,
  DialogActions, Snackbar, Alert,
  FormHelperText, Tooltip, InputAdornment, Switch, Divider,
} from '@mui/material';
import {
  PlusIcon, TrashIcon, RobotIcon, FloppyDiskIcon, XIcon, FolderOpenIcon,
  MagnifyingGlassIcon, IdentificationCardIcon, CpuIcon,
  WrenchIcon, TextAlignLeftIcon,
} from '@phosphor-icons/react';
import { useAgentStore } from '../store/agentStore';
import { listConversations } from '../../../core/services/agent.service';
import type { AgentDto } from '../../../proto/agent';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@mui/material/styles';
import { open } from '@tauri-apps/plugin-dialog';

const ALL_AGENT_TOOLS = ['terminal', 'notebook', 'file', 'command_history', 'terminal_session', 'plugin_manager', 'memory'];
const BRAND = '#6C63FF';
const GRADIENT = 'linear-gradient(135deg, #6C63FF 0%, #4FC3F7 100%)';

// 自造可靠 outlined 字段：彻底弃用 MUI 的 <fieldset><legend> notch。
// Tauri WKWebView 下，MUI 用 legend 渲染缺口时：① 不可靠渲染（缺口不出现）② legend 占满宽度拦截点击（无法输入）。
// 这里用「外层边框 Box + 浮动 label 补丁（与背景同色覆盖边框）」实现，零 fieldset/legend 依赖，WebKit 下 100% 正常。
// 注意：OutlinedField / fieldControlStyle / selectSx 必须定义在模块作用域（组件外），
// 否则每次父组件 render 都会生成新的函数引用，React 会把它当作新组件类型 → 反复卸载重挂 input 子树 → 焦点丢失无法输入。
const fieldControlStyle: CSSProperties = {
  width: '100%',
  border: 'none',
  outline: 'none',
  background: 'transparent',
  padding: '11px 12px',
  fontSize: 14,
  fontFamily: 'inherit',
  color: 'inherit',
  boxSizing: 'border-box',
  display: 'block',
};

const selectSx = {
  width: '100%',
  '& .MuiSelect-select': { py: 1.4, px: 1.5, fontSize: 14 },
  '&:before': { display: 'none' },
  '&:after': { display: 'none' },
};

const OutlinedField = ({
  label,
  required,
  error,
  helperText,
  htmlFor,
  children,
}: {
  label: string;
  required?: boolean;
  error?: boolean;
  helperText?: ReactNode;
  htmlFor?: string;
  children: ReactNode;
}) => (
  <Box sx={{ position: 'relative', width: '100%' }}>
    <Box
      component="label"
      htmlFor={htmlFor}
      sx={{
        position: 'absolute',
        top: 0,
        left: 10,
        transform: 'translateY(-50%)',
        px: 0.5,
        fontSize: 12,
        lineHeight: 1.2,
        fontWeight: 500,
        color: error ? '#FF7B72' : 'text.secondary',
        bgcolor: 'background.paper',
        pointerEvents: 'none',
        zIndex: 1,
      }}
    >
      {label}
      {required && (
        <Box component="span" sx={{ color: '#FF7B72', ml: 0.25 }}>
          *
        </Box>
      )}
    </Box>
    <Box
      sx={{
        border: `1px solid ${error ? '#FF7B72' : 'rgba(108,99,255,0.30)'}`,
        borderRadius: 1.5,
        bgcolor: 'background.paper',
        color: 'text.primary',
        transition: 'border-color .15s ease, box-shadow .15s ease',
        '&:focus-within': {
          borderColor: BRAND,
          boxShadow: `0 0 0 1px ${BRAND}`,
        },
      }}
    >
      {children}
    </Box>
    {helperText != null && (
      <FormHelperText error={error} sx={{ mx: 0, mt: 0.5 }}>
        {helperText}
      </FormHelperText>
    )}
  </Box>
);

interface AgentFormData {
  id: string;
  name: string;
  description: string;
  modelId: string | null;
  systemPrompt: string;
  temperature: number;
  maxIterations: number;
  toolIds: string[];
  triggerType: string;
  autoConfirm: boolean;
  permissionMode: string;
  alwaysAllowedTools: string[];
  fallbackModelId: string | null;
  workspaceDir: string;
  createdAt: number;
}

function defaultFormData(): AgentFormData {
  return {
    id: '',
    name: '',
    description: '',
    modelId: null,
    systemPrompt: '',
    temperature: 0.7,
    maxIterations: 10,
    toolIds: [...ALL_AGENT_TOOLS],
    triggerType: 'manual',
    autoConfirm: false,
    permissionMode: 'confirm',
    alwaysAllowedTools: [],
    fallbackModelId: null,
    workspaceDir: '',
    createdAt: 0,
  };
}

export function AgentManager() {
  const {
    agents, models, endpoints, loadAgents, loadModels, loadEndpoints, saveAgent, deleteAgent,
  } = useAgentStore();
  const pendingAgentEditorId = useAgentStore((s) => s.pendingAgentEditorId);
  const clearPendingAgentEditor = useAgentStore((s) => s.clearPendingAgentEditor);
  const { t } = useTranslation('agent');
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';

  const [editing, setEditing] = useState<AgentFormData | null>(null);
  const [search, setSearch] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; name: string; convCount: number } | null>(null);
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({
    open: false,
    message: '',
    severity: 'success',
  });
  const [nameTouched, setNameTouched] = useState(false);
  const [modelTouched, setModelTouched] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadAgents();
    loadModels();
    loadEndpoints();
  }, [loadAgents, loadModels, loadEndpoints]);

  const handleNew = () => {
    setEditing({
      ...defaultFormData(),
      id: crypto.randomUUID(),
    });
    setNameTouched(false);
    setModelTouched(false);
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
      fallbackModelId: agent.fallbackModelId,
      workspaceDir: agent.workspaceDir || '',
      createdAt: agent.createdAt || 0,
    });
  };

  // 从「笔记助手 / 终端助手」绑定 Tab 跳转过来时，自动打开该智能体编辑器
  useEffect(() => {
    if (!pendingAgentEditorId) return;
    const agent = agents.find((a) => a.id === pendingAgentEditorId);
    if (!agent) return;
    handleEdit(agent);
    clearPendingAgentEditor();
  }, [pendingAgentEditorId, agents, handleEdit, clearPendingAgentEditor]);

  // dialog 打开后自动聚焦名称输入框（自造 OutlinedField 的 input，聚焦即可输入）
  useEffect(() => {
    if (!editing) return;
    const id = window.setTimeout(() => nameInputRef.current?.focus(), 80);
    return () => window.clearTimeout(id);
  }, [editing?.id]);

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
      setSnackbar({ open: true, message: t('agent.save_error'), severity: 'error' });
    }
  };

  const handleCancel = () => {
    setEditing(null);
    setNameTouched(false);
    setModelTouched(false);
  };

  const handleDelete = async (id: string) => {
    await deleteAgent(id);
    setDeleteConfirm(null);
    if (editing?.id === id) {
      setEditing(null);
    }
    setSnackbar({ open: true, message: t('agent.delete_success'), severity: 'success' });
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

  const filteredAgents = agents.filter((a) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      a.name.toLowerCase().includes(q) ||
      (a.description || '').toLowerCase().includes(q)
    );
  });

  // 分区卡片：顶部 4px 渐变条 + 浅品牌色背景 + 圆角 12px，与连接面板 conn-card 视觉一致
  const renderSection = (
    icon: ReactNode,
    title: string,
    description: string | undefined,
    children: ReactNode,
  ) => (
    <Box sx={{ mb: 2.5 }}>
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, mb: 1.2 }}>
        <Box sx={{ width: 4, height: 16, borderRadius: 2, background: GRADIENT, alignSelf: 'center' }} />
        {icon}
        <Typography variant="subtitle2" sx={{ fontWeight: 700, fontSize: 14 }}>
          {title}
        </Typography>
        {description && (
          <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: 11 }}>
            {description}
          </Typography>
        )}
      </Box>
      <Paper
        variant="outlined"
        sx={{
          borderRadius: 2.5,
          overflow: 'hidden',
          borderColor: 'divider',
          bgcolor: isDark ? 'rgba(108,99,255,0.04)' : 'rgba(108,99,255,0.025)',
        }}
      >
        <Box sx={{ height: 3, background: GRADIENT }} />
        <Box sx={{ p: 2.5 }}>{children}</Box>
      </Paper>
    </Box>
  );

  // 自造可靠 outlined 字段组件见文件顶部模块作用域 OutlinedField（必须模块级定义，
  // 否则每次 render 生成新函数引用 → React 把 input 子树反复卸载重挂 → 焦点丢失无法输入）。

  // 滑块小工具：极值 + 当前值 Chip，视觉比之前的 monospace 数字更精致
  const renderSliderField = (
    label: string,
    value: number,
    min: number,
    max: number,
    step: number,
    onChange: (v: number) => void,
  ) => (
    <Box sx={{ mb: 0.5 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          {label}
        </Typography>
        <Chip
          label={value}
          size="small"
          sx={{
            height: 20,
            fontSize: 11,
            fontWeight: 700,
            fontFamily: 'monospace',
            bgcolor: 'rgba(108,99,255,0.10)',
            color: BRAND,
          }}
        />
      </Box>
      <Slider
        value={value}
        onChange={(_, v) => onChange(v as number)}
        min={min}
        max={max}
        step={step}
        size="small"
        marks={[
          { value: min, label: <Typography sx={{ fontSize: 10, color: 'text.disabled' }}>{min}</Typography> },
          { value: max, label: <Typography sx={{ fontSize: 10, color: 'text.disabled' }}>{max}</Typography> },
        ]}
        sx={{ color: BRAND, mt: 1 }}
      />
    </Box>
  );

  return (
    <Box sx={{ height: '100%', width: '100%', display: 'flex', flexDirection: 'column', p: { xs: 2, md: 2.5 }, gap: 2.5, minWidth: 0, minHeight: 0 }}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center' }}>
        <Typography variant="h6" sx={{ flex: 1, fontWeight: 700, fontSize: 18 }}>
          {t('agent.manager_title')}
        </Typography>
        <Button
          variant="contained"
          startIcon={<PlusIcon size={18} weight="bold" />}
          onClick={handleNew}
          sx={{
            textTransform: 'none',
            color: '#fff',
            background: GRADIENT,
            boxShadow: '0 2px 8px rgba(108,99,255,0.3)',
            fontSize: 13,
            px: 2.5,
            py: 1,
            '&:hover': { boxShadow: '0 4px 14px rgba(108,99,255,0.45)', background: GRADIENT },
          }}
        >
          {t('agent.new_agent')}
        </Button>
      </Box>

      <Box sx={{ flex: 1, overflow: 'hidden', display: 'flex', gap: 2.5, minHeight: 0 }}>
        {/* Left: agent list */}
        <Box sx={{ width: { xs: '100%', md: 280 }, minWidth: 220, flexShrink: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <TextField
            size="small"
            placeholder={t('agent.search_placeholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            sx={{ mb: 1.5 }}
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <MagnifyingGlassIcon size={16} />
                  </InputAdornment>
                ),
              },
            }}
          />
          <Box sx={{ flex: 1, overflow: 'auto', pr: 0.5 }}>
            {filteredAgents.length === 0 ? (
              <Typography variant="body2" sx={{ color: 'text.secondary', textAlign: 'center', mt: 4 }}>
                {agents.length === 0 ? t('agent.no_agents') : t('agent.no_search_result')}
              </Typography>
            ) : (
              filteredAgents.map((agent) => {
                const model = models.find((m) => m.id === agent.modelId);
                const modelEndpoint = model ? endpoints.find((e) => e.id === model.endpointId) : undefined;
                const isSelected = editing?.id === agent.id;
                return (
                  <Paper
                    key={agent.id}
                    variant="outlined"
                    onClick={() => handleEdit(agent)}
                    className="agent-item"
                    sx={{
                      p: 1.5,
                      mb: 1,
                      cursor: 'pointer',
                      borderRadius: 2.5,
                      borderColor: isSelected ? 'primary.main' : 'divider',
                      borderLeft: isSelected ? '3px solid' : '1px solid',
                      borderLeftColor: isSelected ? 'primary.main' : 'divider',
                      bgcolor: isSelected ? 'rgba(108,99,255,0.08)' : 'transparent',
                      transition: 'all 0.2s',
                      '&:hover': {
                        borderColor: 'primary.main',
                        bgcolor: 'rgba(108,99,255,0.04)',
                        boxShadow: '0 2px 10px rgba(0,0,0,0.08)',
                      },
                      '&:hover .agent-del': { opacity: 1 },
                    }}
                  >
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                      <Box
                        sx={{
                          width: 32,
                          height: 32,
                          borderRadius: 1.5,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          background: GRADIENT,
                          color: '#fff',
                          flexShrink: 0,
                          boxShadow: '0 2px 6px rgba(108,99,255,0.3)',
                        }}
                      >
                        <RobotIcon size={16} weight="bold" />
                      </Box>
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography variant="subtitle2" sx={{ fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {agent.name}
                        </Typography>
                        <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: 10.5 }}>
                          {model?.name || t('agent.no_model')}
                          {modelEndpoint ? ` · ${modelEndpoint.name}` : ''}
                        </Typography>
                      </Box>
                      <IconButton
                        className="agent-del"
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
                          opacity: 0.3,
                          transition: 'opacity .15s',
                          '&:hover': { opacity: 1, color: 'error.main' },
                        }}
                      >
                        <TrashIcon size={15} />
                      </IconButton>
                    </Box>
                    {agent.description && (
                      <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 0.8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11 }}>
                        {agent.description}
                      </Typography>
                    )}
                    {ALL_AGENT_TOOLS.every((t) => agent.toolIds.includes(t)) ? (
                      <Chip label={t('agent.all_tools')} size="small" sx={{ height: 18, fontSize: 10 }} />
                    ) : (
                      <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                        {agent.toolIds.slice(0, 3).map((tid) => (
                          <Chip
                            key={tid}
                            label={getToolLabel(tid)}
                            size="small"
                            sx={{ height: 18, fontSize: 10 }}
                          />
                        ))}
                        {agent.toolIds.length > 3 && (
                          <Chip
                            label={`+${agent.toolIds.length - 3}`}
                            size="small"
                            sx={{ height: 18, fontSize: 10 }}
                          />
                        )}
                      </Box>
                    )}
                  </Paper>
                );
              })
            )}
          </Box>
        </Box>

        {/* Right: context-aware empty state */}
        <Box sx={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', p: 2 }}>
          {agents.length === 0 ? (
            <Paper
              variant="outlined"
              sx={{
                maxWidth: 600,
                width: '100%',
                borderRadius: 3,
                overflow: 'hidden',
                borderColor: 'divider',
                bgcolor: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.015)',
              }}
            >
              <Box sx={{ height: 4, background: GRADIENT }} />
              <Box sx={{ p: { xs: 3, sm: 4 }, textAlign: 'center' }}>
                <Box sx={{ width: 72, height: 72, borderRadius: '50%', background: GRADIENT, display: 'flex', alignItems: 'center', justifyContent: 'center', mx: 'auto', mb: 2, boxShadow: '0 6px 20px rgba(108,99,255,0.35)' }}>
                  <RobotIcon size={36} weight="bold" color="#fff" />
                </Box>
                <Typography variant="h6" sx={{ fontWeight: 700, fontSize: 20 }}>
                  {t('agent.guide_title')}
                </Typography>
                <Typography variant="body2" sx={{ color: 'text.secondary', mt: 1, maxWidth: 480, mx: 'auto', lineHeight: 1.7 }}>
                  {t('agent.guide_subtitle')}
                </Typography>

                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, 1fr)' }, gap: 2, mt: 3, textAlign: 'left' }}>
                  {[
                    { icon: <IdentificationCardIcon size={20} color={BRAND} />, title: t('agent.guide_step1_title'), desc: t('agent.guide_step1_desc') },
                    { icon: <WrenchIcon size={20} color={BRAND} />, title: t('agent.guide_step2_title'), desc: t('agent.guide_step2_desc') },
                    { icon: <TextAlignLeftIcon size={20} color={BRAND} />, title: t('agent.guide_step3_title'), desc: t('agent.guide_step3_desc') },
                  ].map((step, i) => (
                    <Box key={i} sx={{ p: 2, borderRadius: 2, border: '1px solid', borderColor: 'divider', bgcolor: 'background.paper' }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.8 }}>
                        <Box sx={{ width: 28, height: 28, borderRadius: '50%', background: 'rgba(108,99,255,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          {step.icon}
                        </Box>
                        <Typography variant="subtitle2" sx={{ fontWeight: 600, fontSize: 13 }}>
                          {step.title}
                        </Typography>
                      </Box>
                      <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: 11, lineHeight: 1.5 }}>
                        {step.desc}
                      </Typography>
                    </Box>
                  ))}
                </Box>

                <Button
                  variant="contained"
                  startIcon={<PlusIcon size={18} weight="bold" />}
                  onClick={handleNew}
                  sx={{ mt: 3, textTransform: 'none', background: GRADIENT, fontSize: 14, px: 3, py: 1, '&:hover': { boxShadow: '0 4px 14px rgba(108,99,255,0.4)' } }}
                >
                  {t('agent.new_agent')}
                </Button>
              </Box>
            </Paper>
          ) : (
            <Paper
              variant="outlined"
              sx={{
                maxWidth: 420,
                width: '100%',
                borderRadius: 3,
                p: { xs: 3, sm: 4 },
                textAlign: 'center',
                borderColor: 'divider',
                bgcolor: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.015)',
              }}
            >
              <Box sx={{ width: 64, height: 64, borderRadius: '50%', background: GRADIENT, display: 'flex', alignItems: 'center', justifyContent: 'center', mx: 'auto', mb: 2, boxShadow: '0 6px 20px rgba(108,99,255,0.3)' }}>
                <RobotIcon size={32} weight="bold" color="#fff" />
              </Box>
              <Typography variant="h6" sx={{ fontWeight: 700, fontSize: 18 }}>
                {t('agent.empty_hint_title')}
              </Typography>
              <Typography variant="body2" sx={{ color: 'text.secondary', mt: 1, lineHeight: 1.7 }}>
                {t('agent.empty_hint_desc')}
              </Typography>
            </Paper>
          )}
        </Box>
      </Box>

      {/* Editor Dialog */}
      <Dialog
        open={!!editing}
        onClose={handleCancel}
        maxWidth="md"
        fullWidth
        scroll="paper"
        slotProps={{
          paper: {
            sx: {
              borderRadius: 3,
              overflow: 'hidden',
              backgroundImage: 'none',
              maxHeight: { xs: '92vh', md: '88vh' },
            },
          },
        }}
      >
        <DialogTitle sx={{ p: 0, position: 'relative' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 3, pt: 2.5, pb: 2 }}>
            <Box
              sx={{
                width: 40,
                height: 40,
                borderRadius: 2,
                background: GRADIENT,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 4px 12px rgba(108,99,255,0.35)',
                flexShrink: 0,
              }}
            >
              <RobotIcon size={22} weight="bold" color="#fff" />
            </Box>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="h6" sx={{ fontSize: 17, fontWeight: 700, lineHeight: 1.2 }}>
                {editing && agents.find((a) => a.id === editing.id)
                  ? t('agent.edit_agent')
                  : t('agent.new_agent')}
              </Typography>
              {editing && agents.find((a) => a.id === editing.id) && editing.name && (
                <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 0.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {editing.name}
                </Typography>
              )}
            </Box>
            <IconButton size="small" onClick={handleCancel} sx={{ color: 'text.secondary' }}>
              <XIcon size={18} />
            </IconButton>
          </Box>
          <Box sx={{ height: 3, background: GRADIENT }} />
        </DialogTitle>

        <DialogContent sx={{ p: 3 }}>
          {/* 基本信息 */}
          {renderSection(
            <IdentificationCardIcon size={16} color={BRAND} />,
            t('agent.basic_info'),
            t('agent.basic_info_desc'),
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
              <OutlinedField
                label={t('agent.name_label')}
                required
                htmlFor="agent-name-input"
                error={nameTouched && !editing?.name.trim()}
                helperText={
                  nameTouched && !editing?.name.trim()
                    ? t('agent.name_required')
                    : ' '
                }
              >
                <input
                  id="agent-name-input"
                  ref={nameInputRef}
                  value={editing?.name ?? ''}
                  onChange={(e) => setEditing({ ...editing!, name: e.target.value })}
                  onBlur={() => setNameTouched(true)}
                  placeholder={t('agent.name_placeholder')}
                  style={fieldControlStyle}
                />
              </OutlinedField>
              <OutlinedField
                label={t('agent.model_label')}
                required
                error={modelTouched && !editing?.modelId}
                helperText={
                  modelTouched && !editing?.modelId
                    ? t('agent.model_required')
                    : ' '
                }
              >
                <Select
                  value={editing?.modelId || ''}
                  displayEmpty
                  variant="standard"
                  disableUnderline
                  onChange={(e) => {
                    setEditing({ ...editing!, modelId: e.target.value || null });
                    setModelTouched(true);
                  }}
                  onOpen={() => setModelTouched(true)}
                  sx={selectSx}
                >
                  <MenuItem value="" disabled>
                    {t('agent.select_model')}
                  </MenuItem>
                  {endpoints.flatMap((ep) => {
                    const epModels = enabledModels.filter((m) => m.endpointId === ep.id);
                    if (epModels.length === 0) return [];
                    return [
                      <MenuItem
                        key={`ep-${ep.id}`}
                        disabled
                        sx={{
                          opacity: 1,
                          fontSize: 11,
                          fontWeight: 700,
                          color: 'text.secondary',
                          py: 0.6,
                          borderTop: '1px solid',
                          borderColor: 'divider',
                          mt: 0.5,
                          cursor: 'default',
                        }}
                      >
                        {ep.name}
                        {ep.baseUrl ? ` · ${ep.baseUrl.replace(/^https?:\/\//, '')}` : ''}
                      </MenuItem>,
                      ...epModels.map((model) => (
                        <MenuItem
                          key={model.id}
                          value={model.id}
                          title={`${ep.name}${ep.baseUrl ? ` · ${ep.baseUrl}` : ''}`}
                          sx={{ fontSize: 13 }}
                        >
                          {model.name} ({model.refKey})
                        </MenuItem>
                      )),
                    ];
                  })}
                </Select>
              </OutlinedField>
              <OutlinedField label={t('agent.description_label')}>
                <textarea
                  value={editing?.description ?? ''}
                  onChange={(e) => setEditing({ ...editing!, description: e.target.value })}
                  placeholder={t('agent.description_placeholder')}
                  rows={4}
                  style={{ ...fieldControlStyle, resize: 'vertical', minHeight: 92, lineHeight: 1.5 }}
                />
              </OutlinedField>
            </Box>,
          )}

          {/* 模型与执行 */}
          {renderSection(
            <CpuIcon size={16} color={BRAND} />,
            t('agent.model_config'),
            undefined,
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
              <Box sx={{ flex: { xs: '1 1 100%', sm: '1 1 calc(50% - 8px)' } }}>
                <OutlinedField label={t('agent.trigger_type_label')}>
                  <Select
                    value={editing?.triggerType ?? 'manual'}
                    variant="standard"
                    disableUnderline
                    onChange={(e) => setEditing({ ...editing!, triggerType: e.target.value })}
                    sx={selectSx}
                  >
                    {triggerTypes.map((tt) => (
                      <MenuItem key={tt.value} value={tt.value}>
                        {tt.label}
                      </MenuItem>
                    ))}
                  </Select>
                </OutlinedField>
              </Box>
              <Box sx={{ flex: { xs: '1 1 100%', sm: '1 1 calc(50% - 8px)' }, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1.5 }}>
                <Typography variant="body2" sx={{ color: 'text.primary', fontSize: 13 }}>
                  {t('agent.auto_confirm_label')}
                </Typography>
                <Switch
                  checked={!!editing?.autoConfirm}
                  onChange={(e) => setEditing({ ...editing!, autoConfirm: e.target.checked })}
                  size="small"
                  sx={{
                    '& .MuiSwitch-switchBase.Mui-checked': { color: BRAND },
                    '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': { backgroundColor: BRAND },
                  }}
                />
              </Box>
              <Box sx={{ flex: { xs: '1 1 100%', sm: '1 1 calc(50% - 8px)' } }}>
                <OutlinedField label={t('agent.permission_mode')}>
                  <Select
                    value={editing?.permissionMode ?? 'confirm'}
                    variant="standard"
                    disableUnderline
                    onChange={(e) => setEditing({ ...editing!, permissionMode: e.target.value })}
                    sx={selectSx}
                  >
                    <MenuItem value="confirm">{t('agent.permission_confirm')}</MenuItem>
                    <MenuItem value="auto">{t('agent.permission_auto')}</MenuItem>
                  </Select>
                </OutlinedField>
              </Box>
              <Box sx={{ flex: { xs: '1 1 100%', sm: '1 1 calc(50% - 8px)' } }}>
                <OutlinedField label={t('agent.fallback_model')}>
                  <Select
                    value={editing?.fallbackModelId || ''}
                    displayEmpty
                    variant="standard"
                    disableUnderline
                    onChange={(e) => setEditing({ ...editing!, fallbackModelId: e.target.value || null })}
                    sx={selectSx}
                  >
                    <MenuItem value="">
                      <em>{t('agent.none')}</em>
                    </MenuItem>
                    {endpoints.flatMap((ep) => {
                      const epModels = models.filter((m) => m.endpointId === ep.id && m.id !== editing?.modelId);
                      if (epModels.length === 0) return [];
                      return [
                        <MenuItem
                          key={`fb-ep-${ep.id}`}
                          disabled
                          sx={{
                            opacity: 1,
                            fontSize: 11,
                            fontWeight: 700,
                            color: 'text.secondary',
                            py: 0.6,
                            borderTop: '1px solid',
                            borderColor: 'divider',
                            mt: 0.5,
                            cursor: 'default',
                          }}
                        >
                          {ep.name}
                          {ep.baseUrl ? ` · ${ep.baseUrl.replace(/^https?:\/\//, '')}` : ''}
                        </MenuItem>,
                        ...epModels.map((m) => (
                          <MenuItem key={m.id} value={m.id} sx={{ fontSize: 13 }}>
                            {m.name || m.refKey}
                          </MenuItem>
                        )),
                      ];
                    })}
                  </Select>
                </OutlinedField>
              </Box>
              <Box sx={{ flex: '1 1 100%' }}>
                <OutlinedField
                  label={t('agent.workspace_dir')}
                  helperText={t('agent.workspace_dir_helper')}
                >
                  <Box sx={{ display: 'flex', alignItems: 'center' }}>
                    <input
                      value={editing?.workspaceDir ?? ''}
                      onChange={(e) => setEditing({ ...editing!, workspaceDir: e.target.value })}
                      placeholder={t('agent.workspace_dir_placeholder')}
                      style={{ ...fieldControlStyle, flex: 1 }}
                    />
                    <Tooltip title={t('agent.select_workspace_dir')}>
                      <IconButton
                        size="small"
                        sx={{ mr: 0.5 }}
                        onClick={async () => {
                          try {
                            const selected = await open({
                              directory: true,
                              title: t('agent.select_workspace_dir'),
                            });
                            if (selected && typeof selected === 'string') {
                              setEditing({ ...editing!, workspaceDir: selected });
                            }
                          } catch (err) { console.error('AgentManager: operation failed', err); }
                        }}
                      >
                        <FolderOpenIcon size={18} />
                      </IconButton>
                    </Tooltip>
                  </Box>
                </OutlinedField>
              </Box>
              <Box sx={{ flex: { xs: '1 1 100%', sm: '1 1 calc(50% - 8px)' } }}>
                {renderSliderField(
                  t('agent.temperature_label'),
                  editing?.temperature ?? 0.7,
                  0,
                  2,
                  0.1,
                  (v) => setEditing({ ...editing!, temperature: v }),
                )}
              </Box>
              <Box sx={{ flex: { xs: '1 1 100%', sm: '1 1 calc(50% - 8px)' } }}>
                {renderSliderField(
                  t('agent.max_iterations_label'),
                  editing?.maxIterations ?? 10,
                  1,
                  50,
                  1,
                  (v) => setEditing({ ...editing!, maxIterations: v }),
                )}
              </Box>
            </Box>,
          )}

          {/* 系统提示词 */}
          {renderSection(
            <TextAlignLeftIcon size={16} color={BRAND} />,
            t('agent.system_prompt_label'),
            undefined,
            <OutlinedField label={t('agent.system_prompt_label')}>
              <Box sx={{ position: 'relative' }}>
                <textarea
                  value={editing?.systemPrompt ?? ''}
                  onChange={(e) => setEditing({ ...editing!, systemPrompt: e.target.value })}
                  placeholder={t('agent.system_prompt_placeholder')}
                  rows={6}
                  style={{ ...fieldControlStyle, fontFamily: 'monospace', fontSize: 12.5, lineHeight: 1.65, resize: 'vertical', minHeight: 132 }}
                />
                <Typography
                  variant="caption"
                  sx={{
                    position: 'absolute',
                    right: 8,
                    bottom: 6,
                    fontSize: 10,
                    color: 'text.disabled',
                    bgcolor: 'background.paper',
                    px: 0.5,
                    pointerEvents: 'none',
                  }}
                >
                  {(editing?.systemPrompt ?? '').length} chars
                </Typography>
              </Box>
            </OutlinedField>,
          )}
        </DialogContent>

        <Divider />
        <DialogActions sx={{ px: 3, py: 2, gap: 1.5 }}>
          <Button
            onClick={handleCancel}
            sx={{
              textTransform: 'none',
              color: 'text.secondary',
              border: '1px solid',
              borderColor: 'divider',
              fontSize: 13,
              px: 2.5,
              py: 0.8,
              '&:hover': { borderColor: 'text.secondary', bgcolor: 'action.hover' },
            }}
          >
            {t('agent.cancel')}
          </Button>
          <Button
            variant="contained"
            startIcon={<FloppyDiskIcon size={16} weight="bold" />}
            onClick={handleSave}
            disabled={!editing || !editing.name.trim() || !editing.modelId}
            sx={{
              background: GRADIENT,
              textTransform: 'none',
              fontSize: 13,
              px: 3,
              py: 1,
              boxShadow: '0 4px 14px rgba(108,99,255,0.35)',
              '&:hover': { boxShadow: '0 6px 18px rgba(108,99,255,0.5)', background: GRADIENT },
              '&:disabled': { opacity: 0.5, boxShadow: 'none' },
            }}
          >
            {t('agent.save')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={!!deleteConfirm}
        onClose={() => setDeleteConfirm(null)}
        slotProps={{
          paper: {
            sx: { borderRadius: 3, overflow: 'hidden' },
          },
        }}
      >
        <Box sx={{ height: 3, background: 'linear-gradient(135deg, #FF7B72 0%, #FFB74D 100%)' }} />
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, pt: 2.5 }}>
          <Box sx={{ width: 32, height: 32, borderRadius: 1.5, bgcolor: 'rgba(255,123,114,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <TrashIcon size={18} weight="bold" color="#FF7B72" />
          </Box>
          <Typography variant="h6" sx={{ fontSize: 16, fontWeight: 700 }}>{t('agent.delete_confirm_title')}</Typography>
        </DialogTitle>
        <DialogContent sx={{ pt: 1 }}>
          <Typography variant="body2">
            {t('agent.delete_confirm_message_with_info', {
              name: deleteConfirm?.name || '',
              count: deleteConfirm?.convCount || 0,
              convCount: deleteConfirm?.convCount || 0,
              defaultValue: `Are you sure you want to delete agent "${deleteConfirm?.name || ''}"?${deleteConfirm?.convCount ? ` This will also delete ${deleteConfirm.convCount} conversation(s) and all associated messages.` : ''}`,
            })}
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2, gap: 1.5 }}>
          <Button
            onClick={() => setDeleteConfirm(null)}
            sx={{
              textTransform: 'none',
              color: 'text.secondary',
              border: '1px solid',
              borderColor: 'divider',
              fontSize: 13,
              '&:hover': { borderColor: 'text.secondary' },
            }}
          >
            {t('agent.cancel')}
          </Button>
          <Button
            color="error"
            variant="contained"
            onClick={() => deleteConfirm && handleDelete(deleteConfirm.id)}
            sx={{ textTransform: 'none', fontSize: 13, px: 2.5 }}
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