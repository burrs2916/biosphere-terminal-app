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
  WarningIcon,
  ShieldWarningIcon,
} from '@phosphor-icons/react';
import {
  searchCommandHistory,
  parseCommandOnly,
} from '../../../core/services/command.service';
import { useNotify } from '../../../core/notification';
import type { CommandHistoryEntry, ParsedCommandResult } from '../../../proto';
import { localizeBackendError } from '../../../core/backendError';

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  onExecute: (command: string) => void;
}

export function CommandPalette({ open, onClose, onExecute }: CommandPaletteProps) {
  const { t } = useTranslation('command');
  const [query, setQuery] = useState('');
  const [history, setHistory] = useState<CommandHistoryEntry[]>([]);
  const [parsed, setParsed] = useState<ParsedCommandResult | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [dangerConfirm, setDangerConfirm] = useState<string | null>(null);
  const notify = useNotify().notify;

  useEffect(() => {
    if (open) {
      setQuery('');
      setParsed(null);
      setSelectedIndex(0);
      setDangerConfirm(null);
      setHistory([]);
    }
  }, [open]);

  useEffect(() => {
    if (!query.trim()) {
      setHistory([]);
      setParsed(null);
      return;
    }
    const timer = setTimeout(() => {
      searchCommandHistory(query).then(setHistory).catch((e) => notify(localizeBackendError(e)));
      parseCommandOnly(query).then(setParsed).catch(() => setParsed(null));
    }, 200);
    return () => clearTimeout(timer);
  }, [query]);

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

  const handleHistoryClick = useCallback((command: string) => {
    setQuery(command);
    setSelectedIndex(0);
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => Math.min(prev + 1, history.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (history.length > 0 && selectedIndex < history.length) {
          handleExecute(history[selectedIndex].command);
        } else if (query.trim()) {
          handleExecute(query.trim());
        }
      } else if (e.key === 'Tab' && history.length > 0 && selectedIndex < history.length) {
        e.preventDefault();
        setQuery(history[selectedIndex].command);
        setSelectedIndex(0);
      } else if (e.key === 'Escape') {
        onClose();
      }
    },
    [history, selectedIndex, query, handleExecute, onClose],
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

          {history.length > 0 && (
            <List dense sx={{ maxHeight: 300, overflow: 'auto', py: 0 }}>
              {history.map((entry, index) => (
                <ListItemButton
                  key={entry.id}
                  selected={index === selectedIndex}
                  onClick={() => handleHistoryClick(entry.command)}
                  sx={{
                    '&.Mui-selected': {
                      bgcolor: 'rgba(108,99,255,0.1)',
                    },
                  }}
                >
                  <ListItemIcon sx={{ minWidth: 36 }}>
                    <ClockCounterClockwiseIcon size={18} color="#8B949E" />
                  </ListItemIcon>
                  <ListItemText
                    primary={entry.command}
                    secondary={
                      <Box component="span" sx={{ display: 'flex', gap: 0.5, alignItems: 'center', flexWrap: 'wrap' }}>
                        {entry.cwd && <span style={{ opacity: 0.7 }}>{entry.cwd}</span>}
                        {entry.executed_at && (
                          <span style={{ opacity: 0.5, fontSize: '0.7rem' }}>
                            {' · '}{new Date(entry.executed_at).toLocaleDateString()}
                          </span>
                        )}
                        {entry.linked && (
                          <Chip label={t('palette.linked')} size="small" sx={{ height: 16, fontSize: '0.6rem', ml: 0.5 }} />
                        )}
                      </Box>
                    }
                    slotProps={{
                      primary: { variant: 'body2', sx: { fontFamily: 'monospace' } },
                    }}
                  />
                </ListItemButton>
              ))}
            </List>
          )}

          {history.length === 0 && query.trim() && (
            <Box sx={{ p: 3, textAlign: 'center' }}>
              <Typography variant="body2" color="text.secondary">
                {t('palette.press_enter_execute')}: <code>{query}</code>
              </Typography>
            </Box>
          )}

          {history.length === 0 && !query.trim() && (
            <Box sx={{ p: 3, textAlign: 'center' }}>
              <Typography variant="body2" color="text.secondary">
                {t('palette.search_commands')}
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
