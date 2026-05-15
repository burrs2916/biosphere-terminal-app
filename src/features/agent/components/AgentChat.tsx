import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Box, TextField, IconButton, Typography, Paper, Divider, Chip, CircularProgress,
  Collapse, Select, MenuItem, FormControl,
} from '@mui/material';
import {
  PaperPlaneTilt as PaperPlaneTiltIcon, Robot, User, Plus as PlusIcon, Stop,
  Terminal, Wrench, ChatCircleDotsIcon, Sparkle, TrashIcon,
} from '@phosphor-icons/react';
import { useAgentStore } from '../store/agentStore';
import type { MessageDto } from '../../../proto/agent';
import { useTranslation } from 'react-i18next';
import { listen } from '@tauri-apps/api/event';
import { runAgent, saveMessage } from '../../../core/services/agent.service';

interface StreamChunk {
  conversationId: string;
  chunk: string;
}

interface StreamDone {
  conversationId: string;
  response: string;
}

interface StreamError {
  conversationId: string;
  error: string;
}

interface ToolCallEvent {
  tool_name: string;
  arguments: Record<string, unknown>;
  result: string | null;
  success: boolean | null;
  status: 'running' | 'done';
}

interface ToolCallPayload {
  conversationId: string;
  toolCall: ToolCallEvent;
}

interface ToolCallDisplay {
  id: string;
  toolName: string;
  arguments: Record<string, unknown>;
  result: string | null;
  success: boolean | null;
  status: 'running' | 'done';
}

