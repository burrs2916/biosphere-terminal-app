import { useState, useEffect, useCallback, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Box, Typography, List, ListItemButton, ListItemText, ListItemIcon,
  IconButton, TextField, InputAdornment, Card, CardActionArea, CardContent,
  Tooltip, Divider,
} from '@mui/material';
import {
  BooksIcon, TagIcon, NoteIcon, CodeIcon, PushPinIcon,
  MagnifyingGlassIcon, ArrowLeftIcon, CopyIcon, PlayIcon, CheckIcon,
} from '@phosphor-icons/react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { invoke } from '@tauri-apps/api/core';
import { IconRenderer } from './IconRenderer';
import { listNotes, listNoteGroups, listNoteCategoriesByGroup, getNote } from '../../../core/services/notebook.service';
import type { NoteDto, NoteGroupDto, NoteCategoryDto } from '../../../proto/notebook';

const SHELL_LANGS = new Set(['bash', 'sh', 'zsh', 'shell', 'fish', 'powershell', 'pwsh', 'cmd', 'bat']);

function CodeBlock({ className, children }: { className?: string; children?: ReactNode }) {
  const { t } = useTranslation('notebook');
  const match = /language-(\w+)/.exec(className || '');
  const lang = match ? match[1] : '';
  const codeStr = String(children).replace(/\n$/, '');
  const isShell = SHELL_LANGS.has(lang) || (!lang && codeStr.trim().split('\n').length <= 3 && /^[#$>]/m.test(codeStr));
  const [copied, setCopied] = useState(false);
  const [executed, setExecuted] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(codeStr);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = codeStr;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [codeStr]);

  const handleExecute = useCallback(async () => {
    try {
      await invoke('relay_execute_command', { command: codeStr });
      setExecuted(true);
      setTimeout(() => setExecuted(false), 2000);
    } catch (e) {
      console.error('Failed to relay execute-command:', e);
    }
  }, [codeStr]);

  return (
    <Box
      sx={{
        position: 'relative',
        bgcolor: '#0D1117',
        borderRadius: 1.5,
        border: '1px solid rgba(48,54,61,0.6)',
        my: 1.5,
        overflow: 'hidden',
      }}
    >
      {lang && (
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            px: 1.5,
            py: 0.5,
            bgcolor: 'rgba(48,54,61,0.4)',
            borderBottom: '1px solid rgba(48,54,61,0.6)',
          }}
        >
          <Typography
            sx={{
              fontSize: 10,
              fontWeight: 600,
              color: '#8B949E',
              textTransform: 'uppercase',
              letterSpacing: 0.5,
            }}
          >
            {lang}
          </Typography>
          <Box sx={{ display: 'flex', gap: 0.5 }}>
            <Tooltip title={copied ? (t('ref.copied') || 'Copied!') : (t('ref.copy') || 'Copy')} arrow>
              <IconButton
                size="small"
                onClick={handleCopy}
                sx={{
                  p: 0.25,
                  color: copied ? '#81C784' : '#8B949E',
                  '&:hover': { color: '#E6EDF3', bgcolor: 'rgba(255,255,255,0.08)' },
                  transition: 'color 0.2s',
                }}
              >
                {copied ? <CheckIcon size={14} weight="bold" /> : <CopyIcon size={14} />}
              </IconButton>
            </Tooltip>
            {isShell && (
              <Tooltip title={executed ? (t('ref.sent') || 'Sent!') : (t('ref.execute') || 'Execute in terminal')} arrow>
                <IconButton
                  size="small"
                  onClick={handleExecute}
                  sx={{
                    p: 0.25,
                    color: executed ? '#81C784' : '#6C63FF',
                    '&:hover': { color: '#9B94FF', bgcolor: 'rgba(108,99,255,0.12)' },
                    transition: 'color 0.2s',
                  }}
                >
                  {executed ? <CheckIcon size={14} weight="bold" /> : <PlayIcon size={14} weight="fill" />}
                </IconButton>
              </Tooltip>
            )}
          </Box>
        </Box>
      )}
      {!lang && (
        <Box
          sx={{
            position: 'absolute',
            top: 4,
            right: 4,
            display: 'flex',
            gap: 0.5,
            opacity: 0,
            transition: 'opacity 0.2s',
            '.code-block-hover:hover &': { opacity: 1 },
          }}
        >
          <Tooltip title={copied ? (t('ref.copied') || 'Copied!') : (t('ref.copy') || 'Copy')} arrow>
            <IconButton
              size="small"
              onClick={handleCopy}
              sx={{
                p: 0.25,
                color: copied ? '#81C784' : '#8B949E',
                '&:hover': { color: '#E6EDF3', bgcolor: 'rgba(255,255,255,0.08)' },
              }}
            >
              {copied ? <CheckIcon size={14} weight="bold" /> : <CopyIcon size={14} />}
            </IconButton>
          </Tooltip>
          {isShell && (
            <Tooltip title={executed ? (t('ref.sent') || 'Sent!') : (t('ref.execute') || 'Execute in terminal')} arrow>
              <IconButton
                size="small"
                onClick={handleExecute}
                sx={{
                  p: 0.25,
                  color: executed ? '#81C784' : '#6C63FF',
                  '&:hover': { color: '#9B94FF', bgcolor: 'rgba(108,99,255,0.12)' },
                }}
              >
                {executed ? <CheckIcon size={14} weight="bold" /> : <PlayIcon size={14} weight="fill" />}
              </IconButton>
            </Tooltip>
          )}
        </Box>
      )}
      <Box
        component="pre"
        className="code-block-hover"
        sx={{
          p: 1.5,
          m: 0,
          overflow: 'auto',
          '& code': {
            bgcolor: 'transparent',
            px: 0,
            py: 0,
            color: '#E6EDF3',
            fontSize: '0.8rem',
            fontFamily: '"JetBrains Mono", "Fira Code", Menlo, Monaco, monospace',
          },
        }}
      >
        <code className={className}>{children}</code>
      </Box>
    </Box>
  );
}

