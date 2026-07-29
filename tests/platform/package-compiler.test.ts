import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  compileAppPackageSource,
  compileAppPackageSourceFolder,
  readAppPackageSourceFolder,
  type AppPackageSourceFolder,
} from '@/packages/app-compiler';
import type { AppPackageV3, AppPackagePermissionDeclaration } from '@/packages/shared/contracts/package';
import { buildPackageInstallPreview } from '@/packages/shared/contracts/package-install';

const fixtureRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/package-source');
const referenceFixtureDir = path.join(fixtureRoot, 'reference-app');
const tinyFixtureDirs = JSON.parse(readFileSync(path.join(fixtureRoot, 'manifest.json'), 'utf8')) as Array<{
  path: string;
  label: string;
  homeSurface: string;
}>;
const capabilityLabSourceDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../apps/capability-lab/source');
const audioLoopSourceDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../apps/audio-loop-108/source');

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function reverseMap<T>(input: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(input).reverse());
}

function loadReferenceSource(): AppPackageSourceFolder {
  return readAppPackageSourceFolder(referenceFixtureDir);
}

describe('package compiler', () => {
  it('compiles deterministically across source ordering', () => {
    const source = loadReferenceSource();
    const shuffled: AppPackageSourceFolder = {
      app: source.app,
      collections: reverseMap(source.collections ?? {}),
      queries: reverseMap(source.queries ?? {}),
      screens: reverseMap(source.screens ?? {}),
      rules: reverseMap(source.rules ?? {}),
      acceptance: reverseMap(source.acceptance ?? {}),
      capabilities: source.capabilities,
      workflows: source.workflows,
      providers: source.providers,
      theme: source.theme,
      fixtures: source.fixtures,
    };

    const compiledA = compileAppPackageSource(source);
    const compiledB = compileAppPackageSource(shuffled);

    expect(compiledA.valid).toBe(true);
    expect(compiledB.valid).toBe(true);
    if (!compiledA.valid || !compiledB.valid) throw new Error('expected valid compilation');

    expect(compiledA.checksum).toBe(compiledB.checksum);
    expect(compiledA.package).toEqual(compiledB.package);
    expect(compiledA.preview.collectionIds).toEqual(['assignment', 'chore', 'completion', 'household_member']);
    expect(compiledA.preview.widgets).toEqual(['themePreview']);
  });

  it.each(tinyFixtureDirs)('compiles tiny package fixture $path', ({ path: fixtureName, label: expectedLabel, homeSurface: expectedSurfaceId }) => {
    const source = readAppPackageSourceFolder(path.join(fixtureRoot, fixtureName));
    const compiled = compileAppPackageSource(source);

    expect(compiled.valid).toBe(true);
    if (!compiled.valid) throw new Error(compiled.errors.map((error) => error.message).join(', '));

    expect(compiled.package.id).toBe(fixtureName);
    expect(compiled.package.presentation?.label).toBe(expectedLabel);
    expect(compiled.package.presentation?.surfaces.map((surface) => surface.id)).toEqual([expectedSurfaceId]);
  });

  it('compiles the capability lab with cross-platform capability widget coverage', () => {
    const source = readAppPackageSourceFolder(path.join(fixtureRoot, 'capability-lab'));
    const compiled = compileAppPackageSource(source);

    expect(compiled.valid).toBe(true);
    if (!compiled.valid) throw new Error(compiled.errors.map((error) => error.message).join(', '));

    expect(compiled.preview.widgets).toEqual([
      'permissionCard',
      'dataTable',
      'filePicker',
      'fileExport',
      'videoPlayer',
      'cameraScanner',
      'locationMap',
      'sensorReadout',
      'notificationScheduler',
      'contactPicker',
      'calendarEvent',
      'biometricGate',
      'healthKitStatus',
      'speechTool',
    ]);
    expect(compiled.preview.nativeCapabilities).toEqual(expect.objectContaining({
      platform: 'expo',
      packages: [
        'expo-calendar',
        'expo-camera',
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
        'expo:expo-calendar',
        'expo:expo-camera',
        'expo:expo-contacts',
        'expo:expo-document-picker',
        'expo:expo-image-picker:camera',
        'expo:expo-image-picker:media-library',
        'expo:expo-local-authentication',
        'expo:expo-location',
        'expo:expo-notifications',
        'expo:expo-sensors',
        'expo:expo-sharing',
        'expo:expo-speech',
        'ios:ios.permission.speech',
      ],
      intents: ['expo:deep_link', 'expo:file_open'],
    }));
  });

  it('compiles capability-lab source with explicit truth matrix fields and blocked states', () => {
    const compiled = compileAppPackageSourceFolder(capabilityLabSourceDir);
    expect(compiled.valid).toBe(true);
    if (!compiled.valid) throw new Error(compiled.errors.map((error) => error.message).join(', '));

    expect(compiled.package.id).toBe('capability-lab');
    expect(compiled.package.collections.capability.fields).toEqual(
      expect.objectContaining({
        supportedContract: expect.any(Object),
        platformExportable: expect.any(Object),
        deviceProofRequired: expect.any(Object),
      }),
    );
    const matrixScreen = compiled.package.views.matrix;
    expect(matrixScreen.fields).toEqual(
      expect.arrayContaining([
        'supportedContract',
        'platformExportable',
        'deviceProofRequired',
      ]),
    );
    const permissionCard = compiled.package.presentation?.ui?.screens?.matrix?.components?.find(
      (component) => component.kind === 'widget' && component.widget === 'permissionCard',
    );
    expect(permissionCard?.props?.permissions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'contacts.bulk-import',
          supportedContract: false,
          platformExportable: false,
          deviceProofRequired: false,
          status: 'blocked',
        }),
      ]),
    );
    const permissionRows = permissionCard?.props?.permissions as Array<Record<string, unknown>>;
    expect(permissionRows.filter((row) => row.deviceProofRequired === true))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ status: 'awaiting_device_proof' }),
      ]));
    expect(permissionRows.some((row) => row.deviceProofRequired === true && row.status === 'available')).toBe(false);

    expect(compiled.package.presentation?.surfaces.map((surface) => surface.id)).toEqual(['matrix']);
    expect(compiled.preview.widgets).toEqual(expect.arrayContaining(['chartBlock', 'formCard', 'durationTimer', 'mediaBlock']));
    const installPreview = buildPackageInstallPreview(compiled.package, {
      sourceUrl: 'https://example.invalid/capability-lab.v1.json',
      expectedChecksum: compiled.checksum,
    });
    expect(installPreview.status).toBe('ready_for_review');
    const expectedBundled = JSON.parse(readFileSync(path.join(capabilityLabSourceDir, '..', 'capability-lab.v1.json'), 'utf8'));
    expect(compiled.package).toEqual(expectedBundled);
  });

  it('produces semantic diffs and preview metadata', () => {
    const source = loadReferenceSource();
    const baseline = compileAppPackageSource(source);
    if (!baseline.valid) throw new Error(baseline.errors.map((error) => error.message).join(', '));

    const mutated = clone(source);
    mutated.collections!.chore.fields.estimated_minutes = { type: 'number' };
    mutated.screens!.chores.fields = [...mutated.screens!.chores.fields, 'estimated_minutes'];

    const compiled = compileAppPackageSource(mutated, { baselinePackage: baseline.package });
    expect(compiled.valid).toBe(true);
    if (!compiled.valid) throw new Error(compiled.errors.map((error) => error.message).join(', '));

    expect(compiled.diff.some((entry) => entry.path === '/collections/chore/fields/estimated_minutes')).toBe(true);
    expect(compiled.preview.diffSummary.added).toBeGreaterThan(0);
    expect(compiled.preview.homeSurface).toBe('today');
    expect(compiled.preview.sourceCounts.screens).toBe(4);
  });

  it('fails closed on invalid references, widgets, and native capabilities', () => {
    const source = loadReferenceSource();

    const badReference = clone(source);
    badReference.screens!.today.query = 'missing_query';
    const referenceResult = compileAppPackageSource(badReference);
    expect(referenceResult.valid).toBe(false);
    if (referenceResult.valid) throw new Error('expected invalid reference package');
    expect(referenceResult.errors.some((error) => error.message.includes('references missing query missing_query'))).toBe(true);

    const badWidget = clone(source);
    (badWidget.screens!.review.components![0] as any).widget = 'not-a-widget';
    const widgetResult = compileAppPackageSource(badWidget);
    expect(widgetResult.valid).toBe(false);
    if (widgetResult.valid) throw new Error('expected invalid widget package');
    expect(widgetResult.errors.some((error) => error.path === '/screens/review/components/0/widget')).toBe(true);

    const badNative = clone(source);
    badNative.capabilities = {
      native: {
        schemaVersion: 'wonder.app-package-native-capabilities.v1',
        platform: 'android',
        packages: ['@a2ui/web_core/v0_9'],
        permissions: [
          {
            id: 'bluetooth-admin',
            platform: 'android',
            permission: 'android.permission.BLUETOOTH_ADMIN',
            reason: 'Need broad Bluetooth access.',
            required: true,
          },
        ],
        intents: [],
      },
      dependencyPins: [{ package: '@a2ui/web_core/v0_9', version: '0.9.0', source: 'npm' }],
      pinnedAt: '2026-07-27T00:00:00.000Z',
    };
    const nativeResult = compileAppPackageSource(badNative);
    expect(nativeResult.valid).toBe(false);
    if (nativeResult.valid) throw new Error('expected invalid native package');
    expect(nativeResult.errors.some((error) => error.message.includes('unsupported native permission:android.permission.BLUETOOTH_ADMIN'))).toBe(true);
  });

  it('compiles a locked V3 package when native capabilities are declared', () => {
    const source = loadReferenceSource();
    const v3Source = clone(source);
    v3Source.capabilities = {
      native: {
        schemaVersion: 'wonder.app-package-native-capabilities.v1',
        platform: 'android',
        packages: ['@a2ui/web_core/v0_9'],
        permissions: [
          {
            id: 'steps',
            platform: 'android',
            permission: 'android.permission.health.READ_STEPS',
            reason: 'Read steps for a health dashboard.',
            required: false,
          },
        ],
        intents: [
          {
            id: 'share-report',
            platform: 'android',
            kind: 'share',
            reason: 'Share a report from the package preview.',
          },
        ],
      },
      dependencyPins: [{ package: '@a2ui/web_core/v0_9', version: '0.9.0', source: 'npm' }],
      pinnedAt: '2026-07-27T00:00:00.000Z',
    };

    const compiled = compileAppPackageSource(v3Source);
    expect(compiled.valid).toBe(true);
    if (!compiled.valid) throw new Error(compiled.errors.map((error) => error.message).join(', '));

    expect(compiled.package.schemaVersion).toBe('wonder.app-package.v3');
    if (compiled.package.schemaVersion !== 'wonder.app-package.v3') throw new Error('expected V3 package');
    expect(compiled.package.contractLock.checksum).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(compiled.preview.nativeCapabilities?.platform).toBe('android');
  });

  it('guards Audio Loop source native capabilities drift and compiles into nativeCapability contract', () => {
    const source = readAppPackageSourceFolder(audioLoopSourceDir);
    expect(source.app.id).toBe('audio-loop-108');
    expect(source.app.label).toBe('Audio Loop');
    expect(source.app.label).not.toContain('108');
    const sourceSurfaceIds = Object.keys(source.screens ?? {});
    expect(sourceSurfaceIds).toEqual(expect.arrayContaining(['home', 'history', 'library', 'playlist', 'record']));
    expect(source.screens?.home?.components).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'widget', widget: 'audioLoopPlayer' }),
    ]));
    const sourceSurfaceValues = Object.values(source.screens ?? {});
    expect(sourceSurfaceValues.length).toBeGreaterThanOrEqual(5);
    expect(sourceSurfaceValues.every((surface) => !/tutorial|explanation/i.test(JSON.stringify(surface).toLowerCase()))).toBe(true);
    const homeComponents = source.screens?.home?.components ?? [];
    expect(homeComponents.length).toBeGreaterThan(0);
    expect(homeComponents.every((component) => !/tutorial|explanation/i.test(JSON.stringify(component).toLowerCase()))).toBe(true);
    const player = homeComponents.find((component) => (
      component.kind === 'widget' && component.widget === 'audioLoopPlayer'
    ));
    expect(player?.subtitle ?? '').toMatch(/infinite/i);
    expect(player?.props?.defaultPlays).toBe(1);
    expect(player?.props?.maxPlays).toBeUndefined();
    expect(player?.props?.defaultStartDelaySeconds).toBe(0);
    expect((player?.props?.delayOptions as number[] | undefined)?.length).toBeGreaterThan(4);
    const nativeCapabilities = source.capabilities?.native;
    expect(nativeCapabilities?.schemaVersion).toBe('wonder.app-package-native-capabilities.v1');
    expect(nativeCapabilities?.platform).toBe('android');
    expect(nativeCapabilities?.packages).toEqual(['expo-audio', 'expo-document-picker']);
    const permissions = (nativeCapabilities?.permissions ?? [])
      .filter((permission): permission is AppPackagePermissionDeclaration => typeof permission !== 'string');
    expect(permissions.map((permission) => permission.id)).toEqual([
      'audio-loop-playback',
      'audio-loop-file-picker',
    ]);
    expect((nativeCapabilities?.intents ?? []).map((intent) => intent.id)).toEqual([
      'open-audio-loop',
      'start-audio-loop-voice',
    ]);
    expect(permissions.map((permission) => permission.permission))
      .toEqual(['expo-audio', 'expo-document-picker']);
    expect(permissions.map((permission) => permission.platform)).toEqual(['expo', 'expo']);
    expect((nativeCapabilities?.intents ?? []).map((intent) => intent.kind))
      .toEqual(['deep_link', 'voice']);
    expect(nativeCapabilities?.intents?.find((intent) => intent.id === 'start-audio-loop-voice')?.required).toBe(false);

    const compiled = compileAppPackageSource({
      ...source,
      capabilities: {
        ...source.capabilities,
        pinnedAt: '2026-07-29T00:00:00.000Z',
      },
    });
    expect(compiled.valid).toBe(true);
    if (!compiled.valid) throw new Error(compiled.errors.map((error) => error.message).join(', '));

    const compiledPackage = compiled.package as AppPackageV3;
    expect(compiledPackage.schemaVersion).toBe('wonder.app-package.v3');
    expect(compiledPackage.nativeCapabilities).toEqual({
      ...nativeCapabilities,
      permissions: nativeCapabilities?.permissions,
      intents: nativeCapabilities?.intents,
    });
    expect(compiledPackage.contractLock.nativeCapabilities).toEqual(compiledPackage.nativeCapabilities);
    expect(compiled.preview.nativeCapabilities?.permissions).toEqual(['expo:expo-audio', 'expo:expo-document-picker']);
    expect(compiled.preview.nativeCapabilities?.intents).toEqual(['android:deep_link', 'android:voice']);
    expect(compiled.preview.nativeCapabilities?.packages).toEqual(['expo-audio', 'expo-document-picker']);
    expect(compiled.preview.surfaces.map((surface) => surface.id)).toEqual(
      expect.arrayContaining(['home', 'history', 'library', 'playlist', 'record']),
    );
    const compiledPermissions = (compiledPackage.nativeCapabilities.permissions ?? [])
      .filter((permission): permission is AppPackagePermissionDeclaration => typeof permission !== 'string');
    expect(compiledPermissions).toHaveLength(2);
    expect(compiledPermissions.map((permission) => permission.platform)).toEqual(['expo', 'expo']);
    expect(compiledPermissions.some((permission) => permission.permission.includes('android.permission.RECORD_AUDIO'))).toBe(false);
    expect(compiledPermissions.some((permission) => permission.permission.includes('microphone'))).toBe(false);
    const grantedPackages = new Set(compiledPermissions.map((permission) => permission.permission));
    expect(['expo-audio', 'expo-document-picker'].every((permission) => grantedPackages.has(permission))).toBe(true);
    const declaredAudioFilePermissions = ['expo-audio', 'expo-document-picker'].filter((permission) => grantedPackages.has(permission));
    const declaredAudioRecorderPermissions = ['expo-audio'].filter((permission) => grantedPackages.has(permission));
    expect(declaredAudioFilePermissions).toEqual(['expo-audio', 'expo-document-picker']);
    expect(declaredAudioRecorderPermissions).toEqual(['expo-audio']);
  });
});
