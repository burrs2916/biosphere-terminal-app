import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import ListItemIcon from '@mui/material/ListItemIcon';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Divider from '@mui/material/Divider';
import TextField from '@mui/material/TextField';
import Stack from '@mui/material/Stack';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import InputLabel from '@mui/material/InputLabel';
import FormControl from '@mui/material/FormControl';
import CircularProgress from '@mui/material/CircularProgress';
import Alert from '@mui/material/Alert';
import InputAdornment from '@mui/material/InputAdornment';
import IconButton from '@mui/material/IconButton';
import { useTheme } from '@mui/material/styles';
import {
  DesktopIcon,
  LightningIcon,
  PlusIcon,
  ArrowRightIcon,
  PlugsConnectedIcon,
  ArrowSquareOutIcon,
  CheckCircleIcon,
  WarningIcon,
  EyeIcon,
  EyeSlashIcon,
} from '@phosphor-icons/react';
import { useNavigate } from 'react-router-dom';
import { listConnections, saveConnection, testConnection } from '../../../core/services/connection.service';
import { useNotify } from '../../../core/notification';
import { localizeBackendError } from '../../../core/backendError';
import type { ConnectionConfig, SshConnectionInfo } from '../../../proto';
import { generateId } from '../../../core/utils';

export interface ConnectionPickerResult {
  connectionType: 'local' | 'ssh';
  ssh?: SshConnectionInfo;
  name: string;
  /** 既有连接发起时携带其 id，用于在连接管理页标记"使用中"；新建/本地连接无此值 */
  connectionId?: string;
}

interface ConnectionPickerProps {
  open: boolean;
  onConnect: (result: ConnectionPickerResult) => void;
  onClose: () => void;
}

