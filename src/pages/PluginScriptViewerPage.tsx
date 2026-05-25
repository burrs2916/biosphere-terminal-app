import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import { CodeIcon, ClockCounterClockwiseIcon, PackageIcon, ArrowUpIcon, PlusIcon, MinusIcon, CaretDownIcon, CaretRightIcon } from '@phosphor-icons/react';
import type { PluginManifest, PluginTool, ChangelogEntry, ToolChange } from '../proto/plugin';
import { useTheme } from '@mui/material/styles';
import { getPlugin } from '../core/services/plugin.service';

function formatTimestamp(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleString();
}

function computeLineDiff(before: string, after: string): { type: 'same' | 'added' | 'removed'; line: string }[] {
  const beforeLines = before.split('\n');
  const afterLines = after.split('\n');
  const result: { type: 'same' | 'added' | 'removed'; line: string }[] = [];

  const maxLen = Math.max(beforeLines.length, afterLines.length);
  for (let i = 0; i < maxLen; i++) {
    const bLine = i < beforeLines.length ? beforeLines[i] : undefined;
    const aLine = i < afterLines.length ? afterLines[i] : undefined;
    if (bLine !== undefined && aLine !== undefined) {
      if (bLine === aLine) {
        result.push({ type: 'same', line: bLine });
      } else {
        result.push({ type: 'removed', line: bLine });
        result.push({ type: 'added', line: aLine });
      }
    } else if (bLine !== undefined) {
      result.push({ type: 'removed', line: bLine });
    } else if (aLine !== undefined) {
      result.push({ type: 'added', line: aLine });
    }
  }
  return result;
}

