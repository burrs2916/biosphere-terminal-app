import { useState, useEffect, useCallback } from 'react';
import {
  Box, TextField, Button, Typography, Switch, FormControlLabel,
  Dialog, DialogTitle, DialogContent, DialogActions,
  IconButton, Chip, Tooltip, Card, Collapse, Divider,
  Alert, Snackbar, CircularProgress, MenuItem, Select, FormControl, InputLabel, Menu,
} from '@mui/material';
import {
  Plus as PlusIcon,
  PencilSimple as EditIcon,
  Trash as DeleteIcon,
  Cloud as CloudIcon,
  Plugs as HubIcon,
  Robot as SmartToyIcon,
  CheckCircle as CheckCircleIcon,
  Warning as ErrorIcon,
  Play as PlayArrowIcon,
  CaretDown as ExpandMoreIcon,
  CaretUp as ExpandLessIcon,
} from '@phosphor-icons/react';
import { useAgentStore, genId } from '../store/agentStore';
import type { ProviderDto, EndpointDto, ModelDto } from '../../../proto/agent';
import { useTranslation } from 'react-i18next';

const API_TYPE_KEYS: { value: string; labelKey: string }[] = [
  { value: 'openai-completions', labelKey: 'api.type_openai_completions' },
  { value: 'anthropic-messages', labelKey: 'api.type_anthropic_messages' },
  { value: 'ollama', labelKey: 'api.type_ollama' },
  { value: 'openai-responses', labelKey: 'api.type_openai_responses' },
];

const AUTH_TYPE_KEYS: { value: string; labelKey: string }[] = [
  { value: 'bearer', labelKey: 'api.auth_type_bearer' },
  { value: 'x-api-key', labelKey: 'api.auth_type_x_api_key' },
  { value: 'custom', labelKey: 'api.auth_type_custom' },
];

const PROVIDER_PRESET_KEYS = [
  { nameKey: 'preset.openai', logo: '🟢' },
  { nameKey: 'preset.anthropic', logo: '🟠' },
  { nameKey: 'preset.deepseek', logo: '🔵' },
  { nameKey: 'preset.google', logo: '🟡' },
  { nameKey: 'preset.ollama', logo: '🦙' },
];

function ProviderDialog({
  open,
  onClose,
  onSave,
  initial,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (p: ProviderDto) => void;
  initial?: ProviderDto | null;
}) {
  const { t } = useTranslation('agent');
  const [name, setName] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [logo, setLogo] = useState('');
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    if (initial) {
      setName(initial.name);
      setApiKey(initial.apiKey);
      setLogo(initial.logo);
      setEnabled(initial.enabled);
    } else {
      setName('');
      setApiKey('');
      setLogo('');
      setEnabled(true);
    }
  }, [initial, open]);

  const handleSave = () => {
    if (!name.trim()) return;
    const now = Date.now();
    onSave({
      id: initial?.id || genId('pv'),
      name: name.trim(),
      apiKey: apiKey.trim(),
      logo: logo.trim(),
      enabled,
      createdAt: initial?.createdAt || now,
      updatedAt: now,
    });
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{initial ? t('provider.edit') : t('provider.add')}</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '16px !important' }}>
        <TextField label={t('provider.name')} value={name} onChange={(e) => setName(e.target.value)} fullWidth size="small" placeholder={t('provider.name_placeholder')} />
        <TextField label={t('provider.api_key')} value={apiKey} onChange={(e) => setApiKey(e.target.value)} fullWidth size="small" type="password" placeholder="sk-..." />
        <TextField label={t('provider.logo_emoji')} value={logo} onChange={(e) => setLogo(e.target.value)} fullWidth size="small" placeholder="🟢" />
        <FormControlLabel control={<Switch checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />} label={t('agent.enabled')} />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('dialog.cancel')}</Button>
        <Button onClick={handleSave} variant="contained" disabled={!name.trim()}>{t('dialog.save')}</Button>
      </DialogActions>
    </Dialog>
  );
}

