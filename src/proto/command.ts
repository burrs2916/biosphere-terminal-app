export interface LinkedNoteInfo {
  linkId: string;
  noteId: string;
  title: string;
  category: string;
  groupId: string;
}

export interface CommandHistoryEntry {
  id: string;
  session_id: string | null;
  command: string;
  cwd: string;
  exit_code: number | null;
  executed_at: number;
  linked?: boolean;
  linked_notes?: LinkedNoteInfo[];
}

export interface CommandSnippet {
  id: string;
  name: string;
  command: string;
  description: string;
  tags: string[];
  created_at: number;
}

export interface ParsedCommandResult {
  entryId: string;
  program: string;
  args: string[];
  hasPipe: boolean;
  hasRedirect: boolean;
  isBackground: boolean;
  isDangerous: boolean;
}
