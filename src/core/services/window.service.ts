import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { invoke } from '@tauri-apps/api/core';
import { localizeBackendError } from '../backendError';
import type { SshConnectionInfo } from '../../proto/connection';

const openWindows = new Map<string, WebviewWindow>();

export async function openCategoryNotesWindow(groupId: string, categoryName: string): Promise<WebviewWindow | null> {
  const key = `category-notes-${groupId}-${categoryName || 'all'}`;

  const existing = await WebviewWindow.getByLabel(key);
  if (existing) {
    await existing.setFocus();
    return existing;
  }

  const title = categoryName
    ? `${categoryName} — Notes`
    : 'All Notes';

  const webview = new WebviewWindow(key, {
    url: `/#/category-notes?groupId=${encodeURIComponent(groupId)}&category=${encodeURIComponent(categoryName)}`,
    title,
    width: 1000,
    height: 700,
    minWidth: 600,
    minHeight: 400,
    center: true,
    resizable: true,
    decorations: true,
    focus: true,
  });

  openWindows.set(key, webview);

  webview.once('tauri://destroyed', () => {
    openWindows.delete(key);
  });

  webview.once('tauri://error', (e) => {
    console.error('[window] failed to create category notes window:', e);
    openWindows.delete(key);
  });

  return webview;
}

interface SshWindowParams {
  host: string;
  port?: number;
  username: string;
  authMethod: string;
  privateKeyPath?: string;
  password?: string;
  /** 来源连接的 id，用于把安装档位等偏好持久化到该连接。 */
  connectionId?: string;
  /**
   * 一次性凭据 token：密码/密钥已由 Rust 侧暂存，子窗口凭 token 取回。
   * 由 `stashSshCredentials` 填充，调用方不要手工设置。
   */
  token?: string;
  /** SFTP 专属：窗口打开后直接定位到的远程目录（终端路径点击跳转）。 */
  initialPath?: string;
}

/** 把前端窗口参数转成后端 `SshConnectionInfo`（snake_case），用于凭据暂存。 */
function toRustSsh(p: SshWindowParams) {
  return {
    host: p.host,
    port: p.port ?? 22,
    username: p.username,
    auth_method: p.authMethod,
    private_key_path: p.authMethod === 'private_key' ? (p.privateKeyPath ?? null) : null,
    password: p.authMethod === 'password' ? (p.password ?? null) : null,
  };
}

/**
 * 打开子窗口前，把含密码/密钥的凭据暂存到 Rust 侧（内存，一次性取回 + 5 分钟 TTL），
 * 返回一次性 token。URL 只传 token，绝不传密码 —— 这是「密码绝不进 URL」铁律的实现点。
 *
 * 无凭据（authMethod=none / 临时预填）时返回 undefined，子窗口按无凭据处理；
 * 暂存失败时抛出（调用方应中止开窗，而不是打开一个注定认证失败的窗口）。
 */
async function stashSshCredentials(sshParams: SshWindowParams): Promise<string | undefined> {
  if (!sshParams.password && !sshParams.privateKeyPath) return undefined;
  return invoke<string>('stash_sftp_credentials', { ssh: toRustSsh(sshParams) });
}

/**
 * One-time credential retrieval, safe under React 18 StrictMode.
 *
 * `take_stashed_credentials` consumes the token on the Rust side (take =
 * remove from the stash). StrictMode mounts every component twice —
 * effect → cleanup → effect — so a naive per-effect `invoke` fires the
 * take TWICE: the first call consumes the token and the second gets
 * "credentials expired". Worse, the first run's successful result is
 * dropped by its own `cancelled` cleanup flag, so the child window shows
 * that false error 100% of the time in dev (production builds don't
 * double-invoke, which is how this hid for so long).
 *
 * Deduplicate at the PROMISE level, not the result level: StrictMode's
 * second run fires before the first invoke resolves, so caching only the
 * resolved value would still double-take. Every webview window is its own
 * JS context, so this map is per-window — exactly the lifetime of a
 * one-time token. A failed take (genuinely expired token) stays cached:
 * a dead token cannot come back to life, so retrying is pointless.
 */
const inflightCredentialTakes = new Map<string, Promise<SshConnectionInfo>>();

export function takeCredentialsOnce(token: string): Promise<SshConnectionInfo> {
  const existing = inflightCredentialTakes.get(token);
  if (existing) return existing;
  const pending = invoke<SshConnectionInfo>('take_stashed_credentials', { token });
  inflightCredentialTakes.set(token, pending);
  return pending;
}

/**
 * Resolve an existing window by label, but only if it is actually usable.
 *
 * `WebviewWindow.getByLabel` can keep returning a window that failed to load or
 * was destroyed but not yet released by the runtime. If we then keep
 * `setFocus()`-ing that dead handle, clicking the toolbar button looks like it
 * "does nothing" — no new window, no error. So: if the window can't be focused
 * or isn't visible, destroy it and let the caller create a fresh one.
 */
