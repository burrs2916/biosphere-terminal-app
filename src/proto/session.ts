export interface TabSession {
  id: string;
  terminalId: string;
  title: string;
  cwd: string;
  isActive: boolean;
}

export type SplitDirection = 'horizontal' | 'vertical';

export interface SplitPane {
  id: string;
  direction: SplitDirection;
  children: LayoutNode[];
  sizes: number[];
}

export type LayoutNode =
  | { type: 'pane'; sessionId: string }
  | { type: 'split'; split: SplitPane };

export interface LayoutConfig {
  root: SplitPane | null;
  activeSessionId: string | null;
}
