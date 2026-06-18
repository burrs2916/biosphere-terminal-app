import { useEffect, useRef, useCallback, useState, forwardRef, useImperativeHandle } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { SearchAddon } from '@xterm/addon-search';
import { WebglAddon } from '@xterm/addon-webgl';
import { listen, type UnlistenFn, emit } from '@tauri-apps/api/event';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { openUrl } from '@tauri-apps/plugin-opener';
import { writeToTerminal, resizeTerminal } from '../../../core/services/terminal.service';
import { parseCommand, recordExitCode } from '../../../core/services/command.service';
import { getDefaultProfile } from '../../../core/services/profile.service';
import { useSettingsStore, getThemeAppearance } from '../../../engine';
import { useNotify } from '../../../core/notification';
import { useTranslation } from 'react-i18next';
import type { AppearanceConfig } from '../../../proto';
import '@xterm/xterm/css/xterm.css';
import Box from '@mui/material/Box';

export interface TerminalEmulatorHandle {
  findNext: (query: string, options?: { regex?: boolean; wholeWord?: boolean; caseSensitive?: boolean }) => void;
  findPrevious: (query: string, options?: { regex?: boolean; wholeWord?: boolean; caseSensitive?: boolean }) => void;
  clearBuffer: () => void;
  focus: () => void;
  getSelection: () => string;
  paste: (text: string) => void;
  selectAll: () => void;
  scrollToBottom: () => void;
  clearSearchDecorations: () => void;
  hasSelection: () => boolean;
}

interface TerminalEmulatorProps {
  sessionId: string;
  onExit?: (sessionId: string) => void;
  onTitleChange?: (sessionId: string, title: string) => void;
  onFindResultsChange?: (resultIndex: number, resultCount: number) => void;
  visible?: boolean;
  profileId?: string;
}

function buildTheme(appearance: ReturnType<typeof getThemeAppearance>) {
  return {
    background: appearance.background,
    foreground: appearance.foreground,
    cursor: appearance.cursorColor,
    cursorAccent: appearance.background,
    selectionBackground: appearance.selectionBackground,
    selectionForeground: appearance.selectionForeground,
    black: appearance.colors[0] || '#0D1117',
    red: appearance.colors[1] || '#FF7B72',
    green: appearance.colors[2] || '#00E676',
    yellow: appearance.colors[3] || '#FFD740',
    blue: appearance.colors[4] || '#4FC3F7',
    magenta: appearance.colors[5] || '#CE93D8',
    cyan: appearance.colors[6] || '#4DD0E1',
    white: appearance.colors[7] || '#E6EDF3',
    brightBlack: appearance.colors[8] || '#8B949E',
    brightRed: appearance.colors[9] || '#FF8A80',
    brightGreen: appearance.colors[10] || '#69F0AE',
    brightYellow: appearance.colors[11] || '#FFE57F',
    brightBlue: appearance.colors[12] || '#80D8FF',
    brightMagenta: appearance.colors[13] || '#EA80FC',
    brightCyan: appearance.colors[14] || '#84FFFF',
    brightWhite: appearance.colors[15] || '#FFFFFF',
  };
}

