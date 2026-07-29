import { useEffect, useRef } from 'react';
import {
  Box, Typography, IconButton, CircularProgress, Button, Chip, Tooltip,
} from '@mui/material';
import { XIcon, Sparkle, CheckCircleIcon, WarningIcon, ArrowClockwiseIcon } from '@phosphor-icons/react';
import { useTheme } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export type AiApplyAction = 'replace' | 'insert' | 'append';

interface AiOptimizeDialogProps {
  open: boolean;
  onClose: () => void;
  onCancel: () => void;
  chunks: string[];
  status: 'running' | 'done' | 'error';
  errorMessage?: string;
  mode: string | null;
  /** Parsed Tiptap JSON result for content modes (null until parsed / for tag mode). */
  resultJson: unknown | null;
  /** Suggested tags for tag mode. */
  suggestedTags: string[];
  canUndo: boolean;
  onApply: (action: AiApplyAction) => void;
  onUndo: () => void;
  onAddTag: (tag: string) => void;
  onAddAllTags: () => void;
}

export function AiOptimizeDialog({
  open,
  onClose,
  onCancel,
  chunks,
  status,
  errorMessage,
  mode,
  resultJson,
  suggestedTags,
  canUndo,
  onApply,
  onUndo,
  onAddTag,
  onAddAllTags,
}: AiOptimizeDialogProps) {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const { t } = useTranslation('notebook');
  const scrollRef = useRef<HTMLDivElement>(null);
  const primaryColor = isDark ? '#6C63FF' : '#5B54E0';

  const fullText = chunks.join('');
  const isTagMode = mode === 'tag';
  const hasContentResult = !isTagMode && resultJson != null;
  const hasTagResult = isTagMode && suggestedTags.length > 0;

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [fullText, suggestedTags]);

  if (!open) return null;

  const markdownStyles = {
    '& p': { mb: 0.5, lineHeight: 1.6, fontSize: '0.8rem', color: isDark ? '#C9D1D9' : '#374151' },
    '& h1, & h2, & h3, & h4': { mt: 1, mb: 0.5, color: isDark ? '#F0F6FC' : '#1A1A2E' },
    '& code': {
      bgcolor: isDark ? 'rgba(110,118,129,0.2)' : 'rgba(108,99,255,0.1)',
      px: 0.5, py: 0.15, borderRadius: 0.5,
      fontSize: '0.75rem', fontFamily: 'monospace',
      color: isDark ? '#E6EDF3' : '#5B54E0',
    },
    '& pre': {
      bgcolor: isDark ? 'rgba(22,27,34,0.6)' : 'rgba(0,0,0,0.03)',
      p: 1.5, borderRadius: 1, overflow: 'auto', my: 1,
      '& code': { bgcolor: 'transparent', px: 0, py: 0 },
    },
    '& ul, & ol': { pl: 2, mb: 0.5 },
    '& li': { mb: 0.25, fontSize: '0.8rem' },
    '& blockquote': {
      borderLeft: `3px solid ${primaryColor}`,
      pl: 1.5, py: 0.5, my: 1,
      bgcolor: `${primaryColor}08`, borderRadius: '0 4px 4px 0',
    },
    '& strong': { color: isDark ? '#F0F6FC' : '#1A1A2E' },
  };

  return (
    <Box
      sx={{
        position: 'fixed',
        bottom: 24,
        right: 24,
        width: 440,
        maxHeight: 420,
        borderRadius: 3,
        border: '1px solid',
        borderColor: isDark ? 'rgba(48,54,61,0.8)' : 'rgba(0,0,0,0.1)',
        bgcolor: isDark ? 'rgba(22,27,34,0.95)' : 'rgba(255,255,255,0.97)',
        backdropFilter: 'blur(12px)',
        boxShadow: isDark
          ? '0 8px 32px rgba(0,0,0,0.5), 0 0 0 1px rgba(48,54,61,0.3)'
          : '0 8px 32px rgba(0,0,0,0.12), 0 0 0 1px rgba(0,0,0,0.05)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        zIndex: 9999,
        animation: 'slideUp 0.25s ease-out',
        '@keyframes slideUp': {
          from: { opacity: 0, transform: 'translateY(20px)' },
          to: { opacity: 1, transform: 'translateY(0)' },
        },
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          px: 2,
          py: 1.25,
          borderBottom: '1px solid',
          borderColor: isDark ? 'rgba(48,54,61,0.6)' : 'rgba(0,0,0,0.06)',
          bgcolor: isDark ? 'rgba(48,54,61,0.3)' : 'rgba(108,99,255,0.03)',
        }}
      >
        {status === 'running' && (
          <CircularProgress size={16} sx={{ color: primaryColor }} />
        )}
        {status === 'done' && (
          <CheckCircleIcon size={16} weight="fill" color="#81C784" />
        )}
        {status === 'error' && (
          <WarningIcon size={16} weight="fill" color="#FF5252" />
        )}
        <Typography
          sx={{
            flex: 1,
            fontSize: 13,
            fontWeight: 600,
            color: isDark ? '#F0F6FC' : '#1A1A2E',
          }}
        >
          {status === 'running' && t('editor.ai_optimizing')}
          {status === 'done' && (isTagMode ? t('editor.ai_tags_suggested') : t('editor.ai_optimize_done'))}
          {status === 'error' && t('editor.ai_optimize_error')}
        </Typography>
        {status === 'done' && hasContentResult && (
          <Chip
            size="small"
            label={t('editor.ai_preview')}
            sx={{ height: 20, fontSize: 10, bgcolor: `${primaryColor}22`, color: primaryColor }}
          />
        )}
        {status === 'running' ? (
          <Button
            size="small"
            onClick={onCancel}
            sx={{
              textTransform: 'none',
              fontSize: 11,
              color: '#FF5252',
              minWidth: 0,
              px: 1,
              py: 0.25,
              borderRadius: 1.5,
              border: '1px solid rgba(255,82,82,0.3)',
              '&:hover': { bgcolor: 'rgba(255,82,82,0.08)' },
            }}
          >
            {t('editor.ai_cancel')}
          </Button>
        ) : (
          <IconButton size="small" onClick={onClose} sx={{ p: 0.25 }}>
            <XIcon size={14} />
          </IconButton>
        )}
      </Box>

      <Box
        ref={scrollRef}
        sx={{
          flex: 1,
          overflow: 'auto',
          px: 2,
          py: 1.5,
          minHeight: 80,
          maxHeight: 280,
        }}
      >
        {status === 'error' ? (
          <Typography sx={{ fontSize: 12, color: '#FF5252', lineHeight: 1.6 }}>
            {errorMessage}
          </Typography>
        ) : isTagMode ? (
          hasTagResult ? (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
              {suggestedTags.map((tag, idx) => (
                <Chip
                  key={`${tag}-${idx}`}
                  label={tag}
                  size="small"
                  sx={{
                    bgcolor: `${primaryColor}1A`,
                    color: isDark ? '#C9D1D9' : '#374151',
                    border: `1px solid ${primaryColor}40`,
                    '& .MuiChip-label': { fontSize: 12 },
                  }}
                  onClick={() => onAddTag(tag)}
                  deleteIcon={<CheckCircleIcon size={12} />}
                  onDelete={() => onAddTag(tag)}
                />
              ))}
            </Box>
          ) : (
            <Typography sx={{ fontSize: 12, color: isDark ? '#8B949E' : '#6B7280' }}>
              {fullText || t('editor.ai_thinking')}
            </Typography>
          )
        ) : fullText ? (
          <Box sx={markdownStyles}>
            <Markdown remarkPlugins={[remarkGfm]}>{fullText}</Markdown>
          </Box>
        ) : (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 2 }}>
            <Sparkle size={14} color={primaryColor} weight="fill" />
            <Typography sx={{ fontSize: 12, color: isDark ? '#8B949E' : '#6B7280' }}>
              {t('editor.ai_thinking')}
            </Typography>
          </Box>
        )}
      </Box>

      {/* Footer: apply actions */}
      {status === 'done' && !isTagMode && (
        <Box
          sx={{
            px: 2,
            py: 1,
            borderTop: '1px solid',
            borderColor: isDark ? 'rgba(48,54,61,0.6)' : 'rgba(0,0,0,0.06)',
            display: 'flex',
            alignItems: 'center',
            gap: 0.5,
            flexWrap: 'wrap',
          }}
        >
          {hasContentResult ? (
            <>
              <Tooltip title={t('editor.ai_apply.replace')}>
                <Button size="small" variant="contained" onClick={() => onApply('replace')}
                  sx={{ textTransform: 'none', fontSize: 11, borderRadius: 1.5, bgcolor: primaryColor }}>
                  {t('editor.ai_apply.replace')}
                </Button>
              </Tooltip>
              <Tooltip title={t('editor.ai_apply.insert')}>
                <Button size="small" onClick={() => onApply('insert')}
                  sx={{ textTransform: 'none', fontSize: 11, borderRadius: 1.5, color: primaryColor, border: `1px solid ${primaryColor}40` }}>
                  {t('editor.ai_apply.insert')}
                </Button>
              </Tooltip>
              <Tooltip title={t('editor.ai_apply.append')}>
                <Button size="small" onClick={() => onApply('append')}
                  sx={{ textTransform: 'none', fontSize: 11, borderRadius: 1.5, color: primaryColor, border: `1px solid ${primaryColor}40` }}>
                  {t('editor.ai_apply.append')}
                </Button>
              </Tooltip>
              {canUndo && (
                <Tooltip title={t('editor.ai_apply.undo')}>
                  <IconButton size="small" onClick={onUndo} sx={{ color: primaryColor }}>
                    <ArrowClockwiseIcon size={15} />
                  </IconButton>
                </Tooltip>
              )}
            </>
          ) : (
            <Typography variant="caption" sx={{ fontSize: 11, color: isDark ? '#8B949E' : '#9E9E9E' }}>
              {t('editor.ai_no_result')}
            </Typography>
          )}
        </Box>
      )}

      {status === 'done' && isTagMode && hasTagResult && (
        <Box
          sx={{
            px: 2,
            py: 1,
            borderTop: '1px solid',
            borderColor: isDark ? 'rgba(48,54,61,0.6)' : 'rgba(0,0,0,0.06)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: 0.5,
          }}
        >
          <Button size="small" variant="contained" onClick={onAddAllTags}
            sx={{ textTransform: 'none', fontSize: 11, borderRadius: 1.5, bgcolor: primaryColor }}>
            {t('editor.ai_apply.add_tags')}
          </Button>
        </Box>
      )}

      {status === 'running' && (
        <Box
          sx={{
            px: 2,
            py: 0.75,
            borderTop: '1px solid',
            borderColor: isDark ? 'rgba(48,54,61,0.6)' : 'rgba(0,0,0,0.06)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <Typography variant="caption" sx={{ fontSize: 10, color: isDark ? '#484F58' : '#9E9E9E' }}>
            {fullText.length > 0 ? `${fullText.length} chars` : ''}
          </Typography>
          <Box
            sx={{
              display: 'flex',
              gap: 0.5,
              '& > span': {
                width: 4,
                height: 4,
                borderRadius: '50%',
                bgcolor: primaryColor,
                opacity: 0.4,
                animation: 'pulse 1.4s infinite ease-in-out',
              },
              '& > span:nth-of-type(2)': { animationDelay: '0.2s' },
              '& > span:nth-of-type(3)': { animationDelay: '0.4s' },
              '@keyframes pulse': {
                '0%, 80%, 100%': { opacity: 0.3, transform: 'scale(0.8)' },
                '40%': { opacity: 1, transform: 'scale(1.2)' },
              },
            }}
          >
            <span /><span /><span />
          </Box>
        </Box>
      )}
    </Box>
  );
}
