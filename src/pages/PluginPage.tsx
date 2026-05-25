import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Box, Typography, Divider, Chip, IconButton, Paper,
  List, ListItemButton, ListItemText, ListItemIcon, Switch, Tooltip,
  Dialog, DialogTitle, DialogContent, DialogActions, Button,
  Select, MenuItem, FormControl, InputLabel, Snackbar, Alert,
} from '@mui/material';
import {
  PackageIcon, RobotIcon,
  SparkleIcon, TrashIcon, WrenchIcon, PlusIcon, LightningIcon, ArrowUpIcon, CodeIcon,
  CaretDownIcon, CaretRightIcon, CaretLeftIcon,
  FolderSimplePlusIcon, TagIcon, WarningIcon,
} from '@phosphor-icons/react';
import { usePluginStore } from '../features/agent/store/pluginStore';
import { PluginGroupManageDialog } from '../features/agent/components/PluginGroupManageDialog';
import { IconRenderer } from '../components/icon/IconRenderer';
import { openPluginWorkshopWindow, openPluginScriptViewerWindow } from '../core/services/window.service';
import { PluginRunner } from '../features/agent/components/plugin/PluginRunner';
import { useAgentStore } from '../features/agent/store/agentStore';
import { getPluginAssistantAgentId } from '../features/agent/components/PluginAssistantTab';
import { runAgent, saveMessage, listMessages, createConversation, listConversations, stopAgent, respondPermission, writeFrontendLog } from '../core/services/agent.service';
import type { MessageDto } from '../proto/agent';
import { listen } from '@tauri-apps/api/event';
import { useTheme } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';
import { ChatMessagesArea, ChatInputArea, type FileAttachment } from '../components/chat/ChatComponents';
import type { ToolCallDisplay } from '../components/chat/ChatComponents';
import type { PluginManifest } from '../proto/plugin';
import { listPluginUsageLogs } from '../core/services/plugin.service';

/** Sanitize an example prompt to remove system instructions and absolute paths */
interface StreamChunk { conversationId: string; chunk: string }
interface StreamDone { conversationId: string; response: string }
interface StreamError { conversationId: string; error: string }
interface ToolCallEvent {
  tool_name: string;
  arguments: Record<string, unknown>;
  result: string | null;
  success: boolean | null;
  status: 'running' | 'done' | 'denied';
}
interface ToolCallPayload { conversationId: string; toolCall: ToolCallEvent }

