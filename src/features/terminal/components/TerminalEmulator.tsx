import { useEffect, useRef, useCallback, useState, useMemo, memo, forwardRef, useImperativeHandle } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { SearchAddon } from '@xterm/addon-search';
import { WebglAddon } from '@xterm/addon-webgl';
import { listen, type UnlistenFn, emit } from '@tauri-apps/api/event';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { openUrl, revealItemInDir } from '@tauri-apps/plugin-opener';
import { writeToTerminal, resizeTerminal, getTerminalCwd } from '../../../core/services/terminal.service';
import { copyText, pasteText } from '../../../core/services/clipboard.service';
import { parseCommand } from '../../../core/services/command.service';
import { getDefaultProfile } from '../../../core/services/profile.service';
import { useSettingsStore, getThemeAppearance } from '../../../engine';
import { useNotify } from '../../../core/notification';
import { localizeBackendError } from '../../../core/backendError';
import { termLog, renderFields } from '../../../core/terminalLog';
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
  /** Called by the parent after the backend session is confirmed spawned.
   *  Performs the first backend PTY resize (which must not happen before the
   *  session exists, otherwise resizeTerminal returns "session not found"). */
  syncBackendSize: () => void;
}

interface TerminalEmulatorProps {
  sessionId: string;
  onExit?: (sessionId: string) => void;
  onTitleChange?: (sessionId: string, title: string) => void;
  onFindResultsChange?: (resultIndex: number, resultCount: number) => void;
  /** Fired once all Tauri event listeners for this session are registered.
   *  The parent uses it to defer `spawnTerminal` until the listener is live,
   *  so the backend's initial screen output is never emitted before we can
   *  receive it (fixes the "first tab only shows a cursor" race). */
  onReady?: (sessionId: string) => void;
  visible?: boolean;
  profileId?: string;
  /** Local vs SSH session — drives file-path link behavior (reveal locally, copy on SSH). */
  connectionType?: 'local' | 'ssh';
  /**
   * SSH 会话点击输出里的路径 → 打开文件传输窗口并定位到该目录。
   * 由父组件提供（需要 tab 的 SSH 凭据）；未提供时回退为复制路径。
   * 父组件必须传稳定引用（useCallback）——emulator 是 React.memo。
   */
  onRemotePathActivate?: (path: string) => void;
}

