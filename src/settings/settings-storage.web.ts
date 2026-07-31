const STORAGE_KEY = 'utopia.settings.v1';
let volatileSettingsValue: string | null = null;

const SECRET_FIELDS = [
  ['ai', 'primary', 'apiKey'],
  ['ai', 'fallback', 'apiKey'],
  ['notion', 'token'],
  ['sheets', 'token'],
  ['postgres', 'databaseUrl'],
  ['mcp', 'token'],
] as const;

function redactSecrets(value: string): { persisted: string; hadSecrets: boolean } {
  const parsed = JSON.parse(value) as Record<string, any>;
  let hadSecrets = false;
  for (const path of SECRET_FIELDS) {
    let cursor: any = parsed;
    for (const segment of path.slice(0, -1)) cursor = cursor?.[segment];
    const key = path[path.length - 1];
    if (typeof cursor?.[key] === 'string' && cursor[key].length > 0) hadSecrets = true;
    if (cursor && key in cursor) cursor[key] = '';
  }
  return { persisted: JSON.stringify(parsed), hadSecrets };
}

export async function readSettingsValue(): Promise<string | null> {
  if (volatileSettingsValue) return volatileSettingsValue;
  if (typeof localStorage === 'undefined') return null;
  const value = localStorage.getItem(STORAGE_KEY);
  if (!value) return null;
  try {
    const redacted = redactSecrets(value);
    if (redacted.hadSecrets) localStorage.setItem(STORAGE_KEY, redacted.persisted);
    return redacted.persisted;
  } catch {
    localStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

export async function writeSettingsValue(value: string): Promise<void> {
  volatileSettingsValue = value;
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, redactSecrets(value).persisted);
  }
}

export function clearBrowserCredentialState(): void {
  volatileSettingsValue = null;
}
