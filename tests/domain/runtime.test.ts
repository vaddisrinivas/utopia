import { describe, expect, it } from 'vitest';

import { loadCatalog } from '@/src/domain/catalog';
import { validateCanonicalRecord } from '@/src/domain/runtime';

const manifest = loadCatalog().activeManifest;

describe('validateCanonicalRecord', () => {
  it('adds envelope defaults without fabricating confidence', () => {
    const record = validateCanonicalRecord({
      id: 'runtime-defaults',
      title: 'Runtime defaults',
      collection: 'inventory',
      properties: {},
      relations: [],
      source: { provider: 'sqlite', external_id: 'runtime-defaults', url: null, observed_at: '2026-07-23T00:00:00.000Z', content_hash: null },
      archived_at: null,
    }, manifest.id, manifest);

    expect(record.revision).toBe(1);
    expect(record.schema_version).toBe(manifest.schema_version);
    expect(record.deleted).toBe(false);
    expect(record.privacy).toBe('personal');
    expect(record.provenance).toBeNull();
  });

  it('rejects explicit relation targets pointing at unknown collections', () => {
    const record = validateCanonicalRecord({
      id: 'runtime-relation',
      title: 'Runtime relation',
      collection: 'inventory',
      properties: {},
      relations: [
        { name: 'uses', target_id: 'not_a_collection:abc' },
        { name: 'uses', target_id: `${manifest.id}:still_not_a_collection:abc` },
        { name: 'uses', target_id: 'recipe:abc' },
      ],
      source: { provider: 'sqlite', external_id: 'runtime-relation', url: null, observed_at: '2026-07-23T00:00:00.000Z', content_hash: null },
      archived_at: null,
    }, manifest.id, manifest);

    expect(record.relations).toEqual([{ name: 'uses', target_id: 'recipe:abc' }]);
  });
});
