export interface ToolDto {
  name: string;
  version: string;
  path: string;
}

export interface EnvironmentDto {
  os: string;
  osVersion: string;
  arch: string;
  shell: string;
  homeDir: string;
  hostname: string;
  user: string;
  tools: ToolDto[];
}
