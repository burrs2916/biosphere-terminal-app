import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Box, List, ListItemButton, ListItemText, ListItemIcon, TextField,
  IconButton, Typography, Menu, MenuItem, InputAdornment, Tooltip, Divider, Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions, Button,
} from '@mui/material';
import {
  MagnifyingGlassIcon, PushPinIcon, TrashIcon, FolderOpenIcon, DotsThreeVerticalIcon, CodeIcon, PlusIcon,
  FolderSimplePlusIcon, PencilSimpleIcon, NoteIcon, BooksIcon,
} from '@phosphor-icons/react';
import { IconRenderer } from './IconRenderer';
import { useNotebookStore } from '../store/notebookStore';
import type { NoteDto, NoteGroupDto } from '../../../proto/notebook';
import { GroupManageDialog } from './GroupManageDialog';

interface NoteListProps {
  onSelectNote: (note: NoteDto) => void;
  onNewNote?: () => void;
}

export function NoteList({ onSelectNote, onNewNote }: NoteListProps) {
  const { t } = useTranslation('notebook');
  const { t: tCommon } = useTranslation('common');

  const {
    notes, groups, activeGroupId, searchQuery, selectedNote,
    loadNotes, loadGroups, deleteNote, togglePin,
    setSearchQuery, setActiveGroupId, activeCategory, setActiveCategory, categories, loadCategoriesByGroup,
  } = useNotebookStore();

  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [menuNoteId, setMenuNoteId] = useState<string | null>(null);
  const [groupManageOpen, setGroupManageOpen] = useState(false);
  const [groupMenuAnchor, setGroupMenuAnchor] = useState<null | HTMLElement>(null);
  const [menuGroupId, setMenuGroupId] = useState<string | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  useEffect(() => {
    loadGroups();
    loadNotes();
  }, [loadGroups, loadNotes]);

  const handleSearch = useCallback((value: string) => {
    setSearchQuery(value);
    if (value.trim()) {
      loadNotes(activeGroupId || undefined, activeCategory || undefined, value);
    } else {
      loadNotes(activeGroupId || undefined, activeCategory || undefined);
    }
  }, [activeGroupId, activeCategory, loadNotes, setSearchQuery]);

  const handleGroupClick = useCallback((groupId: string) => {
    const newGroupId = activeGroupId === groupId ? '' : groupId;
    setActiveGroupId(newGroupId);
    setActiveCategory('');
    if (newGroupId) {
      loadCategoriesByGroup(newGroupId);
    }
    loadNotes(newGroupId || undefined, undefined, searchQuery || undefined);
  }, [activeGroupId, searchQuery, loadNotes, setActiveGroupId, setActiveCategory, loadCategoriesByGroup]);

  const handleCategoryClick = useCallback((categoryName: string) => {
    const newCategory = activeCategory === categoryName ? '' : categoryName;
    setActiveCategory(newCategory);
    loadNotes(activeGroupId || undefined, newCategory || undefined, searchQuery || undefined);
  }, [activeCategory, activeGroupId, searchQuery, loadNotes, setActiveCategory]);

  const handleMenuOpen = (e: React.MouseEvent<HTMLElement>, noteId: string) => {
    e.stopPropagation();
    setAnchorEl(e.currentTarget);
    setMenuNoteId(noteId);
  };

  const handleMenuClose = () => {
    setAnchorEl(null);
    setMenuNoteId(null);
  };

  const handleGroupMenuOpen = (e: React.MouseEvent<HTMLElement>, groupId: string) => {
    e.stopPropagation();
    setGroupMenuAnchor(e.currentTarget);
    setMenuGroupId(groupId);
  };

  const handleGroupMenuClose = () => {
    setGroupMenuAnchor(null);
    setMenuGroupId(null);
  };

  const handleDelete = () => {
    if (menuNoteId) {
      setDeleteConfirmOpen(true);
    }
    handleMenuClose();
  };

  const handleConfirmDelete = () => {
    if (menuNoteId) deleteNote(menuNoteId);
    setDeleteConfirmOpen(false);
    setMenuNoteId(null);
  };

  const handleTogglePin = () => {
    if (menuNoteId) togglePin(menuNoteId);
    handleMenuClose();
  };

  const pinnedNotes = notes.filter((n) => n.isPinned);
  const unpinnedNotes = notes.filter((n) => !n.isPinned);
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

  const renderNoteItem = (note: NoteDto) => {
    const isSelected = selectedNote?.note.id === note.id;
    const isSnippet = note.category === 'snippet';
    const isCommand = note.category === 'command';
    const group = note.groupId ? groups.find((g) => g.id === note.groupId) : null;
    const secondaryText = group ? group.name : (note.groupId ? t('group.uncategorized') : t(`notebook.categories.${note.category}`));
    const timeStr = note.updatedAt
      ? new Date(note.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
      : '';
    return (
      <ListItemButton
        key={note.id}
        onClick={() => onSelectNote(note)}
        selected={isSelected}
        sx={{
          borderRadius: 1.5,
          mx: 0.5,
          mb: 0.25,
          '&.Mui-selected': {
            bgcolor: 'rgba(108,99,255,0.12)',
            '&:hover': { bgcolor: 'rgba(108,99,255,0.18)' },
          },
        }}
      >
        <ListItemIcon sx={{ minWidth: 28 }}>
          {note.isPinned ? (
            <PushPinIcon size={14} weight="fill" color="#FFD740" />
          ) : isCommand ? (
            <CodeIcon size={14} color="#81C784" />
          ) : isSnippet ? (
            <CodeIcon size={14} color="#4FC3F7" />
          ) : (
            <NoteIcon size={14} color="#81C784" />
          )}
        </ListItemIcon>
        <ListItemText
          primary={note.title || t('notebook.note_title')}
          secondary={
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Typography component="span" variant="caption" color="text.secondary" sx={{ fontSize: 10 }}>
                {secondaryText}
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
        <IconButton size="small" onClick={(e) => handleMenuOpen(e, note.id)}>
          <DotsThreeVerticalIcon size={14} color="#8B949E" />
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

        {activeGroupId && categories.length > 0 && (
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
      </Box>

      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <Box sx={{ p: 1.5 }}>
          <TextField
            fullWidth
            size="small"
            placeholder={t('notebook.search_notes') || ''}
            value={searchQuery}
            onChange={(e) => handleSearch(e.target.value)}
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

        <Box sx={{ flex: 1, overflow: 'auto' }}>
          <List dense>
            {pinnedNotes.length > 0 && (
              <>
                <Typography variant="caption" color="text.secondary" sx={{ px: 2, py: 0.5, fontWeight: 600, fontSize: 10 }}>
                  {tCommon('action.pin').toUpperCase()}
                </Typography>
                {pinnedNotes.map(renderNoteItem)}
                <Divider sx={{ my: 0.5 }} />
              </>
            )}
            {unpinnedNotes.map(renderNoteItem)}
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

      <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={handleMenuClose}>
        <MenuItem onClick={handleTogglePin}>
          <PushPinIcon size={14} color="#FFD740" style={{ marginRight: 8 }} />
          {tCommon('action.pin')}
        </MenuItem>
        <MenuItem onClick={handleDelete}>
          <TrashIcon size={14} color="#FF5252" style={{ marginRight: 8 }} />
          {tCommon('action.delete')}
        </MenuItem>
      </Menu>

      <Menu anchorEl={groupMenuAnchor} open={Boolean(groupMenuAnchor)} onClose={handleGroupMenuClose}>
        <MenuItem onClick={() => { setGroupManageOpen(true); handleGroupMenuClose(); }}>
          <PencilSimpleIcon size={14} color="#6C63FF" style={{ marginRight: 8 }} />
          {t('group.edit')}
        </MenuItem>
        <MenuItem onClick={() => { if (menuGroupId) useNotebookStore.getState().deleteGroup(menuGroupId); handleGroupMenuClose(); }}>
          <TrashIcon size={14} color="#FF5252" style={{ marginRight: 8 }} />
          {t('group.delete')}
        </MenuItem>
      </Menu>

      <GroupManageDialog open={groupManageOpen} onClose={() => setGroupManageOpen(false)} />

      <Dialog open={deleteConfirmOpen} onClose={() => setDeleteConfirmOpen(false)}>
        <DialogTitle>{t('notebook.delete_note')}</DialogTitle>
        <DialogContent>
          <DialogContentText>{t('notebook.delete_confirm_desc')}</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteConfirmOpen(false)}>{tCommon('action.cancel')}</Button>
          <Button onClick={handleConfirmDelete} color="error" variant="contained">{tCommon('action.delete')}</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
