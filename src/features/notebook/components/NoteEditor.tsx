import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Box, TextField, Button, Typography, Chip, IconButton, CircularProgress, Tooltip, Menu,
  List, ListItem, ListItemText, ListItemIcon, Select, MenuItem, FormControl, InputLabel,
  Dialog, DialogTitle, DialogContent, DialogActions,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import {
  FloppyDiskIcon, XIcon, LinkIcon, PlusIcon, TagIcon, CheckIcon, CodeIcon, Sparkle, ArrowsClockwiseIcon, FolderOpenIcon, TerminalIcon, WarningCircleIcon, LinkBreakIcon,
} from '@phosphor-icons/react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import Placeholder from '@tiptap/extension-placeholder';
import Highlight from '@tiptap/extension-highlight';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Underline from '@tiptap/extension-underline';
import TextAlign from '@tiptap/extension-text-align';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { TextStyle } from '@tiptap/extension-text-style';
import Color from '@tiptap/extension-color';
import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import CharacterCount from '@tiptap/extension-character-count';
import { Table } from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import Superscript from '@tiptap/extension-superscript';
import Subscript from '@tiptap/extension-subscript';
import { common, createLowlight } from 'lowlight';
import { useNotebookStore } from '../store/notebookStore';
import { IconRenderer } from './IconRenderer';
import { EditorToolbar, type AiMode, AI_MODE_META } from './EditorToolbar';
import { CalloutExtension, LatexExtension, BookmarkExtension } from '../extensions';
import { getNoteAssistantAgentId } from '../../agent/components/NoteAssistantTab';
import { runAgent, createConversation, stopAgent, listAgents } from '../../../core/services/agent.service';
import { listen } from '@tauri-apps/api/event';
import { revealItemInDir } from '@tauri-apps/plugin-opener';
import { AiOptimizeDialog, type AiApplyAction } from './AiOptimizeDialog';
import type { NoteDto } from '../../../proto/notebook';
import { useLicenseStore } from '../../licensing/licenseStore';
import { useUpgradeDialogStore } from '../../licensing/upgradeDialogStore';
import { useTerminalStore } from '../../../engine';
import { writeToTerminal } from '../../../core/services/terminal.service';
import { useNotify } from '../../../core/notification';
import { getNote, unlinkCommandNote } from '../../../core/services/notebook.service';
import { diffLines, diffStats } from '../utils/textDiff';
import { registerNotebookFlush } from '../utils/notebookFlush';
import { sanitizePastedText, applySanitizedPaste } from '../utils/contentSanitizer';
import { localizeBackendError } from '../../../core/backendError';

const lowlight = createLowlight(common);

type AiPromptMode = 'optimize' | 'summarize' | 'generate' | 'tag' | 'continue' | 'translate_en' | 'translate_zh';

/** Build a language-preserving English prompt for the chosen AI note mode. */
export function buildAiPrompt(mode: AiPromptMode, content: string, title: string, category: string): string {
  const header = `Title: ${title || 'Untitled'}`;
  switch (mode) {
    case 'optimize':
      return category === 'command'
        ? `You are optimizing a command note. Return ONLY the optimized Markdown content without any explanation.\n\nIMPORTANT RULES:\n1. Keep the original language of the content.\n2. For commands, provide a complete reference document including:\n   - Brief description of what the command does\n   - Explanation of key flags and options\n   - Common usage examples with code blocks\n   - Related commands or tips if applicable\n3. Preserve the original command in a code block.\n4. Do NOT include metadata like working directory, save time, or exit status.\n5. Do NOT wrap the entire output in code fences.\n\n${header}\n\nContent to optimize:\n${content}`
        : `You are optimizing a note. Return ONLY the optimized Markdown content without any explanation.\n\nIMPORTANT RULES:\n1. Keep the original language of the content.\n2. Fix grammar, improve clarity and structure.\n3. Preserve all Markdown formatting, code blocks, tables, and links.\n4. Do NOT wrap the output in code fences.\n\n${header}\n\nContent to optimize:\n${content}`;
    case 'summarize':
      return `Summarize the following note. Return ONLY the summary in Markdown. Keep the original language of the content. Use bullet points for key points. Be concise. Do NOT wrap the output in code fences.\n\n${header}\n\nContent:\n${content}`;
    case 'generate':
      return `Generate a well-structured note about the topic below. Return ONLY the Markdown content. Keep the original language. Use headings, lists, and code blocks where appropriate. Do NOT wrap the output in code fences.\n\n${header}\n\nExisting draft to expand or improve (may be empty):\n${content || '(empty - create from scratch)'}`;
    case 'tag':
      return `Suggest 3 to 7 relevant tags (keywords) for this note. Return ONLY a plain list, one tag per line, with no numbering, no bullet markers, no explanation, and no markdown formatting. Keep tags in the note's language.\n\n${header}\n\nContent:\n${content}`;
    case 'continue':
      return `Continue writing the note naturally from where it leaves off. Return ONLY the additional Markdown content to append (do NOT repeat existing content). Keep the original language and writing style. Do NOT wrap the output in code fences.\n\n${header}\n\nExisting content:\n${content}`;
    case 'translate_en':
      return `Translate the following note into English. Return ONLY the translated Markdown, preserving all formatting, code blocks, tables, and links. Do NOT wrap the output in code fences.\n\n${header}\n\nContent:\n${content}`;
    case 'translate_zh':
      return `Translate the following note into Simplified Chinese. Return ONLY the translated Markdown, preserving all formatting, code blocks, tables, and links. Do NOT wrap the output in code fences.\n\n${header}\n\nContent:\n${content}`;
  }
}

