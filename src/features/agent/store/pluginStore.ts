import { create } from 'zustand';
import type { PluginManifest, PluginTool, PluginGroupDto, PluginCategoryDto } from '../../../proto/plugin';
import * as pluginService from '../../../core/services/plugin.service';
import { useAgentStore } from './agentStore';

interface PluginState {
  plugins: PluginManifest[];
  pluginTools: PluginTool[];
  groups: PluginGroupDto[];
  categories: PluginCategoryDto[];
  loading: boolean;
  error: string | null;

  loadPlugins: () => Promise<void>;
  savePlugin: (manifest: PluginManifest) => Promise<void>;
  deletePlugin: (id: string) => Promise<void>;
  togglePlugin: (id: string, enabled: boolean) => Promise<void>;
  loadPluginTools: () => Promise<void>;
  loadGroups: () => Promise<void>;
  createGroup: (id: string, name: string, icon: string, color: string, sortOrder: number) => Promise<PluginGroupDto | null>;
  updateGroup: (id: string, name: string, icon: string, color: string, sortOrder: number) => Promise<PluginGroupDto | null>;
  deleteGroup: (id: string) => Promise<void>;
  loadCategories: (groupId: string) => Promise<void>;
  createCategory: (id: string, name: string, groupId: string, sortOrder: number) => Promise<PluginCategoryDto | null>;
  updateCategory: (id: string, name: string, sortOrder: number) => Promise<PluginCategoryDto | null>;
  deleteCategory: (id: string) => Promise<void>;
}

export const usePluginStore = create<PluginState>((set, get) => ({
  plugins: [],
  pluginTools: [],
  groups: [],
  categories: [],
  loading: false,
  error: null,

  loadPlugins: async () => {
    set({ loading: true, error: null });
    try {
      const plugins = await pluginService.listPlugins();
      set({ plugins, loading: false });
    } catch (e: any) {
      set({ error: e.toString(), loading: false });
    }
  },

  savePlugin: async (manifest: PluginManifest) => {
    try {
      await pluginService.savePlugin(manifest);
      const plugins = await pluginService.listPlugins();
      set({ plugins });
      await get().loadPluginTools();
    } catch (e: any) {
      set({ error: e.toString() });
    }
  },

  deletePlugin: async (id: string) => {
    try {
      await pluginService.deletePlugin(id);
      const plugins = await pluginService.listPlugins();
      set({ plugins });
      await get().loadPluginTools();
      useAgentStore.getState().loadAgents();
    } catch (e: any) {
      set({ error: e.toString() });
    }
  },

  togglePlugin: async (id: string, enabled: boolean) => {
    try {
      await pluginService.togglePlugin(id, enabled);
      const plugins = await pluginService.listPlugins();
      set({ plugins });
      await get().loadPluginTools();
    } catch (e: any) {
      set({ error: e.toString() });
    }
  },

  loadPluginTools: async () => {
    try {
      const pluginTools = await pluginService.listPluginTools();
      set({ pluginTools });
    } catch (e: any) {
      set({ error: e.toString() });
    }
  },

  loadGroups: async () => {
    try {
      const groups = await pluginService.listPluginGroups();
      set({ groups: groups || [] });
    } catch (e: any) {
      set({ error: e.toString() });
    }
  },

  createGroup: async (id, name, icon, color, sortOrder) => {
    try {
      const group = await pluginService.createPluginGroup(id, name, icon, color, sortOrder);
      await get().loadGroups();
      return group;
    } catch (e: any) {
      set({ error: e.toString() });
      return null;
    }
  },

  updateGroup: async (id, name, icon, color, sortOrder) => {
    try {
      const group = await pluginService.updatePluginGroup(id, name, icon, color, sortOrder);
      await get().loadGroups();
      return group;
    } catch (e: any) {
      set({ error: e.toString() });
      return null;
    }
  },

  deleteGroup: async (id) => {
    try {
      await pluginService.deletePluginGroup(id);
      await get().loadGroups();
    } catch (e: any) {
      set({ error: e.toString() });
    }
  },

  loadCategories: async (groupId) => {
    try {
      const categories = await pluginService.listPluginCategories(groupId);
      set({ categories: categories || [] });
    } catch (e: any) {
      set({ error: e.toString() });
    }
  },

  createCategory: async (id, name, groupId, sortOrder) => {
    try {
      const cat = await pluginService.createPluginCategory(id, name, groupId, sortOrder);
      await get().loadCategories(groupId);
      return cat;
    } catch (e: any) {
      set({ error: e.toString() });
      return null;
    }
  },

  updateCategory: async (id, name, sortOrder) => {
    try {
      const cat = await pluginService.updatePluginCategory(id, name, sortOrder);
      const categories = get().categories;
      const groupId = categories.find((c) => c.id === id)?.groupId;
      if (groupId) await get().loadCategories(groupId);
      return cat;
    } catch (e: any) {
      set({ error: e.toString() });
      return null;
    }
  },

  deleteCategory: async (id) => {
    try {
      const categories = get().categories;
      const groupId = categories.find((c) => c.id === id)?.groupId;
      await pluginService.deletePluginCategory(id);
      if (groupId) await get().loadCategories(groupId);
    } catch (e: any) {
      set({ error: e.toString() });
    }
  },
}));
