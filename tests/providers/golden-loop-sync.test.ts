import { describe, expect, it } from 'vitest';

import {
  createInMemorySharedStateSyncAdapter,
  runSharedStateSyncProof,
} from '@/src/providers/shared-state-sync';

describe('golden loop shared-state sync', () => {
  it('exercises two-installation isolation, conflict, and convergence contract', () => {
    const proof = runSharedStateSyncProof(createInMemorySharedStateSyncAdapter());

    expect(proof.per_installation_isolation.installationA_records.length).toBeGreaterThan(0);
    expect(proof.per_installation_isolation.installationB_records.length).toBeGreaterThan(0);
    expect(proof.per_installation_isolation.shared_record_in_a).not.toBeNull();
    expect(proof.per_installation_isolation.shared_record_in_b).not.toBeNull();
    expect(proof.per_installation_isolation.shared_record_in_a).not.toEqual(proof.per_installation_isolation.shared_record_in_b);

    expect(proof.same_record_conflict.status).toBe('conflict');
    expect(proof.same_record_conflict.loser_pending).toBe(0);
    expect(proof.same_record_conflict.winner_title).toBe('Conflict note');

    expect(proof.reconnect_convergence.matched).toBe(true);
    expect(proof.reconnect_convergence.device_count).toBeGreaterThanOrEqual(3);
    expect(proof.reconnect_convergence.snapshot_checksum).toBeTruthy();
  });

  it('captures offline writes, tombstones, and idempotent replay', () => {
    const proof = runSharedStateSyncProof(createInMemorySharedStateSyncAdapter());

    expect(proof.offline_writes.applied).toBeGreaterThan(0);
    expect(proof.offline_writes.records).toEqual(expect.arrayContaining([
      'offline-party-a',
      'offline-party-b',
      'offline-party-c',
    ]));
    expect(proof.offline_three_way_merge.status).toBe('applied');
    expect(proof.offline_three_way_merge.applied).toBe(3);

    expect(proof.idempotent_replay.duplicate).toBe(true);
    expect(proof.idempotent_replay.first).toBe('applied');
    expect(proof.idempotent_replay.second).toBe('duplicate');

    expect(proof.tombstones.status).toBe('applied');
    expect(proof.tombstones.deleted).toBe(true);
    expect(proof.tombstones.archived_at).toBeTruthy();
  });

  it('exposes device-loss recovery boundary and blocks live-device proof', () => {
    const proof = runSharedStateSyncProof(createInMemorySharedStateSyncAdapter());

    expect(proof.device_loss_recovery_boundary.lost_present_before).toBe(true);
    expect(proof.device_loss_recovery_boundary.recovered_present_after).toBe(false);
    expect(proof.device_loss_recovery_boundary.persisted_cursor).toBeTruthy();

    expect(proof.live_multi_device_sync_claims.status).toBe('BLOCKED');
    expect(proof.live_multi_device_sync_claims.readiness.local_deterministic).toBe('PASS');
    expect(proof.live_multi_device_sync_claims.readiness.live_provider_device).toBe('BLOCKED');
    expect(proof.live_multi_device_sync_claims.required_next_proof).toContain('real installations/devices');
    expect(proof.live_multi_device_sync_claims.reason).toContain('real sync adapter');
  });
});
