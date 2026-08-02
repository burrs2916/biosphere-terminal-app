import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Box, IconButton, Typography, Divider, Chip,
  Select, MenuItem, FormControl,
  Dialog, DialogTitle, DialogContent, DialogActions,
  Button, Alert,
} from '@mui/material';
import {
  Robot, Plus as PlusIcon, TrashIcon,
  ChatCircleDotsIcon, Sparkle, ShieldWarning,
} from '@phosphor-icons/react';
import { useAgentStore } from '../store/agentStore';
import type { MessageDto } from '../../../proto/agent';
import { useTranslation } from 'react-i18next';
import { useNotify } from '../../../core/notification';
import { listen } from '@tauri-apps/api/event';
import { runAgent, saveMessage, stopAgent, respondPermission } from '../../../core/services/agent.service';
import { useTheme } from '@mui/material/styles';
import { ChatMessagesArea, ChatInputArea, type FileAttachment } from '../../../components/chat/ChatComponents';
import type { ToolCallDisplay } from '../../../components/chat/ChatComponents';
import { localizeBackendError } from '../../../core/backendError';

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

interface PermissionRequestPayload {
  conversationId: string;
  agentId?: string;
  toolName: string;
  arguments: Record<string, unknown>;
  riskLevel: 'low' | 'high';
  description: string;
}

