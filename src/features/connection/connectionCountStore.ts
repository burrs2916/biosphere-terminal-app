import { create } from 'zustand';
import { listConnections } from '../../core/services/connection.service';

interface ConnectionCountState {
  count: number;
  setCount: (n: number) => void;
  refresh: () => Promise<void>;
}

// 侧边栏"连接"项计数徽标共享状态。
// 模块加载时即拉取一次，保证应用启动后徽标即亮；
// ConnectionList 在每次增删改/刷新后调用 setCount 保持同步。
export const useConnectionCountStore = create<ConnectionCountState>((set) => {
  const refresh = async () => {
    try {
      const list = await listConnections();
      set({ count: list.length });
    } catch {
      // 启动早期数据库可能尚未就绪，忽略；ConnectionList 后续 load 会修正
    }
  };
  // 初始自动拉取（仅一次）
  void refresh();
  return {
    count: 0,
    setCount: (n: number) => set({ count: n }),
    refresh,
  };
});
