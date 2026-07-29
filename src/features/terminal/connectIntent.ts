import { create } from 'zustand';
import type { ConnectionPickerResult } from './index';

interface ConnectIntentState {
  /** 待终端页消费的连接意图（来自连接管理页的"连接"动作） */
  pending: ConnectionPickerResult | null;
  /** 设置一个待连接的意图 */
  set: (p: ConnectionPickerResult | null) => void;
  /** 取出并清空待连接意图；若无则返回 null */
  consume: () => ConnectionPickerResult | null;
  /**
   * 当前拥有活跃终端会话的连接 id 集合。
   * 由终端页维护：建立 ssh 会话时 addActiveConnection，关闭对应 tab 时 removeActiveConnection。
   * 连接管理页据此精确显示"哪些连接正在使用中"（关闭即熄灭，非永久指示）。
   */
  activeConnectionIds: string[];
  addActiveConnection: (id: string) => void;
  removeActiveConnection: (id: string) => void;
}

/**
 * 连接意图的轻量全局通道。
 * 连接管理页（ConnectionPage）点击"连接"时写入，终端页（TerminalPage，常驻组件）订阅并在挂载/变化时消费，
 * 复用其已有的 handleConnect 真正拉起一个 SSH 终端会话。
 */
export const useConnectIntent = create<ConnectIntentState>((set, get) => ({
  pending: null,
  set: (p) => set({ pending: p }),
  consume: () => {
    const p = get().pending;
    set({ pending: null });
    return p;
  },
  activeConnectionIds: [],
  addActiveConnection: (id) =>
    set((s) => (s.activeConnectionIds.includes(id) ? s : { activeConnectionIds: [...s.activeConnectionIds, id] })),
  removeActiveConnection: (id) =>
    set((s) => ({ activeConnectionIds: s.activeConnectionIds.filter((x) => x !== id) })),
}));
