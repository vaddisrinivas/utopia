import { describe, expect, it } from 'vitest';

import {
  createCapabilityDecisionPort,
  UTOPIA_CAPABILITY_CONSENT_LEDGER_SCHEMA_VERSION,
} from '@/packages/shared/contracts/capability-consent-ledger';
import {
  requestWidgetCapability,
  type WidgetCapabilityRuntime,
} from '@/src/presentation/widgets/package-capability-broker';

const CHECKSUM = `sha256:${'a'.repeat(64)}`;

function consent(capability: string, scope: string[], overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: UTOPIA_CAPABILITY_CONSENT_LEDGER_SCHEMA_VERSION,
    installationId: 'installation-123',
    packageId: 'package-123',
    packageVersion: '1.0.0',
    packageChecksum: CHECKSUM,
    capability,
    scope,
    decision: 'allow' as const,
    decidedBy: 'user',
    decidedAt: '2026-07-30T00:00:00.000Z',
    createdAt: '2026-07-30T00:00:00.000Z',
    updatedAt: '2026-07-30T00:00:00.000Z',
    ...overrides,
  };
}

function makeRuntime(overrides: Partial<WidgetCapabilityRuntime> = {}): WidgetCapabilityRuntime {
  return {
    installationId: 'installation-123',
    activePackage: {
      id: 'package-123',
      version: '1.0.0',
      checksum: CHECKSUM,
      nativeCapabilities: {
        schemaVersion: 'wonder.app-package-native-capabilities.v1',
        platform: 'expo',
        packages: ['expo-audio', 'expo-document-picker', 'expo-file-system', 'expo-sharing'],
        permissions: ['expo-audio', 'expo-document-picker', 'expo-file-system', 'expo-sharing'],
      },
    },
    capabilityDecisionPort: createCapabilityDecisionPort([
      consent('native.file-picker', ['choose']),
      consent('native.audio-recorder', ['record']),
      consent('native.file-export', ['export']),
    ]),
    ...overrides,
  };
}

describe('widget capability broker', () => {
  it('grants a declared package-scoped capability', () => {
    const result = requestWidgetCapability(makeRuntime(), {
      kind: 'file-picker',
      action: 'choose',
      mimeTypes: ['image/*'],
      multiple: false,
      copyToCacheDirectory: true,
    });

    expect(result).toEqual({
      ok: true,
      installationId: 'installation-123',
      packageId: 'package-123',
      kind: 'file-picker',
      action: 'choose',
      grantedPackages: ['expo-document-picker'],
      grantedPermissions: ['expo-document-picker'],
    });
  });

  it('grants audio-recorder when the package and permission are present', () => {
    const result = requestWidgetCapability(makeRuntime(), {
      kind: 'audio-recorder',
      action: 'record',
    });

    expect(result).toEqual({
      ok: true,
      installationId: 'installation-123',
      packageId: 'package-123',
      kind: 'audio-recorder',
      action: 'record',
      grantedPackages: ['expo-audio'],
      grantedPermissions: ['expo-audio'],
    });
  });

  it('denies audio-recorder when native recorder capability is missing', () => {
    const result = requestWidgetCapability(makeRuntime({
      activePackage: {
        id: 'package-123',
        version: '1.0.0',
        checksum: CHECKSUM,
        nativeCapabilities: {
          schemaVersion: 'wonder.app-package-native-capabilities.v1',
          platform: 'expo',
          packages: ['expo-document-picker'],
          permissions: ['expo-document-picker'],
        },
      },
    }), {
      kind: 'audio-recorder',
      action: 'record',
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'package_capability_package_not_granted',
        kind: 'audio-recorder',
        action: 'record',
        installationId: 'installation-123',
        packageId: 'package-123',
        message: 'Missing package grant:expo-audio',
        missingPackages: ['expo-audio'],
        missingPermissions: ['expo-audio'],
      },
    });
  });

  it('denies when the installation is missing', () => {
    const result = requestWidgetCapability(makeRuntime({ installationId: null }), {
      kind: 'biometric',
      action: 'authenticate',
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'package_installation_required',
        kind: 'biometric',
        action: 'authenticate',
        installationId: null,
        packageId: 'package-123',
        message: 'Package installation is required before native capabilities can be used.',
        missingPackages: [],
        missingPermissions: [],
      },
    });
  });

  it('denies a declared capability without active persisted consent', () => {
    const result = requestWidgetCapability(makeRuntime({ capabilityDecisionPort: null }), {
      kind: 'audio-recorder',
      action: 'record',
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'package_capability_consent_required' },
    });
  });

  it('denies revoked consent immediately', () => {
    const result = requestWidgetCapability(makeRuntime({
      capabilityDecisionPort: createCapabilityDecisionPort([
        consent('native.audio-recorder', ['record'], {
          revocation: {
            revokedBy: 'user',
            revokedAt: '2026-07-30T00:00:01.000Z',
          },
        }),
      ]),
    }), {
      kind: 'audio-recorder',
      action: 'record',
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'package_capability_consent_revoked' },
    });
  });

  it('denies consent recorded for a different package checksum', () => {
    const result = requestWidgetCapability(makeRuntime({
      capabilityDecisionPort: createCapabilityDecisionPort([
        consent('native.audio-recorder', ['record'], {
          packageChecksum: `sha256:${'b'.repeat(64)}`,
        }),
      ]),
    }), {
      kind: 'audio-recorder',
      action: 'record',
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'package_capability_consent_checksum_mismatch' },
    });
  });

  it('denies undeclared actions and missing grants with deterministic errors', () => {
    const missingGrant = requestWidgetCapability(
      {
        installationId: 'installation-123',
        activePackage: {
          id: 'package-123',
          version: '1.0.0',
          checksum: CHECKSUM,
          nativeCapabilities: {
            schemaVersion: 'wonder.app-package-native-capabilities.v1',
            platform: 'expo',
            packages: ['expo-file-system'],
            permissions: ['expo-file-system'],
          },
        },
        capabilityDecisionPort: createCapabilityDecisionPort([
          consent('native.file-export', ['export']),
        ]),
      },
      {
        kind: 'file-export',
        action: 'export',
        fileName: 'report.txt',
        mimeType: 'text/plain',
      },
    );

    expect(missingGrant).toEqual({
      ok: false,
      error: {
        code: 'package_capability_package_not_granted',
        kind: 'file-export',
        action: 'export',
        installationId: 'installation-123',
        packageId: 'package-123',
        message: 'Missing package grant:expo-sharing',
        missingPackages: ['expo-sharing'],
        missingPermissions: ['expo-sharing'],
      },
    });

    const unknownAction = requestWidgetCapability(makeRuntime(), {
      kind: 'media-picker',
      action: 'explode',
      media: 'image',
    } as never);

    expect(unknownAction).toEqual({
      ok: false,
      error: {
        code: 'package_capability_unknown_action',
        kind: 'media-picker',
        action: 'explode',
        installationId: 'installation-123',
        packageId: 'package-123',
        message: 'Unknown capability action:media-picker.explode',
        missingPackages: [],
        missingPermissions: [],
      },
    });
  });
});
