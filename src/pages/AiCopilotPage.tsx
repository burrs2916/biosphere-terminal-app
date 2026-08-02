import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Box, Typography, Divider, Chip, IconButton, Tooltip,
} from '@mui/material';
import {
  RobotIcon, SparkleIcon, PlusIcon, ListIcon, TrashIcon,
} from '@phosphor-icons/react';
import { useAgentStore } from '../features/agent/store/agentStore';
import { runAgent, saveMessage, listMessages, createConversation, listConversations, stopAgent, updateConversationTitle, deleteConversation } from '../core/services/agent.service';
import type { MessageDto, ConversationDto } from '../proto/agent';
import { listen } from '@tauri-apps/api/event';
import { useTheme } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';
import { useNotify } from '../core/notification';
import { ChatMessagesArea, ChatInputArea, type FileAttachment } from '../components/chat/ChatComponents';
import type { ToolCallDisplay } from '../components/chat/ChatComponents';
import { useFeatureGate, LockedScreen } from '../features/licensing';
import { localizeBackendError } from '../core/backendError';

const STORAGE_KEY = 'biosphere_terminal_copilot_agent_id';

export function getTerminalCopilotAgentId(): string | null {
  return localStorage.getItem(STORAGE_KEY);
}

export function setTerminalCopilotAgentId(id: string | null) {
  if (id) {
    localStorage.setItem(STORAGE_KEY, id);
  } else {
    localStorage.removeItem(STORAGE_KEY);
  }
}

interface StreamChunk { conversationId: string; chunk: string }
interface StreamDone { conversationId: string; response: string }
interface StreamError { conversationId: string; error: string }
interface ToolCallEvent {
  tool_name: string;
  arguments: Record<string, unknown>;
  result: string | null;
  success: boolean | null;
  status: 'running' | 'done';
}
interface ToolCallPayload { conversationId: string; toolCall: ToolCallEvent }

