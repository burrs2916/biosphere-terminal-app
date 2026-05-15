import { type Editor } from '@tiptap/core';
import {
  Box, IconButton, Tooltip, Divider, Select, MenuItem, CircularProgress,
} from '@mui/material';
import {
  TextBIcon, TextItalicIcon, TextStrikethroughIcon, CodeIcon,
  QuotesIcon, ListBulletsIcon, ListNumbersIcon, LinkIcon,
  TableIcon, ArrowLineUpIcon, ArrowLineDownIcon, HighlighterCircleIcon,
  TextUnderlineIcon, ChecksIcon, MinusIcon,
  InfoIcon, BookmarkSimpleIcon, FunctionIcon, Sparkle,
} from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { getNoteAssistantAgentId } from '../../agent/components/NoteAssistantTab';

interface EditorToolbarProps {
  editor: Editor | null;
  onAiOptimize?: () => void;
  aiOptimizing?: boolean;
}

export function EditorToolbar({ editor, onAiOptimize, aiOptimizing }: EditorToolbarProps) {
  const { t } = useTranslation('notebook');

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
    color: '#8B949E',
    borderRadius: 1.5,
    p: 0.5,
    '&:hover': { bgcolor: 'rgba(108,99,255,0.12)', color: '#6C63FF' },
    '&.active': { bgcolor: 'rgba(108,99,255,0.15)', color: '#6C63FF' },
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
        bgcolor: 'rgba(22,27,34,0.6)',
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
          '& .MuiSelect-icon': { color: '#8B949E' },
          fontSize: 12,
          color: '#E6EDF3',
          '& .MuiSelect-select': { py: 0.25, px: 1, fontSize: 12 },
        }}
      >
        <MenuItem value={0} sx={{ fontSize: 12 }}>{t('toolbar.paragraph')}</MenuItem>
        <MenuItem value={1} sx={{ fontSize: 12, fontWeight: 700 }}>H1</MenuItem>
        <MenuItem value={2} sx={{ fontSize: 12, fontWeight: 700 }}>H2</MenuItem>
        <MenuItem value={3} sx={{ fontSize: 12, fontWeight: 600 }}>H3</MenuItem>
        <MenuItem value={4} sx={{ fontSize: 12, fontWeight: 600 }}>H4</MenuItem>
        <MenuItem value={5} sx={{ fontSize: 12 }}>H5</MenuItem>
        <MenuItem value={6} sx={{ fontSize: 12 }}>H6</MenuItem>
      </Select>

      <Divider orientation="vertical" flexItem sx={{ mx: 0.25, borderColor: 'rgba(48,54,61,0.6)' }} />

      <ToolBtn icon={<TextBIcon size={16} weight="bold" />} label={t('toolbar.bold')} onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive('bold')} />
      <ToolBtn icon={<TextItalicIcon size={16} />} label={t('toolbar.italic')} onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive('italic')} />
      <ToolBtn icon={<TextUnderlineIcon size={16} />} label={t('toolbar.underline')} onClick={() => editor.chain().focus().toggleUnderline().run()} active={editor.isActive('underline')} />
      <ToolBtn icon={<TextStrikethroughIcon size={16} />} label={t('toolbar.strikethrough')} onClick={() => editor.chain().focus().toggleStrike().run()} active={editor.isActive('strike')} />
      <ToolBtn icon={<HighlighterCircleIcon size={16} />} label={t('toolbar.highlight')} onClick={() => editor.chain().focus().toggleHighlight().run()} active={editor.isActive('highlight')} />
      <ToolBtn icon={<CodeIcon size={16} />} label={t('toolbar.code')} onClick={() => editor.chain().focus().toggleCode().run()} active={editor.isActive('code')} />

      <Divider orientation="vertical" flexItem sx={{ mx: 0.25, borderColor: 'rgba(48,54,61,0.6)' }} />

      <ToolBtn icon={<QuotesIcon size={16} />} label={t('toolbar.blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()} active={editor.isActive('blockquote')} />
      <ToolBtn icon={<ListBulletsIcon size={16} />} label={t('toolbar.bullet_list')} onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive('bulletList')} />
      <ToolBtn icon={<ListNumbersIcon size={16} />} label={t('toolbar.ordered_list')} onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive('orderedList')} />
      <ToolBtn icon={<ChecksIcon size={16} />} label={t('toolbar.task_list')} onClick={() => editor.chain().focus().toggleTaskList().run()} active={editor.isActive('taskList')} />

      <Divider orientation="vertical" flexItem sx={{ mx: 0.25, borderColor: 'rgba(48,54,61,0.6)' }} />

      <ToolBtn icon={<LinkIcon size={16} />} label={t('toolbar.link')} onClick={addLink} active={editor.isActive('link')} />
      <ToolBtn icon={<TableIcon size={16} />} label={t('toolbar.table')} onClick={insertTable} />
      <ToolBtn icon={<MinusIcon size={16} />} label={t('toolbar.horizontal_rule')} onClick={() => editor.chain().focus().setHorizontalRule().run()} />

      <Divider orientation="vertical" flexItem sx={{ mx: 0.25, borderColor: 'rgba(48,54,61,0.6)' }} />

      <ToolBtn icon={<ArrowLineUpIcon size={16} />} label={t('toolbar.superscript')} onClick={() => editor.chain().focus().toggleSuperscript().run()} active={editor.isActive('superscript')} />
      <ToolBtn icon={<ArrowLineDownIcon size={16} />} label={t('toolbar.subscript')} onClick={() => editor.chain().focus().toggleSubscript().run()} active={editor.isActive('subscript')} />

      <Divider orientation="vertical" flexItem sx={{ mx: 0.25, borderColor: 'rgba(48,54,61,0.6)' }} />

      <ToolBtn icon={<InfoIcon size={16} />} label={t('toolbar.callout')} onClick={() => editor.chain().focus().toggleCallout('info').run()} active={editor.isActive('callout')} />
      <ToolBtn icon={<FunctionIcon size={16} />} label={t('toolbar.latex')} onClick={() => editor.chain().focus().setLatex().run()} active={editor.isActive('latex')} />
      <ToolBtn icon={<BookmarkSimpleIcon size={16} />} label={t('toolbar.bookmark')} onClick={() => editor.chain().focus().setBookmark().run()} active={editor.isActive('bookmark')} />

      <Box sx={{ flex: 1 }} />

      {onAiOptimize && (
        <>
          <Divider orientation="vertical" flexItem sx={{ mx: 0.25, borderColor: 'rgba(48,54,61,0.6)' }} />
          <Tooltip title={t('editor.ai_optimize')} arrow>
            <IconButton
              size="small"
              onClick={onAiOptimize}
              disabled={aiOptimizing || !getNoteAssistantAgentId()}
              sx={{
                color: '#CE93D8',
                borderRadius: 1.5,
                p: 0.5,
                '&:hover': { bgcolor: 'rgba(206,147,216,0.12)', color: '#EA80FC' },
                '&.Mui-disabled': { color: 'rgba(206,147,216,0.2)' },
              }}
            >
              {aiOptimizing ? (
                <CircularProgress size={16} sx={{ color: '#CE93D8' }} />
              ) : (
                <Sparkle size={16} weight="fill" />
              )}
            </IconButton>
          </Tooltip>
        </>
      )}
    </Box>
  );
}
