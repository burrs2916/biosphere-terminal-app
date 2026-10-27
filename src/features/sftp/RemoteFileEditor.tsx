import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { useTheme } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';
import { ArrowClockwiseIcon, MagnifyingGlassIcon } from '@phosphor-icons/react';
import CodeMirror from '@uiw/react-codemirror';
import { createTheme } from '@uiw/codemirror-themes';
import { tags as highlightTags } from '@lezer/highlight';
import { EditorState, Prec, type Extension } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import type { ViewUpdate } from '@codemirror/view';
import { indentUnit, StreamLanguage } from '@codemirror/language';
import { search, openSearchPanel } from '@codemirror/search';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { yaml } from '@codemirror/lang-yaml';
import { python } from '@codemirror/lang-python';
import { javascript } from '@codemirror/lang-javascript';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import { toml } from '@codemirror/legacy-modes/mode/toml';
import { properties } from '@codemirror/legacy-modes/mode/properties';
import { dockerFile } from '@codemirror/legacy-modes/mode/dockerfile';

/** Everything the editor needs to round-trip one remote text file. */
export interface RemoteFileEditorState {
  name: string;
  remotePath: string;
  /** Scratch dir the download landed in — reload re-fetches into it. */
  localDir: string;
  /** Local scratch copy; save writes here first, then uploads. */
  localPath: string;
  content: string;
}

/** Monospace stack: Windows lands on Cascadia/Consolas, macOS on SF Mono. */
const EDITOR_FONT =
  "'Cascadia Code', 'JetBrains Mono', Consolas, 'SF Mono', Menlo, 'Courier New', monospace";

/**
 * Full syntax palettes. The built-in `defaultHighlightStyle` (shipped via
 * basicSetup as a *fallback*) was designed for light backgrounds only — on
 * the dark theme comments melted into the body text and .conf files read as
 * one flat color. These two palettes replace it with high-contrast,
 * theme-appropriate colors for every token the config modes emit.
 */
const lightTheme = createTheme({
  theme: 'light',
  settings: {
    background: '#ffffff',
    foreground: '#1F2328',
    caret: '#0969DA',
    selection: '#B6D7FF',
    selectionMatch: '#FFE0A3',
    lineHighlight: '#F6F8FA',
    gutterBackground: '#FFFFFF',
    gutterForeground: '#8C959F',
    fontFamily: EDITOR_FONT,
  },
  styles: [
    { tag: highlightTags.comment, color: '#6E7781', fontStyle: 'italic' },
    { tag: highlightTags.keyword, color: '#CF222E' },
    { tag: highlightTags.string, color: '#0A3069' },
    { tag: highlightTags.number, color: '#0550AE' },
    { tag: highlightTags.atom, color: '#0550AE' },
    { tag: highlightTags.bool, color: '#0550AE' },
    { tag: highlightTags.definition(highlightTags.variableName), color: '#953800' },
    { tag: highlightTags.variableName, color: '#953800' },
    { tag: highlightTags.propertyName, color: '#0550AE' },
    { tag: highlightTags.heading, color: '#8250DF', fontWeight: '600' },
    { tag: highlightTags.tagName, color: '#116329' },
    { tag: highlightTags.link, color: '#0A3069', textDecoration: 'underline' },
    { tag: highlightTags.invalid, color: '#F85149' },
  ],
});

/** Chrome beyond tokens: search panel, match highlight, rhythm and gutters. */
const lightPanelTheme = EditorView.theme({
  '.cm-panels': { backgroundColor: '#F6F8FA', color: '#1F2328', borderBottom: '1px solid #D0D7DE' },
  '.cm-panels.cm-panels-top': { borderTop: 'none' },
  '.cm-searchMatch': { backgroundColor: '#FFF8C5', outline: '1px solid #D4A72C' },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: '#FFD786' },
  '.cm-content': { lineHeight: '1.65', paddingBottom: '12px' },
  '.cm-gutters': { borderRight: '1px solid #EAEEF2' },
  '.cm-activeLineGutter': { backgroundColor: '#F6F8FA' },
});

