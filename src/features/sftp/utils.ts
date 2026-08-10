import type { SftpEntry } from '../../core/services/sftp.service';

export type SortKey = 'name' | 'size' | 'mtime';
export type SortDir = 'asc' | 'desc';

export type FileKind =
  | 'folder'
  | 'archive'
  | 'image'
  | 'code'
  | 'text'
  | 'pdf'
  | 'audio'
  | 'video'
  | 'binary'
  | 'file';

const EXT_KIND: Record<string, FileKind> = {};
const register = (kind: FileKind, exts: string[]) => {
  exts.forEach((e) => {
    EXT_KIND[e] = kind;
  });
};

register('archive', ['zip', 'tar', 'gz', 'tgz', 'bz2', 'xz', 'rar', '7z', 'zst', 'lz4', 'jar', 'war']);
register('image', ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg', 'ico', 'tif', 'tiff', 'heic']);
register('code', [
  'js', 'ts', 'tsx', 'jsx', 'json', 'py', 'rs', 'go', 'java', 'c', 'h', 'cpp', 'hpp', 'cs',
  'rb', 'php', 'sh', 'bash', 'zsh', 'fish', 'yml', 'yaml', 'toml', 'ini', 'conf', 'cfg',
  'sql', 'html', 'css', 'scss', 'vue', 'swift', 'kt', 'lua', 'pl', 'ps1', 'bat', 'cmd',
]);
register('text', ['txt', 'md', 'log', 'csv', 'tsv', 'rst', 'nfo']);
register('pdf', ['pdf']);
register('audio', ['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a', 'wma']);
register('video', ['mp4', 'mkv', 'mov', 'avi', 'webm', 'flv', 'wmv', 'm4v']);
register('binary', ['bin', 'exe', 'dll', 'so', 'dylib', 'a', 'o', 'deb', 'rpm', 'img', 'iso', 'dmg', 'msi', 'msix']);

/**
 * Whether activating the row should open a directory.
 *
 * Deliberately *not* `is_dir`: a symlink pointing at a folder is a file as far
 * as `lstat` is concerned, yet every file manager lets you walk into it. The
 * split is load-bearing — deletes and recursive walks keep using `is_dir` so
 * they unlink the link instead of emptying whatever it points at.
 */
export function isNavigable(entry: SftpEntry): boolean {
  return entry.is_dir || entry.target_is_dir;
}

export function fileKind(entry: SftpEntry): FileKind {
  if (isNavigable(entry)) return 'folder';
  const dot = entry.name.lastIndexOf('.');
  if (dot <= 0 || dot === entry.name.length - 1) return 'file';
  const ext = entry.name.slice(dot + 1).toLowerCase();
  return EXT_KIND[ext] ?? 'file';
}

export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '-';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB', 'PB'];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v >= 100 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`;
}

export function isHiddenName(name: string): boolean {
  return name.startsWith('.');
}

/**
 * Directories always float to the top, matching every desktop file manager.
 * Symlinked folders float with them — they behave like folders when clicked,
 * so burying them among the files would be inconsistent.
 */
export function sortEntries(entries: SftpEntry[], key: SortKey, dir: SortDir): SftpEntry[] {
  const factor = dir === 'asc' ? 1 : -1;
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  return [...entries].sort((a, b) => {
    const ad = isNavigable(a);
    const bd = isNavigable(b);
    if (ad !== bd) return ad ? -1 : 1;
    switch (key) {
      case 'size':
        if (a.size !== b.size) return (a.size - b.size) * factor;
        return collator.compare(a.name, b.name);
      case 'mtime': {
        const at = a.mtime_ts || 0;
        const bt = b.mtime_ts || 0;
        if (at !== bt) return (at - bt) * factor;
        return collator.compare(a.name, b.name);
      }
      default:
        return collator.compare(a.name, b.name) * factor;
    }
  });
}

