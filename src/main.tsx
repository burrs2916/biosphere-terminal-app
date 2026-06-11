import {
  installBootstrapDiagnostics,
  bootstrapLog,
  logDomSnapshot,
  collectDomSnapshot,
} from './core/bootstrapDiagnostics';

installBootstrapDiagnostics();
bootstrapLog('info', 'main', 'main.tsx evaluating');

let React: typeof import('react');
let ReactDOM: typeof import('react-dom/client');
let App: typeof import('./App').default;

try {
  bootstrapLog('info', 'main', 'importing react');
  React = await import('react');
  bootstrapLog('info', 'main', 'importing react-dom/client');
  ReactDOM = await import('react-dom/client');
  bootstrapLog('info', 'main', 'importing ./core/i18n');
  await import('./core/i18n');
  bootstrapLog('info', 'main', 'importing ./App');
  App = (await import('./App')).default;
  bootstrapLog('info', 'main', 'all imports succeeded');
} catch (error) {
  bootstrapLog(
    'error',
    'main.import',
    error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error),
  );
  throw error;
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  bootstrapLog('error', 'main', '#root element not found');
  throw new Error('#root element not found');
}

bootstrapLog('info', 'main', `creating React root | ${collectDomSnapshot()}`);
const root = ReactDOM.createRoot(rootElement);

try {
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
  bootstrapLog('info', 'main', 'root.render() called');
  queueMicrotask(() => logDomSnapshot('post-render-microtask'));
  setTimeout(() => logDomSnapshot('post-render-100ms'), 100);
  setTimeout(() => logDomSnapshot('post-render-1000ms'), 1000);
} catch (error) {
  bootstrapLog(
    'error',
    'main.render',
    error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error),
  );
  throw error;
}
