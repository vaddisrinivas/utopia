import { performance } from 'node:perf_hooks';
import { describe, expect, it, vi } from 'vitest';

import { parsePackage } from '@/src/kernel/schema';
import { fixturePackages } from './v3-fixtures';

const catalogEntry = (fixture: ReturnType<typeof fixturePackages>[number]) => ({
  id: fixture.id,
  version: fixture.version,
  catalog: fixture.catalog,
  presentation: fixture.presentation,
});

const fixture = fixturePackages()[0];

async function loadCatalog(entries: Array<ReturnType<typeof catalogEntry>>, withFixtures = false) {
  vi.resetModules();
  const loaders = Object.fromEntries(entries.map((entry) => [entry.id, () => fixture]));
  vi.doMock('@/src/generated/catalog', () => ({
    bundledEntries: entries,
    bundledLoaders: withFixtures ? loaders : {},
  }));

  return import('@/src/kernel/catalog');
}

describe('kernel catalog load performance', () => {
  it('handles missing/empty catalog mode without hard dependency', async () => {
    const previous = process.env.UTOPIA_APPS_DIR;
    process.env.UTOPIA_APPS_DIR = '/tmp/does-not-exist-utopia';
    try {
      const catalogModule = await loadCatalog([]);
      const started = performance.now();
      const packages = catalogModule.allPackages();
      const importMs = Number((performance.now() - started).toFixed(2));
      expect(packages).toEqual([]);
      expect(importMs).toBeGreaterThanOrEqual(0);
    } finally {
      process.env.UTOPIA_APPS_DIR = previous;
    }
  });

  it('measures fixture-backed catalog parse latency boundary', async () => {
    const entries = [catalogEntry(fixture)];
    const catalogModule = await loadCatalog(entries, true);

    const started = performance.now();
    const importMs = Number((performance.now() - started).toFixed(2));

    const startAllPackages = performance.now();
    const packages = catalogModule.allPackages();
    const allPackagesMs = Number((performance.now() - startAllPackages).toFixed(2));

    const parseStart = performance.now();
    let slowPackage = '';
    let slowPackageMs = 0;
    for (const pkg of packages) {
      const start = performance.now();
      parsePackage(pkg);
      const duration = Number((performance.now() - start).toFixed(2));
      if (duration > slowPackageMs) {
        slowPackageMs = duration;
        slowPackage = pkg.id;
      }
    }
    const parseAllPackagesMs = Number((performance.now() - parseStart).toFixed(2));

    const measured = {
      importMs,
      allPackagesMs,
      parseAllPackagesMs,
      slowPackage,
      slowPackageMs,
      packageCount: packages.length,
    };

    console.log(JSON.stringify(measured));
    expect(measured.packageCount).toBe(1);
  });
});
