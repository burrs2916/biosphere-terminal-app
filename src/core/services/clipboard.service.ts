/// 剪贴板服务
///
/// 写剪贴板：直接用 navigator.clipboard（浏览器原生，高性能）。
/// Tauri webview 中 writeText 可用，不会 NotAllowedError（只有 readText 会被拒绝）。
/// onSelectionChange 高频触发场景必须走原生 API 避免 IPC 卡顿。
export async function copyText(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}

/// 读剪贴板：用 Tauri plugin（navigator.clipboard.readText 在
/// Tauri webview 中会被安全策略拒绝，返回 NotAllowedError）。
/// 懒加载避免模块导入时阻塞终端初始化。
export async function pasteText(): Promise<string> {
  const { readText } = await import('@tauri-apps/plugin-clipboard-manager');
  return await readText();
}
