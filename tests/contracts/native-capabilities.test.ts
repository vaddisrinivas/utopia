import { describe, expect, it } from 'vitest';

import {
  UTOPIA_RUNTIME_PLATFORMS,
  nativeCapabilityMatrixRows,
  nativeCapabilitySupportErrors,
  nativeCapabilitySupportFindings,
} from '@/packages/shared/contracts/native-capabilities';
import type { AppPackageNativeCapability } from '@/packages/shared/contracts/package';

describe('native capability matrix', () => {
  it('covers every runtime platform for every capability row', () => {
    expect(UTOPIA_RUNTIME_PLATFORMS).toEqual(['web', 'android', 'ios', 'macos']);
    for (const row of nativeCapabilityMatrixRows()) {
      expect(Object.keys(row.support).sort()).toEqual([...UTOPIA_RUNTIME_PLATFORMS].sort());
    }
  });

  it('reports optional planned support without blocking install validation', () => {
    const capability: AppPackageNativeCapability = {
      schemaVersion: 'wonder.app-package-native-capabilities.v1',
      platform: 'ios',
      packages: ['expo-speech'],
      permissions: [{
        id: 'dictation',
        platform: 'ios',
        permission: 'ios.permission.speech',
        reason: 'Dictate app notes.',
        required: false,
      }],
    };

    expect(nativeCapabilitySupportErrors(capability)).toEqual([]);
    expect(nativeCapabilitySupportFindings(capability)).toContainEqual(expect.objectContaining({
      id: 'ios.permission.speech',
      required: false,
      message: 'native permission unavailable:ios.permission.speech (ios:planned)',
    }));
  });

  it('blocks required planned or unknown capabilities', () => {
    const requiredPlanned: AppPackageNativeCapability = {
      schemaVersion: 'wonder.app-package-native-capabilities.v1',
      platform: 'ios',
      packages: ['expo-speech'],
      permissions: [{
        id: 'dictation',
        platform: 'ios',
        permission: 'ios.permission.speech',
        reason: 'Dictation is required.',
        required: true,
      }],
    };
    const unknownOptional: AppPackageNativeCapability = {
      schemaVersion: 'wonder.app-package-native-capabilities.v1',
      platform: 'android',
      packages: ['native-unknown'],
      permissions: [{
        id: 'bluetooth-admin',
        platform: 'android',
        permission: 'android.permission.BLUETOOTH_ADMIN',
        reason: 'Broad Bluetooth control.',
        required: false,
      }],
    };

    expect(nativeCapabilitySupportErrors(requiredPlanned)).toEqual(['native permission unavailable:ios.permission.speech (ios:planned)']);
    expect(nativeCapabilitySupportErrors(unknownOptional)).toEqual(['unsupported native permission:android.permission.BLUETOOTH_ADMIN']);
  });

  it('allows optional Expo file picking on supported mobile/web runtimes', () => {
    const capability: AppPackageNativeCapability = {
      schemaVersion: 'wonder.app-package-native-capabilities.v1',
      platform: 'expo',
      packages: ['expo-document-picker'],
      permissions: [{
        id: 'pick-files',
        platform: 'expo',
        permission: 'expo-document-picker',
        reason: 'Pick a local file.',
        required: false,
      }],
    };

    expect(nativeCapabilitySupportErrors(capability)).toEqual([]);
    expect(nativeCapabilitySupportFindings(capability)).toEqual([]);
  });

  it('recognizes the current Expo native capability module set', () => {
    const capability: AppPackageNativeCapability = {
      schemaVersion: 'wonder.app-package-native-capabilities.v1',
      platform: 'expo',
      packages: [
        'expo-camera',
        'expo-calendar',
        'expo-contacts',
        'expo-document-picker',
        'expo-image-picker',
        'expo-local-authentication',
        'expo-location',
        'expo-notifications',
        'expo-sensors',
        'expo-sharing',
        'expo-speech',
        'expo-task-manager',
        'expo-video',
      ],
      permissions: [
        { id: 'camera', platform: 'expo', permission: 'expo-camera', reason: 'Scan codes.', required: false },
        { id: 'calendar', platform: 'expo', permission: 'expo-calendar', reason: 'Create events.', required: false },
        { id: 'contacts', platform: 'expo', permission: 'expo-contacts', reason: 'Pick one contact.', required: false },
        { id: 'files', platform: 'expo', permission: 'expo-document-picker', reason: 'Pick files.', required: false },
        { id: 'local-auth', platform: 'expo', permission: 'expo-local-authentication', reason: 'Unlock actions.', required: false },
        { id: 'location', platform: 'expo', permission: 'expo-location', reason: 'Use current location.', required: false },
        { id: 'notifications', platform: 'expo', permission: 'expo-notifications', reason: 'Local reminders.', required: false },
        { id: 'sensors', platform: 'expo', permission: 'expo-sensors', reason: 'Read motion.', required: false },
        { id: 'speech', platform: 'expo', permission: 'expo-speech', reason: 'Speak text.', required: false },
      ],
    };

    expect(nativeCapabilitySupportErrors(capability)).toEqual([]);
    expect(nativeCapabilitySupportFindings(capability).map((finding) => finding.id)).toEqual([
      'expo-calendar',
      'expo-contacts',
      'expo-local-authentication',
      'expo-location',
      'expo-notifications',
      'expo-sensors',
      'expo-speech',
    ]);
  });
});
