import { useCallback, useEffect, useRef, useState } from 'react';
import { Box, Typography, List, ListItemButton, ListItemText, CircularProgress, Divider } from '@mui/material';
import { LinkIcon, ArrowBendUpLeftIcon, ArrowBendUpRightIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@mui/material/styles';
import { listen } from '@tauri-apps/api/event';
import { getNoteLinks } from '../../../core/services/notebook.service';
import type { NoteLinks, NoteLinkItem, NoteGroupDto } from '../../../proto/notebook';

interface BacklinksPanelProps {
  noteId: string | null;
  groups?: NoteGroupDto[];
  onNavigate: (id: string) => void;
}

function LinkSection({
  title,
  icon,
  items,
  groups,
  emptyKey,
  onNavigate,
}: {
  title: string;
  icon: React.ReactNode;
  items: NoteLinkItem[];
  groups?: NoteGroupDto[];
  emptyKey: string;
  onNavigate: (id: string) => void;
}) {
  const { t } = useTranslation('notebook');
  return (
    <Box sx={{ mb: 1 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 1, py: 0.5 }}>
        {icon}
        <Typography variant="caption" sx={{ fontWeight: 700, fontSize: 11, letterSpacing: 0.4, textTransform: 'uppercase', color: 'text.secondary' }}>
          {title}
        </Typography>
        <Typography variant="caption" sx={{ color: 'text.disabled', fontSize: 11 }}>
          {items.length}
        </Typography>
      </Box>
      {items.length === 0 ? (
        <Typography variant="caption" sx={{ px: 1, color: 'text.disabled', display: 'block' }}>
          {t(emptyKey)}
        </Typography>
      ) : (
        <List dense disablePadding>
          {items.map((item) => {
            const gName = groups?.find((g) => g.id === item.groupId)?.name;
            return (
              <ListItemButton
                key={item.id}
                onClick={() => onNavigate(item.id)}
                sx={{ px: 1, py: 0.5, borderRadius: 1, '&:hover': { bgcolor: 'action.hover' } }}
              >
                <ListItemText
                  primary={
                    <Typography variant="body2" noWrap sx={{ fontWeight: 600, fontSize: 12.5 }}>
                      {item.title}
                    </Typography>
                  }
                  secondary={
                    item.snippet || gName ? (
                      <Typography variant="caption" noWrap sx={{ opacity: 0.7, display: 'block' }}>
                        {item.snippet || gName}
                      </Typography>
                    ) : undefined
                  }
                />
              </ListItemButton>
            );
          })}
        </List>
      )}
    </Box>
  );
}

export function BacklinksPanel({ noteId, groups, onNavigate }: BacklinksPanelProps) {
  const { t } = useTranslation('notebook');
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const [links, setLinks] = useState<NoteLinks | null>(null);
  const [loading, setLoading] = useState(false);
  const mountedRef = useRef(true);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const load = useCallback((id: string | null) => {
    if (!id) {
      setLinks(null);
      return;
    }
    setLoading(true);
    getNoteLinks(id)
      .then((res) => {
        if (mountedRef.current) setLinks(res);
      })
      .catch(() => {
        if (mountedRef.current) setLinks({ backlinks: [], outgoing: [] });
      })
      .finally(() => {
        if (mountedRef.current) setLoading(false);
      });
  }, []);

  // 切到不同笔记时重新拉取链接
  useEffect(() => {
    load(noteId);
  }, [noteId, load]);

  // 任意笔记被保存/改动后（后端广播 notes-changed，含本笔记自己的保存回声），
  // 重新拉取当前笔记的双向链接，这样在正文里新增/删除 [[标题]] 后无需切走再切回即可刷新（R6-2 可用性修复）。
  // 防抖：get_note_links 会全表扫描所有笔记正文（O(N)），每次保存都触发会浪费资源，
  // 合并 250ms 内的多次广播（如连续自动保存）只重算一次。
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen<unknown>('notes-changed', () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => load(noteId), 250);
    })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => {});
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      unlisten?.();
    };
  }, [noteId, load]);

  return (
    <Box
      sx={{
        width: 260,
        minWidth: 260,
        borderLeft: '1px solid',
        borderColor: 'divider',
        display: 'flex',
        flexDirection: 'column',
        bgcolor: isDark ? 'rgba(13,17,23,0.4)' : 'rgba(250,250,252,0.6)',
        overflow: 'hidden',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 1.5, py: 1, borderBottom: '1px solid', borderColor: 'divider' }}>
        <LinkIcon size={16} color={isDark ? '#8B95FF' : '#5B54E0'} />
        <Typography variant="subtitle2" sx={{ fontWeight: 700, fontSize: 13 }}>
          {t('notebook.links_title')}
        </Typography>
      </Box>
      <Box sx={{ flex: 1, overflow: 'auto', py: 0.5 }}>
        {!noteId ? (
          <Typography variant="caption" sx={{ px: 1.5, color: 'text.disabled', display: 'block', py: 2 }}>
            {t('notebook.links_select_note')}
          </Typography>
        ) : loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
            <CircularProgress size={20} />
          </Box>
        ) : (
          links && (
            <>
              <LinkSection
                title={t('notebook.links_backlinks')}
                icon={<ArrowBendUpLeftIcon size={14} weight="bold" />}
                items={links.backlinks}
                groups={groups}
                emptyKey="notebook.links_no_backlinks"
                onNavigate={onNavigate}
              />
              <Divider sx={{ my: 0.5 }} />
              <LinkSection
                title={t('notebook.links_outgoing')}
                icon={<ArrowBendUpRightIcon size={14} weight="bold" />}
                items={links.outgoing}
                groups={groups}
                emptyKey="notebook.links_no_outgoing"
                onNavigate={onNavigate}
              />
              {links.backlinks.length === 0 && links.outgoing.length === 0 && (
                <Typography variant="caption" sx={{ px: 1.5, py: 1, color: 'text.disabled', display: 'block', lineHeight: 1.5 }}>
                  {t('notebook.links_hint')}
                </Typography>
              )}
            </>
          )
        )}
      </Box>
    </Box>
  );
}
