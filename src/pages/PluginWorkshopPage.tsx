import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Box, Typography, IconButton, Tooltip, Paper, Chip, Button, CircularProgress, Select, MenuItem, FormControl,
  Dialog, DialogTitle, DialogContent, DialogActions, Alert, InputLabel,
} from '@mui/material';
import {
  LightningIcon, SparkleIcon, PackageIcon, ArrowsClockwiseIcon,
  TargetIcon, LightbulbIcon, LinkIcon, RobotIcon, ShieldWarningIcon,
  CaretDownIcon, CaretRightIcon, PlusIcon,
  FolderSimplePlusIcon, TagIcon, DatabaseIcon, ArrowsLeftRightIcon,
} from '@phosphor-icons/react';
import { usePluginStore } from '../features/agent/store/pluginStore';
import { PluginGroupManageDialog } from '../features/agent/components/PluginGroupManageDialog';
import { UsageLogManagerDialog } from '../features/agent/components/plugin/UsageLogManagerDialog';
import { IconRenderer } from '../components/icon/IconRenderer';
import { useAgentStore } from '../features/agent/store/agentStore';
import { generatePluginScenarios, type GeneratedScenario } from '../core/services/agent.service';
import { runAgent, saveMessage, listMessages, createConversation, listConversations, stopAgent, respondPermission, writeFrontendLog } from '../core/services/agent.service';
import { getPluginAssistantAgentId } from '../features/agent/components/PluginAssistantTab';
import { PluginRunner } from '../features/agent/components/plugin/PluginRunner';
import type { MessageDto } from '../proto/agent';
import { listen } from '@tauri-apps/api/event';
import { useTheme } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';
import { ChatMessagesArea, ChatInputArea, type FileAttachment } from '../components/chat/ChatComponents';
import type { ToolCallDisplay } from '../components/chat/ChatComponents';
import type { PluginManifest } from '../proto/plugin';

const WORKSHOP_AGENT_KEY = 'biosphere_workshop_agent_id';

/** Sanitize an example prompt to remove system instructions and absolute paths.
 *  This is a defense-in-depth frontend check — the backend already sanitizes
 *  before saving, but we re-verify here to handle any edge cases. */
