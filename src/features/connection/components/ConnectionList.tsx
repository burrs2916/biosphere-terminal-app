import { useState, useEffect } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import InputLabel from '@mui/material/InputLabel';
import FormControl from '@mui/material/FormControl';
import IconButton from '@mui/material/IconButton';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import ListItemIcon from '@mui/material/ListItemIcon';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import CircularProgress from '@mui/material/CircularProgress';
import Alert from '@mui/material/Alert';
import Tooltip from '@mui/material/Tooltip';
import {
  DesktopIcon,
  PlusIcon,
  TrashIcon,
  PencilSimpleIcon,
  PlugIcon,
  LightningIcon,
  PlugsConnectedIcon,
  CheckCircleIcon,
  WarningIcon,
} from '@phosphor-icons/react';
import { listConnections, saveConnection, deleteConnection, testConnection } from '../../../core/services/connection.service';
import type { ConnectionConfig, SshConnectionInfo } from '../../../proto';
import { generateId } from '../../../core/utils';
import { useTranslation } from 'react-i18next';

interface ConnectionListProps {
  onConnect?: (connection: ConnectionConfig) => void;
}

export function ConnectionList({ onConnect }: ConnectionListProps) {
  const { t } = useTranslation('terminal');
  const [connections, setConnections] = useState<ConnectionConfig[]>([]);
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<ConnectionConfig | null>(null);
  const [name, setName] = useState('');
  const [connType, setConnType] = useState('local');
  const [ssh, setSsh] = useState<SshConnectionInfo>({
    host: '',
    port: 22,
    username: '',
    auth_method: 'password',
  });
  const [testState, setTestState] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [testMsg, setTestMsg] = useState('');
  const [testResults, setTestResults] = useState<Record<string, { state: 'testing' | 'success' | 'error'; msg?: string }>>({});

  const load = () => {
    listConnections().then(setConnections).catch(() => {});
  };

  useEffect(() => { load(); }, []);

  const openEdit = (conn?: ConnectionConfig) => {
    if (conn) {
      setEditing(conn);
      setName(conn.name);
      setConnType(conn.connection_type);
      try {
        setSsh(JSON.parse(conn.config_json));
      } catch {
        setSsh({ host: '', port: 22, username: '', auth_method: 'password' });
      }
    } else {
      setEditing(null);
      setName('');
      setConnType('local');
      setSsh({ host: '', port: 22, username: '', auth_method: 'password' });
    }
    setEditOpen(true);
    setTestState('idle');
    setTestMsg('');
  };

  const handleSave = async () => {
    const conn: ConnectionConfig = {
      id: editing?.id ?? generateId(),
      name,
      connection_type: connType,
      config_json: connType === 'ssh' ? JSON.stringify(ssh) : '{}',
      created_at: editing?.created_at ?? Date.now(),
    };
    await saveConnection(conn);
    setEditOpen(false);
    setEditing(null);
    load();
  };

  const handleDelete = async (id: string) => {
    await deleteConnection(id);
    load();
  };

  const handleTestListItem = async (e: React.MouseEvent, conn: ConnectionConfig) => {
    e.stopPropagation();
    if (conn.connection_type !== 'ssh') return;
    let sshInfo: SshConnectionInfo;
    try { sshInfo = JSON.parse(conn.config_json); } catch { return; }
    setTestResults((prev) => ({ ...prev, [conn.id]: { state: 'testing' } }));
    try {
      const msg = await testConnection(sshInfo);
      setTestResults((prev) => ({ ...prev, [conn.id]: { state: 'success', msg } }));
    } catch (err) {
      setTestResults((prev) => ({ ...prev, [conn.id]: { state: 'error', msg: String(err) } }));
    }
  };

  const getTypeIcon = (type: string) => {
    if (type === 'ssh') return <LightningIcon size={18} color="#FFD740" />;
    return <DesktopIcon size={18} color="#4FC3F7" />;
  };

  const getTypeColor = (type: string) => {
    if (type === 'ssh') return 'warning';
    return 'info';
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 2, py: 1.5 }}>
        <Typography variant="subtitle2">{t('connection.title')}</Typography>
        <IconButton size="small" onClick={() => openEdit()}>
          <PlusIcon size={16} color="#6C63FF" />
        </IconButton>
      </Box>

      {connections.length === 0 && (
        <Box sx={{ p: 3, textAlign: 'center' }}>
          <PlugIcon size={32} color="#8B949E" />
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            {t('connection.no_connections')}
          </Typography>
        </Box>
      )}

      <List dense>
        {connections.map((conn) => (
          <ListItemButton
            key={conn.id}
            onClick={() => onConnect?.(conn)}
            sx={{ borderRadius: 1, mx: 0.5 }}
          >
            <ListItemIcon sx={{ minWidth: 36 }}>
              {getTypeIcon(conn.connection_type)}
            </ListItemIcon>
            <ListItemText
              primary={conn.name}
              secondary={conn.connection_type === 'ssh'
                ? (() => { try { const s = JSON.parse(conn.config_json); return `${s.username}@${s.host}:${s.port}`; } catch { return conn.connection_type; } })()
                : conn.connection_type
              }
              slotProps={{
                primary: { variant: 'body2' },
                secondary: { variant: 'caption' },
              }}
            />
            <Chip
              label={conn.connection_type === 'ssh' ? t('connection.ssh') : t('connection.local')}
              size="small"
              color={getTypeColor(conn.connection_type) as 'warning' | 'info'}
              variant="outlined"
              sx={{ height: 20, fontSize: '0.65rem', mr: 0.5 }}
            />
            {conn.connection_type === 'ssh' && (
              <Tooltip
                title={
                  testResults[conn.id]?.state === 'success'
                    ? t('connection.connection_ok')
                    : testResults[conn.id]?.state === 'error'
                      ? testResults[conn.id].msg ?? t('connection.connection_failed')
                      : t('connection.test_connection')
                }
                arrow
              >
                <IconButton size="small" onClick={(e) => handleTestListItem(e, conn)}>
                  {testResults[conn.id]?.state === 'testing' ? (
                    <CircularProgress size={14} />
                  ) : testResults[conn.id]?.state === 'success' ? (
                    <CheckCircleIcon size={14} weight="fill" color="#00E676" />
                  ) : testResults[conn.id]?.state === 'error' ? (
                    <WarningIcon size={14} weight="fill" color="#FF7B72" />
                  ) : (
                    <PlugsConnectedIcon size={14} />
                  )}
                </IconButton>
              </Tooltip>
            )}
            <Tooltip title={t('connection.edit_connection')} arrow>
              <IconButton size="small" onClick={(e) => { e.stopPropagation(); openEdit(conn); }}>
                <PencilSimpleIcon size={14} />
              </IconButton>
            </Tooltip>
            <Tooltip title={t('connection.delete_confirm')} arrow>
              <IconButton size="small" onClick={(e) => { e.stopPropagation(); handleDelete(conn.id); }}>
                <TrashIcon size={14} color="#FF7B72" />
              </IconButton>
            </Tooltip>
          </ListItemButton>
        ))}
      </List>

      <Dialog open={editOpen} onClose={() => setEditOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editing ? t('connection.edit_connection') : t('connection.new_connection')}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              label={t('connection.connection_name')}
              value={name}
              onChange={(e) => setName(e.target.value)}
              fullWidth
              size="small"
            />

            <FormControl size="small" fullWidth>
              <InputLabel>{t('connection.connection_type')}</InputLabel>
              <Select
                value={connType}
                label={t('connection.connection_type')}
                onChange={(e) => setConnType(e.target.value)}
              >
                <MenuItem value="local">{t('connection.local')}</MenuItem>
                <MenuItem value="ssh">{t('connection.ssh')}</MenuItem>
              </Select>
            </FormControl>

            {connType === 'ssh' && (
              <>
                <Divider />
                <Typography variant="subtitle2">{t('connection.ssh_config')}</Typography>
                <Box sx={{ display: 'flex', gap: 2 }}>
                  <TextField
                    label={t('connection.host')}
                    value={ssh.host}
                    onChange={(e) => setSsh((s) => ({ ...s, host: e.target.value }))}
                    size="small"
                    sx={{ flex: 1 }}
                    slotProps={{ input: { style: { fontFamily: 'monospace' } } }}
                  />
                  <TextField
                    label={t('connection.port')}
                    type="number"
                    value={ssh.port}
                    onChange={(e) => setSsh((s) => ({ ...s, port: Number(e.target.value) }))}
                    size="small"
                    sx={{ width: 100 }}
                  />
                </Box>
                <TextField
                  label={t('connection.username')}
                  value={ssh.username}
                  onChange={(e) => setSsh((s) => ({ ...s, username: e.target.value }))}
                  fullWidth
                  size="small"
                  slotProps={{ input: { style: { fontFamily: 'monospace' } } }}
                />
                <FormControl size="small" fullWidth>
                  <InputLabel>{t('connection.auth_method')}</InputLabel>
                  <Select
                    value={ssh.auth_method}
                    label={t('connection.auth_method')}
                    onChange={(e) => setSsh((s) => ({ ...s, auth_method: e.target.value as 'none' | 'password' | 'private_key' }))}
                  >
                    <MenuItem value="none">{t('connection.no_auth')}</MenuItem>
                    <MenuItem value="password">{t('connection.password')}</MenuItem>
                    <MenuItem value="private_key">{t('connection.private_key')}</MenuItem>
                  </Select>
                </FormControl>
                {ssh.auth_method === 'password' && (
                  <TextField
                    label={t('connection.password_optional')}
                    type="password"
                    value={ssh.password ?? ''}
                    onChange={(e) => setSsh((s) => ({ ...s, password: e.target.value }))}
                    fullWidth
                    size="small"
                    placeholder={t('connection.password_placeholder')}
                  />
                )}
                {ssh.auth_method === 'private_key' && (
                  <TextField
                    label={t('connection.private_key_path')}
                    value={ssh.private_key_path ?? ''}
                    onChange={(e) => setSsh((s) => ({ ...s, private_key_path: e.target.value }))}
                    fullWidth
                    size="small"
                    placeholder="~/.ssh/id_rsa"
                    helperText={t('connection.private_key_helper')}
                    slotProps={{ input: { style: { fontFamily: 'monospace' } } }}
                  />
                )}

                {testState !== 'idle' && (
                  <Alert
                    severity={testState === 'success' ? 'success' : testState === 'error' ? 'error' : 'info'}
                    icon={testState === 'testing' ? <CircularProgress size={16} /> : testState === 'success' ? <CheckCircleIcon size={16} weight="fill" /> : <WarningIcon size={16} weight="fill" />}
                    sx={{ py: 0, '& .MuiAlert-message': { fontSize: '0.8rem' } }}
                  >
                    {testState === 'testing' ? t('connection.testing') : testMsg}
                  </Alert>
                )}
              </>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditOpen(false)}>{t('connection.cancel')}</Button>
          {connType === 'ssh' && (
            <Button
              variant="outlined"
              onClick={async () => {
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
              }}
              disabled={!ssh.host || testState === 'testing'}
              startIcon={testState === 'testing' ? <CircularProgress size={14} /> : <PlugsConnectedIcon size={14} />}
            >
              {t('connection.test')}
            </Button>
          )}
          <Button onClick={handleSave} variant="contained" disabled={!name}>
            {t('connection.save')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
