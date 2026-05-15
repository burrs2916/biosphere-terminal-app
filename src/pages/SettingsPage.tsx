import { useEffect, useState, useRef, useCallback } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import FormControl from '@mui/material/FormControl';
import Button from '@mui/material/Button';
import Snackbar from '@mui/material/Snackbar';
import Alert from '@mui/material/Alert';
import Paper from '@mui/material/Paper';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Divider from '@mui/material/Divider';
import {
  PaletteIcon,
  TerminalWindowIcon,
  PaintBucketIcon,
  DatabaseIcon,
  MonitorIcon,
  ArrowCounterClockwiseIcon,
  ExportIcon,
} from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { useSettingsStore } from '../engine';
import type { ThemeMode, CursorStyle } from '../engine/settingsStore';

type SectionKey = 'appearance' | 'terminal' | 'colors' | 'data';

interface SectionDef {
  key: SectionKey;
  icon: React.ReactNode;
  label: string;
}

function SettingRow({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        py: 2,
        px: 2.5,
        gap: 3,
        borderRadius: 1.5,
        transition: 'background-color 0.15s',
        '&:hover': {
          backgroundColor: 'action.hover',
        },
      }}
    >
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="body2" sx={{ fontWeight: 500 }}>
          {label}
        </Typography>
        {description && (
          <Typography variant="caption" color="text.secondary" sx={{ mt: 0.25, display: 'block' }}>
            {description}
          </Typography>
        )}
      </Box>
      <Box sx={{ flexShrink: 0, display: 'flex', alignItems: 'center', minHeight: 36 }}>
        {children}
      </Box>
    </Box>
  );
}

function ColorPickerRow({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
      <Box
        sx={{
          width: 28,
          height: 28,
          borderRadius: 1,
          bgcolor: value,
          border: '2px solid',
          borderColor: 'divider',
          flexShrink: 0,
        }}
      />
      <TextField
        value={value}
        onChange={(e) => onChange(e.target.value)}
        size="small"
        sx={{ width: 110 }}
        slotProps={{
          input: { style: { fontFamily: 'monospace', fontSize: '0.75rem' } },
        }}
      />
    </Box>
  );
}