function EndpointDialog({
  open,
  onClose,
  onSave,
  initial,
  providerId,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (e: EndpointDto) => void;
  initial?: EndpointDto | null;
  providerId: string;
}) {
  const { t } = useTranslation('agent');
  const [name, setName] = useState('');
  const [apiType, setApiType] = useState('openai-completions');
  const [baseUrl, setBaseUrl] = useState('');
  const [authType, setAuthType] = useState('bearer');
  const [customAuthHeader, setCustomAuthHeader] = useState('');
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    if (initial) {
      setName(initial.name);
      setApiType(initial.apiType);
      setBaseUrl(initial.baseUrl);
      setAuthType(initial.authType);
      setCustomAuthHeader(initial.customAuthHeader);
      setEnabled(initial.enabled);
    } else {
      setName('');
      setApiType('openai-completions');
      setBaseUrl('');
      setAuthType('bearer');
      setCustomAuthHeader('');
      setEnabled(true);
    }
  }, [initial, open]);

  useEffect(() => {
    if (!initial && open) {
      if (apiType === 'ollama') {
        setBaseUrl('http://localhost:11434/v1/');
        setAuthType('bearer');
      } else if (apiType === 'anthropic-messages') {
        setAuthType('x-api-key');
      } else {
        setAuthType('bearer');
      }
    }
  }, [apiType, initial, open]);

  const handleSave = () => {
    if (!name.trim()) return;
    const now = Date.now();
    onSave({
      id: initial?.id || genId('ep'),
      providerId,
      name: name.trim(),
      apiType,
      baseUrl: baseUrl.trim(),
      authType,
      customAuthHeader: customAuthHeader.trim(),
      enabled,
      createdAt: initial?.createdAt || now,
      updatedAt: now,
    });
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{initial ? t('endpoint.edit') : t('endpoint.add')}</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '16px !important' }}>
        <TextField label={t('endpoint.name')} value={name} onChange={(e) => setName(e.target.value)} fullWidth size="small" placeholder={t('endpoint.name_placeholder')} />
        <FormControl size="small" fullWidth>
          <InputLabel>{t('api.type_label')}</InputLabel>
          <Select value={apiType} label={t('api.type_label')} onChange={(e) => setApiType(e.target.value)}>
            {API_TYPE_KEYS.map((o) => (
              <MenuItem key={o.value} value={o.value}>{t(o.labelKey)}</MenuItem>
            ))}
          </Select>
        </FormControl>
        <TextField label={t('provider.base_url')} value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} fullWidth size="small" placeholder="https://api.openai.com/v1/" />
        <FormControl size="small" fullWidth>
          <InputLabel>{t('api.auth_type')}</InputLabel>
          <Select value={authType} label={t('api.auth_type')} onChange={(e) => setAuthType(e.target.value)}>
            {AUTH_TYPE_KEYS.map((o) => (
              <MenuItem key={o.value} value={o.value}>{t(o.labelKey)}</MenuItem>
            ))}
          </Select>
        </FormControl>
        {authType === 'custom' && (
          <TextField label={t('api.custom_auth_header')} value={customAuthHeader} onChange={(e) => setCustomAuthHeader(e.target.value)} fullWidth size="small" placeholder="X-Custom-Auth" />
        )}
        <FormControlLabel control={<Switch checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />} label={t('agent.enabled')} />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('dialog.cancel')}</Button>
        <Button onClick={handleSave} variant="contained" disabled={!name.trim()}>{t('dialog.save')}</Button>
      </DialogActions>
    </Dialog>
  );
}

