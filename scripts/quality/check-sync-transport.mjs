import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

const ROOT = process.cwd();
const DEFAULT_SYNC_PROOF_PATH = join(ROOT, 'app', 'build', 'evidence', 'shared-state-sync-proof.json');
const DEFAULT_OUTPUT_PATH = join(ROOT, 'app', 'build', 'evidence', 'sync-transport-evaluation.json');
const SCHEMA_VERSION = 'utopia.sync-transport.v1';

const proofPath = process.env.UTOPIA_SHARED_STATE_SYNC_PROOF_PATH || DEFAULT_SYNC_PROOF_PATH;
const outputPath = process.env.UTOPIA_SYNC_TRANSPORT_EVIDENCE_PATH || DEFAULT_OUTPUT_PATH;

const SHARED_STATE_LOCAL_EXPECTATIONS = {
  proof: 'vendor-neutral-shared-state-sync',
  localDeterministicStatus: 'PASS',
  liveProviderDeviceStatus: 'BLOCKED',
  requiredNextProof: 'real installations/devices',
};

const POWER_SYNC_MATRIX = {
  append_operations: { status: 'supported', mapping: 'Append-only local mutation batches map to upload operations with idempotent operation ids.' },
  tombstones: { status: 'shim-required', mapping: 'Delete semantics need app-owned retention and delete-wins policy.' },
  cursor_checkpoint: { status: 'shim-required', mapping: 'Cursor checkpoints are available but need app-owned translation for per-device continuity.' },
  conflict_manual_review: { status: 'shim-required', mapping: 'Conflict records must be surfaced to app review before replay.' },
  offline_replay: { status: 'supported', mapping: 'Replay through cursor recovery after reconnect is supported by local queue behavior.' },
  per_installation: { status: 'shim-required', mapping: 'Workspace/device identity requires app-owned boundary filters.' },
};

function readSyncProof() {
  if (!existsSync(proofPath)) {
    throw new Error(`shared-state sync proof missing: ${proofPath}`);
  }

  const raw = readFileSync(proofPath, 'utf8');
  const parsed = JSON.parse(raw);
  const claims = parsed?.live_multi_device_sync_claims ?? parsed?.syncReadiness?.liveMultiDeviceSyncBoundary;
  if (!claims) {
    throw new Error('shared-state proof missing live_multi_device_sync_claims');
  }

  const local = claims.readiness?.local_deterministic ?? claims.localDeterministicStatus;
  const liveProvider = claims.readiness?.live_provider_device ?? claims.liveProviderDeviceStatus;
  if (local !== SHARED_STATE_LOCAL_EXPECTATIONS.localDeterministicStatus) {
    throw new Error(`shared-state local_deterministic expected ${SHARED_STATE_LOCAL_EXPECTATIONS.localDeterministicStatus}, got ${String(local)}`);
  }
  if (liveProvider !== SHARED_STATE_LOCAL_EXPECTATIONS.liveProviderDeviceStatus) {
    throw new Error(`shared-state live_provider_device expected ${SHARED_STATE_LOCAL_EXPECTATIONS.liveProviderDeviceStatus}, got ${String(liveProvider)}`);
  }

  return claims;
}

function buildSyncPort(claims) {
  return {
    schemaVersion: SCHEMA_VERSION,
    transport: {
      kind: 'vendor-neutral-operation-stream',
      requiredCaps: ['append_operations', 'per_installation', 'cursor_checkpoint', 'offline_replay'],
      optionalCaps: ['tombstones', 'conflict_manual_review'],
    },
    readiness: {
      localDeterministic: { status: 'PASS' },
      liveProviderDevice: {
        status: 'BLOCKED',
        requiredNextProof: claims?.required_next_proof ?? claims?.requiredNextProof ?? SHARED_STATE_LOCAL_EXPECTATIONS.requiredNextProof,
      },
    },
    status: claims?.status === 'BLOCKED' ? 'BLOCKED' : 'SUPPORTED',
    reason: claims?.reason
      ?? 'Real multi-device provider proof requires real installations/devices.',
  };
}

function buildPowerSyncEvaluation(syncPort) {
  const supported = [];
  const shimRequired = [];
  const blocked = [];
  const notes = [];

  for (const [cap, info] of Object.entries(POWER_SYNC_MATRIX)) {
    if (info.status === 'supported') supported.push(cap);
    if (info.status === 'shim-required') shimRequired.push(cap);
    if (info.status === 'blocked') blocked.push(cap);
    notes.push(`${cap}: ${info.mapping}`);
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    vendor: 'powersync',
    evidenceKind: 'documentation_assessment',
    syncPortStatus: syncPort.status === 'BLOCKED' ? 'BLOCKED' : (blocked.length ? 'BLOCKED' : 'SUPPORTED'),
    syncPort,
    supported,
    shimRequired,
    blocked,
    notes,
  };
}

function main() {
  const claims = readSyncProof();
  const syncPort = buildSyncPort(claims);
  const powersync = buildPowerSyncEvaluation(syncPort);

  const evidence = {
    proof: 'vendor_neutral_sync_transport',
    schemaVersion: SCHEMA_VERSION,
    status: syncPort.status,
    syncPort,
    vendors: [powersync],
  };

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`);

  console.log(`PASS sync transport evaluation (${SCHEMA_VERSION}); evidence=${relative(ROOT, outputPath)}`);
  console.log('SYNC_TRANSPORT_READINESS=local deterministic local_passed=true live_multi_device_status=BLOCKED');
}

try {
  main();
} catch (error) {
  console.error(`FAIL ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
