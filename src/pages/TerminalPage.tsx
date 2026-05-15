import { useState, useCallback, useEffect, useRef } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import {
  TerminalEmulator,
  TerminalToolbar,
  TerminalStatusBar,
  ConnectionPicker,
} from '../features/terminal';
import type { ConnectionPickerResult } from '../features/terminal';
import { TabBar } from '../features/session';
import { CommandPalette } from '../features/command';
import { spawnTerminal, killTerminal, writeToTerminal } from '../core/services/terminal.service';
import { parseCommand } from '../core/services/command.service';
import { generateId } from '../core/utils';
import type { PtyConfig } from '../proto';
import { openNotesReferenceWindow } from '../core/services/window.service';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { useSettingsStore } from '../engine';
import { useTranslation } from 'react-i18next';
import { TerminalIcon, Plus as PlusIcon } from '@phosphor-icons/react';

interface Tab {
  id: string;
  title: string;
  isActive: boolean;
  connectionType: 'local' | 'ssh';
}

export function TerminalPage() {
  const { t } = useTranslation('terminal');
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [confirmCloseId, setConfirmCloseId] = useState<string | null>(null);
  const tabsRef = useRef<Tab[]>([]);
  tabsRef.current = tabs;

  const shell = useSettingsStore((s) => s.settings.shell);
  const confirmBeforeClose = useSettingsStore((s) => s.settings.confirmBeforeClose);
  const terminalBackground = useSettingsStore((s) => s.settings.appearance.background);

  const handleNewTerminal = useCallback(() => {
    setPickerOpen(true);
  }, []);

  const handleConnect = useCallback((result: ConnectionPickerResult) => {
    const id = generateId();
    const count = tabs.length + 1;

    const config: PtyConfig = {
      rows: 24,
      cols: 80,
      shell,
      connection_type: result.connectionType,
      ssh: result.ssh,
    };

    const title =
      result.connectionType === 'ssh' && result.ssh
        ? `${result.ssh.username}@${result.ssh.host}`
        : `Terminal ${count}`;

    spawnTerminal(id, config).catch(console.error);

    setTabs((prev) => [
      ...prev.map((t) => ({ ...t, isActive: false })),
      { id, title, isActive: true, connectionType: result.connectionType },
    ]);
    setPickerOpen(false);
  }, [tabs.length, shell]);

  const handleCloseTab = useCallback(
    (id: string) => {
      if (confirmBeforeClose) {
        setConfirmCloseId(id);
        return;
      }
      killTerminal(id).catch(console.error);
      setTabs((prev) => {
        const filtered = prev.filter((t) => t.id !== id);
        if (prev.find((t) => t.id === id)?.isActive && filtered.length > 0) {
          filtered[filtered.length - 1].isActive = true;
        }
        return filtered;
      });
    },
    [confirmBeforeClose]
  );

  const handleConfirmClose = useCallback(() => {
    if (!confirmCloseId) return;
    killTerminal(confirmCloseId).catch(console.error);
    setTabs((prev) => {
      const filtered = prev.filter((t) => t.id !== confirmCloseId);
      if (prev.find((t) => t.id === confirmCloseId)?.isActive && filtered.length > 0) {
        filtered[filtered.length - 1].isActive = true;
      }
      return filtered;
    });
    setConfirmCloseId(null);
  }, [confirmCloseId]);

  const handleCancelClose = useCallback(() => {
    setConfirmCloseId(null);
  }, []);

  const handleSelectTab = useCallback((id: string) => {
    setTabs((prev) => prev.map((t) => ({ ...t, isActive: t.id === id })));
  }, []);

  const handleExit = useCallback(
    (sessionId: string) => {
      handleCloseTab(sessionId);
    },
    [handleCloseTab]
  );

  const handleCommandExecute = useCallback(
    (command: string) => {
      const activeTab = tabs.find((t) => t.isActive);
      if (activeTab) {
        const bytes = new TextEncoder().encode(command + '\n');
        writeToTerminal(activeTab.id, Array.from(bytes)).catch(console.error);
        parseCommand(command, activeTab.id).catch(() => {});
      }
      setPaletteOpen(false);
    },
    [tabs]
  );

  const handleOpenNotes = useCallback(() => {
    openNotesReferenceWindow().catch(console.error);
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;

      if (mod && e.shiftKey && e.key === 'p') {
        e.preventDefault();
        setPaletteOpen((prev) => !prev);
        return;
      }

      if (mod && e.key === 't') {
        e.preventDefault();
        handleNewTerminal();
        return;
      }

      if (mod && e.key === 'w') {
        e.preventDefault();
        const active = tabs.find((t) => t.isActive);
        if (active) handleCloseTab(active.id);
        return;
      }

      if (mod && e.key >= '1' && e.key <= '9') {
        e.preventDefault();
        const idx = parseInt(e.key) - 1;
        if (idx < tabs.length) {
          handleSelectTab(tabs[idx].id);
        }
        return;
      }

      if (mod && e.shiftKey && e.key === ']') {
        e.preventDefault();
        const activeIdx = tabs.findIndex((t) => t.isActive);
        const nextIdx = (activeIdx + 1) % tabs.length;
        handleSelectTab(tabs[nextIdx].id);
        return;
      }

      if (mod && e.shiftKey && e.key === '[') {
        e.preventDefault();
        const activeIdx = tabs.findIndex((t) => t.isActive);
        const prevIdx = (activeIdx - 1 + tabs.length) % tabs.length;
        handleSelectTab(tabs[prevIdx].id);
        return;
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [tabs, handleNewTerminal, handleCloseTab, handleSelectTab]);

  useEffect(() => {
    let unlisten: UnlistenFn | null = null;

    listen<{ command: string }>('execute-command', (event) => {
      const command = event.payload.command;
      if (!command) return;

      const activeTab = tabsRef.current.find((t) => t.isActive);
      if (activeTab) {
        const lines = command.split('\n').filter((l: string) => l.trim());
        for (const line of lines) {
          const bytes = new TextEncoder().encode(line + '\n');
          writeToTerminal(activeTab.id, Array.from(bytes)).catch(console.error);
          parseCommand(line, activeTab.id).catch(() => {});
        }
      }
    }).then((fn) => {
      unlisten = fn;
    }).catch(console.error);

    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  const activeTab = tabs.find((t) => t.isActive);

  if (tabs.length === 0) {
    return (
      <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        <Box
          sx={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            bgcolor: terminalBackground,
            gap: 3,
          }}
        >
          <Box
            sx={{
              width: 80,
              height: 80,
              borderRadius: 4,
              bgcolor: 'rgba(108,99,255,0.1)',
              border: '1px solid rgba(108,99,255,0.2)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <TerminalIcon size={40} color="#6C63FF" weight="duotone" />
          </Box>
          <Box sx={{ textAlign: 'center' }}>
            <Typography variant="h5" sx={{ fontWeight: 700, mb: 1 }}>
              {t('page.welcome')}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {t('page.welcome_desc')}
            </Typography>
          </Box>
          <Box
            onClick={handleNewTerminal}
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              px: 3,
              py: 1.5,
              borderRadius: 2,
              background: 'linear-gradient(135deg, #6C63FF 0%, #8B83FF 100%)',
              color: '#fff',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.2s',
              '&:hover': {
                transform: 'translateY(-2px)',
                boxShadow: '0 8px 25px rgba(108,99,255,0.3)',
              },
            }}
          >
            <PlusIcon size={18} weight="bold" />
            {t('page.new_terminal')}
          </Box>
          <Typography variant="caption" color="text.secondary" sx={{ mt: 1 }}>
            {t('page.shortcut_hint')}
          </Typography>
        </Box>

        <ConnectionPicker
          open={pickerOpen}
          onConnect={handleConnect}
          onClose={() => setPickerOpen(false)}
        />

        <Dialog open={!!confirmCloseId} onClose={handleCancelClose}>
          <DialogTitle>{t('page.close_terminal')}</DialogTitle>
          <DialogContent>
            <DialogContentText>
              {t('page.close_terminal_desc')}
            </DialogContentText>
          </DialogContent>
          <DialogActions>
            <Button onClick={handleCancelClose}>{t('common.cancel', { defaultValue: 'Cancel' })}</Button>
            <Button onClick={handleConfirmClose} color="error" variant="contained">
              {t('common.confirm', { defaultValue: 'Confirm' })}
            </Button>
          </DialogActions>
        </Dialog>
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <TerminalToolbar
        onNewTab={handleNewTerminal}
        onCloseTab={() => activeTab && handleCloseTab(activeTab.id)}
        onOpenNotes={handleOpenNotes}
      />
      <TabBar tabs={tabs} onSelect={handleSelectTab} onClose={handleCloseTab} />
      <Box sx={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        {tabs.map((tab) => (
          <Box
            key={tab.id}
            sx={{
              position: 'absolute',
              inset: 0,
              visibility: tab.isActive ? 'visible' : 'hidden',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <TerminalEmulator
              sessionId={tab.id}
              onExit={handleExit}
              visible={tab.isActive}
            />
          </Box>
        ))}
      </Box>
      <TerminalStatusBar
        sessionName={activeTab?.title}
        connected={!!activeTab}
      />
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onExecute={handleCommandExecute}
      />
      <ConnectionPicker
        open={pickerOpen}
        onConnect={handleConnect}
        onClose={() => setPickerOpen(false)}
      />

      <Dialog open={!!confirmCloseId} onClose={handleCancelClose}>
        <DialogTitle>{t('page.close_terminal')}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {t('page.close_terminal_desc')}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCancelClose}>{t('common.cancel', { defaultValue: 'Cancel' })}</Button>
          <Button onClick={handleConfirmClose} color="error" variant="contained">
            {t('page.close')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
