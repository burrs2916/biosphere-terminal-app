import { useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Breadcrumbs from '@mui/material/Breadcrumbs';
import IconButton from '@mui/material/IconButton';
import InputBase from '@mui/material/InputBase';
import Link from '@mui/material/Link';
import ListItemText from '@mui/material/ListItemText';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Tooltip from '@mui/material/Tooltip';
import {
  BookmarkSimpleIcon,
  HouseIcon,
  PencilSimpleIcon,
  StarIcon,
  TrashIcon,
} from '@phosphor-icons/react';
import { pathSegments } from './utils';

interface PathBarProps {
  path: string;
  isDark: boolean;
  editing: boolean;
  draft: string;
  /** Pinned directories for the current connection, most navigation-ready. */
  favorites: string[];
  isFavorite: boolean;
  labels: {
    home: string;
    root: string;
    edit: string;
    placeholder: string;
    addFavorite: string;
    removeFavorite: string;
    favorites: string;
  };
  onNavigate: (target: string) => void;
  onDraftChange: (v: string) => void;
  onBeginEdit: () => void;
  onCancelEdit: () => void;
  onCommitEdit: () => void;
  onToggleFavorite: () => void;
  onRemoveFavorite: (path: string) => void;
}

/**
 * Clickable crumbs with a typeable fallback.
 *
 * Two details matter for real-world hosts:
 * - "home" and "/" are different places. The old bar labelled the `.` crumb
 *   "root", which sent people to their home directory when they wanted `/`.
 * - Win32-OpenSSH reports paths as `/C:/Users/foo`, so the first segment is a
 *   drive letter rather than a directory — the plain split handles both.
 */
export function PathBar({
  path,
  isDark,
  editing,
  draft,
  favorites,
  isFavorite,
  labels,
  onNavigate,
  onDraftChange,
  onBeginEdit,
  onCancelEdit,
  onCommitEdit,
  onToggleFavorite,
  onRemoveFavorite,
}: PathBarProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [favAnchor, setFavAnchor] = useState<HTMLElement | null>(null);
  const border = isDark ? 'rgba(240,246,252,0.12)' : 'rgba(27,31,36,0.12)';
  const text = isDark ? '#C9D1D9' : '#24292F';
  const subtle = isDark ? '#8B949E' : '#57606A';

  useEffect(() => {
    if (editing) {
      const el = inputRef.current;
      el?.focus();
      el?.select();
    }
  }, [editing]);

  const segs = pathSegments(path);
  const absolute = path.startsWith('/');

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 0.5,
        px: 1.25,
        minHeight: 32,
        borderBottom: `1px solid ${border}`,
      }}
    >
      {editing ? (
        <>
          <InputBase
            inputRef={inputRef}
            value={draft}
            placeholder={labels.placeholder}
            onChange={(e) => onDraftChange(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') onCommitEdit();
              else if (e.key === 'Escape') onCancelEdit();
            }}
            onBlur={onCancelEdit}
            spellCheck={false}
            sx={{
              flex: 1,
              fontSize: 13,
              color: text,
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              px: 0.75,
              py: 0.25,
              borderRadius: 1,
              bgcolor: isDark ? 'rgba(110,118,129,0.16)' : 'rgba(27,31,36,0.06)',
            }}
          />
        </>
      ) : (
        <>
          <Tooltip title={labels.home}>
            <IconButton
              size="small"
              onClick={() => onNavigate('.')}
              sx={{ width: 22, height: 22 }}
            >
              <HouseIcon size={14} color={subtle} />
            </IconButton>
          </Tooltip>

          <Breadcrumbs
            separator="/"
            maxItems={6}
            itemsBeforeCollapse={1}
            itemsAfterCollapse={3}
            sx={{
              fontSize: 13,
              flexShrink: 1,
              minWidth: 0,
              '& .MuiBreadcrumbs-separator': { mx: 0.4, color: subtle },
              '& .MuiBreadcrumbs-ol': { flexWrap: 'nowrap', overflow: 'hidden' },
              '& .MuiBreadcrumbs-li': { minWidth: 0 },
            }}
          >
            {absolute && (
              <Link
                key="__root"
                component="button"
                underline="hover"
                color="inherit"
                title={labels.root}
                sx={{ cursor: 'pointer', fontSize: 13, color: subtle }}
                onClick={() => onNavigate('/')}
              >
                /
              </Link>
            )}
            {segs.map((seg, idx) => (
              <Link
                key={seg.path}
                component="button"
                underline="hover"
                color="inherit"
                sx={{
                  cursor: 'pointer',
                  fontSize: 13,
                  maxWidth: 220,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  color: idx === segs.length - 1 ? text : subtle,
                  fontWeight: idx === segs.length - 1 ? 600 : 400,
                }}
                onClick={() => onNavigate(seg.path)}
              >
                {seg.label}
              </Link>
            ))}
          </Breadcrumbs>

          {/* Clicking the empty stretch is the fastest way into edit mode. */}
          <Box
            onClick={onBeginEdit}
            sx={{ flex: 1, alignSelf: 'stretch', cursor: 'text', minWidth: 12 }}
          />

          <Tooltip title={labels.edit}>
            <IconButton size="small" onClick={onBeginEdit} sx={{ width: 22, height: 22 }}>
              <PencilSimpleIcon size={13} color={subtle} />
            </IconButton>
          </Tooltip>

          {/* Pin / unpin the directory on screen. */}
          <Tooltip title={isFavorite ? labels.removeFavorite : labels.addFavorite}>
            <IconButton size="small" onClick={onToggleFavorite} sx={{ width: 22, height: 22 }}>
              <StarIcon
                size={13}
                color={isFavorite ? '#e3b341' : subtle}
                weight={isFavorite ? 'fill' : 'regular'}
              />
            </IconButton>
          </Tooltip>

          {favorites.length > 0 && (
            <Tooltip title={labels.favorites}>
              <IconButton
                size="small"
                onClick={(e) => setFavAnchor(e.currentTarget)}
                sx={{ width: 22, height: 22 }}
              >
                <BookmarkSimpleIcon size={13} color={subtle} />
              </IconButton>
            </Tooltip>
          )}
        </>
      )}

      <Menu
        open={!!favAnchor}
        onClose={() => setFavAnchor(null)}
        anchorEl={favAnchor}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        {favorites.map((fav) => (
          <MenuItem
            key={fav}
            dense
            onClick={() => {
              setFavAnchor(null);
              onNavigate(fav);
            }}
          >
            <ListItemText
              slotProps={{
                primary: {
                  sx: {
                    fontSize: 12.5,
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                    maxWidth: 300,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  },
                },
              }}
            >
              {fav}
            </ListItemText>
            <IconButton
              size="small"
              sx={{ width: 20, height: 20, ml: 1 }}
              onClick={(e) => {
                e.stopPropagation();
                onRemoveFavorite(fav);
              }}
            >
              <TrashIcon size={12} color={subtle} />
            </IconButton>
          </MenuItem>
        ))}
      </Menu>
    </Box>
  );
}
