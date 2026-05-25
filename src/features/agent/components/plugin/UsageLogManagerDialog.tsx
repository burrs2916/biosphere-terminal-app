import React, { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Typography,
  Paper,
  CircularProgress,
  Alert,
  Button,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
} from '@mui/material';
import {
  TrashIcon,
  ExportIcon,
  DatabaseIcon,
  XIcon,
} from '@phosphor-icons/react';
import {
  countAllUsageLogs,
  usageLogsSizeEstimate,
  purgeAllUsageLogs,
  clearUsageLogsBefore,
  clearFailedLogsBefore,
  exportAllUsageLogs,
} from '../../../../core/services/plugin.service';

interface UsageLogManagerDialogProps {
  open: boolean;
  onClose: () => void;
}

type CleanupMode = 'older_7d' | 'older_30d' | 'failed_older_7d' | 'failed_older_30d' | 'all';

const CLEANUP_OPTIONS: { value: CleanupMode; label: string; description: string }[] = [
  { value: 'failed_older_7d', label: '7天前的失败日志', description: '保留最近7天的失败日志和所有成功日志' },
  { value: 'failed_older_30d', label: '30天前的失败日志', description: '保留最近30天的失败日志和所有成功日志' },
  { value: 'older_7d', label: '7天前的所有日志', description: '只保留最近7天的日志' },
  { value: 'older_30d', label: '30天前的所有日志', description: '只保留最近30天的日志' },
  { value: 'all', label: '全部日志', description: '清除所有插件的全部执行日志' },
];

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const UsageLogManagerDialog: React.FC<UsageLogManagerDialogProps> = ({
  open,
  onClose,
}) => {
  const [totalCount, setTotalCount] = useState<number>(0);
  const [sizeEstimate, setSizeEstimate] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [cleanupMode, setCleanupMode] = useState<CleanupMode>('failed_older_30d');
  const [cleaning, setCleaning] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadStats = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [count, size] = await Promise.all([
        countAllUsageLogs(),
        usageLogsSizeEstimate(),
      ]);
      setTotalCount(count);
      setSizeEstimate(size);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) loadStats();
  }, [open, loadStats]);

  const handleCleanup = async () => {
    const selected = CLEANUP_OPTIONS.find((o) => o.value === cleanupMode);
    if (!selected) return;

    const confirmMsg = cleanupMode === 'all'
      ? `确定要清除所有执行日志吗？此操作不可恢复。`
      : `确定要清除${selected.label}吗？此操作不可恢复。`;

    if (!window.confirm(confirmMsg)) return;

    setCleaning(true);
    setResult(null);
    setError(null);

    try {
      let deleted = 0;
      const now = Date.now();

      switch (cleanupMode) {
        case 'older_7d':
          deleted = await clearUsageLogsBefore(now - 7 * 24 * 60 * 60 * 1000);
          break;
        case 'older_30d':
          deleted = await clearUsageLogsBefore(now - 30 * 24 * 60 * 60 * 1000);
          break;
        case 'failed_older_7d':
          deleted = await clearFailedLogsBefore(now - 7 * 24 * 60 * 60 * 1000);
          break;
        case 'failed_older_30d':
          deleted = await clearFailedLogsBefore(now - 30 * 24 * 60 * 60 * 1000);
          break;
        case 'all':
          deleted = await purgeAllUsageLogs();
          break;
      }

      setResult(`已清除 ${deleted} 条日志`);
      loadStats();
    } catch (err) {
      setError(String(err));
    } finally {
      setCleaning(false);
    }
  };

  const handleExport = async () => {
    try {
      const data = await exportAllUsageLogs();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `all_usage_logs_${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(String(err));
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, pb: 1 }}>
        <DatabaseIcon size={20} />
        <Typography variant="subtitle1" sx={{ fontWeight: 600, flex: 1 }}>
          使用日志管理
        </Typography>
        <IconButton size="small" onClick={onClose}>
          <XIcon size={16} />
        </IconButton>
      </DialogTitle>

      <DialogContent sx={{ pt: 1 }}>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
            <CircularProgress size={24} />
          </Box>
        ) : (
          <>
            {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
            {result && <Alert severity="success" sx={{ mb: 2 }}>{result}</Alert>}

            <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
              <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
                日志概览
              </Typography>
              <Box sx={{ display: 'flex', gap: 2 }}>
                <Box sx={{ flex: 1, textAlign: 'center' }}>
                  <Typography variant="caption" color="text.secondary">总记录数</Typography>
                  <Typography variant="h6" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
                    {totalCount.toLocaleString()}
                  </Typography>
                </Box>
                <Box sx={{ flex: 1, textAlign: 'center' }}>
                  <Typography variant="caption" color="text.secondary">预估大小</Typography>
                  <Typography variant="h6" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
                    {formatBytes(sizeEstimate)}
                  </Typography>
                </Box>
              </Box>
            </Paper>

            <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
              <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
                清理日志
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
                定期清理旧日志有助于保持 AI agent 改进插件时的分析质量，避免过时错误干扰判断
              </Typography>

              <FormControl fullWidth size="small" sx={{ mb: 1.5 }}>
                <InputLabel>清理范围</InputLabel>
                <Select
                  value={cleanupMode}
                  label="清理范围"
                  onChange={(e) => setCleanupMode(e.target.value as CleanupMode)}
                >
                  {CLEANUP_OPTIONS.map((opt) => (
                    <MenuItem key={opt.value} value={opt.value}>
                      <Box>
                        <Typography variant="body2">{opt.label}</Typography>
                        <Typography variant="caption" color="text.secondary">{opt.description}</Typography>
                      </Box>
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>

              <Button
                size="small"
                variant="outlined"
                color="warning"
                startIcon={<TrashIcon size={14} />}
                onClick={handleCleanup}
                disabled={cleaning || totalCount === 0}
                sx={{ textTransform: 'none', fontSize: 12 }}
              >
                {cleaning ? '清理中...' : '执行清理'}
              </Button>
            </Paper>

            <Paper variant="outlined" sx={{ p: 2 }}>
              <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
                导出日志
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
                导出日志可用于备份、离线分析，或作为 AI agent 改进插件的参考数据
              </Typography>
              <Button
                size="small"
                variant="outlined"
                startIcon={<ExportIcon size={14} />}
                onClick={handleExport}
                disabled={totalCount === 0}
                sx={{ textTransform: 'none', fontSize: 12 }}
              >
                导出全部日志 (JSON)
              </Button>
            </Paper>
          </>
        )}
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} size="small" sx={{ textTransform: 'none' }}>
          关闭
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default UsageLogManagerDialog;
