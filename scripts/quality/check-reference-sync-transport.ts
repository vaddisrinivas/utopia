import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';

import { currentGit } from './evidence-provenance.mjs';
import type { CanonicalRecord } from '@/packages/shared/contracts/records';
import type { Operation } from '@/packages/shared/contracts/operation';
import { sha256Canonical } from '@/src/domain/canonical-json';
import { SHARED_STATE_SYNC_SCHEMA_VERSION } from '@/src/providers/shared-state-sync';
import {
  ReferenceSyncTransportClient,
  referenceSyncTransportPaths,
} from '@/src/providers/reference-sync-transport';

type ReferenceSyncTransportEvidence = {
  proof: 'reference_sync_transport_live';
  schemaVersion: typeof SHARED_STATE_SYNC_SCHEMA_VERSION;
  run_id: string;
  status: 'PASS' | 'BLOCKED';
  checked_at: string;
  blockers: string[];
  git: ReturnType<typeof currentGit>;
  distinct_client_ids: string[];
  installation_ids: string[];
  workspace_ids: string[];
  final_state_checksum: string;
  final_state_cursor: string;
  scenario: {
    conflict_detected: boolean;
    offline_write_buffered: boolean;
    rollback_replay: boolean;
    tombstone_applied: boolean;
    cursor_converged: boolean;
    reconnect_recovered: boolean;
    tenant_isolated: boolean;
  };
};

const ROOT = process.cwd();
const PORT = Number(process.env.UTOPIA_REFERENCE_SYNC_TRANSPORT_PORT) || 18481;
const EVIDENCE_PATH =
  process.env.UTOPIA_REFERENCE_SYNC_TRANSPORT_EVIDENCE_PATH
  || join(ROOT, 'app', 'build', 'evidence', 'reference-sync-transport-evidence.json');
const RUN_ID = process.env.UTOPIA_REFERENCE_SYNC_TRANSPORT_RUN_ID
  || `reference-sync-transport-${new Date().toISOString().replace(/[-:.]/g, '')}`;
const TSX_BINARY = join(ROOT, 'node_modules', '.bin', 'tsx');
const RELAY_SCRIPT = join(ROOT, 'scripts', 'quality', 'reference-sync-transport-relay.ts');

const blockers: string[] = [];

function assert(condition: unknown, message: string): void {
  if (!condition) {
    blockers.push(message);
  }
}

function makeRecord(input: {
  id: string;
  title: string;
  properties: Record<string, unknown>;
  updatedAt: string;
  revision: number;
  deleted?: boolean;
  archivedAt?: string | null;
}): CanonicalRecord {
  return {
    id: input.id,
    domain: 'shared-household-board',
    collection: 'task',
    title: input.title,
    properties: input.properties,
    relations: [],
    source: {
      provider: 'sqlite',
      external_id: input.id,
      url: null,
      observed_at: input.updatedAt,
      content_hash: null,
    },
    archived_at: input.archivedAt ?? null,
    created_at: input.updatedAt,
    updated_at: input.updatedAt,
    revision: input.revision,
    schema_version: '1.0.0',
    deleted: input.deleted ?? false,
    privacy: 'personal',
    provenance: {
      actor: 'sync',
      confidence: null,
      evidence: ['reference-sync-transport-script'],
      reason: 'network transport proof',
    },
  };
}

function makeOperation(input: {
  opId: string;
  kind: Operation['kind'];
  record: CanonicalRecord;
  expectedRevision: number;
  idempotencyKey?: string;
}): Operation {
  return {
    op_id: input.opId,
    kind: input.kind,
    domain: input.record.domain,
    collection: input.record.collection,
    record_id: input.record.id,
    expected_revision: input.expectedRevision,
    record: input.record,
    actor: 'sync',
    origin: 'sync',
    idempotency_key: input.idempotencyKey ?? input.opId,
    evidence: [input.opId],
    reason: 'reference-sync-transport-script',
  };
}

