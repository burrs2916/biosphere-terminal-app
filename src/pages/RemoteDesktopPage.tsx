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
import {
  MonitorIcon,
  LightningIcon,
  InfoIcon,
  TerminalIcon,
  DesktopIcon,
  CheckCircleIcon,
  XCircleIcon,
  PlayIcon,
  ArrowRightIcon,
  LockIcon,
  WarningIcon,
} from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@mui/material/styles';
import { useSearchParams } from 'react-router-dom';
import { VncViewer } from '../features/terminal/components/VncViewer';
import { createRemoteDesktop, closeRemoteDesktop, setupRemoteDesktop, type RemoteDesktopSession } from '../core/services/remote-desktop.service';
import type { SshConnectionInfo } from '../proto/connection';
import { spawnTerminal, killTerminal, writeToTerminal } from '../core/services/terminal.service';
import { useNotify } from '../core/notification';
import { TerminalEmulator } from '../features/terminal';
import type { TerminalEmulatorHandle } from '../features/terminal';
import type { PtyConfig } from '../proto';
import { useFeatureGate, LockedScreen } from '../features/licensing';

type Step = 'config' | 'connecting' | 'setup' | 'viewer';
type Mode = 'x11' | 'vnc';
type SetupPhase = 'checking' | 'install' | 'password' | 'start' | 'ready' | 'error';

