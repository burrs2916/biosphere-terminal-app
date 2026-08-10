import { useState, useEffect, useMemo } from 'react';
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
import ListItem from '@mui/material/ListItem';
import ListItemIcon from '@mui/material/ListItemIcon';
import Chip from '@mui/material/Chip';
import Checkbox from '@mui/material/Checkbox';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import CircularProgress from '@mui/material/CircularProgress';
import Alert from '@mui/material/Alert';
import Tooltip from '@mui/material/Tooltip';
import InputAdornment from '@mui/material/InputAdornment';
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
  EyeIcon,
  EyeSlashIcon,
  StarIcon,
  MagnifyingGlassIcon,
  ClockIcon,
  CopyIcon,
  ListChecksIcon,
  XSquareIcon,
  PulseIcon,
} from '@phosphor-icons/react';
import { listConnections, saveConnection, deleteConnection, testConnection } from '../../../core/services/connection.service';
import { useNotify } from '../../../core/notification';
import { localizeBackendError } from '../../../core/backendError';
import type { ConnectionConfig, SshConnectionInfo } from '../../../proto';
import { generateId } from '../../../core/utils';
import { useTranslation } from 'react-i18next';
import { keyframes } from '@emotion/react';
import {
  getFavorites,
  toggleFavorite,
  getRecents,
  markRecent,
} from '../connectionPrefs';
import { useConnectionCountStore } from '../connectionCountStore';
import { useConnectIntent } from '../../../features/terminal/connectIntent';

// 活跃连接指示的脉冲动画（绿色呼吸点）
const pulse = keyframes`
  0% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.45; transform: scale(0.82); }
  100% { opacity: 1; transform: scale(1); }
`;

interface ConnectionListProps {
  onConnect?: (connection: ConnectionConfig) => void;
}

