import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import {
  Box, Typography, Paper, IconButton, TextField, CircularProgress, Collapse, Chip, Tooltip,
} from '@mui/material';
import {
  PaperPlaneTilt as SendIcon, Stop, Robot, User,
  Terminal, Wrench, PaperclipIcon, XIcon, Package,
  BrainIcon, CheckCircleIcon, WarningCircleIcon, ArrowsDownUpIcon,
} from '@phosphor-icons/react';
import { open } from '@tauri-apps/plugin-dialog';
import { useTranslation } from 'react-i18next';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { MessageDto } from '../../proto/agent';

export interface ToolCallDisplay {
  id: string;
  toolName: string;
  arguments: Record<string, unknown>;
  result: string | null;
  success: boolean | null;
  status: 'running' | 'done' | 'denied';
}

interface ParsedToolCall {
  id: string;
  name: string;
  arguments: string;
}

function parseToolCalls(toolCallsStr: string): ParsedToolCall[] {
  if (!toolCallsStr || toolCallsStr === '[]' || toolCallsStr === '') return [];
  try {
    const parsed = JSON.parse(toolCallsStr);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((tc: any) => ({
      id: tc.id || '',
      name: tc.function?.name || tc.name || '',
      arguments: tc.function?.arguments || tc.arguments || '{}',
    }));
  } catch {
    return [];
  }
}

function parseArguments(argsStr: string): Record<string, unknown> {
  if (!argsStr) return {};
  try {
    const parsed = JSON.parse(argsStr);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    return {};
  } catch {
    return {};
  }
}

function extractToolCallIdFromMsgId(msgId: string, convId: string): string | null {
  const prefix = `tool-${convId}-`;
  if (msgId.startsWith(prefix)) {
    return msgId.slice(prefix.length) || null;
  }
  if (msgId.startsWith('tool-')) {
    return msgId.slice(5) || null;
  }
  return null;
}

export interface ChatMessagesAreaProps {
  messages: MessageDto[];
  streamingContent: string;
  streamingMsgId: string | null;
  loading: boolean;
  toolCalls: ToolCallDisplay[];
  agentColor: string;
  userColor: string;
  isDark: boolean;
  conversationId?: string;
  emptyIcon?: React.ReactNode;
  emptyText?: string;
  thinkingText?: string;
  onEditMessage?: (messageId: string, content: string) => void;
  onRegenerate?: (messageId: string) => void;
}