function sanitizeExamplePrompt(prompt: string): string {
  let result = prompt;

  // Strip bracket instructions like [System: ...] or [指令: ...]
  result = result.replace(/\[(?:系统指令|系统提示|system:|system |instruction:|important:|critical:|warning:|note:|提示词|system prompt|internal|指令:|系统|提示)[^\]]*\]/gi, '');

  // Strip markdown-style system headers
  result = result.replace(/^#{1,3}\s*(?:system|instruction|important|critical|warning|note:|提示词|系统指令|系统提示|internal|must call|must use|you must|you are).*$/gim, '');
  result = result.replace(/\*\*(?:system|instruction|important|critical|warning|note:|提示词|系统指令|系统提示|internal|must call|must use|you must|you are)[^*]*\*\*/gi, '');

  // Strip absolute unix paths
  result = result.replace(/~\/[^\s"'\]]+/g, (match) => match.split('/').pop() || match);
  const unixPrefixes = ['/tmp/', '/home/', '/var/', '/usr/', '/etc/', '/company/', '/users/', '/opt/', '/srv/', '/mnt/', '/dev/', '/proc/', '/sys/', '/root/'];
  for (const prefix of unixPrefixes) {
    result = result.replace(new RegExp(prefix.replace(/\//g, '\\/') + '[^\\s"\'\\]]+', 'g'), (match) => match.split('/').pop() || match);
  }

  // Strip absolute Windows paths (e.g., C:\...)
  result = result.replace(/[A-Z]:\\[^\s"']+/gi, (match) => match.split(/[\\\/]/).pop() || match);

  // Collapse whitespace
  result = result.replace(/\s+/g, ' ').trim();

  return result;
}

type Category = 'practical' | 'creative' | 'combination';

interface LastToolExecution {
  toolName: string;
  success: boolean;
  output: string;
  durationMs: number;
  params: Record<string, unknown>;
}

const CATEGORY_META: Record<Category, { icon: typeof TargetIcon; color: string; darkColor: string }> = {
  practical: { icon: TargetIcon, color: '#1565C0', darkColor: '#42A5F5' },
  creative: { icon: LightbulbIcon, color: '#E65100', darkColor: '#FFB74D' },
  combination: { icon: LinkIcon, color: '#6A1B9A', darkColor: '#CE93D8' },
};

interface ScenarioCache {
  [pluginId: string]: GeneratedScenario[];
}

interface PermissionRequestPayload {
  conversationId: string;
  agentId?: string;
  toolName: string;
  arguments: Record<string, unknown>;
  riskLevel: 'low' | 'high';
  description: string;
}

export function PluginWorkshopPage() {
  const { t } = useTranslation('agent');
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const accentColor = isDark ? '#4FC3F7' : '#0288D1';
  const mutedBorder = isDark ? 'rgba(48,54,61,0.6)' : 'rgba(0,0,0,0.08)';

  const { plugins, loadPlugins } = usePluginStore();
  const { agents, loadAgents, loadModels } = useAgentStore();

  const [selectedPlugin, setSelectedPlugin] = useState<PluginManifest | null>(null);
  const [scenarioCache, setScenarioCache] = useState<ScenarioCache>({});
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<Category | 'all'>('all');
  const [lastToolExecution, setLastToolExecution] = useState<LastToolExecution | null>(null);

  const [workshopAgentId, setWorkshopAgentId] = useState<string | null>(() => localStorage.getItem(WORKSHOP_AGENT_KEY));
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<FileAttachment[]>([]);
  const [panelRatio, setPanelRatio] = useState(0.55);
  const [loading, setLoading] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [messages, setMessages] = useState<MessageDto[]>([]);
  const [toolCalls, setToolCalls] = useState<ToolCallDisplay[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [permissionRequest, setPermissionRequest] = useState<PermissionRequestPayload | null>(null);
  const [compactionMessages, setCompactionMessages] = useState<string[]>([]);
  const [ready, setReady] = useState(false); // guards against race between initConversation and handleSend
  const initGenerationRef = useRef(0); // generation counter to abort stale initConversation calls
  const streamingMsgIdRef = useRef<string | null>(null);
  const toolCallCounterRef = useRef(0);

  const enabledPlugins = plugins.filter((p) => p.enabled);

  const autoSelectAgent = useCallback((agentList: typeof agents) => {
    if (agentList.length === 0) return null;

    const stored = localStorage.getItem(WORKSHOP_AGENT_KEY);
    if (stored && agentList.some((a) => a.id === stored)) return stored;

    const pluginAssistantId = getPluginAssistantAgentId();
    if (pluginAssistantId && agentList.some((a) => a.id === pluginAssistantId)) {
      localStorage.setItem(WORKSHOP_AGENT_KEY, pluginAssistantId);
      return pluginAssistantId;
    }

    const pluginManagerAgent = agentList.find((a) => a.toolIds.includes('plugin_manager'));
    if (pluginManagerAgent) {
      localStorage.setItem(WORKSHOP_AGENT_KEY, pluginManagerAgent.id);
      return pluginManagerAgent.id;
    }

    localStorage.setItem(WORKSHOP_AGENT_KEY, agentList[0].id);
    return agentList[0].id;
  }, []);

  useEffect(() => {
    loadPlugins();
    loadAgents();
    loadModels();
  }, [loadPlugins, loadAgents, loadModels]);

  useEffect(() => {
    if (agents.length === 0) return;
    const current = localStorage.getItem(WORKSHOP_AGENT_KEY);
    if (!current || !agents.some((a) => a.id === current)) {
      const selected = autoSelectAgent(agents);
      if (selected && selected !== current) {
        setWorkshopAgentId(selected);
      }
    }
  }, [agents, autoSelectAgent]);

  const handleGenerateScenarios = useCallback(async (pluginId: string, category?: string, replace?: boolean) => {
    setGenerating(true);
    setError(null);
    try {
      if (!workshopAgentId) {
        setError('请先在 Playground 模式中选择一个 Agent，才能生成使用场景');
        return;
      }
      const result = await generatePluginScenarios(pluginId, workshopAgentId, category, replace);
      setScenarioCache((prev) => {
        if (replace) {
          return { ...prev, [pluginId]: result.scenarios };
        }
        const existing = prev[pluginId] || [];
        const newScenarios = result.scenarios.filter(
          (s) => !existing.some((e) => e.name === s.name)
        );
        return { ...prev, [pluginId]: [...existing, ...newScenarios] };
      });
      loadPlugins();
    } catch (e: any) {
      setError(e.toString());
    } finally {
      setGenerating(false);
    }
  }, [workshopAgentId, loadPlugins]);

  const handleScenarioClick = useCallback((prompt: string, _toolName: string | undefined, plugin?: PluginManifest) => {
    if (plugin) {
      setSelectedPlugin(plugin);
    }

    const analysisPrompt = lastToolExecution
      ? `基于工具「${lastToolExecution.toolName}」的执行结果分析：\n\n${lastToolExecution.output.slice(0, 2000)}${lastToolExecution.output.length > 2000 ? '\n...(结果已截断)' : ''}\n\n${sanitizeExamplePrompt(prompt)}`
      : sanitizeExamplePrompt(prompt);

    setInput(analysisPrompt);
  }, [lastToolExecution]);

  useEffect(() => {
    const boundAgentId = workshopAgentId;
    if (!boundAgentId) return;

    setReady(false);
    const generation = ++initGenerationRef.current;

    const initConversation = async () => {
      setStreamingContent('');
      setToolCalls([]);
      setLoading(false);
      setPermissionRequest(null);
      streamingMsgIdRef.current = null;
      toolCallCounterRef.current = 0;

      try {
        const convs = await listConversations(boundAgentId);
        // Abort if a newer initConversation has started (rapid plugin switching)
        if (initGenerationRef.current !== generation) return;

        const pluginId = selectedPlugin?.id || 'unknown';
        const matchingConv = convs.find((c) => {
          try {
            const meta = JSON.parse(c.metadata || '{}');
            return meta.pluginId === pluginId && meta.source === 'workshop';
          } catch { return false; }
        });

        if (matchingConv) {
          setConversationId(matchingConv.id);
          const msgs = await listMessages(matchingConv.id);
          // Abort if a newer initConversation has started (rapid plugin switching)
          if (initGenerationRef.current !== generation) return;
          setMessages(msgs);
        } else {
          const pluginTitle = `${selectedPlugin?.name || 'Plugin'}`;
          const conv = await createConversation(boundAgentId, pluginTitle, {
            pluginId,
            source: 'workshop',
          });
          // Abort if a newer initConversation has started (rapid plugin switching)
          if (initGenerationRef.current !== generation) return;
          setConversationId(conv.id);
          setMessages([]);
        }
      } catch {} finally {
        // Only set ready if we're still the latest generation
        if (initGenerationRef.current === generation) {
          setReady(true);
        }
      }
    };
    initConversation();
  }, [selectedPlugin, workshopAgentId]);

  useEffect(() => {
    const unlistenChunk = listen<{ conversationId: string; chunk: string }>('agent-chunk', (event) => {
      if (event.payload.conversationId === conversationId) {
        setStreamingContent((prev) => prev + event.payload.chunk);
      }
    });

    const unlistenDone = listen<{ conversationId: string; response: string }>('agent-done', async (event) => {
      writeFrontendLog('info', 'WorkshopPage', `agent-done received, convId=${event.payload.conversationId}, currentConvId=${conversationId}`);
      if (event.payload.conversationId !== conversationId) {
        writeFrontendLog('warn', 'WorkshopPage', `agent-done convId mismatch: event=${event.payload.conversationId}, current=${conversationId}`);
        return;
      }
      const msgId = streamingMsgIdRef.current;
      if (msgId) {
        setMessages((prev) => prev.map((m) => m.id === msgId ? { ...m, content: event.payload.response } : m));
      }
      if (event.payload.conversationId) {
        try {
          const allMsgs = await listMessages(event.payload.conversationId);
          writeFrontendLog('info', 'WorkshopPage', `reloaded ${allMsgs.length} messages from DB after agent-done`);
          if (allMsgs.length > 0) {
            setMessages(allMsgs);
          } else {
            writeFrontendLog('warn', 'WorkshopPage', `listMessages returned 0 messages after agent-done, keeping current messages to avoid page blank`);
          }
        } catch (e) {
          writeFrontendLog('error', 'WorkshopPage', `failed to reload messages after agent-done: ${String(e)}`);
        }
      }
      setStreamingContent('');
      setLoading(false);
      streamingMsgIdRef.current = null;
    });

    const unlistenError = listen<{ conversationId: string; error: string }>('agent-error', (event) => {
      writeFrontendLog('error', 'WorkshopPage', `agent-error received, convId=${event.payload.conversationId}, error=${event.payload.error}`);
      if (event.payload.conversationId !== conversationId) return;
      const msgId = streamingMsgIdRef.current;
      if (msgId) {
        setMessages((prev) => prev.map((m) => m.id === msgId ? { ...m, content: `❌ ${event.payload.error}` } : m));
      }
      setStreamingContent('');
      setLoading(false);
      streamingMsgIdRef.current = null;
    });

    const unlistenToolCall = listen<{ conversationId: string; toolCall: { tool_name: string; arguments: Record<string, unknown>; result: string | null; success: boolean | null; status: 'running' | 'done' | 'denied' } }>('agent-tool-call', (event) => {
      if (event.payload.conversationId !== conversationId) return;
      const tc = event.payload.toolCall;
      if (tc.status === 'running') {
        toolCallCounterRef.current += 1;
        const id = `tc-${toolCallCounterRef.current}`;
        setToolCalls((prev) => [...prev, { id, toolName: tc.tool_name, arguments: tc.arguments, result: null, success: null, status: 'running' }]);
      } else if (tc.status === 'denied') {
        setToolCalls((prev) => {
          const last = prev.length - 1;
          if (last >= 0 && prev[last].status === 'running') {
            const updated = [...prev];
            updated[last] = { ...updated[last], result: tc.result, success: false, status: 'denied' };
            return updated;
          }
          return prev;
        });
      } else {
        setToolCalls((prev) => {
          const last = prev.length - 1;
          if (last >= 0 && prev[last].status === 'running') {
            const updated = [...prev];
            updated[last] = { ...updated[last], result: tc.result, success: tc.success, status: 'done' };
            return updated;
          }
          return prev;
        });
        // Reload plugins and agents when plugin_manager tool succeeds (plugin was modified)
        if (tc.tool_name === 'plugin_manager' && tc.success) {
          loadPlugins();
          loadAgents();
        }
      }
    });

    const unlistenPermission = listen<PermissionRequestPayload>('agent-permission-request', (event) => {
      if (event.payload.conversationId === conversationId) {
        setPermissionRequest(event.payload);
      }
    });

    const unlistenCompaction = listen<{ conversationId: string; message: string }>('agent-compaction', (event) => {
      if (event.payload.conversationId === conversationId) {
        setCompactionMessages((prev) => [...prev, event.payload.message]);
      }
    });

    return () => {
      unlistenChunk.then((fn) => fn());
      unlistenDone.then((fn) => fn());
      unlistenError.then((fn) => fn());
      unlistenToolCall.then((fn) => fn());
      unlistenPermission.then((fn) => fn());
      unlistenCompaction.then((fn) => fn());
    };
  }, [conversationId]);

  const sendToAgent = useCallback(async (content: string) => {
    const boundAgentId = workshopAgentId;
    if (!boundAgentId || !content.trim()) return;

    if (!ready) return;

    let convId = conversationId || '';
    if (!convId) {
      try {
        const conv = await createConversation(boundAgentId, `${selectedPlugin?.name || 'Plugin'}`, {
          pluginId: selectedPlugin?.id || 'unknown',
          source: 'workshop',
        });
        convId = conv.id;
        setConversationId(convId);
      } catch {
        return;
      }
    }

    const userMsg: MessageDto = {
      id: crypto.randomUUID(), conversationId: convId, role: 'user',
      content: content.trim(), toolCalls: '', isError: 0, createdAt: Date.now(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);
    setToolCalls([]);
    setCompactionMessages([]);
    toolCallCounterRef.current = 0;

    try { await saveMessage(userMsg); } catch {}

    const assistantMsgId = crypto.randomUUID();
    streamingMsgIdRef.current = assistantMsgId;
    setMessages((prev) => [...prev, {
      id: assistantMsgId, conversationId: convId, role: 'assistant',
      content: '', toolCalls: '', isError: 0, createdAt: Date.now(),
    }]);

    try {
      await runAgent(boundAgentId, userMsg.content, convId);
    } catch (e: any) {
      setMessages((prev) => prev.map((m) => m.id === assistantMsgId ? { ...m, content: `❌ ${e}` } : m));
      setLoading(false);
    }
  }, [conversationId, selectedPlugin, workshopAgentId, ready]);

  const handleSend = useCallback(async () => {
    if (!input.trim()) return;
    const content = input.trim();
    setInput('');
    setAttachments([]);
    await sendToAgent(content);
  }, [input, sendToAgent]);

  const handleStop = useCallback(async () => {
    if (conversationId) {
      try { await stopAgent(conversationId); } catch {}
    }
    setLoading(false);
    setStreamingContent('');
  }, [conversationId]);

  const handleNewChat = useCallback(async () => {
    if (!workshopAgentId) return;
    try {
      const conv = await createConversation(workshopAgentId, `${selectedPlugin?.name || 'Plugin'}`, {
        pluginId: selectedPlugin?.id || 'unknown',
        source: 'workshop',
      });
      setConversationId(conv.id);
      setMessages([]);
      setToolCalls([]);
      setStreamingContent('');
      setCompactionMessages([]);
    } catch {}
  }, [workshopAgentId, selectedPlugin]);

  const handleToolResult = useCallback(async (toolName: string, result: { success: boolean; output: string; durationMs: number }, params: Record<string, unknown>) => {
    setLastToolExecution({ toolName, success: result.success, output: result.output, durationMs: result.durationMs, params });

    if (!workshopAgentId) return;

    const summary = result.success
      ? `我执行了插件工具「${toolName}」，执行成功（耗时 ${result.durationMs}ms），结果如下：\n\n${result.output.slice(0, 3000)}${result.output.length > 3000 ? '\n...(结果已截断)' : ''}`
      : `我执行了插件工具「${toolName}」但执行失败了（耗时 ${result.durationMs}ms），错误信息：\n\n${result.output.slice(0, 2000)}`;

    const paramSummary = Object.keys(params).length > 0
      ? `\n\n使用的参数：${JSON.stringify(params, null, 2).slice(0, 500)}`
      : '';

    const analysisPrompt = `${summary}${paramSummary}\n\n请分析这个执行结果，给出你的见解和建议。`;

    await sendToAgent(analysisPrompt);
  }, [workshopAgentId, sendToAgent]);

  const handlePermissionResponse = useCallback(async (approved: boolean, alwaysAllow: boolean) => {
    if (permissionRequest) {
      try {
        await respondPermission(permissionRequest.conversationId, approved, alwaysAllow);
      } catch {}
      setPermissionRequest(null);
    }
  }, [permissionRequest]);

  const filteredScenarios = selectedPlugin
    ? (scenarioCache[selectedPlugin.id] || [])
        .filter((s) => activeCategory === 'all' || s.category === activeCategory)
    : Object.values(scenarioCache).flat()
        .filter((s) => activeCategory === 'all' || s.category === activeCategory);

  return (
    <Box sx={{ height: '100vh', display: 'flex', flexDirection: 'column', bgcolor: isDark ? '#0D1117' : '#fff' }}>
      <Box sx={{ px: 2, py: 1.5, display: 'flex', alignItems: 'center', gap: 1, borderBottom: `1px solid ${mutedBorder}` }}>
        <LightningIcon size={20} weight="duotone" color={accentColor} />
        <Typography variant="h6" sx={{ fontWeight: 700, fontSize: 16, flex: 1 }}>
          {t('workshop.title')}
        </Typography>
      </Box>

      <Box sx={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <Box sx={{ width: 220, borderRight: `1px solid ${mutedBorder}`, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <Box sx={{ px: 1.5, py: 1, display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <PackageIcon size={14} weight="duotone" color={accentColor} />
            <Typography variant="caption" sx={{ fontWeight: 600, fontSize: 11, color: 'text.secondary' }}>
              {t('workshop.plugins')} ({enabledPlugins.length})
            </Typography>
          </Box>
          <WorkshopPluginList
            plugins={enabledPlugins}
            selectedPlugin={selectedPlugin}
            accentColor={accentColor}
            isDark={isDark}
            mutedBorder={mutedBorder}
            scenarioCache={scenarioCache}
            onSelectPlugin={(plugin) => {
              setSelectedPlugin(plugin);
              setLastToolExecution(null);
              const cachedScenarios = scenarioCache[plugin.id];
              const hasCache = cachedScenarios && cachedScenarios.length > 0;
              const hasManifestScenarios = plugin.scenarios && plugin.scenarios.length > 0;
              if (!hasCache && hasManifestScenarios) {
                setScenarioCache((prev) => ({
                  ...prev,
                  [plugin.id]: plugin.scenarios!.map((s) => ({
                    name: s.name,
                    description: s.description,
                    examplePrompt: s.examplePrompt,
                    category: (s.category || 'practical') as Category,
                    toolName: s.toolName,
                  })),
                }));
              } else if (!hasCache && !hasManifestScenarios) {
                if (workshopAgentId) {
                  handleGenerateScenarios(plugin.id);
                }
              }
            }}
            t={t}
          />
        </Box>

        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {!selectedPlugin ? (
            <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2, p: 3 }}>
              <PackageIcon size={40} weight="duotone" color={accentColor} />
              <Typography variant="body2" sx={{ color: 'text.secondary', textAlign: 'center', fontWeight: 600 }}>
                请先在左侧选择一个插件
              </Typography>
              <Typography variant="caption" sx={{ color: 'text.disabled', textAlign: 'center', maxWidth: 280 }}>
                选择插件后，你可以直接操作工具并让 AI 分析结果
              </Typography>
            </Box>
          ) : (
            <Box sx={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
              <Box sx={{ width: `${panelRatio * 100}%`, display: 'flex', flexDirection: 'column', borderRight: `1px solid ${mutedBorder}`, overflow: 'hidden' }}>
                <Box sx={{
                  px: 2, py: 0.75, display: 'flex', alignItems: 'center', gap: 1,
                  borderBottom: `1px solid ${mutedBorder}`,
                  bgcolor: isDark ? 'rgba(48,54,61,0.15)' : 'rgba(0,0,0,0.02)',
                }}>
                  <PackageIcon size={14} weight="duotone" color={accentColor} />
                  <Typography variant="caption" sx={{ fontWeight: 600, fontSize: 11 }}>
                    工具操作
                  </Typography>
                  <Box sx={{ flex: 1 }} />
                  <Chip
                    icon={<PackageIcon size={10} weight="fill" />}
                    label={selectedPlugin.name}
                    size="small"
                    sx={{ height: 20, fontSize: 9, bgcolor: `${accentColor}15`, color: accentColor }}
                  />
                    </Box>
                    <Box sx={{ flex: 1, overflow: 'auto' }}>
                      <PluginRunner
                        plugin={selectedPlugin}
                        onToolResult={handleToolResult}
                      />
                    </Box>
                  </Box>

                  <Box sx={{
                    width: `${(1 - panelRatio) * 100}%`,
                    display: 'flex',
                    flexDirection: 'column',
                    overflow: 'hidden',
                    position: 'relative',
                  }}>
                    <Box sx={{
                      px: 2, py: 0.75, display: 'flex', alignItems: 'center', gap: 1,
                      borderBottom: `1px solid ${mutedBorder}`,
                      bgcolor: isDark ? 'rgba(48,54,61,0.15)' : 'rgba(0,0,0,0.02)',
                    }}>
                      <RobotIcon size={14} weight="duotone" color={accentColor} />
                      <Typography variant="caption" sx={{ fontWeight: 600, fontSize: 11 }}>
                        AI 分析
                      </Typography>
                      <FormControl size="small" sx={{ minWidth: 120, flex: 1 }}>
                        <Select
                          value={workshopAgentId || ''}
                          displayEmpty
                          onChange={(e) => {
                            const v = e.target.value;
                            setWorkshopAgentId(v || null);
                            if (v) { localStorage.setItem(WORKSHOP_AGENT_KEY, v); }
                            else { localStorage.removeItem(WORKSHOP_AGENT_KEY); }
                            setConversationId(null);
                            setMessages([]);
                          }}
                          renderValue={(selected) => {
                            if (!selected) return <Typography variant="caption" sx={{ color: 'text.secondary' }}>选择 Agent</Typography>;
                            const agent = agents.find((a) => a.id === selected);
                            return <Typography variant="caption" sx={{ fontWeight: 600 }}>{agent?.name || selected}</Typography>;
                          }}
                          sx={{
                            height: 26, fontSize: 11,
                            '& .MuiSelect-select': { py: 0.3, px: 1 },
                            bgcolor: isDark ? 'rgba(48,54,61,0.3)' : 'rgba(0,0,0,0.03)',
                          }}
                        >
                          {agents.map((agent) => (
                            <MenuItem key={agent.id} value={agent.id} sx={{ fontSize: 12, py: 0.5 }}>
                              {agent.name}
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                      {workshopAgentId && conversationId && (
                        <Tooltip title={t('workshop.new_chat')} arrow>
                          <IconButton size="small" onClick={handleNewChat} sx={{ borderRadius: 2, border: `1px solid ${accentColor}30` }}>
                            <PlusIcon size={12} weight="bold" color={accentColor} />
                          </IconButton>
                        </Tooltip>
                      )}
                      <Tooltip title="调整分栏比例" arrow>
                        <IconButton
                          size="small"
                          onClick={() => setPanelRatio((prev) => prev <= 0.4 ? 0.7 : prev - 0.15)}
                          sx={{ color: 'text.secondary' }}
                        >
                          <ArrowsLeftRightIcon size={14} />
                        </IconButton>
                      </Tooltip>
                    </Box>

                    {!workshopAgentId ? (
                      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2, p: 3 }}>
                        <RobotIcon size={32} weight="duotone" color={accentColor} />
                        <Typography variant="caption" sx={{ color: 'text.secondary', textAlign: 'center', fontWeight: 600 }}>
                          选择一个 AI Agent
                        </Typography>
                        <Typography variant="caption" sx={{ color: 'text.disabled', textAlign: 'center', maxWidth: 240, fontSize: 10 }}>
                          Agent 将分析你执行工具后的结果，提供见解和建议
                        </Typography>
                      </Box>
                    ) : (
                      <>
                        {compactionMessages.length > 0 && (
                          <Box sx={{ px: 2, py: 0.5, bgcolor: isDark ? 'rgba(255,183,77,0.08)' : 'rgba(230,81,0,0.04)', borderBottom: `1px solid ${mutedBorder}` }}>
                            {compactionMessages.map((msg, idx) => (
                              <Typography key={idx} variant="caption" sx={{ fontSize: 10, color: isDark ? '#FFB74D' : '#E65100', display: 'block', lineHeight: 1.5 }}>
                                ⚡ {msg}
                              </Typography>
                            ))}
                          </Box>
                        )}
                        {lastToolExecution && filteredScenarios.length > 0 && (
                          <Box sx={{ px: 1.5, py: 1, borderBottom: `1px solid ${mutedBorder}`, bgcolor: isDark ? 'rgba(48,54,61,0.1)' : 'rgba(0,0,0,0.01)' }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
                              <SparkleIcon size={12} weight="duotone" color={accentColor} />
                              <Typography variant="caption" sx={{ fontWeight: 600, fontSize: 9, color: 'text.secondary' }}>
                                分析提示词
                              </Typography>
                              <Box sx={{ flex: 1 }} />
                              {(['all', 'practical', 'creative', 'combination'] as const).map((cat) => {
                                const isActive = activeCategory === cat;
                                const label = cat === 'all' ? '全部' : cat === 'practical' ? '实用' : cat === 'creative' ? '创意' : '组合';
                                return (
                                  <Chip
                                    key={cat}
                                    label={label}
                                    size="small"
                                    onClick={() => setActiveCategory(cat)}
                                    sx={{
                                      height: 18, fontSize: 8, minWidth: 0, cursor: 'pointer',
                                      bgcolor: isActive
                                        ? (isDark ? 'rgba(79,195,247,0.2)' : 'rgba(2,136,209,0.1)')
                                        : 'transparent',
                                      border: `1px solid ${isActive ? accentColor : 'transparent'}`,
                                      color: isActive ? accentColor : 'text.secondary',
                                      '&:hover': { bgcolor: isDark ? 'rgba(79,195,247,0.15)' : 'rgba(2,136,209,0.08)' },
                                    }}
                                  />
                                );
                              })}
                              <Button
                                size="small"
                                startIcon={generating ? <CircularProgress size={10} /> : <ArrowsClockwiseIcon size={10} />}
                                onClick={() => handleGenerateScenarios(selectedPlugin.id, activeCategory === 'all' ? undefined : activeCategory, true)}
                                disabled={generating}
                                sx={{ textTransform: 'none', fontSize: 9, minWidth: 0, py: 0, color: accentColor }}
                              >
                                {generating ? '生成中...' : '换一批'}
                              </Button>
                            </Box>
                            {error && (
                              <Alert severity="error" sx={{ py: 0, px: 1, mb: 0.5, fontSize: 9, '& .MuiAlert-message': { fontSize: 9 } }}>
                                {error}
                              </Alert>
                            )}
                            <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                              {filteredScenarios.slice(0, 5).map((scenario) => {
                                const meta = CATEGORY_META[scenario.category as Category] || CATEGORY_META.practical;
                                const Icon = meta.icon;
                                return (
                                  <Chip
                                    key={scenario.name}
                                    icon={<Icon size={10} color={isDark ? meta.darkColor : meta.color} />}
                                    label={scenario.examplePrompt.length > 30 ? scenario.examplePrompt.slice(0, 30) + '...' : scenario.examplePrompt}
                                    size="small"
                                    onClick={() => handleScenarioClick(scenario.examplePrompt, scenario.toolName, selectedPlugin)}
                                    sx={{
                                      height: 'auto', minHeight: 22, fontSize: 9, maxWidth: '100%',
                                      cursor: 'pointer',
                                      bgcolor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
                                      '& .MuiChip-label': { whiteSpace: 'normal', lineHeight: 1.3, py: 0.3 },
                                      '&:hover': { bgcolor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)' },
                                    }}
                                  />
                                );
                              })}
                            </Box>
                          </Box>
                        )}
                        <Box sx={{ flex: 1, overflow: 'auto' }}>
                          <ChatMessagesArea
                            messages={messages}
                            streamingContent={streamingContent}
                            streamingMsgId={streamingMsgIdRef.current}
                            loading={loading}
                            toolCalls={toolCalls}
                            agentColor={accentColor}
                            userColor={isDark ? '#6C63FF' : '#5B54E0'}
                            isDark={isDark}
                            emptyText="执行左侧工具后，结果将自动发送给 AI 分析。你也可以直接提问。"
                            thinkingText={t('workshop.thinking')}
                          />
                        </Box>
                        <ChatInputArea
                          input={input}
                          setInput={setInput}
                          handleSend={handleSend}
                          handleKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                          loading={loading}
                          conversationId={conversationId}
                          agentColor={accentColor}
                          userColor={isDark ? '#6C63FF' : '#5B54E0'}
                          isDark={isDark}
                          placeholder="向 AI 提问关于工具执行结果的问题..."
                          onStop={handleStop}
                          attachments={attachments}
                          onAttachmentsChange={setAttachments}
                        />
                      </>
                    )}
                  </Box>
                </Box>
              )}
            </Box>
      </Box>

      <Dialog
        open={permissionRequest !== null}
        onClose={() => handlePermissionResponse(false, false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <ShieldWarningIcon size={20} weight="fill" color="#FF9800" />
          Permission Request
        </DialogTitle>
        <DialogContent>
          {permissionRequest && (
            <Box sx={{ pt: 1 }}>
              <Alert severity={permissionRequest.riskLevel === 'high' ? 'warning' : 'info'} sx={{ mb: 2, '& .MuiAlert-message': { whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: '0.8rem' } }}>
                {permissionRequest.description}
              </Alert>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                Tool: <strong>{permissionRequest.toolName}</strong>
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                Risk Level: <Chip
                  label={permissionRequest.riskLevel}
                  size="small"
                  color={permissionRequest.riskLevel === 'high' ? 'warning' : 'info'}
                  sx={{ textTransform: 'capitalize' }}
                />
              </Typography>
              {permissionRequest.arguments && Object.keys(permissionRequest.arguments).length > 0 && (
                <Box sx={{ mt: 1, p: 1, borderRadius: 1, bgcolor: 'action.hover' }}>
                  <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
                    {JSON.stringify(permissionRequest.arguments, null, 2)}
                  </Typography>
                </Box>
              )}
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2, gap: 1 }}>
          <Button onClick={() => handlePermissionResponse(false, false)} color="inherit">
            Deny
          </Button>
          <Button onClick={() => handlePermissionResponse(true, true)} color="info" variant="outlined">
            Always Allow
          </Button>
          <Button onClick={() => handlePermissionResponse(true, false)} color="primary" variant="contained" autoFocus>
            Allow Once
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

function WorkshopPluginList({ plugins, selectedPlugin, accentColor, mutedBorder, scenarioCache, onSelectPlugin, t }: {
  plugins: PluginManifest[];
  selectedPlugin: PluginManifest | null;
  accentColor: string;
  isDark: boolean;
  mutedBorder: string;
  scenarioCache: ScenarioCache;
  onSelectPlugin: (plugin: PluginManifest) => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const { groups, loadGroups, savePlugin } = usePluginStore();
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
  const [groupManageOpen, setGroupManageOpen] = useState(false);
  const [logManagerOpen, setLogManagerOpen] = useState(false);
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [assignPluginId, setAssignPluginId] = useState<string | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState('');

  useEffect(() => { loadGroups(); }, [loadGroups]);

  const pluginsWithGroup = plugins.filter((p) => p.groupId && groups.some((g) => g.id === p.groupId));
  const ungroupedPlugins = plugins.filter((p) => !p.groupId || !groups.some((g) => g.id === p.groupId));

  const handleAssignGroup = (pluginId: string) => {
    setAssignPluginId(pluginId);
    const plugin = plugins.find((p) => p.id === pluginId);
    setSelectedGroupId(plugin?.groupId || '');
    setAssignDialogOpen(true);
  };

  const handleSaveAssign = async () => {
    if (!assignPluginId) return;
    const plugin = plugins.find((p) => p.id === assignPluginId);
    if (plugin) {
      await savePlugin({ ...plugin, groupId: selectedGroupId, category: '' });
    }
    setAssignDialogOpen(false);
  };

  const renderPluginCard = (plugin: PluginManifest) => (
    <Paper
      key={plugin.id}
      variant="outlined"
      onClick={() => onSelectPlugin(plugin)}
      sx={{
        p: 1, mb: 0.5, borderRadius: 1.5, cursor: 'pointer',
        borderColor: selectedPlugin?.id === plugin.id ? `${accentColor}50` : mutedBorder,
        bgcolor: selectedPlugin?.id === plugin.id ? `${accentColor}08` : 'transparent',
        transition: 'all 0.15s',
        '&:hover': { borderColor: `${accentColor}30` },
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
        <PackageIcon size={14} weight="fill" color={accentColor} />
        <Typography variant="caption" sx={{ fontWeight: 600, fontSize: 11, flex: 1 }} noWrap>
          {plugin.name}
        </Typography>
        <Tooltip title={t('plugin_page.assign_group') as string} arrow>
          <IconButton size="small" onClick={(e) => { e.stopPropagation(); handleAssignGroup(plugin.id); }} sx={{ p: 0.15 }}>
            <TagIcon size={11} />
          </IconButton>
        </Tooltip>
        <Typography variant="caption" sx={{ fontSize: 9, color: 'text.secondary' }}>
          v{plugin.version}
        </Typography>
      </Box>
      <Typography variant="caption" sx={{ fontSize: 9, color: 'text.secondary', display: 'block', mt: 0.25 }} noWrap>
        {plugin.description}
      </Typography>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.25 }}>
        <Typography variant="caption" sx={{ fontSize: 8, color: 'text.disabled' }}>
          {plugin.tools.length} 工具
        </Typography>
        {(scenarioCache[plugin.id]?.length || plugin.scenarios?.length || 0) > 0 && (
          <Typography variant="caption" sx={{ fontSize: 8, color: accentColor }}>
            · {scenarioCache[plugin.id]?.length || plugin.scenarios?.length || 0} 场景
          </Typography>
        )}
      </Box>
    </Paper>
  );

  return (
    <Box sx={{ flex: 1, overflow: 'auto', px: 0.5, '&::-webkit-scrollbar': { width: 4 } }}>
      <Box sx={{ display: 'flex', alignItems: 'center', px: 0.5, py: 0.3, mb: 0.5 }}>
        <Typography variant="caption" sx={{ fontWeight: 600, fontSize: 10, color: 'text.secondary', flex: 1 }}>
          {t('plugin_page.installed_plugins') as string}
        </Typography>
        <Tooltip title={t('plugin_page.add_group') as string} arrow>
          <IconButton size="small" onClick={() => setGroupManageOpen(true)} sx={{ p: 0.15 }}>
            <FolderSimplePlusIcon size={12} />
          </IconButton>
        </Tooltip>
        <Tooltip title="日志管理" arrow>
          <IconButton size="small" onClick={() => setLogManagerOpen(true)} sx={{ p: 0.15 }}>
            <DatabaseIcon size={12} />
          </IconButton>
        </Tooltip>
      </Box>
      {groups.map((group) => {
        const groupPlugins = pluginsWithGroup.filter((p) => p.groupId === group.id);
        if (groupPlugins.length === 0 && group.id !== expandedGroup) return null;
        const isExpanded = expandedGroup === group.id;
        return (
          <Box key={group.id} sx={{ mb: 0.5 }}>
            <Box
              onClick={() => setExpandedGroup(isExpanded ? null : group.id)}
              sx={{
                display: 'flex', alignItems: 'center', gap: 0.5, px: 0.5, py: 0.4,
                borderRadius: 1, cursor: 'pointer',
                bgcolor: isExpanded ? `${group.color}12` : 'transparent',
                '&:hover': { bgcolor: `${group.color}18` },
              }}
            >
              <IconRenderer value={group.icon} size={13} sx={{ width: 18, height: 18, borderRadius: 1, bgcolor: `${group.color}18` }} />
              <Typography variant="caption" sx={{ fontWeight: 600, fontSize: 11, flex: 1, color: isExpanded ? group.color : 'text.primary' }} noWrap>
                {group.name}
              </Typography>
              <Typography variant="caption" sx={{ fontSize: 10, color: 'text.secondary', mr: 0.5 }}>
                {groupPlugins.length}
              </Typography>
              {isExpanded ? <CaretDownIcon size={10} /> : <CaretRightIcon size={10} />}
            </Box>
            {isExpanded && groupPlugins.map(renderPluginCard)}
          </Box>
        );
      })}
      {ungroupedPlugins.length > 0 && (
        <>
          {groups.length > 0 && (
            <Box sx={{ px: 0.5, py: 0.3 }}>
              <Typography variant="caption" sx={{ fontSize: 10, color: 'text.disabled', fontWeight: 600 }}>
                {t('plugin_page.ungrouped') as string}
              </Typography>
            </Box>
          )}
          {ungroupedPlugins.map(renderPluginCard)}
        </>
      )}

      <PluginGroupManageDialog open={groupManageOpen} onClose={() => setGroupManageOpen(false)} />
      <UsageLogManagerDialog open={logManagerOpen} onClose={() => setLogManagerOpen(false)} />

      <Dialog open={assignDialogOpen} onClose={() => setAssignDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('plugin_page.assign_group') as string}</DialogTitle>
        <DialogContent sx={{ pt: '16px !important' }}>
          <FormControl fullWidth size="small">
            <InputLabel>{t('plugin_page.assign_group') as string}</InputLabel>
            <Select
              value={selectedGroupId}
              label={t('plugin_page.assign_group') as string}
              onChange={(e) => setSelectedGroupId(e.target.value)}
            >
              <MenuItem value="">{t('plugin_page.no_group') as string}</MenuItem>
              {groups.map((g) => (
                <MenuItem key={g.id} value={g.id}>
                  {g.icon} {g.name}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAssignDialogOpen(false)}>取消</Button>
          <Button onClick={handleSaveAssign} variant="contained">确定</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
