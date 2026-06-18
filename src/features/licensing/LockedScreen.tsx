import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import { LockIcon, SparkleIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import type { ProFeature } from '../../proto/licensing';
import { PRO_FEATURE_LABELS } from './licenseStore';
import { useUpgradeDialogStore } from './upgradeDialogStore';

interface LockedScreenProps {
  feature: ProFeature;
  /// Optional custom message shown below the feature name.
  message?: string;
}

/// Full-page placeholder shown when a Pro feature is locked. Renders a
/// lock icon, the feature name, and an "Upgrade to Pro" button that opens
/// the upgrade dialog.
export function LockedScreen({ feature, message }: LockedScreenProps) {
  const { t } = useTranslation();
  const openDialog = useUpgradeDialogStore((s) => s.openDialog);

  return (
    <Box
      sx={{
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        p: 4,
      }}
    >
      <Stack spacing={2} sx={{ alignItems: 'center', textAlign: 'center', maxWidth: 420 }}>
        <Box
          sx={{
            width: 64,
            height: 64,
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'linear-gradient(135deg, rgba(108,99,255,0.15) 0%, rgba(79,195,247,0.1) 100%)',
            border: '1px solid',
            borderColor: 'divider',
          }}
        >
          <LockIcon size={28} weight="duotone" color="#6C63FF" />
        </Box>
        <Typography variant="h6" sx={{ fontWeight: 700 }}>
          {t('license.locked.title', { defaultValue: 'Pro Feature' })}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {message ??
            t('license.locked.message', {
              defaultValue: `${PRO_FEATURE_LABELS[feature]} is part of Biosphere Pro. Upgrade to unlock this feature.`,
              feature: PRO_FEATURE_LABELS[feature],
            })}
        </Typography>
        <Button
          variant="contained"
          startIcon={<SparkleIcon size={18} weight="fill" />}
          onClick={() => openDialog(feature)}
          sx={{
            mt: 1,
            px: 3,
            py: 1,
            fontWeight: 700,
            background: 'linear-gradient(135deg, #6C63FF 0%, #4FC3F7 100%)',
            '&:hover': {
              background: 'linear-gradient(135deg, #5B54E0 0%, #29B6F6 100%)',
            },
          }}
        >
          {t('license.locked.cta', { defaultValue: 'Upgrade to Pro' })}
        </Button>
      </Stack>
    </Box>
  );
}
