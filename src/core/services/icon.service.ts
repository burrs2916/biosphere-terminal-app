import { invoke } from '@tauri-apps/api/core';
import type { IconGroupDto, CustomIconDto } from '../../proto/icon';

export async function listIconGroups(): Promise<IconGroupDto[]> {
  return invoke('list_icon_groups');
}

export async function createIconGroup(name: string, parentId: string | null, sortOrder: number): Promise<IconGroupDto> {
  return invoke('create_icon_group', { name, parentId, sortOrder });
}

export async function updateIconGroup(id: string, name: string, parentId: string | null, sortOrder: number): Promise<IconGroupDto> {
  return invoke('update_icon_group', { id, name, parentId, sortOrder });
}

export async function deleteIconGroup(id: string): Promise<void> {
  return invoke('delete_icon_group', { id });
}

export async function listCustomIcons(groupId?: string): Promise<CustomIconDto[]> {
  return invoke('list_custom_icons', { groupId: groupId || null });
}

export async function uploadCustomIcon(name: string, groupId: string, fileData: Uint8Array, fileName: string): Promise<CustomIconDto> {
  return invoke('upload_custom_icon', { name, groupId, fileData, fileName });
}

export async function deleteCustomIcon(id: string): Promise<void> {
  return invoke('delete_custom_icon', { id });
}

export async function getCustomIconUrls(): Promise<Record<string, string>> {
  return invoke('get_custom_icon_urls');
}

export async function getCustomIconUrl(id: string): Promise<string | null> {
  return invoke('get_custom_icon_url', { id });
}
