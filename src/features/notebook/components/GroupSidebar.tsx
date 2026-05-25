import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Box, List, ListItemButton, ListItemText, ListItemIcon,
  IconButton, Typography, Menu, MenuItem, Tooltip, Divider,
} from '@mui/material';
import {
  TrashIcon, DotsThreeVerticalIcon,
  FolderSimplePlusIcon, BooksIcon,
} from '@phosphor-icons/react';
import { IconRenderer } from './IconRenderer';
import { useNotebookStore } from '../store/notebookStore';
import type { NoteGroupDto } from '../../../proto/notebook';
import { GroupManageDialog } from './GroupManageDialog';
import { useTheme } from '@mui/material/styles';

export function GroupSidebar() {
  const { t } = useTranslation('notebook');
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const primaryColor = isDark ? '#6C63FF' : '#5B54E0';
  const mutedColor = isDark ? '#8B949E' : '#6B7280';

  const {
    groups, activeGroupId, loadGroups, setActiveGroupId, setActiveCategory,
  } = useNotebookStore();

  const [groupManageOpen, setGroupManageOpen] = useState(false);
  const [groupMenuAnchor, setGroupMenuAnchor] = useState<null | HTMLElement>(null);
  const [menuGroupId, setMenuGroupId] = useState<string | null>(null);

  useEffect(() => {
    loadGroups();
  }, [loadGroups]);

  const handleGroupClick = useCallback((groupId: string) => {
    setActiveGroupId(groupId);
    setActiveCategory('');
  }, [setActiveGroupId, setActiveCategory]);

  const handleGroupMenuOpen = (e: React.MouseEvent<HTMLElement>, groupId: string) => {
    e.stopPropagation();
    setGroupMenuAnchor(e.currentTarget);
    setMenuGroupId(groupId);
  };

  const handleGroupMenuClose = () => {
    setGroupMenuAnchor(null);
    setMenuGroupId(null);
  };

  const renderGroupItem = (group: NoteGroupDto) => {
    const isActive = activeGroupId === group.id;
    return (
      <ListItemButton
        key={group.id}
        onClick={() => handleGroupClick(group.id)}
        selected={isActive}
        sx={{
          borderRadius: 1.5,
          mx: 0.5,
          mb: 0.25,
          '&.Mui-selected': {
            bgcolor: `${group.color}18`,
            '&:hover': { bgcolor: `${group.color}28` },
          },
          '&:hover': { bgcolor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)' },
        }}
      >
        <ListItemIcon sx={{ minWidth: 28 }}>
          <IconRenderer value={group.icon} size={16} />
        </ListItemIcon>
        <ListItemText
          primary={group.name}
          slotProps={{
            primary: {
              noWrap: true,
              sx: {
                fontSize: 12,
                fontWeight: isActive ? 600 : 400,
                color: isActive ? group.color : 'text.primary',
              },
            },
          }}
        />
        <Typography variant="caption" color="text.secondary" sx={{ mr: 0.5, fontSize: 10 }}>
          {group.noteCount}
        </Typography>
        <IconButton
          size="small"
          onClick={(e) => handleGroupMenuOpen(e, group.id)}
          sx={{ opacity: 0, transition: 'opacity 0.2s', '.MuiListItemButton-root:hover &': { opacity: 1 } }}
        >
          <DotsThreeVerticalIcon size={12} color={mutedColor} />
        </IconButton>
      </ListItemButton>
    );
  };

  return (
    <Box
      sx={{
        width: 200,
        minWidth: 200,
        borderRight: '1px solid',
        borderColor: 'divider',
        display: 'flex',
        flexDirection: 'column',
        bgcolor: isDark ? 'rgba(0,0,0,0.02)' : 'rgba(0,0,0,0.01)',
      }}
    >
      <Box sx={{ p: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, fontSize: 10 }}>
          {t('group.title')}
        </Typography>
        <Tooltip title={t('group.manage') || ''}>
          <IconButton size="small" onClick={() => setGroupManageOpen(true)}>
            <FolderSimplePlusIcon size={14} color={primaryColor} />
          </IconButton>
        </Tooltip>
      </Box>

      <List dense sx={{ flex: 1, overflow: 'auto', px: 0.5 }}>
        <ListItemButton
          onClick={() => handleGroupClick('')}
          selected={activeGroupId === ''}
          sx={{
            borderRadius: 1.5,
            mb: 0.25,
            '&.Mui-selected': { bgcolor: `${primaryColor}18` },
          }}
        >
          <ListItemIcon sx={{ minWidth: 28 }}>
            <BooksIcon size={14} color={primaryColor} />
          </ListItemIcon>
          <ListItemText
            primary={t('notebook.all_notes')}
            slotProps={{ primary: { sx: { fontSize: 12, fontWeight: activeGroupId === '' ? 600 : 400 } } }}
          />
        </ListItemButton>

        <Divider sx={{ my: 0.5, mx: 1 }} />

        {groups.map(renderGroupItem)}
      </List>

      <Menu anchorEl={groupMenuAnchor} open={Boolean(groupMenuAnchor)} onClose={handleGroupMenuClose}>
        <MenuItem onClick={() => { setGroupManageOpen(true); handleGroupMenuClose(); }}>
          <IconRenderer value="✏️" size={14} sx={{ mr: 1.5 }} />
          {t('group.edit')}
        </MenuItem>
        <MenuItem onClick={() => { if (menuGroupId) useNotebookStore.getState().deleteGroup(menuGroupId); handleGroupMenuClose(); }}>
          <TrashIcon size={14} color={isDark ? '#FF5252' : '#D32F2F'} style={{ marginRight: 8 }} />
          {t('group.delete')}
        </MenuItem>
      </Menu>

      <GroupManageDialog open={groupManageOpen} onClose={() => setGroupManageOpen(false)} />
    </Box>
  );
}
