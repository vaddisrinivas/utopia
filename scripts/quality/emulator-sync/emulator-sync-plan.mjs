import { randomBytes } from 'node:crypto';

export const EMULATOR_SYNC_PROOF_SCHEMA_VERSION = 'utopia.emulator-sync-proof.v1';
export const DEFAULT_EMULATOR_IDENTITIES = ['emulator-5554', 'emulator-5556', 'emulator-5558'];
export const DEFAULT_PROOF_AVD_COUNT = 3;
export const REQUIRED_AVD_COUNT = 2;

export function normalizeAvdIdentities(raw) {
  const parsed = (raw || '').split(',').map((value) => value.trim()).filter(Boolean);
  const seen = new Set();

  for (const candidate of parsed) {
    if (seen.has(candidate)) continue;
    if (candidate) seen.add(candidate);
    if (seen.size >= DEFAULT_PROOF_AVD_COUNT) break;
  }

  if (seen.size === 0) {
    for (const fallback of DEFAULT_EMULATOR_IDENTITIES) {
      seen.add(fallback);
    }
  }

  return Array.from(seen).slice(0, DEFAULT_PROOF_AVD_COUNT);
}

export function parseAdbDevices(output) {
  if (!output) return [];
  return output
    .split('\n')
    .slice(1)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith('*'))
    .map((line) => {
      const [serial, status, ...rest] = line.split(/\s+/);
      if (!serial || !status) return null;
      return {
        serial,
        status,
        model: (rest.join(' ') || '').includes('model:')
          ? String((rest.join(' ').match(/model:([^\s]+)/) || [null, null])[1])
          : null,
        transport_id: (rest.join(' ') || '').includes('transport_id:')
          ? String((rest.join(' ').match(/transport_id:(\S+)/) || [null, null])[1])
          : null,
      };
    })
    .filter((device) => Boolean(device));
}

export function buildInstallProfiles(avdIds, runId = `run-${randomBytes(3).toString('hex')}`) {
  return avdIds.map((avdId, index) => {
    const slot = String(index + 1).padStart(2, '0');
    const installationId = `quality-${runId}-install-${slot}`;
    const appInstanceId = `emulator-sync-${runId}-${slot}`;
    return {
      avdId,
      installationId,
      appInstanceId,
      adbSerial: avdId,
      label: `emulator-sync-${slot}`,
    };
  });
}

export function buildNetworkPartitionCommands(serial) {
  return {
    disconnect: [
      `adb -s ${serial} shell svc wifi disable`,
      `adb -s ${serial} shell svc data disable`,
    ],
    reconnect: [
      `adb -s ${serial} shell svc wifi enable`,
      `adb -s ${serial} shell svc data enable`,
    ],
    statusProbe: [
      `adb -s ${serial} shell dumpsys connectivity`,
      `adb -s ${serial} shell getprop persist.sys.dalvik.vm.lib.2`,
    ],
  };
}

export function buildSyncScenario(installProfiles) {
  if (installProfiles.length < REQUIRED_AVD_COUNT) {
    throw new Error(`scenario requires at least ${String(REQUIRED_AVD_COUNT)} installs`);
  }

  return {
    scenario_id: 'convergence-conflict-rollback-v1',
    base_record: {
      id: 'quality-note-001',
      title: 'sync seed',
      status: 'draft',
      revision: 1,
      last_writer: 'seed',
    },
    operations: [
      {
        op_id: 'sync-op-alpha',
        installation_id: installProfiles[0].installationId,
        target_record_id: 'quality-note-001',
        revision_base: 1,
        updates: {
          status: 'completed',
          source: installProfiles[0].installationId,
        },
      },
      {
        op_id: 'sync-op-beta',
        installation_id: installProfiles[1].installationId,
        target_record_id: 'quality-note-001',
        revision_base: 1,
        updates: {
          status: 'stale',
          source: installProfiles[1].installationId,
        },
      },
      {
        op_id: 'sync-op-gamma',
        installation_id: installProfiles[0].installationId,
        target_record_id: 'quality-note-001',
        revision_base: 2,
        updates: {
          title: 'reconciled by deterministic merge',
          source: installProfiles[0].installationId,
        },
      },
    ],
    rollback_operations: [
      {
        rollback_id: 'rb-sync-op-beta',
        target_op_id: 'sync-op-beta',
        reason: 'network partition reconciliation replay',
      },
    ],
  };
}

function isConflict(operations) {
  const key = `${operations[0].revision_base}-${operations[0].target_record_id}-status`;
  const updates = operations
    .map((operation) => operation.updates.status)
    .filter(Boolean);
  const unique = [...new Set(updates)];
  return {
    key,
    hasConflict: unique.length > 1,
  };
}

