import Box from '@mui/material/Box';
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import { AppTheme } from './theme';
import { AppShell, Sidebar, Header, StatusBar } from './components/layout';
import { NotificationProvider } from './core/notification';
import { useLayoutStore, useSettingsStore } from './engine';
import i18n from './core/i18n';
import { TerminalPage } from './pages/TerminalPage';
import { CommandPage } from './pages/CommandPage';
import { ConnectionPage } from './pages/ConnectionPage';
import { PluginPage } from './pages/PluginPage';
import { SettingsPage } from './pages/SettingsPage';
import { NotebookPage } from './pages/NotebookPage';
import { AgentPage } from './pages/AgentPage';
import { ProfilePage } from './pages/ProfilePage';
import { NotFoundPage } from './pages/NotFoundPage';
import { CategoryNotesPage } from './features/notebook/components/CategoryNotesPage';
import { NotesReferencePage } from './features/notebook/components/NotesReferencePage';
import { AiCopilotPage } from './pages/AiCopilotPage';
import { PluginWorkshopPage } from './pages/PluginWorkshopPage';
import { PluginScriptViewerPage } from './pages/PluginScriptViewerPage';

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
              <Route path="/plugins" element={<PluginPage />} />
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
      <Route path="/plugin-workshop" element={<PluginWorkshopPage />} />
      <Route path="/plugin-script-viewer" element={<PluginScriptViewerPage />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}

function RootRouter() {
  const location = useLocation();
  const isStandalone = location.pathname.startsWith('/category-notes') || location.pathname.startsWith('/notes-reference') || location.pathname.startsWith('/ai-copilot') || location.pathname.startsWith('/plugin-workshop') || location.pathname.startsWith('/plugin-script-viewer');

  return isStandalone ? <StandaloneLayout /> : <AppLayout />;
}

export default function App() {
  const initSettings = useSettingsStore((s) => s.init);
  const language = useSettingsStore((s) => s.settings.language);

  useEffect(() => {
    initSettings();
  }, [initSettings]);

  useEffect(() => {
    if (language && i18n.language !== language) {
      i18n.changeLanguage(language);
    }
  }, [language]);

  return (
    <BrowserRouter>
      <AppTheme>
        <NotificationProvider>
          <RootRouter />
        </NotificationProvider>
      </AppTheme>
    </BrowserRouter>
  );
}
