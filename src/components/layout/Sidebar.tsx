import Drawer from '@mui/material/Drawer';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  TerminalIcon,
  ClockCounterClockwiseIcon,
  NotebookIcon,
  RobotIcon,
  PlugsConnectedIcon,
  PuzzlePieceIcon,
  GearSixIcon,
} from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';

interface SidebarProps {
  open: boolean;
}

const menuConfig = [
  { path: '/', labelKey: 'menu.terminal', icon: TerminalIcon, color: '#4FC3F7' },
  { path: '/commands', labelKey: 'menu.commands', icon: ClockCounterClockwiseIcon, color: '#FFB74D' },
  { path: '/notebook', labelKey: 'menu.notebook', icon: NotebookIcon, color: '#81C784' },
  { path: '/agent', labelKey: 'menu.agent', icon: RobotIcon, color: '#CE93D8' },
  { path: '/connections', labelKey: 'menu.connections', icon: PlugsConnectedIcon, color: '#4DD0E1' },
  { path: '/plugins', labelKey: 'menu.plugins', icon: PuzzlePieceIcon, color: '#AED581' },
  { path: '/settings', labelKey: 'menu.settings', icon: GearSixIcon, color: '#90A4AE' },
];

export function Sidebar({ open }: SidebarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();

  return (
    <Drawer
      variant="persistent"
      anchor="left"
      open={open}
      sx={{
        width: 220,
        flexShrink: 0,
        '& .MuiDrawer-paper': {
          width: 220,
          boxSizing: 'border-box',
          mt: '48px',
        },
      }}
    >
      <Box sx={{ pt: 1.5, px: 2, pb: 1 }}>
        <Typography
          variant="caption"
          sx={{
            color: 'text.secondary',
            fontWeight: 700,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            fontSize: 10,
          }}
        >
          {t('menu.navigation')}
        </Typography>
      </Box>
      <List sx={{ px: 0.5 }}>
        {menuConfig.map((item) => {
          const isActive = location.pathname === item.path;
          return (
            <ListItemButton
              key={item.path}
              selected={isActive}
              onClick={() => navigate(item.path)}
              sx={{
                gap: 1.5,
                py: 1,
                px: 1.5,
              }}
            >
              <ListItemIcon sx={{ minWidth: 0 }}>
                <item.icon
                  size={22}
                  weight={isActive ? 'fill' : 'regular'}
                  color={isActive ? item.color : undefined}
                  style={{ transition: 'all 0.2s' }}
                />
              </ListItemIcon>
              <ListItemText
                primary={t(item.labelKey)}
                slotProps={{
                  primary: {
                    sx: {
                      fontSize: 13,
                      fontWeight: isActive ? 600 : 400,
                      color: isActive ? item.color : 'text.primary',
                      transition: 'all 0.2s',
                    },
                  },
                }}
              />
            </ListItemButton>
          );
        })}
      </List>
    </Drawer>
  );
}