export function AgentChat() {
  const {
    messages, activeConversationId, activeAgentId,
    agents, conversations, models,
    loadMessages, addMessage, updateMessage, createConversation, deleteConversation,
    loadConversations, loadAgents, loadModels,
  } = useAgentStore();
  const { t } = useTranslation('agent');

  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [toolCalls, setToolCalls] = useState<ToolCallDisplay[]>([]);
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
          const msg: MessageDto = {
            id: msgId,
            conversationId: activeConversationId!,
            role: 'assistant',
            content: event.payload.response,
            toolCalls: '',
            createdAt: Date.now(),
          };
          try { await saveMessage(msg); } catch {}
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
            id,
            toolName: tc.tool_name,
            arguments: tc.arguments,
            result: null,
            success: null,
            status: 'running',
          }]);
        } else {
          setToolCalls((prev) => {
            const last = prev.length - 1;
            if (last >= 0 && prev[last].status === 'running') {
              const updated = [...prev];
              updated[last] = {
                ...updated[last],
                result: tc.result,
                success: tc.success,
                status: 'done',
              };
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
  }, [activeConversationId, updateMessage]);

  const handleSend = useCallback(async () => {
    if (!input.trim() || !activeConversationId || !activeAgentId) return;

    const userMsg: MessageDto = {
      id: crypto.randomUUID(),
      conversationId: activeConversationId,
      role: 'user',
      content: input.trim(),
      toolCalls: '',
      createdAt: Date.now(),
    };

    addMessage(userMsg);
    setInput('');
    setLoading(true);
    setToolCalls([]);
    toolCallCounterRef.current = 0;

    try {
      await saveMessage(userMsg);
    } catch {}

    const assistantMsgId = crypto.randomUUID();
    streamingMsgIdRef.current = assistantMsgId;

    const assistantMsg: MessageDto = {
      id: assistantMsgId,
      conversationId: activeConversationId,
      role: 'assistant',
      content: '',
      toolCalls: '',
      createdAt: Date.now(),
    };
    addMessage(assistantMsg);
    setStreamingContent('');

    try {
      await runAgent(activeAgentId, input.trim(), activeConversationId);
    } catch (e) {
      updateMessage(assistantMsgId, `❌ ${String(e)}`);
      setStreamingContent('');
      setLoading(false);
      streamingMsgIdRef.current = null;
    }
  }, [input, activeConversationId, activeAgentId, addMessage, updateMessage]);

  const handleStop = () => {
    setLoading(false);
    setStreamingContent('');
    streamingMsgIdRef.current = null;
  };

  const handleNewChat = async () => {
    if (activeAgentId) {
      await createConversation(activeAgentId, t('chat.new_conversation_title'));
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const activeAgent = agents.find((a) => a.id === activeAgentId);
  const activeModel = activeAgent ? models.find((m) => m.id === activeAgent.modelId) : null;

  return (
    <Box sx={{ height: '100%', width: '100%', display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
      {/* ===== Header: Agent Selector + Conversation Tabs ===== */}
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
                    <Box
                      sx={{
                        width: 22,
                        height: 22,
                        borderRadius: '50%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        background: 'linear-gradient(135deg, #CE93D8 0%, #EA80FC 100%)',
                        color: '#fff',
                        flexShrink: 0,
                      }}
                    >
                      <Robot size={11} weight="bold" />
                    </Box>
                    <Typography variant="body2" sx={{ fontWeight: 600, fontSize: 13 }}>
                      {agent?.name || ''}
                    </Typography>
                    {model && (
                      <Typography
                        variant="caption"
                        sx={{
                          color: 'text.secondary',
                          fontSize: 10,
                          bgcolor: 'rgba(206,147,216,0.1)',
                          px: 0.75,
                          py: 0.25,
                          borderRadius: 1,
                        }}
                      >
                        {model.name}
                      </Typography>
                    )}
                  </Box>
                );
              }}
              sx={{
                borderRadius: 2,
                bgcolor: 'rgba(206,147,216,0.04)',
                '& .MuiSelect-select': { py: 0.75, pr: 3 },
                '& .MuiOutlinedInput-notchedOutline': {
                  borderColor: 'rgba(206,147,216,0.15)',
                },
                '&:hover .MuiOutlinedInput-notchedOutline': {
                  borderColor: 'rgba(206,147,216,0.3)',
                },
                '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
                  borderColor: 'rgba(206,147,216,0.5)',
                },
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
                      <Box
                        sx={{
                          width: 24,
                          height: 24,
                          borderRadius: '50%',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          background: 'linear-gradient(135deg, #CE93D8 0%, #EA80FC 100%)',
                          color: '#fff',
                          flexShrink: 0,
                        }}
                      >
                        <Robot size={12} weight="bold" />
                      </Box>
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography variant="body2" sx={{ fontWeight: 600, fontSize: 13 }}>
                          {agent.name}
                        </Typography>
                        {agent.description && (
                          <Typography
                            variant="caption"
                            sx={{ color: 'text.secondary', fontSize: 10, display: 'block' }}
                            noWrap
                          >
                            {agent.description}
                          </Typography>
                        )}
                      </Box>
                      {model && (
                        <Chip
                          label={model.name}
                          size="small"
                          sx={{ height: 18, fontSize: 9, flexShrink: 0 }}
                        />
                      )}
                    </Box>
                  </MenuItem>
                );
              })}
            </Select>
          </FormControl>
          <IconButton
            size="small"
            onClick={handleNewChat}
            disabled={!activeAgentId}
            sx={{
              borderRadius: 2,
              border: '1px solid rgba(206,147,216,0.2)',
              bgcolor: 'rgba(206,147,216,0.04)',
              '&:hover': { bgcolor: 'rgba(206,147,216,0.12)', borderColor: 'rgba(206,147,216,0.3)' },
              '&.Mui-disabled': { opacity: 0.3 },
            }}
          >
            <PlusIcon size={16} weight="bold" color="#CE93D8" />
          </IconButton>
        </Box>

        {/* Conversation Tabs */}
        {conversations.length > 0 && (
          <Box sx={{ display: 'flex', gap: 0.5, overflow: 'auto', '&::-webkit-scrollbar': { height: 3 } }}>
            {conversations.map((conv) => (
              <Chip
                key={conv.id}
                label={conv.title}
                size="small"
                variant={activeConversationId === conv.id ? 'filled' : 'outlined'}
                color={activeConversationId === conv.id ? 'secondary' : 'default'}
                onClick={() => useAgentStore.getState().setActiveConversation(conv.id)}
                onDelete={conversations.length > 1 ? () => deleteConversation(conv.id) : undefined}
                deleteIcon={<TrashIcon size={12} />}
                sx={{
                  height: 24,
                  fontSize: 11,
                  borderRadius: 1.5,
                  '& .MuiChip-deleteIcon': { color: 'rgba(255,123,114,0.5)', '&:hover': { color: '#FF7B72' } },
                }}
              />
            ))}
          </Box>
        )}
      </Box>

      <Divider sx={{ borderColor: 'rgba(48,54,61,0.6)' }} />

      {/* ===== Messages Area ===== */}
      <Box sx={{ flex: 1, overflow: 'auto', px: 2, py: 1.5 }}>
        {!activeAgentId && (
          <EmptyState type="no_agent" t={t} />
        )}
        {activeAgentId && messages.length === 0 && !loading && (
          <EmptyState type="no_messages" t={t} agentName={activeAgent?.name} />
        )}

        {messages.map((msg) => {
          const isStreamingAssistant = msg.role === 'assistant' && msg.id === streamingMsgIdRef.current && loading;
          const displayContent = isStreamingAssistant ? streamingContent : msg.content;
          const isUser = msg.role === 'user';

          return (
            <Box
              key={msg.id}
              sx={{
                display: 'flex',
                gap: 1,
                mb: 1.5,
                flexDirection: isUser ? 'row-reverse' : 'row',
                alignItems: 'flex-start',
              }}
            >
              <Box
                sx={{
                  width: 28,
                  height: 28,
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: isUser
                    ? 'linear-gradient(135deg, #6C63FF 0%, #8B83FF 100%)'
                    : 'linear-gradient(135deg, #CE93D8 0%, #EA80FC 100%)',
                  color: '#fff',
                  flexShrink: 0,
                  mt: 0.25,
                }}
              >
                {isUser ? <User size={14} weight="bold" /> : <Robot size={14} weight="bold" />}
              </Box>
              <Box sx={{ maxWidth: '82%', minWidth: 0 }}>
                {isStreamingAssistant && toolCalls.length > 0 && (
                  <Box sx={{ mb: 0.75 }}>
                    {toolCalls.map((tc) => (
                      <ToolCallCard key={tc.id} toolCall={tc} />
                    ))}
                  </Box>
                )}
                <Box
                  sx={{
                    px: 1.5,
                    py: 1,
                    bgcolor: isUser
                      ? 'rgba(108,99,255,0.1)'
                      : 'rgba(206,147,216,0.06)',
                    border: '1px solid',
                    borderColor: isUser
                      ? 'rgba(108,99,255,0.15)'
                      : 'rgba(206,147,216,0.12)',
                    fontSize: 13,
                    lineHeight: 1.6,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    borderRadius: isUser
                      ? '16px 16px 4px 16px'
                      : '16px 16px 16px 4px',
                  }}
                >
                  {displayContent || (isStreamingAssistant ? (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <CircularProgress size={12} sx={{ color: '#CE93D8' }} />
                      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                        {t('chat.thinking')}
                      </Typography>
                    </Box>
                  ) : null)}
                  {isStreamingAssistant && displayContent && (
                    <Box component="span" sx={{ color: '#CE93D8', ml: 0.25 }}>▌</Box>
                  )}
                </Box>
              </Box>
            </Box>
          );
        })}
        <div ref={messagesEndRef} />
      </Box>

      {/* ===== Input Area ===== */}
      <Box sx={{ px: 2, pb: 1.5, pt: 0.5 }}>
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            borderRadius: 3,
            border: '1px solid',
            borderColor: activeConversationId
              ? 'rgba(108,99,255,0.2)'
              : 'rgba(48,54,61,0.4)',
            bgcolor: activeConversationId
              ? 'rgba(108,99,255,0.03)'
              : 'rgba(48,54,61,0.1)',
            overflow: 'hidden',
            transition: 'border-color 0.2s, background-color 0.2s',
            '&:focus-within': {
              borderColor: 'rgba(108,99,255,0.4)',
              bgcolor: 'rgba(108,99,255,0.05)',
            },
          }}
        >
          {/* Agent info bar */}
          {activeAgentId && activeAgent && (
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 0.75,
                px: 1.5,
                pt: 1,
                pb: 0,
              }}
            >
              <Box
                sx={{
                  width: 16,
                  height: 16,
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'linear-gradient(135deg, #CE93D8 0%, #EA80FC 100%)',
                  color: '#fff',
                  flexShrink: 0,
                }}
              >
                <Robot size={8} weight="bold" />
              </Box>
              <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: 10, fontWeight: 500 }}>
                {activeAgent.name}
              </Typography>
              {activeModel && (
                <>
                  <Typography variant="caption" sx={{ color: 'rgba(206,147,216,0.4)', fontSize: 10 }}>·</Typography>
                  <Typography variant="caption" sx={{ color: 'rgba(206,147,216,0.6)', fontSize: 10 }}>
                    {activeModel.name}
                  </Typography>
                </>
              )}
              {activeAgent.toolIds.length > 0 && (
                <>
                  <Typography variant="caption" sx={{ color: 'rgba(206,147,216,0.4)', fontSize: 10 }}>·</Typography>
                  <Typography variant="caption" sx={{ color: 'rgba(206,147,216,0.6)', fontSize: 10 }}>
                    {activeAgent.toolIds.length} tools
                  </Typography>
                </>
              )}
            </Box>
          )}

          {/* Input row */}
          <Box sx={{ display: 'flex', alignItems: 'flex-end', px: 0.5, py: 0.5 }}>
            <TextField
              fullWidth
              variant="standard"
              placeholder={
                !activeAgentId
                  ? t('chat.select_agent_placeholder')
                  : !activeConversationId
                    ? t('chat.start_conversation')
                    : t('chat.input_placeholder')
              }
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={!activeConversationId || loading}
              multiline
              maxRows={4}
              slotProps={{
                input: {
                  disableUnderline: true,
                },
              }}
              sx={{
                '& .MuiInputBase-root': {
                  fontSize: 13,
                  px: 1,
                  py: 0.5,
                  minHeight: 28,
                  alignItems: 'flex-start',
                },
                '& .MuiInputBase-input': {
                  lineHeight: 1.5,
                },
                '& .MuiInputBase-input::placeholder': {
                  color: 'text.secondary',
                  opacity: 0.6,
                },
              }}
            />
            {loading ? (
              <IconButton
                size="small"
                onClick={handleStop}
                sx={{
                  borderRadius: 2,
                  mr: 0.5,
                  mb: 0.25,
                  color: '#FF7B72',
                  '&:hover': { bgcolor: 'rgba(255,123,114,0.1)' },
                }}
              >
                <Stop size={16} weight="fill" />
              </IconButton>
            ) : (
              <IconButton
                size="small"
                onClick={handleSend}
                disabled={!input.trim() || !activeConversationId}
                sx={{
                  borderRadius: 2,
                  mr: 0.5,
                  mb: 0.25,
                  background: input.trim() && activeConversationId
                    ? 'linear-gradient(135deg, #6C63FF 0%, #8B83FF 100%)'
                    : 'transparent',
                  color: input.trim() && activeConversationId
                    ? '#fff'
                    : 'rgba(108,99,255,0.3)',
                  '&:hover': {
                    background: input.trim() && activeConversationId
                      ? 'linear-gradient(135deg, #8B83FF 0%, #6C63FF 100%)'
                      : 'rgba(108,99,255,0.05)',
                  },
                  '&.Mui-disabled': {
                    color: 'rgba(108,99,255,0.2)',
                  },
                  transition: 'all 0.2s',
                }}
              >
                <PaperPlaneTiltIcon size={16} weight="fill" />
              </IconButton>
            )}
          </Box>
        </Box>
      </Box>
    </Box>
  );
}

