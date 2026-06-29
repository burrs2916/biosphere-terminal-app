import { useState, useCallback, useEffect, useRef } from 'react';
import Box from '@mui/material/Box';
import TextField from '@mui/material/TextField';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import InputAdornment from '@mui/material/InputAdornment';
import {
  MagnifyingGlassIcon,
  ArrowUpIcon,
  ArrowDownIcon,
  XIcon,
} from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';

interface FindBarProps {
  open: boolean;
  onClose: () => void;
  onFindNext: (query: string, options?: { regex?: boolean; wholeWord?: boolean; caseSensitive?: boolean }) => void;
  onFindPrevious: (query: string, options?: { regex?: boolean; wholeWord?: boolean; caseSensitive?: boolean }) => void;
  resultInfo: { resultIndex: number; resultCount: number } | null;
}

export function FindBar({ open, onClose, onFindNext, onFindPrevious, resultInfo }: FindBarProps) {
  const { t } = useTranslation('terminal');
  const [query, setQuery] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      setQuery('');
    }
  }, [open]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (e.shiftKey) {
          onFindPrevious(query, { caseSensitive });
        } else {
          onFindNext(query, { caseSensitive });
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    },
    [query, caseSensitive, onFindNext, onFindPrevious, onClose],
  );

  if (!open) return null;

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        px: 1.5,
        py: 0.5,
        borderBottom: '1px solid',
        borderColor: 'divider',
        bgcolor: 'background.paper',
      }}
    >
      <MagnifyingGlassIcon size={16} color="#8B949E" />
      <TextField
        inputRef={inputRef}
        size="small"
        placeholder={t('find_placeholder', { defaultValue: 'Find' })}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          if (e.target.value) onFindNext(e.target.value, { caseSensitive });
        }}
        onKeyDown={handleKeyDown}
        variant="standard"
        sx={{ flex: 1, '& .MuiInput-root': { fontSize: '0.85rem' } }}
        slotProps={{
          input: {
            endAdornment: resultInfo && query ? (
              <InputAdornment position="end">
                <Typography variant="caption" color="text.secondary">
                  {resultInfo.resultCount > 0
                    ? `${resultInfo.resultIndex + 1}/${resultInfo.resultCount}`
                    : '0/0'}
                </Typography>
              </InputAdornment>
            ) : null,
          },
        }}
      />
      <IconButton
        size="small"
        onClick={() => setCaseSensitive((prev) => !prev)}
        sx={{
          px: 0.5,
          py: 0.25,
          fontSize: '0.7rem',
          fontWeight: 700,
          bgcolor: caseSensitive ? 'rgba(108,99,255,0.12)' : 'transparent',
          '&:hover': { bgcolor: caseSensitive ? 'rgba(108,99,255,0.18)' : 'rgba(0,0,0,0.04)' },
        }}
        title={t('find_case_sensitive', { defaultValue: 'Case sensitive' })}
      >
        Aa
      </IconButton>
      <IconButton size="small" onClick={() => onFindPrevious(query, { caseSensitive })} disabled={!query}>
        <ArrowUpIcon size={16} />
      </IconButton>
      <IconButton size="small" onClick={() => onFindNext(query, { caseSensitive })} disabled={!query}>
        <ArrowDownIcon size={16} />
      </IconButton>
      <IconButton size="small" onClick={onClose}>
        <XIcon size={16} />
      </IconButton>
    </Box>
  );
}
