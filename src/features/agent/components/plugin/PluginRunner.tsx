import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Box,
  Typography,
  Paper,
  CircularProgress,
  Alert,
  Tabs,
  Tab,
  Divider,
  Chip,
  IconButton,
  Tooltip,
  useTheme,
  Button,
  Stepper,
  Step,
  StepLabel,
} from '@mui/material';
import {
  DownloadSimpleIcon,
  ClockCounterClockwiseIcon,
  CopyIcon,
  FolderOpenIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  PlayIcon,
  ArrowClockwiseIcon,
} from '@phosphor-icons/react';
import {
  runPluginTool,
  getPluginToolUiSchema,
  listPluginUsageLogs,
} from '../../../../core/services/plugin.service';
import type { PluginManifest, PluginTool, UiSchema, UsageLogEntry, InteractionStep, ResultAction } from '../../../../proto/plugin';
import { UiSchemaRenderer } from './UiSchemaRenderer';
import { PluginUsageInsights } from './PluginUsageInsights';
import { useNotify } from '../../../../core/notification';
import { ResultViewRenderer } from './ResultViewRenderer';
import { useTranslation } from 'react-i18next';

interface PluginRunnerProps {
  plugin: PluginManifest;
  onRefine?: (pluginId: string, pluginName: string, suggestion: string) => void;
  onToolResult?: (toolName: string, result: { success: boolean; output: string; durationMs: number }, params: Record<string, unknown>) => void;
  workspaceDir?: string;
}

interface ExecutionHistoryEntry {
  id: string;
  toolName: string;
  success: boolean;
  durationMs: number;
  paramsSummary: string;
  outputSummary: string | null;
  errorMessage: string | null;
  source: string;
  createdAt: number;
}

interface ToolTab {
  tool: PluginTool;
  uiSchema: UiSchema | null;
  loading: boolean;
  error: string | null;
  result: {
    success: boolean;
    output: string;
    scriptType: string;
    durationMs: number;
  } | null;
  executing: boolean;
  values: Record<string, unknown>;
  history: ExecutionHistoryEntry[];
  wizardStep: number;
}

const PARAM_MEMORY_PREFIX = 'biosphere_plugin_params_';

function saveParamMemory(pluginId: string, toolName: string, values: Record<string, unknown>) {
  try {
    const key = `${PARAM_MEMORY_PREFIX}${pluginId}_${toolName}`;
    localStorage.setItem(key, JSON.stringify(values));
  } catch { console.error('PluginRunner: saveParamMemory failed'); }
}

function loadParamMemory(pluginId: string, toolName: string): Record<string, unknown> | null {
  try {
    const key = `${PARAM_MEMORY_PREFIX}${pluginId}_${toolName}`;
    const stored = localStorage.getItem(key);
    if (stored) return JSON.parse(stored);
  } catch { console.error('PluginRunner: loadParamMemory failed'); }
  return null;
}

function getInteractionSteps(uiSchema: UiSchema | null): InteractionStep[] {
  if (uiSchema?.interaction?.steps && uiSchema.interaction.steps.length > 0) {
    return uiSchema.interaction.steps;
  }
  return [];
}

function getResultActions(uiSchema: UiSchema | null): ResultAction[] {
  if (uiSchema?.interaction?.resultActions && uiSchema.interaction.resultActions.length > 0) {
    return uiSchema.interaction.resultActions;
  }
  return [];
}

function getFieldsForStep(uiSchema: UiSchema | null, step: InteractionStep): UiSchema['fields'] {
  if (!uiSchema) return [];
  if (step.fields.length === 0) return uiSchema.fields;
  return uiSchema.fields.filter((f) => step.fields.includes(f.name));
}