function sshHost(conn: ConnectionConfig): string {
  if (conn.connection_type !== 'ssh') return '';
  try {
    const s = JSON.parse(conn.config_json);
    return `${s.username}@${s.host}:${s.port}`;
  } catch {
    return conn.connection_type;
  }
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
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  // 第三层：批量选择 / 批量删除 / 导入导出
  const [multiSelect, setMultiSelect] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Record<string, boolean>>({});
  const [batchDeleteConfirm, setBatchDeleteConfirm] = useState(false);
  const setCount = useConnectionCountStore((s) => s.setCount);

  // 搜索 / 过滤 / 收藏 / 最近连接（均为前端 localStorage，不动后端）
  const [search, setSearch] = useState('');
  const [filterFav, setFilterFav] = useState(false);
  const [favs, setFavs] = useState<Record<string, true>>(() => getFavorites());
  const [recents, setRecents] = useState<Record<string, number>>(() => getRecents());
  // 第四层：哪些连接当前有活跃终端会话（来自终端页维护，关闭 tab 即移除）
  const activeIds = useConnectIntent((s) => s.activeConnectionIds);

  const notify = useNotify().notify;

  const load = () => {
    listConnections()
      .then((list) => { setConnections(list); setCount(list.length); })
      .catch((e) => notify(localizeBackendError(e)));
  };

  useEffect(() => { load(); }, []);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = connections.filter((c) => {
      if (filterFav && !favs[c.id]) return false;
      if (!q) return true;
      const host = sshHost(c);
      return (
        c.name.toLowerCase().includes(q) ||
        host.toLowerCase().includes(q)
      );
    });
    // 排序：收藏置顶 → 使用中 → 最近连接 → 名称
    return [...filtered].sort((a, b) => {
      const fa = favs[a.id] ? 1 : 0;
      const fb = favs[b.id] ? 1 : 0;
      if (fa !== fb) return fb - fa;
      const aa = activeIds.includes(a.id) ? 1 : 0;
      const ab = activeIds.includes(b.id) ? 1 : 0;
      if (aa !== ab) return ab - aa;
      const ra = recents[a.id] ?? 0;
      const rb = recents[b.id] ?? 0;
      if (ra !== rb) return rb - ra;
      return a.name.localeCompare(b.name);
    });
  }, [connections, search, filterFav, favs, recents, activeIds]);

  const openEdit = (conn?: ConnectionConfig) => {
    if (conn) {
      setEditing(conn);
      setName(conn.name);
      setConnType(conn.connection_type);
      // 按连接类型解析配置：仅 SSH 解析 SSH 字段，避免把 local/未知类型当 SSH 误解析
      if (conn.connection_type === 'ssh') {
        try {
          const parsed = JSON.parse(conn.config_json);
          setSsh({
            host: parsed.host ?? '',
            port: parsed.port ?? 22,
            username: parsed.username ?? '',
            auth_method: parsed.auth_method ?? 'password',
            private_key_path: parsed.private_key_path,
            password: parsed.password,
          });
        } catch {
          setSsh({ host: '', port: 22, username: '', auth_method: 'password' });
        }
      } else {
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
    setShowPassword(false);
    setSaveError('');
  };

  // 克隆连接：生成新 id + 副本名，原样复制配置（含凭据），立即落库，真实可用
  const handleClone = async (e: React.MouseEvent, conn: ConnectionConfig) => {
    e.stopPropagation();
    const cloned: ConnectionConfig = {
      id: generateId(),
      name: `${conn.name}${t('connection.clone_suffix')}`,
      connection_type: conn.connection_type,
      config_json: conn.config_json,
      created_at: Date.now(),
    };
    try {
      await saveConnection(cloned);
      notify(t('connection.cloned', { name: cloned.name }));
      load();
    } catch (err) {
      notify(localizeBackendError(err));
    }
  };

  const handleSave = async () => {
    // 校验：SSH 必须有主机，端口必须合法（避免保存出 port=0 的坏配置）
    if (connType === 'ssh') {
      if (!ssh.host.trim()) {
        setSaveError(t('connection.host_required'));
        return;
      }
      const p = Number(ssh.port);
      if (!Number.isInteger(p) || p < 1 || p > 65535) {
        setSaveError(t('connection.port_invalid'));
        return;
      }
    }
    setSaveError('');
    // 按认证方式裁剪凭据字段，避免把无关的密码/私钥路径一起落库
    let configJson = '{}';
    if (connType === 'ssh') {
      const base = {
        host: ssh.host.trim(),
        port: Number(ssh.port),
        username: ssh.username.trim(),
        auth_method: ssh.auth_method,
      };
      if (ssh.auth_method === 'password') {
        configJson = JSON.stringify({ ...base, password: ssh.password ?? '' });
      } else if (ssh.auth_method === 'private_key') {
        configJson = JSON.stringify({ ...base, private_key_path: ssh.private_key_path ?? '' });
      } else {
        configJson = JSON.stringify(base);
      }
    }
    const conn: ConnectionConfig = {
      id: editing?.id ?? generateId(),
      name: name.trim(),
      connection_type: connType,
      config_json: configJson,
      created_at: editing?.created_at ?? Date.now(),
    };
    setSaving(true);
    try {
      await saveConnection(conn);
      setEditOpen(false);
      setEditing(null);
      load();
    } catch (err) {
      setSaveError(localizeBackendError(err));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    await deleteConnection(id);
    setDeleteConfirm(null);
    load();
  };

  // ---- 第三层：批量选择 / 批量删除 / 导入导出 ----
  const selectedCount = Object.values(selectedIds).filter(Boolean).length;

  const handleToggleSelect = (id: string) => {
    setSelectedIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const clearSelection = () => {
    setSelectedIds({});
    setMultiSelect(false);
  };

  const confirmDeleteSelected = async () => {
    const ids = Object.keys(selectedIds).filter((id) => selectedIds[id]);
    setBatchDeleteConfirm(false);
    try {
      for (const id of ids) {
        await deleteConnection(id);
      }
      clearSelection();
      load();
      notify(t('connection.delete_selected') + ` (${ids.length})`);
    } catch (err) {
      notify(localizeBackendError(err));
    }
  };

  const handleConnect = (conn: ConnectionConfig) => {
    setRecents(markRecent(conn.id));
    onConnect?.(conn);
  };

  const handleToggleFav = (id: string) => {
    setFavs(toggleFavorite(id));
  };

  const handleTestListItem = async (e: React.MouseEvent, conn: ConnectionConfig) => {
    e.stopPropagation();
    if (conn.connection_type !== 'ssh') return;
    let sshInfo: SshConnectionInfo;
    try { sshInfo = JSON.parse(conn.config_json); } catch { return; }
    setTestResults((prev) => ({ ...prev, [conn.id]: { state: 'testing' } }));
    try {
      const msg = await testConnection(sshInfo);
      setTestResults((prev) => ({ ...prev, [conn.id]: { state: 'success', msg: localizeBackendError(msg) } }));
    } catch (err) {
      setTestResults((prev) => ({ ...prev, [conn.id]: { state: 'error', msg: localizeBackendError(err) } }));
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
        <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
          <Tooltip title={multiSelect ? t('connection.cancel_select') : t('connection.select')} arrow>
            <IconButton
              size="small"
              onClick={() => (multiSelect ? clearSelection() : setMultiSelect(true))}
            >
              <ListChecksIcon size={16} color={multiSelect ? '#6C63FF' : undefined} />
            </IconButton>
          </Tooltip>
          <Button
            size="small"
            onClick={() => openEdit()}
            startIcon={<PlusIcon size={16} />}
            sx={{
              textTransform: 'none',
              color: '#fff',
              background: 'linear-gradient(135deg, #6C63FF 0%, #4FC3F7 100%)',
              boxShadow: 'none',
              '&:hover': { boxShadow: '0 2px 8px rgba(108,99,255,0.4)' },
            }}
          >
            {t('connection.new_connection')}
          </Button>
        </Stack>
      </Box>

      {/* 搜索 + 过滤 */}
      <Box sx={{ px: 2, pb: 1 }}>
        <TextField
          size="small"
          fullWidth
          placeholder={t('connection.search_placeholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <MagnifyingGlassIcon size={16} color="#8B949E" />
                </InputAdornment>
              ),
            },
          }}
          sx={{ mb: 1 }}
        />
        <Stack direction="row" spacing={1}>
          <Chip
            label={t('connection.filter_all')}
            size="small"
            color={!filterFav ? 'primary' : 'default'}
            variant={!filterFav ? 'filled' : 'outlined'}
            onClick={() => setFilterFav(false)}
            sx={{ cursor: 'pointer' }}
          />
          <Chip
            label={t('connection.filter_favorites')}
            size="small"
            color={filterFav ? 'primary' : 'default'}
            variant={filterFav ? 'filled' : 'outlined'}
            onClick={() => setFilterFav(true)}
            sx={{ cursor: 'pointer' }}
          />
        </Stack>
      </Box>

      {multiSelect && (
        <Box sx={{ px: 2, pb: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
          <Typography variant="caption" color="text.secondary">
            {t('connection.selected_count', { count: selectedCount })}
          </Typography>
          <Stack direction="row" spacing={1}>
            <Button
              size="small"
              color="error"
              variant="contained"
              disabled={selectedCount === 0}
              onClick={() => setBatchDeleteConfirm(true)}
              startIcon={<TrashIcon size={14} />}
            >
              {t('connection.delete_selected')}
            </Button>
            <Button size="small" onClick={clearSelection} startIcon={<XSquareIcon size={14} />}>
              {t('connection.cancel_select')}
            </Button>
          </Stack>
        </Box>
      )}

      {connections.length === 0 && (
        <Box sx={{ p: 3, textAlign: 'center' }}>
          <PlugIcon size={32} color="#8B949E" />
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            {t('connection.no_connections')}
          </Typography>
        </Box>
      )}

      {connections.length > 0 && visible.length === 0 && (
        <Box sx={{ p: 3, textAlign: 'center' }}>
          <Typography variant="body2" color="text.secondary">
            {t('connection.no_match')}
          </Typography>
        </Box>
      )}

      <List dense>
        {visible.map((conn) => {
          const isFav = !!favs[conn.id];
          const isActiveConn = activeIds.includes(conn.id);
          return (
            <ListItem
              key={conn.id}
              disablePadding
              onClick={() => { if (multiSelect) handleToggleSelect(conn.id); }}
              sx={{
                borderRadius: 1,
                mx: 0.5,
                mb: 0.5,
                px: 1,
                border: '1px solid',
                borderColor: multiSelect && selectedIds[conn.id] ? '#6C63FF' : 'divider',
                cursor: multiSelect ? 'pointer' : 'default',
                transition: 'background-color 0.2s, border-color 0.2s',
                '&:hover': { backgroundColor: 'action.hover' },
                '&:hover .conn-actions': { opacity: 1 },
                ...(multiSelect && selectedIds[conn.id] ? { backgroundColor: 'action.selected' } : {}),
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', width: '100%', gap: 1, py: 0.5 }}>
                {multiSelect && (
                  <Checkbox
                    size="small"
                    checked={!!selectedIds[conn.id]}
                    onChange={() => handleToggleSelect(conn.id)}
                    onClick={(e) => e.stopPropagation()}
                    sx={{ p: 0.25 }}
                  />
                )}
                <ListItemIcon sx={{ minWidth: 36 }}>
                  {getTypeIcon(conn.connection_type)}
                </ListItemIcon>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Typography variant="body2" noWrap sx={{ fontWeight: 500 }}>{conn.name}</Typography>
                    {isActiveConn && (
                      <Tooltip title={t('connection.active')} arrow>
                        <Box
                          component="span"
                          sx={{
                            width: 7,
                            height: 7,
                            borderRadius: '50%',
                            bgcolor: '#00E676',
                            boxShadow: '0 0 6px rgba(0,230,118,0.8)',
                            animation: `${pulse} 1.4s ease-in-out infinite`,
                            flexShrink: 0,
                          }}
                        />
                      </Tooltip>
                    )}
                    {recents[conn.id] && (
                      <Tooltip title={t('connection.recent')} arrow>
                        <ClockIcon size={13} color="#8B949E" />
                      </Tooltip>
                    )}
                  </Box>
                  <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
                    {conn.connection_type === 'ssh'
                      ? sshHost(conn)
                      : conn.connection_type === 'local'
                        ? t('connection.local')
                        : conn.connection_type}
                  </Typography>
                </Box>

                {!multiSelect && (<>
                <Tooltip title={isFav ? t('connection.unfavorite') : t('connection.favorite')} arrow>
                  <IconButton
                    size="small"
                    onClick={(e) => { e.stopPropagation(); handleToggleFav(conn.id); }}
                  >
                    <StarIcon size={16} weight={isFav ? 'fill' : 'regular'} color={isFav ? '#FFD740' : undefined} />
                  </IconButton>
                </Tooltip>

                {isActiveConn && (
                  <Chip
                    label={t('connection.active')}
                    size="small"
                    color="success"
                    variant="outlined"
                    sx={{ height: 20, fontSize: '0.65rem', borderColor: 'success.main' }}
                  />
                )}
                <Chip
                  label={conn.connection_type === 'ssh' ? t('connection.ssh') : t('connection.local')}
                  size="small"
                  color={getTypeColor(conn.connection_type) as 'warning' | 'info'}
                  variant="outlined"
                  sx={{ height: 20, fontSize: '0.65rem' }}
                />

                <Button
                  size="small"
                  onClick={(e) => { e.stopPropagation(); handleConnect(conn); }}
                  startIcon={<PlugsConnectedIcon size={14} />}
                  sx={{
                    textTransform: 'none',
                    color: '#fff',
                    background: 'linear-gradient(135deg, #6C63FF 0%, #4FC3F7 100%)',
                    boxShadow: 'none',
                    '&:hover': { boxShadow: '0 2px 8px rgba(108,99,255,0.4)' },
                  }}
                >
                  {t('connection.connect')}
                </Button>

                <Box className="conn-actions" sx={{ display: 'flex', alignItems: 'center', gap: 0.25, opacity: 0.5, transition: 'opacity .15s' }}>
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
                        <PulseIcon size={14} />
                      )}
                    </IconButton>
                  </Tooltip>
                )}
                <Tooltip title={t('connection.edit_connection')} arrow>
                  <IconButton size="small" onClick={(e) => { e.stopPropagation(); openEdit(conn); }}>
                    <PencilSimpleIcon size={14} />
                  </IconButton>
                </Tooltip>
                <Tooltip title={t('connection.clone')} arrow>
                  <IconButton size="small" onClick={(e) => handleClone(e, conn)}>
                    <CopyIcon size={14} />
                  </IconButton>
                </Tooltip>
                <Tooltip title={t('connection.delete_confirm')} arrow>
                  <IconButton size="small" onClick={(e) => { e.stopPropagation(); setDeleteConfirm(conn.id); }}>
                    <TrashIcon size={14} color="#FF7B72" />
                  </IconButton>
                </Tooltip>
                </Box>
                </>)}
              </Box>
            </ListItem>
          );
        })}
      </List>

      <Dialog open={editOpen} onClose={() => setEditOpen(false)} maxWidth="sm" fullWidth
        sx={{ '& .MuiPaper-root': { borderRadius: 3 } }}>
        <DialogTitle sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          pb: 1.5,
          borderBottom: '1px solid',
          borderColor: 'divider',
        }}>
          {editing ? <PencilSimpleIcon size={20} color="#6C63FF" /> : <PlusIcon size={20} color="#6C63FF" />}
          {editing ? t('connection.edit_connection') : t('connection.new_connection')}
        </DialogTitle>
        <form onSubmit={(e) => { e.preventDefault(); handleSave(); }}>
          <DialogContent>
            <Stack spacing={2} sx={{ mt: 1 }}>
              {saveError && (
                <Alert severity="error" sx={{ py: 0, '& .MuiAlert-message': { fontSize: '0.8rem' } }}>
                  {saveError}
                </Alert>
              )}

              <TextField
                label={t('connection.connection_name')}
                value={name}
                onChange={(e) => setName(e.target.value)}
                fullWidth
                size="small"
                autoFocus
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

              {connType === 'local' && (
                <Typography variant="caption" color="text.secondary">
                  {t('connection.local_hint')}
                </Typography>
              )}

              {connType === 'ssh' && (
                <Box sx={{
                  border: '1px solid',
                  borderColor: 'divider',
                  borderRadius: 2,
                  p: 2,
                  bgcolor: 'action.hover',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 2,
                }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <LightningIcon size={18} color="#FFD740" />
                    <Typography variant="subtitle2">{t('connection.ssh_config')}</Typography>
                  </Box>
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
                      type={showPassword ? 'text' : 'password'}
                      value={ssh.password ?? ''}
                      onChange={(e) => setSsh((s) => ({ ...s, password: e.target.value }))}
                      fullWidth
                      size="small"
                      placeholder={t('connection.password_placeholder')}
                      helperText={t('connection.password_helper')}
                      slotProps={{
                        input: {
                          style: { fontFamily: 'monospace' },
                          endAdornment: (
                            <InputAdornment position="end">
                              <IconButton
                                aria-label={t('connection.toggle_password_visibility')}
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
                </Box>
              )}
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button type="button" onClick={() => setEditOpen(false)}>{t('connection.cancel')}</Button>
            {connType === 'ssh' && (
              <Button
                type="button"
                variant="outlined"
                onClick={async () => {
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
                }}
                disabled={!ssh.host || testState === 'testing'}
                startIcon={testState === 'testing' ? <CircularProgress size={14} /> : <PlugsConnectedIcon size={14} />}
              >
                {t('connection.test')}
              </Button>
            )}
            <Button
              type="submit"
              variant="contained"
              disabled={!name || saving}
              startIcon={saving ? <CircularProgress size={14} /> : undefined}
              sx={{
                textTransform: 'none',
                color: '#fff',
                background: 'linear-gradient(135deg, #6C63FF 0%, #4FC3F7 100%)',
                boxShadow: 'none',
                '&:hover': { boxShadow: '0 2px 8px rgba(108,99,255,0.4)' },
              }}
            >
              {saving ? t('connection.saving') : t('connection.save')}
            </Button>
          </DialogActions>
        </form>
      </Dialog>

      <Dialog open={deleteConfirm !== null} onClose={() => setDeleteConfirm(null)} maxWidth="xs" fullWidth
        sx={{ '& .MuiPaper-root': { borderRadius: 3 } }}>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, pb: 1.5, borderBottom: '1px solid', borderColor: 'divider' }}>
          <TrashIcon size={20} color="#FF7B72" />
          {t('connection.delete_confirm_title')}
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            {t('connection.delete_confirm_message', {
              name: connections.find((c) => c.id === deleteConfirm)?.name || '',
            })}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteConfirm(null)}>{t('connection.cancel')}</Button>
          <Button color="error" variant="contained" onClick={() => deleteConfirm && handleDelete(deleteConfirm)}>
            {t('connection.delete')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* 批量删除确认 */}
      <Dialog open={batchDeleteConfirm} onClose={() => setBatchDeleteConfirm(false)} maxWidth="xs" fullWidth
        sx={{ '& .MuiPaper-root': { borderRadius: 3 } }}>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, pb: 1.5, borderBottom: '1px solid', borderColor: 'divider' }}>
          <TrashIcon size={20} color="#FF7B72" />
          {t('connection.delete_confirm_title')}
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            {t('connection.delete_selected_confirm', { count: selectedCount })}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setBatchDeleteConfirm(false)}>{t('connection.cancel')}</Button>
          <Button color="error" variant="contained" onClick={confirmDeleteSelected}>
            {t('connection.delete')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
