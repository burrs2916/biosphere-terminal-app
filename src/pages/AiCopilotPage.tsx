import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Box, Typography, Divider, Chip, IconButton, Tooltip,
} from '@mui/material';
import {
  RobotIcon, SparkleIcon, PlusIcon,
} from '@phosphor-icons/react';
import { useAgentStore } from '../features/agent/store/agentStore';
import { runAgent, saveMessage, listMessages, createConversation, listConversations, stopAgent, updateConversationTitle } from '../core/services/agent.service';
import type { MessageDto } from '../proto/agent';
import { listen } from '@tauri-apps/api/event';
import { useTheme } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';
import { ChatMessagesArea, ChatInputArea, type FileAttachment } from '../components/chat/ChatComponents';
import type { ToolCallDisplay } from '../components/chat/ChatComponents';

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
  const streamingMsgIdRef = useRef<string | null>(null);
  const toolCallCounterRef = useRef(0);

  const boundAgentId = getTerminalCopilotAgentId();
  const boundAgent = agents.find((a) => a.id === boundAgentId);
  const boundModel = boundAgent ? models.find((m) => m.id === boundAgent.modelId) : null;

  useEffect(() => {
    loadAgents();
    loadModels();
  }, [loadAgents, loadModels]);

  useEffect(() => {
    if (!boundAgentId) return;

    const initConversation = async () => {
      try {
        const convs = await listConversations(boundAgentId);
        if (convs.length > 0) {
          const conv = convs[0];
          setConversationId(conv.id);
          const msgs = await listMessages(conv.id);
          setMessages(msgs);
        } else {
          const conv = await createConversation(boundAgentId, 'AI Copilot');
          setConversationId(conv.id);
          setMessages([]);
        }
      } catch {}
    };
    initConversation();
  }, [boundAgentId]);

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
            const autoTitle = firstUserMsg.content.replace(/\[附件:.*?\]\s*/g, '').trim().slice(0, 40);
            if (autoTitle) {
              updateConversationTitle(conversationId, autoTitle).catch(() => {});
            }
          }
        } catch {}
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

    try { await saveMessage(userMsg); } catch {}

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
      setMessages((prev) => prev.map((m) => m.id === assistantMsgId ? { ...m, content: `❌ ${String(e)}` } : m));
      setStreamingContent('');
      setLoading(false);
      streamingMsgIdRef.current = null;
    }
  }, [conversationId, boundAgentId]);

  const handleSend = useCallback(async () => {
    if (!input.trim()) return;
    let messageContent = input.trim();
    if (attachments.length > 0) {
      const attachmentText = attachments.map((f) => `[附件: ${f.path}]`).join('\n');
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
        const autoMessage = `命令执行失败，请帮我分析原因并提供建议：\n命令: \`${event.payload.command}\`\n退出码: ${event.payload.exitCode}`;
        sendMessage(autoMessage);
      }).then((fn) => { unlisteners.push(fn); });
    }

    if (supportsSave) {
      listen<{ triggerType: string; noteId: string; noteTitle: string; action: string }>('auto-trigger-agent', (event) => {
        if (event.payload.triggerType !== 'auto_save') return;
        if (loading) return;
        const autoMessage = `笔记已${event.payload.action === 'create' ? '创建' : '更新'}："${event.payload.noteTitle}"，请帮我检查内容并提供改进建议。`;
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
      } catch {}
    }
    setLoading(false);
    setStreamingContent('');
    streamingMsgIdRef.current = null;
  };

  const handleNewChat = async () => {
    if (!boundAgentId) return;
    try {
      const conv = await createConversation(boundAgentId, 'AI Copilot');
      setConversationId(conv.id);
      setMessages([]);
    } catch {}
  };

  if (!boundAgentId) {
    return (
      <Box sx={{ height: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2, p: 3, bgcolor: 'background.default' }}>
        <SparkleIcon size={48} weight="duotone" color="#6C63FF" />
        <Typography variant="body1" sx={{ fontWeight: 600, textAlign: 'center' }}>
          {t('copilot.no_agent_bound')}
        </Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary', textAlign: 'center', maxWidth: 300, lineHeight: 1.6 }}>
          {t('copilot.no_agent_bound_desc')}
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ height: '100vh', display: 'flex', flexDirection: 'column', bgcolor: 'background.default' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 0.75 }}>
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
  );
}