const darkTheme = createTheme({
  theme: 'dark',
  settings: {
    background: '#282C34',
    foreground: '#ABB2BF',
    caret: '#61AFEF',
    selection: '#3E4451',
    selectionMatch: '#4B5263',
    lineHighlight: '#2C313A',
    gutterBackground: '#282C34',
    gutterForeground: '#636D83',
    fontFamily: EDITOR_FONT,
  },
  styles: [
    { tag: highlightTags.comment, color: '#7F848E', fontStyle: 'italic' },
    { tag: highlightTags.keyword, color: '#C678DD' },
    { tag: highlightTags.string, color: '#98C379' },
    { tag: highlightTags.number, color: '#D19A66' },
    { tag: highlightTags.atom, color: '#D19A66' },
    { tag: highlightTags.bool, color: '#D19A66' },
    { tag: highlightTags.definition(highlightTags.variableName), color: '#E06C75' },
    { tag: highlightTags.variableName, color: '#E06C75' },
    { tag: highlightTags.propertyName, color: '#61AFEF' },
    { tag: highlightTags.heading, color: '#61AFEF', fontWeight: '600' },
    { tag: highlightTags.tagName, color: '#E06C75' },
    { tag: highlightTags.link, color: '#61AFEF', textDecoration: 'underline' },
    { tag: highlightTags.invalid, color: '#F44747' },
  ],
});

const darkPanelTheme = EditorView.theme({
  '.cm-panels': { backgroundColor: '#21252B', color: '#ABB2BF', borderBottom: '1px solid #181A1F' },
  '.cm-panels.cm-panels-top': { borderTop: 'none' },
  '.cm-searchMatch': { backgroundColor: '#5A4A1F', outline: '1px solid #B0853C' },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: '#7A6428' },
  '.cm-content': { lineHeight: '1.65', paddingBottom: '12px' },
  '.cm-gutters': { borderRight: '1px solid #21252B' },
  '.cm-activeLineGutter': { backgroundColor: '#2C313A' },
});

/** Manually picked highlight language; `auto` derives it from the file name. */
type SyntaxId =
  | 'auto'
  | 'plain'
  | 'json'
  | 'markdown'
  | 'yaml'
  | 'python'
  | 'javascript'
  | 'typescript'
  | 'html'
  | 'css'
  | 'shell'
  | 'toml'
  | 'ini';

/** Auto is the default; the rest are human-selectable from the toolbar. */
const SYNTAX_OPTIONS: SyntaxId[] = [
  'auto',
  'plain',
  'json',
  'markdown',
  'yaml',
  'toml',
  'ini',
  'shell',
  'python',
  'javascript',
  'typescript',
  'html',
  'css',
];

const SYNTAX_LABELS: Record<SyntaxId, string> = {
  auto: '', // i18n key `editor_syntax_auto`
  plain: '', // i18n key `editor_syntax_plain`
  json: 'JSON',
  markdown: 'Markdown',
  yaml: 'YAML',
  python: 'Python',
  javascript: 'JavaScript',
  typescript: 'TypeScript',
  html: 'HTML',
  css: 'CSS',
  shell: 'Shell',
  toml: 'TOML',
  ini: 'INI / Properties',
};

function languageById(id: SyntaxId, name: string): Extension[] {
  if (id === 'plain') return [];
  if (id === 'auto') return languageFor(name);
  switch (id) {
    case 'json':
      return [json()];
    case 'markdown':
      return [markdown()];
    case 'yaml':
      return [yaml()];
    case 'python':
      return [python()];
    case 'javascript':
      return [javascript()];
    case 'typescript':
      return [javascript({ typescript: true })];
    case 'html':
      return [html()];
    case 'css':
      return [css()];
    case 'shell':
      return [StreamLanguage.define(shell)];
    case 'toml':
      return [StreamLanguage.define(toml)];
    case 'ini':
      return [StreamLanguage.define(properties)];
    default:
      return [];
  }
}

/** Lowercase extension of `name`, without the dot. */
function extOf(name: string): string {
  const idx = name.lastIndexOf('.');
  return idx > 0 ? name.slice(idx + 1).toLowerCase() : '';
}

/**
 * Map a file name to a CodeMirror language. Plain text (no known extension)
 * just means "no language" — the editor works the same, only highlighting is
 * missing. Files like `nginx.conf`, `Dockerfile`, `.bashrc` all land here or
 * on an explicit branch below.
 */
