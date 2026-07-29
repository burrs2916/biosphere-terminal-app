import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button,
  Typography, FormControl, InputLabel, Select, MenuItem,
  FormControlLabel, Checkbox,
} from '@mui/material';
import { TrashIcon, XIcon, WarningIcon } from '@phosphor-icons/react';
import { useNotebookStore } from '../store/notebookStore';
import type { NoteGroupDto } from '../../../proto/notebook';

interface DeleteGroupDialogProps {
  open: boolean;
  group: NoteGroupDto | null;
  onClose: () => void;
  onConfirm: (targetGroupId: string | null, deleteNotes: boolean) => void;
}

export function DeleteGroupDialog({ open, group, onClose, onConfirm }: DeleteGroupDialogProps) {
  const { t } = useTranslation('notebook');
  const { t: tCommon } = useTranslation('common');
  const groups = useNotebookStore((s) => s.groups) || [];
  const [targetGroupId, setTargetGroupId] = useState('');
  const [deleteNotes, setDeleteNotes] = useState(false);

  useEffect(() => {
    if (open) {
      setTargetGroupId('');
      setDeleteNotes(false);
    }
  }, [open, group]);

  if (!group) return null;

  const isProtected = group.id === 'uncategorized';
  const otherGroups = groups.filter((g) => g.id !== group.id);
  const hasNotes = (group.noteCount ?? 0) > 0;
  const canConfirm = !isProtected && (!hasNotes || deleteNotes || !!targetGroupId);

  const handleConfirm = () => {
    if (isProtected) return;
    onConfirm(deleteNotes ? null : targetGroupId || null, deleteNotes);
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, fontSize: 15, fontWeight: 600 }}>
        <WarningIcon size={20} color="#FF8A80" />
        {t('group.delete_confirm')}
      </DialogTitle>
      <DialogContent>
        {isProtected ? (
          <Typography variant="body2" color="text.secondary">
            {t('group.delete_protected')}
          </Typography>
        ) : (
          <>
        <Typography variant="body2" color="text.secondary" sx={{ mb: hasNotes ? 2 : 0 }}>
          {t('group.delete_confirm_desc', { name: group.name })}
        </Typography>

        {hasNotes && !deleteNotes && (
          <FormControl fullWidth size="small" sx={{ mb: 1 }}>
            <InputLabel id="target-group-label">{t('group.move_to')}</InputLabel>
            <Select
              labelId="target-group-label"
              label={t('group.move_to')}
              value={targetGroupId}
              onChange={(e) => setTargetGroupId(e.target.value)}
            >
              {otherGroups.length === 0 ? (
                <MenuItem value="" disabled>
                  {t('group.no_other_group')}
                </MenuItem>
              ) : (
                otherGroups.map((g) => (
                  <MenuItem key={g.id} value={g.id}>
                    {g.name}
                  </MenuItem>
                ))
              )}
            </Select>
          </FormControl>
        )}

        {hasNotes && (
          <FormControlLabel
            control={
              <Checkbox
                checked={deleteNotes}
                onChange={(e) => setDeleteNotes(e.target.checked)}
                color="error"
              />
            }
            label={<Typography variant="body2" color="text.secondary">{t('group.delete_with_notes')}</Typography>}
          />
        )}
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} startIcon={<XIcon size={14} />}>
          {tCommon('action.cancel')}
        </Button>
        <Button
          onClick={handleConfirm}
          color="error"
          variant="contained"
          disabled={!canConfirm}
          startIcon={<TrashIcon size={14} />}
          sx={{ bgcolor: '#FF5252', '&:hover': { bgcolor: '#D32F2F' } }}
        >
          {deleteNotes ? t('group.delete_with_notes_btn') : t('group.move_and_delete')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
