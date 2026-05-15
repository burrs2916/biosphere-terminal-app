import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import ListItemIcon from '@mui/material/ListItemIcon';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import {
  CodeBlockIcon,
  PlusIcon,
  TrashIcon,
  PencilSimpleIcon,
  PlayIcon,
} from '@phosphor-icons/react';
import { listSnippets, saveSnippet, deleteSnippet } from '../../../core/services/command.service';
import type { CommandSnippet } from '../../../proto';
import { generateId } from '../../../core/utils';

interface SnippetListProps {
  onExecute: (command: string) => void;
}

export function SnippetList({ onExecute }: SnippetListProps) {
  const { t } = useTranslation('terminal');
  const { t: tCommon } = useTranslation('common');

  const [snippets, setSnippets] = useState<CommandSnippet[]>([]);
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<CommandSnippet | null>(null);
  const [form, setForm] = useState({ name: '', command: '', description: '', tags: '' });

  const load = () => {
    listSnippets().then(setSnippets).catch(() => {});
  };

  useEffect(() => { load(); }, []);

  const handleSave = async () => {
    const snippet: CommandSnippet = {
      id: editing?.id ?? generateId(),
      name: form.name,
      command: form.command,
      description: form.description,
      tags: form.tags.split(',').map((t) => t.trim()).filter(Boolean),
      created_at: editing?.created_at ?? Date.now(),
    };
    await saveSnippet(snippet);
    setEditOpen(false);
    setEditing(null);
    setForm({ name: '', command: '', description: '', tags: '' });
    load();
  };

  const handleDelete = async (id: string) => {
    await deleteSnippet(id);
    load();
  };

  const openEdit = (snippet?: CommandSnippet) => {
    if (snippet) {
      setEditing(snippet);
      setForm({
        name: snippet.name,
        command: snippet.command,
        description: snippet.description,
        tags: snippet.tags.join(', '),
      });
    } else {
      setEditing(null);
      setForm({ name: '', command: '', description: '', tags: '' });
    }
    setEditOpen(true);
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 2, py: 1 }}>
        <Typography variant="caption" color="text.secondary">
          {t('snippets.count', { count: snippets.length })}
        </Typography>
        <Tooltip title={t('snippets.new_snippet') || ''} arrow>
          <IconButton size="small" onClick={() => openEdit()}>
            <PlusIcon size={16} color="#6C63FF" />
          </IconButton>
        </Tooltip>
      </Box>

      {snippets.length === 0 && (
        <Box sx={{ p: 3, textAlign: 'center' }}>
          <CodeBlockIcon size={32} color="#8B949E" />
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            {t('snippets.no_snippets')}
          </Typography>
        </Box>
      )}

      <List dense sx={{ maxHeight: 400, overflow: 'auto' }}>
        {snippets.map((snippet) => (
          <ListItemButton
            key={snippet.id}
            sx={{ borderRadius: 1, mx: 0.5 }}
          >
            <ListItemIcon sx={{ minWidth: 32 }}>
              <CodeBlockIcon size={16} color="#6C63FF" />
            </ListItemIcon>
            <ListItemText
              primary={snippet.name}
              secondary={snippet.command}
              slotProps={{
                primary: { variant: 'body2' },
                secondary: { variant: 'caption', noWrap: true, sx: { fontFamily: 'monospace' } },
              }}
            />
            {snippet.tags.length > 0 && (
              <Box sx={{ display: 'flex', gap: 0.5, ml: 0.5 }}>
                {snippet.tags.slice(0, 1).map((tag) => (
                  <Chip key={tag} label={tag} size="small" variant="outlined" sx={{ height: 18, fontSize: '0.6rem' }} />
                ))}
              </Box>
            )}
            <Tooltip title={t('snippets.execute') || ''} arrow>
              <IconButton size="small" onClick={() => onExecute(snippet.command)} sx={{ ml: 0.5 }}>
                <PlayIcon size={14} color="#00E676" />
              </IconButton>
            </Tooltip>
            <Tooltip title={t('snippets.edit_snippet') || ''} arrow>
              <IconButton size="small" onClick={() => openEdit(snippet)}>
                <PencilSimpleIcon size={14} />
              </IconButton>
            </Tooltip>
            <Tooltip title={t('snippets.delete') || ''} arrow>
              <IconButton size="small" onClick={() => handleDelete(snippet.id)}>
                <TrashIcon size={14} color="#FF7B72" />
              </IconButton>
            </Tooltip>
          </ListItemButton>
        ))}
      </List>

      <Dialog open={editOpen} onClose={() => setEditOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editing ? t('snippets.edit_snippet') : t('snippets.new_snippet')}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              label={t('snippets.name')}
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              fullWidth
              size="small"
            />
            <TextField
              label={t('snippets.command')}
              value={form.command}
              onChange={(e) => setForm((f) => ({ ...f, command: e.target.value }))}
              fullWidth
              size="small"
              multiline
              minRows={2}
              slotProps={{ input: { style: { fontFamily: 'monospace' } } }}
            />
            <TextField
              label={t('snippets.description')}
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              fullWidth
              size="small"
            />
            <TextField
              label={t('snippets.tags')}
              value={form.tags}
              onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))}
              fullWidth
              size="small"
              placeholder={t('snippets.tags_placeholder') || ''}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditOpen(false)}>{tCommon('action.cancel')}</Button>
          <Button onClick={handleSave} variant="contained" disabled={!form.name || !form.command}>
            {tCommon('action.save')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
