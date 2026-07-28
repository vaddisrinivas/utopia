import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import type { AppPackage } from '@/packages/shared/contracts/package';
import { loadAppPackage } from '@/src/domain/package-loader';

describe('loadAppPackage', () => {
  it('loads an unknown package id without catalog hardcode', () => {
    const runtime = loadAppPackage(makeReferencePackage('reference-app', '1.0.0'));
    const catalogSource = readFileSync('src/domain/catalog.ts', 'utf8');

    expect(catalogSource).not.toContain('reference-app');
    expect(runtime.activePackage.id).toBe('reference-app');
    expect(runtime.activeManifest.id).toBe('reference-app');
    expect(runtime.catalog.activeDomainId).toBe('reference-app');
    expect(runtime.catalog.catalog.domains.some((domain) => domain.id === 'reference-app')).toBe(true);
    expect(runtime.catalog.activeManifest.surfaces.map((surface) => surface.id)).toEqual(['today', 'chores', 'household']);
  });
});

function makeReferencePackage(id: string, version: string): AppPackage {
  return {
    schemaVersion: 'wonder.app-package.v2',
    id,
    version,
    collections: {
      chore: {
        id: 'chore',
        fields: baseFields({ status: { type: 'text' } }),
      },
      assignment: {
        id: 'assignment',
        fields: baseFields({ assignee: { type: 'text' } }),
      },
      household_member: {
        id: 'household_member',
        fields: baseFields({ role: { type: 'text' } }),
      },
      completion: {
        id: 'completion',
        fields: baseFields({ completed_at: { type: 'timestamp' } }),
      },
    },
    queries: {
      today: { from: 'records', where: { op: 'eq', field: 'collection', value: 'assignment' } },
      chores: { from: 'records', where: { op: 'eq', field: 'collection', value: 'chore' } },
      household: { from: 'records', where: { op: 'eq', field: 'collection', value: 'household_member' } },
    },
    views: {
      today: { id: 'today', query: 'today', mode: 'list', fields: ['title', 'updated_at'] },
      chores: { id: 'chores', query: 'chores', mode: 'list', fields: ['title', 'updated_at'] },
      household: { id: 'household', query: 'household', mode: 'list', fields: ['title', 'updated_at'] },
    },
    presentation: {
      label: 'Reference App',
      homeSurface: 'today',
      surfaces: [
        { id: 'today', label: 'Today', collections: ['assignment'], views: ['today'] },
        { id: 'chores', label: 'Chores', collections: ['chore'], views: ['chores'] },
        { id: 'household', label: 'Household', collections: ['household_member'], views: ['household'] },
      ],
    },
    rules: [],
    capabilities: [],
    acceptanceTests: ['reference-app-loader'],
  };
}

function baseFields(extra: AppPackage['collections'][string]['fields'] = {}): AppPackage['collections'][string]['fields'] {
  return {
    id: { type: 'text', required: true, indexed: true },
    title: { type: 'text', required: true, indexed: true },
    collection: { type: 'text', required: true, indexed: true },
    updated_at: { type: 'timestamp', required: true, indexed: true },
    properties: { type: 'json', required: true },
    ...extra,
  };
}