function EmptyState({ type, t, agentName }: {
  type: 'no_agent' | 'no_messages';
  t: (key: string, options?: { defaultValue: string }) => string;
  agentName?: string;
}) {
  return (
    <Box
      sx={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 1.5,
        px: 3,
        opacity: 0.6,
      }}
    >
      <Box
        sx={{
          width: 56,
          height: 56,
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: type === 'no_agent'
            ? 'rgba(206,147,216,0.08)'
            : 'rgba(108,99,255,0.08)',
          mb: 0.5,
        }}
      >
        {type === 'no_agent' ? (
          <Robot size={28} weight="duotone" color="#CE93D8" />
        ) : (
          <Sparkle size={28} weight="duotone" color="#6C63FF" />
        )}
      </Box>
      <Typography variant="body2" sx={{ fontWeight: 600, textAlign: 'center', fontSize: 14 }}>
        {type === 'no_agent'
          ? t('chat.select_agent_placeholder')
          : agentName
            ? `Start chatting with ${agentName}`
            : t('chat.start_conversation')}
      </Typography>
      <Typography variant="caption" sx={{ color: 'text.secondary', textAlign: 'center', maxWidth: 240 }}>
        {type === 'no_agent'
          ? 'Select an agent from the dropdown above, or create one in the Agent Manager tab'
          : t('chat.input_placeholder')}
      </Typography>
    </Box>
  );
}

