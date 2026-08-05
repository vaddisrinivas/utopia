import { describe, expect, it } from 'vitest';

import { admission } from '@/src/kernel/admission';
import type { AppPackage } from '@/src/kernel/schema';

import { fixtureActivePackage } from './v3-fixtures';

const hash = 'a'.repeat(64);
const receipt = (id: string) => ({ id, path: `${id}.json`, sha256: hash, checkedAt: '2026-08-04T12:00:00.000Z', status: 'passed' as const });
const specialReceipt = (id: string, hashDigit: string) => ({ ...receipt(id), sha256: hashDigit.repeat(64) });
const artifact = (platform: 'web' | 'android' | 'ios' | 'macos') => ({
  platform,
  build: { path: `${platform}.build`, sha256: hash },
  runtime: { ...receipt(`${platform}-runtime`), driver: { web: 'playwright', android: 'adb', ios: 'simctl', macos: 'macos-ui' }[platform] },
  screenshot: { path: `${platform}.png`, sha256: hash },
});
const evidence = {
  schemaVersion: 'utopia.admission-evidence.v2',
  packageId: 'undefined',
  version: 'undefined',
  packageSha256: `sha256:${hash}`,
  author: 'builder',
  reviewer: 'independent-reviewer',
  artifacts: (['web', 'android', 'ios', 'macos'] as const).map(artifact),
  oracles: ['oracle-a', 'oracle-b'].map(receipt),
  accessibility: specialReceipt('accessibility', 'b'),
  persistence: specialReceipt('persistence', 'c'),
  errorPaths: specialReceipt('error-paths', 'd'),
  nativeCapabilities: [receipt('camera')],
};

const basePackage = fixtureActivePackage();

const sanitizePackageForAdmission = (input: AppPackage): AppPackage => ({
  ...input,
  catalog: { status: 'active' },
  acceptanceTests: input.acceptanceTests.length ? [...input.acceptanceTests] : ['oracle-a'],
  presentation: {
    ...input.presentation,
    ui: {
      ...input.presentation.ui,
      screens: {
        admission: { components: [{ kind: 'widget', widget: 'durationTimer', title: 'admission' }] },
      },
    },
  },
  nativeCapabilities: {
    ...input.nativeCapabilities,
    permissions: ['camera'],
  },
  contractLock: input.contractLock,
}) as AppPackage;

const fixture: AppPackage = sanitizePackageForAdmission(basePackage ?? {
  schemaVersion: 'wonder.app-package.v3',
  id: 'fixture.admission',
  version: '1.0.0',
  catalog: { status: 'active' },
  collections: {
    items: { id: 'items', fields: { name: { type: 'text' } } },
  },
  queries: { default: { from: 'items' } },
  views: { main: { id: 'main', query: 'default', mode: 'list', fields: ['name'] } },
  rules: [],
  dataHomes: [{ id: 'local', kind: 'sqlite', mode: 'local' }],
  defaultDataHome: 'local',
  capabilities: [],
  acceptanceTests: ['oracle-a'],
  dependencyPins: [],
  nativeCapabilities: { schemaVersion: 'wonder.app-package-native-capabilities.v1', platform: 'expo', packages: [], permissions: ['camera'] },
  contractLock: {
    schemaVersion: 'wonder.package-contract-lock.v1',
    algorithm: 'sha256',
    checksum: `sha256:${hash}`,
    pinnedAt: '2026-08-04T00:00:00.000Z',
  },
  presentation: {
    label: 'fixture',
    visualIdentity: {},
    ui: {
      screens: {
        admission: { components: [{ kind: 'widget', widget: 'durationTimer', title: 'admission' }] },
      },
    },
  },
} as AppPackage);