function checksumFromRecords(records: Array<{ id: string; revision: number; deleted: boolean; archived_at: string | null }>) {
  const stable = [...records].sort((left, right) => left.id.localeCompare(right.id));
  return sha256Canonical(stable);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitForReady(baseUrl: string): Promise<void> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}${referenceSyncTransportPaths.health}`);
      if (response.ok) {
        const payload = (await response.json()) as { ok?: boolean };
        if (payload?.ok) {
          return;
        }
      }
    } catch {
      // retry
    }
    await sleep(125);
  }
  blockers.push('ready_check_timeout');
}

function spawnRelay(port: number, statePath: string): ChildProcess {
  return spawn(
    TSX_BINARY,
    ['--tsconfig', join(ROOT, 'tsconfig.json'), RELAY_SCRIPT],
    {
      cwd: ROOT,
      env: {
        ...process.env,
        PORT: String(port),
        UTOPIA_REFERENCE_SYNC_TRANSPORT_PORT: String(port),
        UTOPIA_REFERENCE_SYNC_STATE_PATH: statePath,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
}

async function runScenario(baseUrl: string): Promise<Omit<ReferenceSyncTransportEvidence, 'git'>> {
  const client = new ReferenceSyncTransportClient({ baseUrl, schemaVersion: SHARED_STATE_SYNC_SCHEMA_VERSION });

  const workspacePrimary = 'tenant-primary';
  const workspaceIsolated = 'tenant-isolated';
  const installationPrimary = 'install-primary';
  const installationIsolated = 'install-isolated';
  const deviceA = 'device-a';
  const deviceB = 'device-b';
  const deviceC = 'device-c';

  const baseRecord = makeRecord({
    id: 'shared-note',
    title: 'Shared note',
    properties: { origin: 'primary' },
    updatedAt: '2026-07-30T00:00:00.000Z',
    revision: 1,
  });

  const baseStage = await client.stage({
    workspaceId: workspacePrimary,
    installationId: installationPrimary,
    deviceId: deviceA,
    operation: makeOperation({
      opId: `${RUN_ID}-base-create`,
      kind: 'create',
      record: baseRecord,
      expectedRevision: 0,
    }),
  });

  const baseSync = await client.sync({
    workspaceId: workspacePrimary,
    installationId: installationPrimary,
    deviceId: deviceA,
  });

  const conflictRecordA = makeRecord({
    ...baseRecord,
    title: 'Primary edit A',
    updatedAt: '2026-07-30T00:00:10.000Z',
    revision: 2,
    properties: { origin: 'primary', winner: true },
  });
  const conflictRecordB = makeRecord({
    ...baseRecord,
    title: 'Primary edit B',
    updatedAt: '2026-07-30T00:00:10.000Z',
    revision: 2,
    properties: { origin: 'secondary', winner: false },
  });

  const conflictA = await client.stage({
    workspaceId: workspacePrimary,
    installationId: installationPrimary,
    deviceId: deviceA,
    operation: makeOperation({
      opId: `${RUN_ID}-conflict-a`,
      kind: 'update',
      record: conflictRecordA,
      expectedRevision: 1,
    }),
  });
  const conflictB = await client.stage({
    workspaceId: workspacePrimary,
    installationId: installationPrimary,
    deviceId: deviceB,
    operation: makeOperation({
      opId: `${RUN_ID}-conflict-b`,
      kind: 'update',
      record: conflictRecordB,
      expectedRevision: 1,
    }),
  });

  const conflictSyncA = await client.sync({
    workspaceId: workspacePrimary,
    installationId: installationPrimary,
    deviceId: deviceA,
  });
  const conflictSyncB = await client.sync({
    workspaceId: workspacePrimary,
    installationId: installationPrimary,
    deviceId: deviceB,
  });

  const rollbackRecord = makeRecord({
    id: 'rollback-note',
    title: 'Rollback note',
    properties: { origin: 'replay' },
    updatedAt: '2026-07-30T00:00:20.000Z',
    revision: 1,
  });
  const rollbackReplay = `${RUN_ID}-rollback-key`;
  const rollbackFirst = await client.stage({
    workspaceId: workspacePrimary,
    installationId: installationPrimary,
    deviceId: deviceA,
    operation: makeOperation({
      opId: `${RUN_ID}-rollback-first`,
      kind: 'create',
      record: rollbackRecord,
      expectedRevision: 0,
      idempotencyKey: rollbackReplay,
    }),
  });
  const rollbackSecond = await client.stage({
    workspaceId: workspacePrimary,
    installationId: installationPrimary,
    deviceId: deviceA,
    operation: makeOperation({
      opId: `${RUN_ID}-rollback-second`,
      kind: 'create',
      record: rollbackRecord,
      expectedRevision: 0,
      idempotencyKey: rollbackReplay,
    }),
  });

  const rollbackSync = await client.sync({
    workspaceId: workspacePrimary,
    installationId: installationPrimary,
    deviceId: deviceA,
  });

  const tombstoneRecord = makeRecord({
    id: 'tombstone-note',
    title: 'Delete me',
    properties: { origin: 'tomb' },
    updatedAt: '2026-07-30T00:00:30.000Z',
    revision: 1,
  });

  const tombstoneCreate = await client.stage({
    workspaceId: workspacePrimary,
    installationId: installationPrimary,
    deviceId: deviceA,
    operation: makeOperation({
      opId: `${RUN_ID}-tombstone-create`,
      kind: 'create',
      record: tombstoneRecord,
      expectedRevision: 0,
    }),
  });
  const tombstoneCreateSync = await client.sync({
    workspaceId: workspacePrimary,
    installationId: installationPrimary,
    deviceId: deviceA,
  });
  const tombstoneBeforeDelete = await client.snapshot({
    workspaceId: workspacePrimary,
    installationId: installationPrimary,
  });

  const tombstoneCreateRecord = tombstoneBeforeDelete.records.find((record) => record.id === tombstoneRecord.id);

  const tombstoneDelete = makeRecord({
    ...tombstoneRecord,
    updatedAt: '2026-07-30T00:00:40.000Z',
    revision: (tombstoneCreateRecord?.revision ?? 1) + 1,
    deleted: true,
    archivedAt: '2026-07-30T00:00:40.000Z',
  });

  const tombstoneDeleteStage = await client.stage({
    workspaceId: workspacePrimary,
    installationId: installationPrimary,
    deviceId: deviceA,
    operation: makeOperation({
      opId: `${RUN_ID}-tombstone-delete`,
      kind: 'delete',
      record: tombstoneDelete,
      expectedRevision: tombstoneCreateRecord?.revision ?? 1,
    }),
  });
  const tombstoneDeleteSync = await client.sync({
    workspaceId: workspacePrimary,
    installationId: installationPrimary,
    deviceId: deviceA,
  });

  const offlineRecord = makeRecord({
    id: 'offline-note',
    title: 'Offline note',
    properties: { state: 'offline' },
    updatedAt: '2026-07-30T00:00:50.000Z',
    revision: 1,
  });
  await client.stage({
    workspaceId: workspacePrimary,
    installationId: installationPrimary,
    deviceId: deviceB,
    operation: makeOperation({
      opId: `${RUN_ID}-offline-write`,
      kind: 'create',
      record: offlineRecord,
      expectedRevision: 0,
    }),
  });

  const preLoseSnapshot = await client.snapshot({
    workspaceId: workspacePrimary,
    installationId: installationPrimary,
  });
  const preLoseDeviceB = preLoseSnapshot.devices.find((item) => item.deviceId === deviceB);
  const offlineBuffered = preLoseDeviceB?.pending === 1;

  const reconnectSync = await client.sync({
    workspaceId: workspacePrimary,
    installationId: installationPrimary,
    deviceId: deviceB,
  });
  const reconnectedSnapshot = await client.snapshot({
    workspaceId: workspacePrimary,
    installationId: installationPrimary,
  });

  await client.loseDevice({
    workspaceId: workspacePrimary,
    installationId: installationPrimary,
    deviceId: deviceB,
  });

  const recovery = await client.recoverDevice({
    workspaceId: workspacePrimary,
    installationId: installationPrimary,
    deviceId: deviceB,
  });
  const postLoseSnapshot = recovery.snapshot;
  const reconnectRecovered =
    reconnectSync.status === 'synced'
    && reconnectedSnapshot.records.some((record) => record.id === offlineRecord.id)
    && postLoseSnapshot.records.some((record) => record.id === offlineRecord.id);

  const isolationRecord = makeRecord({
    id: 'isolated-note',
    title: 'Tenant isolated',
    properties: { origin: 'isolated' },
    updatedAt: '2026-07-30T00:01:00.000Z',
    revision: 1,
  });
  await client.stage({
    workspaceId: workspaceIsolated,
    installationId: installationIsolated,
    deviceId: deviceC,
    operation: makeOperation({
      opId: `${RUN_ID}-isolation-create`,
      kind: 'create',
      record: isolationRecord,
      expectedRevision: 0,
    }),
  });
  await client.sync({
    workspaceId: workspaceIsolated,
    installationId: installationIsolated,
    deviceId: deviceC,
  });

  const isolatedSnapshot = await client.snapshot({
    workspaceId: workspaceIsolated,
    installationId: installationIsolated,
  });
  const primaryForIsolation = await client.snapshot({
    workspaceId: workspacePrimary,
    installationId: installationPrimary,
  });

  const finalDeviceASync = await client.sync({
    workspaceId: workspacePrimary,
    installationId: installationPrimary,
    deviceId: deviceA,
  });
  const finalDeviceBSync = await client.sync({
    workspaceId: workspacePrimary,
    installationId: installationPrimary,
    deviceId: deviceB,
  });

  const finalSnapshotA = await client.snapshot({
    workspaceId: workspacePrimary,
    installationId: installationPrimary,
  });
  const finalSnapshotB = await client.snapshot({
    workspaceId: workspacePrimary,
    installationId: installationPrimary,
  });

  const conflictDetected = conflictSyncA.conflicts >= 1 || conflictSyncB.conflicts >= 1;
  const rollbackReplayDetected = rollbackSecond.status === 'duplicate' || rollbackSync.duplicates >= 1;
  const tombstoneApplied = finalSnapshotA.records.some((record) => record.id === tombstoneRecord.id && record.deleted);
  const cursorConverged =
    finalSnapshotA.cursor === finalSnapshotB.cursor
    && finalDeviceASync.cursor === finalSnapshotA.cursor
    && finalDeviceBSync.cursor === finalSnapshotB.cursor;
  const tenantIsolated =
    !primaryForIsolation.records.some((record) => record.id === isolationRecord.id)
    && isolatedSnapshot.records.some((record) => record.id === isolationRecord.id);

  assert(baseStage.status === 'applied', 'base write not staged');
  assert(baseSync.status === 'synced' && baseSync.applied === 1, 'base write not applied');
  assert(conflictA.status === 'applied', 'primary conflict op was not staged');
  assert(conflictB.status === 'applied', 'secondary conflict op was not staged');
  assert(conflictDetected, 'conflict was not detected');
  assert(rollbackFirst.status === 'applied', 'rollback first op not staged');
  assert(rollbackSecond.status === 'duplicate' || rollbackSync.duplicates >= 1, 'rollback replay was not detected as duplicate');
  assert(tombstoneCreate.status === 'applied', 'tombstone create not staged');
  assert(tombstoneCreateSync.status === 'synced' && tombstoneCreateSync.applied === 1, 'tombstone create not synced');
  assert(tombstoneDeleteStage.status === 'applied', 'tombstone delete not staged');
  assert(tombstoneDeleteSync.status === 'synced', 'tombstone delete sync did not execute');
  assert(offlineBuffered, 'offline write not buffered');
  assert(reconnectRecovered, 'reconnected offline write was not retained through device recovery');
  assert(postLoseSnapshot.cursor === finalSnapshotA.cursor, 'recovered cursor diverged from final');
  assert(cursorConverged, 'cursor convergence failed');
  assert(tenantIsolated, 'tenant isolation failed');

  return {
    proof: 'reference_sync_transport_live',
    schemaVersion: SHARED_STATE_SYNC_SCHEMA_VERSION,
    run_id: RUN_ID,
    status: blockers.length ? 'BLOCKED' : 'PASS',
    checked_at: new Date().toISOString(),
    blockers,
    distinct_client_ids: [deviceA, deviceB, deviceC],
    installation_ids: [installationPrimary, installationIsolated],
    workspace_ids: [workspacePrimary, workspaceIsolated],
    final_state_checksum: checksumFromRecords(
      finalSnapshotA.records.map((record) => ({
        id: record.id,
        revision: record.revision,
        deleted: record.deleted,
        archived_at: record.archived_at,
      })),
    ),
    final_state_cursor: finalSnapshotA.cursor,
    scenario: {
      conflict_detected: conflictDetected,
      offline_write_buffered: offlineBuffered,
      rollback_replay: rollbackReplayDetected,
      tombstone_applied: tombstoneApplied,
      cursor_converged: cursorConverged,
      reconnect_recovered: reconnectRecovered,
      tenant_isolated: tenantIsolated,
    },
  };
}

async function run(): Promise<void> {
  const tempRoot = mkdtempSync(join(tmpdir(), 'utopia-reference-sync-transport-'));
  const statePath = join(tempRoot, 'reference-sync-transport-state.json');
  const baseUrl = `http://127.0.0.1:${PORT}`;
  const relay = spawnRelay(PORT, statePath);
  const git = currentGit(ROOT);

  const cleanup = (): void => {
    if (!relay.killed) {
      relay.kill('SIGTERM');
    }
    rmSync(tempRoot, { recursive: true, force: true });
  };

  relay.on('exit', (code) => {
    if (code && code !== 0) {
      blockers.push(`relay_exit_${String(code)}`);
    }
  });

  try {
    await waitForReady(baseUrl);
    const partial = await runScenario(baseUrl);

    const proof: ReferenceSyncTransportEvidence = {
      ...partial,
      git,
      status: blockers.length ? 'BLOCKED' : 'PASS',
    };

    mkdirSync(dirname(EVIDENCE_PATH), { recursive: true });
    writeFileSync(EVIDENCE_PATH, `${JSON.stringify(proof, null, 2)}\n`, 'utf8');

    if (proof.status !== 'PASS') {
      process.exitCode = 1;
      console.log(`BLOCKED ${EVIDENCE_PATH}`);
      return;
    }

    console.log(`PASS ${EVIDENCE_PATH}`);
  } catch (error) {
    blockers.push(error instanceof Error ? error.message : String(error));
    const proof: ReferenceSyncTransportEvidence = {
      proof: 'reference_sync_transport_live',
      schemaVersion: SHARED_STATE_SYNC_SCHEMA_VERSION,
      run_id: RUN_ID,
      status: 'BLOCKED',
      checked_at: new Date().toISOString(),
      blockers,
      git,
      distinct_client_ids: [],
      installation_ids: [],
      workspace_ids: [],
      final_state_checksum: createHash('sha256').update(RUN_ID).digest('hex'),
      final_state_cursor: '0',
      scenario: {
        conflict_detected: false,
        offline_write_buffered: false,
        rollback_replay: false,
        tombstone_applied: false,
        cursor_converged: false,
        reconnect_recovered: false,
        tenant_isolated: false,
      },
    };

    mkdirSync(dirname(EVIDENCE_PATH), { recursive: true });
    writeFileSync(EVIDENCE_PATH, `${JSON.stringify(proof, null, 2)}\n`, 'utf8');
    process.exitCode = 1;
    console.log(`BLOCKED ${EVIDENCE_PATH}`);
  } finally {
    cleanup();
  }
}

void run();
