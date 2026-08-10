import { useEffect, useRef } from 'react';
import Box from '@mui/material/Box';
import Breadcrumbs from '@mui/material/Breadcrumbs';
import IconButton from '@mui/material/IconButton';
import InputBase from '@mui/material/InputBase';
import Link from '@mui/material/Link';
import Tooltip from '@mui/material/Tooltip';
import { HouseIcon, PencilSimpleIcon } from '@phosphor-icons/react';
import { pathSegments } from './utils';

interface PathBarProps {
  path: string;
  isDark: boolean;
  editing: boolean;
  draft: string;
  labels: {
    home: string;
    root: string;
    edit: string;
    placeholder: string;
  };
  onNavigate: (target: string) => void;
  onDraftChange: (v: string) => void;
  onBeginEdit: () => void;
  onCancelEdit: () => void;
  onCommitEdit: () => void;
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
  labels,
  onNavigate,
  onDraftChange,
  onBeginEdit,
  onCancelEdit,
  onCommitEdit,
}: PathBarProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
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
        </>
      )}
    </Box>
  );
}