const markdownStyles = {
  '& h1': { fontSize: '1.5rem', fontWeight: 700, mt: 2, mb: 1, color: 'text.primary' },
  '& h2': { fontSize: '1.25rem', fontWeight: 600, mt: 1.75, mb: 0.75, color: 'text.primary' },
  '& h3': { fontSize: '1.1rem', fontWeight: 600, mt: 1.5, mb: 0.5, color: 'text.primary' },
  '& h4': { fontSize: '1rem', fontWeight: 600, mt: 1.25, mb: 0.5, color: 'text.primary' },
  '& p': { mb: 1, lineHeight: 1.7, color: 'text.primary', fontSize: '0.875rem' },
  '& ul, & ol': { pl: 2.5, mb: 1 },
  '& li': { mb: 0.25, fontSize: '0.875rem', lineHeight: 1.6 },
  '& blockquote': {
    borderLeft: '3px solid #6C63FF',
    pl: 2, py: 0.5, my: 1.5,
    bgcolor: 'rgba(108,99,255,0.06)',
    borderRadius: '0 4px 4px 0',
    '& p': { mb: 0, fontStyle: 'italic', color: 'text.secondary' },
  },
  '& code': {
    bgcolor: 'rgba(108,99,255,0.1)',
    px: 0.5, py: 0.15, borderRadius: 0.5,
    fontSize: '0.8rem',
    fontFamily: '"JetBrains Mono", "Fira Code", Menlo, Monaco, monospace',
    color: '#CE93D8',
  },
  '& pre': { m: 0, p: 0, bgcolor: 'transparent', border: 'none' },
  '& table': {
    borderCollapse: 'collapse', width: '100%', my: 1.5, fontSize: '0.8rem',
    '& th, & td': { border: '1px solid rgba(48,54,61,0.6)', px: 1.5, py: 0.75, textAlign: 'left' },
    '& th': { bgcolor: 'rgba(108,99,255,0.08)', fontWeight: 600 },
    '& tr:nth-of-type(even)': { bgcolor: 'rgba(255,255,255,0.02)' },
  },
  '& a': { color: '#4FC3F7', textDecoration: 'none', '&:hover': { textDecoration: 'underline' } },
  '& hr': { border: 'none', borderTop: '1px solid rgba(48,54,61,0.6)', my: 2 },
  '& img': { maxWidth: '100%', borderRadius: 1 },
};

type ViewMode = 'categories' | 'notes' | 'preview';

