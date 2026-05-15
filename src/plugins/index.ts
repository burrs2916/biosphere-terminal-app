export interface FrontendPlugin {
  id: string;
  name: string;
}

export const builtinPlugins: FrontendPlugin[] = [
  { id: 'system-monitor', name: 'System Monitor' },
  { id: 'git-tools', name: 'Git Tools' },
  { id: 'file-ops', name: 'File Operations' },
];

export const allFrontendPlugins: FrontendPlugin[] = [
  ...builtinPlugins,
];