async function reuseOrRecreate(key: string): Promise<WebviewWindow | null> {
  try {
    const existing = await WebviewWindow.getByLabel(key);
    if (!existing) return null;
    let alive = true;
    try {
      await existing.setFocus();
      const visible = await existing.isVisible().catch(() => false);
      alive = !!visible;
    } catch {
      alive = false;
    }
    if (alive) return existing;
    try {
      await existing.destroy();
    } catch {
      /* ignore */
    }
    return null;
  } catch {
    return null;
  }
}

function buildSshUrl(path: string, sshParams?: SshWindowParams): string {
  if (!sshParams) return `/#/${path}`;
  const params = new URLSearchParams();
  params.set('host', sshParams.host);
  if (sshParams.port) params.set('port', String(sshParams.port));
  params.set('username', sshParams.username);
  params.set('authMethod', sshParams.authMethod);
  if (sshParams.connectionId) params.set('connectionId', sshParams.connectionId);
  if (sshParams.initialPath) params.set('initialPath', sshParams.initialPath);
  // 安全铁律：密码/密钥路径绝不进 URL（devtools / 历史 / 潜在日志都会留痕）。
  // 凭据已由 stashSshCredentials 暂存到 Rust 侧，这里只传一次性 token，
  // 子窗口凭 token 调 take_stashed_credentials 一次性取回。
  if (sshParams.token) params.set('token', sshParams.token);
  return `/#/${path}?${params.toString()}`;
}

export async function openRemoteDesktopWindow(
  sshParams?: SshWindowParams,
  onError?: (msg: string) => void,
): Promise<WebviewWindow | null> {
  const key = 'remote-desktop';

  const existing = await reuseOrRecreate(key);
  if (existing) return existing;

  // 凭据先暂存到 Rust 侧拿一次性 token，URL 不携带密码/密钥；暂存失败则不开窗。
  let token: string | undefined;
  if (sshParams) {
    try {
      token = await stashSshCredentials(sshParams);
    } catch (e) {
      console.error('[window] failed to stash ssh credentials:', e);
      onError?.(localizeBackendError(e));
      return null;
    }
  }

  const webview = new WebviewWindow(key, {
    url: buildSshUrl('remote-desktop', sshParams ? { ...sshParams, token } : undefined),
    title: 'Remote Desktop',
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    center: true,
    resizable: true,
    decorations: true,
    focus: true,
  });

  openWindows.set(key, webview);

  webview.once('tauri://destroyed', () => {
    openWindows.delete(key);
  });

  webview.once('tauri://error', (e: any) => {
    console.error('[window] failed to create remote desktop window:', e);
    openWindows.delete(key);
    const raw = e?.payload?.message ?? e?.payload ?? e;
    onError?.(typeof raw === 'string' ? raw : JSON.stringify(raw));
  });

  return webview;
}

export async function openSftpWindow(
  sshParams?: SshWindowParams,
  onError?: (msg: string) => void,
): Promise<WebviewWindow | null> {
  const key = 'sftp';

  const existing = await reuseOrRecreate(key);
  if (existing) return existing;

  // 凭据先暂存到 Rust 侧拿一次性 token，URL 不携带密码/密钥；暂存失败则不开窗。
  let token: string | undefined;
  if (sshParams) {
    try {
      token = await stashSshCredentials(sshParams);
    } catch (e) {
      console.error('[window] failed to stash ssh credentials:', e);
      onError?.(localizeBackendError(e));
      return null;
    }
  }

  const webview = new WebviewWindow(key, {
    url: buildSshUrl('sftp', sshParams ? { ...sshParams, token } : undefined),
    title: 'SFTP File Transfer',
    width: 900,
    height: 650,
    minWidth: 600,
    minHeight: 400,
    center: true,
    resizable: true,
    decorations: true,
    focus: true,
  });

  openWindows.set(key, webview);

  webview.once('tauri://destroyed', () => {
    openWindows.delete(key);
  });

  webview.once('tauri://error', (e: any) => {
    console.error('[window] failed to create sftp window:', e);
    openWindows.delete(key);
    const raw = e?.payload?.message ?? e?.payload ?? e;
    onError?.(typeof raw === 'string' ? raw : JSON.stringify(raw));
  });

  return webview;
}

