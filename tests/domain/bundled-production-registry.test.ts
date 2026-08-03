import { describe, expect, it } from 'vitest';

import { sha256Canonical } from '@/packages/shared/contracts/canonical-json';
import {
  BUNDLED_UTOPIA_REGISTRY_URL,
  createPackageInstallFetcher,
  fetchPackageInstallCandidate,
  fetchRegistryManifest,
  getBundledRegistryManifest,
} from '@/src/domain/package-install';
import {
  BUNDLED_PRODUCTION_PORTFOLIO_IDS,
  getBundledProductionPackages,
} from '@/src/domain/bundled-production-packages';

describe('bundled production registry', () => {
  it('keeps every production package statically bundled with a unique identity', () => {
    const bundled = getBundledProductionPackages();
    expect(bundled).toHaveLength(51);
    expect(new Set(BUNDLED_PRODUCTION_PORTFOLIO_IDS).size).toBe(51);
    expect(bundled.map((item) => item.portfolioId)).toEqual(BUNDLED_PRODUCTION_PORTFOLIO_IDS);

    for (const item of bundled) {
      expect(item.packageJson.id, item.portfolioId).toBe(item.portfolioId);
      expect(item.description, item.portfolioId).not.toHaveLength(0);
    }
  });

  it('exposes every bundled package plus legacy aliases without duplicate ids', async () => {
    const remoteFetch = async () => {
      throw new Error('remote_fetch_forbidden');
    };
    const fetcher = createPackageInstallFetcher(remoteFetch);
    const manifest = await fetchRegistryManifest(BUNDLED_UTOPIA_REGISTRY_URL, fetcher);
    const ids = manifest.packages.map((item) => item.id);
    const portfolioIds = [...BUNDLED_PRODUCTION_PORTFOLIO_IDS];
    const specialIds = ['scientific-calculator', 'audio-loop-108', 'habit-grid', 'expense-splitter', 'split-rent', 'workout-logger', 'focus-intervals'];

    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.filter((id) => portfolioIds.includes(id))).toHaveLength(51);
    for (const id of [...portfolioIds, ...specialIds]) {
      expect(manifest.packages.filter((item) => item.id === id), `${id} registry entry`).toHaveLength(1);
    }
    expect(manifest.packages).toHaveLength(new Set([...portfolioIds, ...specialIds]).size);
  });

  it('fetches every bundled payload locally and verifies its registry checksum', async () => {
    const fetcher = createPackageInstallFetcher(async () => {
      throw new Error('remote_fetch_forbidden');
    });
    const manifest = getBundledRegistryManifest();

    for (const app of getBundledProductionPackages()) {
      const descriptor = manifest.packages.find((item) => item.id === app.portfolioId);
      expect(descriptor, `${app.portfolioId} descriptor`).toBeDefined();
      const response = await fetcher(descriptor!.url);
      expect(response.ok, `${app.portfolioId} fetch`).toBe(true);
      const payload = await response.json?.();
      expect(sha256Canonical(payload), `${app.portfolioId} checksum`).toBe(descriptor!.checksum);
      expect(payload, `${app.portfolioId} identity`).toMatchObject({ id: app.portfolioId });

      // Food is a domain reference package, not an app-package.v2/v3 payload.
      if (app.portfolioId !== 'food') {
        const candidate = await fetchPackageInstallCandidate(descriptor!.url, fetcher, {
          registryPackage: descriptor,
        });
        expect(candidate.preview.trust.status, `${app.portfolioId} trust`).toBe('checksum_verified');
        expect(candidate.preview.packageId, `${app.portfolioId} preview`).toBe(app.portfolioId);
      }
    }
  });
});
