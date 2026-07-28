export const APP_PACKAGE_UI_COMPONENT_KINDS = ['recordList', 'metric', 'action', 'text', 'widget'] as const;
export type AppPackageUiComponentKind = typeof APP_PACKAGE_UI_COMPONENT_KINDS[number];
export const APP_PACKAGE_UI_COMPONENT_KIND_SET = new Set<string>([...APP_PACKAGE_UI_COMPONENT_KINDS]);

export const APP_PACKAGE_UI_ACTION_KINDS = ['open_url', 'propose'] as const;
export type AppPackageUiActionKind = typeof APP_PACKAGE_UI_ACTION_KINDS[number];
export const APP_PACKAGE_UI_ACTION_KIND_SET = new Set<string>([...APP_PACKAGE_UI_ACTION_KINDS]);

export const APP_PACKAGE_UI_TONES = ['neutral', 'moss', 'amber', 'plum', 'blue'] as const;
export type AppPackageUiTone = typeof APP_PACKAGE_UI_TONES[number];
export const APP_PACKAGE_UI_TONE_SET = new Set<string>([...APP_PACKAGE_UI_TONES]);

export function isAppPackageUiComponentKind(value: unknown): value is AppPackageUiComponentKind {
  return typeof value === 'string' && APP_PACKAGE_UI_COMPONENT_KIND_SET.has(value);
}

export function isAppPackageUiActionKind(value: unknown): value is AppPackageUiActionKind {
  return typeof value === 'string' && APP_PACKAGE_UI_ACTION_KIND_SET.has(value);
}

export function isAppPackageUiTone(value: unknown): value is AppPackageUiTone {
  return typeof value === 'string' && APP_PACKAGE_UI_TONE_SET.has(value);
}