function DiffView({ before, after }: { before: string; after: string }) {
  const lines = computeLineDiff(before, after);
  return (
    <Box sx={{ fontFamily: 'monospace', fontSize: 11, lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
      {lines.map((line, i) => (
        <Box
          key={i}
          sx={{
            px: 1,
            bgcolor: line.type === 'added' ? 'rgba(76,175,80,0.12)' : line.type === 'removed' ? 'rgba(244,67,54,0.12)' : 'transparent',
            borderLeft: line.type === 'added' ? '3px solid #4CAF50' : line.type === 'removed' ? '3px solid #F44336' : '3px solid transparent',
            display: 'flex',
          }}
        >
          <Typography component="span" sx={{ fontSize: 11, fontFamily: 'monospace', color: line.type === 'added' ? '#4CAF50' : line.type === 'removed' ? '#F44336' : 'text.secondary', mr: 1, minWidth: 16 }}>
            {line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' '}
          </Typography>
          <Typography component="span" sx={{ fontSize: 11, fontFamily: 'monospace', color: line.type === 'same' ? 'text.primary' : undefined }}>
            {line.line}
          </Typography>
        </Box>
      ))}
    </Box>
  );
}

function ToolScriptPanel({ tool, isDark }: { tool: PluginTool; isDark: boolean }) {
  const scriptLines = tool.script.split('\n');
  const scriptType = scriptLines[0]?.startsWith('script:') ? 'script' :
                     scriptLines[0]?.startsWith('shell:') ? 'shell' :
                     scriptLines[0]?.match(/^(GET|POST|PUT|DELETE|PATCH)\s/i) ? 'http' : 'unknown';

  const displayScript = scriptType === 'script' || scriptType === 'shell'
    ? scriptLines.slice(1).join('\n')
    : tool.script;

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
        <Chip label={scriptType.toUpperCase()} size="small" sx={{ fontSize: 10, height: 20 }} />
        {scriptType === 'script' && scriptLines[0] && (
          <Typography variant="caption" sx={{ fontSize: 10, color: 'text.secondary' }}>
            {scriptLines[0].replace('script:', '')}
          </Typography>
        )}
      </Box>
      {tool.description && (
        <Typography variant="body2" sx={{ fontSize: 12, color: 'text.secondary', mb: 1 }}>
          {tool.description}
        </Typography>
      )}
      {tool.parameters.length > 0 && (
        <Box sx={{ mb: 1.5 }}>
          <Typography variant="caption" sx={{ fontSize: 10, fontWeight: 600, color: 'text.secondary' }}>
            Parameters:
          </Typography>
          {tool.parameters.map((p) => (
            <Box key={p.name} sx={{ display: 'flex', alignItems: 'center', gap: 0.5, ml: 1 }}>
              <Typography variant="caption" sx={{ fontSize: 10, fontFamily: 'monospace', color: 'primary.main' }}>
                {p.name}
              </Typography>
              <Chip label={p.paramType} size="small" sx={{ fontSize: 9, height: 16 }} />
              {p.required && <Chip label="required" size="small" color="error" sx={{ fontSize: 9, height: 16 }} />}
              <Typography variant="caption" sx={{ fontSize: 10, color: 'text.secondary' }}>
                {p.description}
              </Typography>
            </Box>
          ))}
        </Box>
      )}
      <Box
        sx={{
          bgcolor: isDark ? 'rgba(0,0,0,0.3)' : 'rgba(0,0,0,0.03)',
          borderRadius: 1,
          p: 1.5,
          maxHeight: 'calc(100vh - 340px)',
          overflow: 'auto',
          '&::-webkit-scrollbar': { width: 4 },
        }}
      >
        <Box sx={{ fontFamily: 'monospace', fontSize: 11, lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
          {displayScript.split('\n').map((line, i) => (
            <Box key={i} sx={{ display: 'flex' }}>
              <Typography component="span" sx={{ fontSize: 11, fontFamily: 'monospace', color: 'text.disabled', minWidth: 32, textAlign: 'right', mr: 1, userSelect: 'none' }}>
                {i + 1}
              </Typography>
              <Typography component="span" sx={{ fontSize: 11, fontFamily: 'monospace' }}>
                {line}
              </Typography>
            </Box>
          ))}
        </Box>
      </Box>
    </Box>
  );
}

function ChangelogPanel({ changelog, isDark }: { changelog: ChangelogEntry[]; isDark: boolean }) {
  const [expandedEntry, setExpandedEntry] = useState<number | null>(null);
  const sorted = [...changelog].sort((a, b) => b.date - a.date);

  return (
    <Box sx={{ maxHeight: 'calc(100vh - 280px)', overflow: 'auto', '&::-webkit-scrollbar': { width: 4 } }}>
      {sorted.map((entry, idx) => {
        const isExpanded = expandedEntry === idx;
        const hasToolChanges = entry.toolChanges && entry.toolChanges.length > 0;
        return (
          <Box key={idx} sx={{ mb: 1.5 }}>
            <Box
              onClick={() => setExpandedEntry(isExpanded ? null : idx)}
              sx={{
                display: 'flex', alignItems: 'center', gap: 0.5, cursor: hasToolChanges ? 'pointer' : 'default',
                bgcolor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
                borderRadius: 1, px: 1, py: 0.5,
                '&:hover': hasToolChanges ? { bgcolor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)' } : {},
              }}
            >
              {hasToolChanges ? (
                isExpanded ? <CaretDownIcon size={12} /> : <CaretRightIcon size={12} />
              ) : <Box sx={{ width: 12 }} />}
              <Chip label={`v${entry.version}`} size="small" sx={{ fontSize: 10, height: 18 }} />
              <Typography variant="caption" sx={{ fontSize: 10, color: 'text.secondary' }}>
                {formatTimestamp(entry.date)}
              </Typography>
              {hasToolChanges && (
                <Chip
                  icon={<CodeIcon size={10} />}
                  label={`${entry.toolChanges!.length} change${entry.toolChanges!.length > 1 ? 's' : ''}`}
                  size="small"
                  color="primary"
                  variant="outlined"
                  sx={{ fontSize: 9, height: 18 }}
                />
              )}
            </Box>
            <Box sx={{ pl: 2, mt: 0.25 }}>
              {entry.changes.map((change, ci) => (
                <Box key={ci} sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.5, mb: 0.15 }}>
                  <Typography variant="caption" sx={{ fontSize: 10, color: 'primary.main', mt: 0.5 }}>•</Typography>
                  <Typography variant="caption" sx={{ fontSize: 10, color: 'text.secondary' }}>{change}</Typography>
                </Box>
              ))}
            </Box>
            {isExpanded && hasToolChanges && (
              <Box sx={{ pl: 2, mt: 0.5 }}>
                {entry.toolChanges!.map((tc, tci) => (
                  <ToolChangeItem key={tci} tc={tc} isDark={isDark} />
                ))}
              </Box>
            )}
          </Box>
        );
      })}
    </Box>
  );
}

function ToolChangeItem({ tc, isDark }: { tc: ToolChange; isDark: boolean }) {
  const [showDiff, setShowDiff] = useState(false);
  const isAdded = tc.field === 'added';
  const isRemoved = tc.field === 'removed';
  const isScript = tc.field === 'script';

  return (
    <Box sx={{ mb: 1, borderRadius: 1, border: '1px solid', borderColor: 'divider', overflow: 'hidden' }}>
      <Box
        onClick={() => setShowDiff(!showDiff)}
        sx={{
          display: 'flex', alignItems: 'center', gap: 0.5, px: 1, py: 0.5, cursor: 'pointer',
          bgcolor: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.01)',
          '&:hover': { bgcolor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)' },
        }}
      >
        {isAdded ? <PlusIcon size={12} color="#4CAF50" /> :
         isRemoved ? <MinusIcon size={12} color="#F44336" /> :
         isScript ? <CodeIcon size={12} color="#FF9800" /> :
         <ArrowUpIcon size={12} color="#2196F3" />}
        <Typography variant="caption" sx={{ fontSize: 10, fontWeight: 600 }}>
          {tc.toolName}
        </Typography>
        <Chip
          label={tc.field}
          size="small"
          color={isAdded ? 'success' : isRemoved ? 'error' : isScript ? 'warning' : 'info'}
          sx={{ fontSize: 9, height: 16 }}
        />
        <Box sx={{ flex: 1 }} />
        <Typography variant="caption" sx={{ fontSize: 9, color: 'text.disabled' }}>
          {showDiff ? 'hide' : 'show diff'}
        </Typography>
      </Box>
      {showDiff && (
        <Box sx={{ px: 1, py: 0.5, maxHeight: 300, overflow: 'auto', '&::-webkit-scrollbar': { width: 4 } }}>
          {tc.before && tc.after ? (
            <DiffView before={tc.before} after={tc.after} />
          ) : tc.after ? (
            <Box sx={{ bgcolor: 'rgba(76,175,80,0.08)', borderRadius: 0.5, p: 1 }}>
              <DiffView before="" after={tc.after} />
            </Box>
          ) : tc.before ? (
            <Box sx={{ bgcolor: 'rgba(244,67,54,0.08)', borderRadius: 0.5, p: 1 }}>
              <DiffView before={tc.before} after="" />
            </Box>
          ) : null}
        </Box>
      )}
    </Box>
  );
}

