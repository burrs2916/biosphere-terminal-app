import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Tooltip from '@mui/material/Tooltip';
import { useTranslation } from 'react-i18next';
import { XIcon, DesktopIcon, LightningIcon, WifiSlashIcon } from '@phosphor-icons/react';

interface TabBarProps {
  tabs: { id: string; title: string; isActive: boolean; connectionType: 'local' | 'ssh'; disconnected?: boolean }[];
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
}

export function TabBar({ tabs, onSelect, onClose }: TabBarProps) {
  const { t } = useTranslation();
  return (
    <Box sx={{ display: 'flex', gap: 0.5, px: 1, py: 0.5, overflow: 'auto' }}>
      {tabs.map((tab) => (
        <Chip
          key={tab.id}
          icon={
            tab.disconnected ? (
              <WifiSlashIcon size={14} color="#FF5252" weight="fill" />
            ) : tab.connectionType === 'ssh' ? (
              <LightningIcon size={14} color="#FFD740" weight="fill" />
            ) : (
              <DesktopIcon size={14} color="#4FC3F7" weight="fill" />
            )
          }
          label={tab.title}
          variant={tab.isActive ? 'filled' : 'outlined'}
          color={tab.isActive ? 'primary' : 'default'}
          size="small"
          onClick={() => onSelect(tab.id)}
          onDelete={() => onClose(tab.id)}
          deleteIcon={
            <Tooltip title={t('action.close')} arrow>
              <XIcon size={14} />
            </Tooltip>
          }
          sx={{
            ...(tab.isActive && {
              background: 'linear-gradient(135deg, rgba(108,99,255,0.2) 0%, rgba(108,99,255,0.08) 100%)',
              borderColor: 'rgba(108,99,255,0.4)',
            }),
            ...(tab.disconnected && {
              borderColor: 'rgba(255,82,82,0.4)',
              opacity: 0.7,
              '&.Mui-active': { opacity: 1 },
            }),
            ...(!tab.disconnected && tab.connectionType === 'ssh' && !tab.isActive && {
              borderColor: 'rgba(255,215,64,0.3)',
            }),
            '& .MuiChip-icon': {
              ml: '4px',
              mr: '-4px',
            },
          }}
        />
      ))}
    </Box>
  );
}
