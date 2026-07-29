import { createTheme, ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import type { ReactNode } from 'react';
import { useMemo, useEffect, useState } from 'react';
import { useSettingsStore } from '../engine';

const darkPalette = {
  mode: 'dark' as const,
  primary: { main: '#6C63FF', light: '#8B83FF', dark: '#4A42E0' },
  secondary: { main: '#FF6584', light: '#FF8FA3', dark: '#E04468' },
  success: { main: '#00E676' },
  warning: { main: '#FFD740' },
  error: { main: '#FF5252' },
  info: { main: '#40C4FF' },
  background: { default: '#0D1117', paper: '#161B22' },
  text: { primary: '#E6EDF3', secondary: '#8B949E' },
  divider: 'rgba(48, 54, 61, 0.8)',
};

const lightPalette = {
  mode: 'light' as const,
  primary: { main: '#5B54E0', light: '#7B75FF', dark: '#3F3AB5' },
  secondary: { main: '#E04468', light: '#FF6584', dark: '#B83050' },
  success: { main: '#00C853' },
  warning: { main: '#FFAB00' },
  error: { main: '#D32F2F' },
  info: { main: '#0288D1' },
  background: { default: '#F5F5F5', paper: '#FFFFFF' },
  text: { primary: '#1A1A2E', secondary: '#6B7280' },
  divider: 'rgba(0, 0, 0, 0.08)',
};

function buildTheme(mode: 'dark' | 'light') {
  const palette = mode === 'dark' ? darkPalette : lightPalette;
  const isDark = mode === 'dark';

  return createTheme({
    palette,
    typography: {
      fontFamily: '"Inter", "SF Pro Display", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      h6: { fontWeight: 600, letterSpacing: '0.02em' },
      subtitle2: { fontWeight: 600 },
    },
    shape: { borderRadius: 10 },
    components: {
      MuiAppBar: {
        styleOverrides: {
          root: {
            backgroundImage: isDark
              ? 'linear-gradient(135deg, #1a1f2e 0%, #0d1117 100%)'
              : 'linear-gradient(135deg, #ffffff 0%, #f5f5f5 100%)',
            borderBottom: isDark
              ? '1px solid rgba(99, 102, 241, 0.15)'
              : '1px solid rgba(0, 0, 0, 0.08)',
            boxShadow: isDark
              ? '0 1px 3px rgba(0,0,0,0.3)'
              : '0 1px 3px rgba(0,0,0,0.08)',
            color: isDark ? '#E6EDF3' : '#1A1A2E',
          },
        },
      },
      MuiDrawer: {
        styleOverrides: {
          paper: {
            backgroundColor: palette.background.default,
            borderRight: isDark
              ? '1px solid rgba(99, 102, 241, 0.1)'
              : '1px solid rgba(0, 0, 0, 0.08)',
          },
        },
      },
      MuiListItemButton: {
        styleOverrides: {
          root: {
            borderRadius: 8,
            mx: 1,
            mb: 0.25,
            '&.Mui-selected': {
              backgroundColor: isDark
                ? 'rgba(108, 99, 255, 0.12)'
                : 'rgba(91, 84, 224, 0.08)',
              '&:hover': {
                backgroundColor: isDark
                  ? 'rgba(108, 99, 255, 0.18)'
                  : 'rgba(91, 84, 224, 0.12)',
              },
            },
            '&:hover': {
              backgroundColor: isDark
                ? 'rgba(108, 99, 255, 0.08)'
                : 'rgba(91, 84, 224, 0.04)',
            },
          },
        },
      },
      MuiButton: {
        styleOverrides: {
          root: { textTransform: 'none', fontWeight: 500 },
        },
      },
      MuiChip: {
        styleOverrides: {
          root: { fontWeight: 500 },
        },
      },
      MuiFormLabel: {
        styleOverrides: {
          asterisk: { color: '#FF7B72', fontSize: '0.85em' },
        },
      },
      MuiPaper: {
        styleOverrides: {
          root: { backgroundImage: 'none' },
        },
      },
      MuiDialog: {
        styleOverrides: {
          paper: {
            backgroundColor: palette.background.paper,
            border: isDark
              ? '1px solid rgba(48,54,61,0.6)'
              : '1px solid rgba(0,0,0,0.12)',
          },
        },
      },
      MuiDivider: {
        styleOverrides: {
          root: {
            borderColor: palette.divider,
          },
        },
      },
    },
  });
}

function getSystemTheme(): 'dark' | 'light' {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

interface AppThemeProps {
  children: ReactNode;
}

export function AppTheme({ children }: AppThemeProps) {
  const themeMode = useSettingsStore((s) => s.settings.theme);
  const [systemDark, setSystemDark] = useState(getSystemTheme() === 'dark');

  useEffect(() => {
    if (themeMode !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [themeMode]);

  const resolvedMode = useMemo(() => {
    if (themeMode === 'system') return systemDark ? 'dark' : 'light';
    return themeMode;
  }, [themeMode, systemDark]);

  const theme = useMemo(() => buildTheme(resolvedMode), [resolvedMode]);

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline enableColorScheme />
      {children}
    </ThemeProvider>
  );
}

export { darkPalette, lightPalette };
