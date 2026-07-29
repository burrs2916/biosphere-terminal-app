import { useCallback, useMemo, useState } from 'react';
import Dialog from '@mui/material/Dialog';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import IconButton from '@mui/material/IconButton';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import Divider from '@mui/material/Divider';
import Alert from '@mui/material/Alert';
import CircularProgress from '@mui/material/CircularProgress';
import { XIcon, CheckCircleIcon, SparkleIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { useLicenseStore, PRO_FEATURES, PRO_FEATURE_LABELS } from './licenseStore';
import { useUpgradeDialogStore } from './upgradeDialogStore';

/// Microsoft Store listing URL for the Pro lifetime add-on.
const STORE_LISTING_URL = 'https://apps.microsoft.com/detail/9NN9316C8F8K';

/// One-time price for the Pro lifetime license, in USD. Displayed in the
/// dialog and matched in the Store listing.
const PRO_PRICE_USD = 9.99;

export function UpgradeDialog() {
  const { t } = useTranslation();
  const open = useUpgradeDialogStore((s) => s.open);
  const triggerFeature = useUpgradeDialogStore((s) => s.triggerFeature);
  const closeDialog = useUpgradeDialogStore((s) => s.closeDialog);
  const status = useLicenseStore((s) => s.status);
  const purchase = useLicenseStore((s) => s.purchase);
  const restore = useLicenseStore((s) => s.restore);
  const loading = useLicenseStore((s) => s.loading);
  const error = useLicenseStore((s) => s.error);
  const clearError = useLicenseStore((s) => s.clearError);

  const [purchasing, setPurchasing] = useState(false);

  // 关闭对话框时清空错误状态，避免下次打开时显示上次的错误。
  const handleClose = useCallback(() => {
    clearError();
    closeDialog();
  }, [clearError, closeDialog]);

  const handlePurchase = useCallback(async () => {
    setPurchasing(true);
    try {
      await purchase();
      handleClose();
    } catch {
      // Error is recorded in the store and shown below.
    } finally {
      setPurchasing(false);
    }
  }, [purchase, handleClose]);

  const handleRestore = useCallback(async () => {
    setPurchasing(true);
    try {
      await restore();
      handleClose();
    } catch {
      /* swallowed */
    } finally {
      setPurchasing(false);
    }
  }, [restore, handleClose]);

  /// 检测错误是否指示「应用不是从 Store 安装的」，这种场景 IAP API 永远会失败，
  /// 应当引导用户去浏览器 Store 页面购买，而不是反复在应用内点击。
  const isStoreUnavailableError = useMemo(() => {
    if (!error) return false;
    const lower = error.toLowerCase();
    return (
      lower.includes('not running as a microsoft store package') ||
      lower.includes('no_package_identity') ||
      lower.includes('0x80073d54') ||
      lower.includes('only available on the windows microsoft store build')
    );
  }, [error]);

  const trialDaysLeft = status?.trialDaysRemaining ?? 0;
  const isTrial = status?.isTrial ?? false;
  const isExpired = status?.isExpired ?? false;

  const headline = useMemo(() => {
    if (isTrial && trialDaysLeft > 0) {
      // 注意：i18next 只会替换那些作为参数传入的插值变量。
      // 之前只传了 defaultValue 却没传 trialDaysLeft，
      // 结果 UI 上出现字面量 "{{trialDaysLeft}} day(s)"。
      return t('license.upgrade.headlineTrial', {
        trialDaysLeft,
        defaultValue: `Your trial ends in ${trialDaysLeft} day(s). Unlock Pro to keep everything.`,
      });
    }
    if (isExpired) {
      return t('license.upgrade.headlineExpired', {
        defaultValue: 'Your trial has ended. Upgrade to Pro to continue.',
      });
    }
    return t('license.upgrade.headlineDefault', {
      defaultValue: 'Unlock Biosphere Pro',
    });
  }, [isTrial, trialDaysLeft, isExpired, t]);

  const subheadline = useMemo(() => {
    if (triggerFeature) {
      return t('license.upgrade.subheadlineFeature', {
        defaultValue: `Pro is required for: ${PRO_FEATURE_LABELS[triggerFeature]}`,
        feature: PRO_FEATURE_LABELS[triggerFeature],
      });
    }
    return t('license.upgrade.subheadlineDefault', {
      defaultValue: 'One-time purchase. Lifetime access. No subscription.',
    });
  }, [triggerFeature, t]);

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="sm"
      fullWidth
      slotProps={{
        paper: {
          sx: {
            borderRadius: 3,
            backgroundImage:
              'linear-gradient(135deg, rgba(108,99,255,0.08) 0%, rgba(79,195,247,0.05) 100%)',
          },
        },
      }}
    >
      <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', pb: 1 }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <SparkleIcon size={22} weight="fill" color="#6C63FF" />
          <Typography variant="h6" sx={{ fontWeight: 700 }}>
            {t('license.upgrade.title', { defaultValue: 'Biosphere Pro' })}
          </Typography>
        </Stack>
        <IconButton size="small" onClick={handleClose} aria-label={t('action.close', { defaultValue: 'Close' })}>
          <XIcon size={18} />
        </IconButton>
      </DialogTitle>
      <DialogContent sx={{ pt: 0 }}>
        <Stack spacing={2.5}>
          <Box>
            <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 0.5 }}>
              {headline}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {subheadline}
            </Typography>
          </Box>

          <Divider />

          <Box>
            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              {t('license.upgrade.featuresLabel', { defaultValue: 'Everything in Pro' })}
            </Typography>
            <Stack spacing={1} sx={{ mt: 1 }}>
              {PRO_FEATURES.map((feature) => (
                <Stack key={feature} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                  <CheckCircleIcon size={18} weight="fill" color="#00E676" />
                  <Typography variant="body2">{PRO_FEATURE_LABELS[feature]}</Typography>
                  {triggerFeature === feature && (
                    <Chip
                      size="small"
                      color="secondary"
                      label={t('license.upgrade.requiredChip', { defaultValue: 'Required' })}
                      sx={{ ml: 'auto', height: 20, fontSize: 10 }}
                    />
                  )}
                </Stack>
              ))}
            </Stack>
          </Box>

          <Box
            sx={{
              p: 2,
              borderRadius: 2,
              bgcolor: 'background.paper',
              border: '1px solid',
              borderColor: 'divider',
            }}
          >
            <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'baseline' }}>
                <Typography variant="h5" sx={{ fontWeight: 800 }}>
                  ${PRO_PRICE_USD.toFixed(2)}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {t('license.upgrade.oneTime', { defaultValue: 'one-time' })}
                </Typography>
              </Stack>
              <Typography variant="caption" color="text.secondary">
                {t('license.upgrade.lifetimeAccess', { defaultValue: 'Lifetime access' })}
              </Typography>
            </Stack>
          </Box>

          {error && !isStoreUnavailableError && (
            <Alert severity="error" variant="outlined">
              {error}
            </Alert>
          )}
          {isStoreUnavailableError && (
            <Alert severity="info" variant="outlined">
              {t('license.upgrade.sideloadHint', {
                defaultValue:
                  'In-app purchase is only available when the app is installed from Microsoft Store. To purchase Pro: (1) click "Buy on Microsoft Store" below, (2) after buying, uninstall this sideloaded copy, (3) install the app from Microsoft Store — your purchase will unlock automatically on next launch.',
              })}
            </Alert>
          )}

          <Stack spacing={1}>
            {!isStoreUnavailableError && (
              <Button
                variant="contained"
                size="large"
                fullWidth
                disabled={loading || purchasing}
                onClick={handlePurchase}
                startIcon={purchasing ? <CircularProgress size={18} color="inherit" /> : undefined}
                sx={{
                  py: 1.25,
                  fontWeight: 700,
                  background: 'linear-gradient(135deg, #6C63FF 0%, #4FC3F7 100%)',
                  '&:hover': {
                    background: 'linear-gradient(135deg, #5B54E0 0%, #29B6F6 100%)',
                  },
                }}
              >
                {purchasing
                  ? t('license.upgrade.processing', { defaultValue: 'Processing…' })
                  : t('license.upgrade.cta', { defaultValue: `Unlock Pro for $${PRO_PRICE_USD.toFixed(2)}` })}
              </Button>
            )}
            {isStoreUnavailableError && (
              <Button
                variant="contained"
                size="large"
                fullWidth
                href={STORE_LISTING_URL}
                target="_blank"
                rel="noopener noreferrer"
                sx={{
                  py: 1.25,
                  fontWeight: 700,
                  background: 'linear-gradient(135deg, #6C63FF 0%, #4FC3F7 100%)',
                  '&:hover': {
                    background: 'linear-gradient(135deg, #5B54E0 0%, #29B6F6 100%)',
                  },
                }}
              >
                {t('license.upgrade.buyOnStore', {
                  defaultValue: `Buy on Microsoft Store · $${PRO_PRICE_USD.toFixed(2)}`,
                })}
              </Button>
            )}
            <Button
              variant="text"
              size="small"
              disabled={loading || purchasing}
              onClick={handleRestore}
            >
              {t('license.upgrade.restore', { defaultValue: 'Restore previous purchase' })}
            </Button>
            {!isStoreUnavailableError && (
              <Button
                variant="text"
                size="small"
                href={STORE_LISTING_URL}
                target="_blank"
                rel="noopener noreferrer"
              >
                {t('license.upgrade.viewOnStore', { defaultValue: 'View on Microsoft Store' })}
              </Button>
            )}
          </Stack>

          <Typography variant="caption" color="text.secondary" align="center">
            {t('license.upgrade.disclaimer', {
              defaultValue:
                'Lifetime license is tied to your Microsoft account. Reinstalling on the same account restores Pro automatically.',
            })}
          </Typography>
        </Stack>
      </DialogContent>
    </Dialog>
  );
}
