import Drawer from '@mui/material/Drawer';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Chip from '@mui/material/Chip';
import Badge from '@mui/material/Badge';
import { useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  TerminalIcon,
  ClockCounterClockwiseIcon,
  NotebookIcon,
  RobotIcon,
  PlugsConnectedIcon,
  GearSixIcon,
} from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { useLicenseStore } from '../../features/licensing/licenseStore';
import { useUpgradeDialogStore } from '../../features/licensing/upgradeDialogStore';
import { useConnectionCountStore } from '../../features/connection/connectionCountStore';
import type { ProFeature } from '../../proto/licensing';

interface SidebarProps {
  open: boolean;
}

interface MenuItem {
  path: string;
  labelKey: string;
  icon: typeof TerminalIcon;
  color: string;
  /// 如果设置了，访问此菜单需要解锁对应的 Pro 功能
  proFeature?: ProFeature;
}

const menuConfig: MenuItem[] = [
  { path: '/', labelKey: 'menu.terminal', icon: TerminalIcon, color: '#4FC3F7' },
  { path: '/commands', labelKey: 'menu.commands', icon: ClockCounterClockwiseIcon, color: '#FFB74D' },
  { path: '/notebook', labelKey: 'menu.notebook', icon: NotebookIcon, color: '#81C784' },
  { path: '/agent', labelKey: 'menu.agent', icon: RobotIcon, color: '#CE93D8', proFeature: 'ai_copilot' },
  { path: '/connections', labelKey: 'menu.connections', icon: PlugsConnectedIcon, color: '#4DD0E1' },
  { path: '/settings', labelKey: 'menu.settings', icon: GearSixIcon, color: '#90A4AE' },
];

export function Sidebar({ open }: SidebarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();
  const canUseFn = useLicenseStore((s) => s.canUse);
  const openUpgrade = useUpgradeDialogStore((s) => s.openDialog);
  const connectionCount = useConnectionCountStore((s) => s.count);

  // 挂载时兜底刷新一次：模块级 refresh 可能在启动早期（DB 未就绪）失败，
  // 且 count 只在 ConnectionList.load 时更新；这里保证应用启动后徽标即正确。
  useEffect(() => {
    void useConnectionCountStore.getState().refresh();
  }, []);

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
          const isLocked = item.proFeature ? !canUseFn(item.proFeature) : false;
          return (
            <ListItemButton
              key={item.path}
              selected={isActive}
              onClick={() => {
                if (isLocked && item.proFeature) {
                  openUpgrade(item.proFeature);
                  return;
                }
                navigate(item.path);
              }}
              sx={{
                gap: 1.5,
                py: 1,
                px: 1.5,
                opacity: isLocked ? 0.55 : 1,
              }}
            >
              <ListItemIcon sx={{ minWidth: 0 }}>
                <Badge
                  badgeContent={item.path === '/connections' ? connectionCount : 0}
                  color="primary"
                  max={99}
                  showZero={false}
                >
                  <item.icon
                    size={22}
                    weight={isActive ? 'fill' : 'regular'}
                    color={isActive ? item.color : undefined}
                    style={{ transition: 'all 0.2s' }}
                  />
                </Badge>
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
              {isLocked && (
                <Chip
                  label="Pro"
                  size="small"
                  sx={{
                    height: 18,
                    fontSize: 10,
                    fontWeight: 700,
                    background: 'linear-gradient(135deg, #6C63FF 0%, #4FC3F7 100%)',
                    color: '#fff',
                    '& .MuiChip-label': { px: 0.75 },
                  }}
                />
              )}
            </ListItemButton>
          );
        })}
      </List>
    </Drawer>
  );
}
