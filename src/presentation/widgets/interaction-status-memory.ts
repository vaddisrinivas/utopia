const STATUS_TTL_MS = 30_000;
const MAX_STATUS_ENTRIES = 100;

type StatusEntry = {
  message: string;
  expiresAt: number;
};

const entries = new Map<string, StatusEntry>();

export function rememberInteractionStatus(key: string, message: string, now = Date.now()): void {
  if (!key) return;
  if (!message) {
    entries.delete(key);
    return;
  }
  entries.set(key, { message, expiresAt: now + STATUS_TTL_MS });
  while (entries.size > MAX_STATUS_ENTRIES) {
    const oldest = entries.keys().next().value;
    if (typeof oldest !== "string") break;
    entries.delete(oldest);
  }
}

export function recallInteractionStatus(key: string, now = Date.now()): string {
  const entry = entries.get(key);
  if (!entry) return "";
  if (entry.expiresAt <= now) {
    entries.delete(key);
    return "";
  }
  return entry.message;
}

export function clearInteractionStatusMemory(): void {
  entries.clear();
}
