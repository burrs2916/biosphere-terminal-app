import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import ListItemIcon from '@mui/material/ListItemIcon';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import Stack from '@mui/material/Stack';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import Collapse from '@mui/material/Collapse';
import InputAdornment from '@mui/material/InputAdornment';
import Snackbar from '@mui/material/Snackbar';
import Alert from '@mui/material/Alert';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
import FormControlLabel from '@mui/material/FormControlLabel';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import {
  ClockCounterClockwiseIcon,
  ArrowClockwiseIcon,
  NotebookIcon,
  TrashIcon,
  PencilSimpleIcon,
  FolderOpenIcon,
  LinkBreakIcon,
  MagnifyingGlassIcon,
  CaretDownIcon,
  CaretRightIcon,
  LinkIcon,
  EraserIcon,
  FloppyDiskIcon,
  ChartBarIcon,
  ListIcon,
  WarningCircleIcon,
  CheckCircleIcon,
} from '@phosphor-icons/react';
import { getCommandHistory, searchCommandHistory, deleteCommandHistoryEntry, clearCommandHistory } from '../../../core/services/command.service';
import { createNote, linkCommandToNote, unlinkCommandNote, listNoteGroups, listNoteCategoriesByGroup, searchNotes } from '../../../core/services/notebook.service';
import { openNoteEditorWindow } from '../../../core/services/window.service';
import { useNotify } from '../../../core/notification';
import { IconRenderer } from '../../notebook/components/IconRenderer';
import type { CommandHistoryEntry, LinkedNoteInfo } from '../../../proto/command';
import type { NoteGroupDto, NoteDto } from '../../../proto/notebook';

type ActiveFilter = 'all' | 'unsaved' | 'saved' | 'success' | 'failed';
type TimeFilter = 'all' | 'today' | 'week' | 'month';
type GroupMode = 'command' | 'program';
type ViewMode = 'list' | 'frequent';

interface CommandHistoryProps {
  onExecute: (command: string) => void;
}

interface CommandGroup {
  key: string;
  label: string;
  entries: CommandHistoryEntry[];
  count: number;
  lastExecutedAt: number;
  isLinked: boolean;
  linkedNotes: LinkedNoteInfo[];
}