function languageFor(name: string): Extension[] {
  const nameUpper = name.toUpperCase();
  const ext = extOf(name);
  switch (ext) {
    case 'json':
      return [json()];
    case 'md':
    case 'markdown':
      return [markdown()];
    case 'yml':
    case 'yaml':
      return [yaml()];
    case 'py':
      return [python()];
    case 'js':
    case 'mjs':
    case 'cjs':
    case 'jsx':
      return [javascript()];
    case 'ts':
    case 'mts':
    case 'cts':
    case 'tsx':
      return [javascript({ typescript: true })];
    case 'html':
    case 'htm':
      return [html()];
    case 'css':
    case 'scss':
    case 'less':
      return [css()];
    case 'toml':
      return [StreamLanguage.define(toml)];
    case 'ini':
    case 'cfg':
    case 'conf':
    case 'env':
    case 'properties':
    // systemd unit files (nginx.service, foo.timer, …) are INI format.
    case 'service':
    case 'socket':
    case 'timer':
    case 'mount':
    case 'swap':
    case 'target':
    case 'desktop':
      return [StreamLanguage.define(properties)];
  }
  if (nameUpper === 'DOCKERFILE' || nameUpper.endsWith('.DOCKERFILE')) {
    return [StreamLanguage.define(dockerFile)];
  }
  if (
    ext === 'sh' ||
    ext === 'bash' ||
    ext === 'zsh' ||
    name.startsWith('.') ||
    extOf(name) === ''
  ) {
    // Dotfiles (.bashrc, .profile) are shell scripts far more often than not.
    return [StreamLanguage.define(shell)];
  }
  return [];
}

/**
 * Detect the file's dominant indentation from its first 200 lines, so new
 * lines follow the file's own style instead of a global default. Tab wins
 * when tabs clearly dominate; otherwise the more common of 2/4 spaces.
 */
function detectIndent(content: string): string {
  const lines = content.split('\n', 200);
  let tab = 0;
  let two = 0;
  let four = 0;
  for (const l of lines) {
    const m = /^(\t|( {2})|( {4}))\S/.exec(l);
    if (!m) continue;
    if (m[1] === '\t') tab += 1;
    else if (m[1].length === 2) two += 1;
    else four += 1;
  }
  if (tab > two + four) return '\t';
  if (four > two) return '    ';
  return '  ';
}

interface Props {
  state: RemoteFileEditorState | null;
  saving: boolean;
  reloading: boolean;
  /** Reports the dirty flag up so the hook can guard against file switches. */
  onDirtyChange?: (dirty: boolean) => void;
  /** Re-download the remote file, discarding the local draft. */
  onReload?: () => void;
  onSave: (content: string) => void;
  onClose: () => void;
}

/**
 * In-place editor for one remote text file.
 *
 * The file was already downloaded and verified as UTF-8 by the time this
 * opens; saving writes back through the same scratch file and re-uploads it
 * under its original name. Line endings (CRLF vs LF) are preserved by
 * pinning `EditorState.lineSeparator` when the content uses CRLF — without
 * that CodeMirror normalises to LF and every line would show as modified.
 *
 * Toolbar: language picker, search, line-ending indicator, reload, save.
 * The search panel itself is provided by the explicit `search({ top: true })`
 * extension — @uiw's basicSetup ships only the search keymap, without the
 * panel extension Ctrl+F did nothing. Status bar: cursor, selection, lines,
 * encoding. Ctrl/Cmd+S saves; closing with unsaved edits asks first.
 */
