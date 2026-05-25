import { invoke } from '@tauri-apps/api/core';
import type { TerminalProfile } from '../../proto';

export async function listProfiles(): Promise<TerminalProfile[]> {
  return invoke('list_profiles');
}

export async function getDefaultProfile(): Promise<TerminalProfile | null> {
  const profiles = await listProfiles();
  return profiles.find((p) => p.is_default) ?? profiles[0] ?? null;
}

export async function saveProfile(profile: TerminalProfile): Promise<void> {
  return invoke('save_profile', { profile });
}

export async function deleteProfile(id: string): Promise<void> {
  return invoke('delete_profile', { id });
}
