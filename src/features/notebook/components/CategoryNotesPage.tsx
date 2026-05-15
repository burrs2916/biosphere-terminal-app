import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Box, List, ListItemButton, ListItemText, ListItemIcon, IconButton,
  Typography, TextField, InputAdornment, Divider, Menu, MenuItem,
  Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions, Button,
} from '@mui/material';
import {
  MagnifyingGlassIcon, PushPinIcon, TrashIcon, DotsThreeVerticalIcon,
  CodeIcon, NoteIcon, PlusIcon, TagIcon,
} from '@phosphor-icons/react';
import { useNotebookStore } from '../store/notebookStore';
import { NoteEditor } from './NoteEditor';
import { IconRenderer } from './IconRenderer';
import { getNote } from '../../../core/services/notebook.service';
import type { NoteDto } from '../../../proto/notebook';

export function CategoryNotesPage() {
  const { t } = useTranslation('notebook');
  const { t: tCommon } = useTranslation('common');

  const params = new URLSearchParams(window.location.search);
  const groupId = params.get('groupId') || '';
  const categoryName = params.get('category') || '';
  const noteIdParam = params.get('noteId') || '';

  const {
    notes, groups, loadNotes, loadGroups, deleteNote, togglePin,
    loadCategoriesByGroup,
  } = useNotebookStore();

  const [selectedNote, setSelectedNote] = useState<NoteDto | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [menuNoteId, setMenuNoteId] = useState<string | null>(null);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [initialNoteLoaded, setInitialNoteLoaded] = useState(false);

  useEffect(() => {
    loadGroups();
    if (groupId) {
      loadCategoriesByGroup(groupId);
      loadNotes(groupId, categoryName || undefined);
    } else {
      loadNotes();
    }
  }, [groupId, categoryName, loadNotes, loadGroups, loadCategoriesByGroup]);

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

  const filteredNotes = searchQuery.trim()
    ? notes.filter((n) =>
        n.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        n.category.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : notes;

  const pinnedNotes = filteredNotes.filter((n) => n.isPinned);
  const unpinnedNotes = filteredNotes.filter((n) => !n.isPinned);

  const handleSaved = useCallback(() => {
    if (groupId) {
      loadNotes(groupId, categoryName || undefined);
      loadCategoriesByGroup(groupId);
    } else {
      loadNotes();
    }
  }, [groupId, categoryName, loadNotes, loadCategoriesByGroup]);

  const handleNewNote = () => {
    setSelectedNote(null);
  };

  const handleMenuOpen = (e: React.MouseEvent<HTMLElement>, noteId: string) => {
    e.stopPropagation();
    setAnchorEl(e.currentTarget);
    setMenuNoteId(noteId);
  };

  const handleMenuClose = () => {
    setAnchorEl(null);
    setMenuNoteId(null);
  };

  const handleDelete = () => {
    if (menuNoteId) {
      setDeleteTargetId(menuNoteId);
      setDeleteConfirmOpen(true);
    }
    handleMenuClose();
  };

  const handleConfirmDelete = () => {
    if (deleteTargetId) {
      deleteNote(deleteTargetId);
      if (selectedNote?.id === deleteTargetId) setSelectedNote(null);
    }
    setDeleteConfirmOpen(false);
    setDeleteTargetId(null);
  };

  const handleTogglePin = () => {
    if (menuNoteId) togglePin(menuNoteId);
    handleMenuClose();
  };

  const renderNoteItem = (note: NoteDto) => {
    const isSelected = selectedNote?.id === note.id;
    const isCommand = note.category === 'command';
    const timeStr = note.updatedAt
      ? new Date(note.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
      : '';
    return (
      <ListItemButton
        key={note.id}
        onClick={() => setSelectedNote(note)}
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
        <IconButton size="small" onClick={(e) => handleMenuOpen(e, note.id)}>
          <DotsThreeVerticalIcon size={14} color="#8B949E" />
        </IconButton>
      </ListItemButton>
    );
  };

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
        <TagIcon size={16} color="#6C63FF" />
        <Typography variant="subtitle1" sx={{ fontWeight: 600, flex: 1 }}>
          {pageTitle}
        </Typography>
        <IconButton size="small" onClick={handleNewNote} sx={{ color: '#6C63FF' }}>
          <PlusIcon size={18} />
        </IconButton>
      </Box>

      <Box sx={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <Box sx={{ width: 280, minWidth: 280, borderRight: '1px solid', borderColor: 'divider', display: 'flex', flexDirection: 'column' }}>
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
              {filteredNotes.length === 0 && !noteIdParam && (
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

        <Box sx={{ flex: 1, overflow: 'hidden' }}>
          <NoteEditor
            note={selectedNote}
            onClose={() => setSelectedNote(null)}
            onSaved={handleSaved}
            defaultGroupId={groupId}
            defaultCategory={categoryName}
          />
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
