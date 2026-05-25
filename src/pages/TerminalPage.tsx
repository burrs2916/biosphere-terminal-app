import { useState, useCallback, useEffect, useRef } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import InputAdornment from '@mui/material/InputAdornment';
import IconButton from '@mui/material/IconButton';
import { useTheme } from '@mui/material/styles';
import {
  MagnifyingGlassIcon,
  ArrowUpIcon,
  ArrowDownIcon,
  XIcon,
  PlusIcon,
} from '@phosphor-icons/react';
import {
  TerminalEmulator,
  TerminalToolbar,
  TerminalStatusBar,
  ConnectionPicker,
  TerminalContextMenu,
} from '../features/terminal';
import type { TerminalEmulatorHandle, ConnectionPickerResult } from '../features/terminal';
import { TabBar } from '../features/session';
import { CommandPalette } from '../features/command';
import { spawnTerminal, killTerminal, writeToTerminal, getTerminalCwd } from '../core/services/terminal.service';
import { parseCommand } from '../core/services/command.service';
import { generateId } from '../core/utils';
import type { PtyConfig } from '../proto';
import { openNotesReferenceWindow, openAiCopilotWindow, openPluginWorkshopWindow } from '../core/services/window.service';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { useSettingsStore } from '../engine';
import { useTranslation } from 'react-i18next';

interface Tab {
  id: string;
  title: string;
  isActive: boolean;
  connectionType: 'local' | 'ssh';
  ssh?: { host: string; port: number; username: string; authMethod: string; privateKeyPath?: string };
  disconnected?: boolean;
  profileId?: string;
}

