import type { AppPackageNativeCapability } from './package';

export const UTOPIA_RUNTIME_PLATFORMS = ['web', 'android', 'ios', 'macos'] as const;
export type UtopiaRuntimePlatform = typeof UTOPIA_RUNTIME_PLATFORMS[number];
export type NativeCapabilitySupportState = 'supported' | 'planned' | 'unsupported';

export const SUPPORTED_NATIVE_INTENT_KINDS = ['share', 'deep_link', 'shortcut', 'voice', 'background_task', 'file_open', 'url_open'] as const;

export const SUPPORTED_EXPO_PERMISSION_NAMES = [
  'expo-image-picker:camera',
  'expo-image-picker:media-library',
  'expo-sharing',
  'expo-document-picker',
  'expo-file-system',
  'expo-audio',
  'expo-camera',
  'expo-calendar',
  'expo-contacts',
  'expo-local-authentication',
  'expo-location',
  'expo-location:background',
  'expo-notifications',
  'expo-sensors',
  'expo-speech',
  'expo-task-manager',
  'expo-video',
] as const;

export const SUPPORTED_ANDROID_PERMISSION_NAMES = [
  'android.permission.CAMERA',
  'android.permission.RECORD_AUDIO',
  'android.permission.POST_NOTIFICATIONS',
  'android.permission.ACCESS_FINE_LOCATION',
  'android.permission.ACCESS_COARSE_LOCATION',
  'android.permission.READ_CONTACTS',
  'android.permission.READ_CALENDAR',
  'android.permission.WRITE_CALENDAR',
  'android.permission.health.READ_NUTRITION',
  'android.permission.health.READ_HYDRATION',
  'android.permission.health.READ_STEPS',
  'android.permission.health.READ_ACTIVE_CALORIES_BURNED',
  'android.permission.health.READ_WEIGHT',
  'android.permission.health.WRITE_HYDRATION',
] as const;

export const SUPPORTED_IOS_PERMISSION_NAMES = [
  'ios.permission.camera',
  'ios.permission.microphone',
  'ios.permission.photos',
  'ios.permission.notifications',
  'ios.permission.location',
  'ios.permission.contacts',
  'ios.permission.calendar',
  'ios.permission.speech',
  'ios.permission.health',
  'ios.permission.biometrics',
] as const;

export const SUPPORTED_WEB_PERMISSION_NAMES = [
  'web.permission.camera',
  'web.permission.microphone',
  'web.permission.notifications',
  'web.permission.geolocation',
  'web.permission.file-system',
] as const;

export const SUPPORTED_MACOS_PERMISSION_NAMES = [
  'macos.permission.files',
  'macos.permission.microphone',
  'macos.permission.speech',
  'macos.permission.notifications',
  'macos.permission.contacts',
  'macos.permission.calendar',
  'macos.permission.location',
  'macos.permission.health',
  'macos.permission.biometrics',
] as const;

const SUPPORTED_NATIVE_INTENTS = new Set<string>([...SUPPORTED_NATIVE_INTENT_KINDS]);
const SUPPORTED_EXPO_PERMISSIONS = new Set<string>([...SUPPORTED_EXPO_PERMISSION_NAMES]);
const SUPPORTED_ANDROID_PERMISSIONS = new Set<string>([...SUPPORTED_ANDROID_PERMISSION_NAMES]);
const SUPPORTED_IOS_PERMISSIONS = new Set<string>([...SUPPORTED_IOS_PERMISSION_NAMES]);
const SUPPORTED_WEB_PERMISSIONS = new Set<string>([...SUPPORTED_WEB_PERMISSION_NAMES]);
const SUPPORTED_MACOS_PERMISSIONS = new Set<string>([...SUPPORTED_MACOS_PERMISSION_NAMES]);

export type NativeCapabilityMatrixEntry = Readonly<{
  id: string;
  kind: 'permission' | 'intent';
  support: Readonly<Record<UtopiaRuntimePlatform, NativeCapabilitySupportState>>;
  label: string;
}>;

