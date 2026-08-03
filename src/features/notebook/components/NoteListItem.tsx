import { useState } from 'react';
import {
  Box, ListItemButton, ListItemText, ListItemIcon, IconButton, Typography,
  Menu, MenuItem, Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions, Button,
} from '@mui/material';
import {
  PushPinIcon, TrashIcon, DotsThreeVerticalIcon, CodeIcon, NoteIcon,
} from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@mui/material/styles';
import type { NoteDto } from '../../../proto/notebook';

interface NoteListItemProps {
  note: NoteDto;
  selected?: boolean;
  onClick: (note: NoteDto) => void;
  onTogglePin?: (noteId: string) => void;
  onDelete?: (noteId: string) => void;
  showMenu?: boolean;
  groupHint?: string;
}

export function NoteListItem({ note, selected, onClick, onTogglePin, onDelete, showMenu = true, groupHint }: NoteListItemProps) {
  const { t } = useTranslation('notebook');
  const { t: tCommon } = useTranslation('common');
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const primaryColor = isDark ? '#6C63FF' : '#5B54E0';
  const mutedColor = isDark ? '#8B949E' : '#6B7280';

  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  const isCommand = note.category === 'command';
  const isSnippet = note.category === 'snippet';
  const timeStr = note.updatedAt
    ? new Date(note.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '';

  const secondaryText = groupHint || note.category || t('category.uncategorized');

  const handleMenuOpen = (e: React.MouseEvent<HTMLElement>) => {
    e.stopPropagation();
    setAnchorEl(e.currentTarget);
  };

  const handleMenuClose = () => {
    setAnchorEl(null);
  };

  const handleTogglePin = () => {
    if (onTogglePin) onTogglePin(note.id);
    handleMenuClose();
  };

  const handleDeleteClick = () => {
    setDeleteConfirmOpen(true);
    handleMenuClose();
  };

  const handleConfirmDelete = () => {
    if (onDelete) onDelete(note.id);
    setDeleteConfirmOpen(false);
  };

  return (
    <>
      <ListItemButton
        onClick={() => onClick(note)}
        selected={selected}
        sx={{
          borderRadius: 1.5,
          mx: 0.5,
          mb: 0.25,
          '&.Mui-selected': {
            bgcolor: `${primaryColor}18`,
            '&:hover': { bgcolor: `${primaryColor}25` },
          },
        }}
      >
        <ListItemIcon sx={{ minWidth: 28 }}>
          {note.isPinned ? (
            <PushPinIcon size={14} weight="fill" color={isDark ? '#FFD740' : '#FFAB00'} />
          ) : isCommand ? (
            <CodeIcon size={14} color={isDark ? '#81C784' : '#2E7D32'} />
          ) : isSnippet ? (
            <CodeIcon size={14} color={isDark ? '#4FC3F7' : '#0288D1'} />
          ) : (
            <NoteIcon size={14} color={isDark ? '#81C784' : '#2E7D32'} />
          )}
        </ListItemIcon>
        <ListItemText
          primary={note.title || t('notebook.note_title')}
          // MUI v6 把 secondaryTypographyProps 迁移到 slotProps：
          //   slotProps={{ secondary: { component: 'div' } }}
          // 避免 <Box>(div) 嵌进 <p> 的 validateDOMNesting 警告（stack: NoteListItem:44）。
          // Box 内部 Typography 都用 component="span"/"div"，整体形成合法 div > div + span 结构。
          secondary={
            <Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <Typography component="span" variant="caption" color="text.secondary" sx={{ fontSize: 10 }}>
                  {secondaryText}
                </Typography>
                {timeStr && (
                  <Typography component="span" variant="caption" color="text.secondary" sx={{ fontSize: 9, opacity: 0.7 }}>
                    · {timeStr}
                  </Typography>
                )}
              </Box>
              {note.summary && (
                <Typography
                  component="div"
                  variant="caption"
                  sx={{
                    fontSize: 10,
                    color: mutedColor,
                    lineHeight: 1.4,
                    mt: 0.25,
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                    opacity: 0.7,
                  }}
                >
                  {note.summary}
                </Typography>
              )}
            </Box>
          }
          slotProps={{
            primary: { noWrap: true, sx: { fontSize: 12, fontWeight: note.isPinned ? 600 : 400 } },
            secondary: { component: 'div' },
          }}
        />
        {showMenu && (
          <IconButton size="small" onClick={handleMenuOpen}>
            <DotsThreeVerticalIcon size={14} color={mutedColor} />
          </IconButton>
        )}
      </ListItemButton>

      {showMenu && (
        <>
          <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={handleMenuClose}>
            {onTogglePin && (
              <MenuItem onClick={handleTogglePin}>
                <PushPinIcon size={14} color={isDark ? '#FFD740' : '#FFAB00'} style={{ marginRight: 8 }} />
                {tCommon('action.pin')}
              </MenuItem>
            )}
            {onDelete && (
              <MenuItem onClick={handleDeleteClick}>
                <TrashIcon size={14} color="#FF5252" style={{ marginRight: 8 }} />
                {tCommon('action.delete')}
              </MenuItem>
            )}
          </Menu>
          <Dialog open={deleteConfirmOpen} onClose={() => setDeleteConfirmOpen(false)}>
            <DialogTitle>{t('notebook.delete_note')}</DialogTitle>
            <DialogContent>
              <DialogContentText>{t('notebook.delete_confirm_desc')}</DialogContentText>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setDeleteConfirmOpen(false)}>{tCommon('action.cancel')}</Button>
              <Button onClick={handleConfirmDelete} color="error" variant="contained">{tCommon('action.delete')}</Button>
            </DialogActions>
          </Dialog>
        </>
      )}
    </>
  );
}

interface NoteSearchBarProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export function NoteSearchBar({ value, onChange, placeholder }: NoteSearchBarProps) {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const primaryColor = isDark ? '#6C63FF' : '#5B54E0';
  const mutedColor = isDark ? '#8B949E' : '#6B7280';

  return (
    <Box sx={{ p: 1.5 }}>
      <Box
        component="input"
        value={value}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
        placeholder={placeholder || ''}
        sx={{
          width: '100%',
          px: 2,
          py: 0.75,
          borderRadius: 2,
          border: '1px solid',
          borderColor: 'divider',
          bgcolor: `${primaryColor}08`,
          outline: 'none',
          fontSize: 13,
          color: 'text.primary',
          '&:focus': { borderColor: primaryColor, bgcolor: `${primaryColor}10` },
          '&::placeholder': { color: mutedColor },
        }}
      />
    </Box>
  );
}
