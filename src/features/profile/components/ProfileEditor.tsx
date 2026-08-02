import { useState, useEffect } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import FormControlLabel from '@mui/material/FormControlLabel';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import InputLabel from '@mui/material/InputLabel';
import FormControl from '@mui/material/FormControl';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import ListItemIcon from '@mui/material/ListItemIcon';
import Chip from '@mui/material/Chip';
import {
  PaletteIcon,
  PlusIcon,
  TrashIcon,
  FloppyDiskIcon,
} from '@phosphor-icons/react';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import { listProfiles, saveProfile, deleteProfile } from '../../../core/services/profile.service';
import { useNotify } from '../../../core/notification';
import type { TerminalProfile, AppearanceConfig } from '../../../proto';
import { generateId } from '../../../core/utils';
import { DEFAULT_APPEARANCE } from '../../../engine';
import { useTranslation } from 'react-i18next';
import { localizeBackendError } from '../../../core/backendError';

export function ProfileEditor() {
  const { t } = useTranslation('terminal');
  const [profiles, setProfiles] = useState<TerminalProfile[]>([]);
  const [editing, setEditing] = useState<TerminalProfile | null>(null);
  const [name, setName] = useState('');
  const [appearance, setAppearance] = useState<AppearanceConfig>(DEFAULT_APPEARANCE);
  const [isDefault, setIsDefault] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const notify = useNotify().notify;

  const load = () => {
    listProfiles().then(setProfiles).catch((e) => notify(localizeBackendError(e)));
  };

  useEffect(() => { load(); }, []);

  const startEdit = (profile?: TerminalProfile) => {
    if (profile) {
      setEditing(profile);
      setName(profile.name);
      setIsDefault(profile.is_default);
      try {
        setAppearance(JSON.parse(profile.config_json));
      } catch {
        setAppearance(DEFAULT_APPEARANCE);
      }
    } else {
      setEditing(null);
      setName(t('profile.default_name'));
      setIsDefault(profiles.length === 0);
      setAppearance(DEFAULT_APPEARANCE);
    }
  };

  const handleSave = async () => {
    const profile: TerminalProfile = {
      id: editing?.id ?? generateId(),
      name,
      config_json: JSON.stringify(appearance),
      is_default: isDefault,
      created_at: editing?.created_at ?? Date.now(),
    };
    await saveProfile(profile);
    setEditing(null);
    load();
  };

  const handleDelete = async (id: string) => {
    await deleteProfile(id);
    if (editing?.id === id) setEditing(null);
    setDeleteConfirm(null);
    load();
  };

  return (
    <Box sx={{ display: 'flex', height: '100%' }}>
      <Box sx={{ width: 220, borderRight: '1px solid', borderColor: 'divider', overflow: 'auto' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 2, py: 1.5 }}>
          <Typography variant="subtitle2">{t('profile.title')}</Typography>
          <IconButton size="small" onClick={() => startEdit()}>
            <PlusIcon size={16} color="#6C63FF" />
          </IconButton>
        </Box>
        <List dense>
          {profiles.map((p) => (
            <ListItemButton
              key={p.id}
              selected={editing?.id === p.id}
              onClick={() => startEdit(p)}
              sx={{ borderRadius: 1, mx: 0.5 }}
            >
              <ListItemIcon sx={{ minWidth: 32 }}>
                <PaletteIcon size={16} color="#6C63FF" />
              </ListItemIcon>
              <ListItemText
                primary={p.name}
                slotProps={{ primary: { variant: 'body2' } }}
              />
              {p.is_default && <Chip label="default" size="small" color="primary" sx={{ height: 18, fontSize: '0.6rem' }} />}
              <IconButton size="small" onClick={(e) => { e.stopPropagation(); setDeleteConfirm(p.id); }}>
                <TrashIcon size={14} color="#FF7B72" />
              </IconButton>
            </ListItemButton>
          ))}
        </List>
        {profiles.length === 0 && (
          <Typography variant="caption" color="text.secondary" sx={{ px: 2 }}>
            {t('profile.no_profiles')}
          </Typography>
        )}
      </Box>

      <Box sx={{ flex: 1, p: 3, overflow: 'auto' }}>
        {editing !== null || profiles.length === 0 ? (
          <Stack spacing={2.5}>
            <Typography variant="h6" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <PaletteIcon size={24} color="#6C63FF" weight="fill" />
              {editing ? t('profile.edit_profile') : t('profile.new_profile')}
            </Typography>

            <TextField
              label={t('profile.profile_name')}
              value={name}
              onChange={(e) => setName(e.target.value)}
              size="small"
              fullWidth
            />

            <FormControlLabel
              control={<Switch checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} />}
              label={t('profile.set_default')}
            />

            <Divider />

            <Typography variant="subtitle2">{t('profile.appearance')}</Typography>

            <TextField
              label={t('profile.font_family')}
              value={appearance.fontFamily}
              onChange={(e) => setAppearance((a) => ({ ...a, fontFamily: e.target.value }))}
              size="small"
              fullWidth
              slotProps={{ input: { style: { fontFamily: 'monospace' } } }}
            />

            <Box sx={{ display: 'flex', gap: 2 }}>
              <TextField
                label={t('profile.font_size')}
                type="number"
                value={appearance.fontSize}
                onChange={(e) => setAppearance((a) => ({ ...a, fontSize: Number(e.target.value) }))}
                size="small"
                sx={{ width: 120 }}
                slotProps={{ htmlInput: { min: 8, max: 32 } }}
              />
              <TextField
                label={t('profile.line_height')}
                type="number"
                value={appearance.lineHeight}
                onChange={(e) => setAppearance((a) => ({ ...a, lineHeight: Number(e.target.value) }))}
                size="small"
                sx={{ width: 120 }}
                slotProps={{ htmlInput: { min: 0.8, max: 2, step: 0.1 } }}
              />
            </Box>

            <FormControl size="small" sx={{ width: 180 }}>
              <InputLabel>{t('profile.cursor_style')}</InputLabel>
              <Select
                value={appearance.cursorStyle}
                label={t('profile.cursor_style')}
                onChange={(e) => setAppearance((a) => ({ ...a, cursorStyle: e.target.value as AppearanceConfig['cursorStyle'] }))}
              >
                <MenuItem value="block">{t('profile.cursor_block')}</MenuItem>
                <MenuItem value="underline">{t('profile.cursor_underline')}</MenuItem>
                <MenuItem value="bar">{t('profile.cursor_bar')}</MenuItem>
              </Select>
            </FormControl>

            <FormControlLabel
              control={<Switch checked={appearance.cursorBlink} onChange={(e) => setAppearance((a) => ({ ...a, cursorBlink: e.target.checked }))} />}
              label={t('profile.cursor_blink')}
            />

            <Divider />

            <Typography variant="subtitle2">{t('profile.colors')}</Typography>

            <Box sx={{ display: 'flex', gap: 2 }}>
              <Box>
                <Typography variant="caption" color="text.secondary">{t('profile.foreground')}</Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Box sx={{ width: 32, height: 32, borderRadius: 1, bgcolor: appearance.foreground, border: '1px solid', borderColor: 'divider' }} />
                  <TextField
                    value={appearance.foreground}
                    onChange={(e) => setAppearance((a) => ({ ...a, foreground: e.target.value }))}
                    size="small"
                    sx={{ width: 120 }}
                    slotProps={{ input: { style: { fontFamily: 'monospace', fontSize: '0.8rem' } } }}
                  />
                </Box>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">{t('profile.background')}</Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Box sx={{ width: 32, height: 32, borderRadius: 1, bgcolor: appearance.background, border: '1px solid', borderColor: 'divider' }} />
                  <TextField
                    value={appearance.background}
                    onChange={(e) => setAppearance((a) => ({ ...a, background: e.target.value }))}
                    size="small"
                    sx={{ width: 120 }}
                    slotProps={{ input: { style: { fontFamily: 'monospace', fontSize: '0.8rem' } } }}
                  />
                </Box>
              </Box>
            </Box>

            <Button
              variant="contained"
              startIcon={<FloppyDiskIcon size={18} />}
              onClick={handleSave}
              disabled={!name}
              sx={{ alignSelf: 'flex-start' }}
            >
              {t('profile.save')}
            </Button>
          </Stack>
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
            <PaletteIcon size={48} color="#8B949E" />
            <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
              {t('profile.select_hint')}
            </Typography>
          </Box>
        )}
      </Box>

      <Dialog open={deleteConfirm !== null} onClose={() => setDeleteConfirm(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('profile.delete_confirm_title')}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            {t('profile.delete_confirm_message', {
              name: profiles.find((p) => p.id === deleteConfirm)?.name || '',
              defaultValue: 'Are you sure you want to delete this profile? This action cannot be undone.',
            })}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteConfirm(null)}>{t('profile.cancel', { defaultValue: 'Cancel' })}</Button>
          <Button color="error" variant="contained" onClick={() => deleteConfirm && handleDelete(deleteConfirm)}>
            {t('profile.delete', { defaultValue: 'Delete' })}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