export const NATIVE_CAPABILITY_MATRIX: readonly NativeCapabilityMatrixEntry[] = [
  permissionEntry('camera', { web: 'supported', android: 'supported', ios: 'supported', macos: 'planned' }),
  permissionEntry('microphone', { web: 'supported', android: 'supported', ios: 'supported', macos: 'planned' }),
  permissionEntry('files', { web: 'supported', android: 'supported', ios: 'supported', macos: 'planned' }),
  permissionEntry('notifications', { web: 'planned', android: 'supported', ios: 'planned', macos: 'planned' }),
  permissionEntry('location', { web: 'planned', android: 'supported', ios: 'planned', macos: 'planned' }),
  permissionEntry('contacts', { web: 'unsupported', android: 'planned', ios: 'planned', macos: 'planned' }),
  permissionEntry('calendar', { web: 'unsupported', android: 'planned', ios: 'planned', macos: 'planned' }),
  permissionEntry('speech', { web: 'planned', android: 'planned', ios: 'planned', macos: 'planned' }),
  permissionEntry('health', { web: 'unsupported', android: 'supported', ios: 'planned', macos: 'planned' }),
  permissionEntry('biometrics', { web: 'planned', android: 'planned', ios: 'planned', macos: 'planned' }),
  permissionEntry('sensors', { web: 'planned', android: 'planned', ios: 'planned', macos: 'unsupported' }),
  intentEntry('share', { web: 'supported', android: 'supported', ios: 'supported', macos: 'planned' }),
  intentEntry('deep_link', { web: 'supported', android: 'supported', ios: 'supported', macos: 'supported' }),
  intentEntry('url_open', { web: 'supported', android: 'supported', ios: 'supported', macos: 'supported' }),
  intentEntry('file_open', { web: 'planned', android: 'planned', ios: 'planned', macos: 'planned' }),
  intentEntry('background_task', { web: 'planned', android: 'planned', ios: 'planned', macos: 'planned' }),
  intentEntry('voice', { web: 'planned', android: 'planned', ios: 'planned', macos: 'planned' }),
  intentEntry('shortcut', { web: 'unsupported', android: 'planned', ios: 'planned', macos: 'planned' }),
] as const;

export type NativeCapabilityFinding = Readonly<{
  id: string;
  kind: 'permission' | 'intent';
  required: boolean;
  platform: string;
  targetPlatforms: readonly UtopiaRuntimePlatform[];
  support: readonly { platform: UtopiaRuntimePlatform; state: NativeCapabilitySupportState }[];
  message: string;
}>;

export function nativeCapabilitySupportErrors(
  capability: AppPackageNativeCapability,
  options: { targetPlatforms?: readonly UtopiaRuntimePlatform[] } = {},
): string[] {
  return nativeCapabilitySupportFindings(capability, options)
    .filter((finding) => finding.required || finding.message.startsWith('unsupported native '))
    .map((finding) => finding.message);
}

export function nativeCapabilitySupportFindings(
  capability: AppPackageNativeCapability,
  options: { targetPlatforms?: readonly UtopiaRuntimePlatform[] } = {},
): NativeCapabilityFinding[] {
  const findings: NativeCapabilityFinding[] = [];
  for (const permission of capability.permissions ?? []) {
    const raw = typeof permission === 'string'
      ? { platform: permission.startsWith('android.') ? 'android' : 'expo', permission, required: true }
      : permission;
    const required = raw.required !== false;
    const targetPlatforms = scopedTargetPlatforms(raw.platform, options.targetPlatforms);
    if (!knownPermission(raw.platform, raw.permission)) {
      findings.push({
        id: raw.permission,
        kind: 'permission',
        required,
        platform: raw.platform,
        targetPlatforms,
        support: targetPlatforms.map((platform) => ({ platform, state: 'unsupported' as const })),
        message: `unsupported native permission:${raw.permission}`,
      });
      continue;
    }
    findings.push(...matrixFindings({
      id: raw.permission,
      capabilityId: permissionCapabilityId(raw.permission),
      kind: 'permission',
      required,
      platform: raw.platform,
      targetPlatforms,
      unsupportedMessage: `unsupported native permission:${raw.permission}`,
    }));
  }
  for (const intent of capability.intents ?? []) {
    const required = intent.required !== false;
    const targetPlatforms = scopedTargetPlatforms(intent.platform, options.targetPlatforms);
    if (!SUPPORTED_NATIVE_INTENTS.has(intent.kind)) {
      findings.push({
        id: intent.kind,
        kind: 'intent',
        required,
        platform: intent.platform,
        targetPlatforms,
        support: targetPlatforms.map((platform) => ({ platform, state: 'unsupported' as const })),
        message: `unsupported native intent:${intent.kind}`,
      });
      continue;
    }
    findings.push(...matrixFindings({
      id: intent.kind,
      capabilityId: intent.kind,
      kind: 'intent',
      required,
      platform: intent.platform,
      targetPlatforms,
      unsupportedMessage: `unsupported native intent:${intent.kind}`,
    }));
  }
  return findings;
}

