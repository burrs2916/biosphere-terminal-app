import { useState, useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import { useTheme } from '@mui/material/styles';
import {
  PlusIcon,
} from '@phosphor-icons/react';
import {
  TerminalEmulator,
  TerminalToolbar,
  TerminalStatusBar,
  ConnectionPicker,
  TerminalContextMenu,
  FindBar,
  initialConn,
  reduceConn,
} from '../features/terminal';
import type { TerminalEmulatorHandle, ConnectionPickerResult, ConnSnapshot } from '../features/terminal';
import { TabBar } from '../features/session';
import { CommandPalette } from '../features/command';
import { spawnTerminal, killTerminal, writeToTerminal, getTerminalCwd } from '../core/services/terminal.service';
import { copyText, pasteText } from '../core/services/clipboard.service';
import { parseCommand } from '../core/services/command.service';
import { generateId } from '../core/utils';
import type { PtyConfig } from '../proto';
import type { SshConnectionInfo } from '../proto/connection';
import { sftpUpload, sftpList } from '../core/services/sftp.service';
import { basename, newTransferId, uniqueRemoteName } from '../features/sftp/utils';
import { open as openFileDialog } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { openNotesReferenceWindow, openAiCopilotWindow, openRemoteDesktopWindow, openSftpWindow } from '../core/services/window.service';
import { useConnectIntent } from '../features/terminal/connectIntent';
import { localizeBackendError } from '../core/backendError';
import { termTimed } from '../core/terminalLog';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { revealItemInDir } from '@tauri-apps/plugin-opener';
import { useSettingsStore } from '../engine';
import { useNotify } from '../core/notification';
import { useTranslation } from 'react-i18next';
import { useLicenseStore } from '../features/licensing/licenseStore';
import { useUpgradeDialogStore } from '../features/licensing/upgradeDialogStore';
import type { ProFeature } from '../proto/licensing';

/** 取远程路径的父目录（点击的多是文件路径，跳转目标应是它所在的目录）。 */
function parentOfRemotePath(p: string): string {
  const trimmed = p.replace(/[\\/]+$/, '');
  const idx = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  if (idx < 0) return p; // 无分隔符：原样返回（调用方已保证是绝对路径）
  // 盘符根：C:\file → C:\
  if (/^[A-Za-z]:/.test(trimmed) && idx <= 2) return trimmed.slice(0, 3);
  if (idx === 0) return '/'; // /file → /
  return trimmed.slice(0, idx);
}

interface Tab {
  id: string;
  title: string;
  isActive: boolean;
  connectionType: 'local' | 'ssh';
  ssh?: { host: string; port: number; username: string; authMethod: string; privateKeyPath?: string; password?: string };
  /** Real connection phase, driven by the spawn lifecycle + session events.
   *  Single source of truth: the pure reducer in connectionStatus.ts. */
  conn: ConnSnapshot;
  profileId?: string;
  /** 来自既有 SSH 连接的 id，用于在连接管理页标记"使用中" */
  connectionId?: string;
}

export function TerminalPage() {
  const { t } = useTranslation('terminal');
  const { t: tCommon } = useTranslation('common');
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [confirmCloseId, setConfirmCloseId] = useState<string | null>(null);
  const [findOpen, setFindOpen] = useState(false);
  const [, setFindQuery] = useState('');
  const [findResultCount, setFindResultCount] = useState<{ resultIndex: number; resultCount: number } | null>(null);
  const [contextMenu, setContextMenu] = useState<{ mouseX: number; mouseY: number; hasSelection: boolean } | null>(null);
  const [activeCwd, setActiveCwd] = useState<string | null>(null);
  // Session ids whose backend PTY has been confirmed spawned (set inside
  // handleSpawnReady after spawnTerminal resolves). The cwd poll below must
  // NOT run before this — getTerminalCwd on a not-yet-spawned session returns
  // "session not found" and pops a toast on first connection.
  const [spawnedIds, setSpawnedIds] = useState<Set<string>>(new Set());
  const tabsRef = useRef<Tab[]>([]);
  const navigate = useNavigate();
  const terminalRefs = useRef<Map<string, TerminalEmulatorHandle>>(new Map());
  // Per-tab ref callbacks, cached so their identity is stable across renders.
  // An inline `ref={...}` arrow would be a new function on every render, which
  // makes React detach/reattach the ref on every commit and defeats
  // `React.memo` on the emulator (a new callback identity is a changed prop).
  const refCallbacksRef = useRef<Map<string, (handle: TerminalEmulatorHandle | null) => void>>(new Map());
  const getRefCallback = useCallback((tabId: string) => {
    const cache = refCallbacksRef.current;
    let cb = cache.get(tabId);
    if (!cb) {
      cb = (handle: TerminalEmulatorHandle | null) => {
        if (handle) terminalRefs.current.set(tabId, handle);
        else terminalRefs.current.delete(tabId);
      };
      cache.set(tabId, cb);
    }
    return cb;
  }, []);
  // 临时存放「待启动的会话配置」：spawnTerminal 不再在 handleConnect/handleReconnect
  // 里直接调用，而是等到对应 TerminalEmulator 的 onReady（即 Tauri 事件监听已注册）
  // 之后再触发。这样后端首屏输出永远不会早于前端监听器发出，根除「首连丢首屏」竞态。
  const configStashRef = useRef<Map<string, PtyConfig>>(new Map());
  tabsRef.current = tabs;

  const shell = useSettingsStore((s) => s.settings.shell);
  const confirmBeforeClose = useSettingsStore((s) => s.settings.confirmBeforeClose);
  const notify = useNotify().notify;

  // Only the fields the cwd poll actually depends on. Depending on the whole
  // `tabs` array meant every title change (the shell rewrites the title on
  // every prompt) tore down and restarted the poll — which fired an immediate
  // `get_terminal_cwd` IPC. On Windows that call is an OpenProcess plus two
  // ReadProcessMemory calls against the target's PEB, so it is far from free.
  const activeTabId = tabs.find((t) => t.isActive)?.id ?? null;
  const activeTabDisconnected = tabs.find((t) => t.isActive)?.conn.status === 'disconnected';
  // Last directory pushed into `activeCwd`. A poll that returns the same
  // directory must not trigger a React re-render of the whole page.
  const lastCwdRef = useRef<string | null>(null);
  // Previous active tab id, so switching/creating a tab can drop the stale cwd.
  const lastActiveTabIdRef = useRef<string | null>(null);

  useEffect(() => {
    // Switching or creating the active tab must drop the previous tab's cwd
    // immediately; otherwise the status bar shows a stale directory until the
    // new tab's first poll lands.
    if (lastActiveTabIdRef.current !== activeTabId) {
      lastActiveTabIdRef.current = activeTabId;
      lastCwdRef.current = null;
      setActiveCwd(null);
    }
    if (!activeTabId) {
      return;
    }
    // Don't poll cwd until the backend session is actually spawned (otherwise
    // getTerminalCwd hits a missing session and pops "session not found").
    // Also skip when the session is in a disconnected/closed state.
    if (!spawnedIds.has(activeTabId) || activeTabDisconnected) {
      // Re-run once the session becomes ready (spawnedIds changes) or the tab
      // is reconnected; until then there is nothing valid to poll.
      return;
    }
    const fetchCwd = () => {
      getTerminalCwd(activeTabId).then((cwd) => {
        if (cwd && cwd !== lastCwdRef.current) {
          lastCwdRef.current = cwd;
          setActiveCwd(cwd);
        }
      }).catch(() => { /* cwd is cosmetic (status bar only); never toast */ });
    };
    const interval = setInterval(fetchCwd, 5000);
    fetchCwd();
    return () => clearInterval(interval);
  }, [activeTabId, activeTabDisconnected, spawnedIds]);

  const getActiveTerminal = useCallback((): TerminalEmulatorHandle | undefined => {
    const activeTab = tabsRef.current.find((t) => t.isActive);
    if (!activeTab) return undefined;
    return terminalRefs.current.get(activeTab.id);
  }, []);

  // 由 TerminalEmulator 的 onReady 触发：监听器已就绪，此时再真正启动后端 PTY。
  // config 来自 handleConnect/handleReconnect 暂存在 configStashRef 中的值。
  // spawn 成功后再让 emulator 把首屏尺寸同步到后端 PTY（此时 session 才存在，
  // 否则 resizeTerminal 会返回 "session not found" 弹框）。
  const handleSpawnReady = useCallback(async (id: string) => {
    const cfg = configStashRef.current.get(id);
    if (!cfg) return;
    // tab 已被关闭（如建 tab 后 300ms 悬挂兜底晚到的 onReady）：丢弃待启动
    // 配置，绝不为不存在的 tab 拉起 PTY——否则 kill 落空、spawn 成功，
    // 留下一个无 UI 引用的孤儿会话直到进程退出。
    if (!tabsRef.current.some((t) => t.id === id)) {
      configStashRef.current.delete(id);
      return;
    }
    configStashRef.current.delete(id);
    // Logged on the frontend side as well: on Windows the backend can answer
    // "the PTY is up" while the window is already unresponsive, so the gap
    // between "invoke sent" and "invoke resolved" is the measurement that
    // matters.
    try {
      await termTimed(
        'spawn',
        'spawnTerminal',
        () => spawnTerminal(id, cfg),
        { sessionId: id, connType: cfg.connection_type ?? 'local' },
      );
    } catch (e) {
      console.error(e);
      // Connect/auth failed. For native SSH the russh handshake runs
      // synchronously inside spawn and fails *before* a session is registered,
      // so no terminal-closed event will ever arrive — flip the tab ourselves
      // so the status bar and tab marker stop showing a false "connected".
      // The failure reason travels with the snapshot so the overlay can show
      // exactly what went wrong instead of a bare "disconnected".
      const error = localizeBackendError(e);
      setTabs((prev) =>
        prev.map((t) => (t.id === id ? { ...t, conn: reduceConn(t.conn, { kind: 'spawn_error', error }) } : t)),
      );
      return;
    }
    terminalRefs.current.get(id)?.syncBackendSize();
    // spawnTerminal resolving means the transport is up (for native SSH the
    // handshake completed inside the spawn call) — promote to connected.
    setTabs((prev) =>
      prev.map((t) => (t.id === id ? { ...t, conn: reduceConn(t.conn, { kind: 'spawn_ok' }) } : t)),
    );
    // Mark this session as spawned so the cwd poll (which is gated on
    // spawnedIds) starts only after the backend session actually exists.
    setSpawnedIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }, [notify]);

  // Pro 功能授权检查：未付费时弹出升级对话框
  const canUseFeature = useLicenseStore((s) => s.canUse);
  const openUpgrade = useUpgradeDialogStore((s) => s.openDialog);
  const guardProFeature = useCallback(
    (feature: ProFeature, action: () => void) => {
      if (canUseFeature(feature)) {
        action();
      } else {
        openUpgrade(feature);
      }
    },
    [canUseFeature, openUpgrade],
  );

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

    // 暂存配置，等 TerminalEmulator 的 onReady（监听器已注册）后再 spawn，
    // 避免后端首屏输出早于前端监听而丢失。
    configStashRef.current.set(id, config);

    if (result.connectionId && result.connectionType === 'ssh') {
      useConnectIntent.getState().addActiveConnection(result.connectionId);
    }

    setTabs((prev) => [
      ...prev.map((t) => ({ ...t, isActive: false })),
      {
        id,
        title,
        isActive: true,
        connectionType: result.connectionType,
        conn: initialConn(result.connectionType === 'ssh'),
        connectionId: result.connectionId,
        ssh: result.ssh ? {
          host: result.ssh.host,
          port: result.ssh.port,
          username: result.ssh.username,
          authMethod: result.ssh.auth_method,
          privateKeyPath: result.ssh.private_key_path,
          password: result.ssh.password,
        } : undefined,
      },
    ]);
    setPickerOpen(false);
  }, [tabs.length, shell, activeCwd, estimateTerminalSize]);

  // 消费来自"连接管理"页的连接意图：真正拉起一个 SSH/本地终端会话（复用 handleConnect）
  const handleConnectRef = useRef(handleConnect);
  handleConnectRef.current = handleConnect;
  useEffect(() => {
    const consumeAndConnect = () => {
      const pending = useConnectIntent.getState().consume();
      if (pending) handleConnectRef.current(pending);
    };
    consumeAndConnect();
    const unsub = useConnectIntent.subscribe((state) => {
      if (state.pending) consumeAndConnect();
    });
    return unsub;
  }, []);

  const doCloseTab = useCallback(
    (id: string) => {
      // 若 onReady 尚未到达，待启动配置一并作废（防孤儿 PTY）。
      configStashRef.current.delete(id);
      killTerminal(id).catch((e) => { console.error(e); notify(localizeBackendError(e), 'error'); });
      terminalRefs.current.delete(id);
      setTabs((prev) => {
        const closing = prev.find((t) => t.id === id);
        const filtered = prev.filter((t) => t.id !== id);
        // 若该 tab 关联某个连接，且关闭后没有其他同连接 tab，则从活跃集移除
        if (closing?.connectionId && !filtered.some((t) => t.connectionId === closing.connectionId)) {
          useConnectIntent.getState().removeActiveConnection(closing.connectionId);
        }
        if (prev.find((t) => t.id === id)?.isActive && filtered.length > 0) {
          filtered[filtered.length - 1].isActive = true;
        }
        return filtered;
      });
    },
    [],
  );

  const handleCloseTab = useCallback(
    (id: string) => {
      if (confirmBeforeClose) {
        setConfirmCloseId(id);
        return;
      }
      doCloseTab(id);
    },
    [confirmBeforeClose, doCloseTab],
  );

  const handleConfirmClose = useCallback(() => {
    if (!confirmCloseId) return;
    doCloseTab(confirmCloseId);
    setConfirmCloseId(null);
  }, [confirmCloseId, doCloseTab]);

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
          prev.map((t) => (t.id === sessionId ? { ...t, conn: reduceConn(t.conn, { kind: 'closed' }) } : t)),
        );
      } else {
        doCloseTab(sessionId);
      }
    },
    [doCloseTab],
  );

  const handleReconnect = useCallback(
    (tab: Tab) => {
      if (!tab.ssh) return;
      killTerminal(tab.id).catch((e) => notify(localizeBackendError(e), 'error'));
      // 旧 id 的待启动配置一并作废（tab id 即将被替换）。
      configStashRef.current.delete(tab.id);
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
          password: tab.ssh.password,
        },
      };
      // 暂存配置，等新 TerminalEmulator 的 onReady 后再 spawn（同 handleConnect 的时序修复）。
      configStashRef.current.set(newId, config);
      setTabs((prev) =>
        prev.map((t) => (t.id === tab.id ? { ...t, id: newId, conn: initialConn(true) } : t)),
      );
    },
    [shell, estimateTerminalSize],
  );

  const handleCommandExecute = useCallback(
    (command: string) => {
      const activeTab = tabs.find((t) => t.isActive);
      if (activeTab) {
        const bytes = new TextEncoder().encode(command + '\n');
        writeToTerminal(activeTab.id, Array.from(bytes)).catch((e) => { console.error(e); notify(localizeBackendError(e), 'error'); });
        getTerminalCwd(activeTab.id).then((cwd) => {
          parseCommand(command, activeTab.id, cwd ?? undefined).catch((e) => { console.error('TerminalPage: parseCommand history (command palette)', e); });
        }).catch((e) => { console.error('TerminalPage: getTerminalCwd (command palette)', e); });
      }
      setPaletteOpen(false);
    },
    [tabs],
  );

  const handleOpenNotes = useCallback(() => {
    guardProFeature('note_reference', () => {
      openNotesReferenceWindow().catch((e) => { console.error(e); notify(localizeBackendError(e), 'error'); });
    });
  }, [guardProFeature, notify]);

  const handleOpenAiCopilot = useCallback(() => {
    guardProFeature('ai_copilot', () => {
      openAiCopilotWindow().catch((e) => { console.error(e); notify(localizeBackendError(e), 'error'); });
    });
  }, [guardProFeature, notify]);

  const handleOpenRemoteDesktop = useCallback(() => {
    guardProFeature('remote_desktop', () => {
      const activeTab = tabsRef.current.find((t) => t.isActive);
      const sshParams = activeTab?.ssh ? {
        host: activeTab.ssh.host,
        port: activeTab.ssh.port,
        username: activeTab.ssh.username,
        authMethod: activeTab.ssh.authMethod,
        privateKeyPath: activeTab.ssh.privateKeyPath,
        password: activeTab.ssh.password,
        connectionId: activeTab.connectionId,
      } : undefined;
      openRemoteDesktopWindow(sshParams, (msg) => notify(msg)).catch((e) => { console.error(e); notify(localizeBackendError(e), 'error'); });
    });
  }, [guardProFeature, notify]);

  const handleOpenSftp = useCallback(() => {
    guardProFeature('sftp', () => {
      const activeTab = tabsRef.current.find((t) => t.isActive);
      const sshParams = activeTab?.ssh ? {
        host: activeTab.ssh.host,
        port: activeTab.ssh.port,
        username: activeTab.ssh.username,
        authMethod: activeTab.ssh.authMethod,
        privateKeyPath: activeTab.ssh.privateKeyPath,
        password: activeTab.ssh.password,
      } : undefined;
      openSftpWindow(sshParams, (msg) => notify(msg)).catch((e) => { console.error(e); notify(localizeBackendError(e), 'error'); });
    });
  }, [guardProFeature, notify]);

  // SSH 会话点击终端输出里的路径：
  // - 绝对路径 → 打开文件传输窗口，定位到其父目录。输出里大多是文件路径
  //   （日志/配置），对文件 read_dir 会直接报错，因此对齐本地
  //   revealItemInDir 的"展示所在目录"语义；
  // - 相对路径（./、../ 等）→ 远端按 home 解析，多半不是终端实际 cwd，
  //   跳转会落到不存在的目录，回退为复制路径。
  const handleRemotePathActivate = useCallback((p: string) => {
    const isAbsolute = p.startsWith('/') || /^[A-Za-z]:[\\/]/.test(p);
    if (!isAbsolute) {
      copyText(p)
        .then(() => notify(t('toast_remote_path_copied') || '已复制远程路径', 'info'))
        .catch(() => notify(t('copy_failed') || '复制失败', 'error'));
      return;
    }
    const targetDir = parentOfRemotePath(p);
    guardProFeature('sftp', () => {
      const activeTab = tabsRef.current.find((t) => t.isActive);
      if (!activeTab?.ssh) return;
      const sshParams = {
        host: activeTab.ssh.host,
        port: activeTab.ssh.port,
        username: activeTab.ssh.username,
        authMethod: activeTab.ssh.authMethod,
        privateKeyPath: activeTab.ssh.privateKeyPath,
        password: activeTab.ssh.password,
        initialPath: targetDir,
      };
      openSftpWindow(sshParams, (msg) => notify(msg)).catch((e) => { console.error(e); notify(localizeBackendError(e), 'error'); });
    });
  }, [guardProFeature, notify, t]);

  // 「上传到当前目录」：本地会话把所选文件复制进 cwd；SSH 会话上传到远端
  // （远端 cwd 未跟踪，落在远端 home）。SSH 上传前先列目标目录做重名去重，
  // 生成 remoteNames 传给后端——后端按 CREATE|TRUNCATE 覆盖写，不去重会
  // 静默覆盖远端同名文件。SFTP 属 Pro 能力，SSH 分支在选择文件前先过授权门。
  const handleUploadToCwd = useCallback(() => {
    const activeTab = tabsRef.current.find((t) => t.isActive);
    if (!activeTab) return;
    const isSsh = activeTab.connectionType === 'ssh' && !!activeTab.ssh;
    if (!isSsh && !activeCwd) {
      notify(t('no_cwd') || '当前工作目录未知', 'warning');
      return;
    }
    const startTransfer = (paths: string[]) => {
      if (isSsh && activeTab.ssh) {
        const ssh: SshConnectionInfo = {
          host: activeTab.ssh.host,
          port: activeTab.ssh.port,
          username: activeTab.ssh.username,
          auth_method: activeTab.ssh.authMethod as 'none' | 'password' | 'private_key',
          private_key_path: activeTab.ssh.privateKeyPath,
          password: activeTab.ssh.password,
        };
        // 大文件期间终端页没有进度 UI，先给一条"上传中"提示，完成/失败再补一条。
        notify(t('upload_to_cwd_started', { count: paths.length }) || '正在上传…', 'info');
        // 列远端目录拿现有文件名，逐个生成不冲突的远端名（report.pdf → report (1).pdf）。
        // 若列目录失败（权限/网络），降级为「无去重」上传，但必须明确告知用户，
        // 否则成功提示会掩盖「远端同名文件被静默覆盖」的风险。
        sftpList(ssh, '.')
          .then((listing) => {
            const taken = new Set((listing?.entries ?? []).map((e) => e.name));
            const remoteNames = paths.map((p) => uniqueRemoteName(basename(p), taken));
            return sftpUpload(ssh, paths, '.', newTransferId(), remoteNames);
          })
          .catch(() => {
            notify(t('upload_dedup_failed') || '无法读取远端目录，已跳过同名去重，重名文件可能被覆盖', 'warning');
            return sftpUpload(ssh, paths, '.', newTransferId(), undefined);
          })
          .then(() => notify(t('upload_to_cwd_done') || '文件已传输到当前目录', 'success'))
          .catch((e) => notify(localizeBackendError(e), 'error'));
      } else {
        invoke('local_copy_files', { localPaths: paths, destDir: activeCwd })
          .then(() => notify(t('upload_to_cwd_done') || '文件已复制到当前目录', 'success'))
          .catch((e) => notify(localizeBackendError(e), 'error'));
      }
    };
    const startPick = () => {
      openFileDialog({ multiple: true, title: t('upload_to_cwd') || '上传到当前目录' })
        .then((picked) => {
          if (!picked) return;
          const paths = Array.isArray(picked) ? picked : [picked];
          if (paths.length === 0) return;
          startTransfer(paths);
        })
        .catch(() => { /* 对话框取消/失败静默 */ });
    };
    // Pro 门在选择文件之前过：先选完文件再被告知要升级，体验是倒置的。
    if (isSsh) {
      guardProFeature('sftp', startPick);
    } else {
      startPick();
    }
  }, [activeCwd, guardProFeature, notify, t]);

  const handleClearBuffer = useCallback(() => {
    getActiveTerminal()?.clearBuffer();
  }, [getActiveTerminal]);

  const handleTitleChange = useCallback((sessionId: string, title: string) => {
    setTabs((prev) => {
      // Bail out when the title is unchanged: rebuilding the array would
      // re-render the whole page (and every terminal tab) for nothing. The
      // shell rewrites the title on every prompt, so this runs often.
      const current = prev.find((t) => t.id === sessionId);
      if (!current || current.title === title) return prev;
      return prev.map((t) => (t.id === sessionId ? { ...t, title } : t));
    });
  }, []);

  // Stable identity so the terminal tabs (React.memo) are not re-rendered
  // when the find bar reports a new result count.
  const handleFindResultsChange = useCallback((resultIndex: number, resultCount: number) => {
    setFindResultCount({ resultIndex, resultCount });
  }, []);

  const handleCopy = useCallback(() => {
    const terminal = getActiveTerminal();
    if (!terminal) return;
    const selection = terminal.getSelection();
    if (selection) {
      copyText(selection).catch((e) => notify(localizeBackendError(e), 'error'));
    }
  }, [getActiveTerminal]);

  const handlePaste = useCallback(() => {
    const terminal = getActiveTerminal();
    if (!terminal) return;
    pasteText().then((text) => {
      if (text) {
        terminal.paste(text);
        // 粘贴的命令也要记录历史（terminal.paste 不触发 onData，无法走正常 lineBuffer 流程）
        // 只记录第一个非空行，避免多行命令被拆成多条历史
        const activeTab = tabsRef.current.find((t) => t.isActive);
        if (activeTab) {
          const firstLine = text.split('\n').map((l) => l.trim()).find(Boolean);
          if (firstLine) {
            getTerminalCwd(activeTab.id).then((cwd) => {
              parseCommand(firstLine, activeTab.id, cwd ?? undefined).catch((e) => { console.error('TerminalPage: parseCommand history (paste)', e); });
            }).catch((e) => { console.error('TerminalPage: getTerminalCwd (paste)', e); });
          }
        }
      }
    }).catch((e) => notify(localizeBackendError(e), 'error'));
  }, [getActiveTerminal]);

  const handleFind = useCallback(() => {
    setFindOpen((prev) => !prev);
  }, []);

  const handleFindNext = useCallback((query: string, options?: { caseSensitive?: boolean }) => {
    if (!query) return;
    setFindQuery(query);
    getActiveTerminal()?.findNext(query, { caseSensitive: options?.caseSensitive ?? false });
  }, [getActiveTerminal]);

  const handleFindPrevious = useCallback((query: string, options?: { caseSensitive?: boolean }) => {
    if (!query) return;
    setFindQuery(query);
    getActiveTerminal()?.findPrevious(query, { caseSensitive: options?.caseSensitive ?? false });
  }, [getActiveTerminal]);

  const handleSelectAll = useCallback(() => {
    getActiveTerminal()?.selectAll();
  }, [getActiveTerminal]);

  const handleRevealCwd = useCallback(() => {
    if (!activeCwd) {
      notify(t('no_cwd') || '当前工作目录未知', 'warning');
      return;
    }
    revealItemInDir(activeCwd).catch((e) => notify(localizeBackendError(e), 'error'));
  }, [activeCwd, notify, t]);

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
          writeToTerminal(activeTab.id, Array.from(bytes)).catch((e) => { console.error(e); notify(localizeBackendError(e), 'error'); });
          getTerminalCwd(activeTab.id).then((cwd) => {
            parseCommand(line, activeTab.id, cwd ?? undefined).catch((e) => { console.error('TerminalPage: parseCommand history (execute-command)', e); });
          }).catch((e) => { console.error('TerminalPage: getTerminalCwd (execute-command)', e); });
        }
      }
    }).then((fn) => {
      unlisten = fn;
    }).catch((e) => { console.error(e); });

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
        onOpenRemoteDesktop={handleOpenRemoteDesktop}
        onOpenSftp={handleOpenSftp}
        onClearBuffer={handleClearBuffer}
        onCopy={handleCopy}
        onPaste={handlePaste}
        onFind={handleFind}
        onSelectAll={handleSelectAll}
        cwd={activeCwd ?? undefined}
        onRevealCwd={handleRevealCwd}
        onUploadToCwd={handleUploadToCwd}
        findOpen={findOpen}
        isSshSession={!!activeTab?.ssh}
        onOpenConnections={() => navigate('/connections')}
      />
      <TabBar tabs={tabs} onSelect={handleSelectTab} onClose={handleCloseTab} />

      <FindBar
        open={findOpen}
        onClose={() => setFindOpen(false)}
        onFindNext={handleFindNext}
        onFindPrevious={handleFindPrevious}
        resultInfo={findResultCount}
      />

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
              ref={getRefCallback(tab.id)}
              sessionId={tab.id}
              onExit={handleExit}
              onTitleChange={handleTitleChange}
              onReady={handleSpawnReady}
              onFindResultsChange={handleFindResultsChange}
              visible={tab.isActive}
              profileId={tab.profileId}
              connectionType={tab.connectionType}
              onRemotePathActivate={handleRemotePathActivate}
            />
            {tab.isActive && tab.conn.status === 'connecting' && (
              <Box
                sx={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  bgcolor: isDark ? 'rgba(13,17,23,0.6)' : 'rgba(255,255,255,0.6)',
                  zIndex: 8,
                  gap: 2,
                }}
              >
                <CircularProgress size={28} />
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                  {tab.connectionType === 'ssh' && tab.ssh
                    ? t('connecting_to', { host: `${tab.ssh.username}@${tab.ssh.host}` })
                    : t('status_connecting')}
                </Typography>
              </Box>
            )}
            {tab.conn.status === 'disconnected' && (
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
                  {tab.conn.error ?? t('disconnected')}
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
        connStatus={activeTab?.conn.status ?? 'disconnected'}
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
          <Button onClick={handleCancelClose}>{tCommon('action.cancel')}</Button>
          <Button onClick={handleConfirmClose} color="error" variant="contained">
            {tCommon('action.confirm')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
