import Box from '@mui/material/Box';
import Tooltip from '@mui/material/Tooltip';
import { XIcon } from '@phosphor-icons/react';
import { useTheme } from '@mui/material/styles';

interface TabBarProps {
  tabs: { id: string; title: string; isActive: boolean; connectionType: 'local' | 'ssh'; disconnected?: boolean }[];
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
}

export function TabBar({ tabs, onSelect, onClose }: TabBarProps) {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';

  // 颜色体系
  const colors = isDark
    ? {
        bg: '#161B22',
        border: 'rgba(255,255,255,0.06)',
        tabHover: 'rgba(255,255,255,0.04)',
        tabActiveBg: 'rgba(108,99,255,0.06)',
        tabActiveBorder: 'rgba(108,99,255,0.25)',
        textActive: '#E6EDF3',
        textInactive: '#8B949E',
        dotSsh: '#4FC3F7',
        dotLocal: '#81C784',
        dotDisconnected: '#FF5252',
        indicator: '#6C63FF',
        indicatorErr: '#FF5252',
        closeHover: 'rgba(255,255,255,0.12)',
      }
    : {
        bg: '#F6F8FA',
        border: 'rgba(0,0,0,0.08)',
        tabHover: 'rgba(0,0,0,0.04)',
        tabActiveBg: 'rgba(108,99,255,0.04)',
        tabActiveBorder: 'rgba(108,99,255,0.18)',
        textActive: '#1F2328',
        textInactive: '#656D76',
        dotSsh: '#0284C7',
        dotLocal: '#2E7D32',
        dotDisconnected: '#D32F2F',
        indicator: '#6C63FF',
        indicatorErr: '#D32F2F',
        closeHover: 'rgba(0,0,0,0.10)',
      };

  return (
    <Box
      sx={{
        display: 'flex',
        gap: 0.5,
        px: 0.75,
        py: 0.5,
        minHeight: 36,
        alignItems: 'center',
        bgcolor: colors.bg,
        borderBottom: '1px solid',
        borderColor: colors.border,
        overflow: 'auto',
        scrollbarWidth: 'none',
        '&::-webkit-scrollbar': { display: 'none' },
      }}
    >
      {tabs.map((tab) => {
        const isDisconnected = !!tab.disconnected;
        const isSSH = tab.connectionType === 'ssh';
        const isActive = tab.isActive;
        const dotColor = isDisconnected
          ? colors.dotDisconnected
          : isSSH ? colors.dotSsh : colors.dotLocal;

        return (
          <Tooltip
            key={tab.id}
            title={tab.title}
            placement="bottom"
            arrow
            disableHoverListener={tab.title.length < 24}
          >
            {/* 单个标签外框 */}
            <Box
              onClick={() => onSelect(tab.id)}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 0.75,
                px: 1.25,
                py: 0.25,
                height: 28,
                minWidth: 80,
                maxWidth: 160,
                borderRadius: '6px 6px 0 0',
                cursor: 'pointer',
                position: 'relative',
                flexShrink: 0,
                bgcolor: isActive ? colors.tabActiveBg : 'transparent',
                borderTop: isActive ? `2px solid ${colors.tabActiveBorder}` : '2px solid transparent',
                opacity: isDisconnected ? 0.55 : 1,
                transition: 'background-color 0.12s ease, border-color 0.12s ease',
                '&:hover': {
                  bgcolor: isActive ? colors.tabActiveBg : colors.tabHover,
                },
              }}
            >
              {/* 连接状态点 */}
              <Box
                sx={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  bgcolor: dotColor,
                  flexShrink: 0,
                  boxShadow: isActive && !isDisconnected ? `0 0 4px ${dotColor}` : 'none',
                  transition: 'box-shadow 0.15s ease',
                }}
              />

              {/* 标签文字 */}
              <Box
                sx={{
                  fontSize: '0.75rem',
                  fontWeight: isActive ? 600 : 400,
                  color: isActive ? colors.textActive : colors.textInactive,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  flex: 1,
                  minWidth: 0,
                  lineHeight: 1.2,
                  userSelect: 'none',
                }}
              >
                {tab.title}
              </Box>

              {/* 关闭按钮 */}
              <Box
                onClick={(e) => {
                  e.stopPropagation();
                  onClose(tab.id);
                }}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 16,
                  height: 16,
                  borderRadius: '3px',
                  flexShrink: 0,
                  ml: 0.25,
                  cursor: 'pointer',
                  color: colors.textInactive,
                  transition: 'all 0.1s ease',
                  '&:hover': {
                    bgcolor: colors.closeHover,
                    color: colors.textActive,
                  },
                }}
              >
                <XIcon size={10} />
              </Box>

              {/* 底部活跃指示条 */}
              {isActive && (
                <Box
                  sx={{
                    position: 'absolute',
                    bottom: 0,
                    left: 6,
                    right: 6,
                    height: 2,
                    borderRadius: '2px 2px 0 0',
                    background: isDisconnected
                      ? `linear-gradient(90deg, ${colors.indicatorErr}, transparent)`
                      : `linear-gradient(90deg, ${colors.indicator}, transparent)`,
                  }}
                />
              )}
            </Box>
          </Tooltip>
        );
      })}
    </Box>
  );
}
