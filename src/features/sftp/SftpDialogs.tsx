import { useEffect, useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { FileIcon, FolderIcon } from '@phosphor-icons/react';
import type { SftpEntry } from '../../core/services/sftp.service';

const OCTAL_MODE = /^[0-7]{3,4}$/;

/** Names that would silently target the wrong node if we passed them through. */
function invalidName(name: string): boolean {
  return name.includes('/') || name.includes('\\') || name === '.' || name === '..';
}

/** Split a file name into its base and extension (empty for directories). */
function splitName(name: string, isDir: boolean): { base: string; ext: string } {
  if (isDir) return { base: name, ext: '' };
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) return { base: name, ext: '' };
  return { base: name.slice(0, dot), ext: name.slice(dot + 1) };
}

/** Substitute batch-rename placeholders for one entry. */
function applyBatchPattern(name: string, isDir: boolean, index1: number, pattern: string): string {
  const { base, ext } = splitName(name, isDir);
  return pattern
    .split('{n}').join(String(index1))
    .split('{name}').join(name)
    .split('{base}').join(base)
    .split('{ext}').join(ext);
}

/** Split the trailing three digits of a mode into owner/group/other. */
function modeDigits(mode: string): number[] | null {
  const t = mode.trim();
  if (!OCTAL_MODE.test(t)) return null;
  return t
    .slice(-3)
    .split('')
    .map((d) => Number(d));
}

/**
 * Flip one permission bit and rebuild the octal string, keeping any leading
 * setuid/setgid/sticky digit the user typed.
 */
function toggleBit(mode: string, group: number, bit: number): string {
  const digits = modeDigits(mode);
  if (!digits) return mode;
  digits[group] ^= bit;
  const t = mode.trim();
  const prefix = t.length === 4 ? t[0] : '';
  return `${prefix}${digits.join('')}`;
}

/** Pending destructive question waiting for a human answer. */
export type ConfirmState =
  | {
      kind: 'overwrite';
      paths: string[];
      /**
       * Same-name items already in the destination. Folders are flagged
       * because they behave differently: a folder is *merged into* (existing
       * children survive), while a file is replaced outright.
       */
      conflicts: { name: string; isDir: boolean }[];
      dir: string;
      /** Per-item remote names for the "keep both" action (numbered suffixes). */
      keepBothNames: string[];
    }
  | { kind: 'delete'; names: string[] }
  | null;

interface SftpDialogsProps {
  isDark: boolean;
  busy: boolean;

  renaming: SftpEntry | null;
  renameValue: string;
  newFolderOpen: boolean;
  newFolderName: string;
  confirm: ConfirmState;
  chmodTargets: SftpEntry[] | null;
  chmodValue: string;
  batchRename: SftpEntry[] | null;
  /** All entry names currently in the directory, for collision checks. */
  existingNames: string[];

  /** Every string arrives already translated and interpolated. */
  labels: {
    cancel: string;
    ok: string;
    delete: string;
    renameTitle: string;
    newFolderTitle: string;
    folderName: string;
    overwriteTitle: string;
    overwriteDesc: string;
    overwriteMergeHint: string;
    overwrite: string;
    overwriteKeepBoth: string;
    overwriteKeepBothHint: string;
    overwriteSkip: string;
    deleteMessage: string;
    permsTitle: string;
    permsMode: string;
    permsSubject: string;
    permsOwner: string;
    permsGroup: string;
    permsOther: string;
    permsRead: string;
    permsWrite: string;
    permsExec: string;
    permsHint: string;
    permsInvalid: string;
    apply: string;
    batchRenameTitle: string;
    batchRenameSubject: string;
    batchRenameDesc: string;
    batchRenamePattern: string;
    batchRenameHint: string;
    batchRenamePreview: string;
    batchRenameMore: (count: number) => string;
    batchRenameApply: string;
    batchRenameEmpty: string;
    batchRenameDuplicate: string;
    batchRenameInvalid: (name: string) => string;
    batchRenameConflict: (name: string) => string;
  };

