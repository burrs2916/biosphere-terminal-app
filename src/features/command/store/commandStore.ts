import { create } from 'zustand';
import type { CommandHistoryEntry, CommandSnippet } from '../../../proto';

interface CommandState {
  history: CommandHistoryEntry[];
  snippets: CommandSnippet[];
  setHistory: (history: CommandHistoryEntry[]) => void;
  addHistory: (entry: CommandHistoryEntry) => void;
  setSnippets: (snippets: CommandSnippet[]) => void;
  addSnippet: (snippet: CommandSnippet) => void;
}

export const useCommandStore = create<CommandState>((set) => ({
  history: [],
  snippets: [],

  setHistory: (history) => set({ history }),
  addHistory: (entry) =>
    set((s) => ({ history: [entry, ...s.history].slice(0, 1000) })),
  setSnippets: (snippets) => set({ snippets }),
  addSnippet: (snippet) =>
    set((s) => ({ snippets: [...s.snippets, snippet] })),
}));