const makeEvidence = (overrides: Partial<typeof evidence> = {}) => ({
  ...evidence,
  packageId: overrides.packageId ?? fixture.id,
  version: overrides.version ?? fixture.version,
  packageSha256: overrides.packageSha256 ?? fixture.contractLock.checksum,
  ...overrides,
  artifacts: overrides.artifacts ?? evidence.artifacts,
  oracles: overrides.oracles ?? fixture.acceptanceTests.map(receipt),
  nativeCapabilities: overrides.nativeCapabilities ?? evidence.nativeCapabilities,
  accessibility: overrides.accessibility ?? evidence.accessibility,
  persistence: overrides.persistence ?? evidence.persistence,
  errorPaths: overrides.errorPaths ?? evidence.errorPaths,
});

const makePermissionPkg = (permission: string): AppPackage => ({
  ...fixture,
  nativeCapabilities: {
    ...fixture.nativeCapabilities,
    permissions: [permission],
  },
});

describe('production admission', () => {
  it('fails closed on self-review, duplicate planes, and missing oracles', () => {
    const artifacts = [...evidence.artifacts];
    artifacts[1] = artifact('web');
    const result = admission(fixture, makeEvidence({ reviewer: 'builder', artifacts, oracles: [] }));
    expect(result.admitted).toBe(false);
    expect(result.issues).toContain('independent reviewer required');
    expect(result.issues).toContain('android runtime proof missing');
    expect(result.issues).toContain('duplicate platform artifact');
    expect(result.issues).toContain(`oracle missing: ${fixture.acceptanceTests[0]}`);
  });

  it('fails closed for checksum drift and inactive package admission', () => {
    const result = admission(
      {
        ...fixture,
        catalog: { status: 'inactive', duplicateOf: fixture.id, similarity: 0.75, reason: 'capability-overlap' },
      },
      makeEvidence({ packageSha256: `sha256:${'b'.repeat(64)}` }),
    );
    expect(result.admitted).toBe(false);
    expect(result.issues).toContain('contract checksum mismatch');
    expect(result.issues).toContain('inactive package cannot be admitted');
  });

  it('verifies native permission proofs are exact and required', () => {
    const permissionPkg = makePermissionPkg('camera');
    const result = admission(permissionPkg, makeEvidence({
      nativeCapabilities: [receipt('camera')],
      packageId: fixture.id,
      version: fixture.version,
      packageSha256: permissionPkg.contractLock.checksum,
    }));
    expect(result.admitted).toBe(true);
    expect(result.issues).toEqual([]);
    const missing = admission(permissionPkg, makeEvidence({
      nativeCapabilities: [receipt('microphone')],
      packageId: permissionPkg.id,
      version: permissionPkg.version,
      packageSha256: permissionPkg.contractLock.checksum,
    }));
    expect(missing.admitted).toBe(false);
    expect(missing.issues).toContain('native capability proof missing: camera');
  });

  it('rejects legacy v1 schema payload', () => {
    expect(admission(fixture, { schemaVersion: 'utopia.admission-evidence.v1', oracle: true }).admitted).toBe(false);
  });

  it('rejects pairwise special-proof id, path, and hash collisions', () => {
    const collisions = [
      {
        persistence: { ...evidence.persistence, id: 'shared-id', path: 'persistence.json' },
        errorPaths: { ...evidence.errorPaths, id: 'shared-id', path: 'error-paths.json' },
      },
      {
        accessibility: { ...evidence.accessibility, path: 'shared-path.json' },
        errorPaths: { ...evidence.errorPaths, path: 'shared-path.json' },
      },
      {
        accessibility: { ...evidence.accessibility, sha256: 'e'.repeat(64) },
        persistence: { ...evidence.persistence, sha256: `sha256:${'e'.repeat(64)}` },
      },
    ];
    for (const collision of collisions) {
      const result = admission(fixture, makeEvidence(collision));
      expect(result.admitted).toBe(false);
      expect(result.issues).toContain('proof identity collision');
    }
  });

  it('admits only complete matching hashed evidence', () => {
    expect(admission(fixture, makeEvidence())).toEqual({ admitted: true, issues: [] });
  });
});
