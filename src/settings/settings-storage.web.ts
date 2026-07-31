const STORAGE_KEY = 'utopia.settings.v1';
let volatileSettingsValue: string | null = null;

const SECRET_KEY = /(?:api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|token|password|passphrase|secret|client[_-]?secret|database[_-]?url|connection[_-]?string|authorization|cookie|private[_-]?key|credential)/i;

export function redactBrowserCredentialPayload(value: string): { persisted: string; hadSecrets: boolean } {
  const parsed = JSON.parse(value) as unknown;
  let hadSecrets = false;

  const redact = (current: unknown): unknown => {
    if (Array.isArray(current)) return current.map(redact);
    if (!current || typeof current !== 'object') return current;
    return Object.fromEntries(Object.entries(current).flatMap(([key, child]) => {
      if (SECRET_KEY.test(key)) {
        if (child !== undefined && child !== null && child !== '') hadSecrets = true;
        return [];
      }
      return [[key, redact(child)]];
    }));
  };

  return { persisted: JSON.stringify(redact(parsed)), hadSecrets };
}

export async function readSettingsValue(): Promise<string | null> {
  if (volatileSettingsValue) return volatileSettingsValue;
  if (typeof localStorage === 'undefined') return null;
  const value = localStorage.getItem(STORAGE_KEY);
  if (!value) return null;
  try {
    const redacted = redactBrowserCredentialPayload(value);
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
    localStorage.setItem(STORAGE_KEY, redactBrowserCredentialPayload(value).persisted);
  }
}

export function clearBrowserCredentialState(): void {
  volatileSettingsValue = null;
}
