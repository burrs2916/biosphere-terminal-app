import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Box, List, IconButton, Typography, Divider,
} from '@mui/material';
import {
  PlusIcon, TagIcon,
} from '@phosphor-icons/react';
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

  const params = new URLSearchParams(window.location.search);
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

  const pinnedNotes = notes.filter((n) => n.isPinned);
  const unpinnedNotes = notes.filter((n) => !n.isPinned);

  const handleSaved = useCallback(() => {
    if (groupId) {
      loadNotes(groupId, categoryName || undefined);
      loadCategoriesByGroup(groupId);
    } else {
      loadNotes();
    }
  }, [groupId, categoryName, loadNotes, loadCategoriesByGroup]);

  const handleDeleteNote = useCallback((noteId: string) => {
    deleteNote(noteId);
    if (selectedNote?.id === noteId) setSelectedNote(null);
  }, [deleteNote, selectedNote]);

  const handleTogglePin = useCallback((noteId: string) => {
    togglePin(noteId);
  }, [togglePin]);

  const handleSearch = useCallback((value: string) => {
    setSearchQuery(value);
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
