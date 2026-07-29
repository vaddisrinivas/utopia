import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  compileAppPackageSource,
  readAppPackageSourceFolder,
  type AppPackageSourceFolder,
} from '@/packages/app-compiler';

const fixtureRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/package-source');
const referenceFixtureDir = path.join(fixtureRoot, 'reference-app');
const tinyFixtureDirs = JSON.parse(readFileSync(path.join(fixtureRoot, 'manifest.json'), 'utf8')) as Array<{
  path: string;
  label: string;
  homeSurface: string;
}>;

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
});