export function SettingsPage() {
  const { t } = useTranslation('common');
  const { settings, init, update, updateAppearance, reset } = useSettingsStore();
  const [snackbar, setSnackbar] = useState(false);
  const [snackbarMsg, setSnackbarMsg] = useState('');
  const [activeSection, setActiveSection] = useState<SectionKey>('appearance');
  const contentRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<Record<SectionKey, HTMLDivElement | null>>({
    appearance: null,
    terminal: null,
    colors: null,
    data: null,
  });

  useEffect(() => {
    init();
  }, [init]);

  const showSnackbar = (msg: string) => {
    setSnackbarMsg(msg);
    setSnackbar(true);
  };

  const handleReset = () => {
    reset();
    showSnackbar(t('settings.reset_success'));
  };

  const handleExportSettings = () => {
    const blob = new Blob([JSON.stringify(settings, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'biosphere-settings.json';
    a.click();
    URL.revokeObjectURL(url);
    showSnackbar(t('settings.export_success'));
  };

  const scrollToSection = (key: SectionKey) => {
    sectionRefs.current[key]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setActiveSection(key);
  };

  const handleScroll = useCallback(() => {
    const container = contentRef.current;
    if (!container) return;
    const scrollTop = container.scrollTop + 80;
    const keys: SectionKey[] = ['appearance', 'terminal', 'colors', 'data'];
    for (let i = keys.length - 1; i >= 0; i--) {
      const el = sectionRefs.current[keys[i]];
      if (el && el.offsetTop <= scrollTop) {
        setActiveSection(keys[i]);
        break;
      }
    }
  }, []);

  const sections: SectionDef[] = [
    { key: 'appearance', icon: <PaletteIcon size={20} weight="fill" />, label: t('settings.appearance') },
    { key: 'terminal', icon: <TerminalWindowIcon size={20} weight="fill" />, label: t('settings.terminal') },
    { key: 'colors', icon: <PaintBucketIcon size={20} weight="fill" />, label: t('settings.colors') },
    { key: 'data', icon: <DatabaseIcon size={20} weight="fill" />, label: t('settings.data_management') },
  ];

  const handleColorChange = (index: number, value: string) => {
    const newColors = [...settings.appearance.colors];
    newColors[index] = value;
    updateAppearance('colors', newColors as any);
  };

  return (
    <Box sx={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      <Box
        sx={{
          width: 220,
          flexShrink: 0,
          borderRight: '1px solid',
          borderColor: 'divider',
          display: 'flex',
          flexDirection: 'column',
          pt: 2,
        }}
      >
        <Typography
          variant="subtitle2"
          sx={{ px: 2.5, pb: 1.5, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: '0.06em', fontSize: '0.7rem' }}
        >
          {t('settings.title')}
        </Typography>
        <List sx={{ px: 1 }}>
          {sections.map((section) => (
            <ListItemButton
              key={section.key}
              selected={activeSection === section.key}
              onClick={() => scrollToSection(section.key)}
              sx={{
                borderRadius: 1.5,
                mb: 0.25,
                py: 1,
                '&.Mui-selected': {
                  backgroundColor: 'rgba(108, 99, 255, 0.12)',
                  '&:hover': { backgroundColor: 'rgba(108, 99, 255, 0.18)' },
                  '& .MuiListItemIcon-root': { color: 'primary.main' },
                  '& .MuiListItemText-primary': { color: 'primary.main', fontWeight: 600 },
                },
              }}
            >
              <ListItemIcon sx={{ minWidth: 36 }}>{section.icon}</ListItemIcon>
              <ListItemText
                primary={section.label}
                slotProps={{ primary: { variant: 'body2' } }}
                sx={{ '& .MuiListItemText-primary': { fontWeight: activeSection === section.key ? 600 : 400 } }}
              />
            </ListItemButton>
          ))}
        </List>
      </Box>

      <Box
        ref={contentRef}
        onScroll={handleScroll}
        sx={{
          flex: 1,
          overflow: 'auto',
          px: 4,
          py: 3,
        }}
      >
        <Box sx={{ maxWidth: 680 }}>

          {/* ===== Appearance Section ===== */}
          <Box ref={(el: HTMLDivElement | null) => { sectionRefs.current.appearance = el; }} sx={{ mb: 5 }}>
            <Typography variant="h6" sx={{ mb: 0.5, fontWeight: 600 }}>
              {t('settings.appearance')}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2.5 }}>
              {t('settings.appearance_desc')}
            </Typography>

            <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
              <SettingRow
                label={t('settings.theme')}
                description={t('settings.theme_desc')}
              >
                <FormControl size="small" sx={{ width: 160 }}>
                  <Select
                    value={settings.theme}
                    onChange={(e) => update('theme', e.target.value as ThemeMode)}
                  >
                    <MenuItem value="dark">
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Box sx={{ width: 14, height: 14, borderRadius: '50%', bgcolor: '#0D1117', border: '1px solid #30363D' }} />
                        {t('theme.dark')}
                      </Box>
                    </MenuItem>
                    <MenuItem value="light">
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Box sx={{ width: 14, height: 14, borderRadius: '50%', bgcolor: '#F5F5F5', border: '1px solid #D1D5DB' }} />
                        {t('theme.light')}
                      </Box>
                    </MenuItem>
                    <MenuItem value="system">
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <MonitorIcon size={14} />
                        {t('theme.system')}
                      </Box>
                    </MenuItem>
                  </Select>
                </FormControl>
              </SettingRow>
              <Divider />
              <SettingRow
                label={t('settings.language')}
                description={t('settings.language_desc')}
              >
                <FormControl size="small" sx={{ width: 160 }}>
                  <Select
                    value={settings.language}
                    onChange={(e) => {
                      const lang = e.target.value as 'zh-CN' | 'en-US';
                      update('language', lang);
                    }}
                  >
                    <MenuItem value="zh-CN">{t('language.zh')}</MenuItem>
                    <MenuItem value="en-US">{t('language.en')}</MenuItem>
                  </Select>
                </FormControl>
              </SettingRow>
              <Divider />
              <SettingRow
                label={t('settings.show_status_bar')}
                description={t('settings.show_status_bar_desc')}
              >
                <Switch
                  checked={settings.showStatusBar}
                  onChange={(e) => update('showStatusBar', e.target.checked)}
                />
              </SettingRow>
            </Paper>
          </Box>

          {/* ===== Terminal Section ===== */}
          <Box ref={(el: HTMLDivElement | null) => { sectionRefs.current.terminal = el; }} sx={{ mb: 5 }}>
            <Typography variant="h6" sx={{ mb: 0.5, fontWeight: 600 }}>
              {t('settings.terminal')}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2.5 }}>
              {t('settings.terminal_desc')}
            </Typography>

            <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
              <SettingRow
                label={t('settings.shell')}
                description={t('settings.shell_desc')}
              >
                <TextField
                  value={settings.shell}
                  onChange={(e) => update('shell', e.target.value)}
                  size="small"
                  sx={{ width: 260 }}
                  slotProps={{ input: { style: { fontFamily: 'monospace', fontSize: '0.8rem' } } }}
                />
              </SettingRow>
              <Divider />
              <SettingRow
                label={t('settings.font_family')}
                description={t('settings.font_family_desc')}
              >
                <TextField
                  value={settings.appearance.fontFamily}
                  onChange={(e) => updateAppearance('fontFamily', e.target.value)}
                  size="small"
                  sx={{ width: 360 }}
                  slotProps={{ input: { style: { fontFamily: 'monospace', fontSize: '0.8rem' } } }}
                />
              </SettingRow>
              <Divider />
              <SettingRow
                label={t('settings.font_size')}
                description={t('settings.font_size_desc')}
              >
                <TextField
                  type="number"
                  value={settings.appearance.fontSize}
                  onChange={(e) => updateAppearance('fontSize', Number(e.target.value))}
                  size="small"
                  sx={{ width: 100 }}
                  slotProps={{ htmlInput: { min: 8, max: 32 } }}
                />
              </SettingRow>
              <Divider />
              <SettingRow
                label={t('settings.line_height')}
                description={t('settings.line_height_desc')}
              >
                <TextField
                  type="number"
                  value={settings.appearance.lineHeight}
                  onChange={(e) => updateAppearance('lineHeight', Number(e.target.value))}
                  size="small"
                  sx={{ width: 100 }}
                  slotProps={{ htmlInput: { min: 0.8, max: 2, step: 0.1 } }}
                />
              </SettingRow>
              <Divider />
              <SettingRow
                label={t('settings.cursor_style')}
                description={t('settings.cursor_style_desc')}
              >
                <FormControl size="small" sx={{ width: 160 }}>
                  <Select
                    value={settings.appearance.cursorStyle}
                    onChange={(e) => updateAppearance('cursorStyle', e.target.value as CursorStyle)}
                  >
                    <MenuItem value="block">{t('settings.cursor_block')}</MenuItem>
                    <MenuItem value="underline">{t('settings.cursor_underline')}</MenuItem>
                    <MenuItem value="bar">{t('settings.cursor_bar')}</MenuItem>
                  </Select>
                </FormControl>
              </SettingRow>
              <Divider />
              <SettingRow
                label={t('settings.cursor_blink')}
                description={t('settings.cursor_blink_desc')}
              >
                <Switch
                  checked={settings.appearance.cursorBlink}
                  onChange={(e) => updateAppearance('cursorBlink', e.target.checked)}
                />
              </SettingRow>
              <Divider />
              <SettingRow
                label={t('settings.cursor_color')}
                description={t('settings.cursor_color_desc')}
              >
                <ColorPickerRow
                  value={settings.appearance.cursorColor}
                  onChange={(v) => updateAppearance('cursorColor', v)}
                />
              </SettingRow>
              <Divider />
              <SettingRow
                label={t('settings.scrollback')}
                description={t('settings.scrollback_desc')}
              >
                <TextField
                  type="number"
                  value={settings.scrollback}
                  onChange={(e) => update('scrollback', Number(e.target.value))}
                  size="small"
                  sx={{ width: 120 }}
                  slotProps={{ htmlInput: { min: 100, max: 100000, step: 1000 } }}
                />
              </SettingRow>
            </Paper>

            <Typography variant="subtitle2" sx={{ mt: 3, mb: 1.5, fontWeight: 600 }}>
              {t('settings.behavior')}
            </Typography>
            <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
              <SettingRow
                label={t('settings.copy_on_select')}
                description={t('settings.copy_on_select_desc')}
              >
                <Switch
                  checked={settings.copyOnSelect}
                  onChange={(e) => update('copyOnSelect', e.target.checked)}
                />
              </SettingRow>
              <Divider />
              <SettingRow
                label={t('settings.paste_on_middle_click')}
                description={t('settings.paste_on_middle_click_desc')}
              >
                <Switch
                  checked={settings.pasteOnMiddleClick}
                  onChange={(e) => update('pasteOnMiddleClick', e.target.checked)}
                />
              </SettingRow>
              <Divider />
              <SettingRow
                label={t('settings.bell_style')}
                description={t('settings.bell_style_desc')}
              >
                <FormControl size="small" sx={{ width: 160 }}>
                  <Select
                    value={settings.bellStyle}
                    onChange={(e) => update('bellStyle', e.target.value as 'none' | 'visual' | 'sound')}
                  >
                    <MenuItem value="none">{t('settings.bell_none')}</MenuItem>
                    <MenuItem value="visual">{t('settings.bell_visual')}</MenuItem>
                    <MenuItem value="sound">{t('settings.bell_sound')}</MenuItem>
                  </Select>
                </FormControl>
              </SettingRow>
              <Divider />
              <SettingRow
                label={t('settings.webgl_renderer')}
                description={t('settings.webgl_renderer_desc')}
              >
                <Switch
                  checked={settings.webglRenderer}
                  onChange={(e) => update('webglRenderer', e.target.checked)}
                />
              </SettingRow>
              <Divider />
              <SettingRow
                label={t('settings.confirm_before_close')}
                description={t('settings.confirm_before_close_desc')}
              >
                <Switch
                  checked={settings.confirmBeforeClose}
                  onChange={(e) => update('confirmBeforeClose', e.target.checked)}
                />
              </SettingRow>
            </Paper>
          </Box>

          {/* ===== Colors Section ===== */}
          <Box ref={(el: HTMLDivElement | null) => { sectionRefs.current.colors = el; }} sx={{ mb: 5 }}>
            <Typography variant="h6" sx={{ mb: 0.5, fontWeight: 600 }}>
              {t('settings.colors')}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2.5 }}>
              {t('settings.colors_desc')}
            </Typography>

            <Paper variant="outlined" sx={{ overflow: 'hidden', p: 2.5 }}>
              <Typography variant="subtitle2" sx={{ mb: 2, fontWeight: 600 }}>
                {t('settings.core_colors')}
              </Typography>
              <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap', mb: 3 }}>
                <ColorPickerRow
                  value={settings.appearance.foreground}
                  onChange={(v) => updateAppearance('foreground', v)}
                />
                <ColorPickerRow
                  value={settings.appearance.background}
                  onChange={(v) => updateAppearance('background', v)}
                />
                <ColorPickerRow
                  value={settings.appearance.selectionBackground}
                  onChange={(v) => updateAppearance('selectionBackground', v)}
                />
                <ColorPickerRow
                  value={settings.appearance.selectionForeground}
                  onChange={(v) => updateAppearance('selectionForeground', v)}
                />
              </Box>

              <Divider sx={{ mb: 2 }} />

              <Typography variant="subtitle2" sx={{ mb: 2, fontWeight: 600 }}>
                {t('settings.ansi_colors')}
              </Typography>
              <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 1.5 }}>
                {settings.appearance.colors.map((color, i) => (
                  <Box
                    key={i}
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 1,
                      p: 1,
                      borderRadius: 1.5,
                      transition: 'background-color 0.15s',
                      '&:hover': { backgroundColor: 'action.hover' },
                    }}
                  >
                    <Box
                      sx={{
                        width: 24,
                        height: 24,
                        borderRadius: 0.75,
                        bgcolor: color,
                        border: '2px solid',
                        borderColor: 'divider',
                        flexShrink: 0,
                      }}
                    />
                    <TextField
                      value={color}
                      onChange={(e) => handleColorChange(i, e.target.value)}
                      size="small"
                      variant="standard"
                      sx={{ flex: 1 }}
                      slotProps={{
                        input: {
                          style: { fontFamily: 'monospace', fontSize: '0.7rem' },
                          disableUnderline: true,
                        },
                      }}
                    />
                  </Box>
                ))}
              </Box>
            </Paper>
          </Box>

          {/* ===== Data Section ===== */}
          <Box ref={(el: HTMLDivElement | null) => { sectionRefs.current.data = el; }} sx={{ mb: 5 }}>
            <Typography variant="h6" sx={{ mb: 0.5, fontWeight: 600 }}>
              {t('settings.data_management')}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2.5 }}>
              {t('settings.data_management_desc')}
            </Typography>

            <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
              <SettingRow
                label={t('settings.export')}
                description={t('settings.export_desc')}
              >
                <Button
                  variant="outlined"
                  size="small"
                  startIcon={<ExportIcon size={14} />}
                  onClick={handleExportSettings}
                >
                  {t('action.export')}
                </Button>
              </SettingRow>
              <Divider />
              <SettingRow
                label={t('settings.reset')}
                description={t('settings.reset_desc')}
              >
                <Button
                  variant="outlined"
                  size="small"
                  color="warning"
                  startIcon={<ArrowCounterClockwiseIcon size={14} />}
                  onClick={handleReset}
                >
                  {t('settings.reset')}
                </Button>
              </SettingRow>
            </Paper>
          </Box>

        </Box>
      </Box>

      <Snackbar
        open={snackbar}
        autoHideDuration={2000}
        onClose={() => setSnackbar(false)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity="success" variant="filled" onClose={() => setSnackbar(false)}>
          {snackbarMsg}
        </Alert>
      </Snackbar>
    </Box>
  );
}