const markdownStyles = (agentColor: string, isDark: boolean) => ({
  '& p': { m: 0, mb: 0.5 },
  '& p:last-child': { mb: 0 },
  '& pre': { bgcolor: isDark ? 'rgba(0,0,0,0.3)' : 'rgba(0,0,0,0.06)', p: 1, borderRadius: 1, overflow: 'auto', fontSize: 12 },
  '& code': { fontFamily: 'monospace', fontSize: 12, bgcolor: isDark ? 'rgba(0,0,0,0.2)' : 'rgba(0,0,0,0.05)', px: 0.5, borderRadius: 0.5 },
  '& pre code': { bgcolor: 'transparent', px: 0 },
  '& ul, & ol': { pl: 2, m: 0 },
  '& li': { mb: 0.25 },
  '& h1, & h2, & h3, & h4': { m: 0, mb: 0.5, fontSize: 'inherit', fontWeight: 700 },
  '& blockquote': { borderLeft: `3px solid ${agentColor}40`, pl: 1.5, m: 0, color: 'text.secondary' },
  '& a': { color: agentColor, textDecoration: 'none' },
  '& table': { borderCollapse: 'collapse', fontSize: 12, width: '100%' },
  '& th, & td': { border: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`, px: 1, py: 0.5 },
  '& th': { bgcolor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)', fontWeight: 600 },
});

export function ChatMessagesArea({
  messages, streamingContent, streamingMsgId, loading, toolCalls,
  agentColor, userColor, isDark, conversationId, emptyIcon, emptyText, thinkingText,
  onEditMessage, onRegenerate,
}: ChatMessagesAreaProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent, toolCalls]);

  const groupedMessages = useMemo(() => {
    const groups: Array<{
      id: string;
      type: 'user' | 'assistant_turn';
      userMsg?: MessageDto;
      assistantMsg?: MessageDto;
      toolMessages: MessageDto[];
      parsedToolCalls: ParsedToolCall[];
    }> = [];

    let i = 0;
    while (i < messages.length) {
      const msg = messages[i];
      if (msg.role === 'user') {
        groups.push({ id: msg.id, type: 'user', userMsg: msg, toolMessages: [], parsedToolCalls: [] });
        i++;
      } else if (msg.role === 'assistant') {
        const parsedTc = parseToolCalls(msg.toolCalls);
        const toolMsgs: MessageDto[] = [];
        const assistantId = msg.id;
        i++;
        while (i < messages.length && messages[i].role === 'tool') {
          toolMsgs.push(messages[i]);
          i++;
        }
        groups.push({ id: assistantId, type: 'assistant_turn', assistantMsg: msg, toolMessages: toolMsgs, parsedToolCalls: parsedTc });
      } else if (msg.role === 'tool') {
        groups.push({ id: msg.id, type: 'assistant_turn', toolMessages: [msg], parsedToolCalls: [] });
        i++;
      } else {
        i++;
      }
    }
    return groups;
  }, [messages]);

  return (
    <Box sx={{ flex: 1, overflow: 'auto', px: 2, py: 1.5 }}>
      {messages.length === 0 && !loading && emptyText && (
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 1 }}>
          {emptyIcon}
          <Typography variant="body2" sx={{ color: 'text.secondary', textAlign: 'center', maxWidth: 300, lineHeight: 1.6 }}>
            {emptyText}
          </Typography>
        </Box>
      )}
      {groupedMessages.map((group, idx) => {
        if (group.type === 'user' && group.userMsg) {
          const isLastUserMsg = idx === groupedMessages.length - 1 || (idx < groupedMessages.length - 1 && groupedMessages[idx + 1].type === 'assistant_turn');
          return <UserMessageBubble key={group.id} msg={group.userMsg} userColor={userColor} isDark={isDark} onEdit={onEditMessage} showActions={isLastUserMsg} />;
        }
        if (group.type === 'assistant_turn') {
          const isStreaming = group.assistantMsg?.id === streamingMsgId && loading;
          const displayContent = isStreaming ? streamingContent : (group.assistantMsg?.content || '');
          const hasToolCalls = group.parsedToolCalls.length > 0 || toolCalls.length > 0;
          const hasContent = displayContent.trim().length > 0;
          const isThinking = isStreaming && !hasContent && !hasToolCalls;
          const isLastGroup = idx === groupedMessages.length - 1;

          return (
            <AssistantTurnGroup
              key={group.id}
              isStreaming={isStreaming}
              thinkingText={thinkingText}
              isThinking={isThinking}
              parsedToolCalls={group.parsedToolCalls}
              streamingToolCalls={isStreaming ? toolCalls : []}
              toolMessages={group.toolMessages}
              displayContent={displayContent}
              hasContent={hasContent}
              agentColor={agentColor}
              isDark={isDark}
              conversationId={conversationId}
              onRegenerate={isLastGroup && !isStreaming ? onRegenerate : undefined}
              assistantMsgId={group.assistantMsg?.id}
            />
          );
        }
        return null;
      })}
      <div ref={messagesEndRef} />
    </Box>
  );
}

function UserMessageBubble({ msg, userColor, isDark, onEdit, showActions }: { msg: MessageDto; userColor: string; isDark: boolean; onEdit?: (messageId: string, content: string) => void; showActions?: boolean }) {
  const [hovered, setHovered] = useState(false);
  return (
    <Box sx={{ display: 'flex', gap: 1, mb: 1.5, flexDirection: 'row-reverse', alignItems: 'flex-start' }}
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <Box sx={{
        width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: `linear-gradient(135deg, ${userColor} 0%, ${isDark ? '#8B83FF' : '#7B75FF'} 100%)`,
        color: '#fff', flexShrink: 0, mt: 0.25,
      }}>
        <User size={14} weight="bold" />
      </Box>
      <Box sx={{ maxWidth: '82%', minWidth: 0 }}>
        <Box sx={{
          px: 1.5, py: 1,
          bgcolor: `${userColor}15`,
          border: '1px solid', borderColor: `${userColor}20`,
          fontSize: 13, lineHeight: 1.6,
          borderRadius: '16px 16px 4px 16px',
          whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        }}>
          {msg.content}
        </Box>
        {showActions && onEdit && hovered && (
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 0.25 }}>
            <Tooltip title="Edit">
              <IconButton size="small" onClick={() => onEdit(msg.id, msg.content)}
                sx={{ opacity: 0.6, '&:hover': { opacity: 1 }, p: 0.25 }}>
                <ArrowsDownUpIcon size={12} />
              </IconButton>
            </Tooltip>
          </Box>
        )}
      </Box>
    </Box>
  );
}

interface AssistantTurnGroupProps {
  isStreaming: boolean;
  thinkingText?: string;
  isThinking: boolean;
  parsedToolCalls: ParsedToolCall[];
  streamingToolCalls: ToolCallDisplay[];
  toolMessages: MessageDto[];
  displayContent: string;
  hasContent: boolean;
  agentColor: string;
  isDark: boolean;
  conversationId?: string;
  onRegenerate?: (messageId: string) => void;
  assistantMsgId?: string;
}

function AssistantTurnGroup({
  isStreaming, thinkingText, isThinking,
  parsedToolCalls, streamingToolCalls, toolMessages,
  displayContent, hasContent, agentColor, isDark, conversationId,
  onRegenerate, assistantMsgId,
}: AssistantTurnGroupProps) {
  const showThinking = isThinking;
  const showToolCalls = parsedToolCalls.length > 0 || streamingToolCalls.length > 0;
  const showToolResults = toolMessages.length > 0;
  const showContent = hasContent;

  return (
    <Box sx={{ display: 'flex', gap: 1, mb: 1.5, alignItems: 'flex-start' }}>
      <Box sx={{
        width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: `linear-gradient(135deg, ${agentColor} 0%, ${isDark ? '#29B6F6' : '#0277BD'} 100%)`,
        color: '#fff', flexShrink: 0, mt: 0.25,
      }}>
        <Robot size={14} weight="bold" />
      </Box>
      <Box sx={{ maxWidth: '85%', minWidth: 0, flex: 1 }}>
        {showThinking && (
          <ThinkingIndicator thinkingText={thinkingText} agentColor={agentColor} />
        )}
        {showToolCalls && (
          <Box sx={{ mb: 0.75 }}>
            {parsedToolCalls.map((tc, idx) => {
              const streamingMatch = streamingToolCalls.find((stc) => stc.toolName === tc.name);
              const toolResult = toolMessages.find((tm) => {
                const tcId = extractToolCallIdFromMsgId(tm.id, conversationId || '');
                return tcId && tc.id && tcId === tc.id;
              }) || toolMessages[idx];
              const isSuccess = toolResult ? toolResult.isError !== 1 : null;
              return (
                <PersistentToolCallCard
                  key={tc.id || idx}
                  toolCall={tc}
                  result={toolResult?.content || streamingMatch?.result || null}
                  success={isSuccess ?? streamingMatch?.success ?? null}
                  status={streamingMatch?.status || (toolResult ? 'done' : 'done')}
                  isDark={isDark}
                />
              );
            })}
            {streamingToolCalls
              .filter((stc) => !parsedToolCalls.some((ptc) => ptc.name === stc.toolName))
              .map((stc) => (
                <PersistentToolCallCard
                  key={stc.id}
                  toolCall={{ id: stc.id, name: stc.toolName, arguments: JSON.stringify(stc.arguments) }}
                  result={stc.result}
                  success={stc.success}
                  status={stc.status}
                  isDark={isDark}
                />
              ))}
          </Box>
        )}
        {showToolResults && !showToolCalls && (
          <Box sx={{ mb: 0.75 }}>
            {toolMessages.map((tm, idx) => (
              <ToolResultCard key={tm.id || idx} msg={tm} isDark={isDark} />
            ))}
          </Box>
        )}
        {showContent && (
          <Box sx={{
            px: 1.5, py: 1,
            bgcolor: `${agentColor}08`,
            border: '1px solid', borderColor: `${agentColor}15`,
            fontSize: 13, lineHeight: 1.6,
            borderRadius: '16px 16px 16px 4px',
            ...markdownStyles(agentColor, isDark),
          }}>
            <Markdown remarkPlugins={[remarkGfm]}>{displayContent}</Markdown>
            {isStreaming && <Box component="span" sx={{ color: agentColor, ml: 0.25 }}>▌</Box>}
          </Box>
        )}
        {onRegenerate && assistantMsgId && !isStreaming && (
          <Box sx={{ display: 'flex', justifyContent: 'flex-start', mt: 0.25 }}>
            <Tooltip title="Regenerate">
              <IconButton size="small" onClick={() => onRegenerate(assistantMsgId)}
                sx={{ opacity: 0.5, '&:hover': { opacity: 1 }, p: 0.25 }}>
                <ArrowsDownUpIcon size={12} />
              </IconButton>
            </Tooltip>
          </Box>
        )}
      </Box>
    </Box>
  );
}

function ThinkingIndicator({ thinkingText, agentColor }: { thinkingText?: string; agentColor: string }) {
  return (
    <Box sx={{
      display: 'flex', alignItems: 'center', gap: 1,
      px: 1.5, py: 0.75, mb: 0.5,
      bgcolor: `${agentColor}06`,
      border: '1px solid', borderColor: `${agentColor}12`,
      borderRadius: '12px 12px 12px 4px',
      fontSize: 12,
    }}>
      <CircularProgress size={12} sx={{ color: agentColor }} />
      <BrainIcon size={14} weight="duotone" style={{ color: agentColor, opacity: 0.7 }} />
      <Typography variant="caption" sx={{ color: 'text.secondary', fontStyle: 'italic' }}>
        {thinkingText || 'Thinking...'}
      </Typography>
      <Box sx={{ display: 'flex', gap: 0.25 }}>
        {[0, 1, 2].map((i) => (
          <Box key={i} sx={{
            width: 3, height: 3, borderRadius: '50%', bgcolor: agentColor, opacity: 0.3 + i * 0.25,
            animation: 'pulse 1.5s ease-in-out infinite', animationDelay: `${i * 0.3}s`,
            '@keyframes pulse': { '0%, 100%': { opacity: 0.2 }, '50%': { opacity: 1 } },
          }} />
        ))}
      </Box>
    </Box>
  );
}

interface PersistentToolCallCardProps {
  toolCall: ParsedToolCall;
  result: string | null;
  success: boolean | null;
  status: 'running' | 'done' | 'denied';
  isDark: boolean;
}

function PersistentToolCallCard({ toolCall, result, success, status, isDark }: PersistentToolCallCardProps) {
  const isRunning = status === 'running';
  const [expanded, setExpanded] = useState(!isRunning && !!result);
  const isDenied = status === 'denied';
  const isSuccess = success === true;
  const args = parseArguments(toolCall.arguments);

  const borderColor = isRunning ? 'rgba(255,183,77,0.4)' : isDenied ? 'rgba(255,152,0,0.4)' : isSuccess ? 'rgba(129,199,132,0.4)' : 'rgba(255,123,114,0.4)';
  const bgColor = isRunning ? 'rgba(255,183,77,0.06)' : isDenied ? 'rgba(255,152,0,0.06)' : isSuccess ? 'rgba(129,199,132,0.06)' : 'rgba(255,123,114,0.06)';
  const statusLabel = isRunning ? 'Running' : isDenied ? 'Denied' : isSuccess ? 'Done' : 'Failed';
  const statusColor = isRunning ? '#FFB74D' : isDenied ? '#FF9800' : isSuccess ? '#81C784' : '#FF7B72';

  const isPluginManager = toolCall.name === 'plugin_manager';
  const actionLabel = isPluginManager && args?.action ? String(args.action) : '';
  const summaryText = isPluginManager && actionLabel
    ? `plugin_manager → ${actionLabel}`
    : toolCall.name === 'terminal' && args?.command
      ? String(args.command)
      : toolCall.name;

  return (
    <Paper variant="outlined" sx={{ mb: 0.5, borderRadius: 1.5, overflow: 'hidden', borderColor, bgcolor: bgColor }}>
      <Box
        sx={{ display: 'flex', alignItems: 'center', gap: 0.75, px: 1, py: 0.5, cursor: 'pointer', fontSize: 12 }}
        onClick={() => setExpanded(!expanded)}
      >
        {isRunning ? (
          <CircularProgress size={12} sx={{ color: '#FFB74D' }} />
        ) : isDenied ? (
          <WarningCircleIcon size={14} weight="fill" color="#FF9800" />
        ) : isSuccess ? (
          <CheckCircleIcon size={14} weight="fill" color="#81C784" />
        ) : (
          <WarningCircleIcon size={14} weight="fill" color="#FF7B72" />
        )}
        <Box sx={{ color: 'text.secondary', display: 'flex' }}>
          {toolCall.name === 'terminal' ? <Terminal size={14} weight="bold" /> : <Wrench size={14} weight="bold" />}
        </Box>
        <Typography variant="caption" sx={{ fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {summaryText}
        </Typography>
        <Chip
          label={statusLabel}
          size="small"
          sx={{
            height: 16, fontSize: 9, fontWeight: 600, minWidth: 40,
            bgcolor: `${statusColor}18`, color: statusColor, border: `1px solid ${statusColor}30`,
            '& .MuiChip-label': { px: 0.5 },
          }}
        />
        <Box sx={{ color: 'text.secondary', display: 'flex', alignItems: 'center', cursor: 'pointer' }} onClick={() => setExpanded(!expanded)}>
          <ArrowsDownUpIcon size={10} />
        </Box>
      </Box>
      <Collapse in={expanded}>
        <Box sx={{ px: 1, pb: 0.75, borderTop: '1px solid', borderColor: 'divider' }}>
          <Box sx={{ mt: 0.5 }}>
            <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: 10 }}>
              {toolCall.name === 'terminal' ? 'Command' : 'Arguments'}
            </Typography>
            <Box sx={{
              fontFamily: 'monospace', fontSize: 11, bgcolor: isDark ? 'rgba(0,0,0,0.3)' : 'rgba(0,0,0,0.06)',
              p: 0.75, borderRadius: 1, mt: 0.25, whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 150, overflow: 'auto',
            }}>
              {toolCall.name === 'terminal' && args.command
                ? String(args.command)
                : JSON.stringify(args, null, 2)}
            </Box>
          </Box>
          {result && (
            <Box sx={{ mt: 0.5 }}>
              <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: 10 }}>Output</Typography>
              <Box sx={{
                fontFamily: 'monospace', fontSize: 11, bgcolor: isDark ? 'rgba(0,0,0,0.3)' : 'rgba(0,0,0,0.06)',
                p: 0.75, borderRadius: 1, mt: 0.25, whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 250, overflow: 'auto',
                color: isSuccess ? '#81C784' : isDenied ? '#FF9800' : '#FF7B72',
              }}>
                {result.length > 800 ? result.slice(0, 800) + '...' : result}
              </Box>
            </Box>
          )}
        </Box>
      </Collapse>
    </Paper>
  );
}

function ToolResultCard({ msg, isDark }: { msg: MessageDto; isDark: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const isFailed = msg.isError === 1;

  return (
    <Paper variant="outlined" sx={{
      mb: 0.5, borderRadius: 1.5, overflow: 'hidden',
      borderColor: isFailed ? 'rgba(255,123,114,0.4)' : 'rgba(129,199,132,0.4)',
      bgcolor: isFailed ? 'rgba(255,123,114,0.06)' : 'rgba(129,199,132,0.06)',
    }}>
      <Box
        sx={{ display: 'flex', alignItems: 'center', gap: 0.75, px: 1, py: 0.5, cursor: 'pointer', fontSize: 12 }}
        onClick={() => setExpanded(!expanded)}
      >
        {isFailed ? (
          <WarningCircleIcon size={14} weight="fill" color="#FF7B72" />
        ) : (
          <CheckCircleIcon size={14} weight="fill" color="#81C784" />
        )}
        <Typography variant="caption" sx={{ fontWeight: 600, flex: 1 }}>
          {isFailed ? 'Execution Failed' : 'Tool Result'}
        </Typography>
        <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: 10, display: 'flex', alignItems: 'center' }}>
          <ArrowsDownUpIcon size={10} />
        </Typography>
      </Box>
      <Collapse in={expanded}>
        <Box sx={{ px: 1, pb: 0.75, borderTop: '1px solid', borderColor: 'divider' }}>
          <Box sx={{
            fontFamily: 'monospace', fontSize: 11, bgcolor: isDark ? 'rgba(0,0,0,0.3)' : 'rgba(0,0,0,0.06)',
            p: 0.75, borderRadius: 1, mt: 0.5, whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 250, overflow: 'auto',
            color: isFailed ? '#FF7B72' : '#81C784',
          }}>
            {msg.content.length > 800 ? msg.content.slice(0, 800) + '...' : msg.content}
          </Box>
        </Box>
      </Collapse>
    </Paper>
  );
}

export interface FileAttachment {
  path: string;
  name: string;
}

export interface ChatInputAreaProps {
  input: string;
  setInput: (v: string) => void;
  handleSend: () => void;
  handleKeyDown: (e: React.KeyboardEvent) => void;
  loading: boolean;
  conversationId: string | null;
  agentName?: string;
  agentColor: string;
  userColor: string;
  isDark: boolean;
  placeholder?: string;
  onStop?: () => void;
  attachments?: FileAttachment[];
  onAttachmentsChange?: (files: FileAttachment[]) => void;
  hasFileTool?: boolean;
}

export function ChatInputArea({
  input, setInput, handleSend, handleKeyDown, loading, conversationId,
  agentName, agentColor, userColor, isDark, placeholder, onStop,
  attachments = [], onAttachmentsChange, hasFileTool = true,
}: ChatInputAreaProps) {
  const { t } = useTranslation('agent');
  const mutedBorder = isDark ? 'rgba(48,54,61,0.6)' : 'rgba(0,0,0,0.08)';
  const mutedBg = isDark ? 'rgba(48,54,61,0.1)' : 'rgba(0,0,0,0.03)';

  const handleAttachFile = useCallback(async () => {
    try {
      const selected = await open({
        multiple: true,
        title: t('plugin_page.attach_file'),
      });
      if (selected) {
        const paths = Array.isArray(selected) ? selected : [selected];
        const newFiles: FileAttachment[] = paths.map((p) => {
          const parts = p.split(/[/\\]/);
          return { path: p, name: parts[parts.length - 1] || p };
        });
        const existingPaths = new Set(attachments.map((a) => a.path));
        const unique = newFiles.filter((f) => !existingPaths.has(f.path));
        if (unique.length > 0) {
          onAttachmentsChange?.([...attachments, ...unique]);
        }
      }
    } catch (err) { console.error('ChatComponents: operation failed', err); }
  }, [attachments, onAttachmentsChange, t]);

  const handleRemoveAttachment = useCallback((path: string) => {
    onAttachmentsChange?.(attachments.filter((a) => a.path !== path));
  }, [attachments, onAttachmentsChange]);

  return (
    <Box sx={{ px: 2, pb: 1.5, pt: 0.5 }}>
      <Box sx={{
        display: 'flex', flexDirection: 'column', borderRadius: 1.5,
        border: '1px solid', borderColor: conversationId ? `${userColor}25` : mutedBorder,
        bgcolor: conversationId ? `${userColor}05` : mutedBg,
        overflow: 'hidden', transition: 'border-color 0.2s, background-color 0.2s',
        '&:focus-within': { borderColor: `${userColor}50`, bgcolor: `${userColor}08` },
      }}>
        {agentName && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, px: 1.5, pt: 1, pb: 0 }}>
            <Box sx={{
              width: 16, height: 16, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: `linear-gradient(135deg, ${agentColor} 0%, ${isDark ? '#29B6F6' : '#0277BD'} 100%)`,
              color: '#fff', flexShrink: 0,
            }}>
              <Robot size={8} weight="bold" />
            </Box>
            <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: 10, fontWeight: 500 }}>
              {agentName}
            </Typography>
          </Box>
        )}
        {attachments.length > 0 && (
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, px: 1.5, pt: 0.5 }}>
            {attachments.map((file) => (
              <Chip
                key={file.path}
                icon={<PaperclipIcon size={10} weight="bold" />}
                label={file.name}
                size="small"
                onDelete={() => handleRemoveAttachment(file.path)}
                deleteIcon={<XIcon size={10} />}
                sx={{ height: 22, fontSize: 10, maxWidth: 200, '& .MuiChip-label': { overflow: 'hidden', textOverflow: 'ellipsis' } }}
              />
            ))}
          </Box>
        )}
        <Box sx={{ display: 'flex', alignItems: 'flex-end', px: 0.5, py: 0.5 }}>
          <Tooltip title={t('plugin_page.attach_file')} arrow>
            <span>
              <IconButton
                size="small"
                onClick={handleAttachFile}
                disabled={loading || !conversationId || !hasFileTool}
                sx={{ borderRadius: 2, mb: 0.25, color: isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.3)', '&:hover': { color: userColor, bgcolor: `${userColor}10` } }}
              >
                <PaperclipIcon size={16} weight="bold" />
              </IconButton>
            </span>
          </Tooltip>
          <TextField
            fullWidth variant="standard" multiline minRows={1} maxRows={4}
            value={input} onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown} placeholder={placeholder}
            disabled={loading || !conversationId}
            slotProps={{ input: { disableUnderline: true } }}
            sx={{
              '& .MuiInputBase-root': { fontSize: 13, px: 1, py: 0.5, minHeight: 28, alignItems: 'flex-start' },
              '& .MuiInputBase-input': { lineHeight: 1.5 },
              '& .MuiInputBase-input::placeholder': { color: 'text.secondary', opacity: 0.6 },
            }}
          />
          {loading ? (
            <IconButton size="small" onClick={onStop} sx={{ borderRadius: 2, mr: 0.5, mb: 0.25, color: '#FF7B72', '&:hover': { bgcolor: 'rgba(255,123,114,0.1)' } }}>
              <Stop size={16} weight="fill" />
            </IconButton>
          ) : (
            <IconButton
              size="small" onClick={handleSend}
              disabled={!input.trim() || !conversationId}
              sx={{
                borderRadius: 2, mr: 0.5, mb: 0.25,
                bgcolor: input.trim() && conversationId
                  ? `${userColor}20`
                  : 'transparent',
                color: input.trim() && conversationId
                  ? (isDark ? '#A5A0FF' : userColor)
                  : (isDark ? 'rgba(255,255,255,0.2)' : `${userColor}30`),
                '&:hover': {
                  bgcolor: input.trim() && conversationId
                    ? `${userColor}30`
                    : 'transparent',
                },
                '&.Mui-disabled': { color: isDark ? 'rgba(255,255,255,0.15)' : `${userColor}20` },
                transition: 'all 0.2s',
              }}
            >
              <SendIcon size={16} weight="fill" />
            </IconButton>
          )}
        </Box>
      </Box>
    </Box>
  );
}

export function ToolCallCard({ toolCall }: { toolCall: ToolCallDisplay }) {
  const [expanded, setExpanded] = useState(false);
  const isRunning = toolCall.status === 'running';
  const isDenied = toolCall.status === 'denied';
  const isSuccess = toolCall.success === true;
  const isPluginManager = toolCall.toolName === 'plugin_manager';

  const toolIcon = toolCall.toolName === 'terminal' ? (
    <Terminal size={14} weight="bold" />
  ) : isPluginManager ? (
    <Package size={14} weight="bold" />
  ) : (
    <Wrench size={14} weight="bold" />
  );

  const statusLabel = isRunning ? '⏳ Running' : isDenied ? '⊘ Denied' : isSuccess ? '✓ Done' : '✗ Failed';

  const getActionLabel = () => {
    if (!isPluginManager || !toolCall.arguments) return null;
    const action = toolCall.arguments.action as string;
    if (!action) return null;
    const labels: Record<string, string> = {
      get: 'Reading plugin',
      create: 'Creating plugin',
      refine: 'Refining plugin',
      test: 'Testing plugin',
      delete: 'Deleting plugin',
      list: 'Listing plugins',
      toggle: 'Toggling plugin',
    };
    return labels[action] || action;
  };

  const actionLabel = getActionLabel();

  return (
    <Paper variant="outlined" sx={{
      mb: 0.5, borderRadius: 1.5, overflow: 'hidden',
      borderColor: isRunning ? 'rgba(255,183,77,0.4)' : isDenied ? 'rgba(255,152,0,0.4)' : isSuccess ? 'rgba(129,199,132,0.4)' : 'rgba(255,123,114,0.4)',
      bgcolor: isRunning ? 'rgba(255,183,77,0.06)' : isDenied ? 'rgba(255,152,0,0.06)' : isSuccess ? 'rgba(129,199,132,0.06)' : 'rgba(255,123,114,0.06)',
    }}>
      <Box
        sx={{ display: 'flex', alignItems: 'center', gap: 0.75, px: 1, py: 0.5, cursor: 'pointer', fontSize: 12 }}
        onClick={() => setExpanded(!expanded)}
      >
        {isRunning ? (
          <CircularProgress size={12} sx={{ color: '#FFB74D' }} />
        ) : isDenied ? (
          <Box sx={{ color: '#FF9800', display: 'flex' }}>⊘</Box>
        ) : isSuccess ? (
          <Box sx={{ color: '#81C784', display: 'flex' }}>✓</Box>
        ) : (
          <Box sx={{ color: '#FF7B72', display: 'flex' }}>✗</Box>
        )}
        <Box sx={{ color: 'text.secondary', display: 'flex' }}>{toolIcon}</Box>
        <Typography variant="caption" sx={{ fontWeight: 600, flex: 1 }}>
          {actionLabel ? `${actionLabel}...` : toolCall.toolName}
        </Typography>
        {toolCall.arguments && toolCall.toolName === 'terminal' && typeof toolCall.arguments.command === 'string' && (
          <Typography variant="caption" sx={{ fontFamily: 'monospace', color: 'text.secondary', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 }}>
            {toolCall.arguments.command}
          </Typography>
        )}
        {isPluginManager && toolCall.arguments && 'name' in toolCall.arguments && toolCall.arguments.name != null && (
          <Typography variant="caption" sx={{ color: 'text.secondary', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 150 }}>
            {String(toolCall.arguments.name)}
          </Typography>
        )}
        <Typography variant="caption" sx={{ color: isRunning ? '#FFB74D' : 'text.secondary', fontSize: 10 }}>
          {isRunning ? statusLabel : '▼'}
        </Typography>
      </Box>
      <Collapse in={expanded}>
        <Box sx={{ px: 1, pb: 0.75, borderTop: '1px solid', borderColor: 'divider' }}>
          {toolCall.arguments && (
            <Box sx={{ mt: 0.5 }}>
              <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: 10 }}>
                {toolCall.toolName === 'terminal' ? 'Command' : 'Arguments'}
              </Typography>
              <Box sx={{
                fontFamily: 'monospace', fontSize: 11, bgcolor: 'rgba(0,0,0,0.2)',
                p: 0.5, borderRadius: 1, mt: 0.25, whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 120, overflow: 'auto',
              }}>
                {toolCall.toolName === 'terminal' && toolCall.arguments.command
                  ? String(toolCall.arguments.command)
                  : JSON.stringify(toolCall.arguments, null, 2)}
              </Box>
            </Box>
          )}
          {toolCall.result && (
            <Box sx={{ mt: 0.5 }}>
              <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: 10 }}>Output</Typography>
              <Box sx={{
                fontFamily: 'monospace', fontSize: 11, bgcolor: 'rgba(0,0,0,0.2)',
                p: 0.5, borderRadius: 1, mt: 0.25, whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 200, overflow: 'auto',
                color: isSuccess ? '#81C784' : '#FF7B72',
              }}>
                {toolCall.result.length > 500 ? toolCall.result.slice(0, 500) + '...' : toolCall.result}
              </Box>
            </Box>
          )}
        </Box>
      </Collapse>
    </Paper>
  );
}
