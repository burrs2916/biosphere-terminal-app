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
import {
  DesktopIcon,
  LightningIcon,
  PlusIcon,
  ArrowRightIcon,
  PlugsConnectedIcon,
  ArrowSquareOutIcon,
  CheckCircleIcon,
  WarningIcon,
} from '@phosphor-icons/react';
import { useNavigate } from 'react-router-dom';
import { listConnections, saveConnection, testConnection } from '../../../core/services/connection.service';
import type { ConnectionConfig, SshConnectionInfo } from '../../../proto';
import { generateId } from '../../../core/utils';

export interface ConnectionPickerResult {
  connectionType: 'local' | 'ssh';
  ssh?: SshConnectionInfo;
  name: string;
}

interface ConnectionPickerProps {
  open: boolean;
  onConnect: (result: ConnectionPickerResult) => void;
  onClose: () => void;
}

export function ConnectionPicker({ open, onConnect, onClose }: ConnectionPickerProps) {
  const { t } = useTranslation('terminal');
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
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      listConnections().then(setConnections).catch(() => {});
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
      } catch {}
    }
    onConnect({
      connectionType: conn.connection_type as 'local' | 'ssh',
      ssh: sshInfo,
      name: conn.name,
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
    });
  };

  const handleTestConnection = async () => {
    setTestState('testing');
    setTestMsg('');
    try {
      const msg = await testConnection(ssh);
      setTestState('success');
      setTestMsg(msg);
    } catch (e) {
      setTestState('error');
      setTestMsg(String(e));
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
          bgcolor: '#161B22',
          border: '1px solid rgba(48,54,61,0.6)',
        },
      }}
    >
      {mode === 'new-ssh' ? (
        <>
          <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <LightningIcon size={22} color="#FFD740" weight="fill" />
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
                  type="password"
                  value={ssh.password ?? ''}
                  onChange={(e) => setSsh((s) => ({ ...s, password: e.target.value }))}
                  fullWidth
                  size="small"
                  placeholder={t('picker.password_placeholder')}
                />
              )}
              {ssh.auth_method === 'private_key' && (
                <TextField
                  label={t('picker.private_key_path')}
                  value={ssh.private_key_path ?? ''}
                  onChange={(e) => setSsh((s) => ({ ...s, private_key_path: e.target.value }))}
                  fullWidth
                  size="small"
                  placeholder="~/.ssh/id_rsa"
                  helperText={t('picker.private_key_helper')}
                  slotProps={{ input: { style: { fontFamily: 'monospace' } } }}
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
            <PlugsConnectedIcon size={22} color="#4FC3F7" weight="fill" />
            New Terminal
          </DialogTitle>
          <DialogContent>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Choose how you want to connect
            </Typography>

            <Box sx={{ display: 'flex', gap: 1.5, mb: 2 }}>
              <Box
                onClick={handleLocalConnect}
                sx={{
                  flex: 1,
                  p: 2,
                  borderRadius: 2,
                  border: '1px solid rgba(79,195,247,0.3)',
                  bgcolor: 'rgba(79,195,247,0.06)',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  '&:hover': {
                    bgcolor: 'rgba(79,195,247,0.12)',
                    borderColor: 'rgba(79,195,247,0.5)',
                    transform: 'translateY(-1px)',
                  },
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                  <DesktopIcon size={20} color="#4FC3F7" weight="fill" />
                  <Typography variant="subtitle2" sx={{ fontWeight: 600, color: '#4FC3F7' }}>
                    Local
                  </Typography>
                </Box>
                <Typography variant="caption" color="text.secondary">
                  Open a local shell
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
                  border: '1px solid rgba(255,215,64,0.3)',
                  bgcolor: 'rgba(255,215,64,0.06)',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  '&:hover': {
                    bgcolor: 'rgba(255,215,64,0.12)',
                    borderColor: 'rgba(255,215,64,0.5)',
                    transform: 'translateY(-1px)',
                  },
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                  <LightningIcon size={20} color="#FFD740" weight="fill" />
                  <Typography variant="subtitle2" sx={{ fontWeight: 600, color: '#FFD740' }}>
                    SSH Remote
                  </Typography>
                </Box>
                <Typography variant="caption" color="text.secondary">
                  {savedSshConnections.length > 0
                    ? `${savedSshConnections.length} saved connection(s)`
                    : 'Configure & connect'}
                </Typography>
              </Box>
            </Box>

            {savedSshConnections.length > 0 ? (
              <>
                <Box ref={listRef}>
                  <Divider sx={{ mb: 1.5 }}>
                    <Typography variant="caption" color="text.secondary">
                      Saved SSH Connections
                    </Typography>
                  </Divider>
                </Box>

                <List dense sx={{ maxHeight: 220, overflow: 'auto' }}>
                  {savedSshConnections.map((conn) => {
                    let subtitle = conn.connection_type;
                    try {
                      const s = JSON.parse(conn.config_json);
                      subtitle = `${s.username}@${s.host}:${s.port}`;
                    } catch {}
                    return (
                      <ListItemButton
                        key={conn.id}
                        onClick={() => handleSavedConnect(conn)}
                        sx={{
                          borderRadius: 1.5,
                          mb: 0.5,
                          border: '1px solid transparent',
                          '&:hover': {
                            borderColor: 'rgba(108,99,255,0.3)',
                            bgcolor: 'rgba(108,99,255,0.06)',
                          },
                        }}
                      >
                        <ListItemIcon sx={{ minWidth: 36 }}>
                          <LightningIcon size={18} color="#FFD740" />
                        </ListItemIcon>
                        <ListItemText
                          primary={conn.name}
                          secondary={subtitle}
                          slotProps={{
                            primary: { variant: 'body2', sx: { fontWeight: 500 } },
                            secondary: { variant: 'caption', sx: { fontFamily: 'monospace' } },
                          }}
                        />
                        <ArrowRightIcon size={16} color="#8B949E" />
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
                    color: '#6C63FF',
                    '&:hover': { bgcolor: 'rgba(108,99,255,0.06)' },
                  }}
                >
                  <PlusIcon size={16} />
                  <Typography variant="body2" sx={{ fontWeight: 500 }}>
                    New SSH Connection
                  </Typography>
                </Box>
              </>
            ) : (
              <Box
                sx={{
                  p: 2.5,
                  borderRadius: 2,
                  border: '1px dashed rgba(255,215,64,0.3)',
                  bgcolor: 'rgba(255,215,64,0.04)',
                  textAlign: 'center',
                }}
              >
                <LightningIcon size={28} color="#8B949E" />
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1, mb: 1.5 }}>
                  No saved SSH connections
                </Typography>
                <Box sx={{ display: 'flex', justifyContent: 'center', gap: 1 }}>
                  <Button
                    size="small"
                    variant="outlined"
                    onClick={() => setMode('new-ssh')}
                    startIcon={<PlusIcon size={14} />}
                  >
                    Quick Add
                  </Button>
                  <Button
                    size="small"
                    variant="outlined"
                    onClick={handleGoToConnections}
                    endIcon={<ArrowSquareOutIcon size={14} />}
                  >
                    Connection Manager
                  </Button>
                </Box>
              </Box>
            )}
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 2 }}>
            <Button onClick={onClose} size="small">Cancel</Button>
          </DialogActions>
        </>
      )}
    </Dialog>
  );
}