export function PluginPage() {
  const { t } = useTranslation('agent');
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const accentColor = isDark ? '#4FC3F7' : '#0288D1';
  const agentColor = isDark ? '#4FC3F7' : '#0288D1';
  const userColor = isDark ? '#6C63FF' : '#5B54E0';
  const mutedBorder = isDark ? 'rgba(48,54,61,0.6)' : 'rgba(0,0,0,0.08)';
  const successColor = isDark ? '#81C784' : '#2E7D32';

  const { plugins, loadPlugins, togglePlugin, deletePlugin } = usePluginStore();
  const { agents, models, loadAgents, loadModels } = useAgentStore();

  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<FileAttachment[]>([]);
  const [loading, setLoading] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [messages, setMessages] = useState<MessageDto[]>([]);
  const [toolCalls, setToolCalls] = useState<ToolCallDisplay[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [deletePluginId, setDeletePluginId] = useState<string | null>(null);
  const [runnerPlugin, setRunnerPlugin] = useState<PluginManifest | null>(null);
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' | 'warning' | 'info' }>({
    open: false, message: '', severity: 'info',
  });
  const [compactionMessages, setCompactionMessages] = useState<string[]>([]);
  const [permissionRequest, setPermissionRequest] = useState<{
    conversationId: string;
    toolName: string;
    arguments: Record<string, unknown>;
    riskLevel: 'low' | 'high';
    description: string;
  } | null>(null);
  const [ready, setReady] = useState(false); // guards against race between initConversation and handleSend
  const initGenerationRef = useRef(0); // generation counter to abort stale initConversation calls
  const streamingMsgIdRef = useRef<string | null>(null);
  const toolCallCounterRef = useRef(0);

  const boundAgentId = getPluginAssistantAgentId();
  const boundAgent = agents.find((a) => a.id === boundAgentId);
  const boundModel = boundAgent ? models.find((m) => m.id === boundAgent.modelId) : null;

  useEffect(() => {
    writeFrontendLog('info', 'PluginPage', `boundAgentId changed: ${boundAgentId || '(null)'}, conversationId=${conversationId || '(null)'}`);
  }, [boundAgentId]);

  useEffect(() => {
    loadPlugins();
    loadAgents();
    loadModels();
  }, [loadPlugins, loadAgents, loadModels]);

  useEffect(() => {
    if (!boundAgentId) return;

    setReady(false);
    const generation = ++initGenerationRef.current;

    const initConversation = async () => {
      writeFrontendLog('info', 'PluginPage', `initConversation start, boundAgentId=${boundAgentId}, generation=${generation}`);
      try {
        const convs = await listConversations(boundAgentId);
        // Abort if a newer initConversation has started
        if (initGenerationRef.current !== generation) {
          writeFrontendLog('warn', 'PluginPage', `initConversation aborted (stale generation), current=${initGenerationRef.current}, expected=${generation}`);
          return;
        }

        const matchingConv = convs.find((c) => {
          try {
            const meta = JSON.parse(c.metadata || '{}');
            return meta.source === 'plugin_page';
          } catch { return false; }
        });

        if (matchingConv) {
          writeFrontendLog('info', 'PluginPage', `found existing conversation: id=${matchingConv.id}`);
          setConversationId(matchingConv.id);
          const msgs = await listMessages(matchingConv.id);
          // Abort if a newer initConversation has started
          if (initGenerationRef.current !== generation) {
            writeFrontendLog('warn', 'PluginPage', `initConversation aborted after listMessages (stale generation)`);
            return;
          }
          writeFrontendLog('info', 'PluginPage', `loaded ${msgs.length} messages for conversation ${matchingConv.id}`);
          setMessages(msgs);
        } else {
          const conv = await createConversation(boundAgentId, t('plugin_assistant.title'), {
            source: 'plugin_page',
          });
          // Abort if a newer initConversation has started
          if (initGenerationRef.current !== generation) {
            writeFrontendLog('warn', 'PluginPage', `initConversation aborted after createConversation (stale generation)`);
            return;
          }
          writeFrontendLog('info', 'PluginPage', `created new conversation: id=${conv.id}`);
          setConversationId(conv.id);
          setMessages([]);
        }
      } catch (e) {
        writeFrontendLog('error', 'PluginPage', `initConversation failed: ${String(e)}`);
      } finally {
        // Only set ready if we're still the latest generation
        if (initGenerationRef.current === generation) {
          writeFrontendLog('info', 'PluginPage', `initConversation done, ready=true, conversationId will be set`);
          setReady(true);
        }
      }
    };
    initConversation();
  }, [boundAgentId]);

  useEffect(() => {
    if (!conversationId) return;

    writeFrontendLog('info', 'PluginPage', `setting up event listeners for conversationId=${conversationId}`);

    const unlistenChunk = listen<StreamChunk>('agent-chunk', (event) => {
      if (event.payload.conversationId === conversationId) {
        setStreamingContent((prev) => prev + event.payload.chunk);
      }
    });

    const unlistenDone = listen<StreamDone>('agent-done', async (event) => {
      writeFrontendLog('info', 'PluginPage', `agent-done received, convId=${event.payload.conversationId}, currentConvId=${conversationId}, response_len=${event.payload.response?.length ?? 0}`);
      if (event.payload.conversationId === conversationId) {
        const msgId = streamingMsgIdRef.current;
        writeFrontendLog('info', 'PluginPage', `agent-done matches, streamingMsgId=${msgId}`);
        if (msgId) {
          setMessages((prev) => prev.map((m) => m.id === msgId ? { ...m, content: event.payload.response } : m));
        }
        // Reload all messages from DB to include tool messages saved by backend
        if (event.payload.conversationId) {
          try {
            const allMsgs = await listMessages(event.payload.conversationId);
            writeFrontendLog('info', 'PluginPage', `reloaded ${allMsgs.length} messages from DB after agent-done`);
            if (allMsgs.length > 0) {
              setMessages(allMsgs);
            } else {
              writeFrontendLog('warn', 'PluginPage', `listMessages returned 0 messages after agent-done, keeping current messages to avoid page blank`);
            }
          } catch (e) {
            writeFrontendLog('error', 'PluginPage', `failed to reload messages after agent-done: ${String(e)}`);
          }
        }
        setStreamingContent('');
        setLoading(false);
        streamingMsgIdRef.current = null;
        loadPlugins();
      } else {
        writeFrontendLog('warn', 'PluginPage', `agent-done convId mismatch: event=${event.payload.conversationId}, current=${conversationId}`);
      }
    });

    const unlistenError = listen<StreamError>('agent-error', (event) => {
      writeFrontendLog('error', 'PluginPage', `agent-error received, convId=${event.payload.conversationId}, error=${event.payload.error}`);
      if (event.payload.conversationId === conversationId) {
        const msgId = streamingMsgIdRef.current;
        if (msgId) {
          setMessages((prev) => prev.map((m) => m.id === msgId ? { ...m, content: `❌ ${event.payload.error}` } : m));
        }
        setStreamingContent('');
        setLoading(false);
        streamingMsgIdRef.current = null;
      }
    });

    const unlistenToolCall = listen<ToolCallPayload>('agent-tool-call', (event) => {
      if (event.payload.conversationId === conversationId) {
        const tc = event.payload.toolCall;
        if (tc.status === 'running') {
          writeFrontendLog('info', 'PluginPage', `tool_call running: ${tc.tool_name}`);
          toolCallCounterRef.current += 1;
          const id = `tc-${toolCallCounterRef.current}`;
          setToolCalls((prev) => [...prev, {
            id, toolName: tc.tool_name, arguments: tc.arguments,
            result: null, success: null, status: 'running',
          }]);
        } else if (tc.status === 'denied') {
          writeFrontendLog('warn', 'PluginPage', `tool_call denied: ${tc.tool_name}`);
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
          writeFrontendLog('info', 'PluginPage', `tool_call done: ${tc.tool_name}, success=${tc.success}`);
          setToolCalls((prev) => {
            const last = prev.length - 1;
            if (last >= 0 && prev[last].status === 'running') {
              const updated = [...prev];
              updated[last] = { ...updated[last], result: tc.result, success: tc.success, status: 'done' };
              return updated;
            }
            return prev;
          });
          if (tc.tool_name === 'plugin_manager' && tc.success) {
            loadPlugins();
          }
        }
      }
    });

    const unlistenCompaction = listen<{ conversationId: string; message: string }>('agent-compaction', (event) => {
      if (event.payload.conversationId === conversationId) {
        writeFrontendLog('info', 'PluginPage', `compaction: ${event.payload.message}`);
        setCompactionMessages((prev) => [...prev, event.payload.message]);
      }
    });

    const unlistenPermission = listen<{
      conversationId: string;
      toolName: string;
      arguments: Record<string, unknown>;
      riskLevel: 'low' | 'high';
      description: string;
    }>('agent-permission-request', (event) => {
      if (event.payload.conversationId === conversationId) {
        writeFrontendLog('info', 'PluginPage', `permission request: tool=${event.payload.toolName}, risk=${event.payload.riskLevel}`);
        setPermissionRequest(event.payload);
      }
    });

    return () => {
      writeFrontendLog('info', 'PluginPage', `cleaning up event listeners for conversationId=${conversationId}`);
      unlistenChunk.then((fn) => fn());
      unlistenDone.then((fn) => fn());
      unlistenError.then((fn) => fn());
      unlistenToolCall.then((fn) => fn());
      unlistenCompaction.then((fn) => fn());
      unlistenPermission.then((fn) => fn());
    };
  }, [conversationId, loadPlugins]);

  const handleSend = useCallback(async () => {
    if (!input.trim() || !conversationId || !boundAgentId) {
      writeFrontendLog('warn', 'PluginPage', `handleSend blocked: input=${!!input.trim()}, conversationId=${conversationId}, boundAgentId=${boundAgentId}`);
      return;
    }
    if (!ready) {
      writeFrontendLog('warn', 'PluginPage', `handleSend blocked: not ready yet`);
      return;
    }

    writeFrontendLog('info', 'PluginPage', `handleSend: sending message, conversationId=${conversationId}, boundAgentId=${boundAgentId}`);

    let messageContent = input.trim();
    if (attachments.length > 0) {
      const attachmentText = attachments.map((f) => `[附件: ${f.path}]`).join('\n');
      messageContent = `${attachmentText}\n\n${messageContent}`;
    }

    const userMsg: MessageDto = {
      id: crypto.randomUUID(), conversationId, role: 'user',
      content: messageContent, toolCalls: '', isError: 0, createdAt: Date.now(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setAttachments([]);
    setLoading(true);
    setToolCalls([]);
    setCompactionMessages([]);
    toolCallCounterRef.current = 0;

    try { await saveMessage(userMsg); } catch (e) {
      writeFrontendLog('error', 'PluginPage', `saveMessage failed for user msg: ${String(e)}`);
    }

    const assistantMsgId = crypto.randomUUID();
    streamingMsgIdRef.current = assistantMsgId;

    const assistantMsg: MessageDto = {
      id: assistantMsgId, conversationId, role: 'assistant',
      content: '', toolCalls: '', isError: 0, createdAt: Date.now(),
    };
    setMessages((prev) => [...prev, assistantMsg]);
    setStreamingContent('');

    try {
      writeFrontendLog('info', 'PluginPage', `calling runAgent, agentId=${boundAgentId}, convId=${conversationId}`);
      await runAgent(boundAgentId, messageContent, conversationId);
      writeFrontendLog('info', 'PluginPage', `runAgent call completed (streaming will continue via events)`);
    } catch (e) {
      writeFrontendLog('error', 'PluginPage', `runAgent call failed: ${String(e)}`);
      setMessages((prev) => prev.map((m) => m.id === assistantMsgId ? { ...m, content: `❌ ${String(e)}` } : m));
      setStreamingContent('');
      setLoading(false);
      streamingMsgIdRef.current = null;
    }
  }, [input, conversationId, boundAgentId, ready]);

  const sendMessage = useCallback(async (content: string) => {
    if (!content.trim() || !conversationId || !boundAgentId || !ready) return;

    const userMsg: MessageDto = {
      id: crypto.randomUUID(), conversationId, role: 'user',
      content: content.trim(), toolCalls: '', isError: 0, createdAt: Date.now(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);
    setToolCalls([]);
    setCompactionMessages([]);
    toolCallCounterRef.current = 0;

    try { await saveMessage(userMsg); } catch (e) {
      writeFrontendLog('error', 'PluginPage', `saveMessage failed: ${String(e)}`);
    }

    const assistantMsgId = crypto.randomUUID();
    streamingMsgIdRef.current = assistantMsgId;

    const assistantMsg: MessageDto = {
      id: assistantMsgId, conversationId, role: 'assistant',
      content: '', toolCalls: '', isError: 0, createdAt: Date.now(),
    };
    setMessages((prev) => [...prev, assistantMsg]);
    setStreamingContent('');

    try {
      await runAgent(boundAgentId, content.trim(), conversationId);
    } catch (e) {
      setMessages((prev) => prev.map((m) => m.id === assistantMsgId ? { ...m, content: `❌ ${String(e)}` } : m));
      setStreamingContent('');
      setLoading(false);
      streamingMsgIdRef.current = null;
    }
  }, [conversationId, boundAgentId, ready]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleStop = async () => {
    if (conversationId) {
      writeFrontendLog('info', 'PluginPage', `handleStop: stopping agent, convId=${conversationId}`);
      try {
        await stopAgent(conversationId);
      } catch (e) {
        writeFrontendLog('error', 'PluginPage', `handleStop failed: ${String(e)}`);
      }
    }
    setLoading(false);
    setStreamingContent('');
    streamingMsgIdRef.current = null;
  };

  const handleNewChat = async () => {
    if (!boundAgentId) return;
    writeFrontendLog('info', 'PluginPage', `handleNewChat: creating new conversation`);
    try {
      const conv = await createConversation(boundAgentId, t('plugin_assistant.title'), {
        source: 'plugin_page',
      });
      writeFrontendLog('info', 'PluginPage', `handleNewChat: new conversation created, id=${conv.id}`);
      setConversationId(conv.id);
      setMessages([]);
      setCompactionMessages([]);
    } catch (e) {
      writeFrontendLog('error', 'PluginPage', `handleNewChat failed: ${String(e)}`);
    }
  };

  const handlePermissionResponse = async (approved: boolean, alwaysAllow: boolean) => {
    if (permissionRequest) {
      try {
        await respondPermission(permissionRequest.conversationId, approved, alwaysAllow);
      } catch (err) { console.error('PluginPage: operation failed', err); }
      setPermissionRequest(null);
    }
  };

  const handleDeletePlugin = (id: string) => {
    setDeletePluginId(id);
  };

  const executeDeletePlugin = async () => {
    if (!deletePluginId) return;
    await deletePlugin(deletePluginId);
    setDeletePluginId(null);
  };

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', px: 2, py: 1 }}>
        <PackageIcon size={20} weight="duotone" color={accentColor} />
        <Typography variant="subtitle2" sx={{ flex: 1, fontSize: 14, fontWeight: 700, ml: 1 }}>
          {t('plugin_page.title')}
        </Typography>
      </Box>
      <Divider sx={{ borderColor: mutedBorder }} />
      <Box sx={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <PluginSidebar
          plugins={plugins}
          onToggle={togglePlugin}
          onDelete={handleDeletePlugin}
          accentColor={accentColor}
          successColor={successColor}
          isDark={isDark}
          onRefineClick={async (pluginId, pluginName) => {
            if (!boundAgentId) {
              setSnackbar({ open: true, message: t('plugin_page.no_agent_bound'), severity: 'warning' });
              return;
            }
            let logContext = '';
            try {
              const logs = await listPluginUsageLogs(pluginId, 10);
              if (logs && logs.length > 0) {
                const failLogs = logs.filter(l => !l.success);
                const successLogs = logs.filter(l => l.success);
                logContext = '\n\n## 使用日志摘要\n';
                logContext += `- 最近执行: ${logs.length} 次，成功 ${successLogs.length} 次，失败 ${failLogs.length} 次\n`;
                if (failLogs.length > 0) {
                  logContext += '- 失败记录:\n';
                  failLogs.slice(0, 5).forEach(l => {
                    logContext += `  * [${l.toolName}] source=${l.source} duration=${l.durationMs}ms params: ${l.paramsSummary}\n`;
                    if (l.errorMessage) logContext += `    错误: ${l.errorMessage.slice(0, 200)}\n`;
                  });
                }
                if (successLogs.length > 0) {
                  const avgDuration = Math.round(successLogs.reduce((s, l) => s + l.durationMs, 0) / successLogs.length);
                  logContext += `- 成功平均耗时: ${avgDuration}ms\n`;
                  successLogs.slice(0, 3).forEach(l => {
                    if (l.outputSummary) logContext += `  * [${l.toolName}] 输出: ${l.outputSummary.slice(0, 150)}\n`;
                  });
                }
                logContext += '\n请根据以上使用日志数据，重点修复失败问题并优化性能。';
              }
            } catch (err) { console.error('PluginPage: operation failed', err); }
            const prompt = t('plugin_page.refine_prompt', { name: pluginName, id: pluginId }) + logContext;
            sendMessage(prompt);
          }}
          onViewScript={(plugin) => openPluginScriptViewerWindow(plugin.id, plugin.name)}
          onRunPlugin={(plugin) => setRunnerPlugin(plugin)}
        />
        <Divider orientation="vertical" sx={{ borderColor: mutedBorder }} />
        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          {runnerPlugin ? (
            <>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 1, borderBottom: `1px solid ${mutedBorder}` }}>
                <IconButton size="small" onClick={() => setRunnerPlugin(null)} sx={{ color: 'text.secondary' }}>
                  <CaretLeftIcon size={16} />
                </IconButton>
                <LightningIcon size={16} weight="duotone" color={successColor} />
                <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>{runnerPlugin.name}</Typography>
                <Typography variant="caption" color="text.secondary">{t('plugin_page.runner_mode', 'Runner Mode')}</Typography>
              </Box>
              <Box sx={{ flex: 1, overflow: 'auto' }}>
                <PluginRunner plugin={runnerPlugin} onRefine={async (pluginId, pluginName, suggestion) => {
                  if (!boundAgentId) {
                    setSnackbar({ open: true, message: t('plugin_page.no_agent_bound'), severity: 'warning' });
                    return;
                  }
                  let logContext = '';
                  try {
                    const logs = await listPluginUsageLogs(pluginId, 10);
                    if (logs && logs.length > 0) {
                      const failLogs = logs.filter(l => !l.success);
                      const successLogs = logs.filter(l => l.success);
                      logContext = '\n\n## 使用日志摘要\n';
                      logContext += `- 最近执行: ${logs.length} 次，成功 ${successLogs.length} 次，失败 ${failLogs.length} 次\n`;
                      if (failLogs.length > 0) {
                        logContext += '- 失败记录:\n';
                        failLogs.slice(0, 5).forEach(l => {
                          logContext += `  * [${l.toolName}] source=${l.source} duration=${l.durationMs}ms params: ${l.paramsSummary}\n`;
                          if (l.errorMessage) logContext += `    错误: ${l.errorMessage.slice(0, 200)}\n`;
                        });
                      }
                      if (successLogs.length > 0) {
                        const avgDuration = Math.round(successLogs.reduce((s, l) => s + l.durationMs, 0) / successLogs.length);
                        logContext += `- 成功平均耗时: ${avgDuration}ms\n`;
                      }
                      logContext += '\n请根据以上使用日志数据，重点修复失败问题并优化性能。';
                    }
                  } catch (err) { console.error('PluginPage: operation failed', err); }
                  const prompt = (suggestion || t('plugin_page.refine_prompt', { name: pluginName, id: pluginId })) + logContext;
                  sendMessage(prompt);
                }} />
              </Box>
            </>
          ) : !boundAgentId ? (
            <NoAgentBound />
          ) : (
            <>
              <ChatHeader
                agent={boundAgent}
                model={boundModel}
                onNewChat={handleNewChat}
                accentColor={accentColor}
                isDark={isDark}
                agentColor={agentColor}
              />
              <Divider sx={{ borderColor: mutedBorder }} />
              {compactionMessages.length > 0 && (
                <Box sx={{ px: 2, py: 0.5, bgcolor: isDark ? 'rgba(255,183,77,0.08)' : 'rgba(230,81,0,0.04)', borderBottom: `1px solid ${mutedBorder}` }}>
                  {compactionMessages.map((msg, idx) => (
                    <Typography key={idx} variant="caption" sx={{ fontSize: 10, color: isDark ? '#FFB74D' : '#E65100', display: 'block', lineHeight: 1.5 }}>
                      ⚡ {msg}
                    </Typography>
                  ))}
                </Box>
              )}
              <ChatMessagesArea
                messages={messages}
                streamingContent={streamingContent}
                streamingMsgId={streamingMsgIdRef.current}
                loading={loading}
                toolCalls={toolCalls}
                agentColor={agentColor}
                userColor={userColor}
                isDark={isDark}
                emptyIcon={<PackageIcon size={40} weight="duotone" color={agentColor} />}
                emptyText={t('plugin_page.empty_hint')}
                thinkingText={t('plugin_page.thinking')}
              />
              <ChatInputArea
                input={input}
                setInput={setInput}
                handleSend={handleSend}
                handleKeyDown={handleKeyDown}
                loading={loading}
                conversationId={conversationId}
                agentName={boundAgent?.name}
                agentColor={agentColor}
                userColor={userColor}
                isDark={isDark}
                placeholder={t('plugin_page.input_placeholder')}
                onStop={handleStop}
                attachments={attachments}
                onAttachmentsChange={setAttachments}
              />
            </>
          )}
        </Box>
      </Box>

      <Dialog open={!!deletePluginId} onClose={() => setDeletePluginId(null)} maxWidth="xs">
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <WarningIcon size={20} color="#FF8A80" />
          {t('plugin_page.delete_confirm')}
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            {t('plugin_page.delete_plugin_message', { name: plugins.find((p) => p.id === deletePluginId)?.name || '' })}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeletePluginId(null)}>
            {t('agent.cancel')}
          </Button>
          <Button
            onClick={executeDeletePlugin}
            color="error"
            variant="contained"
            startIcon={<TrashIcon size={14} />}
            sx={{ bgcolor: '#FF5252', '&:hover': { bgcolor: '#D32F2F' } }}
          >
            {t('agent.delete')}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={permissionRequest !== null}
        onClose={() => handlePermissionResponse(false, false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <WarningIcon size={20} color="#FF9800" />
          {t('plugin_page.permission_request')}
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
                Risk Level: <Chip label={permissionRequest.riskLevel} size="small" color={permissionRequest.riskLevel === 'high' ? 'warning' : 'info'} sx={{ textTransform: 'capitalize' }} />
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
            {t('plugin_page.deny')}
          </Button>
          <Button onClick={() => handlePermissionResponse(true, true)} color="info" variant="outlined">
            {t('plugin_page.always_allow')}
          </Button>
          <Button onClick={() => handlePermissionResponse(true, false)} color="primary" variant="contained" autoFocus>
            {t('plugin_page.allow_once')}
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={snackbar.open}
        autoHideDuration={4000}
        onClose={() => setSnackbar((prev) => ({ ...prev, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          onClose={() => setSnackbar((prev) => ({ ...prev, open: false }))}
          severity={snackbar.severity}
          variant="filled"
          sx={{ width: '100%' }}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
}

function PluginSidebar({ plugins, onToggle, onDelete, accentColor, successColor, isDark, onRefineClick, onViewScript, onRunPlugin }: {
  plugins: PluginManifest[];
  onToggle: (id: string, enabled: boolean) => Promise<void>;
  onDelete: (id: string) => void;
  accentColor: string;
  successColor: string;
  isDark: boolean;
  onRefineClick: (pluginId: string, pluginName: string) => void;
  onViewScript: (plugin: PluginManifest) => void;
  onRunPlugin: (plugin: PluginManifest) => void;
}) {
  const { t } = useTranslation('agent');
  const { groups, loadGroups, savePlugin } = usePluginStore();
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
  const [groupManageOpen, setGroupManageOpen] = useState(false);
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [assignPluginId, setAssignPluginId] = useState<string | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState('');
  const cardBg = isDark ? 'rgba(48,54,61,0.3)' : 'rgba(0,0,0,0.02)';

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

  const renderPluginItem = (plugin: PluginManifest) => (
    <Box key={plugin.id}>
      <ListItemButton
        sx={{
          borderRadius: 1.5, mb: 0.25, px: 1, py: 0.75,
          bgcolor: cardBg,
          '&:hover': { bgcolor: `${accentColor}10` },
        }}
      >
        <ListItemIcon sx={{ minWidth: 28 }}>
          <PackageIcon size={18} weight="duotone" color={plugin.enabled ? successColor : 'grey'} />
        </ListItemIcon>
        <ListItemText
          slotProps={{
            primary: { component: 'div' },
            secondary: { component: 'div' },
          }}
          primary={
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Typography variant="body2" sx={{ fontSize: 12, fontWeight: 600, flex: 1 }} noWrap>
                {plugin.name}
              </Typography>
              <Tooltip title={t('plugin_page.assign_group')} arrow>
                <IconButton size="small" onClick={(e) => { e.stopPropagation(); handleAssignGroup(plugin.id); }} sx={{ p: 0.15 }}>
                  <TagIcon size={11} color="text.secondary" />
                </IconButton>
              </Tooltip>
              <Switch
                checked={plugin.enabled}
                onChange={() => onToggle(plugin.id, !plugin.enabled)}
                size="small"
                edge="end"
              />
            </Box>
          }
          secondary={
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.25 }}>
              <Typography variant="caption" sx={{ fontSize: 10, color: 'text.secondary' }} noWrap>
                {t('plugin_page.version_info', { version: plugin.version, count: plugin.tools?.length || 0, tools_count: t('plugin_page.tools_count') })}
              </Typography>
              <Box sx={{ flex: 1 }} />
              <Tooltip title={t('plugin_page.refine')} arrow>
                <IconButton
                  size="small"
                  onClick={(e) => { e.stopPropagation(); onRefineClick(plugin.id, plugin.name); }}
                  sx={{ p: 0.25, color: accentColor, '&:hover': { color: isDark ? '#81C784' : '#2E7D32' } }}
                >
                  <ArrowUpIcon size={12} />
                </IconButton>
              </Tooltip>
              <Tooltip title={t('plugin_page.view_script', 'View Script')} arrow>
                <IconButton
                  size="small"
                  onClick={(e) => { e.stopPropagation(); onViewScript(plugin); }}
                  sx={{ p: 0.25, color: 'text.secondary', '&:hover': { color: accentColor } }}
                >
                  <CodeIcon size={12} />
                </IconButton>
              </Tooltip>
              <Tooltip title={t('plugin_page.run_plugin', 'Run Plugin')} arrow>
                <IconButton
                  size="small"
                  onClick={(e) => { e.stopPropagation(); onRunPlugin(plugin); }}
                  sx={{ p: 0.25, color: 'text.secondary', '&:hover': { color: successColor } }}
                >
                  <LightningIcon size={12} />
                </IconButton>
              </Tooltip>
              <Tooltip title={t('plugin_page.delete')} arrow>
                <IconButton
                  size="small"
                  onClick={(e) => { e.stopPropagation(); onDelete(plugin.id); }}
                  sx={{ p: 0.25, color: 'grey', '&:hover': { color: '#E57373' } }}
                >
                  <TrashIcon size={12} />
                </IconButton>
              </Tooltip>
            </Box>
          }
        />
      </ListItemButton>
    </Box>
  );

  return (
    <Box sx={{ width: 260, display: 'flex', flexDirection: 'column', overflow: 'hidden', borderRight: `1px solid ${isDark ? 'rgba(48,54,61,0.4)' : 'rgba(0,0,0,0.08)'}` }}>
      <Box sx={{ px: 1.5, py: 1, display: 'flex', alignItems: 'center', gap: 0.5 }}>
        <WrenchIcon size={14} weight="duotone" color={accentColor} />
        <Typography variant="caption" sx={{ fontWeight: 600, fontSize: 11, color: 'text.secondary' }}>
          {t('plugin_page.installed_plugins')} ({plugins.length})
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Tooltip title={t('plugin_page.add_group')} arrow>
          <IconButton size="small" onClick={() => setGroupManageOpen(true)} sx={{ p: 0.25 }}>
            <FolderSimplePlusIcon size={14} color={accentColor} />
          </IconButton>
        </Tooltip>
      </Box>
      <List sx={{ flex: 1, overflow: 'auto', px: 0.5, py: 0, '&::-webkit-scrollbar': { width: 4 } }}>
        {plugins.length === 0 && (
          <Box sx={{ px: 1.5, py: 2, textAlign: 'center' }}>
            <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: 11 }}>
              {t('plugin_page.no_plugins')}
            </Typography>
          </Box>
        )}
        {groups.map((group) => {
          const groupPlugins = pluginsWithGroup.filter((p) => p.groupId === group.id);
          if (groupPlugins.length === 0 && group.id !== expandedGroup) return null;
          const isExpanded = expandedGroup === group.id;
          return (
            <Box key={group.id} sx={{ mb: 0.5 }}>
              <ListItemButton
                onClick={() => setExpandedGroup(isExpanded ? null : group.id)}
                sx={{
                  borderRadius: 1.5, px: 1, py: 0.5,
                  bgcolor: isExpanded ? `${group.color}12` : 'transparent',
                  '&:hover': { bgcolor: `${group.color}18` },
                }}
              >
                <IconRenderer value={group.icon} size={14} sx={{ mr: 0.5, width: 20, height: 20, borderRadius: 1, bgcolor: `${group.color}18` }} />
                <Typography variant="caption" sx={{ fontWeight: 600, fontSize: 11, flex: 1, color: isExpanded ? group.color : 'text.primary' }} noWrap>
                  {group.name}
                </Typography>
                <Typography variant="caption" sx={{ fontSize: 10, color: 'text.secondary', mr: 0.5 }}>
                  {groupPlugins.length}
                </Typography>
                {isExpanded ? <CaretDownIcon size={10} /> : <CaretRightIcon size={10} />}
              </ListItemButton>
              {isExpanded && groupPlugins.map(renderPluginItem)}
            </Box>
          );
        })}
        {ungroupedPlugins.length > 0 && (
          <>
            {groups.length > 0 && (
              <Box sx={{ px: 1, py: 0.5 }}>
                <Typography variant="caption" sx={{ fontSize: 10, color: 'text.disabled', fontWeight: 600 }}>
                  {t('plugin_page.ungrouped')}
                </Typography>
              </Box>
            )}
            {ungroupedPlugins.map(renderPluginItem)}
          </>
        )}
      </List>
      {plugins.filter((p) => p.enabled && (!p.scenarios || p.scenarios.length === 0)).length > 0 && (
        <>
          <Divider sx={{ mx: 1, borderColor: isDark ? 'rgba(48,54,61,0.4)' : 'rgba(0,0,0,0.08)' }} />
          <Box sx={{ px: 1.5, py: 1, display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <SparkleIcon size={14} weight="duotone" color={isDark ? '#FFB74D' : '#F57C00'} />
            <Typography variant="caption" sx={{ fontWeight: 600, fontSize: 11, color: 'text.secondary' }}>
              {t('plugin_page.no_scenarios_hint')}
            </Typography>
          </Box>
          <Box sx={{ px: 1, pb: 0.5 }}>
            {plugins.filter((p) => p.enabled && (!p.scenarios || p.scenarios.length === 0)).map((plugin) => (
              <Paper
                key={plugin.id}
                variant="outlined"
                onClick={() => onRefineClick(plugin.id, plugin.name)}
                sx={{
                  p: 0.75, mb: 0.5, borderRadius: 1.5, cursor: 'pointer',
                  borderColor: isDark ? 'rgba(255,183,77,0.2)' : 'rgba(245,124,0,0.15)',
                  bgcolor: isDark ? 'rgba(255,183,77,0.04)' : 'rgba(245,124,0,0.03)',
                  transition: 'all 0.15s',
                  '&:hover': { borderColor: isDark ? 'rgba(255,183,77,0.4)' : 'rgba(245,124,0,0.3)' },
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <ArrowUpIcon size={12} weight="fill" color={isDark ? '#FFB74D' : '#F57C00'} />
                  <Typography variant="caption" sx={{ fontWeight: 600, fontSize: 10, flex: 1 }} noWrap>
                    {plugin.name}
                  </Typography>
                  <Typography variant="caption" sx={{ fontSize: 9, color: 'text.secondary' }}>
                    {t('plugin_page.click_to_refine')}
                  </Typography>
                </Box>
              </Paper>
            ))}
          </Box>
        </>
      )}
      <Divider sx={{ mx: 1, borderColor: isDark ? 'rgba(48,54,61,0.4)' : 'rgba(0,0,0,0.08)' }} />
      <Box sx={{ px: 1, py: 1 }}>
        <Paper
          variant="outlined"
          onClick={() => openPluginWorkshopWindow().catch((e) => console.error('Failed to open plugin workshop:', e))}
          sx={{
            p: 1, borderRadius: 1.5, cursor: 'pointer',
            borderColor: `${accentColor}30`,
            bgcolor: `${accentColor}08`,
            transition: 'all 0.15s',
            '&:hover': { borderColor: `${accentColor}60`, bgcolor: `${accentColor}12` },
            display: 'flex', alignItems: 'center', gap: 0.5,
          }}
        >
          <LightningIcon size={14} weight="duotone" color={accentColor} />
          <Typography variant="caption" sx={{ fontWeight: 600, fontSize: 10, flex: 1 }}>
            {t('plugin_page.open_workshop')}
          </Typography>
        </Paper>
      </Box>

      <PluginGroupManageDialog open={groupManageOpen} onClose={() => setGroupManageOpen(false)} />

      <Dialog open={assignDialogOpen} onClose={() => setAssignDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('plugin_page.assign_group')}</DialogTitle>
        <DialogContent sx={{ pt: '16px !important' }}>
          <FormControl fullWidth size="small">
            <InputLabel>{t('plugin_page.assign_group')}</InputLabel>
            <Select
              value={selectedGroupId}
              label={t('plugin_page.assign_group')}
              onChange={(e) => setSelectedGroupId(e.target.value)}
            >
              <MenuItem value="">{t('plugin_page.no_group')}</MenuItem>
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

function NoAgentBound() {
  const { t } = useTranslation('agent');
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const accentColor = isDark ? '#4FC3F7' : '#0288D1';
  const { agents, loadAgents, loadModels } = useAgentStore();
  const [selectedAgentId, setSelectedAgentId] = useState<string>('');

  useEffect(() => { loadAgents(); loadModels(); }, [loadAgents, loadModels]);

  const handleBind = () => {
    if (!selectedAgentId) return;
    localStorage.setItem('biosphere_plugin_assistant_agent_id', selectedAgentId);
    window.location.reload();
  };

  return (
    <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2, p: 3 }}>
      <SparkleIcon size={48} weight="duotone" color="#6C63FF" />
      <Typography variant="body1" sx={{ fontWeight: 600, textAlign: 'center' }}>
        {t('plugin_page.no_agent_bound')}
      </Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary', textAlign: 'center', maxWidth: 360, lineHeight: 1.6 }}>
        {t('plugin_page.no_agent_bound_desc')}
      </Typography>
      {agents.length > 0 && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1 }}>
          <FormControl size="small" sx={{ minWidth: 200 }}>
            <Select
              value={selectedAgentId}
              displayEmpty
              onChange={(e) => setSelectedAgentId(e.target.value)}
              renderValue={(v) => {
                if (!v) return <Typography variant="body2" sx={{ color: 'text.secondary' }}>{t('plugin_assistant.select_agent')}</Typography>;
                const agent = agents.find((a) => a.id === v);
                return <Typography variant="body2">{agent?.name || v}</Typography>;
              }}
              sx={{ height: 36, fontSize: 13, bgcolor: isDark ? 'rgba(48,54,61,0.3)' : 'rgba(0,0,0,0.03)' }}
            >
              {agents.map((agent) => (
                <MenuItem key={agent.id} value={agent.id} sx={{ fontSize: 13 }}>
                  {agent.name}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <Button
            variant="contained"
            size="small"
            disabled={!selectedAgentId}
            onClick={handleBind}
            sx={{ textTransform: 'none', bgcolor: accentColor, '&:hover': { bgcolor: isDark ? '#29B6F6' : '#0277BD' } }}
          >
            {t('plugin_page.bind_agent')}
          </Button>
        </Box>
      )}
    </Box>
  );
}

function ChatHeader({ agent, model, onNewChat, accentColor, isDark, agentColor }: any) {
  const { t } = useTranslation('agent');
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 0.75 }}>
      <Box sx={{ width: 24, height: 24, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: `linear-gradient(135deg, ${agentColor} 0%, ${isDark ? '#29B6F6' : '#0277BD'} 100%)`, color: '#fff', flexShrink: 0 }}>
        <RobotIcon size={12} weight="bold" />
      </Box>
      <Typography variant="body2" sx={{ fontWeight: 600, fontSize: 13, flex: 1 }}>
        {agent?.name || t('plugin_assistant.title')}
      </Typography>
      {model && (
        <Chip label={model.name} size="small" sx={{ height: 18, fontSize: 9 }} />
      )}
      <Tooltip title={t('plugin_page.new_chat')} arrow>
        <IconButton size="small" onClick={onNewChat} sx={{ borderRadius: 2, border: `1px solid ${accentColor}30` }}>
          <PlusIcon size={14} weight="bold" color={accentColor} />
        </IconButton>
      </Tooltip>
    </Box>
  );
}