export function CommandHistory({ onExecute }: CommandHistoryProps) {
  const { t } = useTranslation('terminal');
  const { t: tCommon } = useTranslation('common');

  const [allEntries, setAllEntries] = useState<CommandHistoryEntry[]>([]);
  const [searchResults, setSearchResults] = useState<CommandHistoryEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>('all');
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [groupMode, setGroupMode] = useState<GroupMode>('command');
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [expandedCommands, setExpandedCommands] = useState<Set<string>>(new Set());
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({ open: false, message: '', severity: 'success' });
  const notify = useNotify().notify;

  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [savingGroup, setSavingGroup] = useState<CommandGroup | null>(null);
  const [newNoteTitle, setNewNoteTitle] = useState('');
  const [newNoteGroupId, setNewNoteGroupId] = useState('');
  const [newNoteCategory, setNewNoteCategory] = useState('command');
  const [groups, setGroups] = useState<NoteGroupDto[]>([]);
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [matchedNotes, setMatchedNotes] = useState<NoteDto[]>([]);
  const [saveMode, setSaveMode] = useState<'new' | 'existing'>('new');
  const [selectedExistingNoteId, setSelectedExistingNoteId] = useState('');
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [deleteEntryConfirm, setDeleteEntryConfirm] = useState<CommandHistoryEntry | null>(null);

  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadHistory = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getCommandHistory(500);
      setAllEntries(data);
    } catch (err) { console.error('CommandHistory: operation failed', err); }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const entries = useMemo(() => searchResults ?? allEntries, [searchResults, allEntries]);

  const handleSearchChange = useCallback((value: string) => {
    setSearchQuery(value);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    if (value.trim()) {
      searchTimerRef.current = setTimeout(async () => {
        try {
          const results = await searchCommandHistory(value);
          setSearchResults(results);
        } catch (err) { console.error('CommandHistory: operation failed', err); }
      }, 300);
    } else {
      setSearchResults(null);
    }
  }, []);

  const timeFilteredEntries = useMemo(() => {
    if (timeFilter === 'all') return entries;
    const now = Date.now();
    const cutoff = timeFilter === 'today'
      ? new Date(new Date().toDateString()).getTime()
      : timeFilter === 'week'
        ? now - 7 * 24 * 60 * 60 * 1000
        : now - 30 * 24 * 60 * 60 * 1000;
    return entries.filter((e) => e.executed_at >= cutoff);
  }, [entries, timeFilter]);

  const filteredEntries = useMemo(() => {
    let filtered = timeFilteredEntries;

    if (activeFilter === 'saved') filtered = filtered.filter((e) => e.linked);
    if (activeFilter === 'unsaved') filtered = filtered.filter((e) => !e.linked);
    if (activeFilter === 'success') filtered = filtered.filter((e) => e.exit_code === null || e.exit_code === 0);
    if (activeFilter === 'failed') filtered = filtered.filter((e) => e.exit_code !== null && e.exit_code !== 0);

    return filtered;
  }, [timeFilteredEntries, activeFilter]);

  const groupedEntries = useMemo(() => {
    const groupMap = new Map<string, CommandHistoryEntry[]>();

    filteredEntries.forEach((entry) => {
      const key = groupMode === 'program'
        ? entry.command.trim().split(/\s+/)[0] || 'command'
        : entry.command;
      if (!groupMap.has(key)) groupMap.set(key, []);
      groupMap.get(key)!.push(entry);
    });

    let groups = Array.from(groupMap.entries()).map(([key, ents]): CommandGroup => ({
      key,
      label: key,
      entries: ents.sort((a, b) => b.executed_at - a.executed_at),
      count: ents.length,
      lastExecutedAt: Math.max(...ents.map((e) => e.executed_at)),
      isLinked: ents.some((e) => e.linked),
      linkedNotes: ents.find((e) => e.linked_notes && e.linked_notes.length > 0)?.linked_notes || [],
    }));

    if (viewMode === 'frequent') {
      groups = groups.sort((a, b) => b.count - a.count);
    }

    return groups;
  }, [filteredEntries, groupMode, viewMode]);

  const handleToggleExpand = (key: string) => {
    setExpandedCommands((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const buildNoteContent = (group: CommandGroup) => {
    const program = group.entries[0].command.trim().split(/\s+/)[0] || 'command';
    const lines: string[] = [`## ${program}`, ''];
    group.entries.forEach((entry, i) => {
      if (i > 0) lines.push('');
      lines.push('```bash', entry.command, '```');
      if (entry.cwd) lines.push(`> ${entry.cwd}`);
    });
    lines.push('');
    return lines.join('\n');
  };

  const handleQuickSave = async (e: React.MouseEvent, group: CommandGroup) => {
    e.stopPropagation();
    const entry = group.entries[0];
    const program = entry.command.trim().split(/\s+/)[0] || 'command';
    try {
      const content = buildNoteContent(group);
      const note = await createNote({
        title: `${program}: ${entry.command.slice(0, 50)}`,
        content,
        groupId: '',
        category: 'command',
        tags: [program, 'command'],
      });
      if (note && entry.id) {
        await linkCommandToNote({
          noteId: note.id,
          commandId: entry.id,
          context: entry.command,
        });
      }
      setSnackbar({ open: true, message: t('history.quick_saved'), severity: 'success' });
      loadHistory();
    } catch (err) {
      setSnackbar({ open: true, message: String(err), severity: 'error' });
    }
  };

  const handleOpenSaveDialog = async (e: React.MouseEvent, group: CommandGroup) => {
    e.stopPropagation();
    const entry = group.entries[0];
    const program = entry.command.trim().split(/\s+/)[0] || 'command';
    setSavingGroup(group);
    setNewNoteTitle(`${program}: ${entry.command.slice(0, 50)}`);
    setNewNoteGroupId('');
    setNewNoteCategory('command');
    setCategories([]);
    setSaveMode('new');
    setSelectedExistingNoteId('');
    setMatchedNotes([]);
    listNoteGroups().then(setGroups).catch((e) => notify(String(e)));
    setSaveDialogOpen(true);

    try {
      const results = await searchNotes(program);
      setMatchedNotes(results);
      if (results.length > 0) {
        setSelectedExistingNoteId(results[0].id);
      }
    } catch (err) { console.error('CommandHistory: operation failed', err); }
  };

  const handleGroupChange = (gid: string) => {
    setNewNoteGroupId(gid);
    setNewNoteCategory('command');
    if (gid) {
      listNoteCategoriesByGroup(gid).then(setCategories).catch((e) => notify(String(e)));
    } else {
      setCategories([]);
    }
  };

  const handleConfirmSave = async () => {
    if (!savingGroup) return;
    const entry = savingGroup.entries[0];

    try {
      if (saveMode === 'existing' && selectedExistingNoteId) {
        if (entry.id) {
          await linkCommandToNote({
            noteId: selectedExistingNoteId,
            commandId: entry.id,
            context: entry.command,
          });
        }
        setSnackbar({ open: true, message: t('history.linked_to_existing'), severity: 'success' });
      } else {
        const content = buildNoteContent(savingGroup);
        const program = savingGroup.entries[0].command.trim().split(/\s+/)[0] || 'command';
        const note = await createNote({
          title: newNoteTitle.trim(),
          content,
          groupId: newNoteGroupId || '',
          category: newNoteCategory,
          tags: [program, 'command'],
        });
        if (note && entry.id) {
          await linkCommandToNote({
            noteId: note.id,
            commandId: entry.id,
            context: entry.command,
          });
        }
        setSnackbar({ open: true, message: t('history.quick_saved'), severity: 'success' });
      }
      setSaveDialogOpen(false);
      setSavingGroup(null);
      loadHistory();
    } catch (err) {
      console.error('Save to note failed:', err);
      setSnackbar({ open: true, message: String(err), severity: 'error' });
    }
  };

  const handleEditLinkedNote = async (e: React.MouseEvent, noteId: string, noteTitle: string) => {
    e.stopPropagation();
    await openNoteEditorWindow(noteId, noteTitle);
  };

  const handleUnlinkNote = async (e: React.MouseEvent, linkId: string) => {
    e.stopPropagation();
    try {
      await unlinkCommandNote(linkId);
      loadHistory();
    } catch (err) {
      console.error('Failed to unlink note:', err);
    }
  };

  const handleDeleteEntry = async (entry: CommandHistoryEntry) => {
    if (!entry.id) return;
    try {
      await deleteCommandHistoryEntry(entry.id);
      setAllEntries((prev) => prev.filter((e) => e.id !== entry.id));
      setDeleteEntryConfirm(null);
    } catch (e) {
      console.error('Failed to delete history entry:', e);
    }
  };

  const handleClearAll = async () => {
    try {
      await clearCommandHistory();
      setAllEntries([]);
      setSearchResults(null);
      setClearConfirmOpen(false);
    } catch (e) {
      console.error('Failed to clear history:', e);
    }
  };

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return t('history.just_now');
    if (diffMin < 60) return t('history.minutes_ago', { count: diffMin });
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return t('history.hours_ago', { count: diffHr });
    return d.toLocaleDateString();
  };

  if (entries.length === 0 && !loading) {
    return (
      <Box sx={{ p: 3, textAlign: 'center' }}>
        <ClockCounterClockwiseIcon size={32} color="#8B949E" />
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          {t('history.no_history')}
        </Typography>
      </Box>
    );
  }

  if (loading && entries.length === 0) {
    return (
      <Box sx={{ p: 3, textAlign: 'center' }}>
        <ArrowClockwiseIcon size={24} color="#6C63FF" className="spin" />
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          {tCommon('loading') || 'Loading...'}
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 2, py: 1, flexShrink: 0 }}>
        <Typography variant="caption" color="text.secondary">
          {t('history.commands_count', { count: filteredEntries.length })}
        </Typography>
        <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
          <ToggleButtonGroup
            size="small"
            value={viewMode}
            exclusive
            onChange={(_, v) => v && setViewMode(v)}
            sx={{ '& .MuiToggleButton-root': { py: 0.25, px: 0.75, fontSize: '0.65rem', border: 'none', borderRadius: 1.5 } }}
          >
            <ToggleButton value="list" sx={{ '&.Mui-selected': { bgcolor: 'rgba(108,99,255,0.12)' } }}>
              <ListIcon size={14} />
            </ToggleButton>
            <ToggleButton value="frequent" sx={{ '&.Mui-selected': { bgcolor: 'rgba(108,99,255,0.12)' } }}>
              <ChartBarIcon size={14} />
            </ToggleButton>
          </ToggleButtonGroup>
          <Tooltip title={t('history.refresh') || ''} arrow>
            <IconButton size="small" onClick={loadHistory} disabled={loading}>
              <ArrowClockwiseIcon size={16} />
            </IconButton>
          </Tooltip>
          <Tooltip title={t('history.clear_all') || ''} arrow>
            <IconButton size="small" onClick={() => setClearConfirmOpen(true)} disabled={entries.length === 0}>
              <EraserIcon size={16} color="#FF5252" />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>

      <Box sx={{ px: 2, pb: 0.5, flexShrink: 0 }}>
        <TextField
          fullWidth
          size="small"
          placeholder={t('history.search_placeholder')}
          value={searchQuery}
          onChange={(e) => handleSearchChange(e.target.value)}
          variant="outlined"
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <MagnifyingGlassIcon size={16} color="#8B949E" />
                </InputAdornment>
              ),
              sx: { fontSize: '0.85rem' },
            },
          }}
          sx={{
            '& .MuiOutlinedInput-root': { borderRadius: 2 },
            '& .MuiInputBase-input': { py: 0.65 },
          }}
        />
      </Box>

      <Box sx={{ display: 'flex', gap: 0.5, px: 2, pb: 0.5, flexShrink: 0 }}>
        <ToggleButtonGroup
          size="small"
          value={activeFilter}
          exclusive
          onChange={(_, v) => v && setActiveFilter(v)}
          sx={{ '& .MuiToggleButton-root': { py: 0.15, px: 1, fontSize: '0.6rem', borderRadius: 1.5 } }}
        >
          <ToggleButton value="all">{t('history.filter_all')}</ToggleButton>
          <ToggleButton value="unsaved">{t('history.filter_unsaved')}</ToggleButton>
          <ToggleButton value="saved">{t('history.filter_saved')}</ToggleButton>
          <ToggleButton value="success" sx={{ '&.Mui-selected': { color: '#4CAF50', bgcolor: 'rgba(76,175,80,0.12)' } }}>
            <CheckCircleIcon size={12} style={{ marginRight: 2 }} />
            {t('history.filter_success')}
          </ToggleButton>
          <ToggleButton value="failed" sx={{ '&.Mui-selected': { color: '#FF5252', bgcolor: 'rgba(255,82,82,0.12)' } }}>
            <WarningCircleIcon size={12} style={{ marginRight: 2 }} />
            {t('history.filter_failed')}
          </ToggleButton>
        </ToggleButtonGroup>
      </Box>

      <Box sx={{ display: 'flex', gap: 0.5, px: 2, pb: 0.5, flexShrink: 0 }}>
        <ToggleButtonGroup
          size="small"
          value={timeFilter}
          exclusive
          onChange={(_, v) => v && setTimeFilter(v)}
          sx={{ '& .MuiToggleButton-root': { py: 0.15, px: 1, fontSize: '0.6rem', borderRadius: 1.5 } }}
        >
          <ToggleButton value="all">{t('history.time_all')}</ToggleButton>
          <ToggleButton value="today">{t('history.time_today')}</ToggleButton>
          <ToggleButton value="week">{t('history.time_week')}</ToggleButton>
          <ToggleButton value="month">{t('history.time_month')}</ToggleButton>
        </ToggleButtonGroup>
        <Box sx={{ flex: 1 }} />
        <ToggleButtonGroup
          size="small"
          value={groupMode}
          exclusive
          onChange={(_, v) => v && setGroupMode(v)}
          sx={{ '& .MuiToggleButton-root': { py: 0.15, px: 1, fontSize: '0.6rem', borderRadius: 1.5 } }}
        >
          <ToggleButton value="command">{t('history.group_by_command')}</ToggleButton>
          <ToggleButton value="program">{t('history.group_by_program')}</ToggleButton>
        </ToggleButtonGroup>
      </Box>

      <Box sx={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
        {groupedEntries.length === 0 ? (
          <Box sx={{ p: 3, textAlign: 'center' }}>
            <MagnifyingGlassIcon size={28} color="#8B949E" />
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              {t('history.no_results')}
            </Typography>
          </Box>
        ) : (
          <List dense>
            {groupedEntries.map((group) => {
              const isExpanded = expandedCommands.has(group.key);
              return (
                <Box key={group.key}>
                  <ListItemButton
                    onClick={() => handleToggleExpand(group.key)}
                    sx={{
                      borderRadius: 1,
                      mx: 0.5,
                      mb: 0.25,
                      ...(group.isLinked
                        ? {
                            bgcolor: 'rgba(129, 199, 132, 0.08)',
                            borderLeft: '3px solid rgba(129, 199, 132, 0.6)',
                            '&:hover': { bgcolor: 'rgba(129, 199, 132, 0.14)' },
                          }
                        : {}),
                    }}
                  >
                    <ListItemIcon sx={{ minWidth: 24 }}>
                      {isExpanded
                        ? <CaretDownIcon size={14} color="#8B949E" />
                        : <CaretRightIcon size={14} color="#8B949E" />}
                    </ListItemIcon>
                    <ListItemText
                      slotProps={{
                        primary: { component: 'div' },
                        secondary: { component: 'div' },
                      }}
                      primary={
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                          <Box
                            component="span"
                            sx={{
                              fontFamily: 'monospace',
                              fontSize: '0.8rem',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                              maxWidth: 220,
                            }}
                          >
                            {group.label}
                          </Box>
                          {group.count > 1 && (
                            <Chip
                              label={`${group.count}×`}
                              size="small"
                              variant="outlined"
                              sx={{ height: 16, fontSize: '0.55rem', flexShrink: 0 }}
                            />
                          )}
                          {group.isLinked && (
                            <NotebookIcon size={12} color="#81C784" weight="fill" />
                          )}
                        </Box>
                      }
                      secondary={
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.25 }}>
                          <Typography variant="caption" color="text.secondary">
                            {formatTime(group.lastExecutedAt)}
                          </Typography>
                          {group.isLinked && group.linkedNotes[0] && (
                            <Typography variant="caption" sx={{ color: '#81C784', display: 'flex', alignItems: 'center', gap: 0.25 }}>
                              {group.linkedNotes[0].title}
                            </Typography>
                          )}
                        </Box>
                      }
                    />
                    {group.isLinked ? (
                      <Box sx={{ display: 'flex', flexShrink: 0 }}>
                        <Tooltip title={t('history.edit_note') || ''} arrow>
                          <IconButton size="small" onClick={(e) => handleEditLinkedNote(e, group.linkedNotes[0].noteId, group.linkedNotes[0].title)}>
                            <PencilSimpleIcon size={14} color="#81C784" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title={t('history.unlink_note') || 'Unlink'} arrow>
                          <IconButton size="small" onClick={(e) => handleUnlinkNote(e, group.linkedNotes[0].linkId)}>
                            <LinkBreakIcon size={14} color="#FFA726" />
                          </IconButton>
                        </Tooltip>
                      </Box>
                    ) : (
                      <Box sx={{ display: 'flex', flexShrink: 0 }}>
                        <Tooltip title={t('history.quick_save') || ''} arrow>
                          <IconButton size="small" onClick={(e) => handleQuickSave(e, group)}>
                            <FloppyDiskIcon size={14} color="#81C784" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title={t('history.save_to_notebook') || ''} arrow>
                          <IconButton size="small" onClick={(e) => handleOpenSaveDialog(e, group)}>
                            <NotebookIcon size={14} color="#6C63FF" />
                          </IconButton>
                        </Tooltip>
                      </Box>
                    )}
                  </ListItemButton>

                  <Collapse in={isExpanded} timeout="auto" unmountOnExit>
                    <List dense sx={{ pl: 3 }}>
                      {group.entries.map((entry) => (
                        <ListItemButton
                          key={entry.id}
                          onClick={() => onExecute(entry.command)}
                          sx={{
                            borderRadius: 1,
                            mx: 0.5,
                            mb: 0.1,
                            py: 0.25,
                            '&:hover': { bgcolor: 'rgba(108,99,255,0.06)' },
                          }}
                        >
                          <ListItemIcon sx={{ minWidth: 20 }}>
                            <FolderOpenIcon size={10} color="#8B949E" />
                          </ListItemIcon>
                          <ListItemText
                            slotProps={{ primary: { component: 'div' } }}
                            primary={
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace', fontSize: '0.7rem' }}>
                                  {entry.cwd || '~'}
                                </Typography>
                                <Typography variant="caption" color="text.secondary">
                                  {formatTime(entry.executed_at)}
                                </Typography>
                                {entry.exit_code !== null && (
                                  <Chip
                                    label={entry.exit_code === 0 ? '0' : `${entry.exit_code}`}
                                    size="small"
                                    color={entry.exit_code === 0 ? 'success' : 'error'}
                                    variant="outlined"
                                    sx={{ height: 14, fontSize: '0.55rem' }}
                                  />
                                )}
                              </Box>
                            }
                          />
                          <Tooltip title={t('history.delete') || ''} arrow>
                            <IconButton
                              size="small"
                              onClick={(e) => { e.stopPropagation(); setDeleteEntryConfirm(entry); }}
                              sx={{ flexShrink: 0 }}
                            >
                              <TrashIcon size={12} color="#FF5252" />
                            </IconButton>
                          </Tooltip>
                        </ListItemButton>
                      ))}
                    </List>
                  </Collapse>
                </Box>
              );
            })}
          </List>
        )}
      </Box>

      <Dialog open={saveDialogOpen} onClose={() => setSaveDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{t('history.save_dialog.title')}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Box
              sx={{
                p: 1.5,
                borderRadius: 1,
                bgcolor: 'rgba(108,99,255,0.08)',
                border: '1px solid rgba(108,99,255,0.2)',
                fontFamily: 'monospace',
                fontSize: '0.85rem',
                wordBreak: 'break-all',
              }}
            >
              {savingGroup?.entries[0]?.command}
            </Box>

            {matchedNotes.length > 0 && (
              <Box
                sx={{
                  p: 1.5,
                  borderRadius: 1,
                  bgcolor: 'rgba(255, 167, 38, 0.08)',
                  border: '1px solid rgba(255, 167, 38, 0.3)',
                }}
              >
                <Typography variant="caption" sx={{ color: '#FFA726', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 0.5, mb: 1 }}>
                  <LinkIcon size={12} />
                  {t('history.save_dialog.matched_notes', { count: matchedNotes.length })}
                </Typography>
                <RadioGroup
                  value={saveMode}
                  onChange={(e) => setSaveMode(e.target.value as 'new' | 'existing')}
                  sx={{ gap: 0.5 }}
                >
                  <FormControlLabel
                    value="existing"
                    control={<Radio size="small" />}
                    label={
                      <Typography variant="caption" sx={{ fontWeight: 600 }}>
                        {t('history.save_dialog.link_existing')}
                      </Typography>
                    }
                    sx={{ mr: 0 }}
                  />
                  {saveMode === 'existing' && (
                    <Box sx={{ pl: 3, maxHeight: 120, overflow: 'auto' }}>
                      <RadioGroup
                        value={selectedExistingNoteId}
                        onChange={(e) => setSelectedExistingNoteId(e.target.value)}
                        sx={{ gap: 0.25 }}
                      >
                        {matchedNotes.map((note) => (
                          <FormControlLabel
                            key={note.id}
                            value={note.id}
                            control={<Radio size="small" />}
                            label={
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                <NotebookIcon size={12} color="#81C784" />
                                <Typography variant="caption" noWrap sx={{ maxWidth: 280 }}>
                                  {note.title}
                                </Typography>
                                {note.category && (
                                  <Chip label={note.category} size="small" variant="outlined" sx={{ height: 16, fontSize: '0.55rem' }} />
                                )}
                              </Box>
                            }
                            sx={{ mr: 0 }}
                          />
                        ))}
                      </RadioGroup>
                    </Box>
                  )}
                  <FormControlLabel
                    value="new"
                    control={<Radio size="small" />}
                    label={
                      <Typography variant="caption" sx={{ fontWeight: 600 }}>
                        {t('history.save_dialog.create_new')}
                      </Typography>
                    }
                    sx={{ mr: 0 }}
                  />
                </RadioGroup>
              </Box>
            )}

            {saveMode === 'new' && (
              <>
                <TextField
                  label={t('history.save_dialog.note_title')}
                  value={newNoteTitle}
                  onChange={(e) => setNewNoteTitle(e.target.value)}
                  fullWidth
                  size="small"
                />
                <Box sx={{ display: 'flex', gap: 1 }}>
                  <FormControl size="small" sx={{ flex: 1 }}>
                    <InputLabel>{t('history.save_dialog.group')}</InputLabel>
                    <Select
                      value={newNoteGroupId}
                      label={t('history.save_dialog.group')}
                      onChange={(e) => handleGroupChange(e.target.value)}
                    >
                      <MenuItem value="">
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                          <IconRenderer value="" size={14} />
                          {t('group.uncategorized', { ns: 'notebook' })}
                        </Box>
                      </MenuItem>
                      {groups.map((g) => (
                        <MenuItem key={g.id} value={g.id}>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                            <IconRenderer value={g.icon} size={14} />
                            {g.name}
                          </Box>
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                  <FormControl size="small" sx={{ flex: 1 }} disabled={!newNoteGroupId}>
                    <InputLabel>{t('history.save_dialog.category')}</InputLabel>
                    <Select
                      value={newNoteCategory}
                      label={t('history.save_dialog.category')}
                      onChange={(e) => setNewNoteCategory(e.target.value)}
                    >
                      <MenuItem value="command">
                        <em>command</em>
                      </MenuItem>
                      {categories.map((cat) => (
                        <MenuItem key={cat.id} value={cat.name}>
                          {cat.name}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Box>
              </>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSaveDialogOpen(false)}>{tCommon('action.cancel')}</Button>
          <Button
            onClick={handleConfirmSave}
            variant="contained"
            disabled={saveMode === 'new' ? !newNoteTitle.trim() : !selectedExistingNoteId}
          >
            {saveMode === 'existing' ? t('history.save_dialog.link_button') : tCommon('action.save')}
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={snackbar.open}
        autoHideDuration={2000}
        onClose={() => setSnackbar({ open: false, message: '', severity: 'success' })}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          severity={snackbar.severity}
          variant="filled"
          sx={{ width: '100%' }}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>

      <Dialog open={clearConfirmOpen} onClose={() => setClearConfirmOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('history.clear_all')}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            {t('history.clear_all_confirm')}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setClearConfirmOpen(false)}>{tCommon('action.cancel')}</Button>
          <Button onClick={handleClearAll} variant="contained" color="error">
            {t('history.clear_all')}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={deleteEntryConfirm !== null} onClose={() => setDeleteEntryConfirm(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('history.delete_entry_confirm_title', { defaultValue: 'Delete Entry' })}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            {t('history.delete_entry_confirm_message', {
              command: deleteEntryConfirm?.command?.slice(0, 60) || '',
              defaultValue: 'Are you sure you want to delete this command entry? This action cannot be undone.',
            })}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteEntryConfirm(null)}>{tCommon('action.cancel')}</Button>
          <Button onClick={() => deleteEntryConfirm && handleDeleteEntry(deleteEntryConfirm)} variant="contained" color="error">
            {t('history.delete', { defaultValue: 'Delete' })}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
