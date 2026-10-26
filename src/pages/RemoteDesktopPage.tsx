import { useState, useCallback, useEffect, useRef } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
import MenuItem from '@mui/material/MenuItem';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import ToggleButton from '@mui/material/ToggleButton';
import CircularProgress from '@mui/material/CircularProgress';
import InputAdornment from '@mui/material/InputAdornment';
import IconButton from '@mui/material/IconButton';
import {
  MonitorIcon,
  LightningIcon,
  InfoIcon,
  TerminalIcon,
  CheckCircleIcon,
  XCircleIcon,
  WarningIcon,
  EyeIcon,
  EyeSlashIcon,
  RobotIcon,
  ArrowRight,
} from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { listen } from '@tauri-apps/api/event';
import { useTheme } from '@mui/material/styles';
import { useSearchParams } from 'react-router-dom';
import { VncViewer } from '../features/terminal/components/VncViewer';
import { createRemoteDesktop, closeRemoteDesktop, setupRemoteDesktop, type RemoteDesktopSession } from '../core/services/remote-desktop.service';
import type { SshConnectionInfo } from '../proto/connection';
import { spawnTerminal, killTerminal } from '../core/services/terminal.service';
import { termTimed } from '../core/terminalLog';
import { localizeBackendError } from '../core/backendError';
import { useNotify } from '../core/notification';
import { TerminalEmulator } from '../features/terminal';
import type { TerminalEmulatorHandle } from '../features/terminal';
import type { PtyConfig } from '../proto';
import { useFeatureGate, LockedScreen } from '../features/licensing';
import { openAiCopilotWindow, takeCredentialsOnce } from '../core/services/window.service';
import { ensureRemoteDesktopSetupAgent } from '../core/services/agent.service';

type Step = 'config' | 'connecting' | 'setup' | 'viewer';
type VncStatus = 'checking' | 'installed' | 'not_installed' | 'error';

