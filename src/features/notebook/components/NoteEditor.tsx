import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Box, TextField, Button, Typography, Chip, IconButton, CircularProgress, Tooltip,
  List, ListItem, ListItemText, ListItemIcon, Select, MenuItem, FormControl, InputLabel,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import {
  FloppyDiskIcon, XIcon, LinkIcon, PlusIcon, TagIcon, CheckIcon, CodeIcon, Sparkle, ArrowsClockwiseIcon, FolderOpenIcon,
} from '@phosphor-icons/react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import Placeholder from '@tiptap/extension-placeholder';
import Highlight from '@tiptap/extension-highlight';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Underline from '@tiptap/extension-underline';
import TextAlign from '@tiptap/extension-text-align';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { TextStyle } from '@tiptap/extension-text-style';
import Color from '@tiptap/extension-color';
import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import CharacterCount from '@tiptap/extension-character-count';
import { Table } from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import Superscript from '@tiptap/extension-superscript';
import Subscript from '@tiptap/extension-subscript';
import { common, createLowlight } from 'lowlight';
import { useNotebookStore } from '../store/notebookStore';
import { IconRenderer } from './IconRenderer';
import { EditorToolbar } from './EditorToolbar';
import { CalloutExtension, LatexExtension, BookmarkExtension } from '../extensions';
import { getNoteAssistantAgentId } from '../../agent/components/NoteAssistantTab';
import { runAgent, createConversation, stopAgent } from '../../../core/services/agent.service';
import { listen } from '@tauri-apps/api/event';
import { revealItemInDir } from '@tauri-apps/plugin-opener';
import { AiOptimizeDialog } from './AiOptimizeDialog';
import type { NoteDto } from '../../../proto/notebook';

const lowlight = createLowlight(common);

interface NoteEditorProps {
  note: NoteDto | null;
  onClose: () => void;
  onSaved?: () => void;
  defaultGroupId?: string;
  defaultCategory?: string;
}

