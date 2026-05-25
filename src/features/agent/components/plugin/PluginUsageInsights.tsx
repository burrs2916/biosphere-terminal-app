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

interface PluginUsageInsightsProps {
  plugin: PluginManifest;
  onRefine?: (pluginId: string, pluginName: string, suggestion: string) => void;
  isDark?: boolean;
}

const ERROR_TYPE_LABELS: Record<FixErrorType, { label: string; color: string }> = {
  MissingDependency: { label: '缺少依赖', color: '#FF9800' },
  SyntaxError: { label: '语法错误', color: '#F44336' },
  FileNotFound: { label: '文件未找到', color: '#9C27B0' },
  PermissionDenied: { label: '权限不足', color: '#E91E63' },
  Timeout: { label: '执行超时', color: '#FF5722' },
  NetworkError: { label: '网络错误', color: '#00BCD4' },
  RuntimeError: { label: '运行时错误', color: '#FF7043' },
  OutputPathError: { label: '输出路径错误', color: '#795548' },
  UnknownError: { label: '未知错误', color: '#9E9E9E' },
};

const PATCH_TYPE_LABELS: Record<FixPatchType, { label: string; autoApply: boolean }> = {
  ScriptReplace: { label: '替换脚本', autoApply: true },
  ScriptPrefix: { label: '脚本前缀', autoApply: true },
  ParameterAdd: { label: '添加参数', autoApply: true },
  ParameterModify: { label: '修改参数', autoApply: true },
  ManualReview: { label: '需手动审查', autoApply: false },
};

function getHealthIcon(status: string) {
  switch (status) {
    case 'Healthy': return <CheckCircleIcon size={16} color="#81C784" />;
    case 'Degraded': return <WarningIcon size={16} color="#FFB74D" />;
    case 'Failed': return <XCircleIcon size={16} color="#E57373" />;
    default: return null;
  }
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
          暂无使用数据
        </Typography>
        <Typography variant="caption" color="text.disabled">
          使用此插件后，这里将显示使用分析和优化建议
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

  return (
    <Box>
      <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
        使用分析
      </Typography>

      <Paper variant="outlined" sx={{ p: 1.5, mb: 1.5 }}>
        <Stack direction="row" spacing={2} sx={{ mb: 1 }}>
          <Box sx={{ flex: 1 }}>
            <Typography variant="caption" color="text.secondary">总执行</Typography>
            <Typography variant="h6" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
              {metrics.totalExecutions}
            </Typography>
          </Box>
          <Box sx={{ flex: 1 }}>
            <Typography variant="caption" color="text.secondary">成功率</Typography>
            <Typography variant="h6" sx={{ fontWeight: 700, lineHeight: 1.2, color: getFailRateColor(failRate) }}>
              {successRate.toFixed(0)}%
            </Typography>
          </Box>
          <Box sx={{ flex: 1 }}>
            <Typography variant="caption" color="text.secondary">平均耗时</Typography>
            <Typography variant="h6" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
              {metrics.avgDurationMs < 1000
                ? `${metrics.avgDurationMs.toFixed(0)}ms`
                : `${(metrics.avgDurationMs / 1000).toFixed(1)}s`}
            </Typography>
          </Box>
        </Stack>

        <Box sx={{ mb: 0.5 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
            <Typography variant="caption" color="text.secondary">成功 / 失败</Typography>
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
            {getHealthIcon(structuredRefine.healthStatus)}
            <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
              {structuredRefine.healthStatus === 'Failed'
                ? '⚠️ 需要立即修复'
                : structuredRefine.healthStatus === 'Degraded'
                  ? '⚡ 建议优化'
                  : '✓ 运行正常'}
            </Typography>
            <Box sx={{ flex: 1 }} />
            <Chip
              label={`${structuredRefine.recipes.length} 个修复方案`}
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
                const prompt = `请分析插件 "${plugin.name}" (ID: ${plugin.id}) 的使用情况并自动优化。\n\n使用 plugin_manager 工具的 analyze_usage action 查看详细分析，然后根据分析结果使用 refine action 修复问题。\n\n当前失败率: ${failRate.toFixed(1)}%，需要降低到 20% 以下。\n\n检测到 ${structuredRefine.recipes.length} 个问题，其中 ${autoFixable.length} 个可自动修复。`;
                onRefine(plugin.id, plugin.name, prompt);
              }}
              sx={{ fontSize: 11, textTransform: 'none', mt: 1 }}
            >
              {structuredRefine.healthStatus === 'Failed' ? '立即自动修复' : 'AI 自动优化'}
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
              {failRate > 50 ? '⚠️ 需要立即优化' : failRate > 20 ? '⚡ 建议优化' : '优化建议'}
            </Typography>
          </Box>

          {suggestion.commonErrors.length > 0 && (
            <Box sx={{ mb: 0.5 }}>
              <Typography variant="caption" color="text.secondary">常见错误：</Typography>
              {suggestion.commonErrors.slice(0, 3).map((err, idx) => (
                <Typography key={idx} variant="caption" sx={{ display: 'block', color: '#E57373', fontSize: 10 }}>
                  • {err.length > 80 ? err.substring(0, 80) + '...' : err}
                </Typography>
              ))}
            </Box>
          )}

          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
            失败率: {failRate.toFixed(1)}% | 近24h失败: {suggestion.recentFailCount}次
          </Typography>

          {onRefine && (
            <Button
              size="small"
              variant={failRate > 50 ? 'contained' : 'outlined'}
              color={failRate > 50 ? 'error' : 'primary'}
              startIcon={<LightningIcon size={12} />}
              onClick={() => {
                const prompt = `请分析插件 "${plugin.name}" (ID: ${plugin.id}) 的使用情况并自动优化。\n\n使用 plugin_manager 工具的 analyze_usage action 查看详细分析，然后根据分析结果使用 refine action 修复问题。\n\n当前失败率: ${failRate.toFixed(1)}%，需要降低到 20% 以下。`;
                onRefine(plugin.id, plugin.name, prompt);
              }}
              sx={{ fontSize: 11, textTransform: 'none' }}
            >
              {failRate > 50 ? '立即自动优化' : 'AI 自动优化'}
            </Button>
          )}
        </Paper>
      )}

      {logs.length > 0 && (
        <>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 600, flex: 1 }}>
              最近执行
            </Typography>
            <Tooltip title="导出日志" arrow>
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
                  } catch {}
                }}
                sx={{ p: 0.25, color: 'text.secondary' }}
              >
                <ExportIcon size={12} />
              </IconButton>
            </Tooltip>
            <Tooltip title="清除日志" arrow>
              <IconButton
                size="small"
                onClick={async () => {
                  if (!window.confirm(`确定要清除插件 "${plugin.name}" 的所有执行日志吗？此操作不可恢复。`)) return;
                  try {
                    await clearPluginUsageLogs(plugin.id);
                    loadData();
                  } catch {}
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
            日志详情
          </Typography>
          <IconButton size="small" onClick={() => setSelectedLog(null)}>
            <XIcon size={16} />
          </IconButton>
        </DialogTitle>
        <DialogContent sx={{ pt: 1 }}>
          {selectedLog && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                <Chip label={selectedLog.success ? '成功' : '失败'} color={selectedLog.success ? 'success' : 'error'} size="small" sx={{ fontWeight: 600 }} />
                <Chip label={selectedLog.source === 'user' ? '手动执行' : 'AI 执行'} variant="outlined" size="small" />
                <Chip label={`${selectedLog.durationMs}ms`} variant="outlined" size="small" />
              </Box>

              <Box>
                <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>工具</Typography>
                <Typography variant="body2">{selectedLog.toolName}</Typography>
              </Box>

              {selectedLog.paramsSummary && (
                <Box>
                  <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>参数</Typography>
                  <Paper variant="outlined" sx={{ p: 1, mt: 0.5, bgcolor: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)', maxHeight: 200, overflow: 'auto' }}>
                    <Typography variant="caption" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontSize: 11, fontFamily: 'monospace' }}>
                      {formatLogContent(selectedLog.paramsSummary)}
                    </Typography>
                  </Paper>
                </Box>
              )}

              {selectedLog.outputSummary && (
                <Box>
                  <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>输出</Typography>
                  <Paper variant="outlined" sx={{ p: 1, mt: 0.5, bgcolor: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)', maxHeight: 400, overflow: 'auto' }}>
                    <Typography variant="caption" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontSize: 11, fontFamily: 'monospace' }}>
                      {formatLogContent(selectedLog.outputSummary)}
                    </Typography>
                  </Paper>
                </Box>
              )}

              {selectedLog.errorMessage && (
                <Box>
                  <Typography variant="caption" color="error" sx={{ fontWeight: 600 }}>错误信息</Typography>
                  <Paper variant="outlined" sx={{ p: 1, mt: 0.5, bgcolor: isDark ? 'rgba(229,115,115,0.05)' : 'rgba(229,115,115,0.03)', borderColor: isDark ? 'rgba(229,115,115,0.2)' : 'rgba(229,115,115,0.15)', maxHeight: 200, overflow: 'auto' }}>
                    <Typography variant="caption" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontSize: 11, fontFamily: 'monospace', color: '#E57373' }}>
                      {formatLogContent(selectedLog.errorMessage)}
                    </Typography>
                  </Paper>
                </Box>
              )}

              <Box>
                <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>执行时间</Typography>
                <Typography variant="body2" sx={{ fontSize: 12 }}>
                  {new Date(selectedLog.createdAt).toLocaleString()}
                </Typography>
              </Box>
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button size="small" onClick={() => setSelectedLog(null)} sx={{ textTransform: 'none' }}>
            关闭
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
}