export function RemoteDesktopPage() {
  const { t, i18n } = useTranslation('remoteDesktop');
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const [searchParams] = useSearchParams();
  const notify = useNotify().notify;

  const hostParam = searchParams.get('host') || '';
  const portParam = searchParams.get('port') || '22';
  const usernameParam = searchParams.get('username') || '';
  const authMethodParam = searchParams.get('authMethod') || 'none';
  const keyPathParam = searchParams.get('privateKeyPath') || '';
  const passwordParam = searchParams.get('password') || '';
  // 安全铁律：密码/密钥不进 URL，URL 只带一次性 token，凭据从 Rust 侧 CredentialStash 取回。
  const token = searchParams.get('token') || '';

  const [step, setStep] = useState<Step>('config');
  const [host, setHost] = useState(hostParam);
  const [port, setPort] = useState(portParam);
  const [username, setUsername] = useState(usernameParam);
  const [authMethod, setAuthMethod] = useState(authMethodParam);
  const [privateKeyPath, setPrivateKeyPath] = useState(keyPathParam);
  const [password, setPassword] = useState(passwordParam);
  const [vncPort, setVncPort] = useState('5900');
  const [vncPassword, setVncPassword] = useState('');
  const [showSshPassword, setShowSshPassword] = useState(false);
  const [showVncPassword, setShowVncPassword] = useState(false);
  const [session, setSession] = useState<RemoteDesktopSession | null>(null);
  // 安装模式：headless（无桌面版）/ basic（基础桌面版）/ full（全量安装），默认 full 保持原安装效果
  const [installMode, setInstallMode] = useState<'headless' | 'basic' | 'full'>('full');

  // VNC 状态检测
  const [vncStatus, setVncStatus] = useState<VncStatus>('checking');
  const [vncStatusMessage, setVncStatusMessage] = useState('');
  // Inline failure shown under the connect button (connect/spawn/createRemoteDesktop
  // failures) — the page already owns this area, so no detached toast is needed.
  const [connectError, setConnectError] = useState<string | null>(null);
  const [vncDetectedPort, setVncDetectedPort] = useState<number | null>(null);
  // 探测结论：服务器是否要求 VNC 密码。false（如未设 passwd 的 TigerVNC /
  // 其他服务端）时连接按钮不强制输入密码，避免无密码服务器被强迫填一项。
  const [vncNeedsPassword, setVncNeedsPassword] = useState(true);
  // 远端操作系统家族（检测端 setup_vnc 的 uname 分流结果）。
  const [remoteOs, setRemoteOs] = useState<string>('unknown');

  const terminalRef = useRef<TerminalEmulatorHandle | null>(null);
  const setupTerminalIdRef = useRef<string | null>(null);
  const sessionRef = useRef<RemoteDesktopSession | null>(null);
  const sshRef = useRef<SshConnectionInfo | null>(null);
  // 暂存待 spawn 的终端配置：spawnTerminal 延迟到 TerminalEmulator 的 onReady
  // 之后执行，确保监听器先注册，避免首屏输出竞态丢失（与 TerminalPage 同一修复）。
  const pendingSpawnRef = useRef<Record<string, PtyConfig>>({});

  // 一次性 token 取回完整凭据（URL 不含密码/密钥）。取回前渲染 loading，
  // 防止页面在凭据未就绪时用空密码发起连接。
  const [credsReady, setCredsReady] = useState(!token);
  const [credError, setCredError] = useState<string | null>(null);
  useEffect(() => {
    if (!token) {
      setCredsReady(true);
      return;
    }
    let cancelled = false;
    takeCredentialsOnce(token)
      .then((s) => {
        if (cancelled) return;
        setHost(s.host);
        setPort(String(s.port));
        setUsername(s.username);
        setAuthMethod(s.auth_method);
        setPrivateKeyPath(s.auth_method === 'private_key' ? (s.private_key_path ?? '') : '');
        setPassword(s.auth_method === 'password' ? (s.password ?? '') : '');
        setCredsReady(true);
      })
      .catch((e) => {
        if (cancelled) return;
        setCredError(localizeBackendError(e));
        setCredsReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const bgColor = isDark ? '#0d1117' : '#f5f5f5';
  const cardBg = isDark ? '#161B22' : '#ffffff';
  const textColor = isDark ? '#c9d1d9' : '#24292f';
  const accentColor = '#6C63FF';

  const getSshConfig = useCallback((): SshConnectionInfo => ({
    host,
    port: parseInt(port) || 22,
    username,
    auth_method: authMethod as 'none' | 'password' | 'private_key',
    private_key_path: authMethod === 'private_key' ? privateKeyPath : undefined,
    password: authMethod === 'password' ? password : undefined,
  }), [host, port, username, authMethod, privateKeyPath, password]);

  // Stable no-op: an inline arrow here would change identity on every render
  // and defeat the `React.memo` on TerminalEmulator.
  const ignoreTitleChange = useCallback(() => {}, []);

  // VNC 状态检测
  const checkVncStatus = useCallback(async () => {
    if (!sshRef.current) return null;
    setVncStatus('checking');
    setVncStatusMessage(t('checking_vnc_status'));
    try {
      const result = await setupRemoteDesktop(sshRef.current, parseInt(vncPort) || 5900);
      // 远端 OS 家族（检测端 uname 分流）：linux / macos / windows / unknown。
      // Windows 远端没有 AI 自动安装剧本，UI 分流为手动指引（见下方卡片分支）。
      setRemoteOs(result.osName || 'unknown');
      if (result.vncInstalled && result.vncRunning) {
        setVncStatus('installed');
        setVncDetectedPort(result.vncPort);
        setVncNeedsPassword(result.needsPassword);
        setVncStatusMessage(
          result.needsPassword
            ? t('vnc_running_need_password', { port: result.vncPort })
            : t('vnc_running_no_password', { port: result.vncPort })
        );
      } else if (result.vncInstalled && !result.vncRunning) {
        setVncStatus('not_installed');
        setVncStatusMessage(t('vnc_installed_not_running'));
      } else {
        setVncStatus('not_installed');
        setVncStatusMessage(t('vnc_not_installed'));
      }
      return result;
    } catch (err: any) {
      setVncStatus('error');
      setVncStatusMessage(localizeBackendError(err) || t('vnc_check_failed'));
      // No toast: the status message above already carries the failure inline.
      return null;
    }
  }, [vncPort, t]);

  const handleConnect = useCallback(async () => {
    setConnectError(null);
    if (!host || !username) {
      setConnectError(t('fill_required_fields'));
      return;
    }

    const ssh = getSshConfig();
    sshRef.current = ssh;

    setStep('connecting');

    try {
      // 启动终端会话（左侧终端，给用户和 AI 助手用）。
      // 注意：spawnTerminal 不在此处调用，改为暂存配置，由 TerminalEmulator
      // 的 onReady 回调（handleSpawnReady）在监听器注册完成后触发，避免首屏
      // 输出竞态丢失。VNC 状态检测也顺延到 spawn 完成后执行。
      const setupSessionId = `vnc-setup-${Date.now()}`;
      setupTerminalIdRef.current = setupSessionId;

      const config: PtyConfig = {
        rows: 24,
        cols: 80,
        connection_type: 'ssh',
        ssh,
      };

      pendingSpawnRef.current[setupSessionId] = config;
      setStep('setup');
    } catch (err: any) {
      setConnectError(localizeBackendError(err) || t('connection_failed'));
      setStep('config');
    }
  }, [host, port, username, authMethod, privateKeyPath, password, vncPort, t, getSshConfig]);

  // 由 TerminalEmulator 的 onReady 触发：此时监听器已注册，再 spawn 可保证首屏
  // 输出不丢失。VNC 安装终端 spawn 完成后继续等待 SSH banner 并检测 VNC 状态。
  const handleSpawnReady = useCallback(async (sessionId: string) => {
    const config = pendingSpawnRef.current[sessionId];
    if (!config) return;
    delete pendingSpawnRef.current[sessionId];
    try {
      await termTimed(
        'spawn',
        'spawnTerminal',
        () => spawnTerminal(sessionId, config),
        { sessionId, connType: config.connection_type ?? 'local', page: 'remote-desktop' },
      );
    } catch (err: any) {
      setConnectError(localizeBackendError(err) || t('connection_failed'));
      setStep('config');
      return;
    }
    // 后端 session 已确认存在，通知 emulator 把首屏尺寸同步到 PTY
    // （在此之前 resizeTerminal 会返回 "session not found" 弹框）。
    terminalRef.current?.syncBackendSize();
    if (sessionId === setupTerminalIdRef.current) {
      // VNC 状态探测是独立的 SSH exec 连接（ssh_common::establish 每次新建
      // Handle，与左侧终端的 banner / 就绪状态无关），无需固定等待即可开始。
      try {
        await checkVncStatus();
      } catch (err: any) {
        setConnectError(localizeBackendError(err) || t('connection_failed'));
      }
    }
  }, [t, checkVncStatus]);

  const handleConnectVnc = useCallback(async () => {
    if (!sshRef.current) return;

    try {
      const desktopSessionId = `rd-${Date.now()}`;
      const port = vncDetectedPort || parseInt(vncPort) || 5900;
      const desktopSession = await createRemoteDesktop(desktopSessionId, sshRef.current, port);
      setSession(desktopSession);
      sessionRef.current = desktopSession;

      // 关闭 setup 终端
      if (setupTerminalIdRef.current) {
        try { await killTerminal(setupTerminalIdRef.current); } catch (e) {
          console.error('[remote-desktop] setup terminal close failed:', e);
        }
        setupTerminalIdRef.current = null;
      }

      setStep('viewer');
    } catch (err: any) {
      setConnectError(localizeBackendError(err) || t('connection_failed'));
    }
  }, [vncDetectedPort, vncPort, t]);

  const handleClose = useCallback(async () => {
    if (session) {
      try {
        await closeRemoteDesktop(session.id);
      } catch (e) {
        console.error('[remote-desktop] close failed:', e);
      }
    }
    if (setupTerminalIdRef.current) {
      try { await killTerminal(setupTerminalIdRef.current); } catch (e) {
        console.error('[remote-desktop] setup terminal close failed:', e);
      }
      setupTerminalIdRef.current = null;
    }
    setSession(null);
    sessionRef.current = null;
    setVncStatus('checking');
    setVncStatusMessage('');
    setVncDetectedPort(null);
    setVncNeedsPassword(true);
    setRemoteOs('unknown');
    setStep('config');
  }, [session]);

  const handleOpenAiAssistant = useCallback(async () => {
    try {
      const agentId = await ensureRemoteDesktopSetupAgent(undefined, i18n.language || 'zh-CN');
      const sessionId = setupTerminalIdRef.current ?? undefined;
      const ssh = sshRef.current;
      await openAiCopilotWindow({
        agentId,
        sessionId: sessionId ?? undefined,
        host: ssh?.host,
        username: ssh?.username,
        installMode,
        osName: remoteOs,
      });
    } catch (e) {
      console.error('[remote-desktop] open AI assistant failed:', e);
      notify(localizeBackendError(e) || t('open_ai_assistant_failed'), 'error');
    }
  }, [notify, installMode, remoteOs, i18n.language, t]);

  const handleRecheck = useCallback(async () => {
    await checkVncStatus();
  }, [checkVncStatus]);

  // 安装助手会话结束（已同意过安装）时，自动刷新 VNC 状态，省去手动点「重新检查」。
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    (async () => {
      const un = await listen('rd-setup-completed', () => {
        if (!disposed && sshRef.current) checkVncStatus();
      });
      if (disposed) un();
      else unlisten = un;
    })();
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [checkVncStatus]);

  useEffect(() => {
    return () => {
      const currentSession = sessionRef.current;
      if (currentSession) {
        closeRemoteDesktop(currentSession.id).catch(() => {});
      }
      if (setupTerminalIdRef.current) {
        killTerminal(setupTerminalIdRef.current).catch(() => {});
      }
    };
  }, []);

  // License gate
  const featureGate = useFeatureGate('remote_desktop');
  if (!featureGate.canUse) {
    return <LockedScreen feature="remote_desktop" />;
  }

  // 凭据未取回（一次性 token 消费中）/ 取回失败：不渲染配置界面，
  // 防止用空密码发起连接或展示半初始化表单。
  if (!credsReady) {
    return (
      <Box sx={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: bgColor }}>
        <CircularProgress />
      </Box>
    );
  }
  if (credError) {
    return (
      <Box sx={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: bgColor }}>
        <Typography color="error">{credError}</Typography>
      </Box>
    );
  }

  if (step === 'viewer') {
    if (session) {
      return (
        <Box sx={{ height: '100vh', display: 'flex', flexDirection: 'column', bgcolor: bgColor }}>
          <VncViewer key={session.id} wsUrl={session.wsUrl} vncPassword={vncPassword || undefined} onClose={handleClose} />
        </Box>
      );
    }

    // session 尚未就绪（createRemoteDesktop 进行中）：停留在连接中占位，
    // handleConnectVnc 完成后 session 落值即切入 viewer。
    return (
      <Box sx={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: bgColor }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ height: '100vh', display: 'flex', flexDirection: 'column', bgcolor: bgColor }}>
      <Box sx={{ px: 2, py: 1.5, display: 'flex', alignItems: 'center', gap: 1, borderBottom: '1px solid', borderColor: 'divider', bgcolor: isDark ? '#161B22' : '#f0f0f0' }}>
        <MonitorIcon size={20} weight="duotone" color={accentColor} />
        <Typography variant="subtitle2" sx={{ fontWeight: 700, color: textColor }}>
          {t('remote_desktop')}
        </Typography>
      </Box>

      {step === 'setup' ? (
        // 双栏布局：左侧终端，右侧指南
        <Box sx={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          {/* 左侧：终端 */}
          <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', borderRight: '1px solid', borderColor: 'divider' }}>
            <Box sx={{ px: 2, py: 1, display: 'flex', alignItems: 'center', gap: 1, borderBottom: '1px solid', borderColor: 'divider', bgcolor: cardBg }}>
              <TerminalIcon size={16} weight="duotone" color={accentColor} />
              <Typography variant="caption" sx={{ fontWeight: 600, color: textColor }}>
                Terminal - {username}@{host}
              </Typography>
            </Box>
            <Box sx={{ flex: 1, position: 'relative' }}>
              {setupTerminalIdRef.current && (
                <TerminalEmulator
                  ref={terminalRef}
                  sessionId={setupTerminalIdRef.current}
                  onTitleChange={ignoreTitleChange}
                  onReady={handleSpawnReady}
                />
              )}
            </Box>
          </Box>

          {/* 右侧：设置指南 */}
          <Box sx={{ width: 340, display: 'flex', flexDirection: 'column', bgcolor: cardBg, overflow: 'auto' }}>
            <Box sx={{ px: 2, py: 1.5, borderBottom: '1px solid', borderColor: 'divider' }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, color: textColor }}>
                {t('setup_guide_title')}
              </Typography>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                {t('setup_guide_desc')}
              </Typography>
            </Box>

            <Box sx={{ flex: 1, p: 2, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
              {/* 第 1 步：检查 VNC 状态 */}
              <Paper
                variant="outlined"
                sx={{
                  p: 1.5,
                  borderColor: accentColor,
                  borderWidth: 2,
                  bgcolor: isDark ? 'rgba(108,99,255,0.06)' : 'rgba(108,99,255,0.04)',
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                  {vncStatus === 'checking' ? (
                    <CircularProgress size={16} sx={{ color: accentColor }} />
                  ) : vncStatus === 'installed' ? (
                    <CheckCircleIcon size={18} weight="fill" color="#4caf50" />
                  ) : vncStatus === 'error' ? (
                    <XCircleIcon size={18} weight="fill" color="#f44336" />
                  ) : (
                    <WarningIcon size={18} weight="fill" color="#ff9800" />
                  )}
                  <Typography variant="body2" sx={{ fontWeight: 600, color: textColor, fontSize: 13 }}>
                    {t('check_vnc_status')}
                  </Typography>
                </Box>
                <Typography variant="caption" sx={{ color: 'text.secondary', lineHeight: 1.4, display: 'block', ml: 3.2 }}>
                  {vncStatusMessage}
                </Typography>

                {vncStatus !== 'checking' && (
                  <Box sx={{ ml: 3.2, mt: 1 }}>
                    <Button
                      size="small"
                      variant="outlined"
                      onClick={handleRecheck}
                      sx={{
                        color: accentColor,
                        borderColor: accentColor,
                        '&:hover': { borderColor: '#5A52E0', bgcolor: 'rgba(108,99,255,0.08)' },
                        textTransform: 'none',
                        fontWeight: 600,
                        fontSize: 12,
                        py: 0.2,
                      }}
                    >
                      {t('recheck')}
                    </Button>
                  </Box>
                )}
              </Paper>

              {/* VNC 已安装并运行 → 密码输入 + 连接 */}
              {vncStatus === 'installed' && (
                <Paper
                  variant="outlined"
                  sx={{
                    p: 1.5,
                    borderColor: '#4caf50',
                    bgcolor: isDark ? 'rgba(76,175,80,0.05)' : 'rgba(76,175,80,0.03)',
                  }}
                >
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                    <CheckCircleIcon size={18} weight="fill" color="#4caf50" />
                    <Typography variant="body2" sx={{ fontWeight: 600, color: textColor, fontSize: 13 }}>
                      {t('connect_to_vnc')}
                    </Typography>
                  </Box>
                  <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', ml: 3.2, mb: 1 }}>
                    {vncNeedsPassword ? t('enter_vnc_password_to_connect') : t('connect_without_password')}
                  </Typography>
                  <Box sx={{ ml: 3.2, display: 'flex', flexDirection: 'column', gap: 1 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <TextField
                        size="small"
                        type={showVncPassword ? 'text' : 'password'}
                        placeholder={t('password_placeholder_connect')}
                        value={vncPassword}
                        onChange={(e) => setVncPassword(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && vncPassword) handleConnectVnc();
                        }}
                        sx={{
                          flex: 1,
                          '& .MuiInputBase-input': { fontSize: 12, py: 0.5 },
                          '& .MuiOutlinedInput-root': { borderRadius: 1 },
                        }}
                        slotProps={{
                          input: {
                            endAdornment: (
                              <InputAdornment position="end">
                                <IconButton
                                  aria-label={t('toggle_password_visibility')}
                                  onClick={() => setShowVncPassword((v) => !v)}
                                  edge="end"
                                  size="small"
                                >
                                  {showVncPassword ? <EyeSlashIcon size={16} /> : <EyeIcon size={16} />}
                                </IconButton>
                              </InputAdornment>
                            ),
                          },
                        }}
                      />
                      <Button
                        size="small"
                        variant="contained"
                        disabled={vncNeedsPassword && !vncPassword}
                        startIcon={<ArrowRight size={14} weight="bold" />}
                        onClick={handleConnectVnc}
                        sx={{
                          bgcolor: '#4caf50',
                          '&:hover': { bgcolor: '#388e3c' },
                          '&:disabled': { bgcolor: 'action.disabledBackground' },
                          textTransform: 'none',
                          fontWeight: 600,
                          fontSize: 12,
                          py: 0.3,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {t('connect_now')}
                      </Button>
                    </Box>
                  </Box>
                </Paper>
              )}

              {/* Windows 远端：无 AI 自动安装剧本（无 sudo/apt/vncserver，cmd 下 `;` 链失效），
                  给手动安装指引，不展示 AI 按钮——避免虚假承诺。安装模式选择也只对 Linux/macOS 有意义。 */}
              {vncStatus === 'not_installed' && remoteOs === 'windows' && (
                <Paper
                  variant="outlined"
                  sx={{
                    p: 1.5,
                    borderColor: '#ff9800',
                    bgcolor: isDark ? 'rgba(255,152,0,0.05)' : 'rgba(255,152,0,0.03)',
                  }}
                >
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                    <WarningIcon size={18} weight="fill" color="#ff9800" />
                    <Typography variant="body2" sx={{ fontWeight: 600, color: textColor, fontSize: 13 }}>
                      {t('windows_setup_title')}
                    </Typography>
                  </Box>
                  <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', ml: 3.2, lineHeight: 1.7 }}>
                    {t('windows_setup_steps')}
                  </Typography>
                </Paper>
              )}

              {/* 未安装 / 未运行（Linux / macOS / 未知远端）：安装模式选择 + AI 安装主入口（模式只在此场景有意义） */}
              {vncStatus === 'not_installed' && remoteOs !== 'windows' && (
                <Paper
                  variant="outlined"
                  sx={{
                    p: 1.5,
                    borderColor: '#ff9800',
                    bgcolor: isDark ? 'rgba(255,152,0,0.05)' : 'rgba(255,152,0,0.03)',
                  }}
                >
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                    <WarningIcon size={18} weight="fill" color="#ff9800" />
                    <Typography variant="body2" sx={{ fontWeight: 600, color: textColor, fontSize: 13 }}>
                      {t('vnc_setup_required')}
                    </Typography>
                  </Box>
                  <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', ml: 3.2, mb: 1.2, lineHeight: 1.4 }}>
                    {t('vnc_setup_ai_hint')}
                  </Typography>
                  <Box sx={{ ml: 3.2, mb: 1.2 }}>
                    <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 0.5 }}>
                      {t('install_mode')}
                    </Typography>
                    <ToggleButtonGroup
                      exclusive
                      size="small"
                      value={installMode}
                      onChange={(_, v) => { if (v) setInstallMode(v); }}
                      sx={{
                        '& .MuiToggleButton-root': { textTransform: 'none', fontSize: 11, px: 1.2, py: 0.3 },
                      }}
                    >
                      <ToggleButton value="headless">
                        {t('install_mode_headless')}
                      </ToggleButton>
                      <ToggleButton value="basic">
                        {t('install_mode_basic')}
                      </ToggleButton>
                      <ToggleButton value="full">
                        {t('install_mode_full')}
                      </ToggleButton>
                    </ToggleButtonGroup>
                  </Box>
                  <Box sx={{ ml: 3.2 }}>
                    <Button
                      size="small"
                      variant="contained"
                      startIcon={<RobotIcon size={14} weight="fill" />}
                      onClick={handleOpenAiAssistant}
                      sx={{
                        bgcolor: accentColor,
                        '&:hover': { bgcolor: '#5A52E0' },
                        textTransform: 'none',
                        fontWeight: 600,
                        fontSize: 12,
                        py: 0.3,
                      }}
                    >
                      {t('open_ai_assistant')}
                    </Button>
                  </Box>
                </Paper>
              )}

              {/* 检测错误 */}
              {vncStatus === 'error' && (
                <Paper
                  variant="outlined"
                  sx={{
                    p: 1.5,
                    borderColor: '#f44336',
                    bgcolor: isDark ? 'rgba(244,67,54,0.05)' : 'rgba(244,67,54,0.03)',
                  }}
                >
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                    <XCircleIcon size={18} weight="fill" color="#f44336" />
                    <Typography variant="body2" sx={{ fontWeight: 600, color: textColor, fontSize: 13 }}>
                      {t('check_failed')}
                    </Typography>
                  </Box>
                  <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', ml: 3.2, mb: 1.5, lineHeight: 1.4 }}>
                    {vncStatusMessage}
                  </Typography>
                </Paper>
              )}

              {/* AI 助手：其他远程维护入口（改密码、查端口、解释命令等）。
                  安装主入口已在「未安装」卡片内，此处不重复展示，避免双按钮混淆。 */}
              {vncStatus !== 'not_installed' && (
                <Paper
                  variant="outlined"
                  sx={{
                    p: 1.5,
                    borderColor: accentColor,
                    bgcolor: isDark ? 'rgba(108,99,255,0.05)' : 'rgba(108,99,255,0.03)',
                  }}
                >
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                    <RobotIcon size={18} weight="fill" color={accentColor} />
                    <Typography variant="body2" sx={{ fontWeight: 600, color: textColor, fontSize: 13 }}>
                      {t('ai_assistant')}
                    </Typography>
                  </Box>
                  <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', ml: 3.2, mb: 1.2, lineHeight: 1.4 }}>
                    {t('ai_maintenance_hint')}
                  </Typography>
                  <Box sx={{ ml: 3.2 }}>
                    <Button
                      size="small"
                      variant="outlined"
                      startIcon={<RobotIcon size={14} weight="fill" />}
                      onClick={handleOpenAiAssistant}
                      sx={{
                        color: accentColor,
                        borderColor: accentColor,
                        '&:hover': { borderColor: '#5A52E0', bgcolor: 'rgba(108,99,255,0.08)' },
                        textTransform: 'none',
                        fontWeight: 600,
                        fontSize: 12,
                        py: 0.3,
                      }}
                    >
                      {t('ask_ai_assistant')}
                    </Button>
                  </Box>
                </Paper>
              )}
            </Box>

            <Box sx={{ p: 2, borderTop: '1px solid', borderColor: 'divider' }}>
              <Button
                fullWidth
                variant="outlined"
                size="small"
                onClick={handleClose}
                sx={{ textTransform: 'none' }}
              >
                {t('cancel')}
              </Button>
            </Box>
          </Box>
        </Box>
      ) : step === 'connecting' ? (
        <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Box sx={{ textAlign: 'center' }}>
            <MonitorIcon size={48} weight="duotone" color={accentColor} />
            <Typography variant="h6" sx={{ mt: 2, color: textColor, fontWeight: 600 }}>
              {t('establishing_tunnel')}
            </Typography>
            <Typography variant="body2" sx={{ mt: 1, color: 'text.secondary' }}>
              {t('establishing_tunnel_desc', { host, vncPort })}
            </Typography>
          </Box>
        </Box>
      ) : (
        // 初始配置页面
        <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', p: 3 }}>
          <Paper sx={{ p: 3, maxWidth: 480, width: '100%', bgcolor: cardBg, borderRadius: 2 }}>
            <Box sx={{ mb: 2.5, display: 'flex', alignItems: 'center', gap: 1 }}>
              <MonitorIcon size={24} weight="duotone" color={accentColor} />
              <Typography variant="subtitle1" sx={{ fontWeight: 700, color: textColor }}>
                {t('connect_to_remote')}
              </Typography>
            </Box>

            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <Paper variant="outlined" sx={{ p: 1.5, bgcolor: isDark ? 'rgba(108,99,255,0.06)' : 'rgba(108,99,255,0.04)', borderColor: `${accentColor}30` }}>
                <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
                  <InfoIcon size={14} color={accentColor} />
                  <Typography variant="caption" sx={{ color: 'text.secondary', lineHeight: 1.5 }}>
                    {t('vnc_mode_hint')}
                  </Typography>
                </Box>
              </Paper>

              <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary', fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                {t('ssh_config')}
              </Typography>

              <TextField
                label={t('host')}
                value={host}
                onChange={(e) => setHost(e.target.value)}
                size="small"
                fullWidth
                required
                placeholder="192.168.1.100"
              />

              <Box sx={{ display: 'flex', gap: 1.5 }}>
                <TextField
                  label={t('port')}
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                  size="small"
                  sx={{ width: 100 }}
                  type="number"
                />
                <TextField
                  label={t('username')}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  size="small"
                  fullWidth
                  required
                  placeholder="root"
                />
              </Box>

              <TextField
                label={t('auth_method')}
                value={authMethod}
                onChange={(e) => setAuthMethod(e.target.value)}
                size="small"
                fullWidth
                select
              >
                <MenuItem value="none">{t('no_auth')}</MenuItem>
                <MenuItem value="password">{t('password')}</MenuItem>
                <MenuItem value="private_key">{t('private_key')}</MenuItem>
              </TextField>

              {authMethod === 'password' && (
                <TextField
                  label={t('ssh_password')}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  size="small"
                  fullWidth
                  type={showSshPassword ? 'text' : 'password'}
                  slotProps={{
                    input: {
                      endAdornment: (
                        <InputAdornment position="end">
                          <IconButton
                            aria-label={t('toggle_password_visibility')}
                            onClick={() => setShowSshPassword((v) => !v)}
                            edge="end"
                            size="small"
                          >
                            {showSshPassword ? <EyeSlashIcon size={18} /> : <EyeIcon size={18} />}
                          </IconButton>
                        </InputAdornment>
                      ),
                    },
                  }}
                />
              )}

              {authMethod === 'private_key' && (
                <TextField
                  label={t('private_key_path')}
                  value={privateKeyPath}
                  onChange={(e) => setPrivateKeyPath(e.target.value)}
                  size="small"
                  fullWidth
                  placeholder="~/.ssh/id_rsa"
                />
              )}

              <Box sx={{ mt: 1 }}>
                <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary', fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  {t('vnc_config')}
                </Typography>
              </Box>

              <Box sx={{ display: 'flex', gap: 1.5 }}>
                <TextField
                  label={t('vnc_port')}
                  value={vncPort}
                  onChange={(e) => setVncPort(e.target.value)}
                  size="small"
                  sx={{ width: 120 }}
                  type="number"
                  helperText={t('vnc_port_autodetect_hint')}
                />
              </Box>

              <Button
                variant="contained"
                onClick={handleConnect}
                disabled={!host || !username}
                startIcon={<LightningIcon size={16} weight="bold" />}
                sx={{
                  mt: 1,
                  bgcolor: accentColor,
                  '&:hover': { bgcolor: '#5A52E0' },
                  textTransform: 'none',
                  fontWeight: 600,
                }}
              >
                {t('connect')}
              </Button>
              {connectError && (
                <Typography variant="caption" sx={{ color: 'error.main', mt: 0.75, lineHeight: 1.4 }}>
                  {connectError}
                </Typography>
              )}
            </Box>
          </Paper>
        </Box>
      )}
    </Box>
  );
}