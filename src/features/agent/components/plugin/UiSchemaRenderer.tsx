import React from 'react';
import {
  Box,
  TextField,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  FormControlLabel,
  Checkbox,
  Slider,
  Button,
  Typography,
  Chip,
  Stack,
  useTheme,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import { open } from '@tauri-apps/plugin-dialog';
import type { UiSchema, UiField, QuickAction } from '../../../../proto/plugin';

interface UiSchemaRendererProps {
  uiSchema: UiSchema;
  values: Record<string, unknown>;
  onChange: (values: Record<string, unknown>) => void;
  onSubmit: () => void;
  loading?: boolean;
}

export const UiSchemaRenderer: React.FC<UiSchemaRendererProps> = ({
  uiSchema,
  values,
  onChange,
  onSubmit,
  loading = false,
}) => {
  const { t } = useTranslation('agent');
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';

  const handleChange = (name: string, value: unknown) => {
    onChange({ ...values, [name]: value });
  };

  const sortedFields = [...uiSchema.fields].sort((a, b) => (a.order ?? 999) - (b.order ?? 999));

  const groups = new Map<string, UiField[]>();
  const ungrouped: UiField[] = [];
  for (const field of sortedFields) {
    if (field.group) {
      const existing = groups.get(field.group) || [];
      existing.push(field);
      groups.set(field.group, existing);
    } else {
      ungrouped.push(field);
    }
  }

  const renderField = (field: UiField) => {
    const val = values[field.name];
    const label = field.label || field.name;

    switch (field.widget) {
      case 'text':
      case 'textarea':
        return (
          <TextField
            key={field.name}
            label={label}
            value={(val as string) ?? ''}
            onChange={(e) => handleChange(field.name, e.target.value)}
            placeholder={field.placeholder}
            multiline={field.widget === 'textarea'}
            minRows={field.widget === 'textarea' ? 3 : undefined}
            fullWidth
            size="small"
            margin="dense"
          />
        );

      case 'number':
        return (
          <TextField
            key={field.name}
            label={label}
            type="number"
            value={val !== undefined ? String(val) : ''}
            onChange={(e) => handleChange(field.name, e.target.value ? Number(e.target.value) : undefined)}
            placeholder={field.placeholder}
            fullWidth
            size="small"
            margin="dense"
          />
        );

      case 'slider':
        return (
          <Box key={field.name} sx={{ px: 1, mt: 1 }}>
            <Typography variant="body2" gutterBottom>{label}</Typography>
            <Slider
              value={(val as number) ?? field.minValue ?? 0}
              onChange={(_, v) => handleChange(field.name, v)}
              min={field.minValue}
              max={field.maxValue}
              step={field.step ?? 1}
              valueLabelDisplay="auto"
            />
          </Box>
        );

      case 'select':
        return (
          <FormControl key={field.name} fullWidth size="small" margin="dense">
            <InputLabel>{label}</InputLabel>
            <Select
              value={(val as string) ?? ''}
              onChange={(e) => handleChange(field.name, e.target.value)}
              label={label}
            >
              {(field.options || []).map((opt: string) => (
                <MenuItem key={opt} value={opt}>{opt}</MenuItem>
              ))}
            </Select>
          </FormControl>
        );

      case 'checkbox':
        return (
          <FormControlLabel
            key={field.name}
            control={
              <Checkbox
                checked={!!val}
                onChange={(e) => handleChange(field.name, e.target.checked)}
              />
            }
            label={label}
          />
        );

      case 'file':
        return (
          <Box key={field.name} sx={{ mt: 1 }}>
            <Typography variant="body2" gutterBottom>{label}</Typography>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <Button
                variant="outlined"
                size="small"
                onClick={async () => {
                  const selected = await open({
                    multiple: field.multiple ?? false,
                    filters: field.accept
                      ? [{ name: 'Files', extensions: field.accept.split(',').map(s => s.trim().replace(/^\./, '')) }]
                      : undefined,
                  });
                  if (selected) {
                    if (Array.isArray(selected)) {
                      handleChange(field.name, selected);
                    } else {
                      handleChange(field.name, selected);
                    }
                  }
                }}
              >
                {field.placeholder || t('select_file')}
              </Button>
              {val !== undefined && val !== null && (
                <Typography variant="caption" sx={{ ml: 1, maxWidth: 300 }} noWrap>
                  {typeof val === 'string' ? val : Array.isArray(val) ? (val as string[]).join(', ') : String(val)}
                </Typography>
              )}
            </Stack>
          </Box>
        );

      case 'chips':
        return (
          <Box key={field.name} sx={{ mt: 1 }}>
            <Typography variant="body2" gutterBottom>{label}</Typography>
            <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', gap: 0.5 }}>
              {(field.options || []).map((opt: string) => (
                <Chip
                  key={opt}
                  label={opt}
                  size="small"
                  variant={Array.isArray(val) && (val as string[]).includes(opt) ? 'filled' : 'outlined'}
                  onClick={() => {
                    const current = (Array.isArray(val) ? val : []) as string[];
                    const next = current.includes(opt)
                      ? current.filter((v: string) => v !== opt)
                      : [...current, opt];
                    handleChange(field.name, next);
                  }}
                />
              ))}
            </Stack>
          </Box>
        );

      default:
        return (
          <TextField
            key={field.name}
            label={label}
            value={(val as string) ?? ''}
            onChange={(e) => handleChange(field.name, e.target.value)}
            placeholder={field.placeholder}
            fullWidth
            size="small"
            margin="dense"
          />
        );
    }
  };

  const renderQuickActions = (actions: QuickAction[]) => {
    if (!actions || actions.length === 0) return null;
    return (
      <Stack direction="row" spacing={1} sx={{ mb: 1 }}>
        {actions.map((action) => (
          <Chip
            key={action.name}
            label={action.name}
            size="small"
            variant="outlined"
            clickable
            onClick={() => {
              if (action.presetParams) {
                onChange({ ...values, ...action.presetParams });
              }
            }}
          />
        ))}
      </Stack>
    );
  };

  return (
    <Box>
      {uiSchema.quickActions && renderQuickActions(uiSchema.quickActions)}

      {ungrouped.map(renderField)}

      {Array.from(groups.entries()).map(([groupName, fields]) => (
        <Box key={groupName} sx={{ mt: 1 }}>
          <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 0.5 }}>
            {groupName}
          </Typography>
          {fields.map(renderField)}
        </Box>
      ))}

      <Button
        variant="contained"
        fullWidth
        sx={{
          mt: 2,
          bgcolor: isDark ? '#4FC3F7' : '#1976d2',
          color: '#fff',
          fontWeight: 600,
          '&:hover': { bgcolor: isDark ? '#29B6F6' : '#1565C0' },
          '&.Mui-disabled': { bgcolor: isDark ? 'rgba(255,255,255,0.1)' : '#ccc', color: isDark ? 'rgba(255,255,255,0.4)' : '#666' },
        }}
        onClick={onSubmit}
        disabled={loading}
      >
        {loading ? t('executing') : uiSchema.submitLabel || t('execute')}
      </Button>
    </Box>
  );
};

export default UiSchemaRenderer;