function ModelDialog({
  open,
  onClose,
  onSave,
  initial,
  endpointId,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (m: ModelDto) => void;
  initial?: ModelDto | null;
  endpointId: string;
}) {
  const { t } = useTranslation('agent');
  const [name, setName] = useState('');
  const [refKey, setRefKey] = useState('');
  const [reasoning, setReasoning] = useState(false);
  const [contextWindow, setContextWindow] = useState(128000);
  const [maxTokens, setMaxTokens] = useState(4096);
  const [inputTypes, setInputTypes] = useState<string[]>(['text']);
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    if (initial) {
      setName(initial.name);
      setRefKey(initial.refKey);
      setReasoning(initial.reasoning);
      setContextWindow(initial.contextWindow);
      setMaxTokens(initial.maxTokens);
      setInputTypes(initial.inputTypes);
      setEnabled(initial.enabled);
    } else {
      setName('');
      setRefKey('');
      setReasoning(false);
      setContextWindow(128000);
      setMaxTokens(4096);
      setInputTypes(['text']);
      setEnabled(true);
    }
  }, [initial, open]);

  const handleSave = () => {
    if (!name.trim() || !refKey.trim()) return;
    const now = Date.now();
    onSave({
      id: initial?.id || genId('model'),
      name: name.trim(),
      refKey: refKey.trim(),
      endpointId,
      reasoning,
      inputTypes,
      contextWindow,
      maxTokens,
      enabled,
      createdAt: initial?.createdAt || now,
      updatedAt: now,
    });
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{initial ? t('model.edit') : t('model.add')}</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '16px !important' }}>
        <TextField label={t('model.name')} value={name} onChange={(e) => setName(e.target.value)} fullWidth size="small" placeholder={t('model.name_placeholder')} />
        <TextField label={t('model.ref_key')} value={refKey} onChange={(e) => setRefKey(e.target.value)} fullWidth size="small" placeholder={t('model.ref_key_placeholder')} helperText={t('model.ref_key_helper')} />
        <Box sx={{ display: 'flex', gap: 2 }}>
          <TextField label={t('model.context_window')} value={contextWindow} onChange={(e) => setContextWindow(Number(e.target.value))} size="small" type="number" sx={{ flex: 1 }} />
          <TextField label={t('model.max_tokens')} value={maxTokens} onChange={(e) => setMaxTokens(Number(e.target.value))} size="small" type="number" sx={{ flex: 1 }} />
        </Box>
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
          <FormControlLabel control={<Switch checked={reasoning} onChange={(e) => setReasoning(e.target.checked)} />} label={t('model.reasoning_model')} />
          <FormControlLabel control={<Switch checked={inputTypes.includes('image')} onChange={(e) => {
            if (e.target.checked) {
              setInputTypes([...inputTypes, 'image']);
            } else {
              setInputTypes(inputTypes.filter((t) => t !== 'image'));
            }
          }} />} label={t('model.support_image')} />
        </Box>
        <FormControlLabel control={<Switch checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />} label={t('agent.enabled')} />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('dialog.cancel')}</Button>
        <Button onClick={handleSave} variant="contained" disabled={!name.trim() || !refKey.trim()}>{t('dialog.save')}</Button>
      </DialogActions>
    </Dialog>
  );
}

function ConfirmDialog({
  open,
  title,
  message,
  onConfirm,
  onCancel,
  cancelLabel,
  confirmLabel,
}: {
  open: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  cancelLabel: string;
  confirmLabel: string;
}) {
  return (
    <Dialog open={open} onClose={onCancel} maxWidth="xs" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <Typography variant="body2">{message}</Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>{cancelLabel}</Button>
        <Button onClick={onConfirm} variant="contained" color="error">{confirmLabel}</Button>
      </DialogActions>
    </Dialog>
  );
}