export function AgentChat() {
  const {
    messages, activeConversationId, activeAgentId,
    agents, conversations, models,
    loadMessages, addMessage, updateMessage, createConversation, deleteConversation,
    updateConversationTitle, loadConversations, loadAgents, loadModels, deleteMessagesAfter,
  } = useAgentStore();
  const notify = useNotify().notify;
  const { t } = useTranslation('agent');
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const agentColor = isDark ? '#CE93D8' : '#7B1FA2';
  const userColor = isDark ? '#6C63FF' : '#5B54E0';
  const mutedBorder = isDark ? 'rgba(48,54,61,0.6)' : 'rgba(0,0,0,0.08)';

  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<FileAttachment[]>([]);
  const [loading, setLoading] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [toolCalls, setToolCalls] = useState<ToolCallDisplay[]>([]);
  const [permissionRequest, setPermissionRequest] = useState<PermissionRequestPayload | null>(null);
  const [deleteConvConfirm, setDeleteConvConfirm] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const streamingMsgIdRef = useRef<string | null>(null);
  const toolCallCounterRef = useRef(0);

  useEffect(() => {
    loadAgents();
    loadModels();
  }, [loadAgents, loadModels]);

  useEffect(() => {
    if (activeAgentId) {
      loadConversations(activeAgentId);
    } else {
      useAgentStore.getState().setActiveConversation(null);
    }
  }, [activeAgentId, loadConversations]);

  useEffect(() => {
    if (activeAgentId && conversations.length === 0 && !activeConversationId) {
      createConversation(activeAgentId, t('chat.new_conversation_title'));
    } else if (activeAgentId && !activeConversationId && conversations.length > 0) {
      useAgentStore.getState().setActiveConversation(conversations[0].id);
    }
  }, [activeAgentId, conversations.length, activeConversationId, createConversation]);

  useEffect(() => {
    if (activeConversationId) {
      loadMessages(activeConversationId);
    }
  }, [activeConversationId, loadMessages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent, toolCalls]);

  useEffect(() => {
    const unlistenChunk = listen<StreamChunk>('agent-chunk', (event) => {
      if (event.payload.conversationId === activeConversationId) {
        setStreamingContent((prev) => prev + event.payload.chunk);
      }
    });

    const unlistenDone = listen<StreamDone>('agent-done', async (event) => {
      if (event.payload.conversationId === activeConversationId) {
        const msgId = streamingMsgIdRef.current;
        if (msgId) {
          updateMessage(msgId, event.payload.response);
        }
        if (activeConversationId) {
          try {
            await loadMessages(activeConversationId);
          } catch (err) { console.error('AgentChat: failed to load messages after agent-done', err); }
          const conv = useAgentStore.getState().conversations.find((c) => c.id === activeConversationId);
          if (conv) {
            const isDefaultTitle = conv.title === t('chat.new_conversation_title') || conv.title === 'New Conversation' || conv.title === 'AI Copilot';
            if (isDefaultTitle) {
              const msgs = useAgentStore.getState().messages;
              const firstUserMsg = msgs.find((m) => m.role === 'user');
              if (firstUserMsg) {
                const autoTitle = firstUserMsg.content.replace(/\[(?:附件|Attachment):.*?\]\s*/g, '').trim().slice(0, 40);
                if (autoTitle) {
                  updateConversationTitle(activeConversationId, autoTitle).catch((e) => notify(localizeBackendError(e)));
                }
              }
            }
          }
        }
        setStreamingContent('');
        setLoading(false);
        streamingMsgIdRef.current = null;
      }
    });

    const unlistenError = listen<StreamError>('agent-error', (event) => {
      if (event.payload.conversationId === activeConversationId) {
        const msgId = streamingMsgIdRef.current;
        if (msgId) {
          updateMessage(msgId, `❌ ${event.payload.error}`);
        }
        setStreamingContent('');
        setLoading(false);
        streamingMsgIdRef.current = null;
      }
    });

    const unlistenToolCall = listen<ToolCallPayload>('agent-tool-call', (event) => {
      if (event.payload.conversationId === activeConversationId) {
        const tc = event.payload.toolCall;
        if (tc.status === 'running') {
          toolCallCounterRef.current += 1;
          const id = `tc-${toolCallCounterRef.current}`;
          setToolCalls((prev) => [...prev, {
            id, toolName: tc.tool_name, arguments: tc.arguments,
            result: null, success: null, status: 'running',
          }]);
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
        }
      }
    });

    const unlistenPermission = listen<PermissionRequestPayload>('agent-permission-request', (event) => {
      if (event.payload.conversationId === activeConversationId) {
        setPermissionRequest(event.payload);
      }
    });

    return () => {
      unlistenChunk.then((fn) => fn());
      unlistenDone.then((fn) => fn());
      unlistenError.then((fn) => fn());
      unlistenToolCall.then((fn) => fn());
      unlistenPermission.then((fn) => fn());
    };
  }, [activeConversationId, updateMessage]);

  const handlePermissionResponse = useCallback(async (approved: boolean, alwaysAllow: boolean) => {
    if (permissionRequest) {
      try {
        await respondPermission(permissionRequest.conversationId, approved, alwaysAllow);
      } catch (err) { console.error('AgentChat: failed to respond to permission', err); }
      setPermissionRequest(null);
    }
  }, [permissionRequest]);

  const handleSend = useCallback(async () => {
    if (!input.trim() || !activeConversationId || !activeAgentId) return;

    let messageContent = input.trim();
    if (attachments.length > 0) {
      const attachmentText = attachments.map((f) => `[${t('agent.attachment')}: ${f.path}]`).join('\n');
      messageContent = `${attachmentText}\n\n${messageContent}`;
    }

    const userMsg: MessageDto = {
      id: crypto.randomUUID(),
      conversationId: activeConversationId,
      role: 'user',
      content: messageContent,
      toolCalls: '',
      isError: 0,
      createdAt: Date.now(),
    };

    addMessage(userMsg);
    setInput('');
    setAttachments([]);
    setLoading(true);
    setToolCalls([]);
    toolCallCounterRef.current = 0;

    try { await saveMessage(userMsg); } catch (err) { console.error('AgentChat: failed to save message', err); notify(t('chat.message_save_failed')); }

    const assistantMsgId = crypto.randomUUID();
    streamingMsgIdRef.current = assistantMsgId;

    const assistantMsg: MessageDto = {
      id: assistantMsgId,
      conversationId: activeConversationId,
      role: 'assistant',
      content: '',
      toolCalls: '',
      isError: 0,
      createdAt: Date.now(),
    };
    addMessage(assistantMsg);
    setStreamingContent('');

    try {
      await runAgent(activeAgentId, input.trim(), activeConversationId);
    } catch (e) {
      updateMessage(assistantMsgId, `❌ ${localizeBackendError(e)}`);
      setStreamingContent('');
      setLoading(false);
      streamingMsgIdRef.current = null;
    }
  }, [input, activeConversationId, activeAgentId, addMessage, updateMessage]);

  const handleStop = async () => {
    if (activeConversationId) {
      try {
        await stopAgent(activeConversationId);
      } catch (err) { console.error('AgentChat: failed to stop agent', err); }
    }
    setLoading(false);
    setStreamingContent('');
    streamingMsgIdRef.current = null;
  };

  const handleNewChat = async () => {
    if (activeAgentId) {
      await createConversation(activeAgentId, t('chat.new_conversation_title'));
    }
  };

  const handleDeleteConversation = useCallback(async (convId: string) => {
    await deleteConversation(convId);
    setDeleteConvConfirm(null);
  }, [deleteConversation]);

  const handleEditMessage = useCallback((_messageId: string, content: string) => {
    const cleaned = content.replace(/\[(?:附件|Attachment):.*?\]\s*/g, '').trim();
    setInput(cleaned);
  }, []);

  const handleRegenerate = useCallback(async (assistantMsgId: string) => {
    if (!activeConversationId || !activeAgentId || loading) return;
    const msgIdx = messages.findIndex((m) => m.id === assistantMsgId);
    if (msgIdx < 0) return;
    const prevUserMsg = [...messages].slice(0, msgIdx).reverse().find((m) => m.role === 'user');
    if (!prevUserMsg) return;
    await deleteMessagesAfter(activeConversationId, prevUserMsg.id);
    await loadMessages(activeConversationId);
    setLoading(true);
    setToolCalls([]);
    toolCallCounterRef.current = 0;
    const newAssistantMsgId = crypto.randomUUID();
    streamingMsgIdRef.current = newAssistantMsgId;
    const assistantMsg: MessageDto = {
      id: newAssistantMsgId,
      conversationId: activeConversationId,
      role: 'assistant',
      content: '',
      toolCalls: '',
      isError: 0,
      createdAt: Date.now(),
    };
    addMessage(assistantMsg);
    setStreamingContent('');
    try {
      await runAgent(activeAgentId, prevUserMsg.content.replace(/\[(?:附件|Attachment):.*?\]\s*/g, '').trim(), activeConversationId);
    } catch (e) {
      updateMessage(newAssistantMsgId, `❌ ${localizeBackendError(e)}`);
      setStreamingContent('');
      setLoading(false);
      streamingMsgIdRef.current = null;
    }
  }, [activeConversationId, activeAgentId, loading, messages, deleteMessagesAfter, loadMessages, addMessage, updateMessage]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const activeAgent = agents.find((a) => a.id === activeAgentId);

  return (
    <Box sx={{ height: '100%', width: '100%', display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
      <Box sx={{ px: 2, pt: 1.5, pb: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
          <FormControl size="small" sx={{ flex: 1 }}>
            <Select
              value={activeAgentId || ''}
              displayEmpty
              onChange={(e) => {
                if (e.target.value) {
                  useAgentStore.getState().setActiveAgent(e.target.value);
                }
              }}
              renderValue={(value) => {
                if (!value) {
                  return (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, color: 'text.secondary' }}>
                      <ChatCircleDotsIcon size={16} />
                      <Typography variant="body2" sx={{ fontSize: 13 }}>
                        {t('chat.select_agent_placeholder')}
                      </Typography>
                    </Box>
                  );
                }
                const agent = agents.find((a) => a.id === value);
                const model = agent ? models.find((m) => m.id === agent.modelId) : null;
                return (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Box sx={{
                      width: 22, height: 22, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                      background: `linear-gradient(135deg, ${agentColor} 0%, ${isDark ? '#EA80FC' : '#9C27B0'} 100%)`, color: '#fff', flexShrink: 0,
                    }}>
                      <Robot size={11} weight="bold" />
                    </Box>
                    <Typography variant="body2" sx={{ fontWeight: 600, fontSize: 13 }}>
                      {agent?.name || ''}
                    </Typography>
                    {model && (
                      <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: 10, bgcolor: `${agentColor}10`, px: 0.75, py: 0.25, borderRadius: 1 }}>
                        {model.name}
                      </Typography>
                    )}
                  </Box>
                );
              }}
              sx={{
                borderRadius: 2, bgcolor: `${agentColor}08`,
                '& .MuiSelect-select': { py: 0.75, pr: 3 },
                '& .MuiOutlinedInput-notchedOutline': { borderColor: `${agentColor}20` },
                '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: `${agentColor}40` },
                '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: `${agentColor}60` },
              }}
            >
              {agents.length === 0 && (
                <MenuItem disabled value="">
                  <Typography variant="body2" sx={{ color: 'text.secondary', fontSize: 12 }}>
                    {t('agent.no_agents')}
                  </Typography>
                </MenuItem>
              )}
              {agents.map((agent) => {
                const model = models.find((m) => m.id === agent.modelId);
                return (
                  <MenuItem key={agent.id} value={agent.id}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
                      <Box sx={{
                        width: 24, height: 24, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: `linear-gradient(135deg, ${agentColor} 0%, ${isDark ? '#EA80FC' : '#9C27B0'} 100%)`, color: '#fff', flexShrink: 0,
                      }}>
                        <Robot size={12} weight="bold" />
                      </Box>
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography variant="body2" sx={{ fontWeight: 600, fontSize: 13 }}>{agent.name}</Typography>
                        {agent.description && (
                          <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: 10, display: 'block' }} noWrap>{agent.description}</Typography>
                        )}
                      </Box>
                      {model && <Chip label={model.name} size="small" sx={{ height: 18, fontSize: 9, flexShrink: 0 }} />}
                    </Box>
                  </MenuItem>
                );
              })}
            </Select>
          </FormControl>
          <IconButton
            size="small" onClick={handleNewChat} disabled={!activeAgentId}
            sx={{
              borderRadius: 2, border: `1px solid ${agentColor}30`, bgcolor: `${agentColor}08`,
              '&:hover': { bgcolor: `${agentColor}15`, borderColor: `${agentColor}40` },
              '&.Mui-disabled': { opacity: 0.3 },
            }}
          >
            <PlusIcon size={16} weight="bold" color={agentColor} />
          </IconButton>
        </Box>

        {conversations.length > 0 && (
          <Box sx={{ display: 'flex', gap: 0.5, overflow: 'auto', '&::-webkit-scrollbar': { height: 3 } }}>
            {conversations.map((conv) => (
              <Chip
                key={conv.id} label={conv.title} size="small"
                variant={activeConversationId === conv.id ? 'filled' : 'outlined'}
                color={activeConversationId === conv.id ? 'secondary' : 'default'}
                onClick={() => useAgentStore.getState().setActiveConversation(conv.id)}
                onDelete={conversations.length > 1 ? () => setDeleteConvConfirm(conv.id) : undefined}
                deleteIcon={<TrashIcon size={12} />}
                sx={{
                  height: 24, fontSize: 11, borderRadius: 1.5,
                  '& .MuiChip-deleteIcon': { color: 'rgba(255,123,114,0.5)', '&:hover': { color: '#FF7B72' } },
                }}
              />
            ))}
          </Box>
        )}
      </Box>

      <Divider sx={{ borderColor: mutedBorder }} />

      {!activeAgentId ? (
        <EmptyState type="no_agent" t={t} agentColor={agentColor} />
      ) : (
        <>
          <ChatMessagesArea
            messages={messages}
            streamingContent={streamingContent}
            streamingMsgId={streamingMsgIdRef.current}
            loading={loading}
            toolCalls={toolCalls}
            agentColor={agentColor}
            userColor={userColor}
            isDark={isDark}
            conversationId={activeConversationId ?? undefined}
            emptyIcon={<Sparkle size={40} weight="duotone" color={userColor} />}
            emptyText={activeAgent?.name ? `Start chatting with ${activeAgent.name}` : t('chat.start_conversation')}
            thinkingText={t('chat.thinking')}
            onEditMessage={handleEditMessage}
            onRegenerate={handleRegenerate}
          />
          <ChatInputArea
            input={input}
            setInput={setInput}
            handleSend={handleSend}
            handleKeyDown={handleKeyDown}
            loading={loading}
            conversationId={activeConversationId}
            agentName={activeAgent?.name}
            agentColor={agentColor}
            userColor={userColor}
            isDark={isDark}
            placeholder={!activeConversationId ? t('chat.start_conversation') : t('chat.input_placeholder')}
            onStop={handleStop}
            attachments={attachments}
            onAttachmentsChange={setAttachments}
            hasFileTool={activeAgent?.toolIds?.includes('file') ?? false}
          />
        </>
      )}

      <Dialog
        open={permissionRequest !== null}
        onClose={() => handlePermissionResponse(false, false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <ShieldWarning size={20} weight="fill" color="#FF9800" />
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

      <Dialog
        open={deleteConvConfirm !== null}
        onClose={() => setDeleteConvConfirm(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>{t('chat.delete_confirm_title')}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            {t('chat.delete_confirm_message', {
              name: conversations.find((c) => c.id === deleteConvConfirm)?.title || '',
              defaultValue: `Are you sure you want to delete this conversation? All messages will be permanently lost.`,
            })}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteConvConfirm(null)}>{t('chat.cancel', { defaultValue: 'Cancel' })}</Button>
          <Button
            color="error"
            variant="contained"
            onClick={() => deleteConvConfirm && handleDeleteConversation(deleteConvConfirm)}
          >
            {t('chat.delete', { defaultValue: 'Delete' })}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

function EmptyState({ type, t, agentColor }: {
  type: 'no_agent' | 'no_messages';
  t: (key: string, options?: { defaultValue: string }) => string;
  agentColor: string;
}) {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const userColor = isDark ? '#6C63FF' : '#5B54E0';

  return (
    <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1.5, px: 3, opacity: 0.6 }}>
      <Box sx={{
        width: 56, height: 56, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: type === 'no_agent' ? `${agentColor}12` : `${userColor}12`, mb: 0.5,
      }}>
        {type === 'no_agent' ? (
          <Robot size={28} weight="duotone" color={agentColor} />
        ) : (
          <Sparkle size={28} weight="duotone" color={userColor} />
        )}
      </Box>
      <Typography variant="body2" sx={{ fontWeight: 600, textAlign: 'center', fontSize: 14 }}>
        {type === 'no_agent' ? t('chat.select_agent_placeholder') : t('chat.start_conversation')}
      </Typography>
      <Typography variant="caption" sx={{ color: 'text.secondary', textAlign: 'center', maxWidth: 240 }}>
        {type === 'no_agent' ? 'Select an agent from the dropdown above, or create one in the Agent Manager tab' : t('chat.input_placeholder')}
      </Typography>
    </Box>
  );
}