export function ConnectionPicker({ open, onConnect, onClose }: ConnectionPickerProps) {
  const { t } = useTranslation('terminal');
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const navigate = useNavigate();
  const [connections, setConnections] = useState<ConnectionConfig[]>([]);
  const [mode, setMode] = useState<'main' | 'new-ssh'>('main');
  const [sshName, setSshName] = useState('');
  const [ssh, setSsh] = useState<SshConnectionInfo>({
    host: '',
    port: 22,
    username: '',
    auth_method: 'password',
  });
  const [testState, setTestState] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [testMsg, setTestMsg] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const localColor = isDark ? '#4FC3F7' : '#1565C0';
  const sshColor = isDark ? '#FFD740' : '#E65100';
  const primaryColor = isDark ? '#6C63FF' : '#5B54E0';
  const mutedColor = isDark ? '#8B949E' : '#6B7280';
  const notify = useNotify().notify;

  useEffect(() => {
    if (open) {
      listConnections().then(setConnections).catch((e) => notify(localizeBackendError(e)));
      setMode('main');
      setTestState('idle');
      setTestMsg('');
    }
  }, [open]);

  const savedSshConnections = connections.filter((c) => c.connection_type === 'ssh');

  const handleLocalConnect = () => {
    onConnect({ connectionType: 'local', name: 'Local' });
  };

  const handleSavedConnect = (conn: ConnectionConfig) => {
    let sshInfo: SshConnectionInfo | undefined;
    if (conn.connection_type === 'ssh') {
      try {
        sshInfo = JSON.parse(conn.config_json);
      } catch (err) { console.error('ConnectionPicker: operation failed', err); }
    }
    onConnect({
      connectionType: conn.connection_type as 'local' | 'ssh',
      ssh: sshInfo,
      name: conn.name,
      connectionId: conn.id,
    });
  };

  const handleNewSsh = async () => {
    const conn: ConnectionConfig = {
      id: generateId(),
      name: sshName || `${ssh.username}@${ssh.host}`,
      connection_type: 'ssh',
      config_json: JSON.stringify(ssh),
      created_at: Date.now(),
    };
    await saveConnection(conn);
    onConnect({
      connectionType: 'ssh',
      ssh,
      name: conn.name,
      connectionId: conn.id,
    });
  };

  const handleTestConnection = async () => {
    setTestState('testing');
    setTestMsg('');
    try {
      const msg = await testConnection(ssh);
      setTestState('success');
      setTestMsg(localizeBackendError(msg));
    } catch (e) {
      setTestState('error');
      setTestMsg(localizeBackendError(e));
    }
  };

  const handleGoToConnections = () => {
    onClose();
    navigate('/connections');
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      sx={{
        '& .MuiDialog-paper': {
          borderRadius: 3,
          bgcolor: 'background.paper',
          border: '1px solid',
          borderColor: 'divider',
        },
      }}
    >
      {mode === 'new-ssh' ? (
        <>
          <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <LightningIcon size={22} color={sshColor} weight="fill" />
            {t('picker.new_ssh')}
          </DialogTitle>
          <DialogContent>
            <Stack spacing={2} sx={{ mt: 0.5 }}>
              <TextField
                label={t('picker.connection_name')}
                value={sshName}
                onChange={(e) => setSshName(e.target.value)}
                placeholder="My Server"
                fullWidth
                size="small"
              />
              <Box sx={{ display: 'flex', gap: 2 }}>
                <TextField
                  label={t('picker.host')}
                  value={ssh.host}
                  onChange={(e) => setSsh((s) => ({ ...s, host: e.target.value }))}
                  size="small"
                  sx={{ flex: 1 }}
                  slotProps={{ input: { style: { fontFamily: 'monospace' } } }}
                />
                <TextField
                  label={t('picker.port')}
                  type="number"
                  value={ssh.port}
                  onChange={(e) => setSsh((s) => ({ ...s, port: Number(e.target.value) }))}
                  size="small"
                  sx={{ width: 100 }}
                />
              </Box>
              <TextField
                label={t('picker.username')}
                value={ssh.username}
                onChange={(e) => setSsh((s) => ({ ...s, username: e.target.value }))}
                fullWidth
                size="small"
                slotProps={{ input: { style: { fontFamily: 'monospace' } } }}
              />
              <FormControl size="small" fullWidth>
                <InputLabel>{t('picker.auth_method')}</InputLabel>
                <Select
                  value={ssh.auth_method}
                  label={t('picker.auth_method')}
                  onChange={(e) => setSsh((s) => ({ ...s, auth_method: e.target.value as 'none' | 'password' | 'private_key' }))}
                >
                  <MenuItem value="none">{t('picker.no_auth')}</MenuItem>
                  <MenuItem value="password">{t('picker.password')}</MenuItem>
                  <MenuItem value="private_key">{t('picker.private_key')}</MenuItem>
                </Select>
              </FormControl>
              {ssh.auth_method === 'password' && (
                <TextField
                  label={t('picker.password_optional')}
                  type={showPassword ? 'text' : 'password'}
                  value={ssh.password ?? ''}
                  onChange={(e) => setSsh((s) => ({ ...s, password: e.target.value }))}
                  fullWidth
                  size="small"
                  placeholder={t('picker.password_placeholder')}
                  slotProps={{
                    input: {
                      style: { fontFamily: 'monospace' },
                      endAdornment: (
                        <InputAdornment position="end">
                          <IconButton
                            aria-label={t('picker.toggle_password_visibility')}
                            onClick={() => setShowPassword((v) => !v)}
                            edge="end"
                            size="small"
                          >
                            {showPassword ? <EyeSlashIcon size={18} /> : <EyeIcon size={18} />}
                          </IconButton>
                        </InputAdornment>
                      ),
                    },
                  }}
                />
              )}
              {ssh.auth_method === 'private_key' && (
                <TextField
                  label={t('picker.private_key_path')}
                  type={showPassword ? 'text' : 'password'}
                  value={ssh.private_key_path ?? ''}
                  onChange={(e) => setSsh((s) => ({ ...s, private_key_path: e.target.value }))}
                  fullWidth
                  size="small"
                  placeholder="~/.ssh/id_rsa"
                  helperText={t('picker.private_key_helper')}
                  slotProps={{
                    input: {
                      style: { fontFamily: 'monospace' },
                      endAdornment: (
                        <InputAdornment position="end">
                          <IconButton
                            aria-label={t('picker.toggle_password_visibility')}
                            onClick={() => setShowPassword((v) => !v)}
                            edge="end"
                            size="small"
                          >
                            {showPassword ? <EyeSlashIcon size={18} /> : <EyeIcon size={18} />}
                          </IconButton>
                        </InputAdornment>
                      ),
                    },
                  }}
                />
              )}

              {testState !== 'idle' && (
                <Alert
                  severity={testState === 'success' ? 'success' : testState === 'error' ? 'error' : 'info'}
                  icon={testState === 'testing' ? <CircularProgress size={16} /> : testState === 'success' ? <CheckCircleIcon size={16} weight="fill" /> : <WarningIcon size={16} weight="fill" />}
                  sx={{ py: 0, '& .MuiAlert-message': { fontSize: '0.8rem' } }}
                >
                  {testState === 'testing' ? t('picker.testing') : testMsg}
                </Alert>
              )}
            </Stack>
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 2 }}>
            <Button onClick={() => setMode('main')} size="small">{t('picker.back')}</Button>
            <Button
              size="small"
              variant="outlined"
              onClick={handleTestConnection}
              disabled={!ssh.host || testState === 'testing'}
              startIcon={testState === 'testing' ? <CircularProgress size={14} /> : <PlugsConnectedIcon size={14} />}
            >
              {t('picker.test')}
            </Button>
            <Button
              variant="contained"
              size="small"
              onClick={handleNewSsh}
              disabled={!ssh.host || !ssh.username}
              startIcon={<LightningIcon size={16} />}
            >
              {t('picker.connect_save')}
            </Button>
          </DialogActions>
        </>
      ) : (
        <>
          <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <PlugsConnectedIcon size={22} color={localColor} weight="fill" />
            {t('picker.new_terminal')}
          </DialogTitle>
          <DialogContent>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {t('picker.choose_connection')}
            </Typography>

            <Box sx={{ display: 'flex', gap: 1.5, mb: 2 }}>
              <Box
                onClick={handleLocalConnect}
                sx={{
                  flex: 1,
                  p: 2,
                  borderRadius: 2,
                  border: '1px solid',
                  borderColor: isDark ? 'rgba(79,195,247,0.3)' : 'rgba(21,101,192,0.2)',
                  bgcolor: isDark ? 'rgba(79,195,247,0.06)' : 'rgba(21,101,192,0.04)',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  '&:hover': {
                    bgcolor: isDark ? 'rgba(79,195,247,0.12)' : 'rgba(21,101,192,0.08)',
                    borderColor: isDark ? 'rgba(79,195,247,0.5)' : 'rgba(21,101,192,0.35)',
                    transform: 'translateY(-1px)',
                  },
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                  <DesktopIcon size={20} color={localColor} weight="fill" />
                  <Typography variant="subtitle2" sx={{ fontWeight: 600, color: localColor }}>
                    {t('picker.local')}
                  </Typography>
                </Box>
                <Typography variant="caption" color="text.secondary">
                  {t('picker.local_desc')}
                </Typography>
              </Box>

              <Box
                onClick={() => {
                  if (savedSshConnections.length > 0) {
                    listRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  } else {
                    setMode('new-ssh');
                  }
                }}
                sx={{
                  flex: 1,
                  p: 2,
                  borderRadius: 2,
                  border: '1px solid',
                  borderColor: isDark ? 'rgba(255,215,64,0.3)' : 'rgba(230,81,0,0.2)',
                  bgcolor: isDark ? 'rgba(255,215,64,0.06)' : 'rgba(230,81,0,0.04)',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  '&:hover': {
                    bgcolor: isDark ? 'rgba(255,215,64,0.12)' : 'rgba(230,81,0,0.08)',
                    borderColor: isDark ? 'rgba(255,215,64,0.5)' : 'rgba(230,81,0,0.35)',
                    transform: 'translateY(-1px)',
                  },
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                  <LightningIcon size={20} color={sshColor} weight="fill" />
                  <Typography variant="subtitle2" sx={{ fontWeight: 600, color: sshColor }}>
                    {t('picker.ssh_remote')}
                  </Typography>
                </Box>
                <Typography variant="caption" color="text.secondary">
                  {savedSshConnections.length > 0
                    ? t('picker.ssh_saved_count', { count: savedSshConnections.length })
                    : t('picker.ssh_configure')}
                </Typography>
              </Box>
            </Box>

            {savedSshConnections.length > 0 ? (
              <>
                <Box ref={listRef}>
                  <Divider sx={{ mb: 1.5 }}>
                    <Typography variant="caption" color="text.secondary">
                      {t('picker.saved_ssh')}
                    </Typography>
                  </Divider>
                </Box>

                <List dense sx={{ maxHeight: 220, overflow: 'auto' }}>
                  {savedSshConnections.map((conn) => {
                    let subtitle = conn.connection_type;
                    try {
                      const s = JSON.parse(conn.config_json);
                      subtitle = `${s.username}@${s.host}:${s.port}`;
                    } catch (err) { console.error('ConnectionPicker: operation failed', err); }
                    return (
                      <ListItemButton
                        key={conn.id}
                        onClick={() => handleSavedConnect(conn)}
                        sx={{
                          borderRadius: 1.5,
                          mb: 0.5,
                          border: '1px solid transparent',
                          '&:hover': {
                            borderColor: isDark ? 'rgba(108,99,255,0.3)' : 'rgba(91,84,224,0.2)',
                            bgcolor: isDark ? 'rgba(108,99,255,0.06)' : 'rgba(91,84,224,0.04)',
                          },
                        }}
                      >
                        <ListItemIcon sx={{ minWidth: 36 }}>
                          <LightningIcon size={18} color={sshColor} />
                        </ListItemIcon>
                        <ListItemText
                          primary={conn.name}
                          secondary={subtitle}
                          slotProps={{
                            primary: { variant: 'body2', sx: { fontWeight: 500 } },
                            secondary: { variant: 'caption', sx: { fontFamily: 'monospace' } },
                          }}
                        />
                        <ArrowRightIcon size={16} color={mutedColor} />
                      </ListItemButton>
                    );
                  })}
                </List>

                <Box
                  onClick={() => setMode('new-ssh')}
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1,
                    mt: 1,
                    px: 1.5,
                    py: 1,
                    borderRadius: 1.5,
                    cursor: 'pointer',
                    color: primaryColor,
                    '&:hover': { bgcolor: isDark ? 'rgba(108,99,255,0.06)' : 'rgba(91,84,224,0.04)' },
                  }}
                >
                  <PlusIcon size={16} />
                  <Typography variant="body2" sx={{ fontWeight: 500 }}>
                    {t('picker.new_ssh')}
                  </Typography>
                </Box>
              </>
            ) : (
              <Box
                sx={{
                  p: 2.5,
                  borderRadius: 2,
                  border: '1px dashed',
                  borderColor: isDark ? 'rgba(255,215,64,0.3)' : 'rgba(230,81,0,0.2)',
                  bgcolor: isDark ? 'rgba(255,215,64,0.04)' : 'rgba(230,81,0,0.02)',
                  textAlign: 'center',
                }}
              >
                <LightningIcon size={28} color={mutedColor} />
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1, mb: 1.5 }}>
                  {t('picker.no_saved_ssh')}
                </Typography>
                <Box sx={{ display: 'flex', justifyContent: 'center', gap: 1 }}>
                  <Button
                    size="small"
                    variant="outlined"
                    onClick={() => setMode('new-ssh')}
                    startIcon={<PlusIcon size={14} />}
                  >
                    {t('picker.quick_add')}
                  </Button>
                  <Button
                    size="small"
                    variant="outlined"
                    onClick={handleGoToConnections}
                    endIcon={<ArrowSquareOutIcon size={14} />}
                  >
                    {t('picker.connection_manager')}
                  </Button>
                </Box>
              </Box>
            )}
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 2 }}>
            <Button onClick={onClose} size="small">{t('picker.back')}</Button>
          </DialogActions>
        </>
      )}
    </Dialog>
  );
}
