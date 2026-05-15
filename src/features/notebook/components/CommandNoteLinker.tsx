import { useState } from 'react';
import {
  Box, IconButton, Typography, Dialog, DialogTitle, DialogContent,
  DialogActions, Button, TextField, List, ListItemButton, ListItemText,
  Chip,
} from '@mui/material';
import { LinkIcon, NotebookIcon } from '@phosphor-icons/react';
import { useNotebookStore } from '../../notebook/store/notebookStore';
import { useTranslation } from 'react-i18next';

interface CommandNoteLinkerProps {
  commandId: string;
  commandText?: string;
}

export function CommandNoteLinker({ commandId, commandText }: CommandNoteLinkerProps) {
  const { notes, linkedNotes, loadNotes, loadLinkedNotes, linkCommand } = useNotebookStore();
  const { t } = useTranslation('notebook');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [context, setContext] = useState('');
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);

  const handleOpen = () => {
    loadNotes();
    loadLinkedNotes(commandId);
    setDialogOpen(true);
    setContext(commandText || '');
  };

  const handleLink = async () => {
    if (selectedNoteId) {
      await linkCommand(selectedNoteId, commandId, context);
      loadLinkedNotes(commandId);
      setSelectedNoteId(null);
    }
  };

  return (
    <>
      <IconButton size="small" onClick={handleOpen} title="Link to note">
        <LinkIcon size={14} color="#6C63FF" />
      </IconButton>

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <NotebookIcon size={20} color="#81C784" />
          {t('linked_commands')}
        </DialogTitle>
        <DialogContent>
          {linkedNotes.length > 0 && (
            <Box sx={{ mb: 2 }}>
              <Typography variant="caption" color="text.secondary">
                Already linked to:
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
                {linkedNotes.map((link) => (
                  <Chip key={link.id} label={link.noteId} size="small" variant="outlined" />
                ))}
              </Box>
            </Box>
          )}

          <TextField
            fullWidth
            size="small"
            label="Context"
            value={context}
            onChange={(e) => setContext(e.target.value)}
            multiline
            maxRows={3}
            sx={{ mb: 2, '& .MuiOutlinedInput-root': { borderRadius: 2 } }}
          />

          <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>
            Select a note to link:
          </Typography>
          <List dense sx={{ maxHeight: 200, overflow: 'auto', border: '1px solid rgba(48,54,61,0.6)', borderRadius: 2 }}>
            {notes.map((note) => (
              <ListItemButton
                key={note.id}
                selected={selectedNoteId === note.id}
                onClick={() => setSelectedNoteId(note.id)}
              >
                <ListItemText
                  primary={note.title || 'Untitled'}
                  secondary={note.category}
                  slotProps={{ primary: { sx: { fontSize: 13 } }, secondary: { sx: { fontSize: 11 } } }}
                />
              </ListItemButton>
            ))}
            {notes.length === 0 && (
              <Box sx={{ p: 2, textAlign: 'center' }}>
                <Typography variant="body2" color="text.secondary">
                  {t('no_notes')}
                </Typography>
              </Box>
            )}
          </List>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>{t('close', { ns: 'common' })}</Button>
          <Button
            variant="contained"
            onClick={handleLink}
            disabled={!selectedNoteId}
            sx={{ background: 'linear-gradient(135deg, #6C63FF 0%, #8B83FF 100%)' }}
          >
            Link
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
