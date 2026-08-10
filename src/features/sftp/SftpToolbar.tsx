import { useState } from 'react';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import InputBase from '@mui/material/InputBase';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Tooltip from '@mui/material/Tooltip';
import {
  ArrowClockwiseIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowUpIcon,
  CaretDownIcon,
  DownloadIcon,
  EyeIcon,
  EyeSlashIcon,
  FileIcon,
  FolderIcon,
  FolderPlusIcon,
  HouseIcon,
  MagnifyingGlassIcon,
  PencilSimpleIcon,
  SidebarSimpleIcon,
  TrashIcon,
  UploadIcon,
  XIcon,
} from '@phosphor-icons/react';

export interface SftpToolbarLabels {
  back: string;
  forward: string;
  parent: string;
  home: string;
  refresh: string;
  upload: string;
  uploadFiles: string;
  uploadFolder: string;
  download: string;
  downloadTo: string;
  newFolder: string;
  rename: string;
  delete: string;
  showHidden: string;
  hideHidden: string;
  searchPlaceholder: string;
  clearSearch: string;
  showTree: string;
  hideTree: string;
}

interface SftpToolbarProps {
  isDark: boolean;
  busy: boolean;
  loading: boolean;
  canBack: boolean;
  canForward: boolean;
  canUp: boolean;
  selectedCount: number;
  canRename: boolean;
  showHidden: boolean;
  search: string;
  /** Narrow windows drop the labels and keep the icons only. */
  compact: boolean;
  treeOpen: boolean;
  labels: SftpToolbarLabels;
  onToggleTree: () => void;
  onBack: () => void;
  onForward: () => void;
  onUp: () => void;
  onHome: () => void;
  onRefresh: () => void;
  onUpload: (mode: 'files' | 'folder') => void;
  onDownload: (ask: boolean) => void;
  onNewFolder: () => void;
  onRename: () => void;
  onDelete: () => void;
  onToggleHidden: () => void;
  onSearchChange: (v: string) => void;
}

/**
 * The action row. Upload and download are split buttons because "which files"
 * and "where to" are two different questions and burying either one in a
 * dialog costs a click every single time.
 */
