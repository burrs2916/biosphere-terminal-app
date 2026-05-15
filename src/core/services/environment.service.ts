import { invoke } from '@tauri-apps/api/core';
import type { EnvironmentDto } from '../../proto/environment';

export async function getEnvironment(): Promise<EnvironmentDto> {
  return invoke('get_environment');
}
