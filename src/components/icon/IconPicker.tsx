import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import Box from '@mui/material/Box';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import InputAdornment from '@mui/material/InputAdornment';
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import IconButton from '@mui/material/IconButton';
import Button from '@mui/material/Button';
import { MagnifyingGlassIcon, TrashIcon, UploadIcon } from '@phosphor-icons/react';
import * as iconService from '../../core/services/icon.service';
import { invalidateIconUrlCache } from './IconRenderer';
import { isCustomIconValue, isMaterialIconValue, getMaterialIconName } from './iconUtils';
import type { IconGroupDto, CustomIconDto } from '../../proto/icon';

interface IconPickerProps {
  value: string;
  onChange: (icon: string) => void;
}

const ICON_CATEGORIES = [
  {
    name: 'Devices',
    icons: ['🖥️', '💻', '🖨️', '⌨️', '🖱️', '💽', '💾', '💿', '📷', '📹', '📺', '📻', '📱', '⌚', '🎮'],
  },
  {
    name: 'Network',
    icons: ['🌐', '🌍', '🌎', '🌏', '🗺️', '🧭', '📡', '🛰️', '🚀', '✈️', '📞', '📟', '📠', '📶', '🔗'],
  },
  {
    name: 'Security',
    icons: ['🔒', '🔓', '🔑', '🗝️', '🛡️', '🔐', '🔏', '⚔️', '🚨', '🚫', '⛔', '🛑', '🕵️', '👁️', '🧿'],
  },
  {
    name: 'Tools',
    icons: ['⚙️', '🔧', '🔨', '⚒️', '🛠️', '⛏️', '🔩', '🧰', '🧲', '⚡', '🔋', '🔌', '💡', '📐', '📏'],
  },
  {
    name: 'Tech',
    icons: ['🐧', '🐳', '☸️', '☁️', '🗄️', '📊', '📈', '📉', '📋', '📁', '📂', '🗂️', '🗃️', '🗄️', '🏷️'],
  },
  {
    name: 'Code',
    icons: ['💻', '⌨️', '🖥️', '🎯', '✅', '❌', '⚠️', '🐛', '🧪', '📦', '🚀', '🔄', '🔀', '♻️', '🏁'],
  },
  {
    name: 'Stars',
    icons: ['⭐', '🌟', '✨', '💫', '🔥', '💥', '💢', '💦', '🎉', '🎊', '🎈', '🎁', '🏆', '👑', '💎'],
  },
  {
    name: 'Status',
    icons: ['✅', '❌', '⚠️', 'ℹ️', '🔴', '🟡', '🟢', '🔵', '⚪', '⚫', '🔶', '🔷', '🔸', '🔹', '💬'],
  },
];

const ALL_ICONS = ICON_CATEGORIES.flatMap((c) => c.icons);

const MATERIAL_ICONS = [
  'home', 'settings', 'person', 'group', 'search', 'cloud', 'storage', 'database',
  'terminal', 'code', 'bug_report', 'build', 'security', 'lock', 'key',
  'router', 'dns', 'server', 'computer', 'laptop', 'phone_android',
  'memory', 'developer_board', 'electrical_services', 'power',
  'api', 'webhook', 'schema', 'hub', 'share',
  'sync', 'update', 'backup', 'restore', 'download', 'upload',
  'folder', 'folder_open', 'description', 'article', 'note',
  'dashboard', 'monitoring', 'analytics', 'speed', 'timer',
  'notifications', 'alarm', 'event', 'schedule', 'history',
  'smart_toy', 'psychology', 'auto_awesome', 'tips_and_updates',
  'rocket_launch', 'flight', 'sailing', 'directions_boat',
  'shield', 'verified_user', 'admin_panel_settings', 'policy',
  'extension', 'plugin', 'widgets', 'view_module',
];

