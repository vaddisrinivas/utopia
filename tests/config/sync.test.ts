import { describe, expect, it } from 'vitest';

import { syncConfigSources, type ConfigSyncStore } from '@/src/config/sync';
import { saveConfigConflict, saveConfigSnapshot, saveConfigSource } from '@/src/db/config';
import type { ConfigConflict, ConfigSource, ConfigSnapshot, ControlPlaneState } from '@/src/config/types';

const now = '2026-07-23T03:00:00.000Z';

function source(input: Partial<ConfigSource> & Pick<ConfigSource, 'id' | 'kind' | 'location'>): ConfigSource {
  return {
    label: input.id,
    enabled: true,
    auto_refresh: false,
    refresh_minutes: 60,
    precedence: 1,
    created_at: now,
    updated_at: now,
    ...input,
  };
}

class MemoryConfigStore implements ConfigSyncStore {
  sources: ConfigSource[] = [];
  snapshots: ConfigSnapshot[] = [];
  conflicts: ConfigConflict[] = [];

  async saveSource(value: ConfigSource) {
    this.sources.push(value);
  }

  async saveSnapshot(value: ConfigSnapshot) {
    this.snapshots.push(value);
  }

  async saveConflict(value: ConfigConflict) {
    this.conflicts.push(value);
  }
}

class SqlCaptureDb {
  statements: string[] = [];

  async runAsync(sql: string) {
    this.statements.push(sql.replace(/\s+/g, ' ').trim());
  }
}

describe('config sync', () => {
  it('syncs fetched config into control-plane store only', async () => {
    const store = new MemoryConfigStore();
    const result = await syncConfigSources({
      now,
      store,
      sources: [
        source({ id: 'local-food', kind: 'local', location: { path: 'food.yaml' } }),
        source({ id: 'disabled-health', kind: 'local', enabled: false, location: { path: 'health.yaml' } }),
      ],
      localFiles: {
        'food.yaml': 'domains:\n  - food',
        'health.yaml': 'domains:\n  - health',
      },
    });

    expect(store.sources.map((item) => item.id)).toEqual(['local-food', 'disabled-health']);
    expect(store.snapshots.map((item) => item.source_id)).toEqual(['local-food']);
    expect(result.proposal.document).toEqual({ domains: ['food'] });
    expect(result.errors).toEqual([]);
  });

  it('persists conflicts without applying disputed config', async () => {
    const store = new MemoryConfigStore();
    const result = await syncConfigSources({
      now,
      store,
      sources: [
        source({ id: 'one', kind: 'local', precedence: 2, location: { path: 'one.json' } }),
        source({ id: 'two', kind: 'local', precedence: 2, location: { path: 'two.json' } }),
      ],
      localFiles: {
        'one.json': '{"activeDomain":"food"}',
        'two.json': '{"activeDomain":"health"}',
      },
    });

    expect(result.proposal.mode).toBe('migration_required');
    expect(store.conflicts).toHaveLength(1);
    expect(store.conflicts[0].key).toBe('activeDomain');
  });

  it('keeps last-good control plane when remote fetch or validation fails', async () => {
    const previous: ControlPlaneState = {
      sources: [source({ id: 'last-good', kind: 'local', location: { path: 'last-good.json' } })],
      snapshots: [],
      conflicts: [],
      errors: [],
      manifests: { domains: ['food'], screens: ['home'] },
      applied_at: '2026-07-22T00:00:00.000Z',
      last_good_hash: 'last-good-hash',
      mode: 'additive',
    };
    const store = new MemoryConfigStore();
    const result = await syncConfigSources({
      now,
      previous,
      store,
      sources: [
        source({ id: 'remote-down', kind: 'url', location: { url: 'https://example.invalid/utopia.yaml' } }),
        source({ id: 'remote-bad', kind: 'local', location: { path: 'bad.yaml' }, precedence: 2 }),
      ],
      localFiles: {
        'bad.yaml': 'not valid\n  : yaml',
      },
      fetcher: async () => ({ ok: false, status: 503, text: async () => 'down' }),
    });

    expect(result.errors.map((error) => error.path)).toEqual(['remote-down', 'remote-bad']);
    expect(result.proposal.document).toEqual(previous.manifests);
    expect(store.snapshots.map((item) => item.source_id)).toEqual(['remote-bad']);
    expect(store.conflicts).toEqual([]);
  });

  it('SQLite control-plane persistence writes only config tables', async () => {
    const db = new SqlCaptureDb();
    const local = source({ id: 'local-food', kind: 'local', location: { path: 'food.yaml' } });
    const snap: ConfigSnapshot = {
      source_id: 'local-food',
      fetched_at: now,
      content_hash: 'hash',
      raw: 'domains:\n  - food',
      validation_status: 'valid',
    };
    const conflict: ConfigConflict = {
      id: 'conflict',
      key: 'activeDomain',
      sources: ['local-food'],
      reason: 'test',
      status: 'needs_review',
      created_at: now,
    };

    await saveConfigSource(db as any, local);
    await saveConfigSnapshot(db as any, snap);
    await saveConfigConflict(db as any, conflict);

    expect(db.statements).toHaveLength(3);
    expect(db.statements.every((statement) => /^INSERT OR REPLACE INTO config_/i.test(statement))).toBe(true);
    expect(db.statements.some((statement) => /\brecords\b/i.test(statement))).toBe(false);
  });
});
