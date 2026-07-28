const STORAGE_KEY = 'utopia.settings.v1';

export async function readSettingsValue(): Promise<string | null> {
  return typeof localStorage === 'undefined' ? null : localStorage.getItem(STORAGE_KEY);
}

export async function writeSettingsValue(value: string): Promise<void> {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, value);
  }
}