interface SetupStep {
  id: SetupPhase;
  title: string;
  description: string;
  command: string;
  startCommand?: string;
  status: 'pending' | 'running' | 'done' | 'failed';
}

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
  const [session, setSession] = useState<RemoteDesktopSession | null>(null);
  const [showResetPassword, setShowResetPassword] = useState(false);

  const [setupSteps, setSetupSteps] = useState<SetupStep[]>([]);
  const [currentPhase, setCurrentPhase] = useState<SetupPhase>('checking');

  const setupTerminalIdRef = useRef<string | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const terminalRef = useRef<TerminalEmulatorHandle | null>(null);
  const sshRef = useRef<SshConnectionInfo | null>(null);
  // 跟踪最新的 session 值，供卸载清理函数使用，避免 useEffect 闭包陷阱。
  const sessionRef = useRef<RemoteDesktopSession | null>(null);

  const bgColor = isDark ? '#0d1117' : '#f5f5f5';
  const cardBg = isDark ? '#161B22' : '#ffffff';
  const textColor = isDark ? '#c9d1d9' : '#24292f';
  const accentColor = '#6C63FF';

  const getPasswordStrength = useCallback((pwd: string): { level: 'weak' | 'medium' | 'strong'; color: string } => {
    if (pwd.length < 6) return { level: 'weak', color: '#ff5252' };
    let score = 0;
    if (pwd.length >= 8) score++;
    if (pwd.length >= 12) score++;
    if (/[a-z]/.test(pwd) && /[A-Z]/.test(pwd)) score++;
    if (/\d/.test(pwd)) score++;
    if (/[!@#$%^&*(),.?":{}|<>]/.test(pwd)) score++;
    if (score <= 1) return { level: 'weak', color: '#ff5252' };
    if (score <= 3) return { level: 'medium', color: '#ffb74d' };
    return { level: 'strong', color: '#4caf50' };
  }, []);

  const updateStep = useCallback((id: SetupPhase, updates: Partial<SetupStep>) => {
    setSetupSteps(prev => prev.map(s => s.id === id ? { ...s, ...updates } : s));
  }, []);

  const getSshConfig = useCallback((): SshConnectionInfo => ({
    host,
    port: parseInt(port) || 22,
    username,
    auth_method: authMethod as 'none' | 'password' | 'private_key',
    private_key_path: authMethod === 'private_key' ? privateKeyPath : undefined,
    password: authMethod === 'password' ? password : undefined,
  }), [host, port, username, authMethod, privateKeyPath, password]);

  const executeInTerminal = useCallback(async (command: string) => {
    const term = terminalRef.current;
    if (!term || !setupTerminalIdRef.current) return;
    term.focus();
    term.paste(command);
    await new Promise(r => setTimeout(r, 50));
    const encoder = new TextEncoder();
    const bytes = Array.from(encoder.encode('\r'));
    await writeToTerminal(setupTerminalIdRef.current, bytes);
  }, []);

  const checkVncStatus = useCallback(async () => {
    if (!sshRef.current) return;
    try {
      const result = await setupRemoteDesktop(sshRef.current, parseInt(vncPort) || 5900);
      return result;
    } catch (e) {
      return null;
    }
  }, [vncPort]);

  const handleConnect = useCallback(async () => {
    if (!host || !username) {
      notify(t('fill_required_fields'));
      return;
    }

    const ssh = getSshConfig();
    sshRef.current = ssh;
    setStep('connecting');

    try {
      if (mode === 'vnc') {
        const setupSessionId = `vnc-setup-${Date.now()}`;
        setupTerminalIdRef.current = setupSessionId;

        const config: PtyConfig = {
          rows: 24,
          cols: 80,
          connection_type: 'ssh',
          ssh,
        };

        await spawnTerminal(setupSessionId, config);

        setSetupSteps([
          { id: 'checking', title: 'Check VNC Status', description: 'Detect if VNC server is installed and running', command: '', status: 'running' },
          { id: 'install', title: 'Install VNC Server', description: 'Install TigerVNC on the remote server', command: '', status: 'pending' },
          { id: 'password', title: 'Set VNC Password', description: 'Set a password for VNC authentication', command: '', status: 'pending' },
          { id: 'start', title: 'Start VNC Server', description: 'Launch VNC server with display', command: '', status: 'pending' },
          { id: 'ready', title: 'Connect', description: 'Establish SSH tunnel and connect', command: '', status: 'pending' },
        ]);
        setCurrentPhase('checking');
        setStep('setup');

        await new Promise(r => setTimeout(r, 1500));

        const result = await checkVncStatus();
        if (!result) {
          updateStep('checking', { status: 'failed', description: 'Failed to connect to remote server' });
          setCurrentPhase('error');
          return;
        }

        if (result.vncInstalled && result.vncRunning) {
          updateStep('checking', { status: 'done', description: 'VNC is installed and running' });
          updateStep('install', { status: 'done', description: 'Already installed' });
          if (result.needsPassword) {
            updateStep('password', {
              status: 'pending',
              description: 'VNC requires a password to connect. Enter a password below (at least 6 characters).',
              command: '',
            });
            updateStep('start', { status: 'done', description: 'Already running' });
            setCurrentPhase('password');
          } else {
            updateStep('password', { status: 'done', description: 'Password already configured' });
            updateStep('start', { status: 'done', description: 'Already running' });
            updateStep('ready', {
              status: 'pending',
              description: 'Enter the VNC password you set on the remote server, then click Connect.',
            });
            setCurrentPhase('ready');
          }
          return;
        }

        if (result.vncInstalled && !result.vncRunning) {
          updateStep('checking', { status: 'done', description: 'VNC is installed but not running' });
          updateStep('install', { status: 'done', description: 'Already installed' });
          if (result.needsPassword) {
            updateStep('password', {
              status: 'pending',
              description: 'VNC requires a password to connect. Enter a password below (at least 6 characters).',
              command: '',
            });
            updateStep('start', {
              status: 'pending',
              description: 'After setting the password, start the VNC server.',
              command: result.setupHint ? `${result.setupHint} && ${result.startHint}` : result.startHint,
            });
            setCurrentPhase('password');
          } else {
            updateStep('password', { status: 'done', description: 'Password already set' });
            if (result.setupHint) {
              updateStep('start', {
                status: 'pending',
                description: 'Configure desktop environment and start VNC server.',
                command: `${result.setupHint} && ${result.startHint}`,
              });
            } else {
              updateStep('start', {
                status: 'pending',
                description: 'VNC is installed but not running. Click to start it.',
                command: result.startHint,
              });
            }
            setCurrentPhase('start');
          }
          return;
        }

        updateStep('checking', { status: 'done', description: 'VNC is not installed' });
        updateStep('install', {
          status: 'pending',
          description: 'VNC server not found. Click to install.',
          command: result.installHint,
        });
        updateStep('password', {
          status: 'pending',
          description: 'After installation, set a VNC password.',
          command: '',
        });
        updateStep('start', {
          status: 'pending',
          description: 'After setting the password, start VNC server.',
          command: result.startHint,
        });
        setCurrentPhase('install');
      } else {
        const sessionId = `x11-${Date.now()}`;
        sessionIdRef.current = sessionId;

        const config: PtyConfig = {
          rows: 24,
          cols: 80,
          connection_type: 'ssh',
          ssh,
          x11_forwarding: true,
        };

        await spawnTerminal(sessionId, config);
        setStep('viewer');
      }
    } catch (err: any) {
      notify(err?.toString() || t('connection_failed'));
      setStep('config');
    }
  }, [host, port, username, authMethod, privateKeyPath, password, vncPort, mode, notify, t, getSshConfig, checkVncStatus, updateStep]);

  const pollVncStatus = useCallback(async (phase: SetupPhase, checkFn: (result: any) => boolean, onSuccess: (result: any) => void, maxWaitMs: number = 180000) => {
    const intervalMs = 5000;
    const start = Date.now();

    while (Date.now() - start < maxWaitMs) {
      await new Promise(r => setTimeout(r, intervalMs));

      const result = await checkVncStatus();
      if (result && checkFn(result)) {
        onSuccess(result);
        return;
      }
    }

    updateStep(phase, { status: 'failed', description: 'Timed out waiting for operation to complete. Check terminal output and try again.' });
  }, [checkVncStatus, updateStep]);

  const handleExecuteStep = useCallback(async (phase: SetupPhase) => {
    const stepData = setupSteps.find(s => s.id === phase);
    if (!stepData || !stepData.command) return;

    updateStep(phase, { status: 'running', description: phase === 'install' ? 'Installing VNC and desktop environment... (this may take several minutes)' : 'Setting up desktop environment and starting VNC... (this may take several minutes)' });

    const fullCommand = stepData.startCommand
      ? `${stepData.command} && ${stepData.startCommand}`
      : stepData.command;

    await executeInTerminal(fullCommand);

    if (phase === 'install') {
      await pollVncStatus(
        'install',
        (result) => result.vncInstalled,
        (result) => {
          updateStep('install', { status: 'done', description: 'VNC server installed successfully' });
          if (result.needsPassword) {
            updateStep('password', {
              status: 'pending',
              description: 'VNC requires a password. Enter a password below (at least 6 characters).',
              command: '',
            });
            setCurrentPhase('password');
          } else {
            updateStep('password', { status: 'done', description: 'Password already set' });
            if (result.setupHint) {
              updateStep('start', {
                status: 'pending',
                description: 'Configure desktop environment and start VNC server.',
                command: `${result.setupHint} && ${result.startHint}`,
              });
            } else {
              updateStep('start', {
                status: 'pending',
                description: 'VNC installed. Click to start it.',
                command: result.startHint,
              });
            }
            setCurrentPhase('start');
          }
        },
        600000
      );
    } else if (phase === 'start') {
      await pollVncStatus(
        'start',
        (result) => result.vncRunning,
        () => {
          updateStep('start', { status: 'done', description: 'VNC server is running' });
          updateStep('ready', {
            status: 'pending',
            description: 'VNC is ready. Click to connect to remote desktop.',
          });
          setCurrentPhase('ready');
        },
        600000
      );
    }
  }, [setupSteps, updateStep, executeInTerminal, pollVncStatus]);

  const handleSetPassword = useCallback(async (password: string) => {
    if (!password || password.length < 6) return;

    updateStep('password', { status: 'running', description: 'Setting VNC password...' });

    // Use vncpasswd -f to read password from stdin (TigerVNC supports this)
    // -f reads password once from stdin, outputs encrypted hash to stdout
    const escapedPwd = password.replace(/'/g, "'\\''");
    const cmd = `mkdir -p ~/.vnc && printf '%s\\n' '${escapedPwd}' | vncpasswd -f > ~/.vnc/passwd && chmod 600 ~/.vnc/passwd`;

    await executeInTerminal(cmd);

    // Wait a moment then check if password was set
    await new Promise(r => setTimeout(r, 2000));

    const result = await checkVncStatus();
    if (result && !result.needsPassword) {
      updateStep('password', { status: 'done', description: 'VNC password set successfully' });
      setVncPassword(password);

      // If this is a password reset (VNC was already running), need to restart VNC
      if (showResetPassword && result.vncRunning) {
        // Construct stop command based on display
        const stopCmd = result.display ? `vncserver -kill ${result.display}` : 'pkill -f vncserver || true';
        updateStep('start', {
          status: 'pending',
          description: t('restart_vnc_after_password_reset', {
            defaultValue: 'Password changed. VNC server needs to restart to use the new password. Click to restart.',
          }),
          command: `${stopCmd} && sleep 2 && ${result.startHint}`,
        });
        setCurrentPhase('start');
        setShowResetPassword(false);
      } else if (result.vncRunning) {
        // VNC is running and this is initial setup, go to connect
        updateStep('start', { status: 'done', description: 'Already running' });
        updateStep('ready', {
          status: 'pending',
          description: 'VNC is ready. Click to connect to remote desktop.',
        });
        setCurrentPhase('ready');
      } else if (result.setupHint) {
        updateStep('start', {
          status: 'pending',
          description: 'Password set. Now configure and start VNC server.',
          command: `${result.setupHint} && ${result.startHint}`,
        });
        setCurrentPhase('start');
      } else {
        updateStep('start', {
          status: 'pending',
          description: 'Password set. Click to start VNC server.',
          command: result.startHint,
        });
        setCurrentPhase('start');
      }
    } else {
      updateStep('password', { status: 'failed', description: 'Failed to set password. Try again or set it manually via vncpasswd.' });
    }
  }, [updateStep, executeInTerminal, checkVncStatus, showResetPassword, t]);

  const handleConnectVnc = useCallback(async () => {
    if (!sshRef.current) return;
    try {
      updateStep('ready', { status: 'running' });

      if (setupTerminalIdRef.current) {
        try { await killTerminal(setupTerminalIdRef.current); } catch {}
        setupTerminalIdRef.current = null;
      }

      const result = await checkVncStatus();
      console.log('[RemoteDesktop] checkVncStatus result:', JSON.stringify(result));
      if (result?.vncRunning) {
        const desktopSession = await createRemoteDesktop(`rd-${Date.now()}`, sshRef.current!, result.vncPort);
        console.log('[RemoteDesktop] createRemoteDesktop result:', JSON.stringify(desktopSession));
        setSession(desktopSession);
        sessionRef.current = desktopSession;
        updateStep('ready', { status: 'done', description: 'Connected!' });
        setStep('viewer');
      } else {
        updateStep('ready', { status: 'failed', description: 'VNC is not running. Please start it first.' });
      }
    } catch (e) {
      console.error('[RemoteDesktop] handleConnectVnc error:', e);
      updateStep('ready', { status: 'failed', description: 'Connection failed' });
    }
  }, [checkVncStatus, updateStep]);

  const handleClose = useCallback(async () => {
    if (session) {
      try { await closeRemoteDesktop(session.id); } catch {}
    }
    if (setupTerminalIdRef.current) {
      try { await killTerminal(setupTerminalIdRef.current); } catch {}
      setupTerminalIdRef.current = null;
    }
    if (sessionIdRef.current) {
      try { await killTerminal(sessionIdRef.current); } catch {}
      sessionIdRef.current = null;
    }
    setSession(null);
    sessionRef.current = null;
    setStep('config');
    setSetupSteps([]);
    setCurrentPhase('checking');
  }, [session]);

  useEffect(() => {
    return () => {
      // 使用 sessionRef 而非 session 状态，避免闭包捕获挂载时的初始值（null）。
      // 这样组件卸载时能正确关闭后续创建的远程桌面会话。
      const currentSession = sessionRef.current;
      if (currentSession) {
        closeRemoteDesktop(currentSession.id).catch(() => {});
      }
      if (setupTerminalIdRef.current) {
        killTerminal(setupTerminalIdRef.current).catch(() => {});
      }
      if (sessionIdRef.current) {
        killTerminal(sessionIdRef.current).catch(() => {});
      }
    };
  }, []);

  // License gate: remote desktop is a Pro feature. Free / expired users see
  // a locked screen instead of the connection UI.
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
          {sessionIdRef.current && (
            <TerminalEmulator
              ref={terminalRef}
              sessionId={sessionIdRef.current}
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
        <Box sx={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
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
              {setupSteps.map((s, idx) => {
                const isActive = s.id === currentPhase;
                const showExecute = isActive && (s.status === 'pending' || s.status === 'failed') && s.command;
                const showPasswordInput = s.id === 'password' && isActive && (s.status === 'pending' || s.status === 'failed');
                const showConnect = s.id === 'ready' && currentPhase === 'ready';

                return (
                  <Paper
                    key={s.id}
                    variant="outlined"
                    sx={{
                      p: 1.5,
                      borderColor: isActive ? accentColor : s.status === 'failed' ? '#f44336' : 'divider',
                      borderWidth: isActive ? 2 : 1,
                      bgcolor: isActive ? (isDark ? 'rgba(108,99,255,0.06)' : 'rgba(108,99,255,0.04)') : 'transparent',
                      opacity: s.status === 'pending' && !isActive ? 0.5 : 1,
                    }}
                  >
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                      {s.status === 'done' ? (
                        <CheckCircleIcon size={18} weight="fill" color="#4caf50" />
                      ) : s.status === 'failed' ? (
                        <XCircleIcon size={18} weight="fill" color="#f44336" />
                      ) : s.status === 'running' ? (
                        <CircularProgress size={16} sx={{ color: accentColor }} />
                      ) : (
                        <Box sx={{ width: 18, height: 18, borderRadius: '50%', border: '2px solid', borderColor: isActive ? accentColor : 'divider', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <Typography variant="caption" sx={{ fontSize: 10, color: isActive ? accentColor : 'text.secondary', fontWeight: 700 }}>
                            {idx + 1}
                          </Typography>
                        </Box>
                      )}
                      <Typography variant="body2" sx={{ fontWeight: 600, color: textColor, fontSize: 13 }}>
                        {s.title}
                      </Typography>
                    </Box>

                    <Typography variant="caption" sx={{ color: 'text.secondary', lineHeight: 1.4, display: 'block', ml: 3.2, mb: s.command && (showExecute || isActive) ? 1 : 0 }}>
                      {s.description}
                    </Typography>

                    {s.status === 'running' && isActive && (
                      <Box sx={{ ml: 3.2, mt: 0.5, display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <CircularProgress size={10} sx={{ color: accentColor }} />
                        <Typography variant="caption" sx={{ color: accentColor, fontSize: 10 }}>
                          Checking every 5s...
                        </Typography>
                      </Box>
                    )}

                    {s.command && isActive && (
                      <Paper
                        variant="outlined"
                        sx={{
                          ml: 3.2,
                          p: 1,
                          bgcolor: isDark ? '#0d1117' : '#f5f5f5',
                          borderColor: 'divider',
                          position: 'relative',
                        }}
                      >
                        <Typography
                          variant="caption"
                          sx={{
                            fontFamily: 'monospace',
                            fontSize: 11,
                            color: accentColor,
                            wordBreak: 'break-all',
                            lineHeight: 1.5,
                            display: 'block',
                            pr: 4,
                          }}
                        >
                          {s.command}
                        </Typography>
                        <Button
                          size="small"
                          onClick={() => navigator.clipboard.writeText(s.command)}
                          sx={{ position: 'absolute', top: 2, right: 2, minWidth: 'auto', px: 0.5, py: 0, fontSize: 9, textTransform: 'none', color: 'text.secondary' }}
                        >
                          Copy
                        </Button>
                      </Paper>
                    )}

                    {showExecute && (
                      <Box sx={{ ml: 3.2, mt: 1 }}>
                        <Button
                          size="small"
                          variant="contained"
                          startIcon={<PlayIcon size={14} weight="fill" />}
                          onClick={() => handleExecuteStep(s.id)}
                          sx={{
                            bgcolor: accentColor,
                            '&:hover': { bgcolor: '#5A52E0' },
                            textTransform: 'none',
                            fontWeight: 600,
                            fontSize: 12,
                            py: 0.3,
                          }}
                        >
                          Execute
                        </Button>
                      </Box>
                    )}

                    {showPasswordInput && (
                      <Box sx={{ ml: 3.2, mt: 1.5, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                        {showResetPassword && (
                          <Paper variant="outlined" sx={{ p: 1.5, bgcolor: isDark ? 'rgba(255,152,0,0.05)' : 'rgba(255,152,0,0.02)', borderColor: isDark ? 'rgba(255,152,0,0.3)' : 'rgba(255,152,0,0.2)' }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
                              <WarningIcon size={14} weight="fill" color="#ff9800" />
                              <Typography variant="caption" sx={{ fontWeight: 600, color: '#ff9800' }}>
                                {t('reset_password_warning_title', { defaultValue: 'Resetting VNC Password' })}
                              </Typography>
                            </Box>
                            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                              {t('reset_password_warning_desc', { defaultValue: 'This will overwrite the existing VNC password on the remote server. After setting, use the new password to connect.' })}
                            </Typography>
                          </Paper>
                        )}
                        <Paper variant="outlined" sx={{ p: 1.5, bgcolor: isDark ? 'rgba(108,99,255,0.05)' : 'rgba(108,99,255,0.02)', borderColor: isDark ? 'rgba(108,99,255,0.2)' : 'rgba(108,99,255,0.1)' }}>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 1 }}>
                            <LockIcon size={14} weight="fill" color={accentColor} />
                            <Typography variant="caption" sx={{ fontWeight: 600, color: accentColor }}>
                              {t('password_setup_title')}
                            </Typography>
                          </Box>
                          <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 1 }}>
                            {t('password_setup_desc')}
                          </Typography>
                          <Box component="ul" sx={{ m: 0, pl: 2, li: { mb: 0.3 } }}>
                            <Typography component="li" variant="caption" sx={{ color: 'text.secondary' }}>
                              {t('password_stored_remotely')}
                            </Typography>
                            <Typography component="li" variant="caption" sx={{ color: 'text.secondary' }}>
                              {t('password_required_on_connect')}
                            </Typography>
                            <Typography component="li" variant="caption" sx={{ color: 'text.secondary' }}>
                              {t('password_min_length')}
                            </Typography>
                          </Box>
                        </Paper>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <TextField
                            size="small"
                            type="password"
                            placeholder={t('password_placeholder_set')}
                            value={vncPassword}
                            onChange={(e) => setVncPassword(e.target.value)}
                            sx={{
                              flex: 1,
                              '& .MuiInputBase-input': { fontSize: 12, py: 0.5 },
                              '& .MuiOutlinedInput-root': { borderRadius: 1 },
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && vncPassword.length >= 6) {
                                handleSetPassword(vncPassword);
                              }
                            }}
                          />
                          <Button
                            size="small"
                            variant="contained"
                            disabled={vncPassword.length < 6}
                            startIcon={<LockIcon size={14} weight="fill" />}
                            onClick={() => handleSetPassword(vncPassword)}
                            sx={{
                              bgcolor: accentColor,
                              '&:hover': { bgcolor: '#5A52E0' },
                              '&:disabled': { bgcolor: 'action.disabledBackground' },
                              textTransform: 'none',
                              fontWeight: 600,
                              fontSize: 12,
                              py: 0.3,
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {t('set_password')}
                          </Button>
                        </Box>
                        {vncPassword.length > 0 && (
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: 10 }}>
                              {t('password_strength_hint')}:
                            </Typography>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                              <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: getPasswordStrength(vncPassword).color }} />
                              <Typography variant="caption" sx={{ color: getPasswordStrength(vncPassword).color, fontWeight: 600, fontSize: 10 }}>
                                {t(`password_strength_${getPasswordStrength(vncPassword).level}`)}
                              </Typography>
                            </Box>
                          </Box>
                        )}
                      </Box>
                    )}

                    {showConnect && (
                      <Box sx={{ ml: 3.2, mt: 1.5, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                        <Paper variant="outlined" sx={{ p: 1.5, bgcolor: isDark ? 'rgba(76,175,80,0.05)' : 'rgba(76,175,80,0.02)', borderColor: isDark ? 'rgba(76,175,80,0.2)' : 'rgba(76,175,80,0.1)' }}>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 1 }}>
                            <LockIcon size={14} weight="fill" color="#4caf50" />
                            <Typography variant="caption" sx={{ fontWeight: 600, color: '#4caf50' }}>
                              {t('password_connect_title')}
                            </Typography>
                          </Box>
                          <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 0.5 }}>
                            {t('password_connect_desc')}
                          </Typography>
                          <Typography variant="caption" sx={{ color: 'text.secondary', fontStyle: 'italic' }}>
                            {t('password_connect_hint')}
                          </Typography>
                        </Paper>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <TextField
                            size="small"
                            type="password"
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
                          />
                          <Button
                            size="small"
                            variant="contained"
                            disabled={!vncPassword}
                            startIcon={<ArrowRightIcon size={14} weight="bold" />}
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
                        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: 10 }}>
                            {t('dont_know_password', { defaultValue: "Don't know the password?" })}
                          </Typography>
                          <Button
                            size="small"
                            variant="text"
                            startIcon={<LockIcon size={12} />}
                            onClick={() => {
                              setShowResetPassword(true);
                              setCurrentPhase('password');
                              updateStep('password', {
                                status: 'pending',
                                description: t('reset_password_desc', { defaultValue: 'Set a new VNC password on the remote server.' }),
                              });
                            }}
                            sx={{
                              textTransform: 'none',
                              fontSize: 10,
                              color: accentColor,
                              py: 0.2,
                              minWidth: 'auto',
                            }}
                          >
                            {t('reset_password', { defaultValue: 'Reset Password' })}
                          </Button>
                        </Box>
                      </Box>
                    )}
                  </Paper>
                );
              })}
            </Box>

            <Box sx={{ p: 2, borderTop: '1px solid', borderColor: 'divider' }}>
              <Button
                fullWidth
                variant="outlined"
                size="small"
                onClick={handleClose}
                sx={{ textTransform: 'none' }}
              >
                Cancel
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
                  type="password"
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

                  <Paper variant="outlined" sx={{ p: 1.5, bgcolor: isDark ? 'rgba(108,99,255,0.06)' : 'rgba(108,99,255,0.04)', borderColor: `${accentColor}30` }}>
                    <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
                      <InfoIcon size={14} color={accentColor} />
                      <Typography variant="caption" sx={{ color: 'text.secondary', lineHeight: 1.5 }}>
                        Will auto-detect VNC on the remote server and guide you through setup if needed.
                      </Typography>
                    </Box>
                  </Paper>

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
                    <TextField
                      label={t('vnc_password')}
                      value={vncPassword}
                      onChange={(e) => setVncPassword(e.target.value)}
                      size="small"
                      fullWidth
                      type="password"
                      helperText="Optional, for VNC auth"
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
