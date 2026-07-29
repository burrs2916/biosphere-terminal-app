import { type Editor } from '@tiptap/core';
import { useState } from 'react';
import {
  Box, IconButton, Tooltip, Divider, Select, MenuItem, CircularProgress, Menu, ListItemIcon,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import {
  TextBIcon, TextItalicIcon, TextStrikethroughIcon, CodeIcon,
  QuotesIcon, ListBulletsIcon, ListNumbersIcon, LinkIcon,
  TableIcon, ArrowLineUpIcon, ArrowLineDownIcon, HighlighterCircleIcon,
  TextUnderlineIcon, ChecksIcon, MinusIcon,
  InfoIcon, BookmarkSimpleIcon, FunctionIcon, Sparkle,
  MagicWandIcon, TextAaIcon, HashIcon, ArrowRightIcon, TranslateIcon,
} from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { useLicenseStore } from '../../licensing/licenseStore';

export type AiMode = 'optimize' | 'summarize' | 'generate' | 'tag' | 'continue' | 'translate_en' | 'translate_zh';

export const AI_MODE_META: Record<AiMode, { icon: React.ReactNode }> = {
  optimize: { icon: <MagicWandIcon size={15} /> },
  summarize: { icon: <TextAaIcon size={15} /> },
  generate: { icon: <Sparkle size={15} weight="fill" /> },
  tag: { icon: <HashIcon size={15} /> },
  continue: { icon: <ArrowRightIcon size={15} /> },
  translate_en: { icon: <TranslateIcon size={15} /> },
  translate_zh: { icon: <TranslateIcon size={15} /> },
};

interface EditorToolbarProps {
  editor: Editor | null;
  onAiAction?: (mode: AiMode) => void;
  aiOptimizing?: boolean;
  aiMode?: AiMode | null;
}

export function EditorToolbar({ editor, onAiAction, aiOptimizing, aiMode }: EditorToolbarProps) {
  const { t } = useTranslation('notebook');
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  // Pro 功能授权：未付费时按钮置灰
  const canUseAiOptimize = useLicenseStore((s) => s.canUse('note_ai_optimize'));
  const [aiMenuAnchor, setAiMenuAnchor] = useState<null | HTMLElement>(null);

  if (!editor) return null;

  const headingLevel = [1, 2, 3, 4, 5, 6].find((level) =>
    editor.isActive('heading', { level })
  ) || 0;

  const setHeading = (level: number) => {
    if (level === 0) {
      editor.chain().focus().setParagraph().run();
    } else {
      editor.chain().focus().toggleHeading({ level: level as 1 | 2 | 3 | 4 | 5 | 6 }).run();
    }
  };

  const addLink = () => {
    const url = window.prompt('URL');
    if (url) {
      editor.chain().focus().setLink({ href: url }).run();
    }
  };

  const insertTable = () => {
    editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
  };

  const btnSx = {
    color: isDark ? '#8B949E' : '#6B7280',
    borderRadius: 1.5,
    p: 0.5,
    '&:hover': { bgcolor: isDark ? 'rgba(108,99,255,0.12)' : 'rgba(108,99,255,0.08)', color: '#6C63FF' },
    '&.active': { bgcolor: isDark ? 'rgba(108,99,255,0.15)' : 'rgba(108,99,255,0.1)', color: '#6C63FF' },
  };

  const ToolBtn = ({
    icon, label, onClick, active,
  }: {
    icon: React.ReactNode; label: string; onClick: () => void; active?: boolean;
  }) => (
    <Tooltip title={label} arrow>
      <IconButton size="small" onClick={onClick} sx={btnSx} className={active ? 'active' : ''}>
        {icon}
      </IconButton>
    </Tooltip>
  );

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 0.25,
        px: 1,
        py: 0.5,
        borderBottom: '1px solid',
        borderColor: 'divider',
        bgcolor: isDark ? 'rgba(22,27,34,0.6)' : 'rgba(0,0,0,0.02)',
        borderRadius: '8px 8px 0 0',
        flexWrap: 'wrap',
        minHeight: 36,
      }}
    >
      <Select
        size="small"
        value={headingLevel}
        onChange={(e) => setHeading(Number(e.target.value))}
        sx={{
          minWidth: 72,
          bgcolor: 'transparent',
          '& .MuiOutlinedInput-notchedOutline': { border: 'none' },
          '& .MuiSelect-icon': { color: isDark ? '#8B949E' : '#6B7280' },
          fontSize: 12,
          color: isDark ? '#E6EDF3' : '#1A1A2E',
          '& .MuiSelect-select': { py: 0.25, px: 1, fontSize: 12 },
        }}
      >
        <MenuItem value={0} sx={{ fontSize: 12 }}>{t('notebook.toolbar_paragraph')}</MenuItem>
        <MenuItem value={1} sx={{ fontSize: 12, fontWeight: 700 }}>H1</MenuItem>
        <MenuItem value={2} sx={{ fontSize: 12, fontWeight: 700 }}>H2</MenuItem>
        <MenuItem value={3} sx={{ fontSize: 12, fontWeight: 600 }}>H3</MenuItem>
        <MenuItem value={4} sx={{ fontSize: 12, fontWeight: 600 }}>H4</MenuItem>
        <MenuItem value={5} sx={{ fontSize: 12 }}>H5</MenuItem>
        <MenuItem value={6} sx={{ fontSize: 12 }}>H6</MenuItem>
      </Select>

      <Divider orientation="vertical" flexItem sx={{ mx: 0.25, borderColor: isDark ? 'rgba(48,54,61,0.6)' : 'rgba(0,0,0,0.08)' }} />

      <ToolBtn icon={<TextBIcon size={16} weight="bold" />} label={t('notebook.toolbar_bold')} onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive('bold')} />
      <ToolBtn icon={<TextItalicIcon size={16} />} label={t('notebook.toolbar_italic')} onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive('italic')} />
      <ToolBtn icon={<TextUnderlineIcon size={16} />} label={t('notebook.toolbar_underline')} onClick={() => editor.chain().focus().toggleUnderline().run()} active={editor.isActive('underline')} />
      <ToolBtn icon={<TextStrikethroughIcon size={16} />} label={t('notebook.toolbar_strikethrough')} onClick={() => editor.chain().focus().toggleStrike().run()} active={editor.isActive('strike')} />
      <ToolBtn icon={<HighlighterCircleIcon size={16} />} label={t('notebook.toolbar_highlight')} onClick={() => editor.chain().focus().toggleHighlight().run()} active={editor.isActive('highlight')} />
      <ToolBtn icon={<CodeIcon size={16} />} label={t('notebook.toolbar_code')} onClick={() => editor.chain().focus().toggleCode().run()} active={editor.isActive('code')} />

      <Divider orientation="vertical" flexItem sx={{ mx: 0.25, borderColor: isDark ? 'rgba(48,54,61,0.6)' : 'rgba(0,0,0,0.08)' }} />

      <ToolBtn icon={<QuotesIcon size={16} />} label={t('notebook.toolbar_blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()} active={editor.isActive('blockquote')} />
      <ToolBtn icon={<ListBulletsIcon size={16} />} label={t('notebook.toolbar_bullet_list')} onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive('bulletList')} />
      <ToolBtn icon={<ListNumbersIcon size={16} />} label={t('notebook.toolbar_ordered_list')} onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive('orderedList')} />
      <ToolBtn icon={<ChecksIcon size={16} />} label={t('notebook.toolbar_task_list')} onClick={() => editor.chain().focus().toggleTaskList().run()} active={editor.isActive('taskList')} />

      <Divider orientation="vertical" flexItem sx={{ mx: 0.25, borderColor: isDark ? 'rgba(48,54,61,0.6)' : 'rgba(0,0,0,0.08)' }} />

      <ToolBtn icon={<LinkIcon size={16} />} label={t('notebook.toolbar_link')} onClick={addLink} active={editor.isActive('link')} />
      <ToolBtn icon={<TableIcon size={16} />} label={t('notebook.toolbar_table')} onClick={insertTable} />
      <ToolBtn icon={<MinusIcon size={16} />} label={t('notebook.toolbar_horizontal_rule')} onClick={() => editor.chain().focus().setHorizontalRule().run()} />

      <Divider orientation="vertical" flexItem sx={{ mx: 0.25, borderColor: isDark ? 'rgba(48,54,61,0.6)' : 'rgba(0,0,0,0.08)' }} />

      <ToolBtn icon={<ArrowLineUpIcon size={16} />} label={t('notebook.toolbar_superscript')} onClick={() => editor.chain().focus().toggleSuperscript().run()} active={editor.isActive('superscript')} />
      <ToolBtn icon={<ArrowLineDownIcon size={16} />} label={t('notebook.toolbar_subscript')} onClick={() => editor.chain().focus().toggleSubscript().run()} active={editor.isActive('subscript')} />

      <Divider orientation="vertical" flexItem sx={{ mx: 0.25, borderColor: isDark ? 'rgba(48,54,61,0.6)' : 'rgba(0,0,0,0.08)' }} />

      <ToolBtn icon={<InfoIcon size={16} />} label={t('notebook.toolbar_callout')} onClick={() => editor.chain().focus().toggleCallout('info').run()} active={editor.isActive('callout')} />
      <ToolBtn icon={<FunctionIcon size={16} />} label={t('notebook.toolbar_latex')} onClick={() => editor.chain().focus().setLatex().run()} active={editor.isActive('latex')} />
      <ToolBtn icon={<BookmarkSimpleIcon size={16} />} label={t('notebook.toolbar_bookmark')} onClick={() => editor.chain().focus().setBookmark().run()} active={editor.isActive('bookmark')} />

      <Box sx={{ flex: 1 }} />

      {onAiAction && (
        <>
          <Divider orientation="vertical" flexItem sx={{ mx: 0.25, borderColor: isDark ? 'rgba(48,54,61,0.6)' : 'rgba(0,0,0,0.08)' }} />
          <Tooltip title={canUseAiOptimize ? t('editor.ai_optimize') : 'Pro · Upgrade to unlock'} arrow>
            <span>
              <IconButton
                size="small"
                onClick={(e) => setAiMenuAnchor(e.currentTarget)}
                disabled={aiOptimizing || !canUseAiOptimize}
                sx={{
                  color: canUseAiOptimize ? '#CE93D8' : 'rgba(206,147,216,0.4)',
                  borderRadius: 1.5,
                  p: 0.5,
                  opacity: canUseAiOptimize ? 1 : 0.55,
                  '&:hover': { bgcolor: 'rgba(206,147,216,0.12)', color: canUseAiOptimize ? '#EA80FC' : 'rgba(206,147,216,0.6)' },
                  '&.Mui-disabled': { color: 'rgba(206,147,216,0.2)' },
                }}
              >
                {aiOptimizing ? (
                  <CircularProgress size={16} sx={{ color: '#CE93D8' }} />
                ) : (
                  <Sparkle size={16} weight="fill" />
                )}
              </IconButton>
            </span>
          </Tooltip>
          <Menu
            anchorEl={aiMenuAnchor}
            open={Boolean(aiMenuAnchor)}
            onClose={() => setAiMenuAnchor(null)}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
            transformOrigin={{ vertical: 'top', horizontal: 'right' }}
            slotProps={{ paper: { sx: { minWidth: 180, borderRadius: 2, mt: 0.5 } } }}
          >
            {(Object.keys(AI_MODE_META) as AiMode[]).map((mode) => (
              <MenuItem
                key={mode}
                selected={aiMode === mode}
                onClick={() => { setAiMenuAnchor(null); onAiAction(mode); }}
                sx={{ fontSize: 13, gap: 1 }}
              >
                <ListItemIcon sx={{ minWidth: 22, color: '#CE93D8' }}>
                  {AI_MODE_META[mode].icon}
                </ListItemIcon>
                {t(`editor.ai_modes.${mode}`)}
              </MenuItem>
            ))}
          </Menu>
        </>
      )}
    </Box>
  );
}
