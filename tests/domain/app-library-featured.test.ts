import { describe, expect, it } from 'vitest';

import type { AppInstallation } from '@/packages/shared/contracts/app-installation';
import { buildFeaturedAppLibraryEntries, FEATURED_APP_LIBRARY_IDS } from '@/src/domain/app-library-featured';
import { getBundledRegistryManifest } from '@/src/domain/package-install';

describe('featured App Library', () => {
  it('presents nine distinct apps with a usable action', () => {
    const entries = buildFeaturedAppLibraryEntries({
      registry: getBundledRegistryManifest(),
      installations: [],
    });

    expect(entries.map((item) => item.id)).toEqual(FEATURED_APP_LIBRARY_IDS);
    expect(new Set(entries.map((item) => item.capability)).size).toBe(entries.length);
    expect(entries).toHaveLength(9);
    expect(entries.find((item) => item.id === 'food')).toMatchObject({
      action: 'open',
      route: '/food',
    });
    expect(entries.filter((item) => item.id !== 'food').every((item) => (
      item.action === 'review' && item.registryPackage?.id === item.id
    ))).toBe(true);
  });

  it('opens an active installation instead of offering another install', () => {
    const installation = {
      id: 'installation-calculator',
      label: 'Scientific Workbench',
      status: 'active',
      packageBinding: {
        packageId: 'scientific-calculator',
        version: '1.0.0',
      },
    } as AppInstallation;
    const entries = buildFeaturedAppLibraryEntries({
      registry: getBundledRegistryManifest(),
      installations: [installation],
    });

    expect(entries.find((item) => item.id === 'scientific-calculator')).toMatchObject({
      action: 'open',
      installation,
    });
  });
});