const RecipeCard: React.FC<RecipeCardProps> = ({ recipe, expanded, onToggle, isDark }) => {
  const errorInfo = ERROR_TYPE_LABELS[recipe.errorType] || ERROR_TYPE_LABELS.UnknownError;
  const patchInfo = PATCH_TYPE_LABELS[recipe.patch.patchType] || PATCH_TYPE_LABELS.ManualReview;
  const isAutoFixable = patchInfo.autoApply && recipe.confidence >= 0.7;

  return (
    <Paper
      variant="outlined"
      sx={{
        p: 1,
        mb: 0.5,
        borderRadius: 1.5,
        borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)',
        bgcolor: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.01)',
      }}
    >
      <Box
        sx={{ display: 'flex', alignItems: 'center', gap: 0.5, cursor: 'pointer' }}
        onClick={onToggle}
      >
        <WrenchIcon size={12} color={errorInfo.color} />
        <Chip
          label={errorInfo.label}
          size="small"
          sx={{
            height: 18,
            fontSize: 9,
            bgcolor: `${errorInfo.color}20`,
            color: errorInfo.color,
            '& .MuiChip-label': { px: 0.5 },
          }}
        />
        <Typography variant="caption" sx={{ flex: 1, fontWeight: 500 }} noWrap>
          {recipe.toolName}
        </Typography>
        <Chip
          label={isAutoFixable ? '可自动修复' : '需审查'}
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
              label={`修复方式: ${patchInfo.label}`}
              size="small"
              variant="outlined"
              sx={{ height: 16, fontSize: 9, '& .MuiChip-label': { px: 0.5 } }}
            />
            <Chip
              label={`置信度: ${Math.round(recipe.confidence * 100)}%`}
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
