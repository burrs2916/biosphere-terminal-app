import { invoke } from '@tauri-apps/api/core';
import type { NoteDto, NoteDetailDto, CreateNoteInput, UpdateNoteInput, LinkCommandInput, CommandNoteLinkDto, NoteGroupDto, CreateGroupInput, UpdateGroupInput, NoteCategoryDto, CreateCategoryInput, UpdateCategoryInput, NoteTagDto, CreateTagInput, UpdateTagInput } from '../../proto/notebook';

/**
 * `updateNote` 的返回结构：note 本体 + 切组时后端对 category 的自动重置标记。
 * 后端在 `update_note_with_outcome` 中若发现目标分组没有原 category 名字，
 * 会把 category 强制改为目标分组的默认 uncategorized 名字，并通过此结构告知前端。
 * 之前 `updateNote` 返 `NoteDto` 直接 → 前端无法得知"分类被静默改了"，切到新组后
 * 看到分类下拉里没有自己原来选的那项，体感像"被吞了"。
 */
export interface UpdateNoteResult {
  note: NoteDto;
  categoryReset: { from: string; to: string; targetGroup: string } | null;
}

export async function listNotes(groupId?: string, category?: string, search?: string): Promise<NoteDto[]> {
  return invoke('list_notes', { groupId: groupId || null, category: category || null, search: search || null });
}

export async function getNote(id: string): Promise<NoteDetailDto | null> {
  return invoke('get_note', { id });
}

export async function createNote(input: CreateNoteInput): Promise<NoteDto> {
  return invoke('create_note', { input });
}

export async function updateNote(input: UpdateNoteInput): Promise<UpdateNoteResult> {
  return invoke('update_note', { input });
}

export async function deleteNote(id: string): Promise<void> {
  return invoke('delete_note', { id });
}

export async function togglePinNote(id: string): Promise<NoteDto> {
  return invoke('toggle_pin_note', { id });
}

export async function searchNotes(query: string): Promise<NoteDto[]> {
  return invoke('search_notes', { query });
}

export async function listNoteCategories(): Promise<string[]> {
  return invoke('list_note_categories');
}

export async function linkCommandToNote(input: LinkCommandInput): Promise<void> {
  return invoke('link_command_to_note', { input });
}

export async function getLinkedCommands(noteId: string): Promise<CommandNoteLinkDto[]> {
  return invoke('get_linked_commands', { noteId });
}

export async function getLinkedNotes(commandId: string): Promise<CommandNoteLinkDto[]> {
  return invoke('get_linked_notes', { commandId });
}

export async function unlinkCommandNote(linkId: string): Promise<void> {
  return invoke('unlink_command_note', { linkId });
}

export async function getNotesForCommandText(commandText: string): Promise<Array<{ linkId: string; noteId: string; title: string; category: string; groupId: string; context: string; createdAt: number }>> {
  return invoke('get_notes_for_command_text', { commandText });
}

export async function listNoteGroups(): Promise<NoteGroupDto[]> {
  return invoke('list_note_groups');
}

export async function createNoteGroup(input: CreateGroupInput): Promise<NoteGroupDto> {
  return invoke('create_note_group', { input });
}

export async function updateNoteGroup(input: UpdateGroupInput): Promise<NoteGroupDto> {
  return invoke('update_note_group', { input });
}

export async function deleteNoteGroup(
  id: string,
  targetGroupId?: string | null,
  deleteNotes?: boolean,
): Promise<void> {
  return invoke('delete_note_group', {
    id,
    targetGroupId: targetGroupId ?? null,
    deleteNotes: deleteNotes ?? false,
  });
}

export async function listNoteCategoriesByGroup(groupId: string): Promise<NoteCategoryDto[]> {
  return invoke('list_note_categories_by_group', { groupId });
}

export async function createNoteCategory(input: CreateCategoryInput): Promise<NoteCategoryDto> {
  return invoke('create_note_category', { input });
}

export async function updateNoteCategory(input: UpdateCategoryInput): Promise<NoteCategoryDto> {
  return invoke('update_note_category', { input });
}

export async function deleteNoteCategory(id: string): Promise<void> {
  return invoke('delete_note_category', { id });
}

export async function listNoteTagsByGroup(groupId: string): Promise<NoteTagDto[]> {
  return invoke('list_note_tags_by_group', { groupId });
}

export async function createNoteTag(input: CreateTagInput): Promise<NoteTagDto> {
  return invoke('create_note_tag', { input });
}

export async function updateNoteTag(input: UpdateTagInput): Promise<NoteTagDto> {
  return invoke('update_note_tag', { input });
}

export async function deleteNoteTag(id: string): Promise<void> {
  return invoke('delete_note_tag', { id });
}
