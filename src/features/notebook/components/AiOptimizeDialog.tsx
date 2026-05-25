import { useEffect, useRef } from 'react';
import {
  Box, Typography, IconButton, CircularProgress, Button,
} from '@mui/material';
import { XIcon, Sparkle, CheckCircleIcon, WarningIcon } from '@phosphor-icons/react';
import { useTheme } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface AiOptimizeDialogProps {
  open: boolean;
  onClose: () => void;
  onCancel: () => void;
  chunks: string[];
  status: 'running' | 'done' | 'error';
  errorMessage?: string;
}

export function AiOptimizeDialog({ open, onClose, onCancel, chunks, status, errorMessage }: AiOptimizeDialogProps) {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const { t } = useTranslation('notebook');
  const scrollRef = useRef<HTMLDivElement>(null);
  const primaryColor = isDark ? '#6C63FF' : '#5B54E0';

  const fullText = chunks.join('');

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [fullText]);

  useEffect(() => {
    if (status === 'done') {
      const timer = setTimeout(onClose, 1500);
      return () => clearTimeout(timer);
    }
  }, [status, onClose]);

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
        width: 420,
        maxHeight: 360,
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
          {status === 'running' && (t('editor.ai_optimizing') || 'AI 正在优化笔记...')}
          {status === 'done' && (t('editor.ai_optimize_done') || 'AI 优化完成')}
          {status === 'error' && (t('editor.ai_optimize_error') || 'AI 优化出错')}
        </Typography>
        {status === 'running' && (
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
            {t('editor.ai_cancel') || '取消'}
          </Button>
        )}
        {status !== 'running' && (
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
          maxHeight: 260,
        }}
      >
        {status === 'error' ? (
          <Typography sx={{ fontSize: 12, color: '#FF5252', lineHeight: 1.6 }}>
            {errorMessage}
          </Typography>
        ) : fullText ? (
          <Box sx={markdownStyles}>
            <Markdown remarkPlugins={[remarkGfm]}>{fullText}</Markdown>
          </Box>
        ) : (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 2 }}>
            <Sparkle size={14} color={primaryColor} weight="fill" />
            <Typography sx={{ fontSize: 12, color: isDark ? '#8B949E' : '#6B7280' }}>
              {t('editor.ai_thinking') || 'AI 正在思考...'}
            </Typography>
          </Box>
        )}
      </Box>

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