function MultiToolViewer({ tools, isDark }: { tools: PluginTool[]; isDark: boolean }) {
  const [selectedIdx, setSelectedIdx] = useState(0);
  return (
    <Box>
      <Box sx={{ display: 'flex', gap: 0.5, mb: 1, flexWrap: 'wrap' }}>
        {tools.map((tool, idx) => (
          <Chip
            key={tool.name}
            label={tool.name}
            size="small"
            variant={selectedIdx === idx ? 'filled' : 'outlined'}
            color={selectedIdx === idx ? 'primary' : 'default'}
            onClick={() => setSelectedIdx(idx)}
            sx={{ fontSize: 10, height: 22 }}
          />
        ))}
      </Box>
      {tools[selectedIdx] && <ToolScriptPanel tool={tools[selectedIdx]} isDark={isDark} />}
    </Box>
  );
}

export function PluginScriptViewerPage() {
  const { t } = useTranslation('agent');
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState(0);
  const [plugin, setPlugin] = useState<PluginManifest | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const pluginId = searchParams.get('pluginId') || '';

  useEffect(() => {
    if (!pluginId) {
      setError('No plugin ID provided');
      setLoading(false);
      return;
    }
    getPlugin(pluginId)
      .then((p) => {
        if (p) {
          setPlugin(p);
        } else {
          setError(`Plugin '${pluginId}' not found`);
        }
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [pluginId]);

  if (loading) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
        <CircularProgress size={32} />
      </Box>
    );
  }

  if (error || !plugin) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
        <Typography color="error">{error || 'Plugin not found'}</Typography>
      </Box>
    );
  }

  const tools = plugin.tools || [];
  const changelog = plugin.changelog || [];

  return (
    <Box sx={{ height: '100vh', display: 'flex', flexDirection: 'column', bgcolor: 'background.default' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 1.5, borderBottom: '1px solid', borderColor: 'divider' }}>
        <PackageIcon size={20} weight="duotone" color={theme.palette.primary.main} />
        <Typography variant="subtitle1" sx={{ flex: 1, fontWeight: 700, fontSize: 15 }}>
          {plugin.name}
        </Typography>
        <Chip label={`v${plugin.version}`} size="small" sx={{ fontSize: 10 }} />
      </Box>

      <Box sx={{ px: 2, py: 0.5 }}>
        <Typography variant="body2" sx={{ fontSize: 12, color: 'text.secondary' }}>
          {plugin.description}
        </Typography>
        {plugin.author && (
          <Typography variant="caption" sx={{ fontSize: 10, color: 'text.disabled' }}>
            by {plugin.author}
          </Typography>
        )}
      </Box>

      <Tabs
        value={activeTab}
        onChange={(_, v) => setActiveTab(v)}
        sx={{ px: 2, minHeight: 36, borderBottom: '1px solid', borderColor: 'divider' }}
      >
        <Tab
          icon={<CodeIcon size={14} />}
          iconPosition="start"
          label={<Typography sx={{ fontSize: 12 }}>{t('plugin_page.tools', 'Tools')} ({tools.length})</Typography>}
          sx={{ minHeight: 36, py: 0 }}
        />
        <Tab
          icon={<ClockCounterClockwiseIcon size={14} />}
          iconPosition="start"
          label={<Typography sx={{ fontSize: 12 }}>{t('plugin_page.changelog', 'Changelog')} ({changelog.length})</Typography>}
          sx={{ minHeight: 36, py: 0 }}
        />
      </Tabs>

      <Box sx={{ flex: 1, overflow: 'auto', px: 2, py: 1.5 }}>
        {activeTab === 0 && (
          tools.length === 0 ? (
            <Box sx={{ py: 3, textAlign: 'center' }}>
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                No tools defined
              </Typography>
            </Box>
          ) : tools.length === 1 ? (
            <ToolScriptPanel tool={tools[0]} isDark={isDark} />
          ) : (
            <MultiToolViewer tools={tools} isDark={isDark} />
          )
        )}
        {activeTab === 1 && (
          changelog.length === 0 ? (
            <Box sx={{ py: 3, textAlign: 'center' }}>
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                No changelog entries
              </Typography>
            </Box>
          ) : (
            <ChangelogPanel changelog={changelog} isDark={isDark} />
          )
        )}
      </Box>
    </Box>
  );
}
