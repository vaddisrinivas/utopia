import { Platform } from 'react-native';

import type { LifecycleConfirmation } from '@/src/domain/package-install';

export const AUDIO_LOOP_PACKAGE_ID = 'audio-loop-108' as const;
export const AUDIO_LOOP_DEEP_LINK_INTENT_ID = 'open-audio-loop';
export const AUDIO_LOOP_VOICE_INTENT_ID = 'start-audio-loop-voice';

export const AUDIO_LOOP_REQUIRED_PACKAGES = ['expo-audio', 'expo-document-picker'] as const;

export type AudioLoopRuntimePackage = Readonly<{
  id: string;
  nativeCapabilities?: {
    platform: string;
    packages: readonly string[];
    permissions?: readonly (string | {
      id: string;
      platform: string;
      permission: string;
      reason: string;
      required?: boolean;
    })[];
    intents?: readonly {
      id: string;
      platform: string;
      kind: string;
      reason: string;
      required?: boolean;
      payload?: Record<string, unknown>;
    }[];
  } | null;
}>;

export type AudioLoopContractRuntimeCheck = Readonly<{
  supported: boolean;
  reason: string;
  supportsEntryPath: boolean;
}>;

export function checkAudioLoopContractSupport(
  runtimePackage: AudioLoopRuntimePackage | null,
  runtimePlatform: string = Platform.OS,
): AudioLoopContractRuntimeCheck {
  if (runtimePlatform !== 'android') {
    return {
      supported: false,
      reason: 'Audio Loop contract is Android-only.',
      supportsEntryPath: false,
    };
  }

  if (!runtimePackage) {
    return {
      supported: false,
      reason: 'No active package loaded.',
      supportsEntryPath: false,
    };
  }

  if (runtimePackage.id !== AUDIO_LOOP_PACKAGE_ID) {
    return {
      supported: false,
      reason: `Active package ${runtimePackage.id} is not the Audio Loop contract package.`,
      supportsEntryPath: false,
    };
  }

  const nativeCapabilities = runtimePackage.nativeCapabilities;
  if (!nativeCapabilities) {
    return {
      supported: false,
      reason: 'Audio Loop is missing native capabilities.',
      supportsEntryPath: false,
    };
  }

  if (nativeCapabilities.platform !== 'android') {
    return {
      supported: false,
      reason: `Audio Loop native capabilities are for ${nativeCapabilities.platform}, not Android.`,
      supportsEntryPath: false,
    };
  }

  const presentPackages = new Set(nativeCapabilities.packages);
  const missingPackages = AUDIO_LOOP_REQUIRED_PACKAGES.filter((requiredPackage) => !presentPackages.has(requiredPackage));
  if (missingPackages.length > 0) {
    return {
      supported: false,
      reason: `Audio Loop contract is missing required packages: ${missingPackages.join(', ')}`,
      supportsEntryPath: false,
    };
  }

  const supportsEntryPath = (nativeCapabilities.intents ?? []).some((intent) => {
    if (intent.platform !== 'android') return false;
    if (intent.id !== AUDIO_LOOP_DEEP_LINK_INTENT_ID && intent.id !== AUDIO_LOOP_VOICE_INTENT_ID) return false;
    return intent.kind === 'deep_link' || intent.kind === 'voice';
  });

  if (!supportsEntryPath) {
    return {
      supported: false,
      reason: 'Audio Loop does not declare a supported deep-link or voice entry path.',
      supportsEntryPath: false,
    };
  }

  return {
    supported: true,
    reason: 'Audio Loop native contract is supported.',
    supportsEntryPath: true,
  };
}

export function audioLoopNeedsExplicitStartConfirmation(input: {
  requireStartConfirmation: boolean;
  source: 'imported' | 'recorded' | 'stream';
}): boolean {
  return input.requireStartConfirmation || input.source === 'recorded';
}

export function buildAudioLoopStartConfirmation(
  fileLabel: string,
  source: 'imported' | 'recorded' | 'stream',
): LifecycleConfirmation {
  const sourceLabel = source === 'recorded'
    ? 'from recorded audio'
    : source === 'stream'
      ? 'from stream source'
      : 'from selected file';

  return {
    title: 'Start playback?',
    message: `Start ${sourceLabel} ${fileLabel ? `"${fileLabel}" ` : ''}only after confirming this action.`,
    confirmLabel: 'Start loop',
  };
}