function ToolCallCard({ toolCall }: { toolCall: ToolCallDisplay }) {
  const [expanded, setExpanded] = useState(false);
  const isRunning = toolCall.status === 'running';
  const isSuccess = toolCall.success === true;

  const toolIcon = toolCall.toolName === 'terminal' ? (
    <Terminal size={14} weight="bold" />
  ) : (
    <Wrench size={14} weight="bold" />
  );

  return (
    <Paper
      variant="outlined"
      sx={{
        mb: 0.5,
        borderRadius: 1.5,
        borderColor: isRunning
          ? 'rgba(255,183,77,0.4)'
          : isSuccess
            ? 'rgba(129,199,132,0.4)'
            : 'rgba(255,123,114,0.4)',
        bgcolor: isRunning
          ? 'rgba(255,183,77,0.06)'
          : isSuccess
            ? 'rgba(129,199,132,0.06)'
            : 'rgba(255,123,114,0.06)',
        overflow: 'hidden',
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 0.75,
          px: 1,
          py: 0.5,
          cursor: 'pointer',
          fontSize: 12,
        }}
        onClick={() => setExpanded(!expanded)}
      >
        {isRunning ? (
          <CircularProgress size={12} sx={{ color: '#FFB74D' }} />
        ) : isSuccess ? (
          <Box sx={{ color: '#81C784', display: 'flex' }}>✓</Box>
        ) : (
          <Box sx={{ color: '#FF7B72', display: 'flex' }}>✗</Box>
        )}
        <Box sx={{ color: 'rgba(206,147,216,0.9)', display: 'flex' }}>{toolIcon}</Box>
        <Typography variant="caption" sx={{ fontWeight: 600, flex: 1 }}>
          {toolCall.toolName}
        </Typography>
        {toolCall.arguments && toolCall.toolName === 'terminal' && typeof toolCall.arguments.command === 'string' && (
          <Typography
            variant="caption"
            sx={{
              fontFamily: 'monospace',
              color: 'text.secondary',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              maxWidth: 200,
            }}
          >
            {toolCall.arguments.command}
          </Typography>
        )}
        <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: 10 }}>
          {isRunning ? '...' : '▼'}
        </Typography>
      </Box>
      <Collapse in={expanded}>
        <Box sx={{ px: 1, pb: 0.75, borderTop: '1px solid rgba(48,54,61,0.4)' }}>
          {toolCall.arguments && (
            <Box sx={{ mt: 0.5 }}>
              <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: 10 }}>
                {toolCall.toolName === 'terminal' ? 'Command' : 'Arguments'}
              </Typography>
              <Box
                sx={{
                  fontFamily: 'monospace',
                  fontSize: 11,
                  bgcolor: 'rgba(0,0,0,0.2)',
                  p: 0.5,
                  borderRadius: 1,
                  mt: 0.25,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all',
                  maxHeight: 120,
                  overflow: 'auto',
                }}
              >
                {toolCall.toolName === 'terminal' && toolCall.arguments.command
                  ? String(toolCall.arguments.command)
                  : JSON.stringify(toolCall.arguments, null, 2)}
              </Box>
            </Box>
          )}
          {toolCall.result && (
            <Box sx={{ mt: 0.5 }}>
              <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: 10 }}>
                Output
              </Typography>
              <Box
                sx={{
                  fontFamily: 'monospace',
                  fontSize: 11,
                  bgcolor: 'rgba(0,0,0,0.2)',
                  p: 0.5,
                  borderRadius: 1,
                  mt: 0.25,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all',
                  maxHeight: 200,
                  overflow: 'auto',
                  color: isSuccess ? '#81C784' : '#FF7B72',
                }}
              >
                {toolCall.result.length > 500
                  ? toolCall.result.slice(0, 500) + '...'
                  : toolCall.result}
              </Box>
            </Box>
          )}
        </Box>
      </Collapse>
    </Paper>
  );
}
