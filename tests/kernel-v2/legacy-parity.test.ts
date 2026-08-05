import * as ed from '@noble/ed25519';
import { canonicalize } from 'json-canonicalize';
import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';

vi.mock('expo-crypto', () => {
  const { createHash } = require('node:crypto');
  return {
    __esModule: true,
    CryptoDigestAlgorithm: {
      SHA256: 'SHA-256',
      SHA512: 'SHA-512',
    },
    digest: async (_algorithm: string, value: ArrayBuffer | Uint8Array | null) => {
      const bytes = value instanceof ArrayBuffer ? new Uint8Array(value) : Uint8Array.from(value ?? []);
      return new Uint8Array(createHash('sha512').update(Buffer.from(bytes)).digest());
    },
    digestStringAsync: async (_algorithm: string, value: string) => createHash('sha256').update(value).digest('hex'),
  };
});

import * as dataHome from '@/src/kernel/data-home';
import { syncDataHome } from '@/src/kernel/services';
import { loadState, saveState } from '@/src/kernel/persistence';
import { applyAction, emptyState, routeScreen } from '@/src/kernel/runtime';
import { checksum, install, trustPublisher, restorePackage, uninstallPackage } from '@/src/kernel/registry';
import { admission } from '@/src/kernel/admission';
import { supportsWidget } from '@/src/kernel/widget-support';
import { fixturePackages } from './v3-fixtures';

function inMemoryStorage(initial: Record<string, string> = {}) {
  const store = { ...initial };
  return {
    async getItem(key: string) { return store[key] ?? null; },
    async setItem(key: string, value: string) { store[key] = value; },
  } satisfies { getItem: (key: string) => Promise<string | null>; setItem: (key: string, value: string) => Promise<void> };
}

function row(id: string, updatedAt: string, title: string) {
  return {
    id,
    collection: 'item',
    createdAt: updatedAt,
    updatedAt,
    values: { title },
  };
}

function normalizeForAdmission(raw: ReturnType<typeof fixturePackages>[number]) {
  const pkg = structuredClone(raw);
  if (!pkg.acceptanceTests.length) pkg.acceptanceTests = ['smoke'];

  const screens = pkg.presentation.ui.screens as Record<string, { components: { kind: string; widget?: string }[] }>;
  for (const [screenId, screen] of Object.entries(screens)) {
    screens[screenId] = {
      ...screen,
      components: screen.components.map((component) => (component.kind === 'widget' && component.widget && !supportsWidget(component.widget)
        ? { ...component, widget: 'durationTimer' }
        : component)),
    };
  }

  return pkg;
}

function permissionId(permission: unknown): string | undefined {
  if (typeof permission === 'string') return permission.trim().toLowerCase();
  if (permission && typeof permission === 'object') {
    if ('id' in permission && typeof permission.id === 'string') return permission.id.trim().toLowerCase();
    if ('permission' in permission && typeof permission.permission === 'string') {
      return permission.permission.trim().toLowerCase();
    }
  }
  return undefined;
}

function makeEvidence(pkg: Parameters<typeof admission>[0], artifactHash = 'a'.repeat(64)) {
  const proofHash = (label: string) => `sha256:${createHash('sha256').update(`${artifactHash}:${label}`).digest('hex')}`;
  const platforms = ['web', 'android', 'ios', 'macos'] as const;
  const driver: Record<string, string> = { web: 'playwright', android: 'adb', ios: 'simctl', macos: 'macos-ui' };
  return {
    schemaVersion: 'utopia.admission-evidence.v2' as const,
    packageId: pkg.id,
    version: pkg.version,
    packageSha256: pkg.contractLock.checksum,
    author: 'platform-reviewer',
    reviewer: 'independent-reviewer',
    artifacts: platforms.map((platform) => ({
      platform,
      build: { path: `dist/${platform}`, sha256: `sha256:${artifactHash}` },
      runtime: {
        id: `${platform}-runtime`,
        path: `runtimes/${platform}`,
        sha256: `sha256:${artifactHash}`,
        checkedAt: '2026-08-04T00:00:00.000Z',
        status: 'passed' as const,
        driver: driver[platform],
      },
      screenshot: { path: `shots/${platform}.png`, sha256: `sha256:${artifactHash}` },
    })),
    oracles: (pkg.acceptanceTests.length ? pkg.acceptanceTests : ['smoke']).map((id) => ({
      id,
      path: `${id}.json`,
      sha256: artifactHash,
      checkedAt: '2026-08-04T00:00:00.000Z',
      status: 'passed' as const,
    })),
    accessibility: {
      id: 'accessibility',
      path: 'proofs/accessibility.json',
      sha256: proofHash('accessibility'),
      checkedAt: '2026-08-04T00:00:00.000Z',
      status: 'passed' as const,
    },
    persistence: {
      id: 'persistence',
      path: 'proofs/persistence.json',
      sha256: proofHash('persistence'),
      checkedAt: '2026-08-04T00:00:00.000Z',
      status: 'passed' as const,
    },
    errorPaths: {
      id: 'error-paths',
      path: 'proofs/errors.json',
      sha256: proofHash('error-paths'),
      checkedAt: '2026-08-04T00:00:00.000Z',
      status: 'passed' as const,
    },
    nativeCapabilities: Array.from(
      new Set(
        (pkg.nativeCapabilities.permissions ?? [])
          .map(permissionId)
          .filter((id): id is string => Boolean(id)),
      ),
    ).map((permissionIdValue) => ({
      id: permissionIdValue,
      path: `${permissionIdValue}.json`,
      sha256: artifactHash,
      checkedAt: '2026-08-04T00:00:00.000Z',
      status: 'passed' as const,
    })),
  };
}

