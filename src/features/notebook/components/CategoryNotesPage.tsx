import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Box, List, IconButton, Typography, Divider,
} from '@mui/material';
import {
  PlusIcon, TagIcon,
} from '@phosphor-icons/react';
import { listen } from '@tauri-apps/api/event';
import { useNotebookStore } from '../store/notebookStore';
import { NoteEditor } from './NoteEditor';
import { NoteListItem, NoteSearchBar } from './NoteListItem';
import { IconRenderer } from './IconRenderer';
import { getNote } from '../../../core/services/notebook.service';
import type { NoteDto } from '../../../proto/notebook';
import { useTheme } from '@mui/material/styles';

export function CategoryNotesPage() {
  const { t } = useTranslation('notebook');
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const primaryColor = isDark ? '#6C63FF' : '#5B54E0';

  // 该页面以独立 webview 窗口打开，URL 形如
  //   /#/category-notes?groupId=X&category=Y&noteId=Z
  // query 参数在 hash 片段内，不在 location.search（后者恒为空），
  // 故必须从 location.hash 解析，否则 groupId/category/noteId 永远为空，
  // 导致 loadNotes() 拉全部笔记、标题退化成 All Notes（用户报的"打开分类却显示全部笔记"）。
  const hashQuery = (() => {
    const hash = window.location.hash;
    const qIndex = hash.indexOf('?');
    return qIndex >= 0 ? hash.substring(qIndex + 1) : '';
  })();
  const params = new URLSearchParams(hashQuery);
  const groupId = params.get('groupId') || '';
  const categoryName = params.get('category') || '';
  const noteIdParam = params.get('noteId') || '';

  const {
    notes, groups, loadNotes, loadGroups, deleteNote, togglePin, searchNotes,
    loadCategoriesByGroup,
  } = useNotebookStore();

  const [selectedNote, setSelectedNote] = useState<NoteDto | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [initialNoteLoaded, setInitialNoteLoaded] = useState(false);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 持有最新搜索词，供 notes-changed 监听器重建视图时使用（避免闭包捕获到过期的空搜索词，
  // 导致笔记保存/AI 改动后搜索结果被静默清空，R24 修复）。
  const searchQueryRef = useRef('');

  useEffect(() => {
    loadGroups();
    if (groupId) {
      loadCategoriesByGroup(groupId);
      loadNotes(groupId, categoryName || undefined);
    } else {
      loadNotes();
    }
  }, [groupId, categoryName, loadNotes, loadGroups, loadCategoriesByGroup]);

  // 本页面是独立 webview 窗口，同样需要订阅 notes-changed，使 AI 改动后即时刷新当前分组/分类视图（P1-5）。
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen<unknown>('notes-changed', () => {
      // 若当前正在搜索，重建搜索结果而非退回全量列表，避免搜索被静默清空（R24 修复）。
      if (searchQueryRef.current.trim()) {
        loadCategoriesByGroup(groupId);
        searchNotes(searchQueryRef.current);
        return;
      }
      if (groupId) {
        loadCategoriesByGroup(groupId);
        loadNotes(groupId, categoryName || undefined);
      } else {
        loadNotes();
      }
    }).then((fn) => { unlisten = fn; });
    return () => { if (unlisten) unlisten(); };
  }, [groupId, categoryName, loadNotes, loadCategoriesByGroup, searchNotes]);

  // 切换到不同分组/分类时，清掉上一个视图残留的选中笔记。
  // 该组件为同路由只换 query 参数，组件不重新挂载，selectedNote 会残留
  // 导致编辑器显示别的组的笔记详情（用户报的"打开空分类却弹出其他组笔记"）。
  // 置于 noteIdParam effect 之前：深链接笔记会先被清、再被下方 effect 重新加载。
  useEffect(() => {
    setSelectedNote(null);
    setInitialNoteLoaded(false);
  }, [groupId, categoryName]);

  useEffect(() => {
    if (noteIdParam && !initialNoteLoaded && notes.length >= 0) {
      const found = notes.find((n) => n.id === noteIdParam);
      if (found) {
        setSelectedNote(found);
        setInitialNoteLoaded(true);
      } else if (!initialNoteLoaded) {
        getNote(noteIdParam).then((detail) => {
          if (detail) {
            setSelectedNote(detail.note);
            if (detail.note.groupId && !groupId) {
              loadNotes(detail.note.groupId);
            }
          }
          setInitialNoteLoaded(true);
        }).catch(() => setInitialNoteLoaded(true));
      }
    }
  }, [noteIdParam, notes, initialNoteLoaded, groupId, loadNotes]);

  const activeGroup = groups.find((g) => g.id === groupId);

  const pinnedNotes = notes.filter((n) => n.isPinned);
  const unpinnedNotes = notes.filter((n) => !n.isPinned);

  const handleSaved = useCallback((newNoteId?: string) => {
    if (newNoteId) {
      // 新建笔记首次保存后把新笔记写回 selectedNote，避免 note prop 为空导致后续保存静默丢失（P0-1）
      getNote(newNoteId).then((detail) => {
        if (detail) setSelectedNote(detail.note);
      }).catch(() => {});
    }
    if (groupId) {
      loadNotes(groupId, categoryName || undefined);
      loadCategoriesByGroup(groupId);
    } else {
      loadNotes();
    }
  }, [groupId, categoryName, loadNotes, loadCategoriesByGroup, getNote]);

  const handleDeleteNote = useCallback((noteId: string) => {
    deleteNote(noteId);
    if (selectedNote?.id === noteId) setSelectedNote(null);
  }, [deleteNote, selectedNote]);

  const handleTogglePin = useCallback((noteId: string) => {
    togglePin(noteId);
  }, [togglePin]);

  const handleSearch = useCallback((value: string) => {
    setSearchQuery(value);
    searchQueryRef.current = value;
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    if (value.trim()) {
      searchTimerRef.current = setTimeout(() => {
        searchNotes(value);
      }, 300);
    } else {
      if (groupId) {
        loadNotes(groupId, categoryName || undefined);
      } else {
        loadNotes();
      }
    }
  }, [groupId, categoryName, loadNotes, searchNotes]);

  const { t: tCommon } = useTranslation('common');

  const pageTitle = categoryName
    ? `${categoryName} — ${activeGroup?.name || t('group.uncategorized')}`
    : noteIdParam
      ? t('notebook.edit_note')
      : t('notebook.all_notes');

  return (
    <Box sx={{ height: '100vh', display: 'flex', flexDirection: 'column', bgcolor: 'background.default' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 1, borderBottom: '1px solid', borderColor: 'divider' }}>
        {activeGroup && (
          <IconRenderer
            value={activeGroup.icon}
            size={18}
            sx={{
              width: 28,
              height: 28,
              borderRadius: 1.5,
              bgcolor: `${activeGroup.color}18`,
              border: '1px solid',
              borderColor: `${activeGroup.color}40`,
            }}
          />
        )}
        <TagIcon size={16} color={primaryColor} />
        <Typography variant="subtitle1" sx={{ fontWeight: 600, flex: 1 }}>
          {pageTitle}
        </Typography>
        <IconButton size="small" onClick={() => setSelectedNote(null)} sx={{ color: primaryColor }}>
          <PlusIcon size={18} />
        </IconButton>
      </Box>

      <Box sx={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <Box sx={{ width: 280, minWidth: 280, borderRight: '1px solid', borderColor: 'divider', display: 'flex', flexDirection: 'column' }}>
          <NoteSearchBar value={searchQuery} onChange={handleSearch} placeholder={t('notebook.search_notes') || ''} />

          <Divider />

          <Box sx={{ flex: 1, overflow: 'auto' }}>
            <List dense>
              {pinnedNotes.length > 0 && (
                <>
                  <Typography variant="caption" color="text.secondary" sx={{ px: 2, py: 0.5, fontWeight: 600, fontSize: 10 }}>
                    {tCommon('action.pin').toUpperCase()}
                  </Typography>
                  {pinnedNotes.map((note) => (
                    <NoteListItem
                      key={note.id}
                      note={note}
                      selected={selectedNote?.id === note.id}
                      onClick={setSelectedNote}
                      onTogglePin={handleTogglePin}
                      onDelete={handleDeleteNote}
                    />
                  ))}
                  <Divider sx={{ my: 0.5 }} />
                </>
              )}
              {unpinnedNotes.map((note) => (
                <NoteListItem
                  key={note.id}
                  note={note}
                  selected={selectedNote?.id === note.id}
                  onClick={setSelectedNote}
                  onTogglePin={handleTogglePin}
                  onDelete={handleDeleteNote}
                />
              ))}
              {notes.length === 0 && !noteIdParam && (
                <Box sx={{ p: 3, textAlign: 'center' }}>
                  <Typography variant="body2" color="text.secondary">
                    {t('notebook.no_notes')}
                  </Typography>
                </Box>
              )}
            </List>
          </Box>
        </Box>

        <Box sx={{ flex: 1, overflow: 'hidden' }}>
          <NoteEditor
            key={selectedNote?.id ?? 'new'}
            note={selectedNote}
            onClose={() => setSelectedNote(null)}
            onSaved={handleSaved}
            defaultGroupId={groupId}
            defaultCategory={categoryName}
          />
        </Box>
      </Box>
    </Box>
  );
}
