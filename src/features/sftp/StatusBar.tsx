import Box from '@mui/material/Box';
import Tooltip from '@mui/material/Tooltip';
import { EyeSlashIcon, PlugsConnectedIcon } from '@phosphor-icons/react';

interface StatusBarProps {
  isDark: boolean;
  hidden: number;
  selectedCount: number;
  /** Pre-formatted total byte size of the selection, empty when irrelevant. */
  selectedSize: string;
  /** user@host:port — the whole point of a transfer window is knowing where you are. */
  target: string;
  /** True when a search box or the hidden filter is holding rows back. */
  filtered: boolean;
  /** Already interpolated by the caller so this component stays i18n-free. */
  labels: {
    items: string;
    hidden: string;
    selected: string;
    filtered: string;
  };
}

/**
 * A single quiet line answering "what am I looking at, and what did I select".
 * Without it the hidden-file filter silently eats rows and the listing looks
 * broken.
 */
export function StatusBar({
  isDark,
  hidden,
  selectedCount,
  selectedSize,
  target,
  filtered,
  labels,
}: StatusBarProps) {
  const border = isDark ? 'rgba(240,246,252,0.10)' : 'rgba(27,31,36,0.12)';
  const bg = isDark ? 'rgba(110,118,129,0.06)' : 'rgba(175,184,193,0.10)';
  const subtle = isDark ? '#8B949E' : '#57606A';
  const strong = isDark ? '#C9D1D9' : '#24292F';

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1.25,
        px: 1.5,
        height: 26,
        flexShrink: 0,
        borderTop: `1px solid ${border}`,
        bgcolor: bg,
        fontSize: 11.5,
        color: subtle,
        userSelect: 'none',
        overflow: 'hidden',
        whiteSpace: 'nowrap',
      }}
    >
      <Box sx={{ fontVariantNumeric: 'tabular-nums' }}>
        {filtered ? labels.filtered : labels.items}
      </Box>

      {hidden > 0 && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.4, fontVariantNumeric: 'tabular-nums' }}>
          <EyeSlashIcon size={12} />
          {labels.hidden}
        </Box>
      )}

      {selectedCount > 0 && (
        <Box sx={{ color: strong, fontVariantNumeric: 'tabular-nums' }}>
          {selectedSize ? `${labels.selected} · ${selectedSize}` : labels.selected}
        </Box>
      )}

      <Box sx={{ flex: 1, minWidth: 8 }} />

      <Tooltip title={target} enterDelay={400}>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 0.4,
            maxWidth: '46%',
            overflow: 'hidden',
          }}
        >
          <PlugsConnectedIcon size={12} />
          <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {target}
          </Box>
        </Box>
      </Tooltip>
    </Box>
  );
}
