import { invoke } from '@tauri-apps/api/core';
import type { NoteDto, NoteDetailDto, CreateNoteInput, UpdateNoteInput, LinkCommandInput, CommandNoteLinkDto, NoteGroupDto, CreateGroupInput, UpdateGroupInput, NoteCategoryDto, CreateCategoryInput, UpdateCategoryInput } from '../../proto/notebook';

export async function listNotes(groupId?: string, category?: string, search?: string): Promise<NoteDto[]> {
  return invoke('list_notes', { groupId: groupId || null, category: category || null, search: search || null });
}

export async function getNote(id: string): Promise<NoteDetailDto | null> {
  return invoke('get_note', { id });
}

export async function createNote(input: CreateNoteInput): Promise<NoteDto> {
  return invoke('create_note', { input });
}

export async function updateNote(input: UpdateNoteInput): Promise<NoteDto> {
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

export async function deleteNoteGroup(id: string): Promise<void> {
  return invoke('delete_note_group', { id });
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
