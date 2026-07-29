import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Box, Typography, IconButton, TextField, Card,
  CardContent, Tooltip, Button, Dialog, DialogTitle, DialogContent,
  DialogContentText, DialogActions,
} from '@mui/material';
import {
  PlusIcon, TagIcon, NoteIcon, CheckIcon, XIcon, FolderOpenIcon,
  PencilSimpleIcon, TrashIcon,
} from '@phosphor-icons/react';
import { useNotebookStore } from '../store/notebookStore';
import { IconRenderer } from './IconRenderer';
import { openCategoryNotesWindow, openAllNotesWindow } from '../../../core/services/window.service';
import type { NoteCategoryDto } from '../../../proto/notebook';
import { useTheme } from '@mui/material/styles';

export function CategoryCards() {
  const { t } = useTranslation('notebook');
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const primaryColor = isDark ? '#6C63FF' : '#5B54E0';
  const mutedColor = isDark ? '#8B949E' : '#6B7280';

  const {
    activeGroupId, groups, categories, loadCategoriesByGroup,
    createCategory, updateCategory, deleteCategory, loadNotes, notes,
  } = useNotebookStore();

  const [addingCategory, setAddingCategory] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [editingCatId, setEditingCatId] = useState<string | null>(null);
  const [editingCatName, setEditingCatName] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<NoteCategoryDto | null>(null);

  useEffect(() => {
    if (activeGroupId) {
      loadCategoriesByGroup(activeGroupId);
      loadNotes(activeGroupId);
    } else {
      loadNotes();
    }
  }, [activeGroupId, loadCategoriesByGroup, loadNotes]);

  const activeGroup = groups.find((g) => g.id === activeGroupId);

  const handleAddCategory = async () => {
    if (!newCatName.trim() || !activeGroupId) return;
    const result = await createCategory({ name: newCatName.trim(), groupId: activeGroupId, sortOrder: categories.length });
    if (result) {
      setNewCatName('');
      setAddingCategory(false);
      loadCategoriesByGroup(activeGroupId);
    }
  };

  const handleOpenCategory = async (categoryName: string) => {
    if (!activeGroupId) return;
    await openCategoryNotesWindow(activeGroupId, categoryName);
  };

  const handleOpenAllNotes = async () => {
    await openAllNotesWindow();
  };

  const startEditCategory = (cat: NoteCategoryDto) => {
    setEditingCatId(cat.id);
    setEditingCatName(cat.name);
    setAddingCategory(false);
  };

  const cancelEditCategory = () => {
    setEditingCatId(null);
    setEditingCatName('');
  };

  const handleUpdateCategory = async (cat: NoteCategoryDto) => {
    if (!editingCatName.trim() || !activeGroupId) return;
    await updateCategory({ id: cat.id, name: editingCatName.trim(), sortOrder: cat.sortOrder });
    cancelEditCategory();
    loadCategoriesByGroup(activeGroupId);
  };

  const confirmDeleteCategory = (cat: NoteCategoryDto) => {
    setDeleteTarget(cat);
  };

  const handleDeleteCategory = async () => {
    if (!deleteTarget || !activeGroupId) return;
    await deleteCategory(deleteTarget.id);
    setDeleteTarget(null);
    loadCategoriesByGroup(activeGroupId);
  };

  const getNoteCountForCategory = (catName: string) => {
    return notes.filter((n) => n.category === catName && n.groupId === activeGroupId).length;
  };

  // 「未分类」仅统计 category 为空串的笔记；字面量 'uncategorized' 是一个独立存在的真实分类
  // （每个分组默认种子都会创建一行），由上方同名卡片单独计数。若这里再把 'uncategorized' 计入，
  // 显式归属到该分类的笔记会同时出现在两张卡片里造成重复计数（R21 修复）。
  const uncategorizedCount = notes.filter(
    (n) => n.groupId === activeGroupId && !n.category,
  ).length;

  if (!activeGroupId) {
    return (
      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', p: 4 }}>
        <FolderOpenIcon size={48} color={mutedColor} style={{ opacity: 0.3 }} />
        <Typography variant="body1" color="text.secondary" sx={{ mt: 2 }}>
          {t('category.select_group_hint')}
        </Typography>
        <Button
          variant="outlined"
          size="small"
          onClick={handleOpenAllNotes}
          sx={{ mt: 2, borderColor: '#6C63FF', color: '#6C63FF' }}
        >
          {t('notebook.all_notes')}
        </Button>
      </Box>
    );
  }

  return (
    <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'auto', p: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 3 }}>
        {activeGroup && (
          <>
            <IconRenderer
              value={activeGroup.icon}
              size={24}
              sx={{
                width: 40,
                height: 40,
                borderRadius: 2,
                bgcolor: `${activeGroup.color}18`,
                border: '1px solid',
                borderColor: `${activeGroup.color}40`,
                mr: 1.5,
              }}
            />
            <Box>
              <Typography variant="h6" sx={{ fontSize: 18, fontWeight: 700, color: activeGroup.color }}>
                {activeGroup.name}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {activeGroup.noteCount} {t('notebook.notes') || 'notes'}
              </Typography>
            </Box>
          </>
        )}
        <Box sx={{ flex: 1 }} />
        <Tooltip title={t('category.add') || ''}>
          <IconButton
            size="small"
            onClick={() => { setAddingCategory(true); setNewCatName(''); }}
            sx={{
              background: `${primaryColor}15`,
              '&:hover': { background: `${primaryColor}25` },
            }}
          >
            <PlusIcon size={16} weight="bold" color="#6C63FF" />
          </IconButton>
        </Tooltip>
      </Box>

      {addingCategory && (
        <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center', mb: 2, maxWidth: 400 }}>
          <TextField
            size="small"
            placeholder={t('category.new_name') || ''}
            value={newCatName}
            onChange={(e) => setNewCatName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAddCategory();
              if (e.key === 'Escape') { setAddingCategory(false); setNewCatName(''); }
            }}
            autoFocus
            sx={{ flex: 1, '& .MuiOutlinedInput-root': { borderRadius: 2 } }}
          />
          <IconButton size="small" onClick={handleAddCategory} disabled={!newCatName.trim()}>
            <CheckIcon size={16} color={newCatName.trim() ? primaryColor : mutedColor} />
          </IconButton>
          <IconButton size="small" onClick={() => { setAddingCategory(false); setNewCatName(''); }}>
            <XIcon size={16} color={mutedColor} />
          </IconButton>
        </Box>
      )}

      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
        {categories.map((cat: NoteCategoryDto) => {
          const count = getNoteCountForCategory(cat.name);
          const isEditing = editingCatId === cat.id;

          if (isEditing) {
            return (
              <Card
                key={cat.id}
                sx={{
                  width: 180,
                  borderRadius: 3,
                  border: '2px solid',
                  borderColor: '#6C63FF',
                  bgcolor: `${primaryColor}08`,
                }}
              >
                <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 1 }}>
                    <TagIcon size={18} color="#6C63FF" />
                    <TextField
                      size="small"
                      value={editingCatName}
                      onChange={(e) => setEditingCatName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleUpdateCategory(cat);
                        if (e.key === 'Escape') cancelEditCategory();
                      }}
                      autoFocus
                      variant="standard"
                      sx={{ flex: 1, '& .MuiInputBase-input': { fontSize: 14, fontWeight: 600, py: 0 } }}
                    />
                  </Box>
                  <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 0.5 }}>
                    <IconButton size="small" onClick={() => handleUpdateCategory(cat)} disabled={!editingCatName.trim()}>
                      <CheckIcon size={14} color={editingCatName.trim() ? primaryColor : mutedColor} />
                    </IconButton>
                    <IconButton size="small" onClick={cancelEditCategory}>
                      <XIcon size={14} color={mutedColor} />
                    </IconButton>
                  </Box>
                </CardContent>
              </Card>
            );
          }

          return (
            <Card
              key={cat.id}
              onClick={() => handleOpenCategory(cat.name)}
              sx={{
                width: 180,
                borderRadius: 3,
                border: '1px solid',
                borderColor: 'divider',
                bgcolor: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)',
                transition: 'all 0.2s',
                cursor: 'pointer',
                '&:hover': {
                  borderColor: '#6C63FF',
                  boxShadow: isDark ? '0 4px 20px rgba(108,99,255,0.15)' : '0 4px 20px rgba(91,84,224,0.1)',
                  transform: 'translateY(-2px)',
                  '& .cat-actions': { opacity: 1 },
                },
              }}
            >
                <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
                    <TagIcon size={20} color={cat.isDefault ? primaryColor : mutedColor} />
                    <Typography variant="subtitle2" sx={{ fontSize: 14, fontWeight: 600, flex: 1 }} noWrap>
                      {cat.name}
                    </Typography>
                    <Box className="cat-actions" sx={{
                      display: 'flex', gap: 0, opacity: 0, transition: 'opacity 0.2s', ml: 'auto', flexShrink: 0,
                    }}>
                      <Tooltip title={t('category.edit') || 'Edit'}>
                        <IconButton
                          size="small"
                          onClick={(e) => { e.stopPropagation(); startEditCategory(cat); }}
                          sx={{ '&:hover': { bgcolor: `${primaryColor}20` }, p: 0.25 }}
                        >
                          <PencilSimpleIcon size={12} color={mutedColor} />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title={t('category.delete') || 'Delete'}>
                        <IconButton
                          size="small"
                          onClick={(e) => { e.stopPropagation(); confirmDeleteCategory(cat); }}
                          sx={{ '&:hover': { bgcolor: 'rgba(255,82,82,0.15)' }, p: 0.25 }}
                        >
                          <TrashIcon size={12} color="#FF5252" />
                        </IconButton>
                      </Tooltip>
                    </Box>
                  </Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <NoteIcon size={12} color={mutedColor} />
                    <Typography variant="caption" color="text.secondary">
                      {count} {t('notebook.notes') || 'notes'}
                    </Typography>
                  </Box>
                </CardContent>
            </Card>
          );
        })}

        {uncategorizedCount > 0 && (
          <Card
            onClick={() => handleOpenCategory('')}
            sx={{
              width: 180,
              borderRadius: 3,
              border: '1px dashed',
              borderColor: 'divider',
              bgcolor: isDark ? 'rgba(255,255,255,0.01)' : 'rgba(0,0,0,0.01)',
              transition: 'all 0.2s',
              cursor: 'pointer',
              '&:hover': {
                borderColor: mutedColor,
                transform: 'translateY(-2px)',
              },
            }}
          >
              <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
                  <NoteIcon size={20} color={mutedColor} />
                  <Typography variant="subtitle2" sx={{ fontSize: 14, fontWeight: 600 }} noWrap>
                    {t('category.uncategorized')}
                  </Typography>
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <NoteIcon size={12} color={mutedColor} />
                  <Typography variant="caption" color="text.secondary">
                    {uncategorizedCount} {t('notebook.notes') || 'notes'}
                  </Typography>
                </Box>
              </CardContent>
          </Card>
        )}

        <Card
          onClick={() => { setAddingCategory(true); setNewCatName(''); }}
          sx={{
            width: 180,
            borderRadius: 3,
            border: '1px dashed',
            borderColor: `${primaryColor}40`,
            bgcolor: `${primaryColor}05`,
            transition: 'all 0.2s',
            cursor: 'pointer',
            '&:hover': {
              borderColor: primaryColor,
              bgcolor: `${primaryColor}10`,
            },
          }}
        >
              <CardContent sx={{ p: 2, '&:last-child': { pb: 2 }, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                <PlusIcon size={24} color={primaryColor} />
                <Typography variant="caption" color={primaryColor} sx={{ mt: 0.5 }}>
                  {t('category.add')}
                </Typography>
              </CardContent>
        </Card>
      </Box>

      {categories.length === 0 && uncategorizedCount === 0 && !addingCategory && (
        <Box sx={{ textAlign: 'center', mt: 6 }}>
          <TagIcon size={40} color={mutedColor} style={{ opacity: 0.3 }} />
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            {t('category.empty_hint')}
          </Typography>
        </Box>
      )}

      <Dialog open={!!deleteTarget} onClose={() => setDeleteTarget(null)}>
        <DialogTitle>{t('category.delete') || 'Delete Category'}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {t('category.delete_confirm_desc', { name: deleteTarget?.name }) || `Are you sure you want to delete "${deleteTarget?.name}"?`}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteTarget(null)}>{t('action.cancel', { ns: 'common' }) || 'Cancel'}</Button>
          <Button onClick={handleDeleteCategory} color="error" variant="contained">
            {t('action.delete', { ns: 'common' }) || 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