export function TerminalPage() {
  const { t } = useTranslation('terminal');
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [confirmCloseId, setConfirmCloseId] = useState<string | null>(null);
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const [findRegex, setFindRegex] = useState(false);
  const [findWholeWord, setFindWholeWord] = useState(false);
  const [findCaseSensitive, setFindCaseSensitive] = useState(false);
  const [findResultCount, setFindResultCount] = useState<{ resultIndex: number; resultCount: number } | null>(null);
  const [contextMenu, setContextMenu] = useState<{ mouseX: number; mouseY: number; hasSelection: boolean } | null>(null);
  const [activeCwd, setActiveCwd] = useState<string | null>(null);
  const tabsRef = useRef<Tab[]>([]);
  const terminalRefs = useRef<Map<string, TerminalEmulatorHandle>>(new Map());
  tabsRef.current = tabs;

  const shell = useSettingsStore((s) => s.settings.shell);
  const confirmBeforeClose = useSettingsStore((s) => s.settings.confirmBeforeClose);

  useEffect(() => {
    const activeTab = tabsRef.current.find((t) => t.isActive);
    if (!activeTab) {
      setActiveCwd(null);
      return;
    }
    const interval = setInterval(() => {
      getTerminalCwd(activeTab.id).then((cwd) => {
        if (cwd) setActiveCwd(cwd);
      }).catch(() => {});
    }, 5000);
    getTerminalCwd(activeTab.id).then((cwd) => {
      if (cwd) setActiveCwd(cwd);
    }).catch(() => {});
    return () => clearInterval(interval);
  }, [tabs]);

  const getActiveTerminal = useCallback((): TerminalEmulatorHandle | undefined => {
    const activeTab = tabsRef.current.find((t) => t.isActive);
    if (!activeTab) return undefined;
    return terminalRefs.current.get(activeTab.id);
  }, []);

  const handleNewTerminal = useCallback(() => {
    setPickerOpen(true);
  }, []);

  const estimateTerminalSize = useCallback(() => {
    const activeTabEl = document.querySelector('[data-terminal-container] > div[style*="visible"]');
    if (activeTabEl) {
      const rect = activeTabEl.getBoundingClientRect();
      const fontSize = useSettingsStore.getState().settings.appearance.fontSize;
      const lineHeight = useSettingsStore.getState().settings.appearance.lineHeight;
      const cellHeight = fontSize * lineHeight;
      const cellWidth = fontSize * 0.6;
      if (rect.width > 0 && rect.height > 0 && cellHeight > 0 && cellWidth > 0) {
        return {
          cols: Math.max(10, Math.floor((rect.width - 16) / cellWidth)),
          rows: Math.max(5, Math.floor((rect.height - 16) / cellHeight)),
        };
      }
    }
    return { rows: 24, cols: 80 };
  }, []);

  const handleConnect = useCallback((result: ConnectionPickerResult) => {
    const id = generateId();
    const count = tabs.length + 1;
    const size = estimateTerminalSize();

    const config: PtyConfig = {
      rows: size.rows,
      cols: size.cols,
      shell,
      cwd: result.connectionType === 'local' ? activeCwd ?? undefined : undefined,
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
      {
        id,
        title,
        isActive: true,
        connectionType: result.connectionType,
        ssh: result.ssh ? {
          host: result.ssh.host,
          port: result.ssh.port,
          username: result.ssh.username,
          authMethod: result.ssh.auth_method,
          privateKeyPath: result.ssh.private_key_path,
        } : undefined,
      },
    ]);
    setPickerOpen(false);
  }, [tabs.length, shell, activeCwd, estimateTerminalSize]);

  const handleCloseTab = useCallback(
    (id: string) => {
      if (confirmBeforeClose) {
        setConfirmCloseId(id);
        return;
      }
      killTerminal(id).catch(console.error);
      terminalRefs.current.delete(id);
      setTabs((prev) => {
        const filtered = prev.filter((t) => t.id !== id);
        if (prev.find((t) => t.id === id)?.isActive && filtered.length > 0) {
          filtered[filtered.length - 1].isActive = true;
        }
        return filtered;
      });
    },
    [confirmBeforeClose],
  );

  const handleConfirmClose = useCallback(() => {
    if (!confirmCloseId) return;
    killTerminal(confirmCloseId).catch(console.error);
    terminalRefs.current.delete(confirmCloseId);
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
      const tab = tabsRef.current.find((t) => t.id === sessionId);
      if (tab?.connectionType === 'ssh') {
        setTabs((prev) =>
          prev.map((t) => (t.id === sessionId ? { ...t, disconnected: true } : t)),
        );
      } else {
        handleCloseTab(sessionId);
      }
    },
    [handleCloseTab],
  );

  const handleReconnect = useCallback(
    (tab: Tab) => {
      if (!tab.ssh) return;
      killTerminal(tab.id).catch(() => {});
      terminalRefs.current.delete(tab.id);
      const newId = generateId();
      const size = estimateTerminalSize();
      const config: PtyConfig = {
        rows: size.rows,
        cols: size.cols,
        shell,
        connection_type: 'ssh',
        ssh: {
          host: tab.ssh.host,
          port: tab.ssh.port,
          username: tab.ssh.username,
          auth_method: tab.ssh.authMethod as 'none' | 'password' | 'private_key',
          private_key_path: tab.ssh.privateKeyPath,
        },
      };
      spawnTerminal(newId, config).catch(console.error);
      setTabs((prev) =>
        prev.map((t) => (t.id === tab.id ? { ...t, id: newId, disconnected: false } : t)),
      );
    },
    [shell, estimateTerminalSize],
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
    [tabs],
  );

  const handleOpenNotes = useCallback(() => {
    openNotesReferenceWindow().catch(console.error);
  }, []);

  const handleOpenAiCopilot = useCallback(() => {
    openAiCopilotWindow().catch(console.error);
  }, []);

  const handleOpenWorkshop = useCallback(() => {
    openPluginWorkshopWindow().catch(console.error);
  }, []);

  const handleClearBuffer = useCallback(() => {
    getActiveTerminal()?.clearBuffer();
  }, [getActiveTerminal]);

  const handleTitleChange = useCallback((sessionId: string, title: string) => {
    setTabs((prev) =>
      prev.map((t) => (t.id === sessionId ? { ...t, title } : t)),
    );
  }, []);

  const handleCopy = useCallback(() => {
    const terminal = getActiveTerminal();
    if (!terminal) return;
    const selection = terminal.getSelection();
    if (selection) {
      navigator.clipboard.writeText(selection).catch(() => {});
    }
  }, [getActiveTerminal]);

  const handlePaste = useCallback(() => {
    const terminal = getActiveTerminal();
    if (!terminal) return;
    navigator.clipboard.readText().then((text) => {
      if (text) terminal.paste(text);
    }).catch(() => {});
  }, [getActiveTerminal]);

  const handleFind = useCallback(() => {
    setFindOpen((prev) => !prev);
    setFindQuery('');
  }, []);

  const handleSelectAll = useCallback(() => {
    getActiveTerminal()?.selectAll();
  }, [getActiveTerminal]);

  const handleScrollToBottom = useCallback(() => {
    getActiveTerminal()?.scrollToBottom();
  }, [getActiveTerminal]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const terminal = getActiveTerminal();
    setContextMenu({
      mouseX: e.clientX,
      mouseY: e.clientY,
      hasSelection: terminal?.hasSelection() ?? false,
    });
  }, [getActiveTerminal]);

  const getFindOptions = useCallback(() => ({
    regex: findRegex,
    wholeWord: findWholeWord,
    caseSensitive: findCaseSensitive,
  }), [findRegex, findWholeWord, findCaseSensitive]);

  const handleFindNext = useCallback(() => {
    if (findQuery) getActiveTerminal()?.findNext(findQuery, getFindOptions());
  }, [findQuery, getFindOptions, getActiveTerminal]);

  const handleFindPrevious = useCallback(() => {
    if (findQuery) getActiveTerminal()?.findPrevious(findQuery, getFindOptions());
  }, [findQuery, getFindOptions, getActiveTerminal]);

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

      if (mod && e.key === 'f') {
        e.preventDefault();
        handleFind();
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
  }, [tabs, handleNewTerminal, handleCloseTab, handleSelectTab, handleFind]);

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
            position: 'relative',
            overflow: 'hidden',
            bgcolor: 'background.default',
            '&::before': {
              content: '""',
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: isDark
                ? 'radial-gradient(circle at 50% 30%, rgba(108,99,255,0.06) 0%, transparent 60%)'
                : 'radial-gradient(circle at 50% 30%, rgba(91,84,224,0.04) 0%, transparent 60%)',
            },
          }}
        >
          <Box
            sx={{
              position: 'relative',
              zIndex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 4,
              px: 3,
            }}
          >
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 80,
                height: 80,
                borderRadius: '50%',
                background: isDark
                  ? 'rgba(108,99,255,0.08)'
                  : 'rgba(91,84,224,0.05)',
                border: '1px solid',
                borderColor: isDark ? 'rgba(108,99,255,0.15)' : 'rgba(91,84,224,0.1)',
              }}
            >
              <Typography
                sx={{
                  fontFamily: '"Fira Code", "JetBrains Mono", "Cascadia Code", ui-monospace, monospace',
                  fontSize: '2.5rem',
                  fontWeight: 700,
                  lineHeight: 1,
                  background: isDark
                    ? 'linear-gradient(135deg, #6C63FF, #4FC3F7)'
                    : 'linear-gradient(135deg, #5B54E0, #1565C0)',
                  backgroundClip: 'text',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  filter: isDark
                    ? 'drop-shadow(0 0 12px rgba(108,99,255,0.4))'
                    : 'drop-shadow(0 0 8px rgba(91,84,224,0.3))',
                }}
              >
                {`>_`}
              </Typography>
            </Box>

            <Box sx={{ textAlign: 'center', maxWidth: 500 }}>
              <Typography
                variant="h4"
                sx={{
                  fontWeight: 700,
                  mb: 2,
                  background: isDark
                    ? 'linear-gradient(135deg, #6C63FF 0%, #8B83FF 50%, #4FC3F7 100%)'
                    : 'linear-gradient(135deg, #5B54E0 0%, #7B75FF 50%, #1565C0 100%)',
                  backgroundClip: 'text',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                }}
              >
                {t('page.welcome')}
              </Typography>
              <Typography
                variant="body1"
                color="text.secondary"
                sx={{
                  lineHeight: 1.8,
                  fontSize: '1.1rem',
                }}
              >
                {t('page.welcome_desc')}
              </Typography>
            </Box>

            <Box
              onClick={handleNewTerminal}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1.5,
                px: 4,
                py: 2,
                borderRadius: 3,
                background: isDark
                  ? 'linear-gradient(135deg, #6C63FF 0%, #8B83FF 100%)'
                  : 'linear-gradient(135deg, #5B54E0 0%, #7B75FF 100%)',
                color: '#fff',
                fontWeight: 600,
                fontSize: '1.1rem',
                cursor: 'pointer',
                transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                boxShadow: isDark
                  ? '0 4px 20px rgba(108,99,255,0.3)'
                  : '0 4px 20px rgba(91,84,224,0.25)',
                '&:hover': {
                  transform: 'translateY(-3px) scale(1.02)',
                  boxShadow: isDark
                    ? '0 12px 40px rgba(108,99,255,0.4)'
                    : '0 12px 40px rgba(91,84,224,0.35)',
                },
                '&:active': {
                  transform: 'translateY(-1px) scale(0.98)',
                },
              }}
            >
              <PlusIcon size={20} weight="bold" />
              {t('page.new_terminal')}
            </Box>

            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                px: 2,
                py: 1,
                borderRadius: 2,
                bgcolor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
                border: '1px solid',
                borderColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
              }}
            >
              <Typography variant="caption" color="text.secondary">
                {t('page.shortcut_hint')}
              </Typography>
            </Box>
          </Box>
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
        onOpenAiCopilot={handleOpenAiCopilot}
        onOpenWorkshop={handleOpenWorkshop}
        onClearBuffer={handleClearBuffer}
        onCopy={handleCopy}
        onPaste={handlePaste}
        onFind={handleFind}
      />
      <TabBar tabs={tabs} onSelect={handleSelectTab} onClose={handleCloseTab} />

      {findOpen && (
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            px: 2,
            py: 0.5,
            borderBottom: '1px solid',
            borderColor: 'divider',
            bgcolor: isDark ? '#1C2128' : '#fafafa',
          }}
        >
          <TextField
            autoFocus
            size="small"
            placeholder={t('find') + '...'}
            value={findQuery}
            onChange={(e) => {
              const q = e.target.value;
              setFindQuery(q);
              if (q) {
                getActiveTerminal()?.findNext(q, getFindOptions());
              } else {
                getActiveTerminal()?.clearSearchDecorations();
                setFindResultCount(null);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                if (e.shiftKey) handleFindPrevious();
                else handleFindNext();
              } else if (e.key === 'Escape') {
                getActiveTerminal()?.clearSearchDecorations();
                setFindOpen(false);
                setFindQuery('');
                setFindResultCount(null);
              }
            }}
            variant="standard"
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <MagnifyingGlassIcon size={16} color={isDark ? '#8B949E' : '#6B7280'} />
                  </InputAdornment>
                ),
                sx: { fontSize: '0.85rem' },
              },
            }}
            sx={{ flex: 1, maxWidth: 300 }}
          />
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <IconButton
              size="small"
              onClick={() => setFindCaseSensitive((v) => !v)}
              sx={{
                bgcolor: findCaseSensitive ? 'rgba(108,99,255,0.15)' : 'transparent',
                borderRadius: 1,
                fontSize: '0.7rem',
                fontWeight: 600,
                width: 28,
                height: 28,
              }}
            >
              <Typography variant="caption" sx={{ fontSize: '0.7rem', fontWeight: 700 }}>Aa</Typography>
            </IconButton>
            <IconButton
              size="small"
              onClick={() => setFindWholeWord((v) => !v)}
              sx={{
                bgcolor: findWholeWord ? 'rgba(108,99,255,0.15)' : 'transparent',
                borderRadius: 1,
                width: 28,
                height: 28,
              }}
            >
              <Typography variant="caption" sx={{ fontSize: '0.7rem', fontWeight: 700 }}>W</Typography>
            </IconButton>
            <IconButton
              size="small"
              onClick={() => setFindRegex((v) => !v)}
              sx={{
                bgcolor: findRegex ? 'rgba(108,99,255,0.15)' : 'transparent',
                borderRadius: 1,
                width: 28,
                height: 28,
              }}
            >
              <Typography variant="caption" sx={{ fontSize: '0.7rem', fontWeight: 700 }}>.*</Typography>
            </IconButton>
          </Box>
          {findResultCount != null && findQuery && (
            <Typography variant="caption" sx={{ color: 'text.secondary', minWidth: 40, textAlign: 'center' }}>
              {findResultCount.resultCount === 0
                ? t('find_no_results')
                : t('find_results', { current: findResultCount.resultIndex + 1, total: findResultCount.resultCount })}
            </Typography>
          )}
          <Box sx={{ display: 'flex', alignItems: 'center' }}>
            <IconButton size="small" onClick={handleFindPrevious}>
              <ArrowUpIcon size={14} />
            </IconButton>
            <IconButton size="small" onClick={handleFindNext}>
              <ArrowDownIcon size={14} />
            </IconButton>
          </Box>
          <IconButton size="small" onClick={() => {
            getActiveTerminal()?.clearSearchDecorations();
            setFindOpen(false);
            setFindQuery('');
            setFindResultCount(null);
          }}>
            <XIcon size={14} />
          </IconButton>
        </Box>
      )}

      <Box sx={{ flex: 1, overflow: 'hidden', position: 'relative' }} data-terminal-container onContextMenu={handleContextMenu}>
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
              ref={(handle) => {
                if (handle) terminalRefs.current.set(tab.id, handle);
                else terminalRefs.current.delete(tab.id);
              }}
              sessionId={tab.id}
              onExit={handleExit}
              onTitleChange={handleTitleChange}
              onFindResultsChange={(resultIndex, resultCount) => {
                setFindResultCount({ resultIndex, resultCount });
              }}
              visible={tab.isActive}
              profileId={tab.profileId}
            />
            {tab.disconnected && (
              <Box
                sx={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  bgcolor: isDark ? 'rgba(13,17,23,0.85)' : 'rgba(255,255,255,0.85)',
                  zIndex: 10,
                  gap: 2,
                }}
              >
                <Typography variant="body1" sx={{ color: 'text.secondary' }}>
                  {t('disconnected')}
                </Typography>
                <Button
                  variant="contained"
                  size="small"
                  onClick={() => handleReconnect(tab)}
                >
                  {t('reconnect')}
                </Button>
              </Box>
            )}
          </Box>
        ))}
      </Box>
      <TerminalStatusBar
        sessionName={activeTab?.title}
        connected={!!activeTab && !activeTab.disconnected}
        cwd={activeCwd ?? undefined}
      />
      <TerminalContextMenu
        menuState={contextMenu}
        onClose={() => setContextMenu(null)}
        onCopy={handleCopy}
        onPaste={handlePaste}
        onSelectAll={handleSelectAll}
        onClearBuffer={handleClearBuffer}
        onFind={handleFind}
        onScrollToBottom={handleScrollToBottom}
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
