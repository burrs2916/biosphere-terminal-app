export interface TerminalProfile {
  id: string;
  name: string;
  config_json: string;
  is_default: boolean;
  created_at: number;
}

export interface AppearanceConfig {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  cursorStyle: 'block' | 'underline' | 'bar';
  cursorBlink: boolean;
  cursorColor: string;
  foreground: string;
  background: string;
  selectionForeground: string;
  selectionBackground: string;
  colors: string[];
}
