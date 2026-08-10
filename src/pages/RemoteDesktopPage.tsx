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
  DesktopIcon,
  CheckCircleIcon,
  XCircleIcon,
  WarningIcon,
  EyeIcon,
  EyeSlashIcon,
  RobotIcon,
  ArrowRight,
} from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@mui/material/styles';
import { useSearchParams } from 'react-router-dom';
import { VncViewer } from '../features/terminal/components/VncViewer';
import { createRemoteDesktop, closeRemoteDesktop, setupRemoteDesktop, type RemoteDesktopSession } from '../core/services/remote-desktop.service';
import type { SshConnectionInfo } from '../proto/connection';
import { spawnTerminal, killTerminal } from '../core/services/terminal.service';
import { localizeBackendError } from '../core/backendError';
import { useNotify } from '../core/notification';
import { TerminalEmulator } from '../features/terminal';
import type { TerminalEmulatorHandle } from '../features/terminal';
import type { PtyConfig } from '../proto';
import { useFeatureGate, LockedScreen } from '../features/licensing';
import { openAiCopilotWindow } from '../core/services/window.service';

type Step = 'config' | 'connecting' | 'setup' | 'viewer';
type Mode = 'x11' | 'vnc';
type VncStatus = 'checking' | 'installed' | 'not_installed' | 'error';

