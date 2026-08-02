import { useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNotify } from '../../../core/notification';
import {
  Box, Typography, List, ListItemButton, ListItemText, ListItemIcon,
  IconButton, TextField, InputAdornment, Tooltip, Divider,
} from '@mui/material';
import {
  BooksIcon, TagIcon, NoteIcon, CodeIcon, PushPinIcon,
  MagnifyingGlassIcon, CopyIcon, CheckIcon,
} from '@phosphor-icons/react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { IconRenderer } from './IconRenderer';
import { listNotes, listNoteGroups, listNoteCategoriesByGroup, getNote } from '../../../core/services/notebook.service';
import type { NoteDto, NoteGroupDto, NoteCategoryDto } from '../../../proto/notebook';
import { useTheme } from '@mui/material/styles';
import { useFeatureGate, LockedScreen } from '../../licensing';
import { listen } from '@tauri-apps/api/event';
import { localizeBackendError } from '../../../core/backendError';

function CodeBlock({ className, children }: { className?: string; children?: ReactNode }) {
  const { t } = useTranslation('notebook');
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const mutedColor = isDark ? '#8B949E' : '#6B7280';
  const codeBg = isDark ? '#0D1117' : '#F5F5F5';
  const codeBorder = isDark ? 'rgba(48,54,61,0.6)' : 'rgba(0,0,0,0.08)';
  const codeHeaderBg = isDark ? 'rgba(48,54,61,0.4)' : 'rgba(0,0,0,0.04)';
  const codeTextColor = isDark ? '#E6EDF3' : '#1A1A2E';
  const successColor = isDark ? '#81C784' : '#2E7D32';

  const match = /language-(\w+)/.exec(className || '');
  const lang = match ? match[1] : '';
  const codeStr = String(children).replace(/\n$/, '');
  const [copied, setCopied] = useState(false);

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

  return (
    <Box
      sx={{
        position: 'relative',
        bgcolor: codeBg,
        borderRadius: 1.5,
        border: `1px solid ${codeBorder}`,
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
            bgcolor: codeHeaderBg,
            borderBottom: `1px solid ${codeBorder}`,
          }}
        >
          <Typography
            sx={{
              fontSize: 10,
              fontWeight: 600,
              color: mutedColor,
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
                  color: copied ? successColor : mutedColor,
                  '&:hover': { color: codeTextColor, bgcolor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' },
                  transition: 'color 0.2s',
                }}
              >
                {copied ? <CheckIcon size={14} weight="bold" /> : <CopyIcon size={14} />}
              </IconButton>
            </Tooltip>
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
                color: copied ? successColor : mutedColor,
                '&:hover': { color: codeTextColor, bgcolor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' },
              }}
            >
              {copied ? <CheckIcon size={14} weight="bold" /> : <CopyIcon size={14} />}
            </IconButton>
          </Tooltip>
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
            color: codeTextColor,
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

function getMarkdownStyles(isDark: boolean) {
  const primaryColor = isDark ? '#6C63FF' : '#5B54E0';
  const codeBorderColor = isDark ? 'rgba(48,54,61,0.6)' : 'rgba(0,0,0,0.08)';
  const inlineCodeColor = isDark ? '#CE93D8' : '#7B1FA2';
  const linkColor = isDark ? '#4FC3F7' : '#1565C0';

  return {
    '& h1': { fontSize: '1.5rem', fontWeight: 700, mt: 2, mb: 1, color: 'text.primary' },
    '& h2': { fontSize: '1.25rem', fontWeight: 600, mt: 1.75, mb: 0.75, color: 'text.primary' },
    '& h3': { fontSize: '1.1rem', fontWeight: 600, mt: 1.5, mb: 0.5, color: 'text.primary' },
    '& h4': { fontSize: '1rem', fontWeight: 600, mt: 1.25, mb: 0.5, color: 'text.primary' },
    '& p': { mb: 1, lineHeight: 1.7, color: 'text.primary', fontSize: '0.875rem' },
    '& ul, & ol': { pl: 2.5, mb: 1 },
    '& li': { mb: 0.25, fontSize: '0.875rem', lineHeight: 1.6 },
    '& blockquote': {
      borderLeft: `3px solid ${primaryColor}`,
      pl: 2, py: 0.5, my: 1.5,
      bgcolor: `${primaryColor}10`,
      borderRadius: '0 4px 4px 0',
      '& p': { mb: 0, fontStyle: 'italic', color: 'text.secondary' },
    },
    '& code': {
      bgcolor: `${primaryColor}15`,
      px: 0.5, py: 0.15, borderRadius: 0.5,
      fontSize: '0.8rem',
      fontFamily: '"JetBrains Mono", "Fira Code", Menlo, Monaco, monospace',
      color: inlineCodeColor,
    },
    '& pre': { m: 0, p: 0, bgcolor: 'transparent', border: 'none' },
    '& table': {
      borderCollapse: 'collapse', width: '100%', my: 1.5, fontSize: '0.8rem',
      '& th, & td': { border: `1px solid ${codeBorderColor}`, px: 1.5, py: 0.75, textAlign: 'left' },
      '& th': { bgcolor: `${primaryColor}12`, fontWeight: 600 },
      '& tr:nth-of-type(even)': { bgcolor: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)' },
    },
    '& a': { color: linkColor, textDecoration: 'none', '&:hover': { textDecoration: 'underline' } },
    '& hr': { border: 'none', borderTop: `1px solid ${codeBorderColor}`, my: 2 },
    '& img': { maxWidth: '100%', borderRadius: 1 },
  };
}

export function NotesReferencePage() {
  const { t } = useTranslation('notebook');
  const notify = useNotify().notify;
  // 与 AiCopilotPage / RemoteDesktopPage 保持一致：note_reference 是 Pro 功能，
  // 必须在消费点（页面级）做授权校验，而非仅依赖 TerminalPage 的入口 guard。
  // 否则免费/过期用户只要能打开该独立窗口即可直接看到全部参考内容，
  // 「付费解锁」形同虚设，且付费后也无法体现「从锁到解锁」的一致性状态切换。
  const featureGate = useFeatureGate('note_reference');
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const primaryColor = isDark ? '#6C63FF' : '#5B54E0';
  const mutedColor = isDark ? '#8B949E' : '#6B7280';
  const markdownStyles = getMarkdownStyles(isDark);

  const [groups, setGroups] = useState<NoteGroupDto[]>([]);
  const [categories, setCategories] = useState<NoteCategoryDto[]>([]);
  const [notes, setNotes] = useState<NoteDto[]>([]);
  const [activeGroupId, setActiveGroupId] = useState('');
  const [activeCategory, setActiveCategory] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedNote, setSelectedNote] = useState<NoteDto | null>(null);
  const [noteContent, setNoteContent] = useState('');
  // 持有最新选中笔记 id，供 notes-changed 监听器（仅注册一次）读取，避免闭包捕获到过期的空 selectedNote。
  const selectedNoteRef = useRef<NoteDto | null>(null);
  selectedNoteRef.current = selectedNote;
  const [loadingContent, setLoadingContent] = useState(false);

  useEffect(() => {
    listNoteGroups().then(setGroups).catch((e) => { console.error(e); notify(localizeBackendError(e)); });
    listNotes().then(setNotes).catch((e) => { console.error(e); notify(localizeBackendError(e)); });
  }, []);

  // 订阅后端写操作后广播的 notes-changed：AI 在进程内直接增删改/重归类笔记后，
  // 参考页能即时刷新（此前未订阅，AI 改动后参考页停留在旧数据）。
  // R25 增强：若当前正在预览的笔记被改动（AI 辅助整理 / 其他窗口编辑），一并重拉其
  // 正文/标题/分类，避免只读预览页停留在旧内容——否则 AI 整理成果在参考页不可见。
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen<unknown>('notes-changed', () => {
      listNoteGroups().catch((e) => console.error(e));
      listNotes().catch((e) => console.error(e));
      const selId = selectedNoteRef.current?.id;
      if (selId) {
        getNote(selId)
          .then((detail) => {
            if (detail) {
              setSelectedNote(detail.note);
              setNoteContent(detail.content || '');
            }
          })
          .catch(() => {});
      }
    }).then((fn) => { unlisten = fn; });
    return () => { if (unlisten) unlisten(); };
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
    setActiveCategory('');
    setSelectedNote(null);
    setNoteContent('');
  }, []);

  const handleGroupClick = useCallback((groupId: string) => {
    const newGroupId = activeGroupId === groupId ? '' : groupId;
    setActiveGroupId(newGroupId);
    loadGroupData(newGroupId);
  }, [activeGroupId, loadGroupData]);

  const handleNoteClick = useCallback(async (note: NoteDto) => {
    setSelectedNote(note);
    setLoadingContent(true);
    try {
      const detail = await getNote(note.id);
      setNoteContent(detail?.content || '');
    } catch {
      setNoteContent('');
    }
    setLoadingContent(false);
  }, []);

  const filteredNotes = (() => {
    let result = notes;
    if (activeGroupId && activeCategory) {
      result = result.filter((n) => n.category === activeCategory && n.groupId === activeGroupId);
    } else if (activeGroupId && !activeCategory) {
      result = result.filter((n) => n.groupId === activeGroupId);
    } else if (!activeGroupId && activeCategory) {
      result = result.filter((n) => n.category === activeCategory);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      // R17：本地检索从「仅标题」扩展到 标题 / 分类 / 标签 三个维度，
      // 与 CategoryNotesPage 的后端 searchNotes 对齐，笔记参考页搜索更易命中。
      result = result.filter(
        (n) =>
          n.title.toLowerCase().includes(q) ||
          (n.category && n.category.toLowerCase().includes(q)) ||
          (n.tags && n.tags.some((tg) => tg.toLowerCase().includes(q))),
      );
    }
    return result;
  })();

  const activeGroup = groups.find((g) => g.id === activeGroupId);

  if (!featureGate.canUse) {
    return <LockedScreen feature="note_reference" />;
  }

  return (
    <Box sx={{ height: '100vh', display: 'flex', bgcolor: 'background.default' }}>
      <Box
        sx={{
          width: 180,
          minWidth: 180,
          borderRight: '1px solid',
          borderColor: 'divider',
          display: 'flex',
          flexDirection: 'column',
          bgcolor: isDark ? 'rgba(0,0,0,0.02)' : 'rgba(0,0,0,0.01)',
        }}
      >
        <Box sx={{ px: 1.5, py: 1, borderBottom: '1px solid', borderColor: 'divider' }}>
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
              '&.Mui-selected': { bgcolor: `${primaryColor}18` },
            }}
          >
            <ListItemIcon sx={{ minWidth: 28 }}>
              <BooksIcon size={14} color={primaryColor} />
            </ListItemIcon>
            <ListItemText
              primary={t('notebook.all_notes') || 'All Notes'}
              slotProps={{ primary: { sx: { fontSize: 12, fontWeight: activeGroupId === '' ? 600 : 400 } } }}
            />
          </ListItemButton>

          <Divider sx={{ my: 0.5, mx: 1 }} />

          {groups.map((group) => {
            const isActive = activeGroupId === group.id;
            return (
              <ListItemButton
                key={group.id}
                onClick={() => handleGroupClick(group.id)}
                selected={isActive}
                sx={{
                  borderRadius: 1.5, mb: 0.25,
                  '&.Mui-selected': {
                    bgcolor: `${group.color}18`,
                    '&:hover': { bgcolor: `${group.color}28` },
                  },
                  '&:hover': { bgcolor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)' },
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
          })}
        </List>
      </Box>

      <Box sx={{ width: 280, minWidth: 280, borderRight: '1px solid', borderColor: 'divider', display: 'flex', flexDirection: 'column' }}>
        <Box sx={{ px: 1.5, py: 1, display: 'flex', alignItems: 'center', gap: 1, borderBottom: '1px solid', borderColor: 'divider' }}>
          {activeGroup && (
            <IconRenderer value={activeGroup.icon} size={14} sx={{ width: 22, height: 22, borderRadius: 1, bgcolor: `${activeGroup.color}18`, border: '1px solid', borderColor: `${activeGroup.color}40` }} />
          )}
          <Typography variant="subtitle2" sx={{ fontWeight: 600, fontSize: 13, flex: 1 }}>
            {activeGroup?.name || t('notebook.all_notes') || 'All Notes'}
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10 }}>
            {filteredNotes.length}
          </Typography>
        </Box>

        {categories.length > 0 && (
          <Box sx={{ px: 1, py: 0.75, display: 'flex', flexWrap: 'wrap', gap: 0.5, borderBottom: '1px solid', borderColor: 'divider' }}>
            <Box
              onClick={() => setActiveCategory('')}
              sx={{
                px: 1, py: 0.15, borderRadius: 1, cursor: 'pointer',
                fontSize: 10, fontWeight: !activeCategory ? 600 : 400,
                bgcolor: !activeCategory ? `${primaryColor}18` : 'transparent',
                color: !activeCategory ? primaryColor : mutedColor,
                border: '1px solid',
                borderColor: !activeCategory ? `${primaryColor}40` : 'divider',
                '&:hover': { bgcolor: `${primaryColor}10` },
              }}
            >
              {t('notebook.all_notes') || 'All'}
            </Box>
            {categories.map((cat) => (
              <Box
                key={cat.id}
                onClick={() => setActiveCategory(cat.name)}
                sx={{
                  px: 1, py: 0.15, borderRadius: 1, cursor: 'pointer',
                  fontSize: 10, fontWeight: activeCategory === cat.name ? 600 : 400,
                  bgcolor: activeCategory === cat.name ? `${primaryColor}18` : 'transparent',
                  color: activeCategory === cat.name ? primaryColor : mutedColor,
                  border: '1px solid',
                  borderColor: activeCategory === cat.name ? `${primaryColor}40` : 'divider',
                  '&:hover': { bgcolor: `${primaryColor}10` },
                }}
              >
                {cat.name}
              </Box>
            ))}
          </Box>
        )}

        <Box sx={{ px: 1.5, py: 1 }}>
          <TextField
            fullWidth
            size="small"
            placeholder={t('notebook.search_notes') || ''}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            sx={{ '& .MuiOutlinedInput-root': { borderRadius: 2, backgroundColor: `${primaryColor}10`, fontSize: 12 } }}
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <MagnifyingGlassIcon size={12} color={mutedColor} />
                  </InputAdornment>
                ),
              },
            }}
          />
        </Box>

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
                    '&.Mui-selected': { bgcolor: `${primaryColor}18`, '&:hover': { bgcolor: `${primaryColor}25` } },
                  }}
                >
                  <ListItemIcon sx={{ minWidth: 28 }}>
                    {note.isPinned ? (
                      <PushPinIcon size={14} weight="fill" color={isDark ? '#FFD740' : '#FFAB00'} />
                    ) : isCommand ? (
                      <CodeIcon size={14} color={isDark ? '#81C784' : '#2E7D32'} />
                    ) : (
                      <NoteIcon size={14} color={isDark ? '#81C784' : '#2E7D32'} />
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
                <NoteIcon size={24} color={mutedColor} style={{ opacity: 0.5 }} />
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                  {t('notebook.no_notes')}
                </Typography>
              </Box>
            )}
          </List>
        </Box>
      </Box>

      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {selectedNote ? (
          <>
            <Box sx={{ px: 2, py: 1, display: 'flex', alignItems: 'center', gap: 1, borderBottom: '1px solid', borderColor: 'divider' }}>
              {selectedNote.isPinned && <PushPinIcon size={14} weight="fill" color={isDark ? '#FFD740' : '#FFAB00'} />}
              <Typography variant="subtitle1" sx={{ fontWeight: 600, flex: 1 }}>
                {selectedNote.title}
              </Typography>
              {selectedNote.category && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 1, py: 0.15, borderRadius: 1, bgcolor: `${primaryColor}10`, border: '1px solid', borderColor: `${primaryColor}30` }}>
                  <TagIcon size={10} color={primaryColor} />
                  <Typography variant="caption" sx={{ fontSize: 10, color: primaryColor }}>
                    {selectedNote.category}
                  </Typography>
                </Box>
              )}
            </Box>
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
          </>
        ) : (
          <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1.5 }}>
            <NoteIcon size={40} color={mutedColor} style={{ opacity: 0.3 }} />
            <Typography variant="body2" color="text.secondary">
              {t('notebook.select_note_to_link') || 'Select a note to preview'}
            </Typography>
          </Box>
        )}
      </Box>
    </Box>
  );
}
