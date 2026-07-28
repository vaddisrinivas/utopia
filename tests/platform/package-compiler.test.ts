import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  compileAppPackageSource,
  readAppPackageSourceFolder,
  type AppPackageSourceFolder,
} from '@/packages/app-compiler';

const fixtureDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/package-source/reference-app');

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function reverseMap<T>(input: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(input).reverse());
}

function loadReferenceSource(): AppPackageSourceFolder {
  return readAppPackageSourceFolder(fixtureDir);
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
            id: 'camera',
            platform: 'android',
            permission: 'android.permission.CAMERA',
            reason: 'Need camera access.',
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
    expect(nativeResult.errors.some((error) => error.message.includes('unsupported native permission:android.permission.CAMERA'))).toBe(true);
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
