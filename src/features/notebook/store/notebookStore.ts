import { create } from 'zustand';
import type { NoteDto, NoteDetailDto, CreateNoteInput, UpdateNoteInput, CommandNoteLinkDto, NoteGroupDto, CreateGroupInput, UpdateGroupInput, NoteCategoryDto, CreateCategoryInput, UpdateCategoryInput } from '../../../proto/notebook';
import * as notebookService from '../../../core/services/notebook.service';

interface NotebookState {
  notes: NoteDto[];
  selectedNote: NoteDetailDto | null;
  groups: NoteGroupDto[];
  categories: NoteCategoryDto[];
  linkedCommands: CommandNoteLinkDto[];
  linkedNotes: CommandNoteLinkDto[];
  loading: boolean;
  error: string | null;
  searchQuery: string;
  activeGroupId: string;
  activeCategory: string;

  loadNotes: (groupId?: string, category?: string, search?: string) => Promise<void>;
  loadNote: (id: string) => Promise<void>;
  createNote: (input: CreateNoteInput) => Promise<NoteDto | null>;
  updateNote: (input: UpdateNoteInput) => Promise<NoteDto | null>;
  deleteNote: (id: string) => Promise<void>;
  togglePin: (id: string) => Promise<void>;
  searchNotes: (query: string) => Promise<void>;
  loadCategoriesByGroup: (groupId: string) => Promise<void>;
  createCategory: (input: CreateCategoryInput) => Promise<NoteCategoryDto | null>;
  updateCategory: (input: UpdateCategoryInput) => Promise<NoteCategoryDto | null>;
  deleteCategory: (id: string) => Promise<void>;
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
  deleteGroup: (id: string) => Promise<void>;
}

export const useNotebookStore = create<NotebookState>((set, get) => ({
  notes: [],
  selectedNote: null,
  groups: [],
  categories: [],
  linkedCommands: [],
  linkedNotes: [],
  loading: false,
  error: null,
  searchQuery: '',
  activeGroupId: '',
  activeCategory: '',

  loadNotes: async (groupId?: string, category?: string, search?: string) => {
    set({ loading: true, error: null });
    try {
      const notes = await notebookService.listNotes(groupId, category, search);
      set({ notes, loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  loadNote: async (id: string) => {
    set({ loading: true, error: null });
    try {
      const detail = await notebookService.getNote(id);
      set({ selectedNote: detail, loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  createNote: async (input: CreateNoteInput) => {
    set({ loading: true, error: null });
    try {
      const note = await notebookService.createNote(input);
      const notes = [note, ...get().notes];
      set({ notes, loading: false });
      return note;
    } catch (e) {
      set({ error: String(e), loading: false });
      return null;
    }
  },

  updateNote: async (input: UpdateNoteInput) => {
    set({ loading: true, error: null });
    try {
      const note = await notebookService.updateNote(input);
      const notes = get().notes.map((n) => (n.id === note.id ? note : n));
      set({ notes, loading: false });
      return note;
    } catch (e) {
      set({ error: String(e), loading: false });
      return null;
    }
  },

  deleteNote: async (id: string) => {
    set({ loading: true, error: null });
    try {
      await notebookService.deleteNote(id);
      const notes = get().notes.filter((n) => n.id !== id);
      const selectedNote = get().selectedNote?.note.id === id ? null : get().selectedNote;
      set({ notes, selectedNote, loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  togglePin: async (id: string) => {
    try {
      const note = await notebookService.togglePinNote(id);
      const notes = get().notes.map((n) => (n.id === note.id ? note : n));
      set({ notes });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  searchNotes: async (query: string) => {
    set({ loading: true, error: null, searchQuery: query });
    try {
      const notes = await notebookService.searchNotes(query);
      set({ notes, loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  loadCategoriesByGroup: async (groupId: string) => {
    try {
      const categories = await notebookService.listNoteCategoriesByGroup(groupId);
      set({ categories: categories || [] });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  createCategory: async (input: CreateCategoryInput) => {
    try {
      const cat = await notebookService.createNoteCategory(input);
      const categories = [...get().categories, cat];
      set({ categories });
      return cat;
    } catch (e) {
      set({ error: String(e) });
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
      set({ error: String(e) });
      return null;
    }
  },

  deleteCategory: async (id: string) => {
    try {
      await notebookService.deleteNoteCategory(id);
      const categories = get().categories.filter((c) => c.id !== id);
      if (get().activeCategory === id) {
        set({ categories, activeCategory: '' });
      } else {
        set({ categories });
      }
    } catch (e) {
      set({ error: String(e) });
    }
  },

  linkCommand: async (noteId: string, commandId: string, context: string) => {
    try {
      await notebookService.linkCommandToNote({ noteId, commandId, context });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  loadLinkedCommands: async (noteId: string) => {
    try {
      const linkedCommands = await notebookService.getLinkedCommands(noteId);
      set({ linkedCommands: linkedCommands || [] });
    } catch (e) {
      set({ error: String(e), linkedCommands: [] });
    }
  },

  loadLinkedNotes: async (commandId: string) => {
    try {
      const linkedNotes = await notebookService.getLinkedNotes(commandId);
      set({ linkedNotes: linkedNotes || [] });
    } catch (e) {
      set({ error: String(e), linkedNotes: [] });
    }
  },

  setSearchQuery: (query: string) => set({ searchQuery: query }),
  setActiveGroupId: (groupId: string) => set({ activeGroupId: groupId }),
  setActiveCategory: (category: string) => set({ activeCategory: category }),
  clearSelection: () => set({ selectedNote: null, linkedCommands: [] }),

  loadGroups: async () => {
    try {
      const groups = await notebookService.listNoteGroups();
      set({ groups: groups || [] });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  createGroup: async (input: CreateGroupInput) => {
    try {
      const group = await notebookService.createNoteGroup(input);
      const groups = [...get().groups, group];
      set({ groups });
      return group;
    } catch (e) {
      set({ error: String(e) });
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
      set({ error: String(e) });
      return null;
    }
  },

  deleteGroup: async (id: string) => {
    try {
      await notebookService.deleteNoteGroup(id);
      const groups = get().groups.filter((g) => g.id !== id);
      if (get().activeGroupId === id) {
        set({ groups, activeGroupId: '', categories: [], activeCategory: '' });
      } else {
        set({ groups });
      }
    } catch (e) {
      set({ error: String(e) });
    }
  },
}));
