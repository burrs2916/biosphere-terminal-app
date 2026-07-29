// 连接面板的轻量偏好：收藏 + 最近连接，纯 localStorage，不触碰 connections 表。
// 仅用于前端排序/过滤展示，重置应用或更换设备不迁移（属非关键 UX 状态）。

const FAV_KEY = 'biosphere-connection-favorites';
const RECENT_KEY = 'biosphere-connection-recents';

type IdMap<T> = Record<string, T>;

function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJSON(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 隐私模式 / 配额超限等场景静默失败，不影响主流程
  }
}

export function getFavorites(): IdMap<true> {
  return readJSON<IdMap<true>>(FAV_KEY, {});
}

export function toggleFavorite(id: string): IdMap<true> {
  const favs = getFavorites();
  if (favs[id]) delete favs[id];
  else favs[id] = true;
  writeJSON(FAV_KEY, favs);
  return favs;
}

export function getRecents(): IdMap<number> {
  return readJSON<IdMap<number>>(RECENT_KEY, {});
}

export function markRecent(id: string): IdMap<number> {
  const recents = getRecents();
  recents[id] = Date.now();
  writeJSON(RECENT_KEY, recents);
  return recents;
}
