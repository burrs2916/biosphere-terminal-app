import { useEffect, useRef, useCallback, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { SearchAddon } from '@xterm/addon-search';
import { WebglAddon } from '@xterm/addon-webgl';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { writeToTerminal, resizeTerminal } from '../../../core/services/terminal.service';
import { parseCommand } from '../../../core/services/command.service';
import { useSettingsStore } from '../../../engine';
import { useTranslation } from 'react-i18next';
import '@xterm/xterm/css/xterm.css';
import Box from '@mui/material/Box';

interface TerminalEmulatorProps {
  sessionId: string;
  onExit?: (sessionId: string) => void;
  visible?: boolean;
}

export function TerminalEmulator({ sessionId, onExit, visible = true }: TerminalEmulatorProps) {
  const { t } = useTranslation('terminal');
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const unlistenersRef = useRef<UnlistenFn[]>([]);
  const lineBufferRef = useRef('');
  const resizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [terminalReady, setTerminalReady] = useState(false);

  const appearance = useSettingsStore((s) => s.settings.appearance);
  const scrollback = useSettingsStore((s) => s.settings.scrollback);
  const bellStyle = useSettingsStore((s) => s.settings.bellStyle);
  const copyOnSelect = useSettingsStore((s) => s.settings.copyOnSelect);
  const pasteOnMiddleClick = useSettingsStore((s) => s.settings.pasteOnMiddleClick);
  const webglRenderer = useSettingsStore((s) => s.settings.webglRenderer);

  const handleResize = useCallback(() => {
    if (resizeTimerRef.current) {
      clearTimeout(resizeTimerRef.current);
    }
    resizeTimerRef.current = setTimeout(() => {
      if (!fitAddonRef.current || !terminalRef.current || !containerRef.current) return;
      if (!visible) return;
      const rect = containerRef.current.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      try {
        fitAddonRef.current.fit();
        const cols = terminalRef.current.cols;
        const rows = terminalRef.current.rows;
        resizeTerminal(sessionId, rows, cols).catch(() => {});
      } catch {}
    }, 50);
  }, [sessionId, visible]);

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
      theme: {
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
      },
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();
    const searchAddon = new SearchAddon();

    terminal.loadAddon(fitAddon);
    terminal.loadAddon(webLinksAddon);
    terminal.loadAddon(searchAddon);

    if (webglRenderer) {
      try {
        const webglAddon = new WebglAddon();
        terminal.loadAddon(webglAddon);
      } catch {
        // WebGL not available, fall back to canvas renderer
      }
    }

    terminal.open(containerRef.current);

    requestAnimationFrame(() => {
      if (fitAddonRef.current && containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          try {
            fitAddon.fit();
          } catch {}
        }
      }
      setTerminalReady(true);
    });

    if (copyOnSelect) {
      terminal.onSelectionChange(() => {
        const selection = terminal.getSelection();
        if (selection) {
          navigator.clipboard.writeText(selection).catch(() => {});
        }
      });
    }

    if (pasteOnMiddleClick) {
      containerRef.current.addEventListener('mousedown', (e) => {
        if (e.button === 1) {
          e.preventDefault();
          navigator.clipboard.readText().then((text) => {
            if (text) {
              terminal.paste(text);
            }
          }).catch(() => {});
        }
      });
    }

    terminal.onData((data) => {
      const bytes = new TextEncoder().encode(data);
      writeToTerminal(sessionId, Array.from(bytes)).catch(() => {});

      if (data === '\r') {
        const cmd = lineBufferRef.current.trim();
        if (cmd) {
          parseCommand(cmd, sessionId).catch(() => {});
        }
        lineBufferRef.current = '';
      } else if (data === '\x7f') {
        lineBufferRef.current = lineBufferRef.current.slice(0, -1);
      } else if (data === '\x03') {
        lineBufferRef.current = '';
      } else if (data === '\x15') {
        lineBufferRef.current = '';
      } else if (data.charCodeAt(0) >= 32 && data.charCodeAt(0) < 127 && !data.startsWith('\x1b')) {
        lineBufferRef.current += data;
      }
    });

    terminal.onResize(({ cols, rows }) => {
      resizeTerminal(sessionId, rows, cols).catch(() => {});
    });

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

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
      if (resizeTimerRef.current) {
        clearTimeout(resizeTimerRef.current);
      }
      window.removeEventListener('resize', handleResize);
      resizeObserver.disconnect();
      for (const unlisten of unlistenersRef.current) {
        unlisten();
      }
      unlistenersRef.current = [];
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, [sessionId, onExit, handleResize, appearance, scrollback, bellStyle, copyOnSelect, pasteOnMiddleClick, webglRenderer]);

  useEffect(() => {
    if (visible && terminalRef.current && fitAddonRef.current && containerRef.current) {
      requestAnimationFrame(() => {
        if (fitAddonRef.current && containerRef.current) {
          const rect = containerRef.current.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            try {
              fitAddonRef.current.fit();
            } catch {}
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
}