export function nativeCapabilityMatrixRows(): readonly NativeCapabilityMatrixEntry[] {
  return NATIVE_CAPABILITY_MATRIX;
}

function matrixFindings(input: {
  id: string;
  capabilityId: string;
  kind: 'permission' | 'intent';
  required: boolean;
  platform: string;
  targetPlatforms: readonly UtopiaRuntimePlatform[];
  unsupportedMessage: string;
}): NativeCapabilityFinding[] {
  const entry = NATIVE_CAPABILITY_MATRIX.find((item) => item.id === input.capabilityId && item.kind === input.kind);
  if (!entry) {
    return [{
      id: input.id,
      kind: input.kind,
      required: input.required,
      platform: input.platform,
      targetPlatforms: input.targetPlatforms,
      support: input.targetPlatforms.map((platform) => ({ platform, state: 'unsupported' as const })),
      message: input.unsupportedMessage,
    }];
  }
  const support = input.targetPlatforms.map((platform) => ({ platform, state: entry.support[platform] }));
  const unsupported = support.filter((item) => item.state !== 'supported');
  if (unsupported.length === 0) return [];
  return [{
    id: input.id,
    kind: input.kind,
    required: input.required,
    platform: input.platform,
    targetPlatforms: input.targetPlatforms,
    support,
    message: `native ${input.kind} unavailable:${input.id} (${unsupported.map((item) => `${item.platform}:${item.state}`).join(',')})`,
  }];
}

function scopedTargetPlatforms(platform: string, override: readonly UtopiaRuntimePlatform[] | undefined): UtopiaRuntimePlatform[] {
  const base = override?.length ? [...override] : [...UTOPIA_RUNTIME_PLATFORMS];
  if (platform === 'expo') return base.filter((item) => item !== 'macos');
  if (isRuntimePlatform(platform)) return base.filter((item) => item === platform);
  return base;
}

function isRuntimePlatform(value: string): value is UtopiaRuntimePlatform {
  return (UTOPIA_RUNTIME_PLATFORMS as readonly string[]).includes(value);
}

function knownPermission(platform: string, permission: string): boolean {
  if (platform === 'android') return SUPPORTED_ANDROID_PERMISSIONS.has(permission);
  if (platform === 'expo') return SUPPORTED_EXPO_PERMISSIONS.has(permission);
  if (platform === 'ios') return SUPPORTED_IOS_PERMISSIONS.has(permission);
  if (platform === 'web') return SUPPORTED_WEB_PERMISSIONS.has(permission);
  if (platform === 'macos') return SUPPORTED_MACOS_PERMISSIONS.has(permission);
  return false;
}

function permissionCapabilityId(permission: string): string {
  if (permission.includes('CAMERA') || permission.includes('camera')) return 'camera';
  if (permission.includes('RECORD_AUDIO') || permission.includes('microphone') || permission.includes('expo-audio')) return 'microphone';
  if (permission.includes('POST_NOTIFICATIONS') || permission.includes('notifications')) return 'notifications';
  if (permission.includes('LOCATION') || permission.includes('geolocation') || permission.includes('location')) return 'location';
  if (permission.includes('CONTACTS') || permission.includes('contacts')) return 'contacts';
  if (permission.includes('CALENDAR') || permission.includes('calendar')) return 'calendar';
  if (permission.includes('speech')) return 'speech';
  if (permission.includes('local-authentication')) return 'biometrics';
  if (permission.includes('sensors')) return 'sensors';
  if (permission.includes('health')) return 'health';
  if (permission.includes('biometrics')) return 'biometrics';
  if (permission.includes('file') || permission.includes('document') || permission.includes('sharing') || permission.includes('media-library')) return 'files';
  return permission;
}

function permissionEntry(
  id: string,
  support: Record<UtopiaRuntimePlatform, NativeCapabilitySupportState>,
): NativeCapabilityMatrixEntry {
  return { id, kind: 'permission', support, label: title(id) };
}

function intentEntry(
  id: string,
  support: Record<UtopiaRuntimePlatform, NativeCapabilitySupportState>,
): NativeCapabilityMatrixEntry {
  return { id, kind: 'intent', support, label: title(id) };
}

function title(value: string): string {
  return value.replace(/[_-]/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}
