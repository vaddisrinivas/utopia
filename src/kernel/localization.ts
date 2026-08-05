type Localization = {
  defaultLocale: string;
  fallbackLocale?: string;
  appLocale?: string;
  messages: Record<string, Record<string, string>>;
};

const token = /^\$l:([A-Za-z0-9._-]+)$/;
const locale = (value?: string) => value?.trim().replace(/_/g, '-').toLowerCase();

export function localeChain(source?: Localization, deviceLocale?: string): string[] {
  const result: string[] = [];
  for (const candidate of [source?.appLocale, deviceLocale, source?.defaultLocale, source?.fallbackLocale, 'en']) {
    const normalized = locale(candidate);
    if (!normalized) continue;
    for (const item of [normalized, normalized.split('-')[0]]) if (item && !result.includes(item)) result.push(item);
  }
  return result;
}

export function localize<T>(value: T, source?: Localization, deviceLocale?: string): T {
  if (typeof value === 'string') {
    const key = token.exec(value.trim())?.[1];
    if (!key || !source) return value;
    return (localeChain(source, deviceLocale).map((name) => source.messages[name]?.[key]).find(Boolean) ?? value) as T;
  }
  if (Array.isArray(value)) return value.map((item) => localize(item, source, deviceLocale)) as T;
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, localize(child, source, deviceLocale)])) as T;
}
