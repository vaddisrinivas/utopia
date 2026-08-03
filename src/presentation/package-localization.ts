import type { A2UiLocalization } from "@/packages/shared/contracts/package";

export type PackageLocaleOptions = {
  appLocale?: string;
  deviceLocale?: string;
};

const localizationToken = /^\$l:([A-Za-z0-9._-]+)$/;

export function normalizePackageLocale(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/_/g, "-");
  if (!/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(trimmed)) return null;
  return trimmed.toLowerCase();
}

export function resolvePackageLocaleChain(
  localization: A2UiLocalization | undefined,
  options: PackageLocaleOptions = {},
): string[] {
  const candidates = [
    options.appLocale,
    localization?.appLocale,
    options.deviceLocale,
    localization?.defaultLocale,
    localization?.fallbackLocale,
    "en",
  ];
  const chain: string[] = [];
  for (const candidate of candidates) {
    const normalized = normalizePackageLocale(candidate);
    if (!normalized) continue;
    addLocale(chain, normalized);
    const base = normalized.split("-")[0];
    if (base && base !== normalized) addLocale(chain, base);
  }
  return chain;
}

export function resolvePackageLocale(
  localization: A2UiLocalization | undefined,
  options: PackageLocaleOptions = {},
): string {
  return resolvePackageLocaleChain(localization, options)[0] ?? "en";
}

export function resolveLocalizedText(
  value: unknown,
  localization: A2UiLocalization | undefined,
  options: PackageLocaleOptions = {},
): unknown {
  if (typeof value !== "string") return value;
  const match = localizationToken.exec(value.trim());
  if (!match || !localization) return value;
  const key = match[1];
  for (const locale of resolvePackageLocaleChain(localization, options)) {
    const messages = localization.messages[locale];
    const message = messages?.[key];
    if (typeof message === "string" && message.trim()) return message;
  }
  return value;
}

export function localizePackageUiValue<T>(
  value: T,
  localization: A2UiLocalization | undefined,
  options: PackageLocaleOptions = {},
): T {
  if (typeof value === "string") {
    return resolveLocalizedText(value, localization, options) as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => localizePackageUiValue(item, localization, options)) as T;
  }
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, child]) => [
      key,
      localizePackageUiValue(child, localization, options),
    ]),
  ) as T;
}

export function formatLocalizedText(
  template: unknown,
  fallback: string,
  values: Record<string, string | number> = {},
): string {
  const source = typeof template === "string" && template.trim() ? template : fallback;
  return source.replace(/\{([A-Za-z0-9_]+)\}/g, (token, key: string) => {
    const value = values[key];
    return value === undefined ? token : String(value);
  });
}

function addLocale(chain: string[], locale: string) {
  if (!chain.includes(locale)) chain.push(locale);
}
