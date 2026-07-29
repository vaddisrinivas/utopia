import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  createFileSharedStateSyncAdapter,
  createInMemorySharedStateSyncAdapter,
  runSharedStateSyncProof,
  SHARED_STATE_SYNC_SCHEMA_VERSION,
} from '@/src/providers/shared-state-sync';

const DEFAULT_WORKSPACE_ID = 'default-workspace' as const;

describe('shared-state sync harness', () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it('proves the same contract on memory and file adapters', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'utopia-shared-state-sync-'));
    roots.push(root);
    const filePath = path.join(root, 'shared-state-sync.json');

    const memoryProof = runSharedStateSyncProof(createInMemorySharedStateSyncAdapter());
    const fileProof = runSharedStateSyncProof(createFileSharedStateSyncAdapter(filePath));
    const reloaded = createFileSharedStateSyncAdapter(filePath).snapshot({
      schemaVersion: SHARED_STATE_SYNC_SCHEMA_VERSION,
      workspaceId: DEFAULT_WORKSPACE_ID,
      installationId: 'install-a',
    });

    expect(memoryProof.schemaVersion).toBe(SHARED_STATE_SYNC_SCHEMA_VERSION);
    expect(fileProof.schemaVersion).toBe(SHARED_STATE_SYNC_SCHEMA_VERSION);
    expect(fileProof.kind).toBe('file');
    expect(memoryProof.kind).toBe('memory');
    expect(memoryProof.all_passed).toBe(true);
    expect(fileProof.all_passed).toBe(true);
    expect(fileProof.offline_writes).toEqual(memoryProof.offline_writes);
    expect(fileProof.same_record_conflict).toEqual(memoryProof.same_record_conflict);
    expect(fileProof.simultaneous_edits).toEqual(memoryProof.simultaneous_edits);
    expect(fileProof.offline_three_way_merge).toEqual(memoryProof.offline_three_way_merge);
    expect(fileProof.delete_update_conflict).toEqual(memoryProof.delete_update_conflict);
    expect(fileProof.idempotent_replay).toEqual(memoryProof.idempotent_replay);
    expect(fileProof.tombstones).toEqual(memoryProof.tombstones);
    expect(fileProof.per_installation_isolation).toEqual(memoryProof.per_installation_isolation);
    expect(fileProof.schema_version_refusal).toEqual(memoryProof.schema_version_refusal);
    expect(fileProof.family_group_sync_claims).toEqual(memoryProof.family_group_sync_claims);
    expect(fileProof.live_multi_device_sync_claims).toEqual(memoryProof.live_multi_device_sync_claims);
    expect(fileProof.reconnect_convergence).toEqual(memoryProof.reconnect_convergence);
    expect(fileProof.device_loss_recovery_boundary).toEqual(memoryProof.device_loss_recovery_boundary);
    expect(memoryProof.simultaneous_edits.status).toBe('applied');
    expect(memoryProof.simultaneous_edits.winner_title).toBe('Shared note');
    expect(memoryProof.offline_three_way_merge.status).toBe('applied');
    expect(memoryProof.offline_three_way_merge.applied).toBe(3);
    expect(memoryProof.offline_three_way_merge.records).toEqual([
      'offline-party-a',
      'offline-party-b',
      'offline-party-c',
    ]);
    expect(memoryProof.same_record_conflict.status).toBe('conflict');
    expect(memoryProof.delete_update_conflict.status).toBe('conflict');
    expect(memoryProof.family_group_sync_claims.status).toBe('BLOCKED');
    expect(memoryProof.live_multi_device_sync_claims.status).toBe('BLOCKED');
    expect(memoryProof.live_multi_device_sync_claims.readiness.local_deterministic).toBe('PASS');
    expect(memoryProof.live_multi_device_sync_claims.readiness.live_provider_device).toBe('BLOCKED');
    expect(memoryProof.live_multi_device_sync_claims.required_next_proof).toContain('real installations/devices');
    expect(reloaded.records.map((record) => record.id).sort()).toContain('shared-note');
    expect(reloaded.records.some((record) => record.id === 'lost-write')).toBe(false);
  });

  it('captures deterministic local conflict, merge, and recovery proof', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'utopia-shared-state-sync-local-proof-'));
    roots.push(root);

    const memoryProof = runSharedStateSyncProof(createInMemorySharedStateSyncAdapter());
    const fileProof = runSharedStateSyncProof(createFileSharedStateSyncAdapter(path.join(root, 'shared-state-sync-local-proof.json')));

    expect(fileProof.schemaVersion).toBe(memoryProof.schemaVersion);
    expect(fileProof.kind).toBe('file');
    expect(memoryProof.kind).toBe('memory');
    expect(fileProof.all_passed).toBe(true);
    expect(memoryProof.all_passed).toBe(true);
    expect(fileProof.same_record_conflict.status).toBe('conflict');
    expect(fileProof.simultaneous_edits.status).toBe('applied');
    expect(fileProof.offline_three_way_merge.status).toBe('applied');
    expect(fileProof.device_loss_recovery_boundary.lost_present_before).toBe(true);
    expect(fileProof.device_loss_recovery_boundary.recovered_present_after).toBe(false);
    expect(fileProof.reconnect_convergence.matched).toBe(true);
    expect(fileProof.live_multi_device_sync_claims.readiness.local_deterministic).toBe('PASS');
    expect(fileProof.live_multi_device_sync_claims.readiness.live_provider_device).toBe('BLOCKED');
    expect(fileProof.live_multi_device_sync_claims.required_next_proof).toContain('real installations/devices');
    expect(fileProof.live_multi_device_sync_claims).toEqual(memoryProof.live_multi_device_sync_claims);
    expect(fileProof.family_group_sync_claims.deterministic_multi_writer_evidence).toBe(true);
    expect(fileProof.family_group_sync_claims.status).toBe('BLOCKED');
    expect(fileProof.family_group_sync_claims.reason).toContain('live provider/device multi-writer');
    expect(memoryProof.same_record_conflict).toEqual(fileProof.same_record_conflict);
    expect(memoryProof.offline_three_way_merge).toEqual(fileProof.offline_three_way_merge);
    expect(memoryProof.device_loss_recovery_boundary).toEqual(fileProof.device_loss_recovery_boundary);
  });
});
