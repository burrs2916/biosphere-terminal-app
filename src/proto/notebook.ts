export interface NoteDto {
  id: string;
  title: string;
  filePath: string;
  groupId: string;
  category: string;
  tags: string[];
  wordCount: number;
  isPinned: boolean;
  createdAt: number;
  updatedAt: number;
  summary?: string;
}

export interface NoteDetailDto {
  note: NoteDto;
  content: string;
}

export interface CreateNoteInput {
  title: string;
  content: string;
  groupId: string;
  category: string;
  tags: string[];
}

export interface UpdateNoteInput {
  id: string;
  title: string;
  content: string;
  groupId: string;
  category: string;
  tags: string[];
}

export interface LinkCommandInput {
  noteId: string;
  commandId: string;
  context: string;
}

export interface CommandNoteLinkDto {
  id: string;
  commandId: string;
  noteId: string;
  context: string;
  createdAt: number;
  /** 原命令是否仍存在（命令历史被删后为 false，笔记侧据此显示"已删除"过期提示，R6-4） */
  commandExists: boolean;
}

export interface NoteGroupDto {
  id: string;
  name: string;
  icon: string;
  color: string;
  sortOrder: number;
  noteCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface CreateGroupInput {
  name: string;
  icon: string;
  color: string;
  sortOrder: number;
}

export interface UpdateGroupInput {
  id: string;
  name: string;
  icon: string;
  color: string;
  sortOrder: number;
}

export interface NoteCategoryDto {
  id: string;
  name: string;
  groupId: string;
  isDefault: boolean;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

export interface CreateCategoryInput {
  name: string;
  groupId: string;
  sortOrder: number;
}

export interface UpdateCategoryInput {
  id: string;
  name: string;
  sortOrder: number;
}

export interface NoteTagDto {
  id: string;
  name: string;
  groupId: string;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

export interface CreateTagInput {
  name: string;
  groupId: string;
  sortOrder: number;
}

export interface UpdateTagInput {
  id: string;
  name: string;
  sortOrder: number;
}
