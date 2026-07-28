import type { AppPackageNativeCapability } from './package';

export const SUPPORTED_NATIVE_INTENT_KINDS = ['share', 'deep_link', 'url_open'] as const;

export const SUPPORTED_EXPO_PERMISSION_NAMES = [
  'expo-image-picker:camera',
  'expo-image-picker:media-library',
  'expo-sharing',
] as const;

export const SUPPORTED_ANDROID_PERMISSION_NAMES = [
  'android.permission.health.READ_NUTRITION',
  'android.permission.health.READ_HYDRATION',
  'android.permission.health.READ_STEPS',
  'android.permission.health.READ_ACTIVE_CALORIES_BURNED',
  'android.permission.health.READ_WEIGHT',
  'android.permission.health.WRITE_HYDRATION',
] as const;

const SUPPORTED_NATIVE_INTENTS = new Set<string>([...SUPPORTED_NATIVE_INTENT_KINDS]);
const SUPPORTED_EXPO_PERMISSIONS = new Set<string>([...SUPPORTED_EXPO_PERMISSION_NAMES]);
const SUPPORTED_ANDROID_PERMISSIONS = new Set<string>([...SUPPORTED_ANDROID_PERMISSION_NAMES]);

export function nativeCapabilitySupportErrors(capability: AppPackageNativeCapability): string[] {
  const errors: string[] = [];
  for (const permission of capability.permissions ?? []) {
    const raw = typeof permission === 'string'
      ? { platform: permission.startsWith('android.') ? 'android' : 'expo', permission }
      : permission;
    if (raw.platform === 'android' && !SUPPORTED_ANDROID_PERMISSIONS.has(raw.permission)) {
      errors.push(`unsupported native permission:${raw.permission}`);
    }
    if (raw.platform === 'expo' && !SUPPORTED_EXPO_PERMISSIONS.has(raw.permission)) {
      errors.push(`unsupported native permission:${raw.permission}`);
    }
  }
  for (const intent of capability.intents ?? []) {
    if (!SUPPORTED_NATIVE_INTENTS.has(intent.kind)) {
      errors.push(`unsupported native intent:${intent.kind}`);
    }
  }
  return errors;
}