export function NotesReferencePage() {
  const { t } = useTranslation('notebook');

  const [groups, setGroups] = useState<NoteGroupDto[]>([]);
  const [categories, setCategories] = useState<NoteCategoryDto[]>([]);
  const [notes, setNotes] = useState<NoteDto[]>([]);
  const [activeGroupId, setActiveGroupId] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('categories');
  const [activeCategory, setActiveCategory] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedNote, setSelectedNote] = useState<NoteDto | null>(null);
  const [noteContent, setNoteContent] = useState('');
  const [loadingContent, setLoadingContent] = useState(false);

  useEffect(() => {
    listNoteGroups().then(setGroups).catch(console.error);
  }, []);

  const loadGroupData = useCallback(async (groupId: string) => {
    if (groupId) {
      const [cats, ns] = await Promise.all([
        listNoteCategoriesByGroup(groupId),
        listNotes(groupId),
      ]);
      setCategories(cats);
      setNotes(ns);
    } else {
      const ns = await listNotes();
      setNotes(ns);
      setCategories([]);
    }
    setViewMode('categories');
    setActiveCategory('');
    setSelectedNote(null);
  }, []);

  const handleGroupClick = useCallback((groupId: string) => {
    const newGroupId = activeGroupId === groupId ? '' : groupId;
    setActiveGroupId(newGroupId);
    loadGroupData(newGroupId);
  }, [activeGroupId, loadGroupData]);

  const handleCategoryClick = useCallback(async (categoryName: string) => {
    setActiveCategory(categoryName);
    setViewMode('notes');
    setSearchQuery('');
    setSelectedNote(null);
  }, []);

  const handleNoteClick = useCallback(async (note: NoteDto) => {
    setSelectedNote(note);
    setViewMode('preview');
    setLoadingContent(true);
    try {
      const detail = await getNote(note.id);
      setNoteContent(detail?.content || '');
    } catch {
      setNoteContent('');
    }
    setLoadingContent(false);
  }, []);

  const handleBack = useCallback(() => {
    if (viewMode === 'preview') {
      setSelectedNote(null);
      setViewMode('notes');
    } else if (viewMode === 'notes') {
      setActiveCategory('');
      setViewMode('categories');
    }
  }, [viewMode]);

  const activeGroup = groups.find((g) => g.id === activeGroupId);

  const filteredNotes = (() => {
    let result = notes;
    if (activeGroupId && activeCategory) {
      result = result.filter((n) => n.category === activeCategory && n.groupId === activeGroupId);
    } else if (activeGroupId && !activeCategory) {
      result = result.filter((n) => n.groupId === activeGroupId);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter((n) => n.title.toLowerCase().includes(q));
    }
    return result;
  })();

  const getNoteCountForCategory = (catName: string) => {
    return notes.filter((n) => n.category === catName && n.groupId === activeGroupId).length;
  };

  const uncategorizedCount = notes.filter((n) => n.groupId === activeGroupId && !n.category).length;

  const renderGroupItem = (group: NoteGroupDto) => {
    const isActive = activeGroupId === group.id;
    return (
      <ListItemButton
        key={group.id}
        onClick={() => handleGroupClick(group.id)}
        selected={isActive}
        sx={{
          borderRadius: 1.5,
          mx: 0.5,
          mb: 0.25,
          '&.Mui-selected': {
            bgcolor: `${group.color}18`,
            '&:hover': { bgcolor: `${group.color}28` },
          },
          '&:hover': { bgcolor: 'rgba(255,255,255,0.04)' },
        }}
      >
        <ListItemIcon sx={{ minWidth: 28 }}>
          <IconRenderer value={group.icon} size={16} />
        </ListItemIcon>
        <ListItemText
          primary={group.name}
          slotProps={{
            primary: {
              noWrap: true,
              sx: { fontSize: 12, fontWeight: isActive ? 600 : 400, color: isActive ? group.color : 'text.primary' },
            },
          }}
        />
        <Typography variant="caption" color="text.secondary" sx={{ mr: 0.5, fontSize: 10 }}>
          {group.noteCount}
        </Typography>
      </ListItemButton>
    );
  };

  const renderCategoryCards = () => (
    <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'auto', p: 3 }}>
      {activeGroup && (
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 3 }}>
          <IconRenderer
            value={activeGroup.icon}
            size={24}
            sx={{
              width: 40, height: 40, borderRadius: 2,
              bgcolor: `${activeGroup.color}18`,
              border: '1px solid', borderColor: `${activeGroup.color}40`,
              mr: 1.5,
            }}
          />
          <Box>
            <Typography variant="h6" sx={{ fontSize: 18, fontWeight: 700, color: activeGroup.color }}>
              {activeGroup.name}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {activeGroup.noteCount} {t('notebook.notes') || 'notes'}
            </Typography>
          </Box>
        </Box>
      )}

      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
        {categories.map((cat) => {
          const count = getNoteCountForCategory(cat.name);
          return (
            <Card
              key={cat.id}
              sx={{
                width: 180, borderRadius: 3,
                border: '1px solid', borderColor: 'divider',
                bgcolor: 'rgba(255,255,255,0.02)',
                transition: 'all 0.2s',
                '&:hover': {
                  borderColor: '#6C63FF',
                  boxShadow: '0 4px 20px rgba(108,99,255,0.15)',
                  transform: 'translateY(-2px)',
                },
              }}
            >
              <CardActionArea onClick={() => handleCategoryClick(cat.name)} sx={{ p: 0 }}>
                <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
                    <TagIcon size={20} color={cat.isDefault ? '#6C63FF' : '#8B949E'} />
                    <Typography variant="subtitle2" sx={{ fontSize: 14, fontWeight: 600 }} noWrap>
                      {cat.name}
                    </Typography>
                  </Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <NoteIcon size={12} color="#8B949E" />
                    <Typography variant="caption" color="text.secondary">
                      {count} {t('notebook.notes') || 'notes'}
                    </Typography>
                  </Box>
                </CardContent>
              </CardActionArea>
            </Card>
          );
        })}

        {uncategorizedCount > 0 && (
          <Card
            sx={{
              width: 180, borderRadius: 3,
              border: '1px dashed', borderColor: 'divider',
              bgcolor: 'rgba(255,255,255,0.01)',
              transition: 'all 0.2s',
              '&:hover': { borderColor: '#8B949E', transform: 'translateY(-2px)' },
            }}
          >
            <CardActionArea onClick={() => handleCategoryClick('')} sx={{ p: 0 }}>
              <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
                  <NoteIcon size={20} color="#8B949E" />
                  <Typography variant="subtitle2" sx={{ fontSize: 14, fontWeight: 600 }} noWrap>
                    {t('category.uncategorized')}
                  </Typography>
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <NoteIcon size={12} color="#8B949E" />
                  <Typography variant="caption" color="text.secondary">
                    {uncategorizedCount} {t('notebook.notes') || 'notes'}
                  </Typography>
                </Box>
              </CardContent>
            </CardActionArea>
          </Card>
        )}
      </Box>

      {categories.length === 0 && uncategorizedCount === 0 && (
        <Box sx={{ textAlign: 'center', mt: 6 }}>
          <TagIcon size={40} color="#8B949E" style={{ opacity: 0.3 }} />
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            {t('category.empty_hint')}
          </Typography>
        </Box>
      )}
    </Box>
  );

  const renderNoteList = () => (
    <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <Box sx={{ p: 1.5 }}>
        <TextField
          fullWidth
          size="small"
          placeholder={t('notebook.search_notes') || ''}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          sx={{ '& .MuiOutlinedInput-root': { borderRadius: 2, backgroundColor: 'rgba(108,99,255,0.06)' } }}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <MagnifyingGlassIcon size={14} color="#8B949E" />
                </InputAdornment>
              ),
            },
          }}
        />
      </Box>
      <Divider />
      <Box sx={{ flex: 1, overflow: 'auto' }}>
        <List dense>
          {filteredNotes.map((note) => {
            const isCommand = note.category === 'command';
            const timeStr = note.updatedAt
              ? new Date(note.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
              : '';
            return (
              <ListItemButton
                key={note.id}
                onClick={() => handleNoteClick(note)}
                selected={selectedNote?.id === note.id}
                sx={{
                  borderRadius: 1.5, mx: 0.5, mb: 0.25,
                  '&.Mui-selected': { bgcolor: 'rgba(108,99,255,0.12)', '&:hover': { bgcolor: 'rgba(108,99,255,0.18)' } },
                }}
              >
                <ListItemIcon sx={{ minWidth: 28 }}>
                  {note.isPinned ? (
                    <PushPinIcon size={14} weight="fill" color="#FFD740" />
                  ) : isCommand ? (
                    <CodeIcon size={14} color="#81C784" />
                  ) : (
                    <NoteIcon size={14} color="#81C784" />
                  )}
                </ListItemIcon>
                <ListItemText
                  primary={note.title || t('notebook.note_title')}
                  secondary={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      <Typography component="span" variant="caption" color="text.secondary" sx={{ fontSize: 10 }}>
                        {note.category || t('category.uncategorized')}
                      </Typography>
                      {timeStr && (
                        <Typography component="span" variant="caption" color="text.secondary" sx={{ fontSize: 9, opacity: 0.7 }}>
                          · {timeStr}
                        </Typography>
                      )}
                    </Box>
                  }
                  slotProps={{
                    primary: { noWrap: true, sx: { fontSize: 12, fontWeight: note.isPinned ? 600 : 400 } },
                  }}
                />
              </ListItemButton>
            );
          })}
          {filteredNotes.length === 0 && (
            <Box sx={{ p: 3, textAlign: 'center' }}>
              <NoteIcon size={24} color="#8B949E" style={{ opacity: 0.5 }} />
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                {t('notebook.no_notes')}
              </Typography>
            </Box>
          )}
        </List>
      </Box>
    </Box>
  );

  const renderPreview = () => (
    <Box sx={{ flex: 1, overflow: 'auto', p: 3 }}>
      {loadingContent ? (
        <Typography variant="body2" color="text.secondary">Loading...</Typography>
      ) : (
        <Box sx={markdownStyles}>
          <Markdown
            remarkPlugins={[remarkGfm]}
            components={{
              pre: ({ children }) => <>{children}</>,
              code: ({ className, children, ...props }) => {
                const isBlock = /language-/.test(className || '') || String(children).includes('\n');
                if (isBlock) {
                  return <CodeBlock className={className}>{children}</CodeBlock>;
                }
                return (
                  <code className={className} {...props}>
                    {children}
                  </code>
                );
              },
            }}
          >
            {noteContent}
          </Markdown>
        </Box>
      )}
    </Box>
  );

  const renderMainContent = () => {
    if (viewMode === 'preview') {
      return (
        <Box sx={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          <Box sx={{ width: 280, minWidth: 280, borderRight: '1px solid', borderColor: 'divider', display: 'flex', flexDirection: 'column' }}>
            {renderNoteList()}
          </Box>
          {renderPreview()}
        </Box>
      );
    }

    if (viewMode === 'notes') {
      return renderNoteList();
    }

    return renderCategoryCards();
  };

  return (
    <Box sx={{ height: '100vh', display: 'flex', flexDirection: 'column', bgcolor: 'background.default' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 1, borderBottom: '1px solid', borderColor: 'divider' }}>
        {viewMode !== 'categories' && (
          <Tooltip title="Back">
            <IconButton size="small" onClick={handleBack}>
              <ArrowLeftIcon size={18} color="#8B949E" />
            </IconButton>
          </Tooltip>
        )}
        {activeGroup && (
          <IconRenderer
            value={activeGroup.icon}
            size={18}
            sx={{
              width: 28, height: 28, borderRadius: 1.5,
              bgcolor: `${activeGroup.color}18`,
              border: '1px solid', borderColor: `${activeGroup.color}40`,
            }}
          />
        )}
        <Typography variant="subtitle1" sx={{ fontWeight: 600, flex: 1 }}>
          {viewMode === 'preview' && selectedNote
            ? selectedNote.title
            : viewMode === 'notes'
              ? activeCategory || t('category.uncategorized')
              : t('notebook.all_notes')}
        </Typography>
      </Box>

      <Box sx={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <Box
          sx={{
            width: 200, minWidth: 200,
            borderRight: '1px solid', borderColor: 'divider',
            display: 'flex', flexDirection: 'column',
            bgcolor: 'rgba(0,0,0,0.02)',
          }}
        >
          <Box sx={{ p: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, fontSize: 10 }}>
              {t('group.title')}
            </Typography>
          </Box>

          <List dense sx={{ flex: 1, overflow: 'auto', px: 0.5 }}>
            <ListItemButton
              onClick={() => handleGroupClick('')}
              selected={activeGroupId === ''}
              sx={{
                borderRadius: 1.5, mb: 0.25,
                '&.Mui-selected': { bgcolor: 'rgba(108,99,255,0.12)' },
              }}
            >
              <ListItemIcon sx={{ minWidth: 28 }}>
                <BooksIcon size={14} color="#6C63FF" />
              </ListItemIcon>
              <ListItemText
                primary={t('notebook.all_notes')}
                slotProps={{ primary: { sx: { fontSize: 12, fontWeight: activeGroupId === '' ? 600 : 400 } } }}
              />
            </ListItemButton>

            <Divider sx={{ my: 0.5, mx: 1 }} />

            {groups.map(renderGroupItem)}
          </List>
        </Box>

        {renderMainContent()}
      </Box>
    </Box>
  );
}