export async function openNoteEditorWindow(noteId: string, title?: string): Promise<WebviewWindow | null> {
  const key = `note-editor-${noteId}`;

  const existing = await WebviewWindow.getByLabel(key);
  if (existing) {
    await existing.setFocus();
    return existing;
  }

  const webview = new WebviewWindow(key, {
    url: `/#/category-notes?noteId=${encodeURIComponent(noteId)}`,
    title: title || 'Note Editor',
    width: 1000,
    height: 700,
    minWidth: 600,
    minHeight: 400,
    center: true,
    resizable: true,
    decorations: true,
    focus: true,
  });

  openWindows.set(key, webview);

  webview.once('tauri://destroyed', () => {
    openWindows.delete(key);
  });

  webview.once('tauri://error', (e) => {
    console.error('[window] failed to create note editor window:', e);
    openWindows.delete(key);
  });

  return webview;
}

export async function openAllNotesWindow(): Promise<WebviewWindow | null> {
  const key = 'category-notes-all';

  const existing = await WebviewWindow.getByLabel(key);
  if (existing) {
    await existing.setFocus();
    return existing;
  }

  const webview = new WebviewWindow(key, {
    url: '/#/category-notes',
    title: 'All Notes',
    width: 1000,
    height: 700,
    minWidth: 600,
    minHeight: 400,
    center: true,
    resizable: true,
    decorations: true,
    focus: true,
  });

  openWindows.set(key, webview);

  webview.once('tauri://destroyed', () => {
    openWindows.delete(key);
  });

  webview.once('tauri://error', (e) => {
    console.error('[window] failed to create all notes window:', e);
    openWindows.delete(key);
  });

  return webview;
}

export async function openNotesReferenceWindow(): Promise<WebviewWindow | null> {
  const key = 'notes-ref';

  const existing = await WebviewWindow.getByLabel(key);
  if (existing) {
    await existing.setFocus();
    return existing;
  }

  const webview = new WebviewWindow(key, {
    url: '/#/notes-reference',
    title: 'Notes Reference',
    width: 1000,
    height: 700,
    minWidth: 600,
    minHeight: 400,
    center: true,
    resizable: true,
    decorations: true,
    focus: true,
  });

  openWindows.set(key, webview);

  webview.once('tauri://destroyed', () => {
    openWindows.delete(key);
  });

  webview.once('tauri://error', (e) => {
    console.error('[window] failed to create notes reference window:', e);
    openWindows.delete(key);
  });

  return webview;
}

export interface OpenAiCopilotOptions {
  /// 绑定到指定 Agent（如远程桌面安装助手），不传则沿用用户已绑定的 copilot Agent。
  agentId?: string;
  /// 远程桌面设置指南携带的上下文，写入窗口 URL，供 AiCopilotPage 解析。
  sessionId?: string;
  host?: string;
  username?: string;
  /// 远程桌面安装模式：headless（无桌面版）/ basic（基础桌面版）/ full（全量安装）。
  installMode?: string;
  /// 远端操作系统（设置指南检测值：linux / macos / windows / unknown）。
  /// 注入 rdSetup 上下文，让 AI 直接走对应平台剧本，不必等 PHASE 0 探测。
  osName?: string;
}

export async function openAiCopilotWindow(opts?: OpenAiCopilotOptions): Promise<WebviewWindow | null> {
  // 远程桌面安装助手（带 agentId/sessionId 等上下文）必须是独立窗口，
  // 否则会与普通 AI 对话共用 `ai-copilot` label，导致普通对话复用其窗口、
  // 继承 rdSetup 上下文并误触发安装指令。
  const isRdSetup = !!(opts?.agentId || opts?.sessionId || opts?.host || opts?.username);
  const key = isRdSetup ? 'ai-copilot-rd-setup' : 'ai-copilot';

  const existing = await WebviewWindow.getByLabel(key);
  if (existing) {
    await existing.setFocus();
    return existing;
  }

  // 把上下文编码进 hash 路由的 query，供 AiCopilotPage 通过 useSearchParams 读取。
  const params = new URLSearchParams();
  if (opts?.agentId) params.set('agentId', opts.agentId);
  if (opts?.sessionId) params.set('sessionId', opts.sessionId);
  if (opts?.host) params.set('host', opts.host);
  if (opts?.username) params.set('username', opts.username);
  if (opts?.installMode) params.set('installMode', opts.installMode);
  if (opts?.osName) params.set('osName', opts.osName);
  const query = params.toString();
  const url = query ? `/#/ai-copilot?${query}` : '/#/ai-copilot';

  const webview = new WebviewWindow(key, {
    url,
    title: 'AI Copilot',
    width: 880,
    height: 760,
    minWidth: 480,
    minHeight: 560,
    center: true,
    resizable: true,
    decorations: true,
    focus: true,
  });

  openWindows.set(key, webview);

  webview.once('tauri://destroyed', () => {
    openWindows.delete(key);
  });

  webview.once('tauri://error', (e) => {
    console.error('[window] failed to create ai copilot window:', e);
    openWindows.delete(key);
  });

  return webview;
}
