import { describe, expect, it } from 'vitest';

import { validateAppPackage } from '@/server/src/kernel/package';
import { evaluatePackage } from '@/server/src/kernel/runtime';
import { buildAppPackageFromManifest } from '@/src/domain/app-package-bridge';
import { loadCatalog } from '@/src/domain/catalog';

describe('domain manifest to app package bridge', () => {
  it('maps every manifest collection and surface into valid package contracts', () => {
    const manifest = loadCatalog().activeManifest;
    const bridged = buildAppPackageFromManifest(manifest, { version: '1.0.0-test' });
    const validation = validateAppPackage(bridged.package);

    expect(validation.valid).toBe(true);
    expect(Object.keys(bridged.package.collections).sort()).toEqual([...manifest.collections].sort());

    for (const surface of manifest.surfaces) {
      const view = bridged.package.views[surface.id];
      expect(view).toBeDefined();
      expect(bridged.package.queries[view.query]).toBeDefined();
      expect(bridged.package.queries[view.query].from).toBe('records');
    }
  });

  it('executes a manifest surface through the bounded query and view contracts', () => {
    const manifest = loadCatalog().activeManifest;
    const bridged = buildAppPackageFromManifest(manifest);
    const surface = manifest.surfaces[0];
    const view = bridged.package.views[surface.id];
    const records = [
      {
        id: 'matching-record',
        title: 'Matching record',
        collection: surface.collections[0] ?? manifest.collections[0],
        updated_at: '2026-07-23T00:00:00.000Z',
        properties: {},
      },
      {
        id: 'outside-surface',
        title: 'Outside surface',
        collection: manifest.collections.at(-1) ?? manifest.collections[0],
        updated_at: '2026-07-22T00:00:00.000Z',
        properties: {},
      },
    ];

    const runtime = evaluatePackage({ package: bridged.package, collections: { records } });
    const result = runtime.queries[view.query];
    const rendered = runtime.views[view.id];

    expect(result.rows).toHaveLength(surface.collections.length ? 1 : 2);
    expect(result.rows.every((record) => !surface.collections.length || surface.collections.includes(String(record.collection)))).toBe(true);
    expect(rendered.rows.every((row) => Object.keys(row).every((field) => view.fields.includes(field)))).toBe(true);
    expect(rendered.provenance).toBe(`${bridged.package.id}@${bridged.package.version}/query:${view.query}`);
  });

  it('preserves manifest ui config on presentation', () => {
    const manifest = loadCatalog().activeManifest;
    const bridged = buildAppPackageFromManifest(manifest);

    expect(bridged.package.presentation?.ui).toEqual(manifest.ui);
  });

  it('keeps route-facing surfaces package-owned instead of shell-owned', () => {
    const manifest = loadCatalog().activeManifest;
    const bridged = buildAppPackageFromManifest(manifest);
    const screens = bridged.package.presentation?.ui?.screens ?? {};

    expect(Object.keys(screens)).toEqual(expect.arrayContaining([
      'home',
      'overview',
      'chat',
      'settings',
      'sources',
      'capture',
      'search',
      'config',
      'health',
      'record',
      'collection',
      'system',
      'notFound',
    ]));
    expect(screens.chat.components?.some((component) => component.id === 'chat_context')).toBe(false);
  });

  it('promotes declarative native capabilities into a locked V3 package', () => {
    const manifest = loadCatalog().activeManifest;
    const bridged = buildAppPackageFromManifest(manifest, { version: 'native-test' });

    expect(manifest.native_capabilities?.permissions?.length).toBeGreaterThan(0);
    expect(bridged.package.schemaVersion).toBe('wonder.app-package.v3');
    if (bridged.package.schemaVersion !== 'wonder.app-package.v3') throw new Error('expected V3 package');
    expect(bridged.package.nativeCapabilities).toEqual(manifest.native_capabilities);
    expect(bridged.package.contractLock.nativeCapabilities).toEqual(bridged.package.nativeCapabilities);
    expect(bridged.package.contractLock.checksum).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it('does not emit legacy dashboard presentation blocks', () => {
    const manifest = loadCatalog().activeManifest;
    const bridged = buildAppPackageFromManifest(manifest);

    const retiredPresentationKey = ['dashboard', 'Blocks'].join('');
    expect(retiredPresentationKey in (bridged.package.presentation ?? {})).toBe(false);
    expect(Object.keys(bridged.package.queries).some((id) => id.startsWith('dashboard:'))).toBe(false);
  });
});