export function RemoteFileEditor({
  state,
  saving,
  reloading,
  onDirtyChange,
  onReload,
  onSave,
  onClose,
}: Props) {
  const { t } = useTranslation('fileTransfer');
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';

  const [draft, setDraft] = useState('');
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [syntax, setSyntax] = useState<SyntaxId>('auto');
  const [cursor, setCursor] = useState({ line: 1, col: 1, sel: 0, lines: 1 });
  /** Live EditorView, needed to open the search panel from the toolbar. */
  const [cmView, setCmView] = useState<EditorView | null>(null);
  /** Latest draft, readable from the Ctrl+S keymap without re-creating it. */
  const draftRef = useRef('');
  draftRef.current = draft;
  /** Same trick for onSave: the keymap is memoized, so it must reach the
   * latest callback through a ref — otherwise a frozen closure sees a stale
   * `saving` flag and a second Ctrl+S during an in-flight save re-enters
   * saveEditedFile while the backend is still reading the scratch file. */
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;

  useEffect(() => {
    setDraft(state?.content ?? '');
    setConfirmDiscard(false);
    setSyntax('auto');
    setCursor({ line: 1, col: 1, sel: 0, lines: 1 });
  }, [state]);

  const dirty = state !== null && draft !== state.content;
  const usesCrlf = (state?.content ?? '').includes('\r\n');

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  const extensions = useMemo(() => {
    const lang = state ? languageById(syntax, state.name) : [];
    const sep: Extension[] = usesCrlf ? [EditorState.lineSeparator.of('\r\n')] : [];
    const indent: Extension[] =
      state && syntax === 'auto' ? [indentUnit.of(detectIndent(state.content))] : [];
    const saveKey = Prec.highest([
      keymap.of([
        {
          key: 'Mod-s',
          preventDefault: true,
          run: () => {
            onSaveRef.current(draftRef.current);
            return true;
          },
        },
      ]),
    ]);
    // `search({ top: true })` is what actually provides the search panel;
    // without it Ctrl+F only had a keymap pointing at nothing.
    const searchPanel: Extension = search({ top: true });
    const palette: Extension[] = isDark
      ? [darkTheme, darkPanelTheme]
      : [lightTheme, lightPanelTheme];
    return [...lang, ...sep, ...indent, searchPanel, ...palette, saveKey];
    // The palette rides on isDark; everything else is determined by the
    // inputs below. onSave/saving reach the keymap through onSaveRef.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.name, state?.content, syntax, usesCrlf, isDark]);

  /** Cheap per-keystroke status: cursor, selection width, total lines. */
  const handleUpdate = useCallback((vu: ViewUpdate) => {
    if (!vu.docChanged && !vu.selectionSet) return;
    const sel = vu.state.selection.main;
    const line = vu.state.doc.lineAt(sel.head);
    setCursor({
      line: line.number,
      col: sel.head - line.from + 1,
      sel: sel.to - sel.from,
      lines: vu.state.doc.lines,
    });
  }, []);

  const openSearch = useCallback(() => {
    if (cmView) openSearchPanel(cmView);
  }, [cmView]);

  const requestClose = useCallback(() => {
    // An in-flight save is reading the scratch file right now — closing the
    // editor would delete it underneath the upload. Wait for it to settle.
    if (saving) return;
    if (dirty) setConfirmDiscard(true);
    else onClose();
  }, [dirty, saving, onClose]);

  if (!state) return null;

  return (
    <>
      <Dialog
        open
        onClose={(_, reason) => {
          if (reason === 'backdropClick' || reason === 'escapeKeyDown') requestClose();
        }}
        fullWidth
        maxWidth="lg"
        slotProps={{
          paper: {
            sx: {
              height: '85vh',
              borderRadius: 2,
              overflow: 'hidden',
            },
          },
        }}
      >
        <DialogTitle
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1.5,
            py: 1.25,
            borderBottom: 1,
            borderColor: 'divider',
          }}
        >
          <Typography
            variant="subtitle1"
            component="span"
            sx={{ fontWeight: 600, flexShrink: 0 }}
          >
            {state.name}
          </Typography>
          <Typography
            variant="caption"
            component="span"
            color="text.secondary"
            noWrap
            sx={{ flex: 1, minWidth: 0 }}
          >
            {state.remotePath}
          </Typography>
          {dirty && (
            <Chip
              size="small"
              variant="outlined"
              color="warning"
              label={t('editor_unsaved')}
              sx={{ height: 20, flexShrink: 0 }}
            />
          )}
        </DialogTitle>

        {/* Toolbar: language, search, line endings, reload, save */}
        <Box
          sx={{
            px: 2,
            py: 1,
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            borderBottom: 1,
            borderColor: 'divider',
            bgcolor: (th) =>
              th.palette.mode === 'dark' ? 'rgba(255,255,255,0.03)' : 'grey.50',
          }}
        >
          <Select
            size="small"
            value={syntax}
            onChange={(e) => setSyntax(e.target.value as SyntaxId)}
            sx={{ fontSize: 13, height: 30, minWidth: 140 }}
          >
            {SYNTAX_OPTIONS.map((id) => (
              <MenuItem key={id} value={id} sx={{ fontSize: 13 }}>
                {id === 'auto'
                  ? t('editor_syntax_auto')
                  : id === 'plain'
                    ? t('editor_syntax_plain')
                    : SYNTAX_LABELS[id]}
              </MenuItem>
            ))}
          </Select>
          <Tooltip title={t('editor_search')}>
            <span>
              <IconButton size="small" onClick={openSearch} aria-label={t('editor_search')}>
                <MagnifyingGlassIcon size={16} />
              </IconButton>
            </span>
          </Tooltip>
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{
              whiteSpace: 'nowrap',
              px: 1,
              height: 22,
              display: 'inline-flex',
              alignItems: 'center',
              borderRadius: 1,
              border: 1,
              borderColor: 'divider',
            }}
          >
            {usesCrlf ? 'CRLF' : 'LF'}
          </Typography>
          <Box sx={{ flex: 1 }} />
          <Tooltip title={t('editor_reload')}>
            <span>
              <IconButton
                size="small"
                onClick={onReload}
                disabled={saving || reloading}
                aria-label={t('editor_reload')}
              >
                {reloading ? (
                  <CircularProgress size={15} color="inherit" />
                ) : (
                  <ArrowClockwiseIcon size={16} />
                )}
              </IconButton>
            </span>
          </Tooltip>
          <Button
            variant="contained"
            size="small"
            onClick={() => onSave(draft)}
            disabled={saving}
            startIcon={saving ? <CircularProgress size={13} color="inherit" /> : undefined}
          >
            {saving ? t('editor_saving') : t('editor_save')}
          </Button>
        </Box>

        <DialogContent sx={{ p: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <Box sx={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
            <CodeMirror
              value={draft}
              onChange={setDraft}
              onUpdate={handleUpdate}
              onCreateEditor={setCmView}
              theme={isDark ? 'dark' : 'light'}
              extensions={extensions}
              height="100%"
              style={{ height: '100%', fontSize: 13 }}
              basicSetup={{
                lineNumbers: true,
                foldGutter: true,
                highlightActiveLine: true,
                autocompletion: false,
              }}
            />
          </Box>
        </DialogContent>

        {/* Status bar: cursor / selection / lines / encoding / line ending */}
        <Box
          sx={{
            px: 2,
            py: 0.5,
            borderTop: 1,
            borderColor: 'divider',
            display: 'flex',
            alignItems: 'center',
            gap: 2.5,
            fontSize: 12,
            color: 'text.secondary',
            bgcolor: (th) =>
              th.palette.mode === 'dark' ? 'rgba(255,255,255,0.03)' : 'grey.50',
            userSelect: 'none',
          }}
        >
          <Box component="span">
            Ln {cursor.line}, Col {cursor.col}
          </Box>
          {cursor.sel > 0 && (
            <Box component="span">{t('editor_selected', { count: cursor.sel })}</Box>
          )}
          <Box component="span">{t('editor_lines', { count: cursor.lines })}</Box>
          <Box component="span">UTF-8</Box>
          <Box component="span">{usesCrlf ? 'CRLF' : 'LF'}</Box>
        </Box>

        <DialogActions sx={{ px: 2, py: 1 }}>
          <Button onClick={requestClose} disabled={saving} size="small">
            {t('editor_close')}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={confirmDiscard}
        onClose={() => setConfirmDiscard(false)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>{t('editor_dirty_title')}</DialogTitle>
        <DialogContent>
          <DialogContentText>{t('editor_dirty_body', { name: state.name })}</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button size="small" onClick={() => setConfirmDiscard(false)}>
            {t('editor_keep_editing')}
          </Button>
          <Button size="small" color="warning" onClick={onClose}>
            {t('editor_discard')}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