export function RemoteDesktopPage() {
  const { t } = useTranslation('remoteDesktop');
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
  const modeParam = searchParams.get('mode') || '';

  const [step, setStep] = useState<Step>('config');
  const [mode, setMode] = useState<Mode>((modeParam || 'vnc') as Mode);
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

  // VNC 状态检测
  const [vncStatus, setVncStatus] = useState<VncStatus>('checking');
  const [vncStatusMessage, setVncStatusMessage] = useState('');
  const [vncDetectedPort, setVncDetectedPort] = useState<number | null>(null);

  const terminalRef = useRef<TerminalEmulatorHandle | null>(null);
  const setupTerminalIdRef = useRef<string | null>(null);
  const sessionRef = useRef<RemoteDesktopSession | null>(null);
  const sshRef = useRef<SshConnectionInfo | null>(null);
  const x11TerminalIdRef = useRef<string | null>(null);

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

  // 检测 VNC 状态
  const checkVncStatus = useCallback(async () => {
    if (!sshRef.current) return null;
    setVncStatus('checking');
    setVncStatusMessage(t('checking_vnc_status', { defaultValue: 'Verifying VNC server status on remote host...' }));
    try {
      const result = await setupRemoteDesktop(sshRef.current, parseInt(vncPort) || 5900);
      if (result.vncInstalled && result.vncRunning) {
        setVncStatus('installed');
        setVncDetectedPort(result.vncPort);
        setVncStatusMessage(
          result.needsPassword
            ? t('vnc_running_need_password', { defaultValue: 'VNC server is running on port {port}. Enter the VNC password to connect.' })
            : t('vnc_running_no_password', { defaultValue: 'VNC server is running on port {port} with no password required.' })
        );
      } else if (result.vncInstalled && !result.vncRunning) {
        setVncStatus('not_installed');
        setVncStatusMessage(t('vnc_installed_not_running', { defaultValue: 'VNC is installed but not running. Start it in the terminal or use the AI Assistant for help.' }));
      } else {
        setVncStatus('not_installed');
        setVncStatusMessage(t('vnc_not_installed', { defaultValue: 'VNC server is not installed on the remote host. Use the AI Assistant below to install it.' }));
      }
      return result;
    } catch (err: any) {
      setVncStatus('error');
      setVncStatusMessage(localizeBackendError(err) || t('vnc_check_failed', { defaultValue: 'Failed to check VNC status.' }));
      notify(localizeBackendError(err) || t('connection_failed'));
      return null;
    }
  }, [vncPort, notify, t]);

  const handleConnect = useCallback(async () => {
    if (!host || !username) {
      notify(t('fill_required_fields'));
      return;
    }

    const ssh = getSshConfig();
    sshRef.current = ssh;

    if (mode === 'vnc') {
      setStep('connecting');

      try {
        // 启动终端会话（左侧终端，给用户和 AI 助手用）
        const setupSessionId = `vnc-setup-${Date.now()}`;
        setupTerminalIdRef.current = setupSessionId;

        const config: PtyConfig = {
          rows: 24,
          cols: 80,
          connection_type: 'ssh',
          ssh,
        };

        await spawnTerminal(setupSessionId, config);
        setStep('setup');

        // 检测 VNC 状态
        await new Promise(r => setTimeout(r, 1500)); // 等 SSH banner 结束
        await checkVncStatus();
      } catch (err: any) {
        notify(localizeBackendError(err) || t('connection_failed'));
        setStep('config');
      }
    } else {
      // X11 模式
      setStep('connecting');
      try {
        const sessionId = `x11-${Date.now()}`;
        x11TerminalIdRef.current = sessionId;

        const config: PtyConfig = {
          rows: 24,
          cols: 80,
          connection_type: 'ssh',
          ssh,
          x11_forwarding: true,
        };

        await spawnTerminal(sessionId, config);
        setStep('viewer');
      } catch (err: any) {
        notify(localizeBackendError(err) || t('connection_failed'));
        setStep('config');
      }
    }
  }, [host, port, username, authMethod, privateKeyPath, password, vncPort, mode, notify, t, getSshConfig, checkVncStatus]);

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
      notify(localizeBackendError(err) || t('connection_failed'));
    }
  }, [vncDetectedPort, vncPort, notify, t]);

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
    if (x11TerminalIdRef.current) {
      try { await killTerminal(x11TerminalIdRef.current); } catch (e) {
        console.error('[remote-desktop] x11 terminal close failed:', e);
      }
      x11TerminalIdRef.current = null;
    }
    setSession(null);
    sessionRef.current = null;
    setVncStatus('checking');
    setVncStatusMessage('');
    setVncDetectedPort(null);
    setStep('config');
  }, [session]);

  const handleOpenAiAssistant = useCallback(async () => {
    await openAiCopilotWindow();
  }, []);

  const handleRecheck = useCallback(async () => {
    await checkVncStatus();
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
      if (x11TerminalIdRef.current) {
        killTerminal(x11TerminalIdRef.current).catch(() => {});
      }
    };
  }, []);

  // License gate
  const featureGate = useFeatureGate('remote_desktop');
  if (!featureGate.canUse) {
    return <LockedScreen feature="remote_desktop" />;
  }

  if (step === 'viewer') {
    if (mode === 'vnc' && session) {
      return (
        <Box sx={{ height: '100vh', display: 'flex', flexDirection: 'column', bgcolor: bgColor }}>
          <VncViewer key={session.id} wsUrl={session.wsUrl} vncPassword={vncPassword || undefined} onClose={handleClose} />
        </Box>
      );
    }

    return (
      <Box sx={{ height: '100vh', display: 'flex', flexDirection: 'column', bgcolor: bgColor }}>
        <Box sx={{ px: 2, py: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid', borderColor: 'divider', bgcolor: cardBg }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <TerminalIcon size={18} weight="duotone" color={accentColor} />
            <Typography variant="subtitle2" sx={{ fontWeight: 600, color: textColor }}>
              {t('x11_session')} - {username}@{host}
            </Typography>
          </Box>
          <Button size="small" variant="outlined" onClick={handleClose} sx={{ textTransform: 'none' }}>
            {t('disconnect')}
          </Button>
        </Box>
        <Box sx={{ flex: 1, position: 'relative' }}>
          {x11TerminalIdRef.current && (
            <TerminalEmulator
              ref={terminalRef}
              sessionId={x11TerminalIdRef.current}
              onTitleChange={() => {}}
            />
          )}
        </Box>
        <Box sx={{ px: 2, py: 1, borderTop: '1px solid', borderColor: 'divider', bgcolor: cardBg }}>
          <Typography variant="caption" color="text.secondary">
            {t('x11_hint')}
          </Typography>
        </Box>
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
                  onTitleChange={() => {}}
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
                    {t('check_vnc_status', { defaultValue: 'Check VNC Status' })}
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
                      {t('recheck', { defaultValue: 'Re-check' })}
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
                      {t('connect_to_vnc', { defaultValue: 'Connect to VNC' })}
                    </Typography>
                  </Box>
                  <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', ml: 3.2, mb: 1 }}>
                    {t('enter_vnc_password_to_connect', { defaultValue: 'Enter the VNC password and click Connect.' })}
                  </Typography>
                  <Box sx={{ ml: 3.2, display: 'flex', flexDirection: 'column', gap: 1 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <TextField
                        size="small"
                        type={showVncPassword ? 'text' : 'password'}
                        placeholder={t('password_placeholder_connect', { defaultValue: 'Enter VNC password' })}
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
                        disabled={!vncPassword}
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
                        Connect Now
                      </Button>
                    </Box>
                  </Box>
                </Paper>
              )}

              {/* VNC 未安装或未运行 → AI 助手按钮 */}
              {vncStatus === 'not_installed' && (
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
                      {t('vnc_setup_required', { defaultValue: 'VNC Setup Required' })}
                    </Typography>
                  </Box>
                  <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', ml: 3.2, mb: 1.5, lineHeight: 1.4 }}>
                    {t('vnc_setup_ai_hint', { defaultValue: 'VNC is not installed or not running. Click the button below to open the AI Assistant, which can help you install and configure VNC on the remote server.' })}
                  </Typography>
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
                      {t('open_ai_assistant', { defaultValue: 'Open AI Assistant' })}
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
                      {t('check_failed', { defaultValue: 'Check Failed' })}
                    </Typography>
                  </Box>
                  <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', ml: 3.2, mb: 1.5, lineHeight: 1.4 }}>
                    {vncStatusMessage}
                  </Typography>
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
                {t('cancel', { defaultValue: 'Cancel' })}
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
              {t('establishing_tunnel_desc', { host, vncPort: mode === 'vnc' ? vncPort : 'N/A' })}
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
              <ToggleButtonGroup
                value={mode}
                exclusive
                onChange={(_, newMode) => newMode && setMode(newMode)}
                size="small"
                fullWidth
                sx={{ mb: 1 }}
              >
                <ToggleButton value="x11" sx={{ textTransform: 'none', py: 1 }}>
                  <TerminalIcon size={16} weight="duotone" style={{ marginRight: 6 }} />
                  {t('mode_x11')}
                </ToggleButton>
                <ToggleButton value="vnc" sx={{ textTransform: 'none', py: 1 }}>
                  <DesktopIcon size={16} weight="duotone" style={{ marginRight: 6 }} />
                  {t('mode_vnc')}
                </ToggleButton>
              </ToggleButtonGroup>

              <Paper variant="outlined" sx={{ p: 1.5, bgcolor: isDark ? 'rgba(108,99,255,0.06)' : 'rgba(108,99,255,0.04)', borderColor: `${accentColor}30` }}>
                <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
                  <InfoIcon size={14} color={accentColor} />
                  <Typography variant="caption" sx={{ color: 'text.secondary', lineHeight: 1.5 }}>
                    {mode === 'x11' ? t('x11_mode_hint') : t('vnc_mode_hint')}
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

              {mode === 'vnc' && (
                <>
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
                      helperText="Auto-detected if running"
                    />
                  </Box>
                </>
              )}

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
            </Box>
          </Paper>
        </Box>
      )}
    </Box>
  );
}