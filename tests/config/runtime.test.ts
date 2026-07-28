import { describe, expect, it } from 'vitest';

import {
  applyConfigProposal,
  buildConfigProposal,
  undoConfigProposal,
  validateConfigSnapshot,
} from '@/src/config/runtime';
import type { ConfigSource, ConfigSnapshot, ControlPlaneState } from '@/src/config/types';

const now = '2026-07-23T02:00:00.000Z';

function source(id: string, precedence: number): ConfigSource {
  return {
    id,
    kind: 'local',
    label: id,
    location: { path: `${id}.json` },
    enabled: true,
    auto_refresh: false,
    refresh_minutes: 60,
    precedence,
    created_at: now,
    updated_at: now,
  };
}

function snapshot(sourceId: string, raw: string): ConfigSnapshot {
  return {
    source_id: sourceId,
    fetched_at: now,
    content_hash: `hash-${sourceId}`,
    raw,
    validation_status: 'unvalidated',
  };
}

describe('config runtime', () => {
  it('validates JSON and simple YAML-like config snapshots', () => {
    expect(validateConfigSnapshot(snapshot('json', '{"domains":["food"]}'))).toMatchObject({
      ok: true,
      document: { domains: ['food'] },
    });
    expect(validateConfigSnapshot(snapshot('yaml', 'domain: food\nscreens:\n  - home\n  - chat'))).toMatchObject({
      ok: true,
      document: { domain: 'food', screens: ['home', 'chat'] },
    });
  });

  it('merges additive config by source precedence', () => {
    const proposal = buildConfigProposal({
      now,
      snapshots: [
        { source: source('base', 1), snapshot: snapshot('base', '{"domains":["food"],"screens":["home"]}') },
        { source: source('second', 2), snapshot: snapshot('second', '{"domains":["health"],"screens":["chat"]}') },
      ],
    });

    expect(proposal.errors).toEqual([]);
    expect(proposal.conflicts).toEqual([]);
    expect(proposal.mode).toBe('additive');
    expect(proposal.document).toEqual({
      domains: ['food', 'health'],
      screens: ['home', 'chat'],
    });
  });

  it('lets higher precedence scalar config override lower precedence defaults', () => {
    const proposal = buildConfigProposal({
      now,
      snapshots: [
        { source: source('base', 1), snapshot: snapshot('base', '{"activeDomain":"food"}') },
        { source: source('remote', 2), snapshot: snapshot('remote', '{"activeDomain":"health"}') },
      ],
    });

    expect(proposal.errors).toEqual([]);
    expect(proposal.conflicts).toEqual([]);
    expect(proposal.mode).toBe('additive');
    expect(proposal.document.activeDomain).toBe('health');
  });

  it('refuses equal-precedence scalar conflicts until the user reviews them', () => {
    const proposal = buildConfigProposal({
      now,
      snapshots: [
        { source: source('base', 2), snapshot: snapshot('base', '{"activeDomain":"food"}') },
        { source: source('remote', 2), snapshot: snapshot('remote', '{"activeDomain":"health"}') },
      ],
    });

    expect(proposal.mode).toBe('migration_required');
    expect(proposal.conflicts).toHaveLength(1);
    expect(proposal.conflicts[0]).toMatchObject({
      key: 'activeDomain',
      sources: ['base', 'remote'],
      status: 'needs_review',
    });
    expect(applyConfigProposal(proposal).ok).toBe(false);
  });

  it('marks destructive config as migration-required by default', () => {
    const proposal = buildConfigProposal({
      now,
      snapshots: [
        { source: source('remote', 1), snapshot: snapshot('remote', '{"remove":["food.collections.old"]}') },
      ],
    });

    expect(proposal.mode).toBe('migration_required');
    expect(proposal.conflicts[0]).toMatchObject({
      key: 'migration',
      reason: expect.stringContaining('Additive mode cannot apply'),
    });
  });

  it('marks nested destructive config as migration-required by default', () => {
    const proposal = buildConfigProposal({
      now,
      snapshots: [
        {
          source: source('remote', 1),
          snapshot: snapshot('remote', JSON.stringify({
            domains: {
              food: {
                collections: {
                  inventory: {
                    remove: ['expiry_date'],
                  },
                },
              },
            },
          })),
        },
      ],
    });

    expect(proposal.mode).toBe('migration_required');
    expect(proposal.conflicts[0]).toMatchObject({
      key: 'migration',
      reason: expect.stringContaining('Additive mode cannot apply'),
    });
    expect(applyConfigProposal(proposal).ok).toBe(false);
  });

  it('applies clean proposals and undoes to the previous control-plane state', () => {
    const previous: ControlPlaneState = {
      sources: [source('previous', 1)],
      snapshots: [],
      conflicts: [],
      errors: [],
      manifests: { domains: ['food'] },
      applied_at: '2026-07-22T00:00:00.000Z',
      last_good_hash: 'old-hash',
      mode: 'additive',
    };
    const proposal = buildConfigProposal({
      previous,
      now,
      snapshots: [
        { source: source('next', 2), snapshot: snapshot('next', '{"screens":["home","chat"]}') },
      ],
    });
    const applied = applyConfigProposal(proposal);

    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.state.manifests).toEqual({
      domains: ['food'],
      screens: ['home', 'chat'],
    });
    expect(undoConfigProposal(applied.undo)).toBe(previous);
  });
});