export function IconPicker({ value, onChange }: IconPickerProps) {
  const { t } = useTranslation('notebook');
  const [mainTab, setMainTab] = useState(0);
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState(0);

  const [iconGroups, setIconGroups] = useState<IconGroupDto[]>([]);
  const [customIcons, setCustomIcons] = useState<CustomIconDto[]>([]);
  const [iconUrls, setIconUrls] = useState<Record<string, string>>({});
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadGroupsAndUrls = useCallback(async () => {
    try {
      const [groups, urls] = await Promise.all([
        iconService.listIconGroups(),
        iconService.getCustomIconUrls(),
      ]);
      setIconGroups(groups);
      setIconUrls(urls);
      return groups;
    } catch {
      return [];
    }
  }, []);

  const loadIconsForGroup = useCallback(async (groupId: string) => {
    try {
      const icons = await iconService.listCustomIcons(groupId);
      setCustomIcons(icons);
    } catch {
      setCustomIcons([]);
    }
  }, []);

  const ensureDefaultGroup = useCallback(async (existingGroups: IconGroupDto[]): Promise<IconGroupDto> => {
    if (existingGroups.length > 0) {
      return existingGroups[0];
    }
    const group = await iconService.createIconGroup('Default', null, 0);
    setIconGroups([group]);
    return group;
  }, []);

  useEffect(() => {
    if (mainTab === 2) {
      loadGroupsAndUrls().then(async (groups) => {
        const group = await ensureDefaultGroup(groups);
        const gid = selectedGroupId || group.id;
        if (!selectedGroupId) {
          setSelectedGroupId(gid);
        }
        loadIconsForGroup(gid);
      });
    }
  }, [mainTab]);

  const handleSelectGroup = async (groupId: string) => {
    setSelectedGroupId(groupId);
    loadIconsForGroup(groupId);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    let groupId = selectedGroupId || iconGroups[0]?.id;
    if (!groupId) {
      const group = await ensureDefaultGroup([]);
      groupId = group.id;
    }

    const arrayBuffer = await file.arrayBuffer();
    const fileData = new Uint8Array(arrayBuffer);

    try {
      await iconService.uploadCustomIcon(
        file.name.replace(/\.[^/.]+$/, ''),
        groupId,
        fileData,
        file.name,
      );
      invalidateIconUrlCache();
      loadIconsForGroup(groupId);
      const urls = await iconService.getCustomIconUrls();
      setIconUrls(urls);
    } catch {
      // silently fail
    }
    e.target.value = '';
  };

  const handleDeleteCustomIcon = async (id: string) => {
    try {
      await iconService.deleteCustomIcon(id);
      invalidateIconUrlCache();
      const groupId = selectedGroupId || iconGroups[0]?.id;
      if (groupId) {
        loadIconsForGroup(groupId);
      }
      const urls = await iconService.getCustomIconUrls();
      setIconUrls(urls);
    } catch {
      // silently fail
    }
  };

  const filteredEmojiIcons = useMemo(() => {
    if (search.trim()) {
      return ALL_ICONS;
    }
    return ICON_CATEGORIES[activeCategory].icons;
  }, [search, activeCategory]);

  const filteredMaterialIcons = useMemo(() => {
    if (search.trim()) {
      return MATERIAL_ICONS.filter((name) => name.includes(search.toLowerCase()));
    }
    return MATERIAL_ICONS;
  }, [search]);

  const filteredCustomIcons = useMemo(() => {
    if (search.trim()) {
      return customIcons.filter((icon) =>
        icon.name.toLowerCase().includes(search.toLowerCase())
      );
    }
    return customIcons;
  }, [search, customIcons]);

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
        <Box
          sx={{
            width: 40,
            height: 40,
            borderRadius: 2,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: isCustomIconValue(value) ? 0 : isMaterialIconValue(value) ? 0 : 22,
            border: '2px solid',
            borderColor: 'rgba(108,99,255,0.5)',
            bgcolor: 'rgba(108,99,255,0.08)',
            overflow: 'hidden',
          }}
        >
          {isCustomIconValue(value) ? (
            <img
              src={iconUrls[value.replace('custom:', '')] || ''}
              alt=""
              style={{ width: 24, height: 24, objectFit: 'contain' }}
            />
          ) : isMaterialIconValue(value) ? (
            <span className="material-symbols-outlined" style={{ fontSize: 22 }}>
              {getMaterialIconName(value)}
            </span>
          ) : (
            value || '📁'
          )}
        </Box>
        <TextField
          size="small"
          placeholder={t('icon.search') || 'Search icons...'}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          sx={{ flex: 1, '& .MuiOutlinedInput-root': { borderRadius: 2 } }}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <MagnifyingGlassIcon size={14} color="#8B949E" />
                </InputAdornment>
              ),
            },
          }}
        />
      </Box>

      <Tabs
        value={mainTab}
        onChange={(_, v) => setMainTab(v)}
        variant="fullWidth"
        sx={{
          minHeight: 28,
          mb: 1,
          '& .MuiTab-root': { minHeight: 28, py: 0, fontSize: 11, minWidth: 'auto', px: 1 },
        }}
      >
        <Tab label="😀 Emoji" />
        <Tab label="🎨 Material" />
        <Tab label="📁 Custom" />
      </Tabs>

      {mainTab === 0 && (
        <>
          {!search && (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 1 }}>
              {ICON_CATEGORIES.map((cat, idx) => (
                <Box
                  key={cat.name}
                  onClick={() => setActiveCategory(idx)}
                  sx={{
                    px: 1,
                    py: 0.25,
                    borderRadius: 1,
                    cursor: 'pointer',
                    fontSize: 11,
                    bgcolor: activeCategory === idx ? 'rgba(108,99,255,0.15)' : 'transparent',
                    color: activeCategory === idx ? '#6C63FF' : 'text.secondary',
                    border: '1px solid',
                    borderColor: activeCategory === idx ? 'rgba(108,99,255,0.3)' : 'transparent',
                    '&:hover': { bgcolor: 'rgba(108,99,255,0.08)' },
                  }}
                >
                  {cat.icons[0]} {cat.name}
                </Box>
              ))}
            </Box>
          )}

          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: 'repeat(8, 1fr)',
              gap: 0.5,
              maxHeight: 180,
              overflow: 'auto',
              p: 0.5,
              border: '1px solid',
              borderColor: 'divider',
              borderRadius: 1,
            }}
          >
            {filteredEmojiIcons.map((icon) => (
              <Box
                key={icon}
                onClick={() => onChange(icon)}
                sx={{
                  width: 32,
                  height: 32,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 18,
                  borderRadius: 1,
                  cursor: 'pointer',
                  bgcolor: value === icon ? 'rgba(108,99,255,0.15)' : 'transparent',
                  border: value === icon ? '1px solid rgba(108,99,255,0.5)' : '1px solid transparent',
                  '&:hover': { bgcolor: 'rgba(108,99,255,0.08)' },
                }}
              >
                {icon}
              </Box>
            ))}
          </Box>
        </>
      )}

      {mainTab === 1 && (
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: 'repeat(8, 1fr)',
            gap: 0.5,
            maxHeight: 180,
            overflow: 'auto',
            p: 0.5,
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: 1,
          }}
        >
          {filteredMaterialIcons.map((name) => {
            const iconValue = `material:${name}`;
            return (
              <Box
                key={name}
                onClick={() => onChange(iconValue)}
                sx={{
                  width: 32,
                  height: 32,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: 1,
                  cursor: 'pointer',
                  bgcolor: value === iconValue ? 'rgba(108,99,255,0.15)' : 'transparent',
                  border: value === iconValue ? '1px solid rgba(108,99,255,0.5)' : '1px solid transparent',
                  '&:hover': { bgcolor: 'rgba(108,99,255,0.08)' },
                }}
                title={name}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                  {name}
                </span>
              </Box>
            );
          })}
          {filteredMaterialIcons.length === 0 && (
            <Typography variant="caption" color="text.secondary" sx={{ gridColumn: '1/-1', textAlign: 'center', py: 2 }}>
              {t('icon.no_icons') || 'No icons found'}
            </Typography>
          )}
        </Box>
      )}

      {mainTab === 2 && (
        <>
          <Box sx={{ display: 'flex', gap: 0.5, mb: 1, flexWrap: 'wrap', alignItems: 'center' }}>
            {iconGroups.map((group) => (
              <Box
                key={group.id}
                onClick={() => handleSelectGroup(group.id)}
                sx={{
                  px: 1,
                  py: 0.25,
                  borderRadius: 1,
                  cursor: 'pointer',
                  fontSize: 11,
                  bgcolor: selectedGroupId === group.id ? 'rgba(108,99,255,0.15)' : 'transparent',
                  color: selectedGroupId === group.id ? '#6C63FF' : 'text.secondary',
                  border: '1px solid',
                  borderColor: selectedGroupId === group.id ? 'rgba(108,99,255,0.3)' : 'transparent',
                  '&:hover': { bgcolor: 'rgba(108,99,255,0.08)' },
                }}
              >
                {group.name}
              </Box>
            ))}
            <Button
              size="small"
              startIcon={<UploadIcon size={12} />}
              sx={{ ml: 'auto', fontSize: 10, minWidth: 'auto', py: 0.25, px: 1 }}
              onClick={() => fileInputRef.current?.click()}
            >
              {t('icon.upload') || 'Upload'}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".svg,.png,.jpg,.jpeg,.gif,.webp"
              style={{ display: 'none' }}
              onChange={handleFileUpload}
            />
          </Box>

          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: 'repeat(6, 1fr)',
              gap: 0.5,
              maxHeight: 160,
              overflow: 'auto',
              p: 0.5,
              border: '1px solid',
              borderColor: 'divider',
              borderRadius: 1,
            }}
          >
            {filteredCustomIcons.map((icon) => {
              const iconValue = `custom:${icon.id}`;
              const url = iconUrls[icon.id];
              return (
                <Box
                  key={icon.id}
                  sx={{
                    position: 'relative',
                    width: 40,
                    height: 40,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: 1,
                    cursor: 'pointer',
                    bgcolor: value === iconValue ? 'rgba(108,99,255,0.15)' : 'transparent',
                    border: value === iconValue ? '1px solid rgba(108,99,255,0.5)' : '1px solid transparent',
                    '&:hover': {
                      bgcolor: 'rgba(108,99,255,0.08)',
                      '& .delete-btn': { opacity: 1 },
                    },
                  }}
                  onClick={() => onChange(iconValue)}
                  title={icon.name}
                >
                  {url ? (
                    <img src={url} alt={icon.name} style={{ width: 22, height: 22, objectFit: 'contain' }} />
                  ) : (
                    <Typography variant="caption">?</Typography>
                  )}
                  <IconButton
                    className="delete-btn"
                    size="small"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteCustomIcon(icon.id);
                    }}
                    sx={{
                      position: 'absolute',
                      top: -4,
                      right: -4,
                      opacity: 0,
                      width: 16,
                      height: 16,
                      bgcolor: 'error.main',
                      color: 'white',
                      '&:hover': { bgcolor: 'error.dark' },
                      p: 0,
                    }}
                  >
                    <TrashIcon size={8} />
                  </IconButton>
                </Box>
              );
            })}
            {filteredCustomIcons.length === 0 && (
              <Typography variant="caption" color="text.secondary" sx={{ gridColumn: '1/-1', textAlign: 'center', py: 2 }}>
                {t('icon.no_custom') || 'No custom icons'}
              </Typography>
            )}
          </Box>
        </>
      )}
    </Box>
  );
}
