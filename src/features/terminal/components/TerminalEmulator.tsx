import { useEffect, useRef, useCallback, useState, forwardRef, useImperativeHandle } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { SearchAddon } from '@xterm/addon-search';
import { WebglAddon } from '@xterm/addon-webgl';
import { listen, type UnlistenFn, emit } from '@tauri-apps/api/event';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { openUrl } from '@tauri-apps/plugin-opener';
import { writeToTerminal, resizeTerminal, getTerminalCwd } from '../../../core/services/terminal.service';
import { copyText, pasteText } from '../../../core/services/clipboard.service';
import { parseCommand } from '../../../core/services/command.service';
import { getDefaultProfile } from '../../../core/services/profile.service';
import { useSettingsStore, getThemeAppearance } from '../../../engine';
import { useNotify } from '../../../core/notification';
import { localizeBackendError } from '../../../core/backendError';
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

    // 粘贴的命令记录到历史（terminal.paste 不触发 onData）
    // 只记录第一个非空行，避免多行命令（for/do/done）被拆成多条历史
    const recordPastedCommand = (text: string, sid: string) => {
      const firstLine = text.split('\n').map((l) => l.trim()).find(Boolean);
      if (firstLine) {
        getTerminalCwd(sid).then((cwd) => {
          parseCommand(firstLine, sid, cwd ?? undefined).catch((e) => notify(localizeBackendError(e)));
        }).catch((e) => notify(localizeBackendError(e)));
      }
    };

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
          }).catch((e) => notify(localizeBackendError(e)));
        }).catch((e) => notify(localizeBackendError(e)));
      } else {
          getDefaultProfile().then((profile) => {
          if (profile) {
            try {
              setProfileAppearance(JSON.parse(profile.config_json));
            } catch (err) {
              console.error('TerminalEmulator: JSON.parse default profile config', err);
            }
          }
        }).catch((e) => notify(localizeBackendError(e)));
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

      // CRITICAL FIX for "this._renderer.value.dimensions" undefined error:
      // xterm.js viewport's syncScrollArea is called synchronously during onResize/onScroll
      // events, but the renderer dimensions may not be initialized yet. We monkey-patch the
      // viewport's syncScrollArea to bail out safely when renderer is not ready.
      const installViewportGuard = () => {
        const internal = terminal as any;
        const viewport = internal._core?.viewport;
        if (!viewport) return;
        if (viewport.syncScrollArea && !viewport.__guarded) {
          const original = viewport.syncScrollArea.bind(viewport);
          viewport.syncScrollArea = function (...args: any[]) {
            try {
              const renderer = internal._core?._renderService?._renderer?.value
                || internal._renderer?.value;
              if (!renderer || !renderer.dimensions) return;
              return original(...args);
            } catch {
              return;
            }
          };
          viewport.__guarded = true;
        }
      };

      // Open terminal immediately. The viewport guard handles renderer race conditions.
      // We do NOT wait for non-zero container size because:
      // 1. Container may be initially hidden (visibility: hidden) when tab is inactive
      // 2. xterm.js needs to be opened to attach DOM, then fit() will resize it later
      try {
        terminal.open(containerRef.current);
        installViewportGuard();
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
      } catch (err) {
        console.error('TerminalEmulator: terminal.open() failed', err);
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
        // xterm handles printable characters (incl. Space, keyCode=32) via the
        // `keypress` event. Returning `false` here would block default handling and
        // swallow those characters, so non-keydown events must be let through.
        if (e.type !== 'keydown') return true;
        // IME 组合中（中文输入法拼音/五笔组合等）：Enter 是"确认选词"而不是发送命令，
        // keyCode 229 表示浏览器正处于 IME 组合状态。这里放行给 xterm/输入法处理，
        // 避免把选词回车误发成 \r（导致命令被空回车打断），也避免组合状态吞掉后续回车。
        if (e.isComposing || e.keyCode === 229) {
          return true;
        }
        const mod = e.ctrlKey || e.metaKey;
        if (mod && e.shiftKey && (e.key === 'C' || e.key === 'c')) {
          const selection = terminal.getSelection();
          if (selection) {
            copyText(selection).catch((e) => notify(localizeBackendError(e)));
          }
          return false;
        }
        if (mod && e.shiftKey && (e.key === 'V' || e.key === 'v')) {
          pasteText().then((text) => {
            if (text) {
              terminal.paste(text);
              recordPastedCommand(text, sessionId);
            }
          }).catch((e) => notify(localizeBackendError(e)));
          return false;
        }
        return true;
      });

      // Mark terminal ready immediately so the container becomes visible.
      // The actual fit() will happen via ResizeObserver once the container has size.
      // This is critical: previously, terminalReady stayed false if container was hidden,
      // which caused an infinite hidden state where the terminal could never become visible.
      setTerminalReady(true);

      // Best-effort initial fit (will retry via ResizeObserver if container has no size yet)
      const tryInitialFit = () => {
        if (isDisposedRef.current) return;
        const fit = fitAddonRef.current;
        const container = containerRef.current;
        const term = terminalRef.current;
        if (!fit || !container || !term || !term.element) return;
        // Skip if renderer not ready yet (will retry on resize)
        const internal = term as any;
        const rendererReady = !!(
          internal._renderer?.value?.dimensions ||
          internal._core?._renderService?._renderer?.value?.dimensions
        );
        if (!rendererReady) return;
        const rect = container.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;
        try {
          fit.fit();
          resizeTerminal(sessionId, term.rows, term.cols).catch((e) => notify(localizeBackendError(e)));
        } catch (err) {
          console.warn('TerminalEmulator: initial fit() failed', err);
        }
      };
      // Try fit a few times across animation frames to catch the renderer once ready
      requestAnimationFrame(() => {
        tryInitialFit();
        requestAnimationFrame(() => {
          tryInitialFit();
          setTimeout(tryInitialFit, 100);
        });
      });

      if (copyOnSelect) {
        selectionChangeOffRef.current = terminal.onSelectionChange(() => {
          const selection = terminal.getSelection();
          if (selection) {
            copyText(selection).catch((e) => notify(localizeBackendError(e)));
          }
        });
      }

      if (pasteOnMiddleClick) {
        const handler = (e: MouseEvent) => {
          if (e.button === 1) {
            e.preventDefault();
            pasteText().then((text) => {
              if (text) {
                terminal.paste(text);
                recordPastedCommand(text, sessionId);
              }
            }).catch((e) => notify(localizeBackendError(e)));
          }
        };
        containerRef.current.addEventListener('mousedown', handler);
        middleClickHandlerRef.current = handler;
      }

      getCurrentWebviewWindow().onDragDropEvent((event) => {
        if (event.payload.type === 'drop') {
          const paths = event.payload.paths;
          if (paths && paths.length > 0) {
            // Windows shell（cmd/PowerShell）用双引号包裹含空格路径；
            // Unix 系 shell 用单引号。用错引号会导致 cmd 不认路径。
            const isWindows = /Windows|Win32|Win64/i.test(`${navigator.userAgent} ${navigator.platform || ''}`);
            const q = isWindows ? '"' : "'";
            const formatted = paths.map((p: string) =>
              p.includes(' ') ? `${q}${p}${q}` : p
            );
            terminal.paste(formatted.join(' '));
          }
        }
      }).then((unlisten) => {
        dragDropUnlistenRef.current = unlisten;
      }).catch((e) => notify(localizeBackendError(e)));

      terminal.onData((data) => {
        const bytes = textEncoderRef.current.encode(data);
        writeToTerminal(sessionId, Array.from(bytes)).catch((e) => notify(localizeBackendError(e)));

        if (data === '\r') {
          // 从终端 buffer 读取实际行内容，比 lineBufferRef 更可靠
          // 修复 Tab 补全、bracketed paste 等场景下 lineBufferRef 不准确的问题
          const buf = terminal.buffer.active;
          const line = buf.getLine(buf.baseY + buf.cursorY);
          let cmd = '';
          if (line) {
            cmd = line.translateToString(true).trim();
          }
          if (!cmd) cmd = lineBufferRef.current.trim();
          if (cmd) {
            lastCommandRef.current = cmd;
            getTerminalCwd(sessionId).then((cwd) => {
              parseCommand(cmd, sessionId, cwd ?? undefined).catch((e) => notify(localizeBackendError(e)));
            }).catch((e) => notify(localizeBackendError(e)));
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
        resizeTerminal(sessionId, rows, cols).catch((e) => notify(localizeBackendError(e)));
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
          // 不记录 exit_code：terminal-closed 是 shell 进程退出码，不是单条命令的退出码
          // 单条命令的 exit_code 需要 shell integration 才能可靠获取
          if (event.payload.exit_code != null && event.payload.exit_code !== 0 && lastCommandRef.current) {
            emit('auto-trigger-agent', {
              triggerType: 'auto_failure',
              command: lastCommandRef.current,
              exitCode: event.payload.exit_code,
              sessionId,
            }).catch((e) => notify(localizeBackendError(e)));
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
            copyText(selection).catch((e) => notify(localizeBackendError(e)));
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
            pasteText().then((text) => {
              if (text) {
                terminalRef.current?.paste(text);
                recordPastedCommand(text, sessionId);
              }
            }).catch((e) => notify(localizeBackendError(e)));
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
                resizeTerminal(sessionId, rows, cols).catch((e) => notify(localizeBackendError(e)));
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