export const PluginRunner: React.FC<PluginRunnerProps> = ({ plugin, onRefine, onToolResult, workspaceDir }) => {
  const { t } = useTranslation('agent');
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const [activeTab, setActiveTab] = useState(0);
  const [toolTabs, setToolTabs] = useState<ToolTab[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const notify = useNotify().notify;

  useEffect(() => {
    const tabs: ToolTab[] = plugin.tools.map((tool) => {
      const saved = loadParamMemory(plugin.id, tool.name);
      return {
        tool,
        uiSchema: null,
        loading: true,
        error: null,
        result: null,
        executing: false,
        values: saved || buildDefaultValues(tool),
        history: [],
        wizardStep: 0,
      };
    });
    setToolTabs(tabs);

    tabs.forEach((tab, idx) => {
      getPluginToolUiSchema(plugin.id, tab.tool.name)
        .then((schema) => {
          setToolTabs((prev) => {
            const next = [...prev];
            next[idx] = { ...next[idx], uiSchema: schema as UiSchema | null, loading: false };
            return next;
          });
        })
        .catch((err) => {
          setToolTabs((prev) => {
            const next = [...prev];
            next[idx] = { ...next[idx], error: String(err), loading: false };
            return next;
          });
        });
    });

    loadExecutionHistory(plugin.id).then((history) => {
      setToolTabs((prev) => {
        const next = prev.map((tab) => ({
          ...tab,
          history: history.filter((h) => h.toolName === tab.tool.name),
        }));
        return next;
      });
    });
  }, [plugin.id]);

  const handleExecute = useCallback(async (tabIdx: number) => {
    let toolName = '';
    let values: Record<string, unknown> = {};
    let alreadyExecuting = false;

    setToolTabs((prev) => {
      const tab = prev[tabIdx];
      if (!tab || tab.executing) {
        alreadyExecuting = true;
        return prev;
      }
      toolName = tab.tool.name;
      values = { ...tab.values };
      const next = [...prev];
      next[tabIdx] = { ...next[tabIdx], executing: true, result: null, error: null };
      return next;
    });

    if (alreadyExecuting || !toolName) return;

    saveParamMemory(plugin.id, toolName, values);

    const EXECUTION_TIMEOUT_MS = 120_000;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error(t('plugin_usage.timeout_error', { seconds: EXECUTION_TIMEOUT_MS / 1000 })));
      }, EXECUTION_TIMEOUT_MS);
    });

    try {
      const result = await Promise.race([
        runPluginTool(plugin.id, toolName, values, workspaceDir),
        timeoutPromise,
      ]);

      if (timeoutId) clearTimeout(timeoutId);

      setToolTabs((prev) => {
        const next = [...prev];
        next[tabIdx] = { ...next[tabIdx], executing: false, result };
        return next;
      });

      if (onToolResult) {
        onToolResult(toolName, { success: result.success, output: result.output, durationMs: result.durationMs }, values);
      }

      loadExecutionHistory(plugin.id).then((history) => {
        setToolTabs((prev) => {
          const next = prev.map((tab) => ({
            ...tab,
            history: history.filter((h) => h.toolName === tab.tool.name),
          }));
          return next;
        });
      });
    } catch (err) {
      if (timeoutId) clearTimeout(timeoutId);
      setToolTabs((prev) => {
        const next = [...prev];
        next[tabIdx] = { ...next[tabIdx], executing: false, error: String(err) };
        return next;
      });
    }
  }, [plugin.id, workspaceDir]);

  const handleValuesChange = useCallback((tabIdx: number, values: Record<string, unknown>) => {
    setToolTabs((prev) => {
      const next = [...prev];
      next[tabIdx] = { ...next[tabIdx], values };
      return next;
    });
  }, []);

  const handleCopyResult = useCallback((output: string) => {
    navigator.clipboard.writeText(output).catch((e) => notify(String(e)));
  }, []);

  const handleExportResult = useCallback((output: string, toolName: string) => {
    const blob = new Blob([output], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${plugin.name}_${toolName}_result_${Date.now()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [plugin.name]);

  const handleResultAction = useCallback((action: ResultAction, tabIdx: number) => {
    const tab = toolTabs[tabIdx];
    if (!tab) return;

    switch (action.actionType) {
      case 're_run':
        handleExecute(tabIdx);
        break;
      case 'copy_result':
        if (tab.result) {
          handleCopyResult(tab.result.output);
        }
        break;
      case 'open_file':
        break;
      case 'export':
        if (tab.result) {
          handleExportResult(tab.result.output, tab.tool.name);
        }
        break;
    }
  }, [toolTabs, handleExecute, handleCopyResult, handleExportResult]);

  if (toolTabs.length === 0) {
    return (
      <Box sx={{ p: 2, textAlign: 'center' }}>
        <Typography color="text.secondary">{t('plugin_usage.no_tools')}</Typography>
      </Box>
    );
  }

  const currentTab = toolTabs[activeTab];
  const interactionSteps = currentTab ? getInteractionSteps(currentTab.uiSchema) : [];
  const resultActions = currentTab ? getResultActions(currentTab.uiSchema) : [];
  const isWizardMode = interactionSteps.length > 1;

  const resultBg = isDark ? 'rgba(30,35,42,0.9)' : 'rgba(245,247,250,0.95)';
  const resultBorder = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ px: 2, pt: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
        <Box sx={{ flex: 1 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
            {plugin.name}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {plugin.description}
          </Typography>
        </Box>
        <Tooltip title={showHistory ? t('plugin_usage.close') : t('plugin_usage.title')} arrow>
          <IconButton
            size="small"
            onClick={() => setShowHistory(!showHistory)}
            sx={{
              color: showHistory ? (isDark ? '#4FC3F7' : '#1976d2') : 'text.secondary',
              bgcolor: showHistory ? (isDark ? 'rgba(79,195,247,0.1)' : 'rgba(25,118,210,0.08)') : 'transparent',
            }}
          >
            <ClockCounterClockwiseIcon size={16} />
          </IconButton>
        </Tooltip>
      </Box>

      {plugin.tools.length > 1 && (
        <Tabs
          value={activeTab}
          onChange={(_, v) => setActiveTab(v)}
          variant="scrollable"
          scrollButtons="auto"
          sx={{ minHeight: 36, borderBottom: 1, borderColor: 'divider' }}
        >
          {plugin.tools.map((tool) => (
            <Tab key={tool.name} label={tool.name} sx={{ minHeight: 36, py: 0 }} />
          ))}
        </Tabs>
      )}

      <Box sx={{ flex: 1, overflow: 'auto', p: 2 }}>
        {currentTab && (
          <>
            {currentTab.loading && (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                <CircularProgress size={24} />
              </Box>
            )}

            {currentTab.error && (
              <Alert severity="error" sx={{ mb: 2 }}>
                {currentTab.error}
              </Alert>
            )}

            {!currentTab.loading && currentTab.uiSchema && (
              isWizardMode ? (
                <WizardForm
                  uiSchema={currentTab.uiSchema}
                  steps={interactionSteps}
                  currentStep={currentTab.wizardStep}
                  values={currentTab.values}
                  onChange={(v) => handleValuesChange(activeTab, v)}
                  onStepChange={(step) => {
                    setToolTabs((prev) => {
                      const next = [...prev];
                      next[activeTab] = { ...next[activeTab], wizardStep: step };
                      return next;
                    });
                  }}
                  onSubmit={() => handleExecute(activeTab)}
                  loading={currentTab.executing}
                  isDark={isDark}
                  t={t}
                />
              ) : (
                <UiSchemaRenderer
                  uiSchema={currentTab.uiSchema}
                  values={currentTab.values}
                  onChange={(v) => handleValuesChange(activeTab, v)}
                  onSubmit={() => handleExecute(activeTab)}
                  loading={currentTab.executing}
                />
              )
            )}

            {!currentTab.loading && !currentTab.uiSchema && (
              <FallbackForm
                tool={currentTab.tool}
                values={currentTab.values}
                onChange={(v) => handleValuesChange(activeTab, v)}
                onSubmit={() => handleExecute(activeTab)}
                loading={currentTab.executing}
                t={t}
              />
            )}

            {currentTab.result && (
              <Paper
                elevation={0}
                sx={{
                  mt: 2,
                  p: 2,
                  bgcolor: resultBg,
                  border: `1px solid ${resultBorder}`,
                  borderRadius: 2,
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                  <Chip
                    label={currentTab.result.success ? t('plugin_usage.success_label') : t('plugin_usage.fail_label')}
                    color={currentTab.result.success ? 'success' : 'error'}
                    size="small"
                    sx={{ fontWeight: 600, fontSize: 12 }}
                  />
                  <Chip
                    label={currentTab.result.scriptType}
                    variant="outlined"
                    size="small"
                    sx={{ fontSize: 11, color: 'text.secondary', borderColor: isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.15)' }}
                  />
                  <Typography variant="caption" color="text.secondary" sx={{ fontSize: 11 }}>
                    {currentTab.result.durationMs}ms
                  </Typography>
                  <Box sx={{ flex: 1 }} />
                  <Tooltip title={t('plugin_usage.output_prefix').trim() || 'Copy Result'} arrow>
                    <IconButton size="small" onClick={() => handleCopyResult(currentTab.result!.output)} sx={{ color: 'text.secondary', p: 0.25 }}>
                      <CopyIcon size={14} />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title={t('plugin_usage.export_logs').trim() || 'Export Result'} arrow>
                    <IconButton size="small" onClick={() => handleExportResult(currentTab.result!.output, currentTab.tool.name)} sx={{ color: 'text.secondary', p: 0.25 }}>
                      <DownloadSimpleIcon size={14} />
                    </IconButton>
                  </Tooltip>
                </Box>
                <Divider sx={{ my: 1, borderColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)' }} />
                <ResultViewRenderer
                  resultView={currentTab.tool.resultView}
                  output={currentTab.result.output}
                  success={currentTab.result.success}
                />
                {resultActions.length > 0 && (
                  <Box sx={{ mt: 1.5, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                    {resultActions.map((action) => (
                      <Button
                        key={action.id}
                        size="small"
                        variant="outlined"
                        startIcon={getActionIcon(action.icon)}
                        onClick={() => handleResultAction(action, activeTab)}
                        sx={{
                          fontSize: 11,
                          textTransform: 'none',
                          borderColor: isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.15)',
                          color: isDark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.6)',
                          '&:hover': {
                            borderColor: isDark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.3)',
                            bgcolor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0.03)',
                          },
                        }}
                      >
                        {action.label}
                      </Button>
                    ))}
                  </Box>
                )}
              </Paper>
            )}

            {showHistory && currentTab.history.length > 0 && (
              <Box sx={{ mt: 2 }}>
                <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <ClockCounterClockwiseIcon size={14} />
                  {t('plugin_usage.title')}
                </Typography>
                {currentTab.history.slice(0, 10).map((entry) => (
                  <Paper
                    key={entry.id}
                    variant="outlined"
                    sx={{
                      p: 1.5,
                      mb: 0.5,
                      borderRadius: 1.5,
                      borderColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
                      bgcolor: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.01)',
                    }}
                  >
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
                      <Chip
                        label={entry.success ? '✓' : '✗'}
                        size="small"
                        color={entry.success ? 'success' : 'error'}
                        sx={{ height: 18, fontSize: 10, minWidth: 24, '& .MuiChip-label': { px: 0.5 } }}
                      />
                      <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: 10 }}>
                        {entry.source === 'user' ? t('plugin_usage.manual_exec') : t('plugin_usage.ai_exec')} · {entry.durationMs}ms
                      </Typography>
                      <Box sx={{ flex: 1 }} />
                      <Typography variant="caption" sx={{ color: 'text.disabled', fontSize: 9 }}>
                        {formatTimestamp(t, entry.createdAt)}
                      </Typography>
                    </Box>
                    {entry.paramsSummary && (
                      <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: 10, display: 'block', mb: 0.25 }} noWrap>
                        {t('plugin_usage.params_prefix')}{entry.paramsSummary}
                      </Typography>
                    )}
                    {entry.outputSummary && (
                      <Typography variant="caption" sx={{ color: isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.5)', fontSize: 10, display: 'block' }} noWrap>
                        {t('plugin_usage.output_prefix')}{entry.outputSummary}
                      </Typography>
                    )}
                    {entry.errorMessage && (
                      <Typography variant="caption" sx={{ color: '#E57373', fontSize: 10, display: 'block' }} noWrap>
                        {t('plugin_usage.error_prefix')}{entry.errorMessage}
                      </Typography>
                    )}
                  </Paper>
                ))}
              </Box>
            )}

            <Divider sx={{ my: 2, borderColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)' }} />
            <PluginUsageInsights plugin={plugin} onRefine={onRefine} isDark={isDark} />
          </>
        )}
      </Box>
    </Box>
  );
};

function getActionIcon(iconName?: string) {
  switch (iconName) {
    case 'folder': return <FolderOpenIcon size={14} />;
    case 'refresh': return <ArrowClockwiseIcon size={14} />;
    case 'copy': return <CopyIcon size={14} />;
    case 'download': return <DownloadSimpleIcon size={14} />;
    default: return undefined;
  }
}

interface WizardFormProps {
  uiSchema: UiSchema;
  steps: InteractionStep[];
  currentStep: number;
  values: Record<string, unknown>;
  onChange: (values: Record<string, unknown>) => void;
  onStepChange: (step: number) => void;
  onSubmit: () => void;
  loading?: boolean;
  isDark: boolean;
  t: (key: string, options?: Record<string, unknown>) => string;
}

const WizardForm: React.FC<WizardFormProps> = ({
  uiSchema, steps, currentStep, values, onChange, onStepChange, onSubmit, loading, isDark, t,
}) => {
  const step = steps[currentStep];
  const isLastStep = currentStep === steps.length - 1;
  const stepFields = step ? getFieldsForStep(uiSchema, step) : uiSchema.fields;

  const stepUiSchema: UiSchema = useMemo(() => ({
    ...uiSchema,
    fields: stepFields,
    submitLabel: isLastStep ? t('plugin_usage.execute') : t('plugin_usage.next_step'),
  }), [uiSchema, stepFields, isLastStep, t]);

  const handleNext = useCallback(() => {
    if (isLastStep) {
      onSubmit();
    } else {
      const nextStep = currentStep + 1;
      onStepChange(nextStep);
      if (steps[currentStep].autoAdvance) {
        // auto_advance handled by UI
      }
    }
  }, [isLastStep, onSubmit, currentStep, onStepChange, steps]);

  const handleBack = useCallback(() => {
    if (currentStep > 0) {
      onStepChange(currentStep - 1);
    }
  }, [currentStep, onStepChange]);

  return (
    <Box>
      <Stepper activeStep={currentStep} sx={{ mb: 2 }}>
        {steps.map((s, idx) => (
          <Step key={s.id} completed={idx < currentStep}>
            <StepLabel
              sx={{
                '& .MuiStepLabel-label': {
                  fontSize: 11,
                  color: idx === currentStep
                    ? (isDark ? '#4FC3F7' : '#1976d2')
                    : 'text.secondary',
                },
              }}
            >
              {s.title}
            </StepLabel>
          </Step>
        ))}
      </Stepper>

      {step?.description && (
        <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>
          {step.description}
        </Typography>
      )}

      <UiSchemaRenderer
        uiSchema={stepUiSchema}
        values={values}
        onChange={onChange}
        onSubmit={handleNext}
        loading={loading}
      />

      <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
        {currentStep > 0 && (
          <Button
            size="small"
            onClick={handleBack}
            startIcon={<ArrowLeftIcon size={14} />}
            sx={{
              textTransform: 'none',
              color: isDark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)',
            }}
          >
            {t('plugin_usage.prev_step')}
          </Button>
        )}
        {!isLastStep && (
          <Button
            size="small"
            variant="contained"
            onClick={handleNext}
            endIcon={<ArrowRightIcon size={14} />}
            sx={{
              textTransform: 'none',
              bgcolor: isDark ? '#4FC3F7' : '#1976d2',
              '&:hover': { bgcolor: isDark ? '#29B6F6' : '#1565C0' },
            }}
          >
            {t('plugin_usage.next_step')}
          </Button>
        )}
        {isLastStep && !loading && (
          <Button
            size="small"
            variant="contained"
            onClick={onSubmit}
            startIcon={<PlayIcon size={14} />}
            sx={{
              textTransform: 'none',
              bgcolor: isDark ? '#4FC3F7' : '#1976d2',
              '&:hover': { bgcolor: isDark ? '#29B6F6' : '#1565C0' },
            }}
          >
            {t('plugin_usage.execute')}
          </Button>
        )}
      </Box>
    </Box>
  );
};

async function loadExecutionHistory(pluginId: string): Promise<ExecutionHistoryEntry[]> {
  try {
    const logs: UsageLogEntry[] = await listPluginUsageLogs(pluginId, 20);
    return logs.map((log) => ({
      id: log.id,
      toolName: log.toolName,
      success: log.success,
      durationMs: log.durationMs,
      paramsSummary: log.paramsSummary,
      outputSummary: log.outputSummary ?? null,
      errorMessage: log.errorMessage ?? null,
      source: log.source,
      createdAt: log.createdAt,
    }));
  } catch {
    return [];
  }
}

function formatTimestamp(t: (key: string, options?: Record<string, unknown>) => string, ms: number): string {
  const d = new Date(ms);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return t('plugin_usage.just_now');
  if (diffMin < 60) return t('plugin_usage.minutes_ago', { count: diffMin });
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return t('plugin_usage.hours_ago', { count: diffHour });
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 7) return t('plugin_usage.days_ago', { count: diffDay });
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function buildDefaultValues(tool: PluginTool): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const param of tool.parameters) {
    if (param.defaultValue !== undefined && param.defaultValue !== null) {
      values[param.name] = param.defaultValue;
    }
  }
  return values;
}

