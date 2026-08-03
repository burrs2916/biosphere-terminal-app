import { create } from 'zustand';
import type { NoteDto, NoteDetailDto, CreateNoteInput, UpdateNoteInput, CommandNoteLinkDto, NoteGroupDto, CreateGroupInput, UpdateGroupInput, NoteCategoryDto, CreateCategoryInput, UpdateCategoryInput, NoteTagDto, CreateTagInput, UpdateTagInput } from '../../../proto/notebook';
import * as notebookService from '../../../core/services/notebook.service';
import type { UpdateNoteResult } from '../../../core/services/notebook.service';
import { localizeBackendError } from '../../../core/backendError';
import { emit } from '@tauri-apps/api/event';

/**
 * AI 自动触发去抖：绑定 auto_save 智能体时，每次自动保存（2s 防抖）都会回声
 * `auto-trigger-agent`，若直接 emit 会让 AI 在用户每次停顿输入时都被唤醒（AI 风暴 / 成本失控）。
 * 因此按笔记 id 合并窗口内的多次保存，只在静默 ~8s 后触发一次 AI（R14 优化，回填 R13「待下批」项）。
 */
const AI_TRIGGER_DEBOUNCE_MS = 8000;
const aiTriggerTimers = new Map<string, ReturnType<typeof setTimeout>>();

function scheduleAutoTrigger(noteId: string, noteTitle: string, action: 'create' | 'update') {
  const existing = aiTriggerTimers.get(noteId);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    aiTriggerTimers.delete(noteId);
    emit('auto-trigger-agent', {
      triggerType: 'auto_save',
      noteId,
      noteTitle,
      action,
    }).catch((e: unknown) => console.error('Auto-trigger agent failed:', e));
  }, AI_TRIGGER_DEBOUNCE_MS);
  aiTriggerTimers.set(noteId, timer);
}

interface NotebookState {
  notes: NoteDto[];
  selectedNote: NoteDetailDto | null;
  groups: NoteGroupDto[];
  categories: NoteCategoryDto[];
  tags: NoteTagDto[];
  linkedCommands: CommandNoteLinkDto[];
  linkedNotes: CommandNoteLinkDto[];
  loading: boolean;
  error: string | null;
  searchQuery: string;
  activeGroupId: string;
  activeCategory: string;
  activeTag: string;

  loadNotes: (groupId?: string, category?: string, search?: string) => Promise<void>;
  loadNote: (id: string) => Promise<void>;
  createNote: (input: CreateNoteInput) => Promise<NoteDto | null>;
  updateNote: (input: UpdateNoteInput) => Promise<UpdateNoteResult | null>;
  deleteNote: (id: string) => Promise<void>;
  togglePin: (id: string) => Promise<void>;
  searchNotes: (query: string) => Promise<void>;
  loadCategoriesByGroup: (groupId: string) => Promise<void>;
  loadAllCategories: () => Promise<void>;
  createCategory: (input: CreateCategoryInput) => Promise<NoteCategoryDto | null>;
  updateCategory: (input: UpdateCategoryInput) => Promise<NoteCategoryDto | null>;
  deleteCategory: (id: string) => Promise<void>;
  loadTagsByGroup: (groupId: string) => Promise<void>;
  createTag: (input: CreateTagInput) => Promise<NoteTagDto | null>;
  updateTag: (input: UpdateTagInput) => Promise<NoteTagDto | null>;
  deleteTag: (id: string) => Promise<void>;
  setActiveTag: (tag: string) => void;
  linkCommand: (noteId: string, commandId: string, context: string) => Promise<void>;
  loadLinkedCommands: (noteId: string) => Promise<void>;
  loadLinkedNotes: (commandId: string) => Promise<void>;
  setSearchQuery: (query: string) => void;
  setActiveGroupId: (groupId: string) => void;
  setActiveCategory: (category: string) => void;
  clearSelection: () => void;

  loadGroups: () => Promise<void>;
  createGroup: (input: CreateGroupInput) => Promise<NoteGroupDto | null>;
  updateGroup: (input: UpdateGroupInput) => Promise<NoteGroupDto | null>;
  deleteGroup: (id: string, targetGroupId?: string | null, deleteNotes?: boolean) => Promise<void>;
}