/**
 * Win32-OpenSSH drive root, i.e. `/C:/` or `C:/`.
 *
 * The trailing slash carries meaning there: `/C:` selects the *working*
 * directory of drive C, while `/C:/` is the root of the drive. Dropping it
 * silently teleports the user somewhere else.
 */
export function isDriveRoot(p: string): boolean {
  return /^\/?[A-Za-z]:\/$/.test(p);
}

/** Join a remote directory with a child name (POSIX semantics). */
export function joinRemote(base: string, name: string): string {
  if (!base || base === '.') return name;
  if (base === '/') return `/${name}`;
  if (isDriveRoot(base)) return `${base}${name}`;
  return `${base.replace(/\/+$/, '')}/${name}`;
}

/**
 * Join a directory with a child *directory* name.
 *
 * Identical to `joinRemote` except that a Windows drive produced by listing
 * the virtual root — `/` yields `C:`, `D:` … on Win32-OpenSSH — keeps the
 * trailing slash that makes it mean "the root of that drive".
 */
export function childDirPath(base: string, name: string): string {
  const joined = joinRemote(base, name);
  return /^\/?[A-Za-z]:$/.test(joined) ? `${joined}/` : joined;
}

/** Parent of an absolute remote path, or null when already at the top. */
export function parentPath(p: string): string | null {
  if (!p || p === '.' || p === '/') return null;
  // `/C:/` sits directly under the virtual root that lists the drives.
  if (isDriveRoot(p)) return p.startsWith('/') ? '/' : null;
  const trimmed = p.replace(/\/+$/, '');
  const idx = trimmed.lastIndexOf('/');
  if (idx < 0) return null;
  if (idx === 0) return '/';
  const parent = trimmed.slice(0, idx);
  // Going up from `/C:/Users` must land on `/C:/`, never on `/C:`.
  return /^\/?[A-Za-z]:$/.test(parent) ? `${parent}/` : parent;
}

export interface PathSegment {
  label: string;
  path: string;
}

/**
 * Break a remote path into clickable crumbs. Handles POSIX (`/srv/data`) as
 * well as the Windows OpenSSH layout (`/C:/Users/foo`).
 */
export function pathSegments(p: string): PathSegment[] {
  if (!p || p === '.') return [];
  const absolute = p.startsWith('/');
  const parts = p.split('/').filter((s) => s.length > 0);
  const segs: PathSegment[] = [];
  let acc = absolute ? '' : '.';
  for (const part of parts) {
    acc = absolute ? `${acc}/${part}` : joinRemote(acc, part);
    // A drive crumb has to keep its slash, or clicking it lands on the
    // drive-relative working directory instead of the drive root.
    const target = /^\/?[A-Za-z]:$/.test(acc) ? `${acc}/` : acc;
    segs.push({ label: part, path: target });
  }
  return segs;
}

export function basename(p: string): string {
  const cleaned = p.replace(/[\\/]+$/, '');
  const idx = Math.max(cleaned.lastIndexOf('/'), cleaned.lastIndexOf('\\'));
  return idx >= 0 ? cleaned.slice(idx + 1) : cleaned;
}

/** Human readable permission summary, e.g. "rwxr-xr-x → 755". */
export function permsToOctal(perms: string): string {
  const body = perms.slice(1, 10);
  if (body.length < 9) return '';
  let out = '';
  for (let i = 0; i < 9; i += 3) {
    const chunk = body.slice(i, i + 3);
    let v = 0;
    if (chunk[0] === 'r') v += 4;
    if (chunk[1] === 'w') v += 2;
    if (chunk[2] === 'x' || chunk[2] === 's' || chunk[2] === 't') v += 1;
    out += String(v);
  }
  return out;
}

export function newTransferId(): string {
  return `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Read a persisted UI preference, treating blanks as absent. */
export function readPref(key: string): string | null {
  try {
    const v = localStorage.getItem(key);
    return v && v.trim() ? v : null;
  } catch {
    return null;
  }
}

export function writePref(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode / quota — the preference simply does not stick */
  }
}