interface FallbackFormProps {
  tool: PluginTool;
  values: Record<string, unknown>;
  onChange: (values: Record<string, unknown>) => void;
  onSubmit: () => void;
  loading?: boolean;
  t?: (key: string, options?: Record<string, unknown>) => string;
}

const FallbackForm: React.FC<FallbackFormProps> = ({ tool, values, onChange, onSubmit, loading, t }) => {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';

  return (
    <Box>
      <Typography variant="subtitle2" sx={{ mb: 1, color: 'text.primary' }}>{tool.description}</Typography>
      {tool.parameters.map((param) => (
        <Box key={param.name} sx={{ mb: 1.5 }}>
          <Typography variant="caption" sx={{ color: 'text.secondary', mb: 0.5, display: 'block' }}>
            {param.uiLabel || param.name}
            {param.required && <span style={{ color: '#f44336', marginLeft: 2 }}>*</span>}
          </Typography>
          <Box
            component="input"
            value={(values[param.name] as string) ?? ''}
            onChange={(e) => onChange({ ...values, [param.name]: e.target.value })}
            placeholder={param.uiPlaceholder || param.description}
            sx={{
              width: '100%',
              p: 1,
              border: '1px solid',
              borderColor: isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.2)',
              borderRadius: 1,
              fontSize: '0.875rem',
              outline: 'none',
              bgcolor: isDark ? 'rgba(255,255,255,0.05)' : 'transparent',
              color: 'text.primary',
              '&:focus': { borderColor: 'primary.main' },
              '&::placeholder': { color: isDark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0.38)' },
            }}
          />
        </Box>
      ))}
      <button
        onClick={onSubmit}
        disabled={loading}
        style={{
          width: '100%',
          padding: '10px',
          background: loading
            ? (isDark ? 'rgba(255,255,255,0.1)' : '#ccc')
            : (isDark ? '#4FC3F7' : '#1976d2'),
          color: loading
            ? (isDark ? 'rgba(255,255,255,0.4)' : '#666')
            : '#fff',
          border: 'none',
          borderRadius: '6px',
          cursor: loading ? 'not-allowed' : 'pointer',
          fontSize: '0.875rem',
          fontWeight: 600,
          transition: 'background 0.2s',
        }}
      >
        {loading ? t?.('plugin_usage.executing') || 'Executing...' : t?.('plugin_usage.execute') || 'Execute'}
      </button>
    </Box>
  );
};

export default PluginRunner;
