import { create } from 'zustand';
import type { TerminalSession, PtyConfig } from '../proto';
import * as terminalService from '../core/services/terminal.service';
import * as sessionService from '../core/services/session.service';
import { localizeBackendError } from '../core/backendError';

interface TerminalState {
  sessions: Map<string, TerminalSession>;
  activeSessionId: string | null;
  loading: boolean;
  error: string | null;

  spawnTerminal: (sessionId: string, config: PtyConfig) => Promise<void>;
  killTerminal: (sessionId: string) => Promise<void>;
  setActiveSession: (sessionId: string) => void;
  loadSessions: () => Promise<void>;
}

export const useTerminalStore = create<TerminalState>((set, get) => ({
  sessions: new Map(),
  activeSessionId: null,
  loading: false,
  error: null,

  spawnTerminal: async (sessionId: string, config: PtyConfig) => {
    try {
      await terminalService.spawnTerminal(sessionId, config);
    } catch (e) {
      set({ error: localizeBackendError(e) });
    }
  },

  killTerminal: async (sessionId: string) => {
    try {
      await terminalService.killTerminal(sessionId);
      const sessions = new Map(get().sessions);
      sessions.delete(sessionId);
      set({
        sessions,
        activeSessionId: get().activeSessionId === sessionId ? null : get().activeSessionId,
      });
    } catch (e) {
      set({ error: localizeBackendError(e) });
    }
  },

  setActiveSession: (sessionId: string) => {
    set({ activeSessionId: sessionId });
  },

  loadSessions: async () => {
    set({ loading: true, error: null });
    try {
      const list = await sessionService.listSessions();
      const sessions = new Map<string, TerminalSession>();
      for (const s of list) {
        sessions.set(s.id, s);
      }
      set({ sessions, loading: false });
    } catch (e) {
      set({ error: localizeBackendError(e), loading: false });
    }
  },
}));
