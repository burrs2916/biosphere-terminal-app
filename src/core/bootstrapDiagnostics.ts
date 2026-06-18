import { invoke } from '@tauri-apps/api/core';
import { emit } from '@tauri-apps/api/event';

type LogLevel = 'error' | 'warn' | 'info' | 'debug';

const BOOTSTRAP_BUFFER: string[] = [];
const MAX_BUFFER = 200;

function formatMessage(tag: string, message: string): string {
  return `[${tag}] ${message}`;
}

/** Best-effort: write to Rust tracing via IPC and mirror to console. */
export function bootstrapLog(level: LogLevel, tag: string, message: string): void {
  const line = formatMessage(tag, message);
  BOOTSTRAP_BUFFER.push(line);
  if (BOOTSTRAP_BUFFER.length > MAX_BUFFER) {
    BOOTSTRAP_BUFFER.shift();
  }

  const consoleFn =
    level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  consoleFn(`[bootstrap][${level}]`, line);

  void invoke('write_frontend_log', { level, tag, message }).catch(() => {
    // IPC may not be ready during the earliest bootstrap lines.
  });

  void emit('frontend-diagnostic', { level, tag, message: line }).catch(() => {
    // Event bridge may not be ready yet.
  });
}

export function getBootstrapBuffer(): string[] {
  return [...BOOTSTRAP_BUFFER];
}

export function installBootstrapDiagnostics(): void {
  bootstrapLog(
    'info',
    'bootstrap',
    [
      'installBootstrapDiagnostics',
      `readyState=${document.readyState}`,
      `href=${location.href}`,
      `title=${document.title}`,
      `root=${document.getElementById('root') ? 'present' : 'missing'}`,
      `ua=${navigator.userAgent}`,
      `hasTauriInternals=${String(Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__))}`,
    ].join(' | '),
  );

  window.addEventListener('error', (event) => {
    const detail = [
      event.message,
      event.filename ? `at ${event.filename}:${event.lineno}:${event.colno}` : '',
      event.error?.stack ? `stack=${event.error.stack}` : '',
    ]
      .filter(Boolean)
      .join(' ');
    bootstrapLog('error', 'window.onerror', detail);
    // Suppress known harmless xterm.js v5 race condition in syncScrollArea
    // See https://github.com/xtermjs/xterm.js/issues/5011
    if (event.message?.includes('_renderer.value.dimensions') ||
        event.message?.includes('_renderer') && event.message?.includes('dimensions')) {
      event.preventDefault();
      return false;
    }
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason as Error | string | undefined;
    const detail =
      typeof reason === 'object' && reason !== null && 'stack' in reason
        ? String((reason as Error).stack || reason)
        : String(reason ?? event);
    bootstrapLog('error', 'unhandledrejection', detail);
  });

  document.addEventListener('securitypolicyviolation', (event) => {
    bootstrapLog(
      'error',
      'csp',
      `${event.violatedDirective} blocked ${event.blockedURI} (effective: ${event.effectiveDirective})`,
    );
  });

  // Track late-loading script failures.
  document.querySelectorAll('script[src]').forEach((node, index) => {
    node.addEventListener('error', () => {
      bootstrapLog('error', 'script.load', `failed script[${index}] src=${(node as HTMLScriptElement).src}`);
    });
  });

  document.fonts?.ready
    .then(() => bootstrapLog('info', 'fonts', `fonts.ready status=${document.fonts.status}`))
    .catch((err) => bootstrapLog('warn', 'fonts', `fonts.ready rejected: ${String(err)}`));

  window.addEventListener('load', () => {
    bootstrapLog('info', 'window.load', collectDomSnapshot());
  });

  document.addEventListener('DOMContentLoaded', () => {
    bootstrapLog('info', 'DOMContentLoaded', collectDomSnapshot());
  });
}

export function collectDomSnapshot(): string {
  const root = document.getElementById('root');
  const scripts = Array.from(document.querySelectorAll('script')).map((script, index) => {
    const src = script.src || script.getAttribute('src') || 'inline';
    return `${index}:${src}`;
  });
  const styles = Array.from(document.querySelectorAll('link[rel="stylesheet"]')).map(
    (link) => (link as HTMLLinkElement).href,
  );

  return [
    `readyState=${document.readyState}`,
    `href=${location.href}`,
    `bodyLen=${document.body?.innerHTML.length ?? -1}`,
    `rootChildren=${root?.childElementCount ?? -1}`,
    `scripts=${scripts.length} [${scripts.join('; ')}]`,
    `styles=${styles.length} [${styles.join('; ')}]`,
  ].join(' | ');
}

export function logDomSnapshot(tag: string): void {
  bootstrapLog('info', tag, collectDomSnapshot());
}
