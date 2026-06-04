import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import List from '@mui/material/List';
import Snackbar from '@mui/material/Snackbar';
import Alert from '@mui/material/Alert';
import Collapse from '@mui/material/Collapse';
import Chip from '@mui/material/Chip';
import Tooltip from '@mui/material/Tooltip';
import { PlusIcon, TrashIcon, PencilSimpleIcon, CheckIcon, XIcon, CaretDownIcon, CaretRightIcon, TagIcon, WarningIcon } from '@phosphor-icons/react';
import { useNotebookStore } from '../store/notebookStore';
import { IconPicker } from './IconPicker';
import { IconRenderer } from './IconRenderer';
import type { NoteGroupDto, NoteCategoryDto } from '../../../proto/notebook';

interface GroupManageDialogProps {
  open: boolean;
  onClose: () => void;
}

const PRESET_COLORS = [
  '#6C63FF', '#4FC3F7', '#81C784', '#FFD740', '#FF8A80',
  '#CE93D8', '#4DD0E1', '#FFB74D', '#AED581', '#F06292',
  '#7986CB', '#4DB6AC', '#FF8A65', '#A1887F', '#90A4AE',
];

export function GroupManageDialog({ open, onClose }: GroupManageDialogProps) {
  const { t } = useTranslation('notebook');
  const { t: tCommon } = useTranslation('common');

  const {
    groups, createGroup, updateGroup, deleteGroup, loadGroups,
    categories, loadCategoriesByGroup, createCategory, updateCategory, deleteCategory,
  } = useNotebookStore();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [formName, setFormName] = useState('');
  const [formIcon, setFormIcon] = useState('📁');
  const [formColor, setFormColor] = useState('#6C63FF');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [expandedGroupId, setExpandedGroupId] = useState<string | null>(null);
  const [newCatName, setNewCatName] = useState('');
  const [addingCatForGroup, setAddingCatForGroup] = useState<string | null>(null);
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [editingCatName, setEditingCatName] = useState('');
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [categoryToDelete, setCategoryToDelete] = useState<NoteCategoryDto | null>(null);

  useEffect(() => {
    if (open) loadGroups();
  }, [open, loadGroups]);

  const resetForm = () => {
    setFormName('');
    setFormIcon('📁');
    setFormColor('#6C63FF');
    setEditingId(null);
    setShowCreate(false);
  };

  const handleCreate = async () => {
    if (!formName.trim() || submitting) return;
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const result = await createGroup({
        name: formName.trim(),
        icon: formIcon,
        color: formColor,
        sortOrder: groups.length,
      });
      if (result) {
        resetForm();
        await loadGroups();
      } else {
        const err = useNotebookStore.getState().error;
        setErrorMsg(err || t('group.create') + ' failed');
      }
    } catch (e) {
      setErrorMsg(String(e));
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdate = async () => {
    if (!editingId || !formName.trim() || submitting) return;
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const existing = groups.find((g) => g.id === editingId);
      const result = await updateGroup({
        id: editingId,
        name: formName.trim(),
        icon: formIcon,
        color: formColor,
        sortOrder: existing?.sortOrder ?? 0,
      });
      if (result) {
        resetForm();
        await loadGroups();
      } else {
        const err = useNotebookStore.getState().error;
        setErrorMsg(err || t('group.edit') + ' failed');
      }
    } catch (e) {
      setErrorMsg(String(e));
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    setErrorMsg(null);
    try {
      await deleteGroup(id);
      if (editingId === id) resetForm();
      if (expandedGroupId === id) setExpandedGroupId(null);
      await loadGroups();
    } catch (e) {
      setErrorMsg(String(e));
    }
  };

  const startEdit = (group: NoteGroupDto) => {
    setEditingId(group.id);
    setShowCreate(false);
    setFormName(group.name);
    setFormIcon(group.icon);
    setFormColor(group.color);
  };

  const startCreate = () => {
    setShowCreate(true);
    setEditingId(null);
    setFormName('');
    setFormIcon('📁');
    setFormColor('#6C63FF');
  };

  const toggleExpand = (groupId: string) => {
    if (expandedGroupId === groupId) {
      setExpandedGroupId(null);
    } else {
      setExpandedGroupId(groupId);
      loadCategoriesByGroup(groupId);
    }
  };

  const handleAddCategory = async (groupId: string) => {
    if (!newCatName.trim()) return;
    setErrorMsg(null);
    try {
      await createCategory({ name: newCatName.trim(), groupId, sortOrder: categories.length });
      setNewCatName('');
      setAddingCatForGroup(null);
      await loadCategoriesByGroup(groupId);
    } catch (e) {
      setErrorMsg(String(e));
    }
  };

  const handleDeleteCategory = async (cat: NoteCategoryDto) => {
    setErrorMsg(null);
    try {
      await deleteCategory(cat.id);
      await loadCategoriesByGroup(cat.groupId);
      setSuccessMsg(t('category.delete_success') || 'Category deleted');
    } catch (e) {
      setErrorMsg(String(e));
    }
  };

  const confirmDeleteCategory = (cat: NoteCategoryDto) => {
    setCategoryToDelete(cat);
    setDeleteConfirmOpen(true);
  };

  const executeDeleteCategory = async () => {
    if (!categoryToDelete) return;
    setDeleteConfirmOpen(false);
    await handleDeleteCategory(categoryToDelete);
    setCategoryToDelete(null);
  };

  const cancelDeleteCategory = () => {
    setDeleteConfirmOpen(false);
    setCategoryToDelete(null);
  };

  const startEditCategory = (cat: NoteCategoryDto) => {
    setEditingCategoryId(cat.id);
    setEditingCatName(cat.name);
    setAddingCatForGroup(null);
  };

  const cancelEditCategory = () => {
    setEditingCategoryId(null);
    setEditingCatName('');
  };

  const handleUpdateCategory = async (cat: NoteCategoryDto) => {
    if (!editingCatName.trim()) return;
    setErrorMsg(null);
    try {
      await updateCategory({ id: cat.id, name: editingCatName.trim(), sortOrder: cat.sortOrder });
      setEditingCategoryId(null);
      setEditingCatName('');
      setSuccessMsg(t('category.update_success') || 'Category updated');
      await loadCategoriesByGroup(cat.groupId);
    } catch (e) {
      setErrorMsg(String(e));
    }
  };

  const isFormVisible = showCreate || editingId;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Typography variant="subtitle1" component="span" sx={{ fontWeight: 600 }}>
          {t('group.manage')}
        </Typography>
        <IconButton size="small" onClick={startCreate} sx={{ color: '#6C63FF' }}>
          <PlusIcon size={18} />
        </IconButton>
      </DialogTitle>

      <DialogContent sx={{ minHeight: 300 }}>
        {isFormVisible && (
          <Box sx={{ mb: 2, p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 2, bgcolor: 'rgba(108,99,255,0.04)' }}>
            <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block', fontWeight: 600 }}>
              {editingId ? t('group.edit') : t('group.create')}
            </Typography>

            <Box sx={{ display: 'flex', gap: 1, mb: 1.5 }}>
              <IconRenderer
                value={formIcon}
                size={20}
                sx={{
                  width: 40,
                  height: 40,
                  borderRadius: 2,
                  border: '2px solid',
                  borderColor: formColor,
                  bgcolor: `${formColor}18`,
                  cursor: 'pointer',
                  flexShrink: 0,
                }}
              />
              <TextField
                size="small"
                label={t('group.name')}
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                fullWidth
                sx={{ '& .MuiOutlinedInput-root': { borderRadius: 2 } }}
              />
            </Box>

            <Box sx={{ mb: 1.5 }}>
              <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
                {t('group.color')}
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                {PRESET_COLORS.map((color) => (
                  <Box
                    key={color}
                    onClick={() => setFormColor(color)}
                    sx={{
                      width: 24,
                      height: 24,
                      borderRadius: '50%',
                      bgcolor: color,
                      cursor: 'pointer',
                      border: formColor === color ? '2px solid white' : '2px solid transparent',
                      boxShadow: formColor === color ? `0 0 0 2px ${color}` : 'none',
                      transition: 'all 0.15s',
                      '&:hover': { transform: 'scale(1.15)' },
                    }}
                  />
                ))}
              </Box>
            </Box>

            <Box sx={{ mb: 1.5 }}>
              <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
                {t('group.icon')}
              </Typography>
              <IconPicker value={formIcon} onChange={setFormIcon} />
            </Box>

            <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
              <Button size="small" onClick={resetForm} startIcon={<XIcon size={14} />}>
                {tCommon('action.cancel')}
              </Button>
              <Button
                size="small"
                variant="contained"
                onClick={editingId ? handleUpdate : handleCreate}
                disabled={!formName.trim() || submitting}
                startIcon={<CheckIcon size={14} />}
                sx={{ bgcolor: '#6C63FF', '&:hover': { bgcolor: '#5A52E0' } }}
              >
                {submitting ? '...' : editingId ? tCommon('action.save') : tCommon('action.create')}
              </Button>
            </Box>
          </Box>
        )}

        <List dense>
          {groups.map((group) => (
            <Box key={group.id}>
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  px: 1.5,
                  py: 1,
                  borderRadius: 1.5,
                  mb: 0.5,
                  bgcolor: editingId === group.id ? 'rgba(108,99,255,0.08)' : 'transparent',
                  '&:hover': { bgcolor: 'rgba(255,255,255,0.04)' },
                }}
              >
                <IconButton size="small" onClick={() => toggleExpand(group.id)} sx={{ mr: 0.5, p: 0.25 }}>
                  {expandedGroupId === group.id ? <CaretDownIcon size={12} /> : <CaretRightIcon size={12} />}
                </IconButton>
                <IconRenderer
                  value={group.icon}
                  size={16}
                  sx={{
                    width: 28,
                    height: 28,
                    borderRadius: 1.5,
                    bgcolor: `${group.color}18`,
                    border: '1px solid',
                    borderColor: `${group.color}40`,
                    mr: 1.5,
                    flexShrink: 0,
                  }}
                />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body2" sx={{ fontWeight: 500, fontSize: 13 }} noWrap>
                    {group.name}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10 }}>
                    {group.noteCount} {t('notebook.notes') || 'notes'}
                  </Typography>
                </Box>
                <Box sx={{ width: 12, height: 12, borderRadius: '50%', bgcolor: group.color, mr: 1 }} />
                <IconButton size="small" onClick={() => startEdit(group)}>
                  <PencilSimpleIcon size={14} color="#8B949E" />
                </IconButton>
                <IconButton size="small" onClick={() => handleDelete(group.id)}>
                  <TrashIcon size={14} color="#FF5252" />
                </IconButton>
              </Box>

              <Collapse in={expandedGroupId === group.id} timeout="auto" unmountOnExit>
                <Box sx={{ pl: 5, pr: 1, pb: 1 }}>
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 1, alignItems: 'center' }}>
                    {categories
                      .filter((c) => c.groupId === group.id)
                      .map((cat) => (
                        editingCategoryId === cat.id ? (
                          <Box key={cat.id} sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
                            <TextField
                              size="small"
                              value={editingCatName}
                              onChange={(e) => setEditingCatName(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleUpdateCategory(cat);
                                if (e.key === 'Escape') cancelEditCategory();
                              }}
                              sx={{
                                '& .MuiOutlinedInput-root': { borderRadius: 1, fontSize: 11 },
                                '& .MuiInputBase-input': { py: 0.5, px: 1, fontSize: 11 },
                              }}
                              autoFocus
                            />
                            <IconButton size="small" onClick={() => handleUpdateCategory(cat)} disabled={!editingCatName.trim()}>
                              <CheckIcon size={12} color="#6C63FF" />
                            </IconButton>
                            <IconButton size="small" onClick={cancelEditCategory}>
                              <XIcon size={12} color="#8B949E" />
                            </IconButton>
                          </Box>
                        ) : (
                          <Tooltip key={cat.id} title={cat.isDefault ? t('category.default_badge') : t('group.edit')} arrow placement="top">
                            <Chip
                              label={cat.name}
                              size="small"
                              icon={<TagIcon size={12} />}
                              onClick={() => !cat.isDefault && startEditCategory(cat)}
                              onDelete={cat.isDefault ? undefined : () => confirmDeleteCategory(cat)}
                              sx={{
                                borderRadius: 1,
                                fontSize: 11,
                                cursor: cat.isDefault ? 'default' : 'pointer',
                                '& .MuiChip-label': { px: 0.75 },
                                bgcolor: cat.isDefault ? 'rgba(108,99,255,0.08)' : 'rgba(255,255,255,0.06)',
                                '&:hover': cat.isDefault ? {} : {
                                  bgcolor: 'rgba(108,99,255,0.12)',
                                },
                              }}
                            />
                          </Tooltip>
                        )
                      ))}
                  </Box>

                  {addingCatForGroup === group.id ? (
                    <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
                      <TextField
                        size="small"
                        placeholder={t('category.new_name') || ''}
                        value={newCatName}
                        onChange={(e) => setNewCatName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleAddCategory(group.id);
                          if (e.key === 'Escape') { setAddingCatForGroup(null); setNewCatName(''); }
                        }}
                        sx={{ flex: 1, '& .MuiOutlinedInput-root': { borderRadius: 1, fontSize: 12 } }}
                        autoFocus
                      />
                      <IconButton size="small" onClick={() => handleAddCategory(group.id)} disabled={!newCatName.trim()}>
                        <CheckIcon size={14} color="#6C63FF" />
                      </IconButton>
                      <IconButton size="small" onClick={() => { setAddingCatForGroup(null); setNewCatName(''); }}>
                        <XIcon size={14} color="#8B949E" />
                      </IconButton>
                    </Box>
                  ) : (
                    <Button
                      size="small"
                      startIcon={<PlusIcon size={12} />}
                      onClick={() => { setAddingCatForGroup(group.id); setNewCatName(''); }}
                      sx={{ fontSize: 11, textTransform: 'none', color: '#6C63FF' }}
                    >
                      {t('category.add')}
                    </Button>
                  )}
                </Box>
              </Collapse>
            </Box>
          ))}
          {groups.length === 0 && !isFormVisible && (
            <Box sx={{ py: 4, textAlign: 'center' }}>
              <Typography variant="body2" color="text.secondary">
                {t('notebook.no_notes_desc')}
              </Typography>
            </Box>
          )}
        </List>
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose}>{tCommon('action.close')}</Button>
      </DialogActions>

      <Snackbar
        open={!!errorMsg}
        autoHideDuration={4000}
        onClose={() => setErrorMsg(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity="error" onClose={() => setErrorMsg(null)} sx={{ width: '100%' }}>
          {errorMsg}
        </Alert>
      </Snackbar>

      <Snackbar
        open={!!successMsg}
        autoHideDuration={3000}
        onClose={() => setSuccessMsg(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity="success" onClose={() => setSuccessMsg(null)} sx={{ width: '100%' }}>
          {successMsg}
        </Alert>
      </Snackbar>

      <Dialog open={deleteConfirmOpen} onClose={cancelDeleteCategory} maxWidth="xs">
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <WarningIcon size={20} color="#FF8A80" />
          {t('category.delete_confirm')}
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            {t('category.delete_confirm_desc', { name: categoryToDelete?.name })}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={cancelDeleteCategory} startIcon={<XIcon size={14} />}>
            {tCommon('action.cancel')}
          </Button>
          <Button
            onClick={executeDeleteCategory}
            color="error"
            variant="contained"
            startIcon={<TrashIcon size={14} />}
            sx={{ bgcolor: '#FF5252', '&:hover': { bgcolor: '#D32F2F' } }}
          >
            {tCommon('action.delete')}
          </Button>
        </DialogActions>
      </Dialog>
    </Dialog>
  );
}
