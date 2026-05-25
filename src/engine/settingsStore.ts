import { create } from 'zustand';
import type { AppearanceConfig } from '../proto';

export type ThemeMode = 'dark' | 'light' | 'system';
export type BellStyle = 'none' | 'visual' | 'sound';
export type CursorStyle = 'block' | 'underline' | 'bar';

export interface AppSettings {
  theme: ThemeMode;
  language: 'zh-CN' | 'en-US';
  showStatusBar: boolean;
  confirmBeforeClose: boolean;

  appearance: AppearanceConfig;
  bellStyle: BellStyle;
  webglRenderer: boolean;
  scrollback: number;
  copyOnSelect: boolean;
  pasteOnMiddleClick: boolean;
  shell: string;
}

export const DARK_APPEARANCE: AppearanceConfig = {
  fontFamily: '"JetBrains Mono", "Fira Code", Menlo, Monaco, monospace',
  fontSize: 14,
  lineHeight: 1.2,
  cursorStyle: 'block',
  cursorBlink: true,
  cursorColor: '#6C63FF',
  foreground: '#E6EDF3',
  background: '#0D1117',
  selectionForeground: '#E6EDF3',
  selectionBackground: 'rgba(108, 99, 255, 0.3)',
  colors: [
    '#0D1117', '#FF7B72', '#00E676', '#FFD740',
    '#4FC3F7', '#CE93D8', '#4DD0E1', '#E6EDF3',
    '#8B949E', '#FF8A80', '#69F0AE', '#FFE57F',
    '#80D8FF', '#EA80FC', '#84FFFF', '#FFFFFF',
  ],
};

export const LIGHT_APPEARANCE: AppearanceConfig = {
  fontFamily: '"JetBrains Mono", "Fira Code", Menlo, Monaco, monospace',
  fontSize: 14,
  lineHeight: 1.2,
  cursorStyle: 'block',
  cursorBlink: true,
  cursorColor: '#5B54E0',
  foreground: '#1A1A2E',
  background: '#FFFFFF',
  selectionForeground: '#FFFFFF',
  selectionBackground: 'rgba(91, 84, 224, 0.25)',
  colors: [
    '#1A1A2E', '#D32F2F', '#2E7D32', '#E65100',
    '#1565C0', '#7B1FA2', '#00838F', '#424242',
    '#9E9E9E', '#EF5350', '#66BB6A', '#FFA726',
    '#42A5F5', '#AB47BC', '#26C6DA', '#FAFAFA',
  ],
};

export const DEFAULT_APPEARANCE = DARK_APPEARANCE;

const DEFAULT_SETTINGS: AppSettings = {
  theme: 'dark',
  language: 'zh-CN',
  showStatusBar: true,
  confirmBeforeClose: true,
  appearance: DEFAULT_APPEARANCE,
  bellStyle: 'none',
  webglRenderer: true,
  scrollback: 10000,
  copyOnSelect: true,
  pasteOnMiddleClick: true,
  shell: '/bin/zsh',
};

const STORAGE_KEY = 'biosphere-settings';

function loadFromStorage(): AppSettings {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return {
        ...DEFAULT_SETTINGS,
        ...parsed,
        appearance: { ...DEFAULT_APPEARANCE, ...parsed.appearance },
      };
    }
  } catch {}
  return DEFAULT_SETTINGS;
}

function saveToStorage(settings: AppSettings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export function getThemeAppearance(theme: ThemeMode): AppearanceConfig {
  if (theme === 'light') return LIGHT_APPEARANCE;
  if (theme === 'dark') return DARK_APPEARANCE;
  const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  return isDark ? DARK_APPEARANCE : LIGHT_APPEARANCE;
}

interface SettingsState {
  settings: AppSettings;
  initialized: boolean;
  init: () => void;
  update: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
  updateAppearance: <K extends keyof AppearanceConfig>(key: K, value: AppearanceConfig[K]) => void;
  reset: () => void;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  initialized: false,

  init: () => {
    if (get().initialized) return;
    const loaded = loadFromStorage();
    set({ settings: loaded, initialized: true });
  },

  update: (key, value) => {
    const next = { ...get().settings, [key]: value };
    saveToStorage(next);
    set({ settings: next });
  },

  updateAppearance: (key, value) => {
    const next = {
      ...get().settings,
      appearance: { ...get().settings.appearance, [key]: value },
    };
    saveToStorage(next);
    set({ settings: next });
  },

  reset: () => {
    saveToStorage(DEFAULT_SETTINGS);
    set({ settings: DEFAULT_SETTINGS });
  },
}));