/** Parse a tag-mode AI response into a clean, deduplicated tag list. */
export function parseTags(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.trim().replace(/^[-*#]\s*/, '').replace(/^\d+[.)]\s*/, '').replace(/^["'`]+|["'`]+$/g, '').trim())
    .filter(Boolean)
    .filter((v, i, arr) => arr.indexOf(v) === i)
    .slice(0, 10);
}

/**
 * 防御性清理：若 AI 返回的 Markdown 误带了 YAML front matter（形如 `---\n...\n---`），
 * 剥掉它、只保留其后正文，避免把 front matter 当笔记正文注入、污染笔记（与 R14 后端
 * notebook_tool 的 strip_leading_front_matter 守卫保持一致，补全交互式 AI 整理路径）。
 * 仅当块看起来像 YAML 映射（含 `key:`）时才剥离，降低误删正文里 markdown 分隔线的概率。
 * 无 front matter 时原样返回，不改变 AI 正常输出。
 */
function stripLeadingFrontMatter(content: string): string {
  const trimmed = content.replace(/^﻿/, '').trimStart();
  if (!trimmed.startsWith('---\n')) return content;
  const close = trimmed.indexOf('\n---');
  if (close === -1) return content;
  const fmBlock = trimmed.slice(4, close);
  if (!fmBlock.includes(':')) return content;
  return trimmed.slice(close + 4).replace(/^\n+/, '');
}

interface NoteEditorProps {
  note: NoteDto | null;
  onClose: () => void;
  onSaved?: (noteId?: string) => void;
  defaultGroupId?: string;
  defaultCategory?: string;
}

export function NoteEditor({ note, onClose, onSaved, defaultGroupId, defaultCategory }: NoteEditorProps) {
  const { t } = useTranslation('notebook');
  const { t: tCommon } = useTranslation('common');
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const primaryColor = isDark ? '#6C63FF' : '#5B54E0';
  const agentColor = isDark ? '#CE93D8' : '#7B1FA2';
  const mutedColor = isDark ? '#8B949E' : '#6B7280';
  const codeBorder = isDark ? 'rgba(48,54,61,0.6)' : 'rgba(0,0,0,0.08)';

  const {
    selectedNote, loadNote, createNote, updateNote, loadLinkedCommands,
    linkedCommands: storeLinkedCommands, groups: storeGroups, activeGroupId,
    categories: storeCategories, loadCategoriesByGroup, createCategory, loadGroups,
    tags: storeTags, loadTagsByGroup, createTag,
  } = useNotebookStore();
  const groups = storeGroups || [];
  const categories = storeCategories || [];
  const linkedCommands = storeLinkedCommands || [];

  const activeSessionId = useTerminalStore((s) => s.activeSessionId);
  const { notify } = useNotify();

  const [title, setTitle] = useState('');
  const [groupId, setGroupId] = useState('');
  const [category, setCategory] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [isNew, setIsNew] = useState(false);
  // 新建笔记首次保存后持有新 id，避免 note prop 未更新时后续保存静默丢失（P0-1）
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [showNewCategoryInput, setShowNewCategoryInput] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [showTagInput, setShowTagInput] = useState(false);
  // 当前分组下的标签库（用于编辑器内复用已有标签）；必须在 groupId/tags 声明后计算
  const tagLibrary = (storeTags || []).filter(
    (tg) => tg.groupId === groupId && !tags.some((t) => t.toLowerCase() === tg.name.toLowerCase()),
  );
  // R27：分类下拉按 sortOrder 升序，确保「默认分类」始终在前、用户新分类按创建顺序往后追加。
  // 同时派生 isUnknownCategory：分组切换后旧分类不在新分组时不再默默清空，而是在 Select 中显示
  // 「未识别：原分类名」灰条，并允许用户一键重置——避免数据丢失的体感（之前是 group 一切换分类就被静默吞）。
  const sortedCategories = useMemo(
    () => [...categories].sort((a, b) => a.sortOrder - b.sortOrder),
    [categories],
  );
  const isUnknownCategory = !!category && !categories.some((c) => c.name === category);
  const [initialContent, setInitialContent] = useState('');
  const [aiOptimizing, setAiOptimizing] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'unsaved'>('saved');
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirtyRef = useRef(false);
  const aiConvIdRef = useRef<string | null>(null);
  const [aiDialogOpen, setAiDialogOpen] = useState(false);
  const [aiChunks, setAiChunks] = useState<string[]>([]);
  const [aiStatus, setAiStatus] = useState<'running' | 'done' | 'error'>('running');
  const [aiError, setAiError] = useState('');
  const [aiMode, setAiMode] = useState<AiMode | null>(null);
  const [aiMenuAnchor, setAiMenuAnchor] = useState<null | HTMLElement>(null);
  const [aiResultJson, setAiResultJson] = useState<unknown | null>(null);
  const [aiSuggestedTags, setAiSuggestedTags] = useState<string[]>([]);
  // D：未保存关闭二次确认弹窗开关。dirty=true 且用户点 X 时打开。
  const [confirmCloseOpen, setConfirmCloseOpen] = useState(false);
  const aiUndoRef = useRef<unknown>(null);
  // 跟踪 AI 生成期间注册的 agent-chunk/done/error 事件订阅，便于在编辑器卸载
  // （切换笔记 / 关窗）时统一退订，避免流式生成中途切走导致 Tauri 事件订阅泄漏、
  // 向已卸载组件 setState 的隐患（R22 健壮性修复）。
  const aiStreamListenersRef = useRef<Array<() => void>>([]);
  // 当"用户有未保存修改"且笔记被 AI/其他视图改动时，给出非阻断提示，避免用户下次保存
  // 静默覆盖 AI 整理成果（此前在 dirty 时直接跳过 reload，竞态下会丢 AI 成果）。
  const [aiRemoteUpdate, setAiRemoteUpdate] = useState(false);
  // AI 差异审阅（R6-3）：用户在编辑态且笔记被 AI 改动时，可打开差异视图对比
  // "本地未保存版本"与"AI 整理后的版本"，再决定采用哪一方。
  const [diffOpen, setDiffOpen] = useState(false);
  const [aiRemoteContent, setAiRemoteContent] = useState<string | null>(null);
  const [localSnapshot, setLocalSnapshot] = useState<string>('');
  const [diffLoading, setDiffLoading] = useState(false);
  // 区分"自己的保存回声"与"外部（AI）更新"：自己保存经后端会回声 notes-changed，
  // 用此 ref 排除，避免误报"笔记已在别处更新"（R5-5）。
  const selfUpdateRef = useRef(false);
  // 记录"当前编辑器已整体载入（正文）的笔记 id"。仅在切换到不同笔记、或显式强制外部重载时
  // 才用 selectedNote.content 整体覆盖编辑器正文；同一笔记的元数据更新（自动保存回声、AI 改动回写）
  // 只会刷新 selectedNote 引用，但其 content 可能是「打开笔记时的旧正文」，绝不能用它覆盖编辑器
  // 当前内容，否则会把用户的中间编辑静默回退、并被下一次自动保存覆盖成旧正文 → 数据丢失。
  const loadedNoteIdRef = useRef<string | null>(null);

  const handleSendLinkedCommand = useCallback(
    (command: string) => {
      if (!activeSessionId) {
        notify(t('ref.no_active_terminal'), 'warning');
        return;
      }
      const bytes = new TextEncoder().encode(command + '\n');
      writeToTerminal(activeSessionId, Array.from(bytes))
        .then(() => notify(t('ref.sent'), 'success'))
        .catch((e) => notify(localizeBackendError(e), 'error'));
    },
    [activeSessionId, notify, t],
  );

  // R6-4：解除某条关联命令（例如原命令已被删除、引用过期时手动清链）。
  // 后端 unlink 会广播 note-links-changed，NoteEditor 已监听该事件自动刷新 linkedCommands。
  const handleUnlinkCommand = useCallback(
    async (linkId: string) => {
      try {
        await unlinkCommandNote(linkId);
        notify(t('notebook.linked_command_unlinked'), 'success');
      } catch (e) {
        notify(localizeBackendError(e), 'error');
      }
    },
    [notify, t],
  );

  useEffect(() => {
    loadGroups();
  }, [loadGroups]);

  useEffect(() => {
    if (note) {
      setIsNew(false);
      setCreatedId(null);
      setAiRemoteUpdate(false);
      setDiffOpen(false);
      setAiRemoteContent(null);
      selfUpdateRef.current = false;
      loadNote(note.id);
      loadLinkedCommands(note.id);
    } else {
      setIsNew(true);
      // 切回"新建"态时必须清掉上一次创建遗留的 createdId：
      // 否则若（任何路径下）编辑器未因 key 重挂载而复用本实例，handleSave 的
      // `if (!currentNoteId && isNew)` 会因 currentNoteId=旧 createdId 而误走 update 分支，
      // 把新笔记覆盖到"上次创建的笔记"上（数据归属错误）。CategoryNotesPage 当前靠
      // onSaved 重选+key 重挂载遮住了该路径，但作为防御必须在此清零（R23）。
      setCreatedId(null);
      setTitle('');
      setInitialContent('');
      const initGroupId = defaultGroupId || activeGroupId || '';
      const initCategory = defaultCategory || '';
      setGroupId(initGroupId);
      setCategory(initCategory);
      setTags([]);
      if (initGroupId) {
        loadCategoriesByGroup(initGroupId);
      }
    }
  }, [note, loadNote, loadLinkedCommands, activeGroupId, loadCategoriesByGroup, defaultGroupId, defaultCategory]);

  useEffect(() => {
    if (selectedNote && !isNew) {
      setTitle(selectedNote.note.title);
      setGroupId(selectedNote.note.groupId);
      setCategory(selectedNote.note.category);
      setTags(selectedNote.note.tags);
      // 仅在「切换到不同笔记」时整体重载编辑器正文，避免用 selectedNote.content（打开笔记时的旧正文）
      // 覆盖编辑器当前内容。同一笔记的自动保存/AI 回写只会刷新 selectedNote 引用、正文不应被回退
      // （否则中间编辑丢失，且会被自动保存覆盖成旧正文 → 数据丢失，R12 fix③ 引入的回归）。
      if (loadedNoteIdRef.current !== selectedNote.note.id) {
        loadedNoteIdRef.current = selectedNote.note.id;
        setInitialContent(selectedNote.content || '');
      }
      if (selectedNote.note.groupId) {
        loadCategoriesByGroup(selectedNote.note.groupId);
      }
    }
  }, [selectedNote, isNew, loadCategoriesByGroup]);

  // 切换分组时加载该分组的标签库，便于在编辑器内复用/新建标签
  useEffect(() => {
    if (groupId) loadTagsByGroup(groupId);
  }, [groupId, loadTagsByGroup]);

  // 关联命令变动时（AI 或命令历史侧链接/解除），实时刷新当前笔记的关联命令面板（P1-5 消费端）
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen<unknown>('note-links-changed', () => {
      const id = note?.id ?? createdId;
      if (id) loadLinkedCommands(id);
    }).then((fn) => { unlisten = fn; });
    return () => { if (unlisten) unlisten(); };
  }, [note, createdId, loadLinkedCommands]);

  // AI 辅助整理通过 notebook 工具直接改笔记后会广播 notes-changed。处理逻辑：
  // - 自己的保存会经后端回声 notes-changed：用 selfUpdateRef 排除，避免误报（R5-5）；
  // - 当前笔记被改动且用户没有未保存编辑：拉取最新正文并刷新编辑器（AI 成果可见）；
  // - 当前笔记被改动但用户正在编辑（dirty）：不再静默跳过，而是弹出非阻断提示，
  //   让用户主动选择"重新加载 AI 版本"或"保留本地"，避免下次保存静默覆盖 AI 成果。
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    // notes-changed 是全局广播（后端 notify_notes_changed 发射空负载、无 noteId），若仅按 dirty 判定，
    // 编辑笔记 A 时笔记 B 被 AI/其他窗口改动也会误判"你的笔记已更新"并弹出丢弃编辑的横幅（假阳性）。
    // 故额外拉取当前笔记服务端 updatedAt，与本地最后一次保存时间戳比较，
    // 仅当"当前笔记确实被更新"才提示/重载（R20 修复：消除跨笔记误报 + 避免对无关改动做冗余重载）。
    listen<unknown>('notes-changed', async () => {
      const id = note?.id ?? createdId;
      if (!id) return;
      if (selfUpdateRef.current) {
        selfUpdateRef.current = false;
        return;
      }
      const localTs = useNotebookStore.getState().selectedNote?.note.updatedAt ?? 0;
      let remoteChanged = false;
      try {
        const remote = await getNote(id);
        if (remote && typeof remote.note.updatedAt === 'number' && remote.note.updatedAt > localTs) {
          remoteChanged = true;
        }
      } catch {
        // 拉取失败：保守地视为"有改动"，避免漏掉真实更新（最坏是多余一次重载）。
        remoteChanged = true;
      }
      if (!remoteChanged) return; // 当前笔记未变（是别的笔记改动），不弹窗、不重载
      if (dirtyRef.current) {
        // 当前笔记确被外部（AI/其他视图）更新且用户有未保存修改：给出提示，不直接覆盖在编内容
        setAiRemoteUpdate(true);
      } else {
        // 当前笔记被更新且用户无未保存修改：整体重载编辑器正文以呈现最新版本。
        // 置空 loadedNoteIdRef 使下方 selectedNote 变化触发的 effect 走「整篇重载」分支（否则
        // same-id 的 selectedNote 变化不会刷新正文，AI 成果不可见）。
        setAiRemoteUpdate(false);
        loadedNoteIdRef.current = null;
        loadNote(id);
      }
    }).then((fn) => { unlisten = fn; });
    return () => { if (unlisten) unlisten(); };
  }, [note, createdId, loadNote]);

  // 用户主动"重新加载 AI/最新版本"：丢弃本地未保存修改，拉取最新正文（R5-5）
  const handleReloadRemote = useCallback(() => {
    const id = note?.id ?? createdId;
    if (!id) return;
    dirtyRef.current = false;
    setAiRemoteUpdate(false);
    // 用户主动「重新加载最新版本」：强制整篇重载（否则 same-id 的 selectedNote 变化不会刷新正文）。
    loadedNoteIdRef.current = null;
    loadNote(id);
  }, [note, createdId, loadNote]);

  // 用户主动"保留本地修改"：关掉 banner，让 dirty 状态保持，下次保存会用本地内容覆盖外部更新（R5-5）。
  // 这是用户明确选择的语义——避免被默认"丢弃"造成误伤。
  const handleDismissRemote = useCallback(() => {
    setAiRemoteUpdate(false);
  }, []);

  // AI 生成期间若编辑器被卸载（切换笔记 / 关窗），退订所有 agent-chunk/done/error
  // 订阅，避免 Tauri 事件订阅泄漏与向已卸载组件 setState（R22 健壮性修复）。
  // 各 handler 仍会在流正常结束时自行退订，此处仅为卸载兜底。
  useEffect(() => {
    return () => {
      aiStreamListenersRef.current.forEach((fn) => {
        try { fn(); } catch { /* 已退订则忽略 */ }
      });
      aiStreamListenersRef.current = [];
    };
  }, []);

  // 打开 AI 差异审阅：抓取"本地未保存版本"（冻结快照）与"AI 整理后的最新版本"，
  // 让用户先看清 AI 改了什么再决定采用哪一方（R6-3）。
  // 注意：local 取自 initialContent（onUpdate 已持续同步为最新 markdown），
  // 避免在 editor 声明前引用它导致 TDZ。
  const handleOpenDiff = useCallback(async () => {
    const id = note?.id ?? createdId;
    if (!id) return;
    const local = initialContent || '';
    setLocalSnapshot(local);
    setDiffLoading(true);
    setDiffOpen(true);
    try {
      const remote = await getNote(id);
      setAiRemoteContent(remote?.content ?? '');
    } catch {
      setAiRemoteContent('');
    } finally {
      setDiffLoading(false);
    }
  }, [note, createdId, initialContent]);

  const diffResult = useMemo(
    () => (aiRemoteContent === null ? null : diffLines(localSnapshot, aiRemoteContent)),
    [aiRemoteContent, localSnapshot],
  );
  const diffStatsResult = useMemo(
    () => (diffResult ? diffStats(diffResult) : null),
    [diffResult],
  );

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        codeBlock: false,
        heading: { levels: [1, 2, 3, 4, 5, 6] },
      }),
      Markdown.configure({
        markedOptions: { gfm: true, breaks: true },
      }),
      Placeholder.configure({
        placeholder: t('editor.content_placeholder') || 'Start writing...',
      }),
      Highlight.configure({ multicolor: true }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Underline,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      CodeBlockLowlight.configure({ lowlight }),
      TextStyle,
      Color,
      Image.configure({ inline: true }),
      Link.configure({
        openOnClick: false,
        autolink: true,
      }),
      CharacterCount,
      Table.configure({ resizable: true }),
      TableRow,
      TableCell,
      TableHeader,
      Superscript,
      Subscript,
      CalloutExtension,
      LatexExtension,
      BookmarkExtension,
    ],
    content: initialContent,
    contentType: 'markdown',
    editorProps: {
      attributes: {
        class: 'note-editor-content',
      },
      // R26：iTerm2 拖拽文件夹到终端时会粘贴进装饰元数据（`++==📁 ...==++` + `🕐 时间戳`），
      // 这些噪声会让笔记正文变得难看。在 Tiptap 接管前先清洗：命中规则则用 insertContentAt
      // 写入清理后文本并 notify 提示「已清理 N 行装饰」；未命中则回退到 Tiptap 默认 paste。
      handlePaste: (_view, event) => {
        const text = event.clipboardData?.getData('text/plain');
        if (!text) return false;
        const result = sanitizePastedText(text);
        if (result.removedLines === 0) return false;
        const ok = applySanitizedPaste(editor, result);
        if (ok && result.removedLines > 0) {
          notify(
            t('editor.paste_cleaned', { count: result.removedLines })
              || `已清理 ${result.removedLines} 行终端装饰（iTerm2 拖拽注释/时间戳）`,
            'success',
          );
        }
        // 阻止 Tiptap 默认 paste 行为，避免双插入
        event.preventDefault();
        return true;
      },
    },
    onUpdate: ({ editor: ed }) => {
      setInitialContent(ed.getMarkdown());
      dirtyRef.current = true;
      setSaveStatus('unsaved');
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = setTimeout(() => {
        handleAutoSave();
      }, 2000);
    },
  });

  // 用 ref 持有最新编辑态，供卸载兜底读取，避免把整个组件状态塞进 effect 依赖导致
  // 每次输入都重建 effect（会误清空自动保存定时器）。
  const latestEditRef = useRef({ note, createdId, title, groupId, category, tags, initialContent });
  latestEditRef.current = { note, createdId, title, groupId, category, tags, initialContent };

  // 现有笔记标题兜底（FIX-N1，R19）：用户清空标题字段时，不应把真实标题覆盖成 i18n
  // 占位符「笔记标题」，而是保留最后一次保存的真实标题。仅当这是「新笔记」且尚未落库
  // （selectedNote 无对应项）时，才回退到占位符（与 R18 新笔记语义一致）。
  // 用 getState() 读取实时 selectedNote，避免被闭包捕获到过期的渲染期值（卸载/关窗 flush
  // 的 effect 依赖不含 selectedNote，直接引用会拿到挂载时的陈旧值）。
  const resolveTitle = (raw: string): string =>
    raw.trim() || useNotebookStore.getState().selectedNote?.note.title || t('notebook.note_title');

  // 编辑器卸载（关闭笔记视图）时，若仍有未落盘的改动，做一次最终保存。
  // 自动保存为 2s 防抖，若在防抖窗口内关窗，最后一段输入会丢失——此处兜底（P3-5/关窗兜底）。
  useEffect(() => {
    return () => {
      if (!dirtyRef.current || !editor) return;
      const { note: n, createdId: cid, title: ti, groupId: gid, category: cat, tags: tg, initialContent: ic } = latestEditRef.current;
      const content = editor.getMarkdown() || ic;
      const currentNoteId = n?.id ?? cid ?? undefined;
      // R25 修复（镜像 R13/R18 在 handleAutoSave/handleSave 的口径）：仅当存在真实笔记 id 才落盘，
      // 不再用 `content.trim()` 校验。否则「清空正文」或「仅改标题/元数据」的现有笔记在 2s 自动保存
      // 窗口内被关闭时，卸载兜底会跳过保存、静默丢弃改动（与 handleAutoSave 的 `if (!currentNoteId) return`
      // 口径一致：新笔记未首次保存时 currentNoteId 为 undefined，本守卫仍可避免写入空笔记）。
      if (currentNoteId) {
        // 卸载兜底：silent=true，组件即将销毁，不显示 categoryReset toast（看起来像幽灵消息）。
        applyUpdate({
          id: currentNoteId,
          title: resolveTitle(ti),
          content,
          groupId: gid || '',
          category: cat,
          tags: tg,
        }, { silent: true }).catch(() => {});
      }
    };
  }, [editor, updateNote, t]);

  // 关窗 flush 注册（R6-1）：把"保存当前编辑态"注册到全局注册表，窗口关闭拦截器
  // 会在真正销毁 webview 前 await 它，确保 2s 防抖窗口内的最后输入不丢失。
  useEffect(() => {
    const unregister = registerNotebookFlush(async () => {
      if (!dirtyRef.current || !editor) return;
      const { note: n, createdId: cid, title: ti, groupId: gid, category: cat, tags: tg, initialContent: ic } =
        latestEditRef.current;
      const content = editor.getMarkdown() || ic;
      const currentNoteId = n?.id ?? cid ?? undefined;
      // R25 修复（同卸载兜底）：仅以 currentNoteId 判定，去掉 content.trim() 校验。
      // 现有笔记即便正文为空（用户清空/仅改元数据）也应在关窗时落盘，与 handleAutoSave 口径一致。
      if (currentNoteId) {
        selfUpdateRef.current = true; // 排除自己的保存回声（R5-5）
        try {
          // 关窗 flush：silent=true，组件即将销毁，toast 不会显示
          await applyUpdate({
            id: currentNoteId,
            title: resolveTitle(ti),
            content,
            groupId: gid || '',
            category: cat,
            tags: tg,
          }, { silent: true });
          dirtyRef.current = false;
        } catch {
          /* 关窗兜底：保存失败不影响退出 */
        }
      }
    });
    return unregister;
  }, [editor, updateNote, t]);

  // 包装 store.updateNote：拿到后端 categoryReset 后立刻 notify 用户。
  // 仅在「主流程保存」（handleAutoSave / handleSave）时启用，卸载兜底 / 关窗 flush
  // 走 fire-and-forget 不显示（组件马上消失，toast 看起来像是"幽灵消息"）。
  const applyUpdate = useCallback(
    async (input: { id: string; title: string; content: string; groupId: string; category: string; tags: string[] }, opts?: { silent?: boolean }) => {
      const result = await updateNote(input);
      if (!opts?.silent && result?.categoryReset) {
        const { from, to, targetGroup } = result.categoryReset;
        // R28 复盘：note.category 在切组后被后端静默重置 → 前端必须把"为什么改了"告诉用户，
        // 否则用户切到新组看到分类下拉里没有原来选的那项会感觉"被吞了"。
        notify(
          t('editor.category_reset_after_group_change', {
            from,
            to,
            group: targetGroup,
          }) || `分类「${from}」在「${targetGroup}」组不存在，已重置为「${to}」`,
          'warning',
        );
      }
      return result;
    },
    [updateNote, notify, t],
  );

  useEffect(() => {
    if (editor && initialContent !== undefined) {
      const currentMd = editor.getMarkdown();
      if (currentMd !== initialContent) {
        const json = editor.markdown?.parse(initialContent);
        if (json) editor.commands.setContent(json);
      }
    }
  }, [editor, initialContent]);

  const handleAutoSave = useCallback(async () => {
    if (!dirtyRef.current) return;
    // 关键：useEditor 的 onUpdate 只在编辑器创建时绑定一次，其闭包内的 handleAutoSave 是「首渲染版本」，
    // 持有首渲染时的 title/groupId/category/tags。若用户改了某个元数据（分组/分类/标签）后又继续打字，
    // 2s 防抖窗口内 onUpdate 触发的仍是那个过期闭包 → 会用旧元数据把刚做的改动覆盖回数据库（静默回退）。
    // 因此这里统一从 latestEditRef.current 读取「实时」状态，保证自动保存永远写入最新值（R17 修复）。
    const edit = latestEditRef.current;
    const content = editor?.getMarkdown() || edit.initialContent;
    const currentNoteId = edit.note?.id ?? edit.createdId ?? undefined;
    if (!currentNoteId) return; // 新建笔记尚未首次保存，等手动保存创建（不自动写空笔记）
    // 已存在笔记即便正文为空也要落盘：否则只改分组/分类/标签等元数据不会持久化（Fix 1/2 的 scheduleMetaSave 场景）。
    setSaveStatus('saving');
    try {
      selfUpdateRef.current = true; // 标记为自己的保存，回声 notes-changed 时排除（R5-5）
      await applyUpdate({
        id: currentNoteId,
        title: resolveTitle(edit.title),
        content,
        groupId: edit.groupId || '',
        category: edit.category,
        tags: edit.tags,
      });
      dirtyRef.current = false;
      setAiRemoteUpdate(false);
      setSaveStatus('saved');
    } catch {
      setSaveStatus('unsaved');
    }
  }, [editor, updateNote, t]);

  const handleSave = useCallback(async () => {
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    const content = editor?.getMarkdown() || initialContent;
    const currentNoteId = note?.id ?? createdId ?? undefined;
    setSaveStatus('saving');
    try {
      if (!currentNoteId && isNew) {
        // R18 修复：不为「纯空白新笔记」创建名为占位符的垃圾笔记 + 触发 AI 自动整理。
        // R13 的 store 守卫 `if (title.trim() || content.trim())` 实际被 handleSave 的
        // `title || t('notebook.note_title')` 兜底绕过——空标题会落为 "笔记标题" 这类非空串，
        // 于是空白笔记仍被创建并唤醒 AI（与 R13 意图相悖）。
        // 仅当用户真正输入了标题或正文才落库；否则保持 isNew 状态，等待用户继续输入。
        if (title.trim() || content.trim()) {
          // R5-5 一致性：把"新建"也标记为自己的保存回声，排除 store.createNote 广播的
          // notes-changed（否则下方监听器无法区分"自己刚创建"与"外部改动"，可能误弹横幅/重载）。
          selfUpdateRef.current = true;
          const result = await createNote({ title: title.trim() || t('notebook.note_title'), content, groupId: groupId || '', category, tags });
          if (result) {
            setCreatedId(result.id ?? null);
            onSaved?.(result.id);
            setIsNew(false);
            dirtyRef.current = false;
            setSaveStatus('saved');
          } else {
            // R23：创建失败时清掉 selfUpdateRef 守卫，否则残留的 true 会吞掉
            // 后续真实外部 notes-changed（AI 改动其他笔记）的提示/重载。
            selfUpdateRef.current = false;
            setSaveStatus('unsaved');
          }
        } else {
          // 无任何有效内容：不创建，仅标记未保存，避免污染库 / 误触发 AI。
          setSaveStatus('unsaved');
        }
      } else if (currentNoteId) {
        selfUpdateRef.current = true; // 标记为自己的保存，回声 notes-changed 时排除（R5-5）
        const result = await applyUpdate({ id: currentNoteId, title: resolveTitle(title), content, groupId: groupId || '', category, tags });
        if (result) {
          onSaved?.(currentNoteId);
          dirtyRef.current = false;
          setAiRemoteUpdate(false);
          setSaveStatus('saved');
        } else {
          // R23：更新失败时清掉 selfUpdateRef 守卫，避免吞掉后续真实的外部改动通知。
          selfUpdateRef.current = false;
          setSaveStatus('unsaved');
        }
      } else {
        setSaveStatus('unsaved');
      }
    } catch {
      setSaveStatus('unsaved');
    }
  }, [isNew, title, groupId, category, tags, note, createdId, createNote, updateNote, onSaved, t, editor, initialContent]);

  // 仅改分组/分类/标签等元数据时（不改正文），正文 onUpdate 不会触发自动保存，
  // 导致这类改动只活在本地 state；若此刻有外部 notes-changed（AI 改了别的笔记、
  // 另一个窗口保存、新建笔记的 auto-trigger 等）到达，编辑器会按"非 dirty"重载并静默回退
  // 这些未落盘的改动（R11 标记的"极窄竞态"）。这里把元数据改动也标记 dirty 并安排一次
  // 防抖自动保存，使其与正文改动同等持久化，且重载保护 banner 会正确弹出而非静默覆盖。
  const scheduleMetaSave = useCallback(() => {
    dirtyRef.current = true;
    setSaveStatus('unsaved');
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(() => {
      handleAutoSave();
    }, 2000);
  }, [handleAutoSave]);

  const handleRemoveTag = (tag: string) => {
    setTags(tags.filter((t) => t !== tag));
    scheduleMetaSave();
  };

  const handleCreateCategory = async () => {
    const name = newCategoryName.trim();
    if (!name || !groupId) return;
    // 客户端去重：避免对后端幂等语义产生依赖（后端会复用既有行），用户也能立刻知道为什么没新增
    if (categories.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
      notify(t('category.duplicate') || `该分组下已存在同名分类「${name}」`, 'warning');
      return;
    }
    const result = await createCategory({ name, groupId, sortOrder: categories.length });
    if (result) {
      setCategory(result.name);
      setNewCategoryName('');
      setShowNewCategoryInput(false);
      // 新建分类并选中的改动需落盘：否则只活在本地 state，外部 notes-changed 重载会静默回退（同 Fix 1）。
      scheduleMetaSave();
      notify(t('category.create_success') || '分类已创建', 'success');
    } else {
      // R23 镜像：创建失败时读取 store.error 并 toast，便于用户定位问题（之前是 silent fail）
      const err = useNotebookStore.getState().error;
      notify(err || t('category.create_failed') || '分类创建失败', 'error');
    }
  };

  const handleNewCategoryKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleCreateCategory();
    } else if (e.key === 'Escape') {
      setShowNewCategoryInput(false);
      setNewCategoryName('');
    }
  };

  // 取消新建分类：保留为独立 handler，便于在按钮、Esc、关闭图标多入口复用
  const cancelCreateCategory = () => {
    setShowNewCategoryInput(false);
    setNewCategoryName('');
  };

  const handleAddTag = async () => {
    const name = tagInput.trim();
    if (!name) {
      cancelCreateTag();
      return;
    }
    // 客户端去重 + 反馈：之前是 silent 清空，用户感受不到「我刚按了键」。
    // B：复盘——既然 store.createTag 走后端幂等（即同名同组不报错），用户更容易在 UI 层就被告知
    // "已存在"，而不是输入后无反应。
    if (tags.includes(name)) {
      notify(t('editor.tag_duplicate', { name }) || `标签「${name}」已存在`, 'warning');
      cancelCreateTag();
      return;
    }
    setTags([...tags, name]);
    setTagInput('');
    setShowTagInput(false);
    scheduleMetaSave();
    // 注册到标签库（仅当在分组内且该标签尚不存在），让其他笔记可复用、且出现在分组管理/筛选中
    if (groupId) {
      const exists = (storeTags || []).some(
        (tg) => tg.groupId === groupId && tg.name.toLowerCase() === name.toLowerCase(),
      );
      if (!exists) {
        try {
          await createTag({ name, groupId, sortOrder: (storeTags || []).length });
          notify(t('editor.tag_create_success', { name }) || `标签「${name}」已创建`, 'success');
        } catch (e) {
          // B：后端失败 → notify，用户不感知是"标签加上了但没注册到库"还是"全部失败"
          // （store.addTag 已经在 setTags 时加到本地，所以正文/筛选仍可用，但库内没这条 → 下次新建时不会出现在 tagLibrary 提示里）。
          notify(
            (useNotebookStore.getState().error || localizeBackendError(e) || t('editor.tag_create_failed') || '标签注册失败'),
            'error',
          );
        }
      }
    }
  };

  const cancelCreateTag = () => {
    setShowTagInput(false);
    setTagInput('');
  };

  const handleTagKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleAddTag();
    } else if (e.key === 'Escape') {
      cancelCreateTag();
    }
  };

  const handleAiAction = useCallback(async (mode: AiMode) => {
    // Pro 功能授权检查：未付费时弹出升级对话框
    const canUseFn = useLicenseStore.getState().canUse;
    if (!canUseFn('note_ai_optimize')) {
      useUpgradeDialogStore.getState().openDialog('note_ai_optimize');
      return;
    }

    const agentId = getNoteAssistantAgentId();
    if (!agentId) {
      setAiStatus('error');
      setAiError(t('editor.ai_no_agent'));
      setAiDialogOpen(true);
      return;
    }

    // 二次校验：绑定智能体必须仍存在且已启用 notebook 工具，避免 localStorage 残留失效 id 导致运行期崩溃
    try {
      const allAgents = await listAgents();
      const boundAgent = allAgents.find((a) => a.id === agentId);
      if (!boundAgent || !boundAgent.toolIds.includes('notebook')) {
        setAiStatus('error');
        setAiError(t('editor.ai_agent_invalid'));
        setAiDialogOpen(true);
        return;
      }
    } catch (e) {
      setAiStatus('error');
      setAiError(localizeBackendError(e));
      setAiDialogOpen(true);
      return;
    }

    const content = editor?.getMarkdown() || initialContent;
    const isEmpty = !content.trim();

    // 生成模式允许空内容（基于标题创作）；其余模式需要内容
    if (isEmpty && mode !== 'generate') {
      setAiStatus('error');
      setAiError(t('editor.ai_no_content'));
      setAiDialogOpen(true);
      return;
    }
    if (mode === 'generate' && !title.trim()) {
      setAiStatus('error');
      setAiError(t('editor.ai_no_content'));
      setAiDialogOpen(true);
      return;
    }

    setAiMode(mode);
    setAiOptimizing(true);
    setAiChunks([]);
    setAiStatus('running');
    setAiError('');
    setAiResultJson(null);
    setAiSuggestedTags([]);
    aiUndoRef.current = null;
    // 新一轮生成前清掉上一轮可能残留的订阅引用（上一轮会随自身完成自然退订，
    // 这里仅避免 ref 无限累积；真正退订仍以各 handler 内的 .then(fn) 为准）。
    aiStreamListenersRef.current = [];
    setAiDialogOpen(true);

    const isTagMode = mode === 'tag';

    try {
      const conv = await createConversation(agentId, `${mode}: ${title || 'Note'}`);
      aiConvIdRef.current = conv.id;

      const unlistenChunk = listen<{ conversationId: string; chunk: string }>('agent-chunk', (event) => {
        if (event.payload.conversationId === aiConvIdRef.current) {
          setAiChunks((prev) => [...prev, event.payload.chunk]);
        }
      });
      unlistenChunk.then((fn) => { aiStreamListenersRef.current.push(fn); });

      const unlistenDone = listen<{ conversationId: string; response: string }>('agent-done', (event) => {
        if (event.payload.conversationId === aiConvIdRef.current) {
          const response = event.payload.response;
          if (!response || response === 'No response') {
            setAiStatus('error');
            setAiError(t('editor.ai_optimize_error') || 'AI operation failed');
            setAiOptimizing(false);
            aiConvIdRef.current = null;
            unlistenDone.then((fn) => fn());
            unlistenChunk.then((fn) => fn());
            return;
          }
          if (isTagMode) {
            setAiSuggestedTags(parseTags(response));
          } else if (editor) {
            // 防御：先剥离 AI 可能误带的 front matter，再解析为正文 JSON，避免污染笔记（见 stripLeadingFrontMatter）
            const cleaned = stripLeadingFrontMatter(response);
            const json = editor.markdown?.parse(cleaned);
            if (json) {
              setAiResultJson(json);
            }
          }
          setAiOptimizing(false);
          setAiStatus('done');
          aiConvIdRef.current = null;
          unlistenDone.then((fn) => fn());
          unlistenChunk.then((fn) => fn());
        }
      });
      unlistenDone.then((fn) => { aiStreamListenersRef.current.push(fn); });

      const unlistenError = listen<{ conversationId: string; error: string }>('agent-error', (event) => {
        if (event.payload.conversationId === aiConvIdRef.current) {
          setAiOptimizing(false);
          setAiStatus('error');
          setAiError(event.payload.error);
          aiConvIdRef.current = null;
          unlistenError.then((fn) => fn());
          unlistenChunk.then((fn) => fn());
        }
      });
      unlistenError.then((fn) => { aiStreamListenersRef.current.push(fn); });

      const prompt = buildAiPrompt(mode, content, title, category);
      await runAgent(agentId, prompt, conv.id, true);
    } catch (e) {
      setAiOptimizing(false);
      setAiStatus('error');
      setAiError(localizeBackendError(e));
      aiConvIdRef.current = null;
    }
  }, [editor, initialContent, title, category, t]);

  const handleAiApply = useCallback((action: AiApplyAction) => {
    if (!editor || !aiResultJson) return;
    // 记录撤销点
    aiUndoRef.current = editor.getJSON();
    if (action === 'replace') {
      editor.commands.setContent(aiResultJson as object);
    } else if (action === 'insert') {
      editor.chain().focus().insertContent(aiResultJson as object).run();
    } else if (action === 'append') {
      const end = editor.state.doc.content.size;
      editor.chain().focus().insertContentAt(end, aiResultJson as object).run();
    }
    const md = editor.getMarkdown() || '';
    setInitialContent(md);
    dirtyRef.current = true;
    setSaveStatus('unsaved');
    // R18 修复：AI 应用后显式安排 2s 防抖自动保存（与 R17 对 AI 标签的处理一致）。
    // 否则 AI 改写的正文只依靠卸载/关窗 flush 落盘——若应用被切到后台而非关闭、
    // 或编辑器未卸载，脏内容不会自动持久化，崩溃即丢失。
    scheduleMetaSave();
    notify(t('editor.ai_optimize_done'), 'success');
  }, [editor, aiResultJson, notify, t, scheduleMetaSave]);

  const handleAiUndo = useCallback(() => {
    if (!editor || aiUndoRef.current == null) return;
    editor.commands.setContent(aiUndoRef.current as object);
    setInitialContent(editor.getMarkdown() || '');
    aiUndoRef.current = null;
    dirtyRef.current = true;
    setSaveStatus('unsaved');
  }, [editor]);

  const handleAddTagFromAi = useCallback((tag: string) => {
    const clean = tag.trim();
    if (!clean) return;
    setTags((prev) => (prev.includes(clean) ? prev : [...prev, clean]));
    // AI 建议标签加入后必须落盘：否则仅活在本地 state，关窗 flush 因 dirtyRef=false 跳过而静默丢失（R17 修复）。
    scheduleMetaSave();
    notify(t('editor.ai_tag_added'), 'success');
  }, [notify, t, scheduleMetaSave]);

  const handleAddAllTags = useCallback(() => {
    setTags((prev) => {
      const merged = [...prev];
      aiSuggestedTags.forEach((tg) => { if (!merged.includes(tg)) merged.push(tg); });
      return merged;
    });
    // AI 建议标签批量加入后必须落盘（同 handleAddTagFromAi，R17 修复）。
    scheduleMetaSave();
    notify(t('editor.ai_tag_added'), 'success');
  }, [aiSuggestedTags, notify, t, scheduleMetaSave]);

  const handleAiCancel = useCallback(async () => {
    if (aiConvIdRef.current) {
      try { await stopAgent(aiConvIdRef.current); } catch (err) { console.error('NoteEditor: operation failed', err); }
      aiConvIdRef.current = null;
    }
    setAiOptimizing(false);
    setAiStatus('error');
    setAiError(t('editor.ai_optimize_cancelled') || 'AI optimization cancelled');
  }, [t]);

  const handleAiDialogClose = useCallback(() => {
    setAiDialogOpen(false);
  }, []);

  const charCount = editor?.storage.characterCount;

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', p: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
        <Typography variant="h6" sx={{ flex: 1, fontSize: 16 }}>
          {isNew ? t('editor.create_title') : t('editor.edit_title')}
        </Typography>
        {/*
          A：常驻保存状态点。10px 灰文字太轻，用户根本注意不到。
          改为「常驻显示三态点 + 文字」：圆点颜色即状态，旋转动画明示在保存中。
          - unsaved：橙点（用户改动未落盘）
          - saving：蓝点 + 旋转图标
          - saved：绿点 + ✓（仅编辑已存在笔记时显示，新建时无意义）
        */}
        <Box
          role="status"
          aria-live="polite"
          data-testid="note-editor-save-status"
          sx={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 0.5,
            px: 0.75,
            py: 0.25,
            borderRadius: 1,
            bgcolor: 'action.hover',
            minWidth: 76,
            justifyContent: 'center',
          }}
        >
          {saveStatus === 'unsaved' && (
            <>
              <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: 'warning.main', boxShadow: '0 0 0 3px rgba(255,167,38,0.18)' }} />
              <Typography variant="caption" sx={{ fontSize: 10, color: 'warning.main', fontWeight: 600 }}>
                {t('editor.unsaved')}
              </Typography>
            </>
          )}
          {saveStatus === 'saving' && (
            <>
              <ArrowsClockwiseIcon size={11} className="spin" style={{ color: 'var(--mui-palette-info-main)' }} />
              <Typography variant="caption" sx={{ fontSize: 10, color: 'info.main', fontWeight: 600 }}>
                {t('editor.saving')}
              </Typography>
            </>
          )}
          {saveStatus === 'saved' && !isNew && (
            <>
              <CheckIcon size={11} style={{ color: 'var(--mui-palette-success-main)' }} />
              <Typography variant="caption" sx={{ fontSize: 10, color: 'success.main', fontWeight: 600 }}>
                {t('editor.saved')}
              </Typography>
            </>
          )}
        </Box>
        {aiRemoteUpdate && (
          <Box
            role="alert"
            sx={{
              flexBasis: '100%',
              mt: 0.5,
              px: 1.25,
              py: 0.75,
              borderRadius: 1,
              border: '1px solid',
              borderColor: 'warning.main',
              bgcolor: (theme) =>
                theme.palette.mode === 'dark' ? 'rgba(255, 167, 38, 0.12)' : 'rgba(255, 167, 38, 0.08)',
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              flexWrap: 'wrap',
            }}
          >
            <Sparkle size={16} weight="duotone" style={{ color: 'var(--mui-palette-warning-main)' }} />
            <Box sx={{ flex: 1, minWidth: 200 }}>
              <Typography variant="body2" sx={{ fontWeight: 600, lineHeight: 1.4 }}>
                {t('editor.ai_remote_update_title')}
              </Typography>
              <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', lineHeight: 1.4 }}>
                {t('editor.ai_remote_update_desc')}
              </Typography>
            </Box>
            <Button
              size="small"
              variant="text"
              onClick={handleOpenDiff}
              sx={{ minWidth: 'auto', whiteSpace: 'nowrap' }}
            >
              {t('editor.ai_remote_update_diff')}
            </Button>
            <Button
              size="small"
              variant="text"
              onClick={handleDismissRemote}
              sx={{ minWidth: 'auto', whiteSpace: 'nowrap' }}
            >
              {t('editor.ai_remote_update_keep')}
            </Button>
            <Button
              size="small"
              variant="contained"
              color="warning"
              onClick={handleReloadRemote}
              sx={{ minWidth: 'auto', whiteSpace: 'nowrap' }}
            >
              {t('editor.ai_remote_update_reload')}
            </Button>
          </Box>
        )}
        <Dialog
          open={diffOpen}
          onClose={() => setDiffOpen(false)}
          maxWidth="md"
          fullWidth
        >
          <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, pb: 1 }}>
            <ArrowsClockwiseIcon size={18} weight="duotone" style={{ color: 'var(--mui-palette-warning-main)' }} />
            <Box sx={{ flex: 1 }}>{t('editor.ai_diff_title')}</Box>
            <IconButton size="small" onClick={() => setDiffOpen(false)} aria-label="close">
              <XIcon size={16} />
            </IconButton>
          </DialogTitle>
          <DialogContent dividers sx={{ p: 0 }}>
            {diffLoading ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', py: 8 }}>
                <CircularProgress size={28} />
              </Box>
            ) : diffResult ? (
              <Box>
                <Box
                  sx={{
                    px: 2,
                    py: 1,
                    borderBottom: '1px solid',
                    borderColor: 'divider',
                    display: 'flex',
                    gap: 2,
                    flexWrap: 'wrap',
                    alignItems: 'center',
                  }}
                >
                  <Typography variant="caption" sx={{ color: 'success.main', fontWeight: 600 }}>
                    +{diffStatsResult?.added} {t('editor.ai_diff_added')}
                  </Typography>
                  <Typography variant="caption" sx={{ color: 'error.main', fontWeight: 600 }}>
                    -{diffStatsResult?.removed} {t('editor.ai_diff_removed')}
                  </Typography>
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                    {t('editor.ai_diff_hint')}
                  </Typography>
                </Box>
                <Box
                  sx={{
                    maxHeight: '52vh',
                    overflow: 'auto',
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                    fontSize: 12.5,
                    lineHeight: 1.6,
                    bgcolor: (theme) => (theme.palette.mode === 'dark' ? '#0d1117' : '#fbfbfd'),
                  }}
                >
                  {diffResult.map((ln, idx) => {
                    const bg =
                      ln.type === 'add'
                        ? isDark
                          ? 'rgba(46,160,67,0.20)'
                          : 'rgba(46,160,67,0.12)'
                        : ln.type === 'del'
                          ? isDark
                            ? 'rgba(248,81,73,0.20)'
                            : 'rgba(248,81,73,0.12)'
                          : 'transparent';
                    const sign = ln.type === 'add' ? '+' : ln.type === 'del' ? '-' : ' ';
                    const color =
                      ln.type === 'add' ? 'success.main' : ln.type === 'del' ? 'error.main' : 'text.primary';
                    return (
                      <Box
                        key={idx}
                        sx={{
                          display: 'flex',
                          bgcolor: bg,
                          whiteSpace: 'pre-wrap',
                          px: 1,
                          borderLeft: '3px solid',
                          borderColor:
                            ln.type === 'add'
                              ? 'success.main'
                              : ln.type === 'del'
                                ? 'error.main'
                                : 'transparent',
                        }}
                      >
                        <Box
                          component="span"
                          sx={{
                            width: 18,
                            flexShrink: 0,
                            color: 'text.secondary',
                            userSelect: 'none',
                            textAlign: 'center',
                          }}
                        >
                          {sign}
                        </Box>
                        <Box component="span" sx={{ color, flex: 1, minWidth: 0 }}>
                          {ln.text.length ? ln.text : ' '}
                        </Box>
                      </Box>
                    );
                  })}
                </Box>
              </Box>
            ) : (
              <Box sx={{ py: 8, textAlign: 'center' }}>
                <Typography variant="body2" color="text.secondary">
                  {t('editor.ai_diff_empty')}
                </Typography>
              </Box>
            )}
          </DialogContent>
          <DialogActions sx={{ px: 2, py: 1.25 }}>
            <Button onClick={() => { setDiffOpen(false); handleDismissRemote(); }}>
              {t('editor.ai_remote_update_keep')}
            </Button>
            <Button
              variant="contained"
              color="warning"
              onClick={() => { setDiffOpen(false); handleReloadRemote(); }}
            >
              {t('editor.ai_remote_update_reload')}
            </Button>
          </DialogActions>
        </Dialog>
        <Button
          variant="contained"
          size="small"
          startIcon={saveStatus === 'saving' ? <CircularProgress size={14} sx={{ color: '#fff' }} /> : <FloppyDiskIcon size={14} weight="bold" />}
          onClick={handleSave}
          disabled={saveStatus === 'saving'}
          sx={{
            background: `linear-gradient(135deg, ${primaryColor} 0%, ${isDark ? '#8B83FF' : '#7B75FF'} 100%)`,
            borderRadius: 2,
          }}
        >
          {tCommon('action.save')}
        </Button>
        {!isNew && selectedNote?.note.filePath && (
          <Tooltip title={t('editor.open_folder')} arrow>
            <IconButton
              size="small"
              onClick={() => {
                try { revealItemInDir(selectedNote!.note.filePath); } catch (err) { console.error('NoteEditor: operation failed', err); }
              }}
              sx={{
                borderRadius: 2,
                border: '1px solid rgba(144,202,249,0.3)',
                bgcolor: 'rgba(144,202,249,0.06)',
                '&:hover': { bgcolor: 'rgba(144,202,249,0.15)', borderColor: 'rgba(144,202,249,0.5)' },
              }}
            >
              <FolderOpenIcon size={16} color={isDark ? '#90CAF9' : '#1976d2'} />
            </IconButton>
          </Tooltip>
        )}
        <Tooltip title={aiOptimizing ? t('editor.ai_cancel') : t('editor.ai_optimize')} arrow>
          <span>
            <IconButton
              size="small"
              onClick={(e) => (aiOptimizing ? handleAiCancel() : setAiMenuAnchor(e.currentTarget))}
              sx={{
                borderRadius: 2,
                border: aiOptimizing ? '1px solid rgba(255,82,82,0.3)' : '1px solid rgba(206,147,216,0.3)',
                bgcolor: aiOptimizing ? 'rgba(255,82,82,0.06)' : 'rgba(206,147,216,0.06)',
                '&:hover': aiOptimizing
                  ? { bgcolor: 'rgba(255,82,82,0.15)', borderColor: 'rgba(255,82,82,0.5)' }
                  : { bgcolor: 'rgba(206,147,216,0.15)', borderColor: 'rgba(206,147,216,0.5)' },
              }}
            >
              {aiOptimizing ? (
                <XIcon size={16} color="#FF5252" />
              ) : (
                <Sparkle size={16} weight="fill" color={agentColor} />
              )}
            </IconButton>
          </span>
        </Tooltip>
        <Menu
          anchorEl={aiMenuAnchor}
          open={Boolean(aiMenuAnchor)}
          onClose={() => setAiMenuAnchor(null)}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
          transformOrigin={{ vertical: 'top', horizontal: 'right' }}
          slotProps={{ paper: { sx: { minWidth: 180, borderRadius: 2, mt: 0.5 } } }}
        >
          {(Object.keys(AI_MODE_META) as AiMode[]).map((mode) => (
            <MenuItem
              key={mode}
              selected={aiMode === mode}
              onClick={() => { setAiMenuAnchor(null); handleAiAction(mode); }}
              sx={{ fontSize: 13, gap: 1 }}
            >
              <ListItemIcon sx={{ minWidth: 22, color: agentColor }}>
                {AI_MODE_META[mode].icon}
              </ListItemIcon>
              {t(`editor.ai_modes.${mode}`)}
            </MenuItem>
          ))}
        </Menu>
        <IconButton
          size="small"
          onClick={() => {
            // D：dirty 检查 → 二次确认弹窗
            // - saveStatus === 'saving'：正在落盘，阻止关闭（避免 abort in-flight IPC）
            // - saveStatus === 'unsaved' 或 dirtyRef.current：弹确认
            // - 否则直接关
            if (saveStatus === 'saving') {
              notify(t('editor.close_blocked_saving') || '正在保存，请稍候…', 'warning');
              return;
            }
            if (saveStatus === 'unsaved' || dirtyRef.current) {
              setConfirmCloseOpen(true);
              return;
            }
            onClose();
          }}
          aria-label={tCommon('action.close') || 'Close'}
        >
          <XIcon size={18} />
        </IconButton>
      </Box>

      <TextField
        fullWidth
        size="small"
        label={
          // I：MUI 自带 required * 在深色主题对比度差且不能本地化，手动渲染红色 *
          <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.25 }}>
            <Box component="span" sx={{ color: 'error.main', fontWeight: 700 }}>*</Box>
            <span>{t('editor.title_label')}</span>
          </Box>
        }
        required
        placeholder={t('editor.title_placeholder') || '给这条笔记起个名字'}
        value={title}
        onChange={(e) => { setTitle(e.target.value); scheduleMetaSave(); }}
        // 禁用 MUI 原生 required *（避免双星号）：MUI v6 改用 slotProps.label
        slotProps={{ inputLabel: { required: false } }}
        sx={{ mb: 1.5, '& .MuiOutlinedInput-root': { borderRadius: 2 } }}
      />

      {isNew && defaultGroupId ? (
        <Box sx={{ display: 'flex', gap: 1, mb: 1.5, alignItems: 'center' }}>
          <Chip
            icon={<IconRenderer value={groups.find((g) => g.id === defaultGroupId)?.icon || ''} size={14} />}
            label={groups.find((g) => g.id === defaultGroupId)?.name || t('group.uncategorized')}
            size="small"
            sx={{ borderRadius: 2, bgcolor: `${primaryColor}18`, color: primaryColor, fontWeight: 600 }}
          />
          {defaultCategory && (
            <Chip
              icon={<TagIcon size={12} />}
              label={defaultCategory}
              size="small"
              sx={{ borderRadius: 2, bgcolor: 'rgba(129,199,132,0.1)', color: '#81C784', fontWeight: 600 }}
            />
          )}
        </Box>
      ) : (
      <Box sx={{ display: 'flex', gap: 1, mb: 1.5, flexWrap: 'wrap', alignItems: 'center' }}>
        <FormControl size="small" sx={{ flex: '1 1 140px', minWidth: 140 }}>
          <InputLabel>{t('editor.group_label')}</InputLabel>
          <Select
            value={groupId}
            label={t('editor.group_label')}
            onChange={(e) => {
              const newGroupId = e.target.value;
              setGroupId(newGroupId);
              // R27：不再默默 setCategory('') 清空旧分类。保留 category 不变，让新分区的分类加载完后
              // 通过 isUnknownCategory 派生值自动呈现「未识别：原分类名」灰条 + 一键重置按钮，
              // 避免分组切换直接吞掉用户辛苦选好的分类。新分类匹配上时自动恢复正常显示。
              setShowNewCategoryInput(false);
              setNewCategoryName('');
              // B：切组时也清空 tag 输入框 + 关闭 tag 输入框（tag 库随 useEffect 重新加载，
              // 但输入框残留的旧组 tag 名会让用户提交时报"已存在"或脏数据）。
              setShowTagInput(false);
              setTagInput('');
              scheduleMetaSave();
              if (newGroupId) {
                loadCategoriesByGroup(newGroupId);
              }
            }}
            sx={{ borderRadius: 2 }}
          >
            <MenuItem value="">
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <IconRenderer value="" size={14} /> {t('group.uncategorized')}
              </Box>
            </MenuItem>
            {groups.map((g) => (
              <MenuItem key={g.id} value={g.id}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <IconRenderer value={g.icon} size={14} /> {g.name}
                </Box>
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ flex: '1 1 140px', minWidth: 140 }} disabled={!groupId}>
          <InputLabel>{t('editor.category_label')}</InputLabel>
          <Select
            value={category}
            label={t('editor.category_label')}
            onChange={(e) => { setCategory(e.target.value); scheduleMetaSave(); }}
            sx={{ borderRadius: 2 }}
            renderValue={(selected) => (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0, flex: 1 }}>
                {selected ? (
                  // R27：当前分类不属于新分组 → 显示「未识别」灰条 + 警告色 + 一键重置按钮，
                  // 替代之前默默 setCategory('') 让数据丢失的体感
                  isUnknownCategory ? (
                    <>
                      <WarningCircleIcon size={12} color="#FF8A80" />
                      <Typography
                        variant="body2"
                        sx={{ color: 'warning.main', fontStyle: 'italic', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}
                        noWrap
                      >
                        {t('editor.category_unknown', { name: selected }) || `未识别：${selected}`}
                      </Typography>
                      <Tooltip title={tCommon('action.cancel') || ''}>
                        <IconButton
                          size="small"
                          onClick={(e) => { e.stopPropagation(); setCategory(''); scheduleMetaSave(); }}
                          sx={{ p: 0.25 }}
                        >
                          <XIcon size={12} color="#FF8A80" />
                        </IconButton>
                      </Tooltip>
                    </>
                  ) : (
                    <>
                      <TagIcon size={12} />
                      <Typography variant="body2" noWrap>{selected}</Typography>
                    </>
                  )
                ) : (
                  <Typography variant="body2" color="text.secondary">{t('category.uncategorized')}</Typography>
                )}
              </Box>
            )}
          >
            <MenuItem value="">
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, color: 'text.secondary', flex: 1 }}>
                <TagIcon size={14} /> {t('category.uncategorized')}
              </Box>
              {!category && <CheckIcon size={14} color={primaryColor} />}
            </MenuItem>
            {sortedCategories.map((cat) => (
              <MenuItem key={cat.id} value={cat.name}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flex: 1 }}>
                  <TagIcon size={14} color={cat.isDefault ? primaryColor : mutedColor} />
                  <Typography variant="body2">{cat.name}</Typography>
                  {cat.isDefault && (
                    <Chip label={t('category.default_badge')} size="small" sx={{ height: 16, fontSize: 10, ml: 'auto' }} />
                  )}
                </Box>
                {category === cat.name && <CheckIcon size={14} color={primaryColor} />}
              </MenuItem>
            ))}
            {isUnknownCategory ? (
              <MenuItem value={category} sx={{ opacity: 0.7 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flex: 1 }}>
                  <WarningCircleIcon size={14} color="#FF8A80" />
                  <Typography variant="body2" sx={{ fontStyle: 'italic' }}>
                    {t('editor.category_unknown', { name: category }) || `未识别：${category}`}
                  </Typography>
                </Box>
              </MenuItem>
            ) : null}
          </Select>
        </FormControl>
        {groupId && (showNewCategoryInput ? (
          <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center', flex: '1 1 220px', minWidth: 220 }}>
            <TextField
              size="small"
              placeholder={t('category.new_name') || ''}
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
              onKeyDown={handleNewCategoryKeyDown}
              autoFocus
              sx={{ flex: 1, '& .MuiOutlinedInput-root': { borderRadius: 2 } }}
            />
            <Tooltip title={tCommon('action.create')}>
              <IconButton size="small" onClick={handleCreateCategory} disabled={!newCategoryName.trim()}>
                <PlusIcon size={16} color={newCategoryName.trim() ? primaryColor : mutedColor} />
              </IconButton>
            </Tooltip>
            <Tooltip title={tCommon('action.cancel')}>
              <IconButton size="small" onClick={cancelCreateCategory}>
                <XIcon size={16} color={mutedColor} />
              </IconButton>
            </Tooltip>
          </Box>
        ) : (
          // 独立"添加分类"按钮：把原来埋在分类下拉框最底部的 __add_category__ MenuItem 提到此处，
          // 入口显眼，与下方"+ 添加标签"按钮、GroupManageDialog 中"添加分类"按钮保持一致 UX。
          // 用户再也不用记着「去分类下拉框底部翻 separator 才能新建」。
          <Button
            size="small"
            startIcon={<PlusIcon size={14} />}
            onClick={() => { setShowNewCategoryInput(true); setNewCategoryName(''); }}
            sx={{
              flexShrink: 0,
              fontSize: 12,
              textTransform: 'none',
              color: primaryColor,
              border: '1px dashed',
              borderColor: `${primaryColor}55`,
              borderRadius: 2,
              px: 1.25,
              '&:hover': { borderColor: primaryColor, bgcolor: `${primaryColor}08` },
            }}
          >
            {t('category.add')}
          </Button>
        ))}
      </Box>
      )}

      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 1.5, alignItems: 'center' }}>
        {tags.map((tag) => (
          <Chip
            key={tag}
            label={tag}
            size="small"
            onDelete={() => handleRemoveTag(tag)}
            sx={{ borderRadius: 1.5 }}
          />
        ))}
        {showTagInput ? (
          <Box sx={{ width: '100%' }}>
            {tagLibrary.length > 0 && (
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 0.75, alignItems: 'center' }}>
                <Typography
                  variant="caption"
                  sx={{ color: 'text.secondary', fontSize: 10, mr: 0.5, userSelect: 'none' }}
                >
                  {t('editor.tag_library_hint') || '从库中选取'}
                </Typography>
                {tagLibrary.map((tg) => {
                  const added = tags.includes(tg.name);
                  return (
                    <Chip
                      key={tg.id}
                      label={added ? tg.name : `+ ${tg.name}`}
                      size="small"
                      icon={<TagIcon size={12} />}
                      clickable
                      disabled={added}
                      onClick={() => {
                        if (added) return;
                        setTags([...tags, tg.name]);
                        scheduleMetaSave();
                      }}
                      // R30-J：库内 chip 与已选 chip 视觉严格区分。
                      //  - 已选：实色填充 + 不可点（防重复加）+ 删除 × 在外层 chips 那里
                      //  - 未选：虚线边框 + 「+」前缀 + 透明背景，提示"点了会添加"
                      sx={{
                        borderRadius: 1.5,
                        fontSize: 11,
                        cursor: added ? 'default' : 'pointer',
                        ...(added
                          ? {
                              bgcolor: `${primaryColor}22`,
                              color: primaryColor,
                              fontWeight: 600,
                              opacity: 0.85,
                            }
                          : {
                              bgcolor: 'transparent',
                              color: 'text.secondary',
                              border: '1px dashed',
                              borderColor: 'divider',
                              '&:hover': {
                                borderColor: primaryColor,
                                color: primaryColor,
                                bgcolor: `${primaryColor}08`,
                              },
                            }),
                      }}
                    />
                  );
                })}
              </Box>
            )}
            <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
              <TextField
                size="small"
                placeholder={t('editor.add_tag_hint') || ''}
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={handleTagKeyDown}
                autoFocus
                sx={{ width: 120, '& .MuiOutlinedInput-root': { borderRadius: 2 } }}
              />
              <IconButton size="small" onClick={handleAddTag} disabled={!tagInput.trim()}>
                <CheckIcon size={14} color={tagInput.trim() ? primaryColor : mutedColor} />
              </IconButton>
              <IconButton size="small" onClick={cancelCreateTag}>
                <XIcon size={14} color={mutedColor} />
              </IconButton>
            </Box>
          </Box>
        ) : (
          // B：与「+ 添加分类」按钮风格一致：虚线边框 + 主色 hover，让"创建入口"视觉可识别
          <Button
            size="small"
            startIcon={<PlusIcon size={12} />}
            onClick={() => setShowTagInput(true)}
            sx={{
              fontSize: 11,
              textTransform: 'none',
              color: primaryColor,
              border: '1px dashed',
              borderColor: `${primaryColor}55`,
              borderRadius: 2,
              minWidth: 'auto',
              px: 1.25,
              py: 0.25,
              '&:hover': { borderColor: primaryColor, bgcolor: `${primaryColor}08` },
            }}
          >
            {t('editor.add_tag')}
          </Button>
        )}
      </Box>

      <Box
        sx={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          borderRadius: 2,
          overflow: 'auto',
          border: '1px solid',
          borderColor: 'divider',
          '& .ProseMirror': {
            flex: 1,
            outline: 'none',
            px: 2.5,
            py: 2,
            minHeight: 0,
            color: isDark ? '#E6EDF3' : '#1A1A2E',
            fontSize: 14,
            lineHeight: 1.7,
            // Tiptap Placeholder 经典写法：':first-of-type' 替代 ':first-child'，避免 Emotion
            // 在 SSR 时报「pseudo class :first-child potentially unsafe」。Tiptap 结构是
            // `<div class="ProseMirror"><p></p><p></p>...</div>`，第一个 <p> 等价于「第一个 <p> 类型子元素」，
            // 行为不变。
            '& p.is-editor-empty:first-of-type::before': {
              content: 'attr(data-placeholder)',
              float: 'left',
              color: isDark ? '#484F58' : '#9E9E9E',
              pointerEvents: 'none',
              height: 0,
            },
            '& h1': { fontSize: '1.75rem', fontWeight: 700, mt: 2, mb: 1, color: isDark ? '#F0F6FC' : '#1A1A2E' },
            '& h2': { fontSize: '1.5rem', fontWeight: 700, mt: 1.75, mb: 0.75, color: isDark ? '#F0F6FC' : '#1A1A2E' },
            '& h3': { fontSize: '1.25rem', fontWeight: 600, mt: 1.5, mb: 0.5, color: isDark ? '#F0F6FC' : '#1A1A2E' },
            '& h4': { fontSize: '1.1rem', fontWeight: 600, mt: 1.25, mb: 0.5, color: isDark ? '#F0F6FC' : '#1A1A2E' },
            '& h5': { fontSize: '1rem', fontWeight: 600, mt: 1, mb: 0.5 },
            '& h6': { fontSize: '0.875rem', fontWeight: 600, mt: 1, mb: 0.5, color: mutedColor },
            '& p': { mb: 1 },
            '& ul, & ol': { pl: 2.5, mb: 1 },
            '& li': { mb: 0.25 },
            '& blockquote': {
              borderLeft: `3px solid ${primaryColor}`,
              pl: 2, py: 0.5, my: 1.5,
              bgcolor: `${primaryColor}10`,
              borderRadius: '0 4px 4px 0',
                color: mutedColor,
            },
            '& code': {
              bgcolor: isDark ? 'rgba(110,118,129,0.2)' : 'rgba(108,99,255,0.1)',
              color: isDark ? '#E6EDF3' : '#5B54E0',
              px: 0.5,
              py: 0.15,
              borderRadius: 0.5,
              fontSize: '0.875em',
              fontFamily: 'monospace',
            },
            '& pre': {
              bgcolor: isDark ? 'rgba(22,27,34,0.8)' : 'rgba(0,0,0,0.04)',
              border: `1px solid ${codeBorder}`,
              borderRadius: 1.5,
              p: 2,
              my: 1.5,
              overflow: 'auto',
              '& code': {
                bgcolor: 'transparent',
                color: 'inherit',
                px: 0,
                py: 0,
                fontSize: '0.875em',
              },
            },
            '& table': {
              borderCollapse: 'collapse',
              width: '100%',
              my: 1.5,
              '& td, & th': {
                border: `1px solid ${codeBorder}`,
                px: 1.5,
                py: 0.75,
                textAlign: 'left',
              },
              '& th': {
                bgcolor: isDark ? 'rgba(22,27,34,0.6)' : 'rgba(108,99,255,0.06)',
                fontWeight: 600,
              },
            },
            '& hr': {
              border: 'none',
              borderTop: `1px solid ${codeBorder}`,
              my: 2,
            },
            '& a': {
              color: primaryColor,
              textDecoration: 'underline',
              '&:hover': { color: isDark ? '#8B83FF' : '#7B75FF' },
            },
            '& img': {
              maxWidth: '100%',
              borderRadius: 1,
              my: 1,
            },
            '& mark': {
              bgcolor: `${primaryColor}40`,
              color: 'inherit',
              borderRadius: 0.25,
              px: 0.25,
            },
            '& ul[data-type="taskList"]': {
              listStyle: 'none',
              pl: 0,
              '& li': {
                display: 'flex',
                alignItems: 'flex-start',
                gap: 0.5,
                '& label': {
                  mt: 0.25,
                },
              },
            },
            '& div[data-callout]': {
              '& [data-callout-content] p': { mb: 0.5 },
              '& [data-callout-content] p:last-child': { mb: 0 },
            },
            '& div[data-latex]': {
              '& .katex': { fontSize: '1.1em' },
              '& .katex-display': { margin: '0 !important' },
            },
            '& div[data-bookmark]': {
              '&:hover': { borderColor: `${primaryColor} !important` },
            },
          },
        }}
      >
        <EditorToolbar
          editor={editor}
          onAiAction={handleAiAction}
          aiOptimizing={aiOptimizing}
          aiMode={aiMode}
        />
        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'auto', minHeight: 0 }}>
          <EditorContent editor={editor} />
        </Box>
        {charCount && (
          <Box sx={{ px: 2, py: 0.5, borderTop: '1px solid', borderColor: 'divider', display: 'flex', justifyContent: 'flex-end' }}>
            <Typography variant="caption" color="text.secondary">
              {charCount.characters()} chars · {charCount.words()} words
            </Typography>
          </Box>
        )}
      </Box>

      {linkedCommands.length > 0 && (
        <Box sx={{ mt: 2 }}>
          <Typography variant="subtitle2" sx={{ mb: 0.5, display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <LinkIcon size={14} color={primaryColor} /> {t('notebook.linked_commands')}
          </Typography>
          <List dense sx={{ maxHeight: 150, overflow: 'auto', border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
            {linkedCommands.map((link) => {
              const deleted = !link.commandExists;
              return (
                <ListItem
                  key={link.id}
                  sx={{ borderRadius: 1, ...(deleted ? { bgcolor: 'rgba(255,82,82,0.06)' } : {}) }}
                  secondaryAction={
                    <Box sx={{ display: 'flex', alignItems: 'center' }}>
                      {!deleted && (
                        <Tooltip title={activeSessionId ? t('ref.execute') : t('ref.no_active_terminal')}>
                          <span>
                            <IconButton
                              size="small"
                              edge="end"
                              disabled={!activeSessionId}
                              onClick={() => handleSendLinkedCommand(link.context)}
                            >
                              <TerminalIcon size={15} color={activeSessionId ? primaryColor : mutedColor} />
                            </IconButton>
                          </span>
                        </Tooltip>
                      )}
                      <Tooltip title={t('notebook.unlink_command')}>
                        <IconButton
                          size="small"
                          edge="end"
                          onClick={() => handleUnlinkCommand(link.id)}
                        >
                          <LinkBreakIcon size={15} color="#FFA726" />
                        </IconButton>
                      </Tooltip>
                    </Box>
                  }
                >
                  <ListItemIcon sx={{ minWidth: 28 }}>
                    {deleted ? (
                      <WarningCircleIcon size={14} color="#FF5252" weight="fill" />
                    ) : (
                      <CodeIcon size={14} color={mutedColor} />
                    )}
                  </ListItemIcon>
                  <ListItemText
                    primary={
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <span
                          style={{
                            fontFamily: 'monospace',
                            fontSize: 13,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            ...(deleted ? { textDecoration: 'line-through', opacity: 0.6 } : {}),
                          }}
                        >
                          {link.context}
                        </span>
                        {deleted && (
                          <Chip
                            label={t('notebook.linked_command_deleted')}
                            size="small"
                            color="error"
                            variant="outlined"
                            sx={{ height: 16, fontSize: '0.6rem', flexShrink: 0 }}
                          />
                        )}
                      </Box>
                    }
                  />
                </ListItem>
              );
            })}
          </List>
        </Box>
      )}
      <AiOptimizeDialog
        open={aiDialogOpen}
        onClose={handleAiDialogClose}
        onCancel={handleAiCancel}
        chunks={aiChunks}
        status={aiStatus}
        errorMessage={aiError}
        mode={aiMode}
        resultJson={aiResultJson}
        suggestedTags={aiSuggestedTags}
        canUndo={aiUndoRef.current != null}
        onApply={handleAiApply}
        onUndo={handleAiUndo}
        onAddTag={handleAddTagFromAi}
        onAddAllTags={handleAddAllTags}
      />

      {/*
        D：未保存关闭二次确认。
        - 「继续编辑」：关弹窗，回到编辑器
        - 「保存并关闭」：先 await 一遍 handleSave，再关
        - 「丢弃并关闭」：直接清 dirty + 关（不写盘）
        用 Dialog 而非 window.confirm，因为前者可本地化、风格统一、不阻塞 React 事件循环。
      */}
      <Dialog
        open={confirmCloseOpen}
        onClose={() => setConfirmCloseOpen(false)}
        maxWidth="xs"
        fullWidth
        aria-labelledby="confirm-close-title"
      >
        <DialogTitle id="confirm-close-title" sx={{ display: 'flex', alignItems: 'center', gap: 1, pb: 1 }}>
          <WarningCircleIcon size={20} weight="duotone" style={{ color: 'var(--mui-palette-warning-main)' }} />
          {t('editor.confirm_close_title') || '有未保存的改动'}
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            {t('editor.confirm_close_desc') || '当前笔记有改动尚未保存（2 秒内会自动保存，也可以立刻手动保存）。要如何处理？'}
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 2, pb: 1.5, gap: 0.5, flexWrap: 'wrap' }}>
          <Button onClick={() => setConfirmCloseOpen(false)} sx={{ textTransform: 'none' }}>
            {tCommon('action.cancel') || '继续编辑'}
          </Button>
          <Button
            onClick={() => {
              // 丢弃：清 dirty + 直接关（不走 handleSave，避免把临时脏内容写盘）
              dirtyRef.current = false;
              setSaveStatus('saved');
              setConfirmCloseOpen(false);
              onClose();
            }}
            color="error"
            sx={{ textTransform: 'none' }}
          >
            {t('editor.discard_and_close') || '丢弃并关闭'}
          </Button>
          <Button
            variant="contained"
            onClick={async () => {
              setConfirmCloseOpen(false);
              try {
                await handleSave();
              } catch {
                /* 失败仍关闭：dirty 已落盘失败，留着编辑也救不回（用户已点"保存并关闭"） */
              }
              onClose();
            }}
            sx={{ textTransform: 'none' }}
          >
            {t('editor.save_and_close') || '保存并关闭'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