// alt-screen 切换序列（\x1b[?47/1047/1049h|l，最长 9 字符）可能被切在两个输出
// chunk 的边界上。尾部若是这些"不完整前缀"之一，必须留到下一块拼接后再匹配，
// 否则漏检会让 altScreenRef 失真（TUI 期间误 fit / 退出后 ghost 不清）。
const ALT_SEQ_PREFIX_RE = /^(?:\x1b|\x1b\[|\x1b\[\?|\x1b\[\?1|\x1b\[\?10|\x1b\[\?104|\x1b\[\?1047|\x1b\[\?1049)$/;

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

// `React.memo` on the emulator: the xterm instance, its addons and its event
// listeners live entirely in refs and effects, so a re-render with unchanged
// props is pure overhead. Without this, every parent state change (a tab
// switch, a cwd poll, a find-bar result) re-rendered every open terminal.
//
// The parent must pass stable callback identities — `onFindResultsChange`
// and the `ref` callback are the two that used to be inline arrows.
export const TerminalEmulator = memo(
  forwardRef<TerminalEmulatorHandle, TerminalEmulatorProps>(
    function TerminalEmulator(
      { sessionId, onExit, onTitleChange, onFindResultsChange, onReady, visible = true, profileId, connectionType, onRemotePathActivate },
      ref,
    ) {
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
    const readyFiredRef = useRef(false);
    const [terminalReady, setTerminalReady] = useState(false);
    const [profileAppearance, setProfileAppearance] = useState<AppearanceConfig | null>(null);

    const themeMode = useSettingsStore((s) => s.settings.theme);
    const scrollback = useSettingsStore((s) => s.settings.scrollback);
    const copyOnSelect = useSettingsStore((s) => s.settings.copyOnSelect);
    const pasteOnMiddleClick = useSettingsStore((s) => s.settings.pasteOnMiddleClick);
    const webglRenderer = useSettingsStore((s) => s.settings.webglRenderer);
    const notify = useNotify().notify;

    // Tracks whether the PTY is currently in the alternate screen buffer
    // (a full-screen TUI such as vim/less/htop). While true we must NOT call
    // fit()/resize — resizing a TUI mid-session is what produces rendering
    // artifacts. Also drives a forced repaint on exit to clear the WebGL ghost.
    const altScreenRef = useRef(false);
    // 跨 chunk 的 alt-screen 序列残缺前缀（见 ALT_SEQ_PREFIX_RE 注释）。
    const altCarryRef = useRef('');
    // Stable view of the session's connection type for the file-path link provider.
    const connectionTypeRef = useRef(connectionType);
    connectionTypeRef.current = connectionType;
    // The link-provider closure below is created once per session; a ref keeps
    // the callback reachable without re-registering listeners on identity change.
    const onRemotePathActivateRef = useRef(onRemotePathActivate);
    onRemotePathActivateRef.current = onRemotePathActivate;

    // 粘贴的命令记录到历史（terminal.paste 不触发 onData）
    // 只记录第一个非空行，避免多行命令（for/do/done）被拆成多条历史
    const recordPastedCommand = (text: string, sid: string) => {
      const firstLine = text.split('\n').map((l) => l.trim()).find(Boolean);
      if (firstLine) {
        getTerminalCwd(sid).then((cwd) => {
          parseCommand(firstLine, sid, cwd ?? undefined).catch((e) => { console.error('TerminalEmulator: parseCommand after paste', e); });
        }).catch((e) => { console.error('TerminalEmulator: getTerminalCwd after paste', e); });
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
          }).catch((e) => { console.error('TerminalEmulator: listProfiles load', e); });
        }).catch((e) => { console.error('TerminalEmulator: profile.service import', e); });
      } else {
          getDefaultProfile().then((profile) => {
          if (profile) {
            try {
              setProfileAppearance(JSON.parse(profile.config_json));
            } catch (err) {
              console.error('TerminalEmulator: JSON.parse default profile config', err);
            }
          }
        }).catch((e) => { console.error('TerminalEmulator: getDefaultProfile load', e); });
      }
    }, [profileId]);

    // 关键性能点：`appearance` 必须是**稳定引用**。
    //
    // 之前的写法每次渲染都 spread 出一个新对象，导致下面那个
    // `useEffect(..., [appearance])` 每次渲染都重跑 —— 而该 effect 会重新赋值
    // `terminal.options.theme / fontSize / fontFamily / lineHeight`，xterm 收到
    // 这些变更后会**全量重新测量字符尺寸并重绘整个缓冲区**。
    //
    // 触发链：shell 每次改标题 → handleTitleChange → setTabs → TerminalPage
    // 重渲染 → 所有 TerminalEmulator 重渲染 → xterm 全量重绘。
    // 在 Windows 上这条链会把"敲一个命令"变成肉眼可见的卡顿。
    const baseAppearance = getThemeAppearance(themeMode);
    const appearance = useMemo(() => {
      if (!profileAppearance) return baseAppearance;
      return {
        ...baseAppearance,
        ...profileAppearance,
        colors: baseAppearance.colors,
        selectionBackground: baseAppearance.selectionBackground,
        selectionForeground: baseAppearance.selectionForeground,
        cursorColor: baseAppearance.cursorColor,
      };
    }, [baseAppearance, profileAppearance]);

    // 同样需要稳定引用：theme 对象每次新建会让 xterm 认为"配色变了"而重绘。
    const theme = useMemo(() => buildTheme(appearance), [appearance]);

    useImperativeHandle(ref, () => ({
      findNext: (query: string, options?: { regex?: boolean; wholeWord?: boolean; caseSensitive?: boolean }) => {
        searchAddonRef.current?.findNext(query, options);
      },
      findPrevious: (query: string, options?: { regex?: boolean; wholeWord?: boolean; caseSensitive?: boolean }) => {
        searchAddonRef.current?.findPrevious(query, options);
      },
      clearBuffer: () => {
        const term = terminalRef.current;
        if (!term) return;
        try {
          term.clear();
          // Force a full-screen repaint after clear() so the WebGL/DOM renderer
          // does not get stuck on a black/desynced scroll area (renderer race that
          // otherwise "bricks" the terminal view after clearing the buffer).
          term.refresh(0, term.rows - 1);
        } catch {
          // Recovery path: a bare repaint is enough to bring the view back.
          try {
            term.refresh(0, term.rows - 1);
          } catch {
            /* noop */
          }
        }
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
      syncBackendSize: () => {
        const term = terminalRef.current;
        const fit = fitAddonRef.current;
        const container = containerRef.current;
        if (!term || !fit || !container || !term.element) return;
        // Mark ready as soon as the parent confirms the backend session is alive.
        // Subsequent fit/resize calls are now safe to hit the backend.
        sessionReadyRef.current = true;
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
        } catch (err) {
          console.warn('TerminalEmulator: syncBackendSize fit() failed', err);
        }
        resizeTerminal(sessionId, term.rows, term.cols).catch((e) => { console.error('TerminalEmulator: syncBackendSize resize', e); });
      },
    }), []);

    // handleResize 会被 mount effect 里的 ResizeObserver / window listener 长期持有。
    // 必须经 ref 读最新 visible：直接闭包捕获会让守卫读到 mount 时的旧值——
    // 窗口 resize 时隐藏 tab 会 fit() 并 term.focus() 抢走焦点。
    const visibleRef = useRef(visible);
    visibleRef.current = visible;

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
        if (!visibleRef.current) return;
        // 全屏 TUI（vim/less 等）运行期间不重排：resize 会触发 PTY 的 SIGWINCH，
        // 与 alt-screen 渲染叠加会产生画面 artifact。退出 alt-screen 后由 altExit 分支补一次 fit。
        if (altScreenRef.current) return;
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
    }, []);

    const isDisposedRef = useRef(false);
    // True only after the parent has confirmed the backend PTY session exists.
    // All backend calls (resize/write) must be gated on this to avoid hitting a
    // not-yet-spawned session (which returns "session not found" and pops a toast).
    const sessionReadyRef = useRef(false);
    // Output-volume metering, used to detect a runaway output flood that can
    // stall the renderer on Windows. Reset every second when reported.
    const outputBytesRef = useRef(0);
    const outputChunksRef = useRef(0);
    const outputWindowStartRef = useRef(Date.now());

    useEffect(() => {
      // React 18 StrictMode (development) mounts every component twice —
      // effect → cleanup → effect — on the SAME instance, so refs survive
      // the simulated unmount. The cleanup below flips `isDisposedRef` to
      // true; without re-arming it here, the second mount's listener gate
      // (fireReadyOnce), fit retry (tryInitialFit) and resize guard would
      // all bail out forever: onReady never fires → the backend PTY is
      // never spawned → the local terminal stays a blank canvas and SSH
      // tabs hang at "connecting" with no error anywhere. Refs are
      // per-instance state, not per-run state — always reset them at the
      // top of the effect body.
      isDisposedRef.current = false;
      readyFiredRef.current = false;

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

      // 让终端输出里的文件路径可点击：本地会话 → 在文件管理器打开；SSH 会话 → 复制路径。
      // 这是"把终端里的文件操作变容易"的核心交互（终端原生无法操作文件）。
      const onPathActivate = (p: string) => {
        if (connectionTypeRef.current === 'ssh') {
          // 优先打开文件传输窗口并定位到该目录（父组件需 tab 凭据）；
          // 未提供回调时回退为复制路径。
          const openInSftp = onRemotePathActivateRef.current;
          if (openInSftp) {
            openInSftp(p);
            return;
          }
          copyText(p)
            .then(() => notify(t('toast_remote_path_copied') || '已复制远程路径', 'info'))
            .catch(() => notify(t('copy_failed') || '复制失败', 'error'));
          return;
        }
          revealItemInDir(p)
          .then(() => { /* opened */ })
          .catch(() => {
            copyText(p)
              .then(() => notify(t('toast_path_copied') || '已复制路径', 'info'))
              .catch(() => notify(t('copy_failed') || '复制失败', 'error'));
          });
      };
      // 匹配绝对路径(/a/b)、相对路径(./a、../a/b)、Windows 路径(C:\a\b)；排除 URL(http:// 等)。
      // 不用 lookbehind（旧版 macOS Safari/WKWebView 不支持会直接抛错），改用 URL 特征过滤。
      const FILE_PATH_RE = /(?:\/[^\s:"']+)+|(?:\.{1,2}\/[^\s:"']+)+|[A-Za-z]:\\[^\s:"']+/g;
      try {
        terminal.registerLinkProvider({
          provideLinks: (y: number, cb: (links: any) => void) => {
            try {
              // xterm 以 1-based 行号调用 provideLinks：官方 WebLinkProvider 用
              // `y - 1` 读 buffer（range.y 则直接用 1-based y）。这里少减 1 会把
              // 下一行的文本当成本行的链接——悬停/点击全部错位一行。
              const line = terminal.buffer.active.getLine(y - 1);
              if (!line) { cb(undefined); return; }
              const text = line.translateToString(true);
              const links: any[] = [];
              for (const m of text.matchAll(FILE_PATH_RE)) {
                if (m[0].includes('://')) continue; // 排除 http:// 等 URL
                // 剥掉句尾标点：叙述文本里的路径常以句号/逗号/括号收尾，
                // 它们不属于路径（"见 /var/log/syslog。"）。
                const path = m[0].replace(/[.,;)\]}）】」』、，。；！？]+$/, '');
                if (!path) continue;
                const start = m.index ?? 0;
                const len = path.length;
                if (start + len > terminal.cols) continue; // 跳过跨换行包裹的 token
                // 相对路径（./x、../x）无法可靠定位远端目录，tooltip 如实提示"复制"
                const isAbs = path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path);
                links.push({
                  range: { start: { x: start + 1, y }, end: { x: start + len, y } },
                  text: path,
                  activate: () => onPathActivate(path),
                  tooltip:
                    connectionTypeRef.current === 'ssh'
                      ? (isAbs ? (t('tooltip_open_in_sftp') || '在文件传输中打开') : (t('tooltip_copy_path') || '复制路径'))
                      : (t('tooltip_open_in_file_manager') || '在文件管理器中打开'),
                });
              }
              cb(links.length ? links : undefined);
            } catch {
              cb(undefined);
            }
          },
        });
      } catch (err) {
        console.warn('TerminalEmulator: registerLinkProvider failed', err);
      }

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
              // A lost WebGL context is the classic Windows "the app went
              // white / stopped repainting" symptom: the GPU process died or
              // the driver reset. Record it so a report can tell a renderer
              // crash apart from a backend hang.
              termLog('WARN', 'renderer', 'webgl.context-lost', renderFields({ sessionId }));
              try { webglAddon.dispose(); } catch { /* noop */ }
            });
            terminal.loadAddon(webglAddon);
            termLog('DEBUG', 'renderer', 'webgl.loaded', renderFields({ sessionId }));
          } catch (err) {
            termLog('WARN', 'renderer', 'webgl.unavailable', renderFields({ sessionId, error: String(err) }));
            console.warn('TerminalEmulator: WebGL renderer unavailable, falling back to canvas', err);
          }
        } else {
          termLog('DEBUG', 'renderer', 'canvas.selected', renderFields({ sessionId }));
        }
      } catch (err) {
        termLog('ERROR', 'renderer', 'terminal.open.failed', renderFields({ sessionId, error: String(err) }));
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
            copyText(selection).catch((e) => notify(localizeBackendError(e), 'error'));
          }
          return false;
        }
        if (mod && e.shiftKey && (e.key === 'V' || e.key === 'v')) {
          pasteText().then((text) => {
            if (text) {
              terminal.paste(text);
              recordPastedCommand(text, sessionId);
            }
          }).catch((e) => notify(localizeBackendError(e), 'error'));
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
          if (sessionReadyRef.current) {
            resizeTerminal(sessionId, term.rows, term.cols).catch((e) => { console.error('TerminalEmulator: initial fit resize', e); });
          }
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
            copyText(selection).catch((e) => { console.error('TerminalEmulator: copyOnSelect auto-copy', e); });
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
            }).catch((e) => notify(localizeBackendError(e), 'error'));
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
      }).catch((e) => { console.error('TerminalEmulator: drag-drop listener', e); });

      terminal.onData((data) => {
        // PTY not spawned yet — drop input silently (writing would hit a missing
        // session and pop "session not found"). Once sessionReadyRef is set the
        // parent has confirmed the backend session is alive.
        if (!sessionReadyRef.current) return;
        const bytes = textEncoderRef.current.encode(data);
        writeToTerminal(sessionId, Array.from(bytes)).catch((e) => notify(localizeBackendError(e), 'error'));

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
              parseCommand(cmd, sessionId, cwd ?? undefined).catch((e) => { console.error('TerminalEmulator: parseCommand on enter', e); });
            }).catch((e) => { console.error('TerminalEmulator: getTerminalCwd on enter', e); });
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
        if (!sessionReadyRef.current) return;
        // 全屏 TUI 期间 PTY 尺寸由程序自身管理，跳过推送，避免 alt-screen 内 resize 抖动。
        if (altScreenRef.current) return;
        resizeTerminal(sessionId, rows, cols).catch((e) => { console.error('TerminalEmulator: resize handler', e); });
      });

      terminal.onTitleChange((title) => {
        onTitleChange?.(sessionId, title);
      });

      terminalRef.current = terminal;
      fitAddonRef.current = fitAddon;
      searchAddonRef.current = searchAddon;

      const unlisteners = unlistenersRef.current;

      // onReady must fire only after EVERY listener is registered, otherwise the
      // backend could emit the initial screen output before we are listening and
      // that first chunk would be permanently lost (the "first tab only shows a
      // cursor" bug). Count down as each listener resolves.
      let listenersRegistered = 0;
      const fireReadyOnce = () => {
        listenersRegistered += 1;
        // isDisposedRef：tab 可能在监听器注册完成前就被关掉，此时绝不能再
        // 触发 onReady——否则父组件会为一个不存在的 tab 拉起孤儿 PTY。
        if (listenersRegistered === 3 && !readyFiredRef.current && !isDisposedRef.current) {
          readyFiredRef.current = true;
          onReady?.(sessionId);
        }
      };

      // Harden the "all listeners registered" gate against a HUNG listen() promise.
      // The first terminal in a fresh process can sometimes have a Tauri event
      // listener registration that never resolves (neither resolve nor reject). The
      // old code only caught reject, so a hung listener deadlocked fireReadyOnce at
      // <3 and the backend PTY was never spawned — the "first remote tab sometimes
      // won't connect, opening a second one works" bug. Now each listener counts
      // exactly once via resolve, reject, OR a 300ms timeout.
      // 悬挂兜底 timer 必须可清除：tab 在 300ms 内被关闭时，unmount 后再触发的
      // countOnce 会让 onReady 穿越卸载边界（下方 cleanup 里统一 clearTimeout）。
      const fallbackTimers: ReturnType<typeof setTimeout>[] = [];
      // Per-run disposal flag. Under StrictMode the FIRST run's listen()
      // promises resolve only after its cleanup already ran, and a shared
      // ref cannot tell "stale run" from "current run" at that point — the
      // late registrations would leak into the second run (duplicate
      // handlers on the same event, one of them writing into an already
      // disposed terminal). This closure-local flag isolates each run.
      let runDisposed = false;
      const registerListener = (event: string, handler: (event: any) => void) => {
        let counted = false;
        const countOnce = () => {
          if (!counted) {
            counted = true;
            fireReadyOnce();
          }
        };
        listen(event, handler as any)
          .then((unlisten) => {
            if (runDisposed) {
              unlisten();
              return;
            }
            unlisteners.push(unlisten);
            countOnce();
          })
          .catch(() => { if (!runDisposed) countOnce(); });
        // 悬挂兜底：listen 永不 resolve 时，最多 300ms 后必计数，保证 onReady 触发
        fallbackTimers.push(setTimeout(countOnce, 300));
      };

      registerListener('terminal-output', (event) => {
        if (event.payload.session_id === sessionId) {
          // Track output volume: a runaway command (e.g. `cat` on a huge file)
          // floods the renderer with chunks and is a documented cause of the
          // window "freezing" on Windows. Report the rate so a report can
          // confirm or rule this out. Throttled to one line per second so the
          // log itself cannot become the new bottleneck.
          const now = Date.now();
          outputBytesRef.current += event.payload.data.length;
          outputChunksRef.current += 1;
          if (now - outputWindowStartRef.current >= 1000) {
            const bytes = outputBytesRef.current;
            const chunks = outputChunksRef.current;
            const elapsed = now - outputWindowStartRef.current;
            if (bytes > 256 * 1024) {
              termLog(
                'WARN',
                'output',
                'output.flood',
                renderFields({
                  sessionId,
                  bytesPerSec: Math.round((bytes / elapsed) * 1000),
                  chunksPerSec: Math.round((chunks / elapsed) * 1000),
                  windowMs: elapsed,
                }),
              );
            }
            outputBytesRef.current = 0;
            outputChunksRef.current = 0;
            outputWindowStartRef.current = now;
          }
          const data = event.payload.data;
          // Track alternate-screen (full-screen TUI: vim/less/htop) enter/exit so we can
          // 1) suppress fit()/resize while the TUI owns the screen, and
          // 2) force a full repaint on exit to clear the WebGL renderer's ghost frame
          //    (otherwise the old TUI frame stays painted → "duplicated interface" on exit).
          // 序列可能被切在 chunk 边界：先拼上上一块留下的残缺前缀，再把本块
          // 尾部新的残缺前缀留给下一块。
          let scanData = altCarryRef.current + data;
          altCarryRef.current = '';
          for (let l = Math.min(8, scanData.length); l >= 1; l--) {
            const suffix = scanData.slice(-l);
            if (ALT_SEQ_PREFIX_RE.test(suffix)) {
              altCarryRef.current = suffix;
              scanData = scanData.slice(0, scanData.length - l);
              break;
            }
          }
          let altExit = false;
          const altRe = /\x1b\[\?(?:47|1047|1049)([hl])/g;
          let am: RegExpExecArray | null;
          while ((am = altRe.exec(scanData)) !== null) {
            if (am[1] === 'h') altScreenRef.current = true;
            else { altScreenRef.current = false; altExit = true; }
          }
          terminal.write(data);
          if (altExit) {
            requestAnimationFrame(() => requestAnimationFrame(() => {
              const t = terminalRef.current;
              if (t) { try { t.refresh(0, t.rows - 1); } catch { /* noop */ } }
            }));
            // Re-sync size once the TUI releases the screen (container may have
            // resized while we skipped fit() during the TUI session).
            setTimeout(() => { if (!altScreenRef.current) handleResize(); }, 90);
          }
        }
      });

      registerListener('terminal-closed', (event) => {
        if (event.payload.session_id === sessionId) {
          termLog(
            'INFO',
            'lifecycle',
            'terminal.closed',
            renderFields({ sessionId, exitCode: event.payload.exit_code }),
          );
          // 不记录 exit_code：terminal-closed 是 shell 进程退出码，不是单条命令的退出码
          // 单条命令的 exit_code 需要 shell integration 才能可靠获取
          if (event.payload.exit_code != null && event.payload.exit_code !== 0 && lastCommandRef.current) {
            emit('auto-trigger-agent', {
              triggerType: 'auto_failure',
              command: lastCommandRef.current,
              exitCode: event.payload.exit_code,
              sessionId,
            }).catch((e) => { console.error('TerminalEmulator: auto-trigger-agent emit', e); });
          }
          terminal.write(`\r\n\x1b[90m${t('output.process_exited')}\x1b[0m\r\n`);
          // 进程退出后强制整屏重绘，清除可能的 WebGL 残留帧。
          try { terminal.refresh(0, terminal.rows - 1); } catch { /* noop */ }
          onExit?.(sessionId);
        }
      });

      registerListener('terminal-error', (event) => {
        if (event.payload.session_id === sessionId) {
          termLog(
            'ERROR',
            'lifecycle',
            'terminal.error',
            renderFields({ sessionId, error: event.payload.error }),
          );
          terminal.write(`\r\n\x1b[31m${t('output.error', { error: event.payload.error })}\x1b[0m\r\n`);
        }
      });

      const resizeObserver = new ResizeObserver(() => {
        handleResize();
      });
      resizeObserver.observe(containerRef.current);

      window.addEventListener('resize', handleResize);

      return () => {
        isDisposedRef.current = true;
        runDisposed = true;
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
        for (const timer of fallbackTimers) clearTimeout(timer);
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
      // `theme` 是 memo 化的稳定引用，这里只在配色真正变化时才会重新赋值。
      // 重新赋值 xterm 的 options.theme / fontSize 会触发全量重绘，所以这个
      // effect 的依赖稳定性直接决定了终端的流畅度。
      terminalRef.current.options.theme = theme;
      terminalRef.current.options.cursorBlink = appearance.cursorBlink;
      terminalRef.current.options.cursorStyle = appearance.cursorStyle;
      terminalRef.current.options.fontSize = appearance.fontSize;
      terminalRef.current.options.fontFamily = appearance.fontFamily;
      terminalRef.current.options.lineHeight = appearance.lineHeight;
    }, [appearance, theme]);

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
            copyText(selection).catch((e) => { console.error('TerminalEmulator: copyOnSelect auto-copy (effect)', e); });
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
            }).catch((e) => notify(localizeBackendError(e), 'error'));
          }
        };
        containerRef.current.addEventListener('mousedown', handler);
        middleClickHandlerRef.current = handler;
      }
    }, [pasteOnMiddleClick]);

    useEffect(() => {
      // 全屏 TUI 运行期间即使变为可见也不重排（见 handleResize 注释）。
      if (altScreenRef.current) return;
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
                if (sessionReadyRef.current) {
                  resizeTerminal(sessionId, rows, cols).catch((e) => { console.error('TerminalEmulator: visible fit resize', e); });
                }
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
  ),
);
