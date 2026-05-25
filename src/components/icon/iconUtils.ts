export function isCustomIconValue(value: string): boolean {
  return value.startsWith('custom:');
}

export function isMaterialIconValue(value: string): boolean {
  return value.startsWith('material:');
}

export function getMaterialIconName(value: string): string {
  return value.replace('material:', '');
}