export function ModelConfigPage() {
  const { t } = useTranslation('agent');
  const {
    providers,
    endpoints,
    models,
    loadProviders,
    loadEndpoints,
    loadModels,
    saveProvider,
    deleteProvider,
    saveEndpoint,
    deleteEndpoint,
    saveModel,
    deleteModel,
    testEndpointConnection,
    testModelChat,
  } = useAgentStore();

  useEffect(() => {
    loadProviders();
    loadEndpoints();
    loadModels();
  }, [loadProviders, loadEndpoints, loadModels]);

  const [providerDialog, setProviderDialog] = useState<{ open: boolean; data: ProviderDto | null }>({ open: false, data: null });
  const [endpointDialog, setEndpointDialog] = useState<{ open: boolean; data: EndpointDto | null; providerId: string }>({ open: false, data: null, providerId: '' });
  const [modelDialog, setModelDialog] = useState<{ open: boolean; data: ModelDto | null; endpointId: string }>({ open: false, data: null, endpointId: '' });
  const [deleteConfirm, setDeleteConfirm] = useState<{ open: boolean; title: string; message: string; onConfirm: () => void }>({ open: false, title: '', message: '', onConfirm: () => {} });
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({ open: false, message: '', severity: 'success' });
  const [testResults, setTestResults] = useState<Map<string, { success: boolean; message: string }>>(new Map());
  const [testingId, setTestingId] = useState<string | null>(null);
  const [modelTestResults, setModelTestResults] = useState<Map<string, { success: boolean; message: string }>>(new Map());
  const [testingModelId, setTestingModelId] = useState<string | null>(null);
  const [expandedProviders, setExpandedProviders] = useState<Set<string>>(new Set(providers.map((p) => p.id)));
  const [expandedEndpoints, setExpandedEndpoints] = useState<Set<string>>(new Set());
  const [presetAnchor, setPresetAnchor] = useState<HTMLElement | null>(null);

  const toggleProvider = useCallback((id: string) => {
    setExpandedProviders((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleEndpoint = useCallback((id: string) => {
    setExpandedEndpoints((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleTestConnection = useCallback(async (endpointId: string) => {
    setTestingId(endpointId);
    try {
      const result = await testEndpointConnection(endpointId);
      setTestResults((prev) => {
        const next = new Map(prev);
        next.set(endpointId, { success: true, message: result });
        return next;
      });
      setSnackbar({ open: true, message: result, severity: 'success' });
    } catch (e) {
      setTestResults((prev) => {
        const next = new Map(prev);
        next.set(endpointId, { success: false, message: String(e) });
        return next;
      });
      setSnackbar({ open: true, message: String(e), severity: 'error' });
    } finally {
      setTestingId(null);
    }
  }, [testEndpointConnection]);

  const handleTestModel = useCallback(async (modelId: string) => {
    setTestingModelId(modelId);
    try {
      const result = await testModelChat(modelId);
      setModelTestResults((prev) => {
        const next = new Map(prev);
        next.set(modelId, { success: true, message: result });
        return next;
      });
      setSnackbar({ open: true, message: result, severity: 'success' });
    } catch (e) {
      setModelTestResults((prev) => {
        const next = new Map(prev);
        next.set(modelId, { success: false, message: String(e) });
        return next;
      });
      setSnackbar({ open: true, message: String(e), severity: 'error' });
    } finally {
      setTestingModelId(null);
    }
  }, [testModelChat]);

  const handleAddPreset = useCallback((preset: { nameKey: string; logo: string }) => {
    const now = Date.now();
    const provider: ProviderDto = {
      id: genId('pv'),
      name: t(preset.nameKey),
      apiKey: '',
      logo: preset.logo,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    };
    saveProvider(provider);
    setExpandedProviders((prev) => new Set(prev).add(provider.id));
    setPresetAnchor(null);
      setSnackbar({ open: true, message: `${t('config.provider_added')}: ${t(preset.nameKey)}`, severity: 'success' });
  }, [saveProvider, t]);

  const getEndpointsForProvider = useCallback((providerId: string) => {
    return endpoints.filter((e) => e.providerId === providerId);
  }, [endpoints]);

  const getModelsForEndpoint = useCallback((endpointId: string) => {
    return models.filter((m) => m.endpointId === endpointId);
  }, [models]);

  const getApiTypeLabel = (apiType: string) => {
    const key = API_TYPE_KEYS.find((o) => o.value === apiType)?.labelKey;
    return key ? t(key) : apiType;
  };

  return (
    <Box sx={{ p: 2, height: '100%', width: '100%', overflow: 'auto', minWidth: 0, minHeight: 0 }}>
      <Box sx={{ mb: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Box>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, fontSize: 14 }}>
            {t('config.model_config')}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {t('config.model_config_desc')}
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button
            size="small"
            variant="outlined"
            startIcon={<CloudIcon size={14} />}
            onClick={(e) => setPresetAnchor(e.currentTarget)}
            sx={{ borderRadius: 2, fontSize: 11 }}
          >
            {t('config.quick_add')}
          </Button>
          <Button
            size="small"
            variant="contained"
            startIcon={<PlusIcon size={14} weight="bold" />}
            onClick={() => setProviderDialog({ open: true, data: null })}
            sx={{ borderRadius: 2, fontSize: 11, background: 'linear-gradient(135deg, #6C63FF 0%, #8B83FF 100%)' }}
          >
            {t('provider.add')}
          </Button>
        </Box>
      </Box>

      <Menu
        open={Boolean(presetAnchor)}
        anchorEl={presetAnchor}
        onClose={() => setPresetAnchor(null)}
      >
        {PROVIDER_PRESET_KEYS.map((preset) => (
          <MenuItem key={preset.nameKey} onClick={() => handleAddPreset(preset)}>
            <Box sx={{ mr: 1, fontSize: 16 }}>{preset.logo}</Box>
            {t(preset.nameKey)}
          </MenuItem>
        ))}
      </Menu>

      {providers.length === 0 ? (
        <Card sx={{ border: 1, borderColor: 'divider', borderRadius: 2, textAlign: 'center', py: 6, bgcolor: 'rgba(22,27,34,0.6)' }}>
          <CloudIcon size={48} color="#555" style={{ marginBottom: 8 }} />
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            {t('config.no_provider')}
          </Typography>
          <Typography variant="caption" color="text.disabled" sx={{ mb: 2, display: 'block' }}>
            {t('config.no_provider_desc')}
          </Typography>
          <Button variant="outlined" size="small" startIcon={<PlusIcon size={14} weight="bold" />} onClick={() => setProviderDialog({ open: true, data: null })} sx={{ borderRadius: 2 }}>
            {t('provider.add')}
          </Button>
        </Card>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          {providers.map((provider) => {
            const providerEndpoints = getEndpointsForProvider(provider.id);
            const isExpanded = expandedProviders.has(provider.id);

            return (
              <Card key={provider.id} sx={{ border: 1, borderColor: 'rgba(48,54,61,0.6)', borderRadius: 2, bgcolor: 'rgba(22,27,34,0.6)', overflow: 'visible' }}>
                <Box
                  sx={{
                    p: 1.5,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    cursor: 'pointer',
                    '&:hover': { bgcolor: 'rgba(255,255,255,0.03)' },
                  }}
                  onClick={() => toggleProvider(provider.id)}
                >
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Typography sx={{ fontSize: 20 }}>{provider.logo || '☁️'}</Typography>
                    <Box>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>{provider.name}</Typography>
                      <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
                        <Chip label={`${providerEndpoints.length} ${t('endpoint.count')}`} size="small" variant="outlined" sx={{ fontSize: 9, height: 18 }} />
                        <Chip
                          label={provider.enabled ? t('agent.enabled') : t('agent.disabled')}
                          size="small"
                          color={provider.enabled ? 'success' : 'default'}
                          sx={{ fontSize: 9, height: 18 }}
                        />
                      </Box>
                    </Box>
                  </Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }} onClick={(e) => e.stopPropagation()}>
                    <Tooltip title={t('provider.edit')}>
                      <IconButton size="small" onClick={() => setProviderDialog({ open: true, data: provider })}>
                        <EditIcon size={14} />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title={t('provider.delete')}>
                      <IconButton size="small" onClick={() => setDeleteConfirm({
                        open: true,
                        title: t('provider.delete'),
                        message: t('provider.delete_confirm', { name: provider.name }),
                        onConfirm: () => {
                          deleteProvider(provider.id);
                          setDeleteConfirm({ open: false, title: '', message: '', onConfirm: () => {} });
                        },
                      })}>
                        <DeleteIcon size={14} color="#FF5252" />
                      </IconButton>
                    </Tooltip>
                    <IconButton size="small" onClick={() => toggleProvider(provider.id)}>
                      {isExpanded ? <ExpandLessIcon size={14} /> : <ExpandMoreIcon size={14} />}
                    </IconButton>
                  </Box>
                </Box>

                <Collapse in={isExpanded}>
                  <Divider sx={{ borderColor: 'rgba(48,54,61,0.6)' }} />
                  <Box sx={{ p: 1.5 }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                      <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
                        {t('endpoint.label')}
                      </Typography>
                      <Button
                        size="small"
                        startIcon={<PlusIcon size={12} weight="bold" />}
                        onClick={() => setEndpointDialog({ open: true, data: null, providerId: provider.id })}
                        sx={{ fontSize: 10, borderRadius: 1.5 }}
                      >
                        {t('endpoint.add')}
                      </Button>
                    </Box>

                    {providerEndpoints.length === 0 ? (
                      <Typography variant="caption" color="text.disabled" sx={{ display: 'block', textAlign: 'center', py: 1.5 }}>
                        {t('endpoint.no_endpoints')}
                      </Typography>
                    ) : (
                      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                        {providerEndpoints.map((endpoint) => {
                          const endpointModels = getModelsForEndpoint(endpoint.id);
                          const isEndpointExpanded = expandedEndpoints.has(endpoint.id);
                          const testResult = testResults.get(endpoint.id);
                          const isTesting = testingId === endpoint.id;

                          return (
                            <Card key={endpoint.id} variant="outlined" sx={{ borderRadius: 1.5, borderColor: 'rgba(48,54,61,0.6)', bgcolor: 'rgba(13,17,23,0.6)' }}>
                              <Box
                                sx={{
                                  p: 1,
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'space-between',
                                  cursor: 'pointer',
                                  '&:hover': { bgcolor: 'rgba(255,255,255,0.02)' },
                                }}
                                onClick={() => toggleEndpoint(endpoint.id)}
                              >
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                                  <HubIcon size={14} color="#FFD740" weight="fill" />
                                  <Box>
                                    <Typography variant="caption" sx={{ fontWeight: 600 }}>{endpoint.name}</Typography>
                                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontSize: 9 }}>
                                      {getApiTypeLabel(endpoint.apiType)} · {endpoint.baseUrl || t('endpoint.no_url')}
                                    </Typography>
                                  </Box>
                                </Box>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }} onClick={(e) => e.stopPropagation()}>
                                  {testResult && (
                                    testResult.success
                                      ? <CheckCircleIcon size={12} color="#00E676" weight="fill" />
                                      : <ErrorIcon size={12} color="#FF5252" weight="fill" />
                                  )}
                                  {isTesting && <CircularProgress size={12} />}
                                  <Tooltip title={t('endpoint.test_connection')}>
                                    <IconButton size="small" sx={{ p: 0.25 }} onClick={() => handleTestConnection(endpoint.id)}>
                                      <PlayArrowIcon size={12} />
                                    </IconButton>
                                  </Tooltip>
                                  <Tooltip title={t('endpoint.edit')}>
                                    <IconButton size="small" sx={{ p: 0.25 }} onClick={() => setEndpointDialog({ open: true, data: endpoint, providerId: provider.id })}>
                                      <EditIcon size={12} />
                                    </IconButton>
                                  </Tooltip>
                                  <Tooltip title={t('endpoint.delete')}>
                                    <IconButton size="small" sx={{ p: 0.25 }} onClick={() => setDeleteConfirm({
                                      open: true,
                                      title: t('endpoint.delete'),
                                      message: t('endpoint.delete_confirm', { name: endpoint.name }),
                                      onConfirm: () => {
                                        deleteEndpoint(endpoint.id);
                                        setDeleteConfirm({ open: false, title: '', message: '', onConfirm: () => {} });
                                      },
                                    })}>
                                      <DeleteIcon size={12} color="#FF5252" />
                                    </IconButton>
                                  </Tooltip>
                                  <IconButton size="small" sx={{ p: 0.25 }} onClick={() => toggleEndpoint(endpoint.id)}>
                                    {isEndpointExpanded ? <ExpandLessIcon size={12} /> : <ExpandMoreIcon size={12} />}
                                  </IconButton>
                                </Box>
                              </Box>

                              <Collapse in={isEndpointExpanded}>
                                <Divider sx={{ borderColor: 'rgba(48,54,61,0.6)' }} />
                                <Box sx={{ p: 1 }}>
                                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.75 }}>
                                    <Typography variant="caption" color="text.secondary">
                                      {t('model.label')} ({endpointModels.length})
                                    </Typography>
                                    <Button
                                      size="small"
                                      startIcon={<PlusIcon size={10} weight="bold" />}
                                      onClick={() => setModelDialog({ open: true, data: null, endpointId: endpoint.id })}
                                      sx={{ fontSize: 9, borderRadius: 1 }}
                                    >
                                      {t('model.add')}
                                    </Button>
                                  </Box>

                                  {endpointModels.length === 0 ? (
                                    <Typography variant="caption" color="text.disabled" sx={{ display: 'block', textAlign: 'center', py: 0.75 }}>
                                      {t('model.no_models')}
                                    </Typography>
                                  ) : (
                                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                                      {endpointModels.map((model) => {
                                        const modelTestResult = modelTestResults.get(model.id);
                                        const isModelTesting = testingModelId === model.id;

                                        return (
                                          <Box
                                            key={model.id}
                                            sx={{
                                              p: 0.75,
                                              border: 1,
                                              borderColor: 'rgba(48,54,61,0.6)',
                                              borderRadius: 1,
                                              display: 'flex',
                                              alignItems: 'center',
                                              justifyContent: 'space-between',
                                              '&:hover': { borderColor: 'rgba(108,99,255,0.5)' },
                                            }}
                                          >
                                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0, flex: 1 }}>
                                              <SmartToyIcon size={12} color={model.enabled ? '#6C63FF' : '#555'} weight="fill" />
                                              <Box sx={{ minWidth: 0, flex: 1 }}>
                                                <Typography variant="caption" sx={{ fontWeight: 600, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                  {model.name}
                                                </Typography>
                                                <Typography variant="caption" color="text.secondary" sx={{ fontSize: 8 }}>
                                                  {model.refKey}
                                                </Typography>
                                              </Box>
                                            </Box>
                                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25, flexShrink: 0 }}>
                                              {model.reasoning && <Chip label={t('model.reasoning_badge')} size="small" color="warning" sx={{ fontSize: 7, height: 12, minWidth: 12 }} />}
                                              {model.inputTypes.includes('image') && <Chip label={t('model.image_badge')} size="small" color="info" sx={{ fontSize: 7, height: 12, minWidth: 12 }} />}
                                              {modelTestResult && (
                                                modelTestResult.success
                                                  ? <CheckCircleIcon size={10} color="#00E676" weight="fill" />
                                                  : <ErrorIcon size={10} color="#FF5252" weight="fill" />
                                              )}
                                              {isModelTesting && <CircularProgress size={10} />}
                                              <Tooltip title={t('model.test')}>
                                                <IconButton size="small" sx={{ p: 0.15 }} onClick={(e) => { e.stopPropagation(); handleTestModel(model.id); }}>
                                                  <PlayArrowIcon size={10} />
                                                </IconButton>
                                              </Tooltip>
                                              <IconButton size="small" sx={{ p: 0.15 }} onClick={() => setModelDialog({ open: true, data: model, endpointId: endpoint.id })}>
                                                <EditIcon size={10} />
                                              </IconButton>
                                              <IconButton size="small" sx={{ p: 0.15 }} onClick={() => setDeleteConfirm({
                                                open: true,
                                                title: t('model.delete'),
                                                message: t('model.delete_confirm', { name: model.name }),
                                                onConfirm: () => {
                                                  deleteModel(model.id);
                                                  setDeleteConfirm({ open: false, title: '', message: '', onConfirm: () => {} });
                                                },
                                              })}>
                                                <DeleteIcon size={10} color="#FF5252" />
                                              </IconButton>
                                            </Box>
                                          </Box>
                                        );
                                      })}
                                    </Box>
                                  )}
                                </Box>
                              </Collapse>
                            </Card>
                          );
                        })}
                      </Box>
                    )}
                  </Box>
                </Collapse>
              </Card>
            );
          })}
        </Box>
      )}

      <ProviderDialog
        open={providerDialog.open}
        onClose={() => setProviderDialog({ open: false, data: null })}
        onSave={saveProvider}
        initial={providerDialog.data}
      />

      <EndpointDialog
        open={endpointDialog.open}
        onClose={() => setEndpointDialog({ open: false, data: null, providerId: '' })}
        onSave={saveEndpoint}
        initial={endpointDialog.data}
        providerId={endpointDialog.providerId}
      />

      <ModelDialog
        open={modelDialog.open}
        onClose={() => setModelDialog({ open: false, data: null, endpointId: '' })}
        onSave={saveModel}
        initial={modelDialog.data}
        endpointId={modelDialog.endpointId}
      />

      <ConfirmDialog
        open={deleteConfirm.open}
        title={deleteConfirm.title}
        message={deleteConfirm.message}
        onConfirm={deleteConfirm.onConfirm}
        onCancel={() => setDeleteConfirm({ open: false, title: '', message: '', onConfirm: () => {} })}
        cancelLabel={t('dialog.cancel')}
        confirmLabel={t('dialog.confirm_delete')}
      />

      <Snackbar
        open={snackbar.open}
        autoHideDuration={3000}
        onClose={() => setSnackbar({ ...snackbar, open: false })}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity={snackbar.severity} onClose={() => setSnackbar({ ...snackbar, open: false })} variant="filled" sx={{ fontSize: 12 }}>
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
}