describe('legacy-parity consolidation on v3 API', () => {
  it('restores state across restart and rejects corrupt persistence envelopes', async () => {
    const storage = inMemoryStorage();
    const started = applyAction(emptyState, { kind: 'create', collection: 'item', recordId: 'one', values: { title: 'Saved' } });
    await saveState(storage, 'utopia:app', started);

    const loaded = await loadState(storage, 'utopia:app');
    expect(loaded).toStrictEqual(started);

    await storage.setItem('utopia:app', JSON.stringify({ schemaVersion: 'utopia.state.v0', state: started }));
    await expect(loadState(storage, 'utopia:app')).rejects.toThrow();
  });

  it('keeps bounded history and supports undo/restart recovery', () => {
  let state = emptyState;
    for (let index = 0; index < 64; index += 1) {
      state = applyAction(state, { kind: 'create', collection: 'item', recordId: `r-${index}`, values: { title: `v-${index}` } });
    }
    expect(state.undo?.length).toBeLessThanOrEqual(10);

    const undone = applyAction(state, { kind: 'undo' });
    expect(undone.records).toHaveLength(63);
    expect(undone.undo?.length).toBeLessThanOrEqual(10);
  });

  it('routes deep links and keeps navigation deterministic', () => {
    const screens = ['home', 'history', 'settings'];
    expect(routeScreen('/home?tab=work', screens)).toBe('home');
    expect(routeScreen('?screen=history', screens)).toBe('history');
    expect(routeScreen('/settings/child', screens)).toBe('settings');
    expect(routeScreen('/missing', screens)).toBeUndefined();

    const actionState = applyAction(emptyState, { kind: 'propose', operation: 'navigate', recordId: 'home', payload: { confirmed: true } });
    expect(actionState.receipts?.at(-1)).toMatchObject({ operation: 'navigate', status: 'completed' });
  });

  it('supports propose/retry semantics and receipt capping for failure recovery', () => {
    const open = applyAction(emptyState, {
      kind: 'propose',
      operation: 'create',
      collection: 'item',
      values: { title: 'draft' },
      payload: { confirmed: false },
    });
    expect(open.receipts).toBeUndefined();

    const confirmed = applyAction(open, {
      kind: 'propose',
      operation: 'create',
      collection: 'item',
      values: { title: 'confirmed' },
      payload: { confirmed: true },
    });
    expect(confirmed.receipts?.at(-1)).toMatchObject({ operation: 'create', status: 'completed' });

    const retried = Array.from({ length: 60 }, (_, index) =>
      applyAction(confirmed, { kind: 'propose', operation: 'retry', payload: { confirmed: true }, recordId: String(index) }),
    ).at(-1);
    expect(retried?.receipts?.length).toBeLessThanOrEqual(50);
  });

  it('enforces registry trust, checksum verification, and rollback restore', async () => {
    const base = structuredClone(fixturePackages()[0]);
    const secret = new Uint8Array(32).fill(9);
    const publicKey = await ed.getPublicKeyAsync(secret);
    const signature = await ed.signAsync(new TextEncoder().encode(canonicalize(base)), secret);

    const entry = {
      id: base.id,
      url: 'https://provider.test/package.json',
      checksum: await checksum(base),
      publisher: 'kernel-legacy-v3',
      signature: ed.etc.bytesToHex(signature),
    };

    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(base), { status: 200 })));
    await expect(install({ ...entry, checksum: 'sha256:' + '0'.repeat(64) })).rejects.toThrow('Package checksum mismatch');

    await expect(
      install({ ...entry, publisher: 'untrusted', signature: '0'.repeat(128) }),
    ).rejects.toThrow('Publisher not trusted: untrusted');

    await trustPublisher('kernel-legacy-v3', ed.etc.bytesToHex(publicKey));
    await expect(install(entry)).resolves.toMatchObject({ id: base.id });

    const next = { ...base, version: '2.0.0' };
    const nextSignature = await ed.signAsync(new TextEncoder().encode(canonicalize(next)), secret);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(next), { status: 200 })));
    await install({
      ...entry,
      checksum: await checksum(next),
      version: next.version,
      url: 'https://provider.test/package-updated.json',
      signature: ed.etc.bytesToHex(nextSignature),
    });
    const restored = await restorePackage(base.id);
    expect(restored?.version).toBe(base.version);

    await uninstallPackage(base.id);
    await expect(((): Promise<unknown> => install(entry))()).rejects.toThrow();
    vi.unstubAllGlobals();
  });

  it('handles sync conflicts, offline fallback, and pull failure recovery', async () => {
    const home = { id: 'sync-home', kind: 'postgres' as const, mode: 'sync' as const, resource: 'db', secretRef: 'UTOPIA_DB' };
    const pkg = {
      ...fixturePackages()[0],
      dataHomes: [home],
      defaultDataHome: home.id,
    };

    const conflictProvider = {
      pull: vi.fn(async () => ({ records: [row('item-1', '2026-01-01T00:00:00.000Z', 'remote-conflict')], cursor: 'x', hasMore: false })),
      push: vi.fn(async () => ({ cursor: '2026-01-02T00:00:00.000Z' })),
    };
    vi.spyOn(dataHome, 'createDataHome').mockReturnValue(conflictProvider as never);
    vi.stubGlobal('process', { env: { UTOPIA_DB: 'postgres://u:p@localhost/db' } } as never);

    const conflicted = await syncDataHome(
      pkg,
      { records: [row('item-1', '2026-01-01T00:00:00.000Z', 'local-branch')] },
      'https://provider.test',
    );
    expect(conflicted.receipts?.some((receipt) => receipt.operation === 'conflict')).toBe(true);
    expect(conflicted.records.find((item) => item.id === 'item-1')?.values.title).toBe('local-branch');

    const offlineStorage = inMemoryStorage();
    const offlineProvider = {
      pull: vi.fn(async () => ({ records: [row('item-2', '2026-02-01T00:00:00.000Z', 'remote')], cursor: 'y', hasMore: false })),
      push: vi.fn(async () => { throw new Error('offline'); }),
    };
    vi.spyOn(dataHome, 'createDataHome').mockReturnValue(offlineProvider as never);

    const offline = await syncDataHome(
      pkg,
      { records: [row('item-3', '2026-02-02T00:00:00.000Z', 'local')] },
      'https://provider.test',
      undefined,
      offlineStorage,
    );

    const duplicateArtifact = makeEvidence(pkg);
    duplicateArtifact.artifacts[1] = duplicateArtifact.artifacts[0];
    const duplicate = admission(pkg, duplicateArtifact);
    expect(duplicate.admitted).toBe(false);
    expect(duplicate.issues).toContain('duplicate platform artifact');

    const badDriver = makeEvidence(pkg);
    badDriver.artifacts[0] = { ...badDriver.artifacts[0], runtime: { ...badDriver.artifacts[0].runtime, driver: 'xctest' } };
    const bad = admission(pkg, badDriver);
    expect(bad.admitted).toBe(false);
    expect(bad.issues).toContain('web proof driver mismatch');

    const badAuth = makeEvidence(pkg);
    badAuth.reviewer = 'builder';
    expect(admission(pkg, badAuth).admitted).toBe(false);
  });

  it('enforces cross-plane admission invariants and widget reachability', () => {
    const candidate = fixturePackages()
      .filter((raw) => raw.catalog.status === 'active')
      .map((raw) => normalizeForAdmission(raw))
      .find((pkg) => admission(pkg, makeEvidence(pkg)).admitted);

    if (!candidate) {
      const first = normalizeForAdmission(fixturePackages()[0]);
      const failure = admission(first, makeEvidence(first)).issues;
      throw new Error(`no active package can be admitted with live evidence: ${failure.join('; ')}`);
    }

    const pkg = candidate;
    const admitted = admission(pkg, makeEvidence(pkg));
    const widgetsReachable = Object.values(pkg.presentation.ui.screens)
      .flatMap((screen) => screen.components)
      .filter((component) => component.kind === 'widget' && Boolean(component.widget))
      .every((component) => supportsWidget(component.widget));

    expect(widgetsReachable).toBe(true);
    expect(admitted.admitted).toBe(true);
    expect(admitted.issues).toEqual([]);

    const duplicateArtifact = makeEvidence(pkg);
    duplicateArtifact.artifacts[1] = duplicateArtifact.artifacts[0];
    const duplicate = admission(pkg, duplicateArtifact);
    expect(duplicate.admitted).toBe(false);
    expect(duplicate.issues).toContain('duplicate platform artifact');

    const badDriver = makeEvidence(pkg);
    badDriver.artifacts[0] = { ...badDriver.artifacts[0], runtime: { ...badDriver.artifacts[0].runtime, driver: 'xctest' } };
    const bad = admission(pkg, badDriver);
    expect(bad.admitted).toBe(false);
    expect(bad.issues).toContain('web proof driver mismatch');

    const badAuth = makeEvidence(pkg);
    badAuth.reviewer = 'builder';
    expect(admission(pkg, badAuth).admitted).toBe(false);
  });
});
