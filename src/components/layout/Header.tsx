import AppBar from '@mui/material/AppBar';
import Toolbar from '@mui/material/Toolbar';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Box from '@mui/material/Box';
import { ListIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@mui/material/styles';
import { useSettingsStore } from '../../engine';
import logo from '../../assets/logo.svg?url';

interface HeaderProps {
  onToggleSidebar: () => void;
}

export function Header({ onToggleSidebar }: HeaderProps) {
  const { i18n, t } = useTranslation();
  const theme = useTheme();
  const currentLang = i18n.language?.startsWith('zh') ? 'zh-CN' : 'en-US';
  const isDark = theme.palette.mode === 'dark';

  const toggleLanguage = () => {
    const nextLang = currentLang === 'zh-CN' ? 'en-US' : 'zh-CN';
    useSettingsStore.getState().update('language', nextLang);
    i18n.changeLanguage(nextLang);
  };

  return (
    <AppBar position="fixed" sx={{ zIndex: (theme) => theme.zIndex.drawer + 1 }}>
      <Toolbar variant="dense" sx={{ gap: 1 }}>
        <IconButton color="inherit" edge="start" onClick={onToggleSidebar} sx={{ mr: 1 }}>
          <ListIcon size={22} weight="bold" />
        </IconButton>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexGrow: 1 }}>
          <Box
            component="img"
            src={logo}
            alt="Biosphere Terminal"
            sx={{
              width: 24,
              height: 24,
              borderRadius: '6px',
              objectFit: 'contain',
            }}
          />
          <Typography variant="h6" noWrap component="div" sx={{ fontSize: 15 }}>
            {t('app.name')}
          </Typography>
        </Box>
        <Button
          color="inherit"
          size="small"
          onClick={toggleLanguage}
          sx={{
            minWidth: 52,
            fontSize: 12,
            fontWeight: 600,
            border: isDark
              ? '1px solid rgba(255,255,255,0.15)'
              : '1px solid rgba(0,0,0,0.15)',
            borderRadius: 2,
            px: 1.5,
          }}
        >
          {currentLang === 'zh-CN' ? `🌐 ${t('lang_en')}` : `🌐 ${t('lang_zh')}`}
        </Button>
      </Toolbar>
    </AppBar>
  );
}
