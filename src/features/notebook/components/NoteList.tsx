import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Box, List, ListItemButton, ListItemText, ListItemIcon,
  IconButton, Typography, Menu, MenuItem, Tooltip, Divider, Chip,
} from '@mui/material';
import {
  TrashIcon, FolderOpenIcon, DotsThreeVerticalIcon, PlusIcon,
  FolderSimplePlusIcon, PencilSimpleIcon, BooksIcon,
} from '@phosphor-icons/react';
import { listen } from '@tauri-apps/api/event';
import { IconRenderer } from './IconRenderer';
import { useNotebookStore } from '../store/notebookStore';
import { NoteListItem, NoteSearchBar } from './NoteListItem';
import { GroupManageDialog } from './GroupManageDialog';
import { DeleteGroupDialog } from './DeleteGroupDialog';
import type { NoteGroupDto } from '../../../proto/notebook';

interface NoteListProps {
  onSelectNote: (note: NoteDto) => void;
  onNewNote?: () => void;
}

import type { NoteDto } from '../../../proto/notebook';

export function NoteList({ onSelectNote, onNewNote }: NoteListProps) {
  const { t, i18n } = useTranslation('notebook');
  const { t: tCommon } = useTranslation('common');

  const {
    notes, groups, activeGroupId, searchQuery, selectedNote,
    loadNotes, loadGroups, deleteNote, deleteGroup, togglePin, searchNotes,
    setSearchQuery, setActiveGroupId, activeCategory, setActiveCategory, categories, loadCategoriesByGroup, loadAllCategories,
    tags, activeTag, setActiveTag, loadTagsByGroup,
  } = useNotebookStore();

  const [groupManageOpen, setGroupManageOpen] = useState(false);
  const [groupMenuAnchor, setGroupMenuAnchor] = useState<null | HTMLElement>(null);
  const [menuGroupId, setMenuGroupId] = useState<string | null>(null);
  const [groupDeleteOpen, setGroupDeleteOpen] = useState(false);
  const [groupToDelete, setGroupToDelete] = useState<NoteGroupDto | null>(null);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 分类标签：预定义分类走翻译；用户自建分类名不在语言包内时回退显示原始名，避免暴露 raw key 串。
  const categoryLabel = (note: NoteDto): string => {
    if (note.groupId) {
      return groups.find((g) => g.id === note.groupId)?.name || t('group.uncategorized');
    }
    if (note.category) {
      return i18n.exists(`notebook.categories.${note.category}`)
        ? t(`notebook.categories.${note.category}`)
        : note.category;
    }
    return t('notebook.categories.uncategorized');
  };

  useEffect(() => {
    loadGroups();
    loadNotes();
    loadAllCategories();
  }, [loadGroups, loadNotes, loadAllCategories]);

  // 订阅后端写操作后广播的 notes-changed 事件：AI 在进程内直接创建/修改/删除/重归类笔记后，
  // 列表与分组计数能即时刷新，而不必手动刷新窗口（P1-5 前端消费端）。
  // 始终以当前视图的过滤条件（分组/分类/搜索）为准重拉，避免状态错乱或把所有笔记混进来。
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen<unknown>('notes-changed', () => {
      const st = useNotebookStore.getState();
      const q = st.searchQuery || undefined;
      st.loadGroups()
        .then(() => {
          const cur = useNotebookStore.getState();
          // 兜底：若当前选中的分组已被（AI）删除，重置为"全部"，并拉全部笔记
          if (cur.activeGroupId && !cur.groups.some((g) => g.id === cur.activeGroupId)) {
            cur.setActiveGroupId('');
            cur.loadNotes(undefined, undefined, q).catch(() => {});
          } else {
            cur.loadNotes(cur.activeGroupId || undefined, cur.activeCategory || undefined, q).catch(() => {});
          }
        })
        .catch(() => {});
    }).then((fn) => { unlisten = fn; });
    return () => { if (unlisten) unlisten(); };
  }, []);

  const handleSearch = useCallback((value: string) => {
    setSearchQuery(value);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    if (value.trim()) {
      searchTimerRef.current = setTimeout(() => {
        searchNotes(value);
      }, 300);
    } else {
      loadNotes(activeGroupId || undefined, activeCategory || undefined);
    }
  }, [activeGroupId, activeCategory, loadNotes, setSearchQuery, searchNotes]);

  const handleGroupClick = useCallback((groupId: string) => {
    const newGroupId = activeGroupId === groupId ? '' : groupId;
    setActiveGroupId(newGroupId);
    setActiveCategory('');
    setActiveTag('');
    if (newGroupId) {
      loadCategoriesByGroup(newGroupId);
      loadTagsByGroup(newGroupId);
    } else {
      loadAllCategories();
    }
    loadNotes(newGroupId || undefined, undefined, searchQuery || undefined);
  }, [activeGroupId, searchQuery, loadNotes, setActiveGroupId, setActiveCategory, setActiveTag, loadCategoriesByGroup, loadAllCategories, loadTagsByGroup]);

  const handleCategoryClick = useCallback((categoryName: string) => {
    const newCategory = activeCategory === categoryName ? '' : categoryName;
    setActiveCategory(newCategory);
    loadNotes(activeGroupId || undefined, newCategory || undefined, searchQuery || undefined);
  }, [activeCategory, activeGroupId, searchQuery, loadNotes, setActiveCategory]);

  const handleTagClick = useCallback((tagName: string) => {
    const newTag = activeTag === tagName ? '' : tagName;
    setActiveTag(newTag);
  }, [activeTag, setActiveTag]);

  const handleGroupMenuOpen = (e: React.MouseEvent<HTMLElement>, groupId: string) => {
    e.stopPropagation();
    setGroupMenuAnchor(e.currentTarget);
    setMenuGroupId(groupId);
  };

  const handleGroupMenuClose = () => {
    setGroupMenuAnchor(null);
    setMenuGroupId(null);
  };

  const handleDeleteNote = useCallback((noteId: string) => {
    deleteNote(noteId);
  }, [deleteNote]);

  const handleTogglePin = useCallback((noteId: string) => {
    togglePin(noteId);
  }, [togglePin]);

  // 防御性过滤：当前处于某分组视图时，绝不混入其他分组的笔记，避免状态错乱导致列表归属错误（F4�?
  const visibleNotes = notes
    .filter((n) => !activeGroupId || n.groupId === activeGroupId)
    .filter((n) => !activeTag || (n.tags || []).includes(activeTag));
  const pinnedNotes = visibleNotes.filter((n) => n.isPinned);
  const unpinnedNotes = visibleNotes.filter((n) => !n.isPinned);
  const allCount = notes.length;

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
              sx: {
                fontSize: 12,
                fontWeight: isActive ? 600 : 400,
                color: isActive ? group.color : 'text.primary',
              },
            },
          }}
        />
        <Typography variant="caption" color="text.secondary" sx={{ mr: 0.5, fontSize: 10 }}>
          {group.noteCount}
        </Typography>
        <IconButton
          size="small"
          onClick={(e) => handleGroupMenuOpen(e, group.id)}
          sx={{ opacity: 0, transition: 'opacity 0.2s', '.MuiListItemButton-root:hover &': { opacity: 1 } }}
        >
          <DotsThreeVerticalIcon size={12} color="#8B949E" />
        </IconButton>
      </ListItemButton>
    );
  };

  return (
    <Box sx={{ height: '100%', display: 'flex' }}>
      <Box
        sx={{
          width: 180,
          minWidth: 180,
          borderRight: '1px solid',
          borderColor: 'divider',
          display: 'flex',
          flexDirection: 'column',
          bgcolor: 'rgba(0,0,0,0.02)',
        }}
      >
        <Box sx={{ p: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, fontSize: 10 }}>
            {t('group.title')}
          </Typography>
          <Tooltip title={t('group.manage') || ''}>
            <IconButton size="small" onClick={() => setGroupManageOpen(true)}>
              <FolderSimplePlusIcon size={14} color="#6C63FF" />
            </IconButton>
          </Tooltip>
        </Box>

        <List dense sx={{ flex: 1, overflow: 'auto', px: 0.5 }}>
          <ListItemButton
            onClick={() => handleGroupClick('')}
            selected={activeGroupId === ''}
            sx={{
              borderRadius: 1.5,
              mb: 0.25,
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
            <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10 }}>
              {allCount}
            </Typography>
          </ListItemButton>

          <Divider sx={{ my: 0.5, mx: 1 }} />

          {groups.map(renderGroupItem)}
        </List>

        <Divider sx={{ mx: 1 }} />

        {categories.length > 0 && (
          <>
            <Box sx={{ px: 1, pt: 1, pb: 0.5 }}>
              <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, fontSize: 10 }}>
                {t('notebook.note_category')}
              </Typography>
            </Box>
            <List dense sx={{ overflow: 'auto', px: 0.5, pb: 1 }}>
              {categories.map((cat) => (
                <ListItemButton
                  key={cat.id}
                  onClick={() => handleCategoryClick(cat.name)}
                  selected={activeCategory === cat.name}
                  sx={{
                    borderRadius: 1.5,
                    mb: 0.25,
                    '&.Mui-selected': { bgcolor: 'rgba(108,99,255,0.12)' },
                  }}
                >
                  <ListItemText
                    primary={cat.name}
                    slotProps={{ primary: { sx: { fontSize: 11, fontWeight: activeCategory === cat.name ? 600 : 400 } } }}
                  />
                </ListItemButton>
              ))}
            </List>
          </>
        )}

        {activeGroupId && tags.length > 0 && (
          <>
            <Box sx={{ px: 1, pt: 1, pb: 0.5 }}>
              <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, fontSize: 10 }}>
                {t('tag.title')}
              </Typography>
            </Box>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, px: 0.5, pb: 1 }}>
              {tags.map((tag) => (
                <Chip
                  key={tag.id}
                  label={tag.name}
                  size="small"
                  clickable
                  onClick={() => handleTagClick(tag.name)}
                  color={activeTag === tag.name ? 'primary' : 'default'}
                  variant={activeTag === tag.name ? 'filled' : 'outlined'}
                  sx={{ borderRadius: 1.5, fontSize: 11, '& .MuiChip-label': { px: 0.75 } }}
                />
              ))}
            </Box>
          </>
        )}
      </Box>

      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <NoteSearchBar value={searchQuery} onChange={handleSearch} placeholder={t('notebook.search_notes') || ''} />

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
                    selected={selectedNote?.note.id === note.id}
                    onClick={onSelectNote}
                    onTogglePin={handleTogglePin}
                    onDelete={handleDeleteNote}
                    groupHint={categoryLabel(note)}
                  />
                ))}
                <Divider sx={{ my: 0.5 }} />
              </>
            )}
            {unpinnedNotes.map((note) => (
              <NoteListItem
                key={note.id}
                note={note}
                selected={selectedNote?.note.id === note.id}
                onClick={onSelectNote}
                onTogglePin={handleTogglePin}
                onDelete={handleDeleteNote}
                groupHint={categoryLabel(note)}
              />
            ))}
            {notes.length === 0 && (
              <Box sx={{ p: 3, textAlign: 'center' }}>
                <FolderOpenIcon size={32} color="#8B949E" style={{ opacity: 0.5 }} />
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                  {t('notebook.no_notes')}
                </Typography>
                {onNewNote && (
                  <IconButton size="small" onClick={onNewNote} sx={{ mt: 1 }}>
                    <PlusIcon size={20} color="#6C63FF" />
                  </IconButton>
                )}
              </Box>
            )}
          </List>
        </Box>
      </Box>

      <Menu anchorEl={groupMenuAnchor} open={Boolean(groupMenuAnchor)} onClose={handleGroupMenuClose}>
        <MenuItem onClick={() => { setGroupManageOpen(true); handleGroupMenuClose(); }}>
          <PencilSimpleIcon size={14} color="#6C63FF" style={{ marginRight: 8 }} />
          {t('group.edit')}
        </MenuItem>
        {menuGroupId !== 'uncategorized' && (
          <MenuItem onClick={() => {
            const g = groups.find((x) => x.id === menuGroupId);
            if (g) { setGroupToDelete(g); setGroupDeleteOpen(true); }
            handleGroupMenuClose();
          }}>
            <TrashIcon size={14} color="#FF5252" style={{ marginRight: 8 }} />
            {t('group.delete')}
          </MenuItem>
        )}
      </Menu>

      <DeleteGroupDialog
        open={groupDeleteOpen}
        group={groupToDelete}
        onClose={() => { setGroupDeleteOpen(false); setGroupToDelete(null); }}
        onConfirm={async (targetGroupId, deleteNotes) => {
          if (!groupToDelete) return;
          setGroupDeleteOpen(false);
          await deleteGroup(groupToDelete.id, targetGroupId, deleteNotes);
          setGroupToDelete(null);
        }}
      />

      <GroupManageDialog open={groupManageOpen} onClose={() => setGroupManageOpen(false)} />
    </Box>
  );
}
