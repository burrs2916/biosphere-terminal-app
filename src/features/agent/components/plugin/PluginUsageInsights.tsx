import React, { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Typography,
  Paper,
  CircularProgress,
  Alert,
  Chip,
  Button,
  LinearProgress,
  Stack,
  Collapse,
  IconButton,
  Tooltip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
} from '@mui/material';
import {
  LightningIcon,
  ChartBarIcon,
  ArrowUpIcon,
  WrenchIcon,
  CheckCircleIcon,
  WarningIcon,
  XCircleIcon,
  CaretDownIcon,
  CaretUpIcon,
  TrashIcon,
  ExportIcon,
  EyeIcon,
  XIcon,
} from '@phosphor-icons/react';
import {
  getPluginUsageMetrics,
  getPluginRefineSuggestions,
  getPluginStructuredRefine,
  listPluginUsageLogs,
  clearPluginUsageLogs,
  exportPluginUsageLogs,
} from '../../../../core/services/plugin.service';
import type { ExecutionMetrics, RefineSuggestion, UsageLogEntry, PluginManifest, StructuredRefineResult, FixRecipe, FixErrorType, FixPatchType } from '../../../../proto/plugin';
import { useTranslation } from 'react-i18next';

interface PluginUsageInsightsProps {
  plugin: PluginManifest;
  onRefine?: (pluginId: string, pluginName: string, suggestion: string) => void;
  isDark?: boolean;
}

function getErrorTypeLabel(t: (key: string) => string, errorType: FixErrorType): string {
  const key = `agent.plugin_usage.error_type_${errorType}`;
  const fallback: Record<FixErrorType, string> = {
    MissingDependency: 'Missing Dependency',
    SyntaxError: 'Syntax Error',
    FileNotFound: 'File Not Found',
    PermissionDenied: 'Permission Denied',
    Timeout: 'Timeout',
    NetworkError: 'Network Error',
    RuntimeError: 'Runtime Error',
    OutputPathError: 'Output Path Error',
    UnknownError: 'Unknown Error',
  };
  const result = t(key);
  // If translation returns the key itself (missing), use fallback
  return result === key ? fallback[errorType] : result;
}

function getPatchTypeLabel(t: (key: string) => string, patchType: FixPatchType): string {
  const key = `agent.plugin_usage.patch_type_${patchType}`;
  const fallback: Record<FixPatchType, string> = {
    ScriptReplace: 'Replace Script',
    ScriptPrefix: 'Script Prefix',
    ParameterAdd: 'Add Parameter',
    ParameterModify: 'Modify Parameter',
    ManualReview: 'Needs Manual Review',
  };
  const result = t(key);
  return result === key ? fallback[patchType] : result;
}

function getPatchTypeAutoApply(patchType: FixPatchType): boolean {
  const autoApply: Record<FixPatchType, boolean> = {
    ScriptReplace: true,
    ScriptPrefix: true,
    ParameterAdd: true,
    ParameterModify: true,
    ManualReview: false,
  };
  return autoApply[patchType];
}

function getErrorTypeColor(errorType: FixErrorType): string {
  const colors: Record<FixErrorType, string> = {
    MissingDependency: '#FF9800',
    SyntaxError: '#F44336',
    FileNotFound: '#9C27B0',
    PermissionDenied: '#E91E63',
    Timeout: '#FF5722',
    NetworkError: '#00BCD4',
    RuntimeError: '#FF7043',
    OutputPathError: '#795548',
    UnknownError: '#9E9E9E',
  };
  return colors[errorType];
}

function formatLogContent(text: string): string {
  try {
    const parsed = JSON.parse(text);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return text;
  }
}

