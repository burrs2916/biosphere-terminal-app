import Box from '@mui/material/Box';
import { HashRouter, Routes, Route, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import { initWindowCloseFlush } from './features/notebook/utils/registerWindowCloseFlush';
import { AppTheme } from './theme';
import { AppShell, Sidebar, Header, StatusBar } from './components/layout';
import { NotificationProvider } from './core/notification';
import { ErrorBoundary } from './components/ErrorBoundary';
import { useLayoutStore, useSettingsStore } from './engine';
import i18n from './core/i18n';
import { TerminalPage } from './pages/TerminalPage';
import { CommandPage } from './pages/CommandPage';
import { ConnectionPage } from './pages/ConnectionPage';
import { SettingsPage } from './pages/SettingsPage';
import { NotebookPage } from './pages/NotebookPage';
import { AgentPage } from './pages/AgentPage';
import { ProfilePage } from './pages/ProfilePage';
import { NotFoundPage } from './pages/NotFoundPage';
import { CategoryNotesPage } from './features/notebook/components/CategoryNotesPage';
import { NotesReferencePage } from './features/notebook/components/NotesReferencePage';
import { AiCopilotPage } from './pages/AiCopilotPage';
import { RemoteDesktopPage } from './pages/RemoteDesktopPage';
import { LicenseProvider, UpgradeDialog } from './features/licensing';

function AppLayout() {
  const sidebarOpen = useLayoutStore((s) => s.sidebarOpen);
  const toggleSidebar = useLayoutStore((s) => s.toggleSidebar);
  const showStatusBar = useSettingsStore((s) => s.settings.showStatusBar);
  const location = useLocation();
  const isTerminal = location.pathname === '/';

  return (
    <AppShell>
      <Header onToggleSidebar={toggleSidebar} />
      <Box sx={{ display: 'flex', flex: 1, overflow: 'hidden', mt: '48px' }}>
        <Sidebar open={sidebarOpen} />
        <Box
          component="main"
          sx={{
            flexGrow: 1,
            overflow: 'auto',
            display: 'flex',
            flexDirection: 'column',
            position: 'relative',
          }}
        >
          <Box
            sx={{
              position: 'absolute',
              inset: isTerminal ? 0 : undefined,
              width: isTerminal ? 'auto' : 0,
              height: isTerminal ? 'auto' : 0,
              overflow: 'hidden',
              visibility: isTerminal ? 'visible' : 'hidden',
              display: 'flex',
              flexDirection: 'column',
              zIndex: isTerminal ? 1 : -1,
            }}
          >
            <TerminalPage />
          </Box>

          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              height: '100%',
              visibility: isTerminal ? 'hidden' : 'visible',
              position: isTerminal ? 'absolute' : 'relative',
              inset: isTerminal ? 0 : undefined,
              width: isTerminal ? 0 : 'auto',
              overflow: isTerminal ? 'hidden' : 'visible',
              zIndex: isTerminal ? -1 : 1,
            }}
          >
            <Routes>
              <Route path="/commands" element={<CommandPage />} />
              <Route path="/notebook" element={<NotebookPage />} />
              <Route path="/agent" element={<AgentPage />} />
              <Route path="/connections" element={<ConnectionPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/profile" element={<ProfilePage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </Box>
        </Box>
      </Box>
      {showStatusBar && <StatusBar />}
    </AppShell>
  );
}

function StandaloneLayout() {
  return (
    <Routes>
      <Route path="/category-notes" element={<CategoryNotesPage />} />
      <Route path="/notes-reference" element={<NotesReferencePage />} />
      <Route path="/ai-copilot" element={<AiCopilotPage />} />
      <Route path="/remote-desktop" element={<RemoteDesktopPage />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}

function RootRouter() {
  const location = useLocation();
  // HashRouter: path-only urls (e.g. "/category-notes") are loaded as pathname "/" with hash "#/..."
  // WebviewWindow urls (e.g. "/#/category-notes") are loaded as pathname "/<any>" with hash "#/category-notes"
  // So we need to inspect both pathname AND hash to determine if we are in a standalone window.
  const checkPath = (location.hash.replace(/^#/, '') || location.pathname);
  const isStandalone = checkPath.startsWith('/category-notes') || checkPath.startsWith('/notes-reference') || checkPath.startsWith('/ai-copilot') || checkPath.startsWith('/remote-desktop');

  return isStandalone ? <StandaloneLayout /> : <AppLayout />;
}

export default function App() {
  const initSettings = useSettingsStore((s) => s.init);
  const language = useSettingsStore((s) => s.settings.language);

  useEffect(() => {
    initSettings();
  }, [initSettings]);

  useEffect(() => {
    // 关窗前 flush 所有未落盘笔记改动，避免 2s 自动保存防抖窗口内输入丢失（R6-1）。
    void initWindowCloseFlush();
  }, []);

  useEffect(() => {
    if (language && i18n.language !== language) {
      i18n.changeLanguage(language);
    }
  }, [language]);

  return (
    <HashRouter>
      <AppTheme>
        <LicenseProvider>
          <NotificationProvider>
            <ErrorBoundary>
              <RootRouter />
              <UpgradeDialog />
            </ErrorBoundary>
          </NotificationProvider>
        </LicenseProvider>
      </AppTheme>
    </HashRouter>
  );
}
