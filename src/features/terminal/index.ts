export { TerminalEmulator } from './components/TerminalEmulator';
export type { TerminalEmulatorHandle } from './components/TerminalEmulator';
export { TerminalToolbar } from './components/TerminalToolbar';
export { TerminalStatusBar } from './components/TerminalStatusBar';
export { ConnectionPicker } from './components/ConnectionPicker';
export type { ConnectionPickerResult } from './components/ConnectionPicker';
export { TerminalContextMenu } from './components/TerminalContextMenu';
export { FindBar } from './components/FindBar';
// Independent connection-status state machine — the single source of truth for
// every connection phase indicator (status bar, tab dots, connecting and
// disconnected overlays). Pure functions only: deterministic, stale-safe, and
// impossible to desync from the real session state.
export { initialConn, reduceConn } from './connectionStatus';
export type { ConnStatus, ConnSnapshot, ConnEvent } from './connectionStatus';