export const TerminalEmulator = forwardRef<TerminalEmulatorHandle, TerminalEmulatorProps>(
  function TerminalEmulator({ sessionId, onExit, onTitleChange, onFindResultsChange, visible = true, profileId }, ref) {
    const { t } = useTranslation('terminal');
    const containerRef = useRef<HTMLDivElement>(null);
    const terminalRef = useRef<Terminal | null>(null);
    const fitAddonRef = useRef<FitAddon | null>(null);
    const searchAddonRef = useRef<SearchAddon | null>(null);
    const unlistenersRef = useRef<UnlistenFn[]>([]);
    const lineBufferRef = useRef('');
    const lastEntryIdRef = useRef<string | null>(null);
    const lastCommandRef = useRef<string | null>(null);
    const textEncoderRef = useRef(new TextEncoder());
    const resizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const selectionChangeOffRef = useRef<import('@xterm/xterm').IDisposable | null>(null);
    const middleClickHandlerRef = useRef<((e: MouseEvent) => void) | null>(null);
    const dragDropUnlistenRef = useRef<UnlistenFn | null>(null);
    const resizeOffRef = useRef<import('@xterm/xterm').IDisposable | null>(null);
    const [terminalReady, setTerminalReady] = useState(false);
    const [profileAppearance, setProfileAppearance] = useState<AppearanceConfig | null>(null);

    const themeMode = useSettingsStore((s) => s.settings.theme);
    const scrollback = useSettingsStore((s) => s.settings.scrollback);
    const copyOnSelect = useSettingsStore((s) => s.settings.copyOnSelect);
    const pasteOnMiddleClick = useSettingsStore((s) => s.settings.pasteOnMiddleClick);
    const webglRenderer = useSettingsStore((s) => s.settings.webglRenderer);
    const notify = useNotify().notify;

    useEffect(() => {
      if (profileId) {
        import('../../../core/services/profile.service').then(({ listProfiles }) => {
          listProfiles().then((profiles) => {
            const profile = profiles.find((p) => p.id === profileId);
            if (profile) {
              try {
                setProfileAppearance(JSON.parse(profile.config_json));
              } catch (err) {
                console.error('TerminalEmulator: JSON.parse profile config from listProfiles', err);
              }
            }
          }).catch((e) => notify(String(e)));
        }).catch((e) => notify(String(e)));
      } else {
          getDefaultProfile().then((profile) => {
          if (profile) {
            try {
              setProfileAppearance(JSON.parse(profile.config_json));
            } catch (err) {
              console.error('TerminalEmulator: JSON.parse default profile config', err);
            }
          }
        }).catch((e) => notify(String(e)));
      }
    }, [profileId]);

    const baseAppearance = getThemeAppearance(themeMode);
    const appearance = profileAppearance
      ? {
          ...baseAppearance,
          ...profileAppearance,
          colors: baseAppearance.colors,
          selectionBackground: baseAppearance.selectionBackground,
          selectionForeground: baseAppearance.selectionForeground,
          cursorColor: baseAppearance.cursorColor,
        }
      : baseAppearance;

    useImperativeHandle(ref, () => ({
      findNext: (query: string, options?: { regex?: boolean; wholeWord?: boolean; caseSensitive?: boolean }) => {
        searchAddonRef.current?.findNext(query, options);
      },
      findPrevious: (query: string, options?: { regex?: boolean; wholeWord?: boolean; caseSensitive?: boolean }) => {
        searchAddonRef.current?.findPrevious(query, options);
      },
      clearBuffer: () => {
        terminalRef.current?.clear();
      },
      focus: () => {
        terminalRef.current?.focus();
      },
      getSelection: () => {
        return terminalRef.current?.getSelection() ?? '';
      },
      paste: (text: string) => {
        terminalRef.current?.paste(text);
      },
      selectAll: () => {
        terminalRef.current?.selectAll();
      },
      scrollToBottom: () => {
        terminalRef.current?.scrollToBottom();
      },
      clearSearchDecorations: () => {
        searchAddonRef.current?.clearDecorations();
      },
      hasSelection: () => {
        return terminalRef.current?.hasSelection() ?? false;
      },
    }), []);

    const handleResize = useCallback(() => {
      if (resizeTimerRef.current) {
        clearTimeout(resizeTimerRef.current);
      }
      resizeTimerRef.current = setTimeout(() => {
        if (isDisposedRef.current) return;
        const term = terminalRef.current;
        const fit = fitAddonRef.current;
        const container = containerRef.current;
        if (!fit || !term || !container) return;
        if (terminalRef.current !== term) return;
        if (!term.element) return;
        if (!visible) return;
        // Cross-platform safety: ensure renderer is ready before fit() to prevent
        // 'this._renderer.value.dimensions' undefined errors on Windows/Linux/macOS
        const internal = term as any;
        const rendererReady = !!(
          internal._renderer?.value?.dimensions ||
          internal._core?._renderService?._renderer?.value?.dimensions ||
          internal._core?.viewport
        );
        if (!rendererReady) return;
        const rect = container.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;
        try {
          fit.fit();
          term.focus();
        } catch (err) {
          console.warn('TerminalEmulator: fit() during resize failed', err);
        }
      }, 100);
    }, [visible]);

    const isDisposedRef = useRef(false);

    useEffect(() => {
      if (!containerRef.current) return;

      const terminal = new Terminal({
        cursorBlink: appearance.cursorBlink,
        cursorStyle: appearance.cursorStyle,
        fontSize: appearance.fontSize,
        fontFamily: appearance.fontFamily,
        lineHeight: appearance.lineHeight,
        scrollback,
        allowTransparency: true,
        theme: buildTheme(appearance),
      });

      const fitAddon = new FitAddon();
      const webLinksAddon = new WebLinksAddon((_event: MouseEvent, uri: string) => {
        openUrl(uri).catch((err) => {
          console.error('TerminalEmulator: openUrl failed', err);
          window.open(uri, '_blank');
        });
      });
      const searchAddon = new SearchAddon();

      searchAddon.onDidChangeResults(({ resultIndex, resultCount }) => {
        onFindResultsChange?.(resultIndex, resultCount);
      });

      terminal.loadAddon(fitAddon);
      terminal.loadAddon(webLinksAddon);
      terminal.loadAddon(searchAddon);

      // CRITICAL: open() must be called BEFORE loading WebglAddon (xterm.js requirement)
      terminal.open(containerRef.current);

      // Try WebGL renderer with fallback to canvas (default)
      // WebGL may fail on Linux (no GPU/driver issues) or virtualized environments
      if (webglRenderer) {
        try {
          const webglAddon = new WebglAddon();
          webglAddon.onContextLoss(() => {
            try { webglAddon.dispose(); } catch { /* noop */ }
          });
          terminal.loadAddon(webglAddon);
        } catch (err) {
          console.warn('TerminalEmulator: WebGL renderer unavailable, falling back to canvas', err);
        }
      }

      terminal.onBell(() => {
        const currentBellStyle = useSettingsStore.getState().settings.bellStyle;
        if (currentBellStyle === 'visual') {
          if (!containerRef.current) return;
          containerRef.current.style.outline = '2px solid rgba(108,99,255,0.6)';
          containerRef.current.style.outlineOffset = '-2px';
          setTimeout(() => {
            if (containerRef.current) {
              containerRef.current.style.outline = 'none';
            }
          }, 200);
        } else if (currentBellStyle === 'sound') {
          try {
            const ctx = new AudioContext();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.frequency.value = 800;
            gain.gain.value = 0.1;
            osc.start();
            osc.stop(ctx.currentTime + 0.1);
          } catch (err) {
            console.error('TerminalEmulator: AudioContext bell sound', err);
          }
        }
      });

      terminal.attachCustomKeyEventHandler((e: KeyboardEvent) => {
        if (e.type !== 'keydown') return false;
        const mod = e.ctrlKey || e.metaKey;
        if (mod && e.shiftKey && (e.key === 'C' || e.key === 'c')) {
          const selection = terminal.getSelection();
          if (selection) {
            navigator.clipboard.writeText(selection).catch((e) => notify(String(e)));
          }
          return false;
        }
        if (mod && e.shiftKey && (e.key === 'V' || e.key === 'v')) {
          navigator.clipboard.readText().then((text) => {
            if (text) terminal.paste(text);
          }).catch((e) => notify(String(e)));
          return false;
        }
        return true;
      });

      // Wait for renderer to be ready before fitting
      // Cross-platform compatibility: xterm.js renderer (canvas/WebGL/DOM) initializes asynchronously
      // On Windows/Linux/macOS, the timing varies based on GPU drivers and WebView2/WebKit versions
      let attempts = 0;
      const MAX_ATTEMPTS = 120; // ~2 seconds at 60fps, sufficient for slow renderer init
      const tryFit = () => {
        if (isDisposedRef.current) return;
        attempts++;
        if (!fitAddonRef.current || !containerRef.current || !terminalRef.current || !terminalRef.current.element) {
          if (attempts < MAX_ATTEMPTS) requestAnimationFrame(tryFit);
          return;
        }
        // Check if any renderer is initialized: WebGL, canvas, or DOM
        // _renderer is the internal renderer service; .value is the active backend
        const term = terminalRef.current as any;
        const rendererReady = !!(
          term._renderer?.value?.dimensions ||
          term._core?._renderService?._renderer?.value?.dimensions ||
          term._core?.viewport
        );
        if (!rendererReady && attempts < MAX_ATTEMPTS) {
          requestAnimationFrame(tryFit);
          return;
        }
        const rect = containerRef.current.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          try {
            fitAddonRef.current.fit();
            const cols = terminalRef.current.cols;
            const rows = terminalRef.current.rows;
            resizeTerminal(sessionId, rows, cols).catch((e) => notify(String(e)));
          } catch (err) {
            console.warn('TerminalEmulator: initial fit() failed, will retry on resize', err);
          }
        }
        setTerminalReady(true);
      };
      // Start checking after a short delay to allow renderer to mount
      setTimeout(() => requestAnimationFrame(tryFit), 16);

      if (copyOnSelect) {
        selectionChangeOffRef.current = terminal.onSelectionChange(() => {
          const selection = terminal.getSelection();
          if (selection) {
            navigator.clipboard.writeText(selection).catch((e) => notify(String(e)));
          }
        });
      }

      if (pasteOnMiddleClick) {
        const handler = (e: MouseEvent) => {
          if (e.button === 1) {
            e.preventDefault();
            navigator.clipboard.readText().then((text) => {
              if (text) {
                terminal.paste(text);
              }
            }).catch((e) => notify(String(e)));
          }
        };
        containerRef.current.addEventListener('mousedown', handler);
        middleClickHandlerRef.current = handler;
      }

      getCurrentWebviewWindow().onDragDropEvent((event) => {
        if (event.payload.type === 'drop') {
          const paths = event.payload.paths;
          if (paths && paths.length > 0) {
            const formatted = paths.map((p: string) =>
              p.includes(' ') ? `'${p}'` : p
            );
            terminal.paste(formatted.join(' '));
          }
        }
      }).then((unlisten) => {
        dragDropUnlistenRef.current = unlisten;
      }).catch((e) => notify(String(e)));

      terminal.onData((data) => {
        const bytes = textEncoderRef.current.encode(data);
        writeToTerminal(sessionId, Array.from(bytes)).catch((e) => notify(String(e)));

        if (data === '\r') {
          const cmd = lineBufferRef.current.trim();
          if (cmd) {
            lastCommandRef.current = cmd;
            parseCommand(cmd, sessionId).then((result) => {
              lastEntryIdRef.current = result.entryId;
            }).catch((e) => notify(String(e)));
          }
          lineBufferRef.current = '';
        } else if (data === '\x7f') {
          lineBufferRef.current = lineBufferRef.current.slice(0, -1);
        } else if (data === '\x03') {
          lineBufferRef.current = '';
        } else if (data === '\x15') {
          lineBufferRef.current = '';
        } else if (data === '\x17') {
          const trimmed = lineBufferRef.current.trimEnd();
          const lastSpace = trimmed.lastIndexOf(' ');
          lineBufferRef.current = lastSpace >= 0 ? trimmed.slice(0, lastSpace) : '';
        } else if (data === '\x1b[3~') {
          // Delete key - no-op for line buffer (forward delete)
        } else if (data.startsWith('\x1b')) {
          // Escape sequences (arrow keys, etc.) - ignore
        } else {
          let printable = true;
          for (let i = 0; i < data.length; i++) {
            const code = data.charCodeAt(i);
            if (code < 32 && code !== 9) {
              printable = false;
              break;
            }
          }
          if (printable) {
            lineBufferRef.current += data;
          }
        }
      });

      resizeOffRef.current = terminal.onResize(({ cols, rows }) => {
        resizeTerminal(sessionId, rows, cols).catch((e) => notify(String(e)));
      });

      terminal.onTitleChange((title) => {
        onTitleChange?.(sessionId, title);
      });

      terminalRef.current = terminal;
      fitAddonRef.current = fitAddon;
      searchAddonRef.current = searchAddon;

      const unlisteners = unlistenersRef.current;

      listen<{ session_id: string; data: string }>('terminal-output', (event) => {
        if (event.payload.session_id === sessionId) {
          terminal.write(event.payload.data);
        }
      }).then((unlisten) => {
        unlisteners.push(unlisten);
      });

      listen<{ session_id: string; exit_code: number | null }>('terminal-closed', (event) => {
        if (event.payload.session_id === sessionId) {
          if (lastEntryIdRef.current && event.payload.exit_code != null) {
            recordExitCode(lastEntryIdRef.current, event.payload.exit_code).catch((e) => notify(String(e)));
          }
          if (event.payload.exit_code != null && event.payload.exit_code !== 0 && lastCommandRef.current) {
            emit('auto-trigger-agent', {
              triggerType: 'auto_failure',
              command: lastCommandRef.current,
              exitCode: event.payload.exit_code,
              sessionId,
            }).catch((e) => notify(String(e)));
          }
          terminal.write(`\r\n\x1b[90m${t('output.process_exited')}\x1b[0m\r\n`);
          onExit?.(sessionId);
        }
      }).then((unlisten) => {
        unlisteners.push(unlisten);
      });

      listen<{ session_id: string; error: string }>('terminal-error', (event) => {
        if (event.payload.session_id === sessionId) {
          terminal.write(`\r\n\x1b[31m${t('output.error', { error: event.payload.error })}\x1b[0m\r\n`);
        }
      }).then((unlisten) => {
        unlisteners.push(unlisten);
      });

      const resizeObserver = new ResizeObserver(() => {
        handleResize();
      });
      resizeObserver.observe(containerRef.current);

      window.addEventListener('resize', handleResize);

      return () => {
        isDisposedRef.current = true;
        if (resizeTimerRef.current) {
          clearTimeout(resizeTimerRef.current);
        }
        window.removeEventListener('resize', handleResize);
        resizeObserver.disconnect();
        selectionChangeOffRef.current?.dispose();
        selectionChangeOffRef.current = null;
        if (middleClickHandlerRef.current && containerRef.current) {
          containerRef.current.removeEventListener('mousedown', middleClickHandlerRef.current);
          middleClickHandlerRef.current = null;
        }
        dragDropUnlistenRef.current?.();
        dragDropUnlistenRef.current = null;
        resizeOffRef.current?.dispose();
        resizeOffRef.current = null;
        for (const unlisten of unlistenersRef.current) {
          unlisten();
        }
        unlistenersRef.current = [];
        try { terminal.dispose(); } catch {}
        terminalRef.current = null;
        fitAddonRef.current = null;
        searchAddonRef.current = null;
      };
    }, [sessionId]);

    useEffect(() => {
      if (!terminalRef.current) return;
      terminalRef.current.options.theme = buildTheme(appearance);
      terminalRef.current.options.cursorBlink = appearance.cursorBlink;
      terminalRef.current.options.cursorStyle = appearance.cursorStyle;
      terminalRef.current.options.fontSize = appearance.fontSize;
      terminalRef.current.options.fontFamily = appearance.fontFamily;
      terminalRef.current.options.lineHeight = appearance.lineHeight;
    }, [appearance]);

    useEffect(() => {
      if (terminalRef.current) {
        terminalRef.current.options.scrollback = scrollback;
      }
    }, [scrollback]);

    useEffect(() => {
      if (!terminalRef.current) return;
      selectionChangeOffRef.current?.dispose();
      selectionChangeOffRef.current = null;
      if (copyOnSelect) {
        selectionChangeOffRef.current = terminalRef.current.onSelectionChange(() => {
          const selection = terminalRef.current?.getSelection();
          if (selection) {
            navigator.clipboard.writeText(selection).catch((e) => notify(String(e)));
          }
        });
      }
    }, [copyOnSelect]);

    useEffect(() => {
      if (!containerRef.current) return;
      if (middleClickHandlerRef.current) {
        containerRef.current.removeEventListener('mousedown', middleClickHandlerRef.current);
        middleClickHandlerRef.current = null;
      }
      if (pasteOnMiddleClick) {
        const handler = (e: MouseEvent) => {
          if (e.button === 1) {
            e.preventDefault();
            navigator.clipboard.readText().then((text) => {
              if (text) {
                terminalRef.current?.paste(text);
              }
            }).catch((e) => notify(String(e)));
          }
        };
        containerRef.current.addEventListener('mousedown', handler);
        middleClickHandlerRef.current = handler;
      }
    }, [pasteOnMiddleClick]);

    useEffect(() => {
      if (visible && terminalRef.current && fitAddonRef.current && containerRef.current) {
        const term = terminalRef.current;
        const fit = fitAddonRef.current;
        const container = containerRef.current;
        requestAnimationFrame(() => {
          if (fit && container && term && terminalRef.current === term && term.element) {
            // Cross-platform safety: skip fit() if renderer not ready
            const internal = term as any;
            const rendererReady = !!(
              internal._renderer?.value?.dimensions ||
              internal._core?._renderService?._renderer?.value?.dimensions ||
              internal._core?.viewport
            );
            if (!rendererReady) return;
            const rect = container.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
              try {
                fit.fit();
                const cols = term.cols;
                const rows = term.rows;
                resizeTerminal(sessionId, rows, cols).catch((e) => notify(String(e)));
                // Ensure terminal regains focus when becoming visible
                term.focus();
              } catch (err) {
                console.warn('TerminalEmulator: visibility fit() failed', err);
              }
            }
          }
        });
      }
    }, [visible]);

    return (
      <Box
        ref={containerRef}
        sx={{
          height: '100%',
          width: '100%',
          backgroundColor: appearance.background,
          visibility: visible && terminalReady ? 'visible' : 'hidden',
          '& .xterm': { height: '100%', p: 1 },
        }}
      />
    );
  },
);
