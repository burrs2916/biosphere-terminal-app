import { useCallback } from 'react';
import Popper from '@mui/material/Popper';
import Paper from '@mui/material/Paper';
import MenuList from '@mui/material/MenuList';
import MenuItem from '@mui/material/MenuItem';
import Divider from '@mui/material/Divider';
import Typography from '@mui/material/Typography';
import ClickAwayListener from '@mui/material/ClickAwayListener';
import { useTheme } from '@mui/material/styles';
import {
  ClipboardIcon,
  ClipboardTextIcon,
  MagnifyingGlassIcon,
  BroomIcon,
  SelectionAllIcon,
  ArrowLineDownIcon,
} from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';

interface ContextMenuState {
  mouseX: number;
  mouseY: number;
  hasSelection: boolean;
}

interface TerminalContextMenuProps {
  menuState: ContextMenuState | null;
  onClose: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onSelectAll: () => void;
  onClearBuffer: () => void;
  onFind: () => void;
  onScrollToBottom: () => void;
}

export function TerminalContextMenu({
  menuState,
  onClose,
  onCopy,
  onPaste,
  onSelectAll,
  onClearBuffer,
  onFind,
  onScrollToBottom,
}: TerminalContextMenuProps) {
  const { t } = useTranslation('terminal');
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const anchorEl = menuState
    ? {
        getBoundingClientRect: () => ({
          width: 0,
          height: 0,
          top: menuState.mouseY,
          right: menuState.mouseX,
          bottom: menuState.mouseY,
          left: menuState.mouseX,
        }),
      }
    : null;

  const handleAction = useCallback((action: () => void) => {
    action();
    onClose();
  }, [onClose]);

  const iconColor = isDark ? '#8B949E' : '#6B7280';

  const menuContent = (
    <Paper
      sx={{
        minWidth: 200,
        borderRadius: 2,
        border: '1px solid',
        borderColor: 'divider',
        boxShadow: isDark
          ? '0 8px 32px rgba(0,0,0,0.5)'
          : '0 8px 32px rgba(0,0,0,0.15)',
        bgcolor: isDark ? '#1C2128' : '#ffffff',
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <MenuList autoFocusItem={!!menuState} sx={{ py: 0.5 }}>
        <MenuItem
          onClick={() => handleAction(onCopy)}
          disabled={!menuState?.hasSelection}
          sx={{ gap: 1.5, py: 0.75, px: 1.5 }}
        >
          <ClipboardIcon size={16} color={iconColor} />
          <Typography variant="body2">{t('copy_selection')}</Typography>
        </MenuItem>
        <MenuItem
          onClick={() => handleAction(onPaste)}
          sx={{ gap: 1.5, py: 0.75, px: 1.5 }}
        >
          <ClipboardTextIcon size={16} color={iconColor} />
          <Typography variant="body2">{t('paste_clipboard')}</Typography>
        </MenuItem>
        <Divider />
        <MenuItem
          onClick={() => handleAction(onSelectAll)}
          sx={{ gap: 1.5, py: 0.75, px: 1.5 }}
        >
          <SelectionAllIcon size={16} color={iconColor} />
          <Typography variant="body2">{t('select_all')}</Typography>
        </MenuItem>
        <MenuItem
          onClick={() => handleAction(onFind)}
          sx={{ gap: 1.5, py: 0.75, px: 1.5 }}
        >
          <MagnifyingGlassIcon size={16} color={iconColor} />
          <Typography variant="body2">{t('find')}</Typography>
        </MenuItem>
        <Divider />
        <MenuItem
          onClick={() => handleAction(onClearBuffer)}
          sx={{ gap: 1.5, py: 0.75, px: 1.5 }}
        >
          <BroomIcon size={16} color={iconColor} />
          <Typography variant="body2">{t('clear_buffer')}</Typography>
        </MenuItem>
        <MenuItem
          onClick={() => handleAction(onScrollToBottom)}
          sx={{ gap: 1.5, py: 0.75, px: 1.5 }}
        >
          <ArrowLineDownIcon size={16} color={iconColor} />
          <Typography variant="body2">{t('scroll_to_bottom')}</Typography>
        </MenuItem>
      </MenuList>
    </Paper>
  );

  if (!menuState) return null;

  return (
    <ClickAwayListener onClickAway={onClose}>
      <Popper
        open={!!menuState}
        anchorEl={anchorEl as unknown as HTMLElement}
        placement="bottom-start"
        sx={{ zIndex: 9999 }}
      >
        {menuContent}
      </Popper>
    </ClickAwayListener>
  );
}