export function NoteEditor({ note, onClose, onSaved, defaultGroupId, defaultCategory }: NoteEditorProps) {
  const { t } = useTranslation('notebook');
  const { t: tCommon } = useTranslation('common');
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const primaryColor = isDark ? '#6C63FF' : '#5B54E0';
  const agentColor = isDark ? '#CE93D8' : '#7B1FA2';
  const mutedColor = isDark ? '#8B949E' : '#6B7280';
  const codeBorder = isDark ? 'rgba(48,54,61,0.6)' : 'rgba(0,0,0,0.08)';

  const {
    selectedNote, loadNote, createNote, updateNote, loadLinkedCommands,
    linkedCommands: storeLinkedCommands, groups: storeGroups, activeGroupId,
    categories: storeCategories, loadCategoriesByGroup, createCategory, loadGroups,
  } = useNotebookStore();
  const groups = storeGroups || [];
  const categories = storeCategories || [];
  const linkedCommands = storeLinkedCommands || [];

  const [title, setTitle] = useState('');
  const [groupId, setGroupId] = useState('');
  const [category, setCategory] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [isNew, setIsNew] = useState(false);
  const [showNewCategoryInput, setShowNewCategoryInput] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [showTagInput, setShowTagInput] = useState(false);
  const [initialContent, setInitialContent] = useState('');
  const [aiOptimizing, setAiOptimizing] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'unsaved'>('saved');
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirtyRef = useRef(false);
  const aiConvIdRef = useRef<string | null>(null);
  const [aiDialogOpen, setAiDialogOpen] = useState(false);
  const [aiChunks, setAiChunks] = useState<string[]>([]);
  const [aiStatus, setAiStatus] = useState<'running' | 'done' | 'error'>('running');
  const [aiError, setAiError] = useState('');

  useEffect(() => {
    loadGroups();
  }, [loadGroups]);

  useEffect(() => {
    if (note) {
      setIsNew(false);
      loadNote(note.id);
      loadLinkedCommands(note.id);
    } else {
      setIsNew(true);
      setTitle('');
      setInitialContent('');
      const initGroupId = defaultGroupId || activeGroupId || '';
      const initCategory = defaultCategory || '';
      setGroupId(initGroupId);
      setCategory(initCategory);
      setTags([]);
      if (initGroupId) {
        loadCategoriesByGroup(initGroupId);
      }
    }
  }, [note, loadNote, loadLinkedCommands, activeGroupId, loadCategoriesByGroup, defaultGroupId, defaultCategory]);

  useEffect(() => {
    if (selectedNote && !isNew) {
      setTitle(selectedNote.note.title);
      setInitialContent(selectedNote.content || '');
      setGroupId(selectedNote.note.groupId);
      setCategory(selectedNote.note.category);
      setTags(selectedNote.note.tags);
      if (selectedNote.note.groupId) {
        loadCategoriesByGroup(selectedNote.note.groupId);
      }
    }
  }, [selectedNote, isNew, loadCategoriesByGroup]);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        codeBlock: false,
        heading: { levels: [1, 2, 3, 4, 5, 6] },
      }),
      Markdown.configure({
        markedOptions: { gfm: true, breaks: true },
      }),
      Placeholder.configure({
        placeholder: t('editor.content_placeholder') || 'Start writing...',
      }),
      Highlight.configure({ multicolor: true }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Underline,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      CodeBlockLowlight.configure({ lowlight }),
      TextStyle,
      Color,
      Image.configure({ inline: true }),
      Link.configure({
        openOnClick: false,
        autolink: true,
      }),
      CharacterCount,
      Table.configure({ resizable: true }),
      TableRow,
      TableCell,
      TableHeader,
      Superscript,
      Subscript,
      CalloutExtension,
      LatexExtension,
      BookmarkExtension,
    ],
    content: initialContent,
    contentType: 'markdown',
    editorProps: {
      attributes: {
        class: 'note-editor-content',
      },
    },
    onUpdate: ({ editor: ed }) => {
      setInitialContent(ed.getMarkdown());
      dirtyRef.current = true;
      setSaveStatus('unsaved');
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = setTimeout(() => {
        handleAutoSave();
      }, 2000);
    },
  });

  useEffect(() => {
    if (editor && initialContent !== undefined) {
      const currentMd = editor.getMarkdown();
      if (currentMd !== initialContent) {
        const json = editor.markdown?.parse(initialContent);
        if (json) editor.commands.setContent(json);
      }
    }
  }, [editor, initialContent]);

  const handleAutoSave = useCallback(async () => {
    if (!dirtyRef.current || isNew) return;
    const content = editor?.getMarkdown() || initialContent;
    if (!content.trim()) return;
    setSaveStatus('saving');
    try {
      if (note) {
        await updateNote({ id: note.id, title: title || t('notebook.note_title'), content, groupId: groupId || '', category, tags });
      }
      dirtyRef.current = false;
      setSaveStatus('saved');
    } catch {
      setSaveStatus('unsaved');
    }
  }, [editor, initialContent, isNew, note, title, groupId, category, tags, updateNote, t]);

  const handleSave = useCallback(async () => {
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    const content = editor?.getMarkdown() || initialContent;
    setSaveStatus('saving');
    if (isNew) {
      const result = await createNote({ title: title || t('notebook.note_title'), content, groupId: groupId || '', category, tags });
      if (result) {
        onSaved?.();
        setIsNew(false);
        dirtyRef.current = false;
        setSaveStatus('saved');
      } else {
        setSaveStatus('unsaved');
      }
    } else if (note) {
      const result = await updateNote({ id: note.id, title: title || t('notebook.note_title'), content, groupId: groupId || '', category, tags });
      if (result) {
        onSaved?.();
        dirtyRef.current = false;
        setSaveStatus('saved');
      } else {
        setSaveStatus('unsaved');
      }
    }
  }, [isNew, title, groupId, category, tags, note, createNote, updateNote, onSaved, t, editor, initialContent]);

  const handleRemoveTag = (tag: string) => {
    setTags(tags.filter((t) => t !== tag));
  };

  const handleCreateCategory = async () => {
    if (!newCategoryName.trim() || !groupId) return;
    const result = await createCategory({ name: newCategoryName.trim(), groupId, sortOrder: categories.length });
    if (result) {
      setCategory(result.name);
      setNewCategoryName('');
      setShowNewCategoryInput(false);
    }
  };

  const handleNewCategoryKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleCreateCategory();
    } else if (e.key === 'Escape') {
      setShowNewCategoryInput(false);
      setNewCategoryName('');
    }
  };

  const handleAddTag = () => {
    if (tagInput.trim() && !tags.includes(tagInput.trim())) {
      setTags([...tags, tagInput.trim()]);
      setTagInput('');
      setShowTagInput(false);
    }
  };

  const handleTagKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleAddTag();
    } else if (e.key === 'Escape') {
      setShowTagInput(false);
      setTagInput('');
    }
  };

  const handleAiOptimize = useCallback(async () => {
    const agentId = getNoteAssistantAgentId();
    if (!agentId) {
      setAiStatus('error');
      setAiError(t('editor.ai_no_agent'));
      setAiDialogOpen(true);
      return;
    }

    const content = editor?.getMarkdown() || initialContent;
    if (!content.trim()) {
      setAiStatus('error');
      setAiError(t('editor.ai_no_content'));
      setAiDialogOpen(true);
      return;
    }

    setAiOptimizing(true);
    setAiChunks([]);
    setAiStatus('running');
    setAiError('');
    setAiDialogOpen(true);

    try {
      const conv = await createConversation(agentId, `Optimize: ${title || 'Note'}`);
      aiConvIdRef.current = conv.id;

      const unlistenChunk = listen<{ conversationId: string; chunk: string }>('agent-chunk', (event) => {
        if (event.payload.conversationId === aiConvIdRef.current) {
          setAiChunks((prev) => [...prev, event.payload.chunk]);
        }
      });

      const unlistenDone = listen<{ conversationId: string; response: string }>('agent-done', (event) => {
        if (event.payload.conversationId === aiConvIdRef.current) {
          const response = event.payload.response;
          if (editor && response && response !== 'No response') {
            const json = editor.markdown?.parse(response);
            if (json) {
              editor.commands.setContent(json);
              setInitialContent(response);
              dirtyRef.current = true;
              setSaveStatus('unsaved');
            }
          } else if (response === 'No response' || !response) {
            setAiStatus('error');
            setAiError(t('editor.ai_optimize_error') || 'AI optimization failed');
          }
          setAiOptimizing(false);
          setAiStatus('done');
          aiConvIdRef.current = null;
          unlistenDone.then((fn) => fn());
          unlistenChunk.then((fn) => fn());
        }
      });

      const unlistenError = listen<{ conversationId: string; error: string }>('agent-error', (event) => {
        if (event.payload.conversationId === aiConvIdRef.current) {
          setAiOptimizing(false);
          setAiStatus('error');
          setAiError(event.payload.error);
          aiConvIdRef.current = null;
          unlistenError.then((fn) => fn());
          unlistenChunk.then((fn) => fn());
        }
      });

      let prompt: string;
      if (category === 'command') {
        prompt = `You are optimizing a command note. Return ONLY the optimized Markdown content without any explanation.\n\nIMPORTANT RULES:\n1. Keep the original language of the content.\n2. For commands, provide a complete reference document including:\n   - Brief description of what the command does\n   - Explanation of key flags and options\n   - Common usage examples with code blocks\n   - Related commands or tips if applicable\n3. Preserve the original command in a code block.\n4. Do NOT include metadata like working directory, save time, or exit status.\n5. Do NOT wrap the entire output in code fences.\n\nTitle: ${title || 'Untitled'}\n\nContent to optimize:\n${content}`;
      } else {
        prompt = `You are optimizing a note. Return ONLY the optimized Markdown content without any explanation.\n\nIMPORTANT RULES:\n1. Keep the original language of the content.\n2. Fix grammar, improve clarity and structure.\n3. Preserve all Markdown formatting, code blocks, tables, and links.\n4. Do NOT wrap the output in code fences.\n\nTitle: ${title || 'Untitled'}\n\nContent to optimize:\n${content}`;
      }

      await runAgent(agentId, prompt, conv.id, true);
    } catch (e) {
      setAiOptimizing(false);
      setAiStatus('error');
      setAiError(String(e));
      aiConvIdRef.current = null;
    }
  }, [editor, initialContent, title, category, t]);

  const handleAiCancel = useCallback(async () => {
    if (aiConvIdRef.current) {
      try { await stopAgent(aiConvIdRef.current); } catch {}
      aiConvIdRef.current = null;
    }
    setAiOptimizing(false);
    setAiStatus('error');
    setAiError(t('editor.ai_optimize_cancelled') || 'AI optimization cancelled');
  }, [t]);

  const handleAiDialogClose = useCallback(() => {
    setAiDialogOpen(false);
  }, []);

  const charCount = editor?.storage.characterCount;

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', p: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
        <Typography variant="h6" sx={{ flex: 1, fontSize: 16 }}>
          {isNew ? t('editor.create_title') : t('editor.edit_title')}
        </Typography>
        {saveStatus === 'unsaved' && (
          <Typography variant="caption" sx={{ color: 'warning.main', fontSize: 10 }}>
            {t('editor.unsaved') || '未保存'}
          </Typography>
        )}
        {saveStatus === 'saving' && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <ArrowsClockwiseIcon size={10} className="spin" />
            <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: 10 }}>
              {t('editor.saving') || '保存中...'}
            </Typography>
          </Box>
        )}
        {saveStatus === 'saved' && !isNew && (
          <Typography variant="caption" sx={{ color: 'success.main', fontSize: 10 }}>
            {t('editor.saved') || '已保存'}
          </Typography>
        )}
        <Button
          variant="contained"
          size="small"
          startIcon={saveStatus === 'saving' ? <CircularProgress size={14} sx={{ color: '#fff' }} /> : <FloppyDiskIcon size={14} weight="bold" />}
          onClick={handleSave}
          disabled={saveStatus === 'saving'}
          sx={{
            background: `linear-gradient(135deg, ${primaryColor} 0%, ${isDark ? '#8B83FF' : '#7B75FF'} 100%)`,
            borderRadius: 2,
          }}
        >
          {tCommon('action.save')}
        </Button>
        {!isNew && selectedNote?.note.filePath && (
          <Tooltip title={t('editor.open_folder') || '打开文件夹'} arrow>
            <IconButton
              size="small"
              onClick={() => {
                try { revealItemInDir(selectedNote!.note.filePath); } catch {}
              }}
              sx={{
                borderRadius: 2,
                border: '1px solid rgba(144,202,249,0.3)',
                bgcolor: 'rgba(144,202,249,0.06)',
                '&:hover': { bgcolor: 'rgba(144,202,249,0.15)', borderColor: 'rgba(144,202,249,0.5)' },
              }}
            >
              <FolderOpenIcon size={16} color={isDark ? '#90CAF9' : '#1976d2'} />
            </IconButton>
          </Tooltip>
        )}
        <Tooltip title={aiOptimizing ? (t('editor.ai_cancel') || '取消 AI 优化') : t('editor.ai_optimize')} arrow>
          <IconButton
            size="small"
            onClick={aiOptimizing ? handleAiCancel : handleAiOptimize}
            sx={{
              borderRadius: 2,
              border: aiOptimizing ? '1px solid rgba(255,82,82,0.3)' : '1px solid rgba(206,147,216,0.3)',
              bgcolor: aiOptimizing ? 'rgba(255,82,82,0.06)' : 'rgba(206,147,216,0.06)',
              '&:hover': aiOptimizing
                ? { bgcolor: 'rgba(255,82,82,0.15)', borderColor: 'rgba(255,82,82,0.5)' }
                : { bgcolor: 'rgba(206,147,216,0.15)', borderColor: 'rgba(206,147,216,0.5)' },
            }}
          >
            {aiOptimizing ? (
              <XIcon size={16} color="#FF5252" />
            ) : (
              <Sparkle size={16} weight="fill" color={agentColor} />
            )}
          </IconButton>
        </Tooltip>
        <IconButton size="small" onClick={onClose}>
          <XIcon size={18} />
        </IconButton>
      </Box>

      <TextField
        fullWidth
        size="small"
        label={t('editor.title_label')}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        sx={{ mb: 1.5, '& .MuiOutlinedInput-root': { borderRadius: 2 } }}
      />

      {isNew && defaultGroupId ? (
        <Box sx={{ display: 'flex', gap: 1, mb: 1.5, alignItems: 'center' }}>
          <Chip
            icon={<IconRenderer value={groups.find((g) => g.id === defaultGroupId)?.icon || ''} size={14} />}
            label={groups.find((g) => g.id === defaultGroupId)?.name || t('group.uncategorized')}
            size="small"
            sx={{ borderRadius: 2, bgcolor: `${primaryColor}18`, color: primaryColor, fontWeight: 600 }}
          />
          {defaultCategory && (
            <Chip
              icon={<TagIcon size={12} />}
              label={defaultCategory}
              size="small"
              sx={{ borderRadius: 2, bgcolor: 'rgba(129,199,132,0.1)', color: '#81C784', fontWeight: 600 }}
            />
          )}
        </Box>
      ) : (
      <Box sx={{ display: 'flex', gap: 1, mb: 1.5 }}>
        <FormControl size="small" sx={{ flex: 1 }}>
          <InputLabel>{t('editor.group_label')}</InputLabel>
          <Select
            value={groupId}
            label={t('editor.group_label')}
            onChange={(e) => {
              const newGroupId = e.target.value;
              setGroupId(newGroupId);
              setCategory('');
              setShowNewCategoryInput(false);
              if (newGroupId) {
                loadCategoriesByGroup(newGroupId);
              }
            }}
            sx={{ borderRadius: 2 }}
          >
            <MenuItem value="">
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <IconRenderer value="" size={14} /> {t('group.uncategorized')}
              </Box>
            </MenuItem>
            {groups.map((g) => (
              <MenuItem key={g.id} value={g.id}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <IconRenderer value={g.icon} size={14} /> {g.name}
                </Box>
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ flex: 1 }} disabled={!groupId}>
          <InputLabel>{t('editor.category_label')}</InputLabel>
          <Select
            value={category}
            label={t('editor.category_label')}
            onChange={(e) => setCategory(e.target.value)}
            sx={{ borderRadius: 2 }}
            renderValue={(selected) => (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                {selected ? (
                  <>
                    <TagIcon size={12} />
                    <Typography variant="body2">{selected}</Typography>
                  </>
                ) : (
                  <Typography variant="body2" color="text.secondary">{t('category.uncategorized')}</Typography>
                )}
              </Box>
            )}
          >
            <MenuItem value="">
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, color: 'text.secondary' }}>
                <TagIcon size={14} /> {t('category.uncategorized')}
              </Box>
            </MenuItem>
            <MenuItem value="" disabled sx={{ opacity: 0.3, minHeight: 24, '&:hover': { bgcolor: 'transparent' } }}>
              ──────────
            </MenuItem>
            {categories.map((cat) => (
              <MenuItem key={cat.id} value={cat.name} selected={category === cat.name}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <TagIcon size={14} color={cat.isDefault ? primaryColor : mutedColor} />
                  <Typography variant="body2">{cat.name}</Typography>
                  {cat.isDefault && (
                    <Chip label={t('category.default_badge')} size="small" sx={{ height: 16, fontSize: 10, ml: 'auto' }} />
                  )}
                </Box>
              </MenuItem>
            ))}
            {category && !categories.some((c) => c.name === category) ? (
              <MenuItem value={category}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <TagIcon size={14} color="#81C784" />
                  <Typography variant="body2">{category}</Typography>
                </Box>
              </MenuItem>
            ) : null}
            {groupId ? (
              <MenuItem value="" disabled sx={{ opacity: 0.3, minHeight: 24, '&:hover': { bgcolor: 'transparent' } }}>
                ──────────
              </MenuItem>
            ) : null}
            {groupId ? (
              <MenuItem value="__add_category__" onClick={() => { setShowNewCategoryInput(true); setNewCategoryName(''); }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, color: primaryColor }}>
                  <PlusIcon size={14} /> {t('category.add')}
                </Box>
              </MenuItem>
            ) : null}
          </Select>
        </FormControl>
        {showNewCategoryInput && groupId && (
          <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center', minWidth: 200 }}>
            <TextField
              size="small"
              placeholder={t('category.new_name') || ''}
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
              onKeyDown={handleNewCategoryKeyDown}
              autoFocus
              sx={{ flex: 1, '& .MuiOutlinedInput-root': { borderRadius: 2 } }}
            />
            <Tooltip title={tCommon('action.create')}>
              <IconButton size="small" onClick={handleCreateCategory} disabled={!newCategoryName.trim()}>
                <PlusIcon size={16} color={newCategoryName.trim() ? primaryColor : mutedColor} />
              </IconButton>
            </Tooltip>
            <Tooltip title={tCommon('action.cancel')}>
              <IconButton size="small" onClick={() => { setShowNewCategoryInput(false); setNewCategoryName(''); }}>
                <XIcon size={16} color={mutedColor} />
              </IconButton>
            </Tooltip>
          </Box>
        )}
      </Box>
      )}

      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 1.5, alignItems: 'center' }}>
        {tags.map((tag) => (
          <Chip
            key={tag}
            label={tag}
            size="small"
            onDelete={() => handleRemoveTag(tag)}
            sx={{ borderRadius: 1.5 }}
          />
        ))}
        {showTagInput ? (
          <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
            <TextField
              size="small"
              placeholder={t('editor.add_tag_hint') || ''}
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={handleTagKeyDown}
              autoFocus
              sx={{ width: 120, '& .MuiOutlinedInput-root': { borderRadius: 2 } }}
            />
            <IconButton size="small" onClick={handleAddTag} disabled={!tagInput.trim()}>
              <CheckIcon size={14} color={tagInput.trim() ? primaryColor : mutedColor} />
            </IconButton>
            <IconButton size="small" onClick={() => { setShowTagInput(false); setTagInput(''); }}>
              <XIcon size={14} color={mutedColor} />
            </IconButton>
          </Box>
        ) : (
          <Button
            size="small"
            startIcon={<PlusIcon size={12} />}
            onClick={() => setShowTagInput(true)}
            sx={{
              fontSize: 11,
              textTransform: 'none',
              color: primaryColor,
              minWidth: 'auto',
              px: 1,
            }}
          >
            {t('editor.add_tag')}
          </Button>
        )}
      </Box>

      <Box
        sx={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          borderRadius: 2,
          overflow: 'auto',
          border: '1px solid',
          borderColor: 'divider',
          '& .ProseMirror': {
            flex: 1,
            outline: 'none',
            px: 2.5,
            py: 2,
            minHeight: 0,
            color: isDark ? '#E6EDF3' : '#1A1A2E',
            fontSize: 14,
            lineHeight: 1.7,
            '& p.is-editor-empty:first-child::before': {
              content: 'attr(data-placeholder)',
              float: 'left',
              color: isDark ? '#484F58' : '#9E9E9E',
              pointerEvents: 'none',
              height: 0,
            },
            '& h1': { fontSize: '1.75rem', fontWeight: 700, mt: 2, mb: 1, color: isDark ? '#F0F6FC' : '#1A1A2E' },
            '& h2': { fontSize: '1.5rem', fontWeight: 700, mt: 1.75, mb: 0.75, color: isDark ? '#F0F6FC' : '#1A1A2E' },
            '& h3': { fontSize: '1.25rem', fontWeight: 600, mt: 1.5, mb: 0.5, color: isDark ? '#F0F6FC' : '#1A1A2E' },
            '& h4': { fontSize: '1.1rem', fontWeight: 600, mt: 1.25, mb: 0.5, color: isDark ? '#F0F6FC' : '#1A1A2E' },
            '& h5': { fontSize: '1rem', fontWeight: 600, mt: 1, mb: 0.5 },
            '& h6': { fontSize: '0.875rem', fontWeight: 600, mt: 1, mb: 0.5, color: mutedColor },
            '& p': { mb: 1 },
            '& ul, & ol': { pl: 2.5, mb: 1 },
            '& li': { mb: 0.25 },
            '& blockquote': {
              borderLeft: `3px solid ${primaryColor}`,
              pl: 2, py: 0.5, my: 1.5,
              bgcolor: `${primaryColor}10`,
              borderRadius: '0 4px 4px 0',
                color: mutedColor,
            },
            '& code': {
              bgcolor: isDark ? 'rgba(110,118,129,0.2)' : 'rgba(108,99,255,0.1)',
              color: isDark ? '#E6EDF3' : '#5B54E0',
              px: 0.5,
              py: 0.15,
              borderRadius: 0.5,
              fontSize: '0.875em',
              fontFamily: 'monospace',
            },
            '& pre': {
              bgcolor: isDark ? 'rgba(22,27,34,0.8)' : 'rgba(0,0,0,0.04)',
              border: `1px solid ${codeBorder}`,
              borderRadius: 1.5,
              p: 2,
              my: 1.5,
              overflow: 'auto',
              '& code': {
                bgcolor: 'transparent',
                color: 'inherit',
                px: 0,
                py: 0,
                fontSize: '0.875em',
              },
            },
            '& table': {
              borderCollapse: 'collapse',
              width: '100%',
              my: 1.5,
              '& td, & th': {
                border: `1px solid ${codeBorder}`,
                px: 1.5,
                py: 0.75,
                textAlign: 'left',
              },
              '& th': {
                bgcolor: isDark ? 'rgba(22,27,34,0.6)' : 'rgba(108,99,255,0.06)',
                fontWeight: 600,
              },
            },
            '& hr': {
              border: 'none',
              borderTop: `1px solid ${codeBorder}`,
              my: 2,
            },
            '& a': {
              color: primaryColor,
              textDecoration: 'underline',
              '&:hover': { color: isDark ? '#8B83FF' : '#7B75FF' },
            },
            '& img': {
              maxWidth: '100%',
              borderRadius: 1,
              my: 1,
            },
            '& mark': {
              bgcolor: `${primaryColor}40`,
              color: 'inherit',
              borderRadius: 0.25,
              px: 0.25,
            },
            '& ul[data-type="taskList"]': {
              listStyle: 'none',
              pl: 0,
              '& li': {
                display: 'flex',
                alignItems: 'flex-start',
                gap: 0.5,
                '& label': {
                  mt: 0.25,
                },
              },
            },
            '& div[data-callout]': {
              '& [data-callout-content] p': { mb: 0.5 },
              '& [data-callout-content] p:last-child': { mb: 0 },
            },
            '& div[data-latex]': {
              '& .katex': { fontSize: '1.1em' },
              '& .katex-display': { margin: '0 !important' },
            },
            '& div[data-bookmark]': {
              '&:hover': { borderColor: `${primaryColor} !important` },
            },
          },
        }}
      >
        <EditorToolbar editor={editor} onAiOptimize={handleAiOptimize} aiOptimizing={aiOptimizing} />
        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'auto', minHeight: 0 }}>
          <EditorContent editor={editor} />
        </Box>
        {charCount && (
          <Box sx={{ px: 2, py: 0.5, borderTop: '1px solid', borderColor: 'divider', display: 'flex', justifyContent: 'flex-end' }}>
            <Typography variant="caption" color="text.secondary">
              {charCount.characters()} chars · {charCount.words()} words
            </Typography>
          </Box>
        )}
      </Box>

      {linkedCommands.length > 0 && (
        <Box sx={{ mt: 2 }}>
          <Typography variant="subtitle2" sx={{ mb: 0.5, display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <LinkIcon size={14} color={primaryColor} /> {t('notebook.linked_commands')}
          </Typography>
          <List dense sx={{ maxHeight: 150, overflow: 'auto', border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
            {linkedCommands.map((link) => (
              <ListItem
                key={link.id}
                sx={{ borderRadius: 1 }}
              >
                <ListItemIcon sx={{ minWidth: 28 }}>
                  <CodeIcon size={14} color={mutedColor} />
                </ListItemIcon>
                <ListItemText
                  primary={link.context}
                  slotProps={{
                    primary: { variant: 'body2', sx: { fontFamily: 'monospace' }, noWrap: true },
                  }}
                />
              </ListItem>
            ))}
          </List>
        </Box>
      )}
      <AiOptimizeDialog
        open={aiDialogOpen}
        onClose={handleAiDialogClose}
        onCancel={handleAiCancel}
        chunks={aiChunks}
        status={aiStatus}
        errorMessage={aiError}
      />
    </Box>
  );
}
