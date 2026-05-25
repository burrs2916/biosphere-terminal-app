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
import { useTranslation } from 'react-i18next';
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

const CLEANUP_OPTIONS: { value: CleanupMode; labelKey: string; descriptionKey: string }[] = [
  { value: 'failed_older_7d', labelKey: 'agent.usage_log.cleanup_option_failed_older_7d', descriptionKey: 'agent.usage_log.cleanup_desc_failed_older_7d' },
  { value: 'failed_older_30d', labelKey: 'agent.usage_log.cleanup_option_failed_older_30d', descriptionKey: 'agent.usage_log.cleanup_desc_failed_older_30d' },
  { value: 'older_7d', labelKey: 'agent.usage_log.cleanup_option_older_7d', descriptionKey: 'agent.usage_log.cleanup_desc_older_7d' },
  { value: 'older_30d', labelKey: 'agent.usage_log.cleanup_option_older_30d', descriptionKey: 'agent.usage_log.cleanup_desc_older_30d' },
  { value: 'all', labelKey: 'agent.usage_log.cleanup_option_all', descriptionKey: 'agent.usage_log.cleanup_desc_all' },
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
  const { t } = useTranslation('agent');
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

    const selectedLabel = t(selected.labelKey);
    const confirmMsg = cleanupMode === 'all'
      ? t('agent.usage_log.confirm_clean_all')
      : t('agent.usage_log.confirm_clean_option', { label: selectedLabel });

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

      setResult(t('agent.usage_log.cleared_count', { count: deleted }));
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
          {t('agent.usage_log.title')}
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
                {t('agent.usage_log.overview')}
              </Typography>
              <Box sx={{ display: 'flex', gap: 2 }}>
                <Box sx={{ flex: 1, textAlign: 'center' }}>
                  <Typography variant="caption" color="text.secondary">{t('agent.usage_log.total_count')}</Typography>
                  <Typography variant="h6" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
                    {totalCount.toLocaleString()}
                  </Typography>
                </Box>
                <Box sx={{ flex: 1, textAlign: 'center' }}>
                  <Typography variant="caption" color="text.secondary">{t('agent.usage_log.estimated_size')}</Typography>
                  <Typography variant="h6" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
                    {formatBytes(sizeEstimate)}
                  </Typography>
                </Box>
              </Box>
            </Paper>

            <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
              <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
                {t('agent.usage_log.cleanup')}
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
                {t('agent.usage_log.cleanup_hint')}
              </Typography>

              <FormControl fullWidth size="small" sx={{ mb: 1.5 }}>
                <InputLabel>{t('agent.usage_log.cleanup_scope')}</InputLabel>
                <Select
                  value={cleanupMode}
                  label={t('agent.usage_log.cleanup_scope')}
                  onChange={(e) => setCleanupMode(e.target.value as CleanupMode)}
                >
                  {CLEANUP_OPTIONS.map((opt) => (
                    <MenuItem key={opt.value} value={opt.value}>
                      <Box>
                        <Typography variant="body2">{t(opt.labelKey)}</Typography>
                        <Typography variant="caption" color="text.secondary">{t(opt.descriptionKey)}</Typography>
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
                {cleaning ? t('agent.usage_log.cleaning') : t('agent.usage_log.execute_cleanup')}
              </Button>
            </Paper>

            <Paper variant="outlined" sx={{ p: 2 }}>
              <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
                {t('agent.usage_log.export')}
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
                {t('agent.usage_log.export_hint')}
              </Typography>
              <Button
                size="small"
                variant="outlined"
                startIcon={<ExportIcon size={14} />}
                onClick={handleExport}
                disabled={totalCount === 0}
                sx={{ textTransform: 'none', fontSize: 12 }}
              >
                {t('agent.usage_log.export_all_json')}
              </Button>
            </Paper>
          </>
        )}
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} size="small" sx={{ textTransform: 'none' }}>
          {t('agent.usage_log.close')}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default UsageLogManagerDialog;
