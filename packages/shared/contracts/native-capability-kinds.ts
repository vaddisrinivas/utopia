export const APP_PACKAGE_NATIVE_INTENT_KINDS = [
  'share',
  'deep_link',
  'shortcut',
  'voice',
  'background_task',
  'file_open',
  'url_open',
] as const;

export type AppPackageNativeIntentKind = typeof APP_PACKAGE_NATIVE_INTENT_KINDS[number];

export const APP_PACKAGE_NATIVE_INTENT_KIND_SET = new Set<string>([...APP_PACKAGE_NATIVE_INTENT_KINDS]);

export function isAppPackageNativeIntentKind(value: unknown): value is AppPackageNativeIntentKind {
  return typeof value === 'string' && APP_PACKAGE_NATIVE_INTENT_KIND_SET.has(value);
}