export function evaluateSyncScenario(scenario) {
  const operations = [...scenario.operations];
  const grouped = new Map();

  for (const operation of operations) {
    for (const field of Object.keys(operation.updates).filter((field) => field !== 'source')) {
      const bucketKey = `${operation.revision_base}|${operation.target_record_id}|${field}`;
      if (!grouped.has(bucketKey)) {
        grouped.set(bucketKey, []);
      }
      grouped.get(bucketKey).push(operation);
    }
  }

  const sortedBuckets = Array.from(grouped.entries())
    .map(([bucket, ops]) => {
      const [revisionText] = bucket.split('|');
      return {
        bucket,
        revision: Number(revisionText),
        ops: ops.sort((left, right) => {
          const order = left.revision_base - right.revision_base;
          if (order !== 0) return order;
          return left.installation_id.localeCompare(right.installation_id);
        }),
      };
    })
    .sort((left, right) => (left.revision - right.revision) || left.ops[0].op_id.localeCompare(right.ops[0].op_id));

  const record = { ...(scenario.base_record) };
  const conflictEvents = [];
  const appliedOperations = [];

  for (const bucket of sortedBuckets) {
    const [field] = bucket.bucket.split('|').slice(2);
    const statusOps = bucket.ops;
    const values = new Set(statusOps.map((operation) => operation.updates[field]));

    if (values.size <= 1) {
      const op = statusOps[statusOps.length - 1];
      Object.assign(record, op.updates);
      record.last_writer = op.installation_id;
      record.revision = Math.max(record.revision, op.revision_base);
      appliedOperations.push(op.op_id);
      continue;
    }

    const winner = [...statusOps].sort((left, right) => left.installation_id.localeCompare(right.installation_id))[0];
    const loserIds = statusOps.filter((operation) => operation.op_id !== winner.op_id).map((operation) => operation.op_id);
    const winnerValue = winner.updates[field];

    const fieldMutation = Object.fromEntries(Object.entries(winner.updates).filter(([name]) => name === field));

    const winnerOp = {
      op_id: winner.op_id,
      installation_id: winner.installation_id,
      field,
      value: winnerValue,
      revision_base: winner.revision_base,
    };

    Object.assign(record, fieldMutation);
    record.last_writer = winner.installation_id;
    record.revision = Math.max(record.revision, winner.revision_base);
    appliedOperations.push(winner.op_id);

    conflictEvents.push({
      conflict_id: `${winner.revision_base}-${winner.target_record_id}-${field}`,
      record_id: winner.target_record_id,
      field,
      revision_base: winner.revision_base,
      winner: winnerOp,
      losers: loserIds,
      status: 'detected',
    });
  }

  const rollback = scenario.rollback_operations.map((rollback) => {
    const target = scenario.operations.find((operation) => operation.op_id === rollback.target_op_id);
    if (!target) {
      return {
        ...rollback,
        status: 'missing_target',
        replayed: false,
      };
    }

    const wasApplied = appliedOperations.includes(target.op_id);
    const wasLost = !wasApplied;
    return {
      ...rollback,
      status: wasLost ? 'replayed' : 'ignored',
      replayed: wasLost,
      target_installation_id: target.installation_id,
      field_conflict_rollback: wasLost,
      target_last_writer: target.updates.source,
    };
  });

  const conflictDetected = conflictEvents.length > 0;
  const conflictWinnerIds = conflictEvents.flatMap((entry) => [entry.winner.installation_id]);
  const rollbackReplayCount = rollback.filter((entry) => entry.replayed).length;
  const allPassed = isConflict(scenario.operations) ? (conflictDetected && rollbackReplayCount >= 1) : true;

  return {
    scenario_id: scenario.scenario_id,
    record_after: record,
    applied_operations: appliedOperations,
    conflict_events: conflictEvents,
    rollback_operations: rollback,
    assertions: {
      conflict_detected: conflictDetected,
      conflict_resolved_by_deterministic_winner: conflictWinnerIds,
      rollback_replayed_for_losers: rollbackReplayCount,
      convergence_replayed: record.last_writer === conflictWinnerIds[0],
    },
    all_passed: allPassed,
  };
}

export function evaluatePrerequisites({adbStatus, adbService, requestedAvdCount, availableAvdCount}) {
  const blockers = [];

  if (!adbStatus) {
    blockers.push('adb_unavailable');
  }
  if (!adbService) {
    blockers.push('adb_service_unavailable');
  }
  if (availableAvdCount < Math.min(requiredAvdCount(), requestedAvdCount)) {
    blockers.push('insufficient_avd_identities');
  }

  return {
    status: blockers.length === 0 ? 'READY' : 'BLOCKED',
    blockers,
  };
}

export function requiredAvdCount() {
  return REQUIRED_AVD_COUNT;
}
