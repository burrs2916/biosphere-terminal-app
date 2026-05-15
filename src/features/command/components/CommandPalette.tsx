import { useState, useEffect, useCallback } from 'react';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import ListItemIcon from '@mui/material/ListItemIcon';
import Chip from '@mui/material/Chip';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import InputAdornment from '@mui/material/InputAdornment';
import { useTranslation } from 'react-i18next';
import {
  MagnifyingGlassIcon,
  ClockCounterClockwiseIcon,
  CodeBlockIcon,
  WarningIcon,
  ShieldWarningIcon,
} from '@phosphor-icons/react';
import {
  searchCommandHistory,
  listSnippets,
  parseCommand,
} from '../../../core/services/command.service';
import type { CommandHistoryEntry, CommandSnippet, ParsedCommandResult } from '../../../proto';

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  onExecute: (command: string) => void;
}

type SearchItem =
  | { type: 'history'; data: CommandHistoryEntry }
  | { type: 'snippet'; data: CommandSnippet };

export function CommandPalette({ open, onClose, onExecute }: CommandPaletteProps) {
  const { t } = useTranslation('command');
  const [query, setQuery] = useState('');
  const [history, setHistory] = useState<CommandHistoryEntry[]>([]);
  const [snippets, setSnippets] = useState<CommandSnippet[]>([]);
  const [parsed, setParsed] = useState<ParsedCommandResult | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [dangerConfirm, setDangerConfirm] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      listSnippets().then(setSnippets).catch(() => {});
      setQuery('');
      setParsed(null);
      setSelectedIndex(0);
      setDangerConfirm(null);
    }
  }, [open]);

  useEffect(() => {
    if (!query.trim()) {
      setHistory([]);
      setParsed(null);
      return;
    }
    const timer = setTimeout(() => {
      searchCommandHistory(query).then(setHistory).catch(() => {});
      parseCommand(query).then(setParsed).catch(() => setParsed(null));
    }, 200);
    return () => clearTimeout(timer);
  }, [query]);

  const items: SearchItem[] = [
    ...snippets
      .filter(
        (s) =>
          !query.trim() ||
          s.name.toLowerCase().includes(query.toLowerCase()) ||
          s.command.toLowerCase().includes(query.toLowerCase()),
      )
      .map((s) => ({ type: 'snippet' as const, data: s })),
    ...history.map((h) => ({ type: 'history' as const, data: h })),
  ];

  const doExecute = useCallback(
    (command: string) => {
      onExecute(command);
      setQuery('');
      onClose();
    },
    [onExecute, onClose],
  );

  const handleExecute = useCallback(
    (command: string) => {
      if (parsed?.isDangerous) {
        setDangerConfirm(command);
        return;
      }
      doExecute(command);
    },
    [parsed, doExecute],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => Math.min(prev + 1, items.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (items.length > 0 && selectedIndex < items.length) {
          const item = items[selectedIndex];
          if (item.type === 'history') handleExecute(item.data.command);
          else if (item.type === 'snippet') handleExecute(item.data.command);
        } else if (query.trim()) {
          handleExecute(query.trim());
        }
      } else if (e.key === 'Escape') {
        onClose();
      }
    },
    [items, selectedIndex, query, handleExecute, onClose],
  );

  return (
    <>
      <Dialog
        open={open}
        onClose={onClose}
        maxWidth="sm"
        fullWidth
        sx={{
          '& .MuiDialog-paper': {
            position: 'fixed',
            top: '15%',
            m: 0,
            borderRadius: 3,
            overflow: 'hidden',
            boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)',
          },
        }}
      >
        <DialogContent sx={{ p: 0 }}>
          <Box sx={{ p: 2, borderBottom: '1px solid', borderColor: 'divider' }}>
            <TextField
              autoFocus
              fullWidth
              placeholder={t('palette.placeholder')}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setSelectedIndex(0);
              }}
              onKeyDown={handleKeyDown}
              variant="standard"
              slotProps={{
                input: {
                  startAdornment: (
                    <InputAdornment position="start">
                      <MagnifyingGlassIcon size={20} color="#6C63FF" />
                    </InputAdornment>
                  ),
                },
              }}
              sx={{
                '& .MuiInput-root': { fontSize: '1.1rem' },
              }}
            />
          </Box>

          {parsed && query.trim() && (
            <Box
              sx={{
                px: 2,
                py: 1,
                display: 'flex',
                gap: 1,
                alignItems: 'center',
                borderBottom: '1px solid',
                borderColor: 'divider',
                bgcolor: parsed.isDangerous
                  ? 'rgba(255,107,107,0.08)'
                  : 'rgba(108,99,255,0.05)',
              }}
            >
              {parsed.isDangerous && (
                <Chip
                  icon={<WarningIcon size={14} weight="fill" />}
                  label={t('tags.dangerous')}
                  size="small"
                  color="warning"
                  variant="outlined"
                />
              )}
              <Chip label={parsed.program} size="small" color="primary" variant="outlined" />
              {parsed.hasPipe && (
                <Chip label={t('tags.pipe')} size="small" variant="outlined" />
              )}
              {parsed.hasRedirect && (
                <Chip label={t('tags.redirect')} size="small" variant="outlined" />
              )}
              {parsed.isBackground && (
                <Chip label={t('tags.background')} size="small" variant="outlined" />
              )}
            </Box>
          )}

          {items.length > 0 && (
            <List dense sx={{ maxHeight: 300, overflow: 'auto', py: 0 }}>
              {items.map((item, index) => (
                <ListItemButton
                  key={
                    item.type === 'history'
                      ? `h-${item.data.id}`
                      : `s-${item.data.id}`
                  }
                  selected={index === selectedIndex}
                  onClick={() => {
                    if (item.type === 'history') handleExecute(item.data.command);
                    else if (item.type === 'snippet') handleExecute(item.data.command);
                  }}
                  sx={{
                    '&.Mui-selected': {
                      bgcolor: 'rgba(108,99,255,0.1)',
                    },
                  }}
                >
                  <ListItemIcon sx={{ minWidth: 36 }}>
                    {item.type === 'history' ? (
                      <ClockCounterClockwiseIcon size={18} color="#8B949E" />
                    ) : (
                      <CodeBlockIcon size={18} color="#6C63FF" />
                    )}
                  </ListItemIcon>
                  <ListItemText
                    primary={
                      item.type === 'history' ? item.data.command : item.data.name
                    }
                    secondary={
                      item.type === 'history'
                        ? item.data.cwd
                        : item.data.command
                    }
                    slotProps={{
                      primary: { variant: 'body2', sx: { fontFamily: 'monospace' } },
                      secondary: { variant: 'caption' },
                    }}
                  />
                  {item.type === 'snippet' && item.data.tags.length > 0 && (
                    <Box sx={{ display: 'flex', gap: 0.5, ml: 1 }}>
                      {item.data.tags.slice(0, 2).map((tag) => (
                        <Chip key={tag} label={tag} size="small" variant="outlined" />
                      ))}
                    </Box>
                  )}
                </ListItemButton>
              ))}
            </List>
          )}

          {items.length === 0 && query.trim() && (
            <Box sx={{ p: 3, textAlign: 'center' }}>
              <Typography variant="body2" color="text.secondary">
                {t('palette.press_enter_execute')}: <code>{query}</code>
              </Typography>
            </Box>
          )}

          {items.length === 0 && !query.trim() && (
            <Box sx={{ p: 3, textAlign: 'center' }}>
              <Typography variant="body2" color="text.secondary">
                {t('palette.search_commands_snippets')}
              </Typography>
            </Box>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={dangerConfirm !== null}
        onClose={() => setDangerConfirm(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <ShieldWarningIcon size={24} color="#FF7B72" weight="fill" />
          {t('danger_dialog.title')}
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ mb: 1 }}>
            {t('danger_dialog.warning')}
          </Typography>
          <Box
            sx={{
              p: 1.5,
              borderRadius: 1,
              bgcolor: 'rgba(255,107,107,0.1)',
              border: '1px solid rgba(255,107,107,0.3)',
              fontFamily: 'monospace',
              fontSize: '0.85rem',
              wordBreak: 'break-all',
            }}
          >
            {dangerConfirm}
          </Box>
          <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
            {t('danger_dialog.confirm')}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDangerConfirm(null)}>{t('palette.cancel')}</Button>
          <Button
            onClick={() => {
              if (dangerConfirm) {
                doExecute(dangerConfirm);
                setDangerConfirm(null);
              }
            }}
            color="error"
            variant="contained"
          >
            {t('danger_dialog.execute_anyway')}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