  onRenameChange: (v: string) => void;
  onRenameCancel: () => void;
  onRenameSubmit: () => void;
  onFolderChange: (v: string) => void;
  onFolderCancel: () => void;
  onFolderSubmit: () => void;
  onConfirmCancel: () => void;
  onOverwriteAll: () => void;
  onOverwriteSkip: () => void;
  onOverwriteKeepBoth: () => void;
  onDeleteConfirm: () => void;
  onChmodChange: (v: string) => void;
  onChmodCancel: () => void;
  onChmodSubmit: () => void;
  onBatchRenameCancel: () => void;
  onBatchRenameSubmit: (names: string[]) => void;
}

/**
 * All four modal questions in one place so the manager keeps its focus on
 * navigation and transfers.
 */
export function SftpDialogs({
  isDark,
  busy,
  renaming,
  renameValue,
  newFolderOpen,
  newFolderName,
  confirm,
  chmodTargets,
  chmodValue,
  batchRename,
  existingNames,
  labels,
  onRenameChange,
  onRenameCancel,
  onRenameSubmit,
  onFolderChange,
  onFolderCancel,
  onFolderSubmit,
  onConfirmCancel,
  onOverwriteAll,
  onOverwriteSkip,
  onOverwriteKeepBoth,
  onDeleteConfirm,
  onChmodChange,
  onChmodCancel,
  onChmodSubmit,
  onBatchRenameCancel,
  onBatchRenameSubmit,
}: SftpDialogsProps) {
  const listBg = isDark ? 'rgba(110,118,129,0.14)' : 'rgba(27,31,36,0.05)';
  const listText = isDark ? '#C9D1D9' : '#24292F';
  const subtle = isDark ? '#8B949E' : '#6E7781';

  // ---- batch rename preview ------------------------------------------------
  const [pattern, setPattern] = useState('{name}');
  useEffect(() => {
    if (batchRename) setPattern('{name}');
  }, [batchRename]);

  const batchPlan = useMemo(() => {
    if (!batchRename || batchRename.length === 0) return null;
    const results = batchRename.map((e, i) => ({
      old: e.name,
      neu: applyBatchPattern(e.name, e.is_dir, i + 1, pattern),
    }));
    for (const r of results) {
      if (!r.neu.trim()) return { results, error: labels.batchRenameEmpty, canApply: false };
      if (invalidName(r.neu)) return { results, error: labels.batchRenameInvalid(r.neu), canApply: false };
    }
    const counts = new Map<string, number>();
    for (const r of results) counts.set(r.neu, (counts.get(r.neu) ?? 0) + 1);
    if ([...counts.values()].some((c) => c > 1)) {
      return { results, error: labels.batchRenameDuplicate, canApply: false };
    }
    const others = new Set(existingNames.filter((n) => !batchRename.some((e) => e.name === n)));
    for (const r of results) {
      if (r.neu !== r.old && others.has(r.neu)) {
        return { results, error: labels.batchRenameConflict(r.neu), canApply: false };
      }
    }
    const anyChange = results.some((r) => r.neu !== r.old);
    return { results, error: null, canApply: anyChange };
  }, [batchRename, pattern, existingNames, labels]);

  const digits = modeDigits(chmodValue);
  const groupLabels = [labels.permsOwner, labels.permsGroup, labels.permsOther];
  const bitLabels: Array<{ bit: number; label: string }> = [
    { bit: 4, label: labels.permsRead },
    { bit: 2, label: labels.permsWrite },
    { bit: 1, label: labels.permsExec },
  ];

  return (
    <>
      <Dialog open={!!renaming} onClose={onRenameCancel} fullWidth maxWidth="xs">
        <DialogTitle sx={{ pb: 1 }}>{labels.renameTitle}</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            size="small"
            value={renameValue}
            onChange={(e) => onRenameChange(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') onRenameSubmit();
            }}
            slotProps={{ htmlInput: { spellCheck: false } }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={onRenameCancel}>{labels.cancel}</Button>
          <Button variant="contained" onClick={onRenameSubmit} disabled={busy || !renameValue.trim()}>
            {labels.ok}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={newFolderOpen} onClose={onFolderCancel} fullWidth maxWidth="xs">
        <DialogTitle sx={{ pb: 1 }}>{labels.newFolderTitle}</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            size="small"
            label={labels.folderName}
            value={newFolderName}
            onChange={(e) => onFolderChange(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') onFolderSubmit();
            }}
            slotProps={{ htmlInput: { spellCheck: false } }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={onFolderCancel}>{labels.cancel}</Button>
          <Button variant="contained" onClick={onFolderSubmit} disabled={busy || !newFolderName.trim()}>
            {labels.ok}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={confirm?.kind === 'overwrite'} onClose={onConfirmCancel} fullWidth maxWidth="xs">
        <DialogTitle sx={{ pb: 1 }}>{labels.overwriteTitle}</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ whiteSpace: 'pre-line', fontSize: 14 }}>
            {labels.overwriteDesc}
          </DialogContentText>
          <Box
            sx={{
              mt: 1.25,
              maxHeight: 168,
              overflow: 'auto',
              bgcolor: listBg,
              borderRadius: 1,
              px: 1,
              py: 0.75,
            }}
          >
            {confirm?.kind === 'overwrite' &&
              confirm.conflicts.map((c) => (
                <Box
                  key={c.name}
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 0.75,
                    fontSize: 12.5,
                    py: 0.15,
                    color: listText,
                  }}
                >
                  {c.isDir ? (
                    <FolderIcon size={13} color={subtle} weight="fill" />
                  ) : (
                    <FileIcon size={13} color={subtle} />
                  )}
                  <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {c.name}
                  </Box>
                </Box>
              ))}
          </Box>
          {confirm?.kind === 'overwrite' && confirm.conflicts.some((c) => c.isDir) && (
            <DialogContentText sx={{ mt: 1.25, fontSize: 12.5, color: subtle }}>
              {labels.overwriteMergeHint}
            </DialogContentText>
          )}
          {confirm?.kind === 'overwrite' && (
            <DialogContentText sx={{ mt: 1.25, fontSize: 12.5, color: subtle }}>
              {labels.overwriteKeepBothHint}
            </DialogContentText>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={onConfirmCancel}>{labels.cancel}</Button>
          <Button onClick={onOverwriteSkip}>{labels.overwriteSkip}</Button>
          <Button onClick={onOverwriteKeepBoth}>{labels.overwriteKeepBoth}</Button>
          <Button variant="contained" color="warning" onClick={onOverwriteAll}>
            {labels.overwrite}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!chmodTargets} onClose={onChmodCancel} fullWidth maxWidth="xs">
        <DialogTitle sx={{ pb: 0.5 }}>{labels.permsTitle}</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 12.5, color: subtle, mb: 1.5 }}>
            {labels.permsSubject}
          </Typography>

          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: '72px repeat(3, 1fr)',
              alignItems: 'center',
              rowGap: 0.25,
              bgcolor: listBg,
              borderRadius: 1,
              px: 1,
              py: 0.75,
            }}
          >
            <Box />
            {bitLabels.map((b) => (
              <Box key={b.bit} sx={{ fontSize: 11.5, color: subtle, textAlign: 'center' }}>
                {b.label}
              </Box>
            ))}
            {groupLabels.map((g, gi) => (
              <Box key={g} sx={{ display: 'contents' }}>
                <Box sx={{ fontSize: 12.5, color: listText }}>{g}</Box>
                {bitLabels.map((b) => (
                  <Box key={b.bit} sx={{ textAlign: 'center' }}>
                    <Checkbox
                      size="small"
                      disabled={!digits}
                      checked={!!digits && (digits[gi] & b.bit) !== 0}
                      onChange={() => onChmodChange(toggleBit(chmodValue, gi, b.bit))}
                      sx={{ p: 0.5 }}
                    />
                  </Box>
                ))}
              </Box>
            ))}
          </Box>

          <TextField
            fullWidth
            size="small"
            sx={{ mt: 1.75 }}
            label={labels.permsMode}
            value={chmodValue}
            error={!digits}
            helperText={digits ? labels.permsHint : labels.permsInvalid}
            onChange={(e) => onChmodChange(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter' && digits) onChmodSubmit();
            }}
            slotProps={{
              htmlInput: {
                spellCheck: false,
                maxLength: 4,
                inputMode: 'numeric',
                style: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
              },
            }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={onChmodCancel}>{labels.cancel}</Button>
          <Button variant="contained" onClick={onChmodSubmit} disabled={busy || !digits}>
            {labels.apply}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={confirm?.kind === 'delete'} onClose={onConfirmCancel} fullWidth maxWidth="xs">
        <DialogTitle sx={{ pb: 1 }}>{labels.delete}</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ fontSize: 14 }}>{labels.deleteMessage}</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={onConfirmCancel}>{labels.cancel}</Button>
          <Button variant="contained" color="error" onClick={onDeleteConfirm} disabled={busy}>
            {labels.delete}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!batchRename} onClose={onBatchRenameCancel} fullWidth maxWidth="sm">
        <DialogTitle sx={{ pb: 0.5 }}>{labels.batchRenameTitle}</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 12.5, color: subtle, mb: 1 }}>
            {labels.batchRenameSubject}
          </Typography>
          <TextField
            autoFocus
            fullWidth
            size="small"
            label={labels.batchRenamePattern}
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter' && batchPlan?.canApply) {
                onBatchRenameSubmit(batchPlan.results.map((r) => r.neu));
              }
            }}
            error={!!pattern && !!batchPlan?.error}
            helperText={batchPlan?.error ?? (pattern ? '' : labels.batchRenameDesc)}
            slotProps={{ htmlInput: { spellCheck: false } }}
          />
          <Typography sx={{ fontSize: 11.5, color: subtle, mt: 0.5 }}>
            {labels.batchRenameHint}
          </Typography>

          <Box
            sx={{
              mt: 1.25,
              maxHeight: 200,
              overflow: 'auto',
              bgcolor: listBg,
              borderRadius: 1,
              px: 1,
              py: 0.75,
            }}
          >
            {batchPlan &&
              batchPlan.results.slice(0, 10).map((r, i) => (
                <Box
                  key={i}
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 0.75,
                    fontSize: 12.5,
                    py: 0.15,
                    color: r.neu === r.old ? subtle : listText,
                  }}
                >
                  <FileIcon size={13} color={subtle} />
                  <Box
                    component="span"
                    sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}
                  >
                    {r.old}
                  </Box>
                  <Box component="span" sx={{ color: subtle, px: 0.5 }}>
                    →
                  </Box>
                  <Box
                    component="span"
                    sx={{
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      flex: 1,
                      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                    }}
                  >
                    {r.neu}
                  </Box>
                </Box>
              ))}
            {batchPlan && batchPlan.results.length > 10 && (
              <Box sx={{ fontSize: 12, color: subtle, pt: 0.5 }}>
                {labels.batchRenameMore(batchPlan.results.length - 10)}
              </Box>
            )}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={onBatchRenameCancel}>{labels.cancel}</Button>
          <Button
            variant="contained"
            onClick={() => batchPlan && onBatchRenameSubmit(batchPlan.results.map((r) => r.neu))}
            disabled={busy || !batchPlan?.canApply}
          >
            {labels.batchRenameApply}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