export const useNotebookStore = create<NotebookState>((set, get) => ({
  notes: [],
  selectedNote: null,
  groups: [],
  categories: [],
  tags: [],
  linkedCommands: [],
  linkedNotes: [],
  loading: false,
  error: null,
  searchQuery: '',
  activeGroupId: '',
  activeCategory: '',
  activeTag: '',

  loadNotes: async (groupId?: string, category?: string, search?: string) => {
    set({ loading: true, error: null });
    try {
      const notes = await notebookService.listNotes(groupId, category, search);
      set({ notes, loading: false });
    } catch (e) {
      set({ error: localizeBackendError(e), loading: false });
    }
  },

  loadNote: async (id: string) => {
    set({ loading: true, error: null });
    try {
      const detail = await notebookService.getNote(id);
      set({ selectedNote: detail, loading: false });
    } catch (e) {
      set({ error: localizeBackendError(e), loading: false });
    }
  },

  createNote: async (input: CreateNoteInput) => {
    set({ loading: true, error: null });
    try {
      const note = await notebookService.createNote(input);
      // 不再本地 prepend（避免把笔记插进不属于它的分组列表造成计数/归属错乱，F3/P1-8）；
      // 改为以服务端为准重拉分组计数 + 当前视图笔记，保证一致。
      const st = get();
      await st.loadGroups().catch(() => {});
      await st.loadNotes(st.activeGroupId || undefined, st.activeCategory || undefined, st.searchQuery || undefined).catch(() => {});
      set({ loading: false });
      // 仅对非空笔记触发 AI 自动整理（R13 / R12 需求 #5）：空白笔记不应自动跑助手，避免误把空笔记填满。
      if (input.title.trim() || input.content.trim()) {
        scheduleAutoTrigger(note.id, note.title, 'create');
      }
      return note;
    } catch (e) {
      set({ error: localizeBackendError(e), loading: false });
      return null;
    }
  },

  updateNote: async (input: UpdateNoteInput) => {
    set({ loading: true, error: null });
    try {
      const result = await notebookService.updateNote(input);
      const note = result.note;
      // 后端在切组时若原 category 不在新组分类列表，会强制重置为目标组默认 uncategorized，
      // 并通过 result.categoryReset 把旧/新值返回前端。前端 store 不在这里 toast（避免 store 内
      // 直接耦合 i18n 键），由 NoteEditor 拿到 result 后决定何时通知用户。
      const notes = get().notes.map((n) => (n.id === note.id ? note : n));
      set({ notes, loading: false });
      // 同步刷新 selectedNote（否则打开"所在文件夹"按钮用的 file_path、
      // 以及标题/标签快照会是旧值，重命名/移动后指向过期路径）。
      const sel = get().selectedNote;
      if (sel && sel.note.id === note.id) {
        set({ selectedNote: { ...sel, note } });
      }
      // 仅对非空笔记触发 AI 自动整理（R13 / R12 需求 #5）：空白笔记不触发，避免无意义自动整理。
      // 去抖由 scheduleAutoTrigger 处理，避免 2s 自动保存风暴唤醒 AI。
      if (input.title.trim() || input.content.trim()) {
        scheduleAutoTrigger(note.id, note.title, 'update');
      }
      return result;
    } catch (e) {
      set({ error: localizeBackendError(e), loading: false });
      return null;
    }
  },

  deleteNote: async (id: string) => {
    set({ loading: true, error: null });
    try {
      await notebookService.deleteNote(id);
      const selectedNote = get().selectedNote?.note.id === id ? null : get().selectedNote;
      set({ selectedNote, loading: false });
      // 以服务端为准重拉分组计数 + 当前视图笔记，修正侧栏计数失真（F3/P1-8）
      const st = get();
      await st.loadGroups().catch(() => {});
      await st.loadNotes(st.activeGroupId || undefined, st.activeCategory || undefined, st.searchQuery || undefined).catch(() => {});
    } catch (e) {
      set({ error: localizeBackendError(e), loading: false });
    }
  },

  togglePin: async (id: string) => {
    try {
      const note = await notebookService.togglePinNote(id);
      const notes = get().notes.map((n) => (n.id === note.id ? note : n));
      set({ notes });
    } catch (e) {
      set({ error: localizeBackendError(e) });
    }
  },

  searchNotes: async (query: string) => {
    set({ loading: true, error: null, searchQuery: query });
    try {
      const notes = await notebookService.searchNotes(query);
      set({ notes, loading: false });
    } catch (e) {
      set({ error: localizeBackendError(e), loading: false });
    }
  },

  loadCategoriesByGroup: async (groupId: string) => {
    try {
      const categories = await notebookService.listNoteCategoriesByGroup(groupId);
      set({ categories: categories || [] });
    } catch (e) {
      set({ error: localizeBackendError(e) });
    }
  },

  loadAllCategories: async () => {
    try {
      const names = await notebookService.listNoteCategories();
      const categories: NoteCategoryDto[] = names.map((name, idx) => ({
        id: `cat-${name}`,
        name,
        groupId: '',
        isDefault: false,
        sortOrder: idx,
        createdAt: 0,
        updatedAt: 0,
      }));
      set({ categories });
    } catch (e) {
      set({ error: localizeBackendError(e) });
    }
  },

  createCategory: async (input: CreateCategoryInput) => {
    try {
      const cat = await notebookService.createNoteCategory(input);
      // 后端对同组同名分类幂等返回既有行；本地按 id 去重，避免重复卡片（R21）。
      const existingIdx = get().categories.findIndex((c) => c.id === cat.id);
      const categories =
        existingIdx >= 0
          ? get().categories.map((c) => (c.id === cat.id ? cat : c))
          : [...get().categories, cat];
      set({ categories });
      return cat;
    } catch (e) {
      set({ error: localizeBackendError(e) });
      return null;
    }
  },

  updateCategory: async (input: UpdateCategoryInput) => {
    try {
      const cat = await notebookService.updateNoteCategory(input);
      const categories = get().categories.map((c) => (c.id === cat.id ? cat : c));
      set({ categories });
      return cat;
    } catch (e) {
      set({ error: localizeBackendError(e) });
      return null;
    }
  },

  deleteCategory: async (id: string) => {
    try {
      const removedCat = get().categories.find((c) => c.id === id);
      await notebookService.deleteNoteCategory(id);
      const categories = get().categories.filter((c) => c.id !== id);
      // 重归类语义：受影响笔记被服务端改为 uncategorized（空串，与 UI 的「未分类」= 空分类一致），
      // 本地同步，避免脏数据（FIX-N2，R19）。此前后端重归类为字面量 'uncategorized' 字符串，
      // 与前端「未分类」用空串表示不一致，导致删分类后笔记从「未分类」计数与视图里消失。
      const notes = get().notes.map((n) =>
        removedCat && n.category === removedCat.name ? { ...n, category: '' } : n
      );
      // activeCategory 存的是「分类名」（非 id），故与 removedCat.name 比较；
      // 若删掉的正好是当前激活的分类，清空过滤，避免 NotesReferencePage/NoteList 停留在
      // 已删除分类的空过滤上（此前的 `=== id` 比对 UUID 永不命中，导致删分类后列表莫名变空）。
      if (get().activeCategory === removedCat?.name) {
        set({ categories, notes, activeCategory: '' });
      } else {
        set({ categories, notes });
      }
    } catch (e) {
      set({ error: localizeBackendError(e) });
    }
  },

  loadTagsByGroup: async (groupId: string) => {
    try {
      const tags = await notebookService.listNoteTagsByGroup(groupId);
      set({ tags: tags || [] });
    } catch (e) {
      set({ error: localizeBackendError(e) });
    }
  },

  createTag: async (input: CreateTagInput) => {
    try {
      const tag = await notebookService.createNoteTag(input);
      // 后端对同组同名标签幂等返回既有行；本地按 id 去重，避免重复卡片（R21）。
      const existingIdx = get().tags.findIndex((t) => t.id === tag.id);
      const tags =
        existingIdx >= 0
          ? get().tags.map((t) => (t.id === tag.id ? tag : t))
          : [...get().tags, tag];
      set({ tags });
      return tag;
    } catch (e) {
      set({ error: localizeBackendError(e) });
      return null;
    }
  },

  updateTag: async (input: UpdateTagInput) => {
    try {
      const tag = await notebookService.updateNoteTag(input);
      const tags = get().tags.map((t) => (t.id === tag.id ? tag : t));
      set({ tags });
      return tag;
    } catch (e) {
      set({ error: localizeBackendError(e) });
      return null;
    }
  },

  deleteTag: async (id: string) => {
    try {
      const removedTag = get().tags.find((t) => t.id === id);
      await notebookService.deleteNoteTag(id);
      const tags = get().tags.filter((t) => t.id !== id);
      // 重归类语义：使用该标签的笔记移除该标签名（本地同步，避免脏数据）
      const notes = removedTag
        ? get().notes.map((n) =>
            n.tags.includes(removedTag.name) ? { ...n, tags: n.tags.filter((tn) => tn !== removedTag.name) } : n
          )
        : get().notes;
      const newActive = get().activeTag === removedTag?.name ? '' : get().activeTag;
      set({ tags, notes, activeTag: newActive });
    } catch (e) {
      set({ error: localizeBackendError(e) });
    }
  },

  setActiveTag: (tag: string) => set({ activeTag: tag }),

  linkCommand: async (noteId: string, commandId: string, context: string) => {
    try {
      await notebookService.linkCommandToNote({ noteId, commandId, context });
    } catch (e) {
      set({ error: localizeBackendError(e) });
    }
  },

  loadLinkedCommands: async (noteId: string) => {
    try {
      const linkedCommands = await notebookService.getLinkedCommands(noteId);
      set({ linkedCommands: linkedCommands || [] });
    } catch (e) {
      set({ error: localizeBackendError(e), linkedCommands: [] });
    }
  },

  loadLinkedNotes: async (commandId: string) => {
    try {
      const linkedNotes = await notebookService.getLinkedNotes(commandId);
      set({ linkedNotes: linkedNotes || [] });
    } catch (e) {
      set({ error: localizeBackendError(e), linkedNotes: [] });
    }
  },

  setSearchQuery: (query: string) => set({ searchQuery: query }),
  setActiveGroupId: (groupId: string) => set({ activeGroupId: groupId, activeTag: '' }),
  setActiveCategory: (category: string) => set({ activeCategory: category }),
  clearSelection: () => set({ selectedNote: null, linkedCommands: [] }),

  loadGroups: async () => {
    try {
      const groups = await notebookService.listNoteGroups();
      set({ groups: groups || [] });
    } catch (e) {
      set({ error: localizeBackendError(e) });
    }
  },

  createGroup: async (input: CreateGroupInput) => {
    try {
      const group = await notebookService.createNoteGroup(input);
      const groups = [...get().groups, group];
      set({ groups });
      return group;
    } catch (e) {
      set({ error: localizeBackendError(e) });
      return null;
    }
  },

  updateGroup: async (input: UpdateGroupInput) => {
    try {
      const group = await notebookService.updateNoteGroup(input);
      const groups = get().groups.map((g) => (g.id === group.id ? group : g));
      set({ groups });
      return group;
    } catch (e) {
      set({ error: localizeBackendError(e) });
      return null;
    }
  },

  deleteGroup: async (id: string, targetGroupId?: string | null, deleteNotes?: boolean) => {
    try {
      await notebookService.deleteNoteGroup(id, targetGroupId, deleteNotes);
      // 后端已完成重归类/硬删（含 DB + 文件迁移），本地直接以服务端为准重拉，
      // 避免本地映射不全（file_path/content 已变）导致状态错乱（P1-3/P1-7）。
      const nextActive =
        get().activeGroupId === id
          ? deleteNotes
            ? ''
            : targetGroupId || ''
          : get().activeGroupId;
      set({ activeGroupId: nextActive, categories: [], activeCategory: '', activeTag: '' });
      await get().loadGroups();
      await get().loadNotes(nextActive || undefined, undefined, get().searchQuery || undefined);
      // 若当前选中笔记属于被删分组，清空选择（重归类后其 groupId/file_path 已变）
      const current = get().selectedNote;
      if (current && current.note.groupId === id) {
        set({ selectedNote: null });
      }
    } catch (e) {
      set({ error: localizeBackendError(e) });
    }
  },
}));