export const PluginUsageInsights: React.FC<PluginUsageInsightsProps> = ({
  plugin,
  onRefine,
  isDark = false,
}) => {
  const { t } = useTranslation('agent');
  const [metrics, setMetrics] = useState<ExecutionMetrics | null>(null);
  const [suggestion, setSuggestion] = useState<RefineSuggestion | null>(null);
  const [structuredRefine, setStructuredRefine] = useState<StructuredRefineResult | null>(null);
  const [logs, setLogs] = useState<UsageLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedRecipe, setExpandedRecipe] = useState<string | null>(null);
  const [selectedLog, setSelectedLog] = useState<UsageLogEntry | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [m, s, sr, l] = await Promise.all([
        getPluginUsageMetrics(plugin.id),
        getPluginRefineSuggestions(plugin.id),
        getPluginStructuredRefine(plugin.id).catch(() => null),
        listPluginUsageLogs(plugin.id, 100),
      ]);
      setMetrics(m);
      setSuggestion(s);
      setStructuredRefine(sr);
      setLogs(l);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [plugin.id]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
        <CircularProgress size={24} />
      </Box>
    );
  }

  if (error) {
    return <Alert severity="error">{error}</Alert>;
  }

  if (!metrics || metrics.totalExecutions === 0) {
    return (
      <Box sx={{ textAlign: 'center', py: 3 }}>
        <ChartBarIcon size={32} color={isDark ? '#666' : '#aaa'} />
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          {t('plugin_usage.no_data')}
        </Typography>
        <Typography variant="caption" color="text.disabled">
          {t('plugin_usage.no_data_hint')}
        </Typography>
      </Box>
    );
  }

  const failRate = metrics.totalExecutions > 0
    ? (metrics.failCount / metrics.totalExecutions) * 100
    : 0;
  const successRate = 100 - failRate;

  const getFailRateColor = (rate: number) => {
    if (rate > 50) return '#E57373';
    if (rate > 20) return '#FFB74D';
    return '#81C784';
  };

  const healthLabels: Record<string, string> = {
    'Failed': t('plugin_usage.health_failed'),
    'Degraded': t('plugin_usage.health_degraded'),
    'Healthy': t('plugin_usage.health_healthy'),
  };

  return (
    <Box>
      <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
        {t('plugin_usage.title')}
      </Typography>

      <Paper variant="outlined" sx={{ p: 1.5, mb: 1.5 }}>
        <Stack direction="row" spacing={2} sx={{ mb: 1 }}>
          <Box sx={{ flex: 1 }}>
            <Typography variant="caption" color="text.secondary">{t('plugin_usage.total_executions')}</Typography>
            <Typography variant="h6" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
              {metrics.totalExecutions}
            </Typography>
          </Box>
          <Box sx={{ flex: 1 }}>
            <Typography variant="caption" color="text.secondary">{t('plugin_usage.success_rate')}</Typography>
            <Typography variant="h6" sx={{ fontWeight: 700, lineHeight: 1.2, color: getFailRateColor(failRate) }}>
              {successRate.toFixed(0)}%
            </Typography>
          </Box>
          <Box sx={{ flex: 1 }}>
            <Typography variant="caption" color="text.secondary">{t('plugin_usage.avg_duration')}</Typography>
            <Typography variant="h6" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
              {metrics.avgDurationMs < 1000
                ? `${metrics.avgDurationMs.toFixed(0)}ms`
                : `${(metrics.avgDurationMs / 1000).toFixed(1)}s`}
            </Typography>
          </Box>
        </Stack>

        <Box sx={{ mb: 0.5 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
            <Typography variant="caption" color="text.secondary">{t('plugin_usage.success_fail')}</Typography>
            <Typography variant="caption" color="text.secondary">
              {metrics.successCount} / {metrics.failCount}
            </Typography>
          </Box>
          <LinearProgress
            variant="determinate"
            value={successRate}
            sx={{
              height: 6,
              borderRadius: 3,
              bgcolor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)',
              '& .MuiLinearProgress-bar': {
                bgcolor: getFailRateColor(failRate),
                borderRadius: 3,
              },
            }}
          />
        </Box>
      </Paper>

      {structuredRefine && structuredRefine.recipes.length > 0 && (
        <Paper
          variant="outlined"
          sx={{
            p: 1.5,
            mb: 1.5,
            borderColor: structuredRefine.healthStatus === 'Failed'
              ? '#E57373'
              : structuredRefine.healthStatus === 'Degraded'
                ? '#FFB74D'
                : 'divider',
            bgcolor: structuredRefine.healthStatus === 'Failed'
              ? (isDark ? 'rgba(229,115,115,0.08)' : 'rgba(229,115,115,0.04)')
              : structuredRefine.healthStatus === 'Degraded'
                ? (isDark ? 'rgba(255,183,77,0.08)' : 'rgba(255,183,77,0.04)')
                : 'transparent',
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 1 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              {structuredRefine.healthStatus === 'Failed' ? (
                <XCircleIcon size={16} color="#E57373" />
              ) : structuredRefine.healthStatus === 'Degraded' ? (
                <WarningIcon size={16} color="#FFB74D" />
              ) : (
                <CheckCircleIcon size={16} color="#81C784" />
              )}
              <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                {healthLabels[structuredRefine.healthStatus] || healthLabels.Healthy}
              </Typography>
            </Box>
            <Box sx={{ flex: 1 }} />
            <Chip
              label={`${structuredRefine.recipes.length} ${t('plugin_usage.repair_plans').replace('{{count}}', String(structuredRefine.recipes.length))}`}
              size="small"
              sx={{ height: 20, fontSize: 10 }}
            />
          </Box>

          {structuredRefine.recipes.map((recipe) => (
            <RecipeCard
              key={`${recipe.errorType}_${recipe.toolName}`}
              recipe={recipe}
              expanded={expandedRecipe === `${recipe.errorType}_${recipe.toolName}`}
              onToggle={() => setExpandedRecipe((prev) =>
                prev === `${recipe.errorType}_${recipe.toolName}` ? null : `${recipe.errorType}_${recipe.toolName}`
              )}
              isDark={isDark}
              t={t}
            />
          ))}

          {onRefine && (
            <Button
              size="small"
              variant={structuredRefine.healthStatus === 'Failed' ? 'contained' : 'outlined'}
              color={structuredRefine.healthStatus === 'Failed' ? 'error' : 'primary'}
              startIcon={<LightningIcon size={12} />}
              onClick={() => {
                const autoFixable = structuredRefine.recipes.filter(
                  (r) => r.patch.patchType !== 'ManualReview'
                );
                const prompt = `${t('plugin_usage.immediate_fix')}: "${plugin.name}" (ID: ${plugin.id}).\n\n${t('plugin_usage.optimize_suggestion')}\n\n${t('plugin_usage.fail_rate')}: ${failRate.toFixed(1)}%，${t('plugin_usage.suggest_optimize')} 20%。\n\n${t('plugin_usage.detected_issues', { count: structuredRefine.recipes.length, autoFixable: autoFixable.length })}`;
                onRefine(plugin.id, plugin.name, prompt);
              }}
              sx={{ fontSize: 11, textTransform: 'none', mt: 1 }}
            >
              {structuredRefine.healthStatus === 'Failed' ? t('plugin_usage.immediate_fix') : t('plugin_usage.ai_auto_optimize')}
            </Button>
          )}
        </Paper>
      )}

      {!structuredRefine?.recipes.length && suggestion && (
        <Paper
          variant="outlined"
          sx={{
            p: 1.5,
            mb: 1.5,
            borderColor: failRate > 50 ? '#E57373' : failRate > 20 ? '#FFB74D' : 'divider',
            bgcolor: failRate > 50
              ? (isDark ? 'rgba(229,115,115,0.08)' : 'rgba(229,115,115,0.04)')
              : failRate > 20
                ? (isDark ? 'rgba(255,183,77,0.08)' : 'rgba(255,183,77,0.04)')
                : 'transparent',
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
            <ArrowUpIcon size={14} color={getFailRateColor(failRate)} />
            <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
              {failRate > 50 ? t('plugin_usage.needs_immediate_optimize') : failRate > 20 ? t('plugin_usage.suggest_optimize') : t('plugin_usage.optimize_suggestion')}
            </Typography>
          </Box>

          {suggestion.commonErrors.length > 0 && (
            <Box sx={{ mb: 0.5 }}>
              <Typography variant="caption" color="text.secondary">{t('plugin_usage.common_errors')}</Typography>
              {suggestion.commonErrors.slice(0, 3).map((err, idx) => (
                <Typography key={idx} variant="caption" sx={{ display: 'block', color: '#E57373', fontSize: 10 }}>
                  • {err.length > 80 ? err.substring(0, 80) + '...' : err}
                </Typography>
              ))}
            </Box>
          )}

          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
            {t('plugin_usage.fail_rate')}: {failRate.toFixed(1)}% | {t('plugin_usage.recent_24h_fail', { count: suggestion.recentFailCount })}
          </Typography>

          {onRefine && (
            <Button
              size="small"
              variant={failRate > 50 ? 'contained' : 'outlined'}
              color={failRate > 50 ? 'error' : 'primary'}
              startIcon={<LightningIcon size={12} />}
              onClick={() => {
                const prompt = `${t('plugin_usage.ai_auto_optimize')}: "${plugin.name}" (ID: ${plugin.id})。\n\n${t('plugin_usage.optimize_suggestion')}\n\n${t('plugin_usage.fail_rate')}: ${failRate.toFixed(1)}%，${t('plugin_usage.suggest_optimize')} 20%。`;
                onRefine(plugin.id, plugin.name, prompt);
              }}
              sx={{ fontSize: 11, textTransform: 'none' }}
            >
              {failRate > 50 ? t('plugin_usage.immediate_fix') : t('plugin_usage.ai_auto_optimize')}
            </Button>
          )}
        </Paper>
      )}

      {logs.length > 0 && (
        <>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 600, flex: 1 }}>
              {t('plugin_usage.title')}
            </Typography>
            <Tooltip title={t('plugin_usage.export_logs')} arrow>
              <IconButton
                size="small"
                onClick={async () => {
                  try {
                    const data = await exportPluginUsageLogs(plugin.id);
                    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `${plugin.name}_usage_logs_${Date.now()}.json`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                  } catch (err) { console.error('PluginUsageInsights: operation failed', err); }
                }}
                sx={{ p: 0.25, color: 'text.secondary' }}
              >
                <ExportIcon size={12} />
              </IconButton>
            </Tooltip>
            <Tooltip title={t('plugin_usage.clear_logs')} arrow>
              <IconButton
                size="small"
                onClick={async () => {
                  if (!window.confirm(t('plugin_usage.confirm_clear_logs', { name: plugin.name }))) return;
                  try {
                    await clearPluginUsageLogs(plugin.id);
                    loadData();
                  } catch (err) { console.error('PluginUsageInsights: operation failed', err); }
                }}
                sx={{ p: 0.25, color: 'text.secondary' }}
              >
                <TrashIcon size={12} />
              </IconButton>
            </Tooltip>
          </Box>
          {logs.map((log) => (
            <Box
              key={log.id}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 0.5,
                py: 0.25,
                fontSize: 10,
              }}
            >
              <Chip
                label={log.success ? '✓' : '✗'}
                size="small"
                color={log.success ? 'success' : 'error'}
                sx={{ height: 16, fontSize: 9, minWidth: 20, '& .MuiChip-label': { px: 0.5 } }}
              />
              <Typography variant="caption" sx={{ flex: 1 }} noWrap>
                {log.toolName}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {log.durationMs}ms
              </Typography>
              <Chip
                label={log.source}
                size="small"
                variant="outlined"
                sx={{ height: 16, fontSize: 8, '& .MuiChip-label': { px: 0.5 } }}
              />
              <IconButton
                size="small"
                onClick={() => setSelectedLog(log)}
                sx={{ p: 0.15, color: 'text.secondary' }}
              >
                <EyeIcon size={11} />
              </IconButton>
            </Box>
          ))}
        </>
      )}

      <Dialog open={!!selectedLog} onClose={() => setSelectedLog(null)} maxWidth="md" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, pb: 1 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 600, flex: 1 }}>
            {t('plugin_usage.log_detail')}
          </Typography>
          <IconButton size="small" onClick={() => setSelectedLog(null)}>
            <XIcon size={16} />
          </IconButton>
        </DialogTitle>
        <DialogContent sx={{ pt: 1 }}>
          {selectedLog && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                <Chip label={selectedLog.success ? t('plugin_usage.success_label') : t('plugin_usage.fail_label')} color={selectedLog.success ? 'success' : 'error'} size="small" sx={{ fontWeight: 600 }} />
                <Chip label={selectedLog.source === 'user' ? t('plugin_usage.manual_exec') : t('plugin_usage.ai_exec')} variant="outlined" size="small" />
                <Chip label={`${selectedLog.durationMs}ms`} variant="outlined" size="small" />
              </Box>

              <Box>
                <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>{t('plugin_usage.tool_label') || 'Tool'}</Typography>
                <Typography variant="body2">{selectedLog.toolName}</Typography>
              </Box>

              {selectedLog.paramsSummary && (
                <Box>
                  <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>{t('plugin_usage.params_label')}</Typography>
                  <Paper variant="outlined" sx={{ p: 1, mt: 0.5, bgcolor: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0,0.02)', maxHeight: 200, overflow: 'auto' }}>
                    <Typography variant="caption" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontSize: 11, fontFamily: 'monospace' }}>
                      {formatLogContent(selectedLog.paramsSummary)}
                    </Typography>
                  </Paper>
                </Box>
              )}

              {selectedLog.outputSummary && (
                <Box>
                  <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>{t('plugin_usage.output_label')}</Typography>
                  <Paper variant="outlined" sx={{ p: 1, mt: 0.5, bgcolor: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0,0.02)', maxHeight: 400, overflow: 'auto' }}>
                    <Typography variant="caption" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontSize: 11, fontFamily: 'monospace' }}>
                      {formatLogContent(selectedLog.outputSummary)}
                    </Typography>
                  </Paper>
                </Box>
              )}

              {selectedLog.errorMessage && (
                <Box>
                  <Typography variant="caption" color="error" sx={{ fontWeight: 600 }}>{t('plugin_usage.error_label')}</Typography>
                  <Paper variant="outlined" sx={{ p: 1, mt: 0.5, bgcolor: isDark ? 'rgba(229,115,115,0.05)' : 'rgba(229,115,115,0.03)', borderColor: isDark ? 'rgba(229,115,115,0.2)' : 'rgba(229,115,115,0.15)', maxHeight: 200, overflow: 'auto' }}>
                    <Typography variant="caption" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontSize: 11, fontFamily: 'monospace', color: '#E57373' }}>
                      {formatLogContent(selectedLog.errorMessage)}
                    </Typography>
                  </Paper>
                </Box>
              )}

              <Box>
                <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>{t('plugin_usage.exec_time')}</Typography>
                <Typography variant="body2" sx={{ fontSize: 12 }}>
                  {new Date(selectedLog.createdAt).toLocaleString()}
                </Typography>
              </Box>
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button size="small" onClick={() => setSelectedLog(null)} sx={{ textTransform: 'none' }}>
            {t('plugin_usage.close')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

interface RecipeCardProps {
  recipe: FixRecipe;
  expanded: boolean;
  onToggle: () => void;
  isDark: boolean;
  t: (key: string) => string;
}

const RecipeCard: React.FC<RecipeCardProps> = ({ recipe, expanded, onToggle, isDark, t }) => {
  const errorColor = getErrorTypeColor(recipe.errorType);
  const errorLabel = getErrorTypeLabel(t, recipe.errorType);
  const patchLabel = getPatchTypeLabel(t, recipe.patch.patchType);
  const isAutoFixable = getPatchTypeAutoApply(recipe.patch.patchType) && recipe.confidence >= 0.7;

  return (
    <Paper
      variant="outlined"
      sx={{
        p: 1,
        mb: 0.5,
        borderRadius: 1.5,
        borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)',
        bgcolor: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.08)',
      }}
    >
      <Box
        sx={{ display: 'flex', alignItems: 'center', gap: 0.5, cursor: 'pointer' }}
        onClick={onToggle}
      >
        <WrenchIcon size={12} color={errorColor} />
        <Chip
          label={errorLabel}
          size="small"
          sx={{
            height: 18,
            fontSize: 9,
            bgcolor: `${errorColor}20`,
            color: errorColor,
            '& .MuiChip-label': { px: 0.5 },
          }}
        />
        <Typography variant="caption" sx={{ flex: 1, fontWeight: 500 }} noWrap>
          {recipe.toolName}
        </Typography>
        <Chip
          label={isAutoFixable ? t('plugin_usage.auto_fixable') : t('plugin_usage.needs_review')}
          size="small"
          sx={{
            height: 18,
            fontSize: 9,
            bgcolor: isAutoFixable ? 'rgba(129,199,132,0.15)' : 'rgba(255,183,77,0.15)',
            color: isAutoFixable ? '#81C784' : '#FFB74D',
            '& .MuiChip-label': { px: 0.5 },
          }}
        />
        <Typography variant="caption" color="text.disabled" sx={{ fontSize: 9 }}>
          {Math.round(recipe.confidence * 100)}%
        </Typography>
        <IconButton size="small" sx={{ p: 0.25 }}>
          {expanded ? <CaretUpIcon size={12} /> : <CaretDownIcon size={12} />}
        </IconButton>
      </Box>

      <Collapse in={expanded}>
        <Box sx={{ mt: 1, pl: 2.5 }}>
          <Typography variant="caption" sx={{ display: 'block', mb: 0.5, color: 'text.secondary' }}>
            {recipe.description}
          </Typography>
          <Box sx={{ display: 'flex', gap: 0.5, mb: 0.5 }}>
            <Chip
              label={`${t('plugin_usage.fix_method')}: ${patchLabel}`}
              size="small"
              variant="outlined"
              sx={{ height: 16, fontSize: 9, '& .MuiChip-label': { px: 0.5 } }}
            />
            <Chip
              label={`${t('plugin_usage.confidence')}: ${Math.round(recipe.confidence * 100)}%`}
              size="small"
              variant="outlined"
              sx={{ height: 16, fontSize: 9, '& .MuiChip-label': { px: 0.5 } }}
            />
          </Box>
          {recipe.patch.newScript && (
            <Box
              sx={{
                mt: 0.5,
                p: 1,
                borderRadius: 1,
                bgcolor: isDark ? 'rgba(0,0,0,0.3)' : 'rgba(0,0,0,0.04)',
                fontFamily: 'monospace',
                fontSize: 10,
                maxHeight: 120,
                overflow: 'auto',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
              }}
            >
              {recipe.patch.newScript.length > 300
                ? recipe.patch.newScript.substring(0, 300) + '...'
                : recipe.patch.newScript}
            </Box>
          )}
        </Box>
      </Collapse>
    </Paper>
  );
};

export default PluginUsageInsights;