export function SftpToolbar({
  isDark,
  busy,
  loading,
  canBack,
  canForward,
  canUp,
  selectedCount,
  canRename,
  showHidden,
  search,
  compact,
  treeOpen,
  labels,
  onToggleTree,
  onBack,
  onForward,
  onUp,
  onHome,
  onRefresh,
  onUpload,
  onDownload,
  onNewFolder,
  onRename,
  onDelete,
  onToggleHidden,
  onSearchChange,
}: SftpToolbarProps) {
  const [uploadAnchor, setUploadAnchor] = useState<HTMLElement | null>(null);
  const [downloadAnchor, setDownloadAnchor] = useState<HTMLElement | null>(null);

  const border = isDark ? 'rgba(240,246,252,0.12)' : 'rgba(27,31,36,0.12)';
  const subtle = isDark ? '#8B949E' : '#57606A';
  const accent = isDark ? '#58A6FF' : '#0969DA';
  const green = isDark ? '#3FB950' : '#1A7F37';
  const red = isDark ? '#FF6B6B' : '#D32F2F';
  const searchBg = isDark ? 'rgba(110,118,129,0.16)' : 'rgba(27,31,36,0.05)';

  const Divider = () => (
    <Box sx={{ width: '1px', bgcolor: border, mx: 0.5, height: 18, flexShrink: 0 }} />
  );

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 0.25,
        px: 1,
        py: 0.6,
        borderBottom: `1px solid ${border}`,
        flexShrink: 0,
      }}
    >
      <Tooltip title={treeOpen ? labels.hideTree : labels.showTree}>
        <IconButton size="small" onClick={onToggleTree}>
          <SidebarSimpleIcon
            size={17}
            color={treeOpen ? accent : subtle}
            weight={treeOpen ? 'fill' : 'regular'}
          />
        </IconButton>
      </Tooltip>

      <Divider />

      <Tooltip title={labels.back}>
        <span>
          <IconButton size="small" onClick={onBack} disabled={!canBack}>
            <ArrowLeftIcon size={17} color={subtle} />
          </IconButton>
        </span>
      </Tooltip>
      <Tooltip title={labels.forward}>
        <span>
          <IconButton size="small" onClick={onForward} disabled={!canForward}>
            <ArrowRightIcon size={17} color={subtle} />
          </IconButton>
        </span>
      </Tooltip>
      <Tooltip title={labels.parent}>
        <span>
          <IconButton size="small" onClick={onUp} disabled={!canUp}>
            <ArrowUpIcon size={17} color={subtle} />
          </IconButton>
        </span>
      </Tooltip>
      <Tooltip title={labels.home}>
        <span>
          <IconButton size="small" onClick={onHome} disabled={loading}>
            <HouseIcon size={17} color={subtle} />
          </IconButton>
        </span>
      </Tooltip>
      <Tooltip title={labels.refresh}>
        <span>
          <IconButton size="small" onClick={onRefresh} disabled={loading}>
            <ArrowClockwiseIcon size={16} color={subtle} />
          </IconButton>
        </span>
      </Tooltip>

      <Divider />

      <Tooltip title={labels.upload}>
        <span>
          <IconButton
            size="small"
            onClick={(e) => setUploadAnchor(e.currentTarget)}
            disabled={busy}
            sx={{ px: 0.6, borderRadius: 1 }}
          >
            <UploadIcon size={17} color={accent} />
            <CaretDownIcon size={9} color={subtle} style={{ marginLeft: 2 }} />
          </IconButton>
        </span>
      </Tooltip>
      <Tooltip title={labels.download}>
        <span>
          <IconButton
            size="small"
            onClick={(e) => setDownloadAnchor(e.currentTarget)}
            disabled={busy || selectedCount === 0}
            sx={{ px: 0.6, borderRadius: 1 }}
          >
            <DownloadIcon size={17} color={selectedCount === 0 ? subtle : green} />
            <CaretDownIcon size={9} color={subtle} style={{ marginLeft: 2 }} />
          </IconButton>
        </span>
      </Tooltip>

      <Divider />

      <Tooltip title={labels.newFolder}>
        <span>
          <IconButton size="small" onClick={onNewFolder} disabled={busy}>
            <FolderPlusIcon size={17} color={subtle} />
          </IconButton>
        </span>
      </Tooltip>
      <Tooltip title={labels.rename}>
        <span>
          <IconButton size="small" onClick={onRename} disabled={busy || !canRename}>
            <PencilSimpleIcon size={16} color={subtle} />
          </IconButton>
        </span>
      </Tooltip>
      <Tooltip title={labels.delete}>
        <span>
          <IconButton size="small" onClick={onDelete} disabled={busy || selectedCount === 0}>
            <TrashIcon size={16} color={selectedCount === 0 ? subtle : red} />
          </IconButton>
        </span>
      </Tooltip>

      <Divider />

      <Tooltip title={showHidden ? labels.hideHidden : labels.showHidden}>
        <IconButton size="small" onClick={onToggleHidden}>
          {showHidden ? (
            <EyeIcon size={17} color={accent} weight="fill" />
          ) : (
            <EyeSlashIcon size={17} color={subtle} />
          )}
        </IconButton>
      </Tooltip>

      <Box sx={{ flex: 1, minWidth: 8 }} />

      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 0.5,
          px: 0.75,
          height: 26,
          borderRadius: 1,
          bgcolor: searchBg,
          width: compact ? 128 : 196,
          transition: 'width 160ms ease',
        }}
      >
        <MagnifyingGlassIcon size={14} color={subtle} />
        <InputBase
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Escape') onSearchChange('');
          }}
          placeholder={labels.searchPlaceholder}
          spellCheck={false}
          sx={{ flex: 1, fontSize: 12.5, color: isDark ? '#C9D1D9' : '#24292F' }}
        />
        {search && (
          <Tooltip title={labels.clearSearch}>
            <IconButton size="small" onClick={() => onSearchChange('')} sx={{ width: 18, height: 18 }}>
              <XIcon size={11} color={subtle} />
            </IconButton>
          </Tooltip>
        )}
      </Box>

      <Menu
        anchorEl={uploadAnchor}
        open={!!uploadAnchor}
        onClose={() => setUploadAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
      >
        <MenuItem
          dense
          onClick={() => {
            setUploadAnchor(null);
            onUpload('files');
          }}
        >
          <ListItemIcon sx={{ minWidth: 28 }}>
            <FileIcon size={15} color={subtle} />
          </ListItemIcon>
          <ListItemText slotProps={{ primary: { sx: { fontSize: 13 } } }}>{labels.uploadFiles}</ListItemText>
        </MenuItem>
        <MenuItem
          dense
          onClick={() => {
            setUploadAnchor(null);
            onUpload('folder');
          }}
        >
          <ListItemIcon sx={{ minWidth: 28 }}>
            <FolderIcon size={15} color={subtle} />
          </ListItemIcon>
          <ListItemText slotProps={{ primary: { sx: { fontSize: 13 } } }}>{labels.uploadFolder}</ListItemText>
        </MenuItem>
      </Menu>

      <Menu
        anchorEl={downloadAnchor}
        open={!!downloadAnchor}
        onClose={() => setDownloadAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
      >
        <MenuItem
          dense
          onClick={() => {
            setDownloadAnchor(null);
            onDownload(false);
          }}
        >
          <ListItemIcon sx={{ minWidth: 28 }}>
            <DownloadIcon size={15} color={subtle} />
          </ListItemIcon>
          <ListItemText slotProps={{ primary: { sx: { fontSize: 13 } } }}>{labels.download}</ListItemText>
        </MenuItem>
        <MenuItem
          dense
          onClick={() => {
            setDownloadAnchor(null);
            onDownload(true);
          }}
        >
          <ListItemIcon sx={{ minWidth: 28 }}>
            <FolderIcon size={15} color={subtle} />
          </ListItemIcon>
          <ListItemText slotProps={{ primary: { sx: { fontSize: 13 } } }}>{labels.downloadTo}</ListItemText>
        </MenuItem>
      </Menu>
    </Box>
  );
}