export function AiCopilotPage() {
  // Pro 功能：未付费时显示锁定页
  const featureGate = useFeatureGate('ai_copilot');

  const { t } = useTranslation('agent');
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const agentColor = isDark ? '#4FC3F7' : '#0288D1';
  const userColor = isDark ? '#6C63FF' : '#5B54E0';
  const mutedBorder = isDark ? 'rgba(48,54,61,0.6)' : 'rgba(0,0,0,0.08)';

  const { agents, models, loadAgents, loadModels } = useAgentStore();

  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<FileAttachment[]>([]);
  const [loading, setLoading] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [messages, setMessages] = useState<MessageDto[]>([]);
  const [toolCalls, setToolCalls] = useState<ToolCallDisplay[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [convList, setConvList] = useState<ConversationDto[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const streamingMsgIdRef = useRef<string | null>(null);
  const toolCallCounterRef = useRef(0);

  const storedAgentId = getTerminalCopilotAgentId();
  const boundAgentId = storedAgentId;
  const boundAgent = agents.find((a) => a.id === boundAgentId);
  const boundModel = boundAgent ? models.find((m) => m.id === boundAgent.modelId) : null;
  // 绑定 id 残留但对应智能体已不存在（被删/改）时，给出明确提示，而非运行期崩溃
  const boundAgentMissing = boundAgentId != null && agents.length > 0 && !boundAgent;
  const notify = useNotify().notify;

  // 若回退发生了，持久化新选择，保证后续加载稳定。
  useEffect(() => {
    if (boundAgentId && boundAgentId !== storedAgentId) {
      setTerminalCopilotAgentId(boundAgentId);
    }
  }, [boundAgentId, storedAgentId]);

  useEffect(() => {
    loadAgents();
    loadModels();
  }, [loadAgents, loadModels]);

  const loadConversations = useCallback(async (): Promise<ConversationDto[]> => {
    if (!boundAgentId) return [];
    try {
      const convs = await listConversations(boundAgentId);
      const sorted = [...convs].sort((a, b) => b.updatedAt - a.updatedAt);
      setConvList(sorted);
      return sorted;
    } catch (err) { console.error('AiCopilotPage: operation failed', err); return []; }
  }, [boundAgentId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const sorted = await loadConversations();
      if (cancelled) return;
      if (sorted.length > 0) {
        const conv = sorted[0];
        setConversationId(conv.id);
        try {
          const msgs = await listMessages(conv.id);
          if (!cancelled) setMessages(msgs);
        } catch (e) { console.error('AiCopilotPage: operation failed', e); }
      } else {
        try {
          const conv = await createConversation(boundAgentId!, 'AI Copilot');
          if (!cancelled) {
            setConversationId(conv.id);
            setMessages([]);
            setConvList([conv]);
          }
        } catch (e) { console.error('AiCopilotPage: operation failed', e); }
      }
    })();
    return () => { cancelled = true; };
  }, [boundAgentId, loadConversations]);

  const selectConversation = useCallback(async (id: string) => {
    setConversationId(id);
    setMessages([]);
    try {
      const msgs = await listMessages(id);
      setMessages(msgs);
    } catch (e) { console.error('AiCopilotPage: operation failed', e); }
  }, []);

  const handleNewChat = async () => {
    if (!boundAgentId) return;
    try {
      const conv = await createConversation(boundAgentId, 'AI Copilot');
      setConvList((prev) => [conv, ...prev].sort((a, b) => b.updatedAt - a.updatedAt));
      setConversationId(conv.id);
      setMessages([]);
    } catch (err) { console.error('AiCopilotPage: operation failed', err); }
  };

  const handleDeleteConv = async (id: string) => {
    try {
      await deleteConversation(id);
      setConvList((prev) => {
        const next = prev.filter((c) => c.id !== id);
        if (conversationId === id) {
          if (next.length > 0) {
            const recent = next[0];
            setConversationId(recent.id);
            listMessages(recent.id).then((msgs) => setMessages(msgs)).catch(() => {});
          } else {
            setConversationId(null);
            setMessages([]);
          }
        }
        return next;
      });
    } catch (err) { console.error('AiCopilotPage: operation failed', err); }
  };

  useEffect(() => {
    if (!conversationId) return;

    const unlistenChunk = listen<StreamChunk>('agent-chunk', (event) => {
      if (event.payload.conversationId === conversationId) {
        setStreamingContent((prev) => prev + event.payload.chunk);
      }
    });

    const unlistenDone = listen<StreamDone>('agent-done', async (event) => {
      if (event.payload.conversationId === conversationId) {
        const msgId = streamingMsgIdRef.current;
        if (msgId) {
          setMessages((prev) => prev.map((m) => m.id === msgId ? { ...m, content: event.payload.response } : m));
        }
        try {
          const allMsgs = await listMessages(conversationId);
          setMessages(allMsgs);
          const firstUserMsg = allMsgs.find((m) => m.role === 'user');
          if (firstUserMsg) {
            const autoTitle = firstUserMsg.content.replace(/\[(?:附件|Attachment):.*?\]\s*/g, '').trim().slice(0, 40);
            if (autoTitle) {
              updateConversationTitle(conversationId, autoTitle).catch((e) => notify(localizeBackendError(e)));
              setConvList((prev) => prev.map((c) => c.id === conversationId ? { ...c, title: autoTitle } : c));
            }
          }
        } catch (err) { console.error('AiCopilotPage: operation failed', err); }
        setStreamingContent('');
        setLoading(false);
        streamingMsgIdRef.current = null;
      }
    });

    const unlistenError = listen<StreamError>('agent-error', (event) => {
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
          toolCallCounterRef.current += 1;
          const id = `tc-${toolCallCounterRef.current}`;
          setToolCalls((prev) => [...prev, {
            id, toolName: tc.tool_name, arguments: tc.arguments,
            result: null, success: null, status: 'running',
          }]);
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
        }
      }
    });

    return () => {
      unlistenChunk.then((fn) => fn());
      unlistenDone.then((fn) => fn());
      unlistenError.then((fn) => fn());
      unlistenToolCall.then((fn) => fn());
    };
  }, [conversationId]);

  const sendMessage = useCallback(async (messageText: string) => {
    if (!messageText.trim() || !conversationId || !boundAgentId) return;

    const userMsg: MessageDto = {
      id: crypto.randomUUID(), conversationId, role: 'user',
      content: messageText.trim(), toolCalls: '', isError: 0, createdAt: Date.now(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);
    setToolCalls([]);
    toolCallCounterRef.current = 0;

    try { await saveMessage(userMsg); } catch (err) { console.error('AiCopilotPage: operation failed', err); }

    const assistantMsgId = crypto.randomUUID();
    streamingMsgIdRef.current = assistantMsgId;

    const assistantMsg: MessageDto = {
      id: assistantMsgId, conversationId, role: 'assistant',
      content: '', toolCalls: '', isError: 0, createdAt: Date.now(),
    };
    setMessages((prev) => [...prev, assistantMsg]);
    setStreamingContent('');

    try {
      await runAgent(boundAgentId, messageText.trim(), conversationId);
    } catch (e) {
      setMessages((prev) => prev.map((m) => m.id === assistantMsgId ? { ...m, content: `❌ ${localizeBackendError(e)}` } : m));
      setStreamingContent('');
      setLoading(false);
      streamingMsgIdRef.current = null;
    }
  }, [conversationId, boundAgentId]);

  const handleSend = useCallback(async () => {
    if (!input.trim()) return;
    let messageContent = input.trim();
    if (attachments.length > 0) {
      const attachmentText = attachments.map((f) => t('copilot.attachment_prefix', { path: f.path })).join('\n');
      messageContent = `${attachmentText}\n\n${messageContent}`;
    }
    setInput('');
    setAttachments([]);
    await sendMessage(messageContent);
  }, [input, attachments, sendMessage]);

  useEffect(() => {
    if (!boundAgentId || !conversationId) return;

    const triggerType = boundAgent?.triggerType || 'manual';
    if (triggerType === 'manual') return;

    const supportsFailure = triggerType === 'auto_failure' || triggerType === 'auto_both';
    const supportsSave = triggerType === 'auto_save' || triggerType === 'auto_both';

    const unlisteners: (() => void)[] = [];

    if (supportsFailure) {
      listen<{ triggerType: string; command: string; exitCode: number; sessionId: string }>('auto-trigger-agent', (event) => {
        if (event.payload.triggerType !== 'auto_failure') return;
        if (loading) return;
        const autoMessage = t('copilot.auto_failure_prompt', { command: event.payload.command, exitCode: event.payload.exitCode });
        sendMessage(autoMessage);
      }).then((fn) => { unlisteners.push(fn); });
    }

    if (supportsSave) {
      listen<{ triggerType: string; noteId: string; noteTitle: string; action: string }>('auto-trigger-agent', (event) => {
        if (event.payload.triggerType !== 'auto_save') return;
        if (loading) return;
        const actionText = event.payload.action === 'create' ? t('copilot.auto_save_create') : t('copilot.auto_save_update');
        const autoMessage = t('copilot.auto_save_prompt', { action: actionText, title: event.payload.noteTitle });
        sendMessage(autoMessage);
      }).then((fn) => { unlisteners.push(fn); });
    }

    return () => {
      unlisteners.forEach((fn) => fn());
    };
  }, [boundAgentId, conversationId, boundAgent?.triggerType, loading, sendMessage]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleStop = async () => {
    if (conversationId) {
      try {
        await stopAgent(conversationId);
      } catch (err) { console.error('AiCopilotPage: operation failed', err); }
    }
    setLoading(false);
    setStreamingContent('');
    streamingMsgIdRef.current = null;
  };

  if (!boundAgentId || boundAgentMissing) {
    return (
      <Box sx={{ height: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2, p: 3, bgcolor: 'background.default' }}>
        <SparkleIcon size={48} weight="duotone" color="#6C63FF" />
        <Typography variant="body1" sx={{ fontWeight: 600, textAlign: 'center' }}>
          {boundAgentMissing ? t('copilot.agent_missing') : t('copilot.no_agent_bound')}
        </Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary', textAlign: 'center', maxWidth: 320, lineHeight: 1.6 }}>
          {boundAgentMissing ? t('copilot.agent_missing_desc') : t('copilot.no_agent_bound_desc')}
        </Typography>
      </Box>
    );
  }

  // 未付费用户显示锁定页
  if (!featureGate.canUse) {
    return <LockedScreen feature="ai_copilot" />;
  }

  return (
    <Box sx={{ height: '100vh', display: 'flex', flexDirection: 'row', bgcolor: 'background.default' }}>
      {sidebarOpen && (
        <Box sx={{
          width: 240, flexShrink: 0, borderRight: `1px solid ${mutedBorder}`,
          display: 'flex', flexDirection: 'column',
          bgcolor: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)',
        }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 1.5, py: 1, borderBottom: `1px solid ${mutedBorder}` }}>
            <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary', fontSize: 11 }}>
              {t('copilot.sessions_title')}
            </Typography>
            <Tooltip title={t('copilot.new_chat')} arrow>
              <IconButton size="small" onClick={handleNewChat} sx={{ borderRadius: 2, border: `1px solid ${agentColor}30`, color: agentColor }}>
                <PlusIcon size={14} weight="bold" />
              </IconButton>
            </Tooltip>
          </Box>
          <Box sx={{ flex: 1, overflow: 'auto', p: 1 }}>
            {convList.length === 0 ? (
              <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', textAlign: 'center', mt: 2, fontSize: 11 }}>
                {t('copilot.no_sessions')}
              </Typography>
            ) : (
              convList.map((c) => (
                <Box
                  key={c.id}
                  onClick={() => selectConversation(c.id)}
                  sx={{
                    display: 'flex', alignItems: 'center', gap: 0.5, p: 1, mb: 0.5, borderRadius: 2, cursor: 'pointer',
                    bgcolor: c.id === conversationId ? `${agentColor}18` : 'transparent',
                    border: c.id === conversationId ? `1px solid ${agentColor}40` : '1px solid transparent',
                    '&:hover': { bgcolor: `${agentColor}10` },
                  }}
                >
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="body2" sx={{ fontSize: 12, fontWeight: c.id === conversationId ? 600 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {c.title || 'AI Copilot'}
                    </Typography>
                    <Typography variant="caption" sx={{ fontSize: 10, color: 'text.secondary' }}>
                      {new Date(c.updatedAt).toLocaleString(undefined, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </Typography>
                  </Box>
                  <IconButton
                    size="small"
                    onClick={(e) => { e.stopPropagation(); handleDeleteConv(c.id); }}
                    sx={{ p: 0.25, opacity: 0.5, '&:hover': { opacity: 1, color: 'error.main' } }}
                  >
                    <TrashIcon size={14} />
                  </IconButton>
                </Box>
              ))
            )}
          </Box>
        </Box>
      )}
      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 0.75 }}>
          <IconButton size="small" onClick={() => setSidebarOpen((o) => !o)} sx={{ borderRadius: 2, border: `1px solid ${agentColor}30`, color: agentColor }}>
            <ListIcon size={14} weight="bold" />
          </IconButton>
          <Box sx={{
            width: 24, height: 24, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: `linear-gradient(135deg, ${agentColor} 0%, ${isDark ? '#29B6F6' : '#0277BD'} 100%)`,
            color: '#fff', flexShrink: 0,
          }}>
            <RobotIcon size={12} weight="bold" />
          </Box>
          <Typography variant="body2" sx={{ fontWeight: 600, fontSize: 13, flex: 1 }}>
            {boundAgent?.name || 'AI Copilot'}
          </Typography>
          {boundModel && (
            <Chip label={boundModel.name} size="small" sx={{ height: 18, fontSize: 9 }} />
          )}
          <Tooltip title={t('copilot.new_chat')} arrow>
            <IconButton size="small" onClick={handleNewChat} sx={{ borderRadius: 2, border: `1px solid ${agentColor}30` }}>
              <PlusIcon size={14} weight="bold" color={agentColor} />
            </IconButton>
          </Tooltip>
        </Box>
        <Divider sx={{ borderColor: mutedBorder }} />
        <ChatMessagesArea
          messages={messages}
          streamingContent={streamingContent}
          streamingMsgId={streamingMsgIdRef.current}
          loading={loading}
          toolCalls={toolCalls}
          agentColor={agentColor}
          userColor={userColor}
          isDark={isDark}
          conversationId={conversationId ?? undefined}
          emptyIcon={<RobotIcon size={40} weight="duotone" color={agentColor} />}
          emptyText={t('copilot.empty_hint')}
          thinkingText={t('copilot.thinking')}
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
          placeholder={t('copilot.input_placeholder')}
          onStop={handleStop}
          attachments={attachments}
          onAttachmentsChange={setAttachments}
        />
      </Box>
    </Box>
  );
}
