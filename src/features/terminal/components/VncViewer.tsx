import { useEffect, useRef, useState, useCallback } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Paper from '@mui/material/Paper';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import InputAdornment from '@mui/material/InputAdornment';
import {
  ArrowsOutIcon,
  ArrowRightIcon,
  XIcon,
  InfoIcon,
  WarningIcon,
  EyeIcon,
  EyeSlashIcon,
} from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@mui/material/styles';
import RFB from '@novnc/novnc';

interface VncViewerProps {
  wsUrl: string;
  vncPassword?: string;
  onClose?: () => void;
}

type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'error' | 'needs_password';

export function VncViewer({ wsUrl, vncPassword, onClose }: VncViewerProps) {
  const { t } = useTranslation('remoteDesktop');
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const containerRef = useRef<HTMLDivElement>(null);
  const rfbRef = useRef<any>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [desktopName, setDesktopName] = useState<string>('');
  const [pendingPassword, setPendingPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [ready, setReady] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const authFailedRef = useRef(false);
  const needsPasswordRef = useRef(false);
  const pendingPasswordRef = useRef('');

  useEffect(() => {
    const timer = setTimeout(() => setReady(true), 500);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!ready) return;
    if (!wsUrl || (!wsUrl.startsWith('ws://') && !wsUrl.startsWith('wss://'))) {
      setConnectionState('error');
      setErrorMessage('Invalid WebSocket URL');
      return;
    }

    let disposed = false;
    let rfbInstance: any = null;

    console.log('[VncViewer] Creating RFB connection to:', wsUrl);

    try {
      if (!containerRef.current) {
        setConnectionState('error');
        setErrorMessage('Container not ready');
        return;
      }

      const options: Record<string, unknown> = {
        wsProtocols: ['binary'],
      };

      const effectivePassword = pendingPasswordRef.current || vncPassword;
      if (effectivePassword) {
        options.credentials = { password: effectivePassword };
      }

      const rfb = new RFB(containerRef.current, wsUrl, options);
      rfbInstance = rfb;
      rfbRef.current = rfb;

      rfb.addEventListener('connect', () => {
        if (!disposed) setConnectionState('connected');
      });

      rfb.addEventListener('disconnect', (e: any) => {
        if (!disposed) {
          const clean = e.detail?.clean;
          const reason = e.detail?.reason || '';
          console.error('[VncViewer] disconnect event, clean:', clean, 'detail:', JSON.stringify(e.detail));
          // Don't override error state set by securityfailure
          if (authFailedRef.current) {
            rfbRef.current = null;
            rfbInstance = null;
            return;
          }
          setConnectionState(prev => {
            // Keep needs_password state so user can still enter password on retry
            if (prev === 'needs_password') return 'error';
            return clean ? 'disconnected' : 'error';
          });
          if (!clean) {
            // Provide more specific error messages
            if (reason) {
              setErrorMessage(`${t('connection_lost')}: ${reason}`);
            } else {
              setErrorMessage(t('connection_lost_detailed', {
                defaultValue: 'Connection lost. Possible causes:\n• VNC server not running\n• SSH tunnel disconnected\n• Network issue'
              }));
            }
          }
          rfbRef.current = null;
          rfbInstance = null;
        }
      });

      rfb.addEventListener('credentialsrequired', () => {
        needsPasswordRef.current = true;
        if (rfbRef.current && vncPassword) {
          rfbRef.current.sendCredentials({ password: vncPassword });
        } else if (!disposed) {
          setConnectionState('needs_password');
        }
      });

      rfb.addEventListener('securityfailure', (e: any) => {
        if (!disposed) {
          console.error('[VncViewer] securityfailure event:', JSON.stringify(e.detail));
          authFailedRef.current = true;
          const reason = e.detail?.reason || '';
          if (reason) {
            setErrorMessage(`Authentication failed: ${reason}`);
          } else {
            setErrorMessage('VNC authentication failed. Please check your password.');
          }
          setConnectionState('error');
        }
      });

      rfb.addEventListener('desktopname', (e: any) => {
        if (!disposed && e.detail?.name) {
          setDesktopName(e.detail.name);
        }
      });

      rfb.scaleViewport = true;
      rfb.resizeSession = false;
    } catch (err: any) {
      if (!disposed) {
        setConnectionState('error');
        setErrorMessage(err?.message || t('connection_failed'));
      }
    }

    return () => {
      disposed = true;
      console.log('[VncViewer] Cleanup, rfbInstance exists:', !!rfbInstance);
      if (rfbInstance) {
        try { rfbInstance.disconnect(); } catch {}
        rfbInstance = null;
      }
      rfbRef.current = null;
    };
  }, [ready, wsUrl, vncPassword, retryCount, t]);

  const handleFullscreen = useCallback(() => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  }, []);

  const bgColor = isDark ? '#0d1117' : '#f5f5f5';
  const textColor = isDark ? '#c9d1d9' : '#24292f';

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', bgcolor: bgColor }}>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          px: 1.5,
          py: 0.5,
          borderBottom: '1px solid',
          borderColor: 'divider',
          minHeight: 36,
          bgcolor: isDark ? '#161B22' : '#f0f0f0',
        }}
      >
        <Box
          sx={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            bgcolor:
              connectionState === 'connected'
                ? '#81C784'
                : connectionState === 'connecting'
                  ? '#FFB74D'
                  : connectionState === 'needs_password'
                    ? '#FFB74D'
                    : '#FF7B72',
          }}
        />
        <Typography variant="caption" sx={{ fontWeight: 600, flex: 1, color: textColor }} noWrap>
          {desktopName || t('remote_desktop')}
          {connectionState === 'connecting' && ` — ${t('connecting')}`}
          {connectionState === 'error' && ` — ${t('error')}`}
          {connectionState === 'needs_password' && ' — Password Required'}
        </Typography>

        {connectionState === 'connected' && (
          <Tooltip title={t('fullscreen')}>
            <IconButton size="small" onClick={handleFullscreen}>
              <ArrowsOutIcon size={14} color={isDark ? '#8B949E' : '#6B7280'} />
            </IconButton>
          </Tooltip>
        )}
        {onClose && (
          <Tooltip title={t('close')}>
            <IconButton size="small" onClick={onClose}>
              <XIcon size={14} color={isDark ? '#FF5252' : '#D32F2F'} />
            </IconButton>
          </Tooltip>
        )}
      </Box>

      <Box sx={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        <Box
          ref={containerRef}
          sx={{
            width: '100%',
            height: '100%',
            '& canvas': { display: 'block' },
            '& .noVNC_status': { display: 'none' },
          }}
        />

        {connectionState === 'connecting' && (
          <Box
            sx={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 2,
              bgcolor: `${bgColor}ee`,
            }}
          >
            <CircularProgress size={32} sx={{ color: '#6C63FF' }} />
            <Typography variant="body2" sx={{ color: textColor }}>
              {t('connecting_to_vnc')}
            </Typography>
          </Box>
        )}

        {connectionState === 'error' && (
          <Box
            sx={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 2,
              bgcolor: `${bgColor}ee`,
            }}
          >
            <WarningIcon size={40} weight="fill" color="#FF7B72" />
            <Typography variant="body2" sx={{ color: '#FF7B72', fontWeight: 600 }}>
              {t('connection_failed')}
            </Typography>
            {errorMessage && (
              <Paper variant="outlined" sx={{ p: 1.5, maxWidth: 400, bgcolor: isDark ? 'rgba(255,123,114,0.08)' : 'rgba(255,123,114,0.04)', borderColor: 'rgba(255,123,114,0.3)' }}>
                <Typography variant="caption" sx={{ color: textColor, fontFamily: 'monospace', wordBreak: 'break-all' }}>
                  {errorMessage}
                </Typography>
              </Paper>
            )}
            <Typography variant="caption" sx={{ color: 'text.secondary', maxWidth: 400, textAlign: 'center', mt: 1 }}>
              {t('connection_failed_hint')}
            </Typography>
            <Button
              size="small"
              variant="outlined"
              onClick={() => {
                authFailedRef.current = false;
                setPendingPassword('');
                pendingPasswordRef.current = '';
                if (needsPasswordRef.current && !vncPassword) {
                  setConnectionState('needs_password');
                  setRetryCount(c => c + 1);
                } else {
                  setRetryCount(c => c + 1);
                }
              }}
              sx={{ mt: 1, textTransform: 'none', borderColor: isDark ? '#30363d' : '#d0d7de', color: textColor }}
            >
              Retry
            </Button>
          </Box>
        )}

        {connectionState === 'disconnected' && (
          <Box
            sx={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 2,
              bgcolor: `${bgColor}ee`,
            }}
          >
            <InfoIcon size={40} weight="fill" color="#8B949E" />
            <Typography variant="body2" sx={{ color: textColor }}>
              {t('disconnected')}
            </Typography>
          </Box>
        )}

        {connectionState === 'needs_password' && (
          <Box
            sx={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 2,
              bgcolor: `${bgColor}ee`,
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <WarningIcon size={24} weight="fill" color="#FFB74D" />
              <Typography variant="body2" sx={{ color: textColor, fontWeight: 600 }}>
                VNC Password Required
              </Typography>
            </Box>
            <Typography variant="caption" sx={{ color: 'text.secondary', maxWidth: 360, textAlign: 'center' }}>
              Enter the VNC password you set via vncpasswd on the remote server.
            </Typography>
            <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
              <TextField
                type={showPassword ? 'text' : 'password'}
                placeholder="VNC Password"
                value={pendingPassword}
                onChange={(e) => {
                  setPendingPassword(e.target.value);
                  pendingPasswordRef.current = e.target.value;
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && pendingPassword) {
                    if (rfbRef.current) {
                      rfbRef.current.sendCredentials({ password: pendingPassword });
                      setConnectionState('connecting');
                    } else {
                      // Connection lost while waiting, retry with this password
                      authFailedRef.current = false;
                      setRetryCount(c => c + 1);
                    }
                  }
                }}
                size="small"
                autoFocus
                sx={{ width: 220 }}
                slotProps={{
                  input: {
                    endAdornment: (
                      <InputAdornment position="end">
                        <IconButton
                          aria-label={t('toggle_password_visibility')}
                          onClick={() => setShowPassword((v) => !v)}
                          edge="end"
                          size="small"
                        >
                          {showPassword ? <EyeSlashIcon size={16} /> : <EyeIcon size={16} />}
                        </IconButton>
                      </InputAdornment>
                    ),
                  },
                }}
              />
              <IconButton
                size="small"
                onClick={() => {
                  if (pendingPassword) {
                    if (rfbRef.current) {
                      rfbRef.current.sendCredentials({ password: pendingPassword });
                      setConnectionState('connecting');
                    } else {
                      authFailedRef.current = false;
                      setRetryCount(c => c + 1);
                    }
                  }
                }}
                sx={{
                  bgcolor: '#6C63FF',
                  '&:hover': { bgcolor: '#5a52e0' },
                  color: '#fff',
                  width: 32,
                  height: 32,
                }}
              >
                <ArrowRightIcon size={16} weight="bold" />
              </IconButton>
            </Box>
          </Box>
        )}
      </Box>
    </Box>
  );
}
