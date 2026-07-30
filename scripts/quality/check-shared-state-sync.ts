import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  createFileSharedStateSyncAdapter,
  createInMemorySharedStateSyncAdapter,
  runSharedStateSyncProof,
  SHARED_STATE_SYNC_SCHEMA_VERSION,
} from '@/src/providers/shared-state-sync';

const DEFAULT_WORKSPACE_ID = 'default-workspace' as const;

function createRoot() {
  return mkdtempSync(join(tmpdir(), 'utopia-shared-state-sync-'));
}

let root = '';
try {
  root = createRoot();
  const filePath = join(root, 'shared-state-sync.json');
  const memory = runSharedStateSyncProof(createInMemorySharedStateSyncAdapter());
  const file = runSharedStateSyncProof(createFileSharedStateSyncAdapter(filePath));
  const reloaded = createFileSharedStateSyncAdapter(filePath).snapshot({
    schemaVersion: SHARED_STATE_SYNC_SCHEMA_VERSION,
    workspaceId: DEFAULT_WORKSPACE_ID,
    installationId: 'install-a',
  });
  const liveBoundary = {
    scope: 'local deterministic',
    proofStatus: file.live_multi_device_sync_claims.status,
    localDeterministicStatus: file.live_multi_device_sync_claims.readiness.local_deterministic,
    liveProviderDeviceStatus: file.live_multi_device_sync_claims.readiness.live_provider_device,
    requiredNextProof: file.live_multi_device_sync_claims.required_next_proof,
  };

  const evidence = {
    proof: 'shared_state_sync_local_conflict_merge_recovery',
    schemaVersion: SHARED_STATE_SYNC_SCHEMA_VERSION,
    syncReadiness: {
      liveMultiDeviceSyncBoundary: {
        ...liveBoundary,
        status: 'BLOCKED',
        summary: 'local deterministic sync proofs are PASS; real live multi-device/provider sync proof is BLOCKED',
      },
    },
    deterministicScenarios: {
      conflictMergeRecoveryLocal: {
        sameRecordConflictStatus: memory.same_record_conflict.status,
        offlineThreeWayMergeStatus: memory.offline_three_way_merge.status,
        deviceLossRecovered: memory.device_loss_recovery_boundary.recovered_present_after,
        reconnectMatched: memory.reconnect_convergence.matched,
        localDeterministicSync: memory.live_multi_device_sync_claims.readiness.local_deterministic,
        liveProviderDeviceSync: memory.live_multi_device_sync_claims.readiness.live_provider_device,
        liveProviderDeviceRequiredProof: memory.live_multi_device_sync_claims.required_next_proof,
      },
    },
    all_passed:
      memory.all_passed
      && file.all_passed
      && memory.same_record_conflict.status === 'conflict'
      && file.same_record_conflict.status === 'conflict'
      && memory.offline_three_way_merge.status === 'applied'
      && file.offline_three_way_merge.status === 'applied'
      && memory.device_loss_recovery_boundary.lost_present_before === true
      && memory.device_loss_recovery_boundary.recovered_present_after === false
      && memory.reconnect_convergence.matched === true
      && file.reconnect_convergence.matched === true
      && memory.live_multi_device_sync_claims.status === 'BLOCKED'
      && file.live_multi_device_sync_claims.status === 'BLOCKED'
      && memory.live_multi_device_sync_claims.readiness.local_deterministic === 'PASS'
      && memory.live_multi_device_sync_claims.readiness.live_provider_device === 'BLOCKED'
      && file.live_multi_device_sync_claims.readiness.local_deterministic === 'PASS'
      && file.live_multi_device_sync_claims.readiness.live_provider_device === 'BLOCKED'
      && memory.family_group_sync_claims.status === 'BLOCKED'
      && memory.family_group_sync_claims.status === file.family_group_sync_claims.status
      && JSON.stringify(memory.offline_writes) === JSON.stringify(file.offline_writes)
      && JSON.stringify(memory.same_record_conflict) === JSON.stringify(file.same_record_conflict)
      && JSON.stringify(memory.simultaneous_edits) === JSON.stringify(file.simultaneous_edits)
      && JSON.stringify(memory.offline_three_way_merge) === JSON.stringify(file.offline_three_way_merge)
      && JSON.stringify(memory.delete_update_conflict) === JSON.stringify(file.delete_update_conflict)
      && JSON.stringify(memory.idempotent_replay) === JSON.stringify(file.idempotent_replay)
      && JSON.stringify(memory.tombstones) === JSON.stringify(file.tombstones)
      && JSON.stringify(memory.per_installation_isolation) === JSON.stringify(file.per_installation_isolation)
      && JSON.stringify(memory.schema_version_refusal) === JSON.stringify(file.schema_version_refusal)
      && JSON.stringify(memory.live_multi_device_sync_claims) === JSON.stringify(file.live_multi_device_sync_claims)
      && JSON.stringify(memory.family_group_sync_claims) === JSON.stringify(file.family_group_sync_claims)
      && JSON.stringify(memory.reconnect_convergence) === JSON.stringify(file.reconnect_convergence)
      && JSON.stringify(memory.device_loss_recovery_boundary) === JSON.stringify(file.device_loss_recovery_boundary)
      && reloaded.records.some((record) => record.id === 'shared-note')
      && !reloaded.records.some((record) => record.id === 'lost-write'),
    adapters: {
      memory,
      file,
    },
    reloaded_snapshot: {
      cursor: reloaded.cursor,
      records: reloaded.records.map((record) => record.id).sort(),
    },
  };
  if (!evidence.all_passed) throw new Error('shared_state_sync_proof_failed');

  const outDir = join(process.cwd(), 'app', 'build', 'evidence');
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, 'shared-state-sync-proof.json');
  writeFileSync(outPath, JSON.stringify(evidence, null, 2));
  console.log(`PASS ${outPath}`);
  console.log('SYNC_READINESS=local deterministic local_passed=true live_multi_device_status=BLOCKED');
} catch (error) {
  console.error('FAIL', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  if (root) rmSync(root, { recursive: true, force: true });
}
