#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import { currentGit } from '../evidence-provenance.mjs';
import {
  buildGoldenLoopDebugUrl,
  buildSharedHouseholdBoardDebugCommands,
  requireGoldenLoopDebugToken,
} from '../golden-loop/debug-bridge-commands.mjs';
import { SHELL_PROOF_SCHEMA_VERSION } from '../golden-loop/shell-proof-protocol.mjs';

function parseArgs(argv) {
  const out = {};
  for (let index = 0; index < argv.length; index += 1) {
    const raw = argv[index];
    if (!raw.startsWith('--')) continue;
    const key = raw.slice(2);
    const value = argv[index + 1];
    out[key] = value && !value.startsWith('--') ? value : '';
    if (value && !value.startsWith('--')) index += 1;
  }
  return out;
}

function sha256(value) {
  return `sha256:${createHash('sha256').update(String(value ?? '')).digest('hex')}`;
}

function writeJson(path, payload) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

const args = parseArgs(process.argv.slice(2));
const receiptPath = resolve(args['receipt-path'] || 'app/build/evidence/golden-loop/macos-debug-bridge-receipt.json');
const observationsPath = resolve(args['raw-observations-path'] || 'app/build/evidence/golden-loop/macos-debug-bridge-observations.jsonl');
const dispatchObservationsPath = resolve(args['dispatch-observations-path'] || `${observationsPath}.dispatch.jsonl`);
const requestedAppPath = String(args.app || '').trim();
const appPath = requestedAppPath ? resolve(requestedAppPath) : null;
const appArtifactChecksum = args['app-artifact-checksum'] || null;
const token = requireGoldenLoopDebugToken();
const runId = args['run-id'] || process.env.UTOPIA_GOLDEN_LOOP_RUN_ID || `macos-golden-loop-${Date.now()}`;
const correlationId = `macos-${runId}-${Date.now()}`;
const { commands, artifacts } = buildSharedHouseholdBoardDebugCommands({
  token,
  installationId: `${runId}-installation`,
});

const commandPayloads = commands.map((command) => ({
  ...command,
  arguments: {
    ...(command.arguments || {}),
    golden_loop_run_id: runId,
    golden_loop_correlation_id: correlationId,
    golden_loop_receipt_path: receiptPath,
    golden_loop_observations_path: observationsPath,
    app_artifact_checksum: appArtifactChecksum,
    package_checksum_v1: artifacts.v1.checksum,
    package_checksum_v2: artifacts.v2.checksum,
    package_version_v1: artifacts.version.v1,
    package_version_v2: artifacts.version.v2,
    git: currentGit(process.cwd()),
  },
}));

function writeBlockedDiagnostic(blockers, dispatchObservations = []) {
  if (!existsSync(observationsPath)) {
    writeFileSync(observationsPath, `${JSON.stringify({
      status: 'BLOCKED',
      observer_kind: 'driver',
      source: 'macos-debug-bridge-dispatch',
      correlation_id: correlationId,
      blockers: [...new Set(blockers)],
    })}\n`, 'utf8');
  }
  writeJson(receiptPath, {
    proof: 'utopia_macos_debug_bridge_dispatch',
    schema_version: SHELL_PROOF_SCHEMA_VERSION,
    status: 'BLOCKED',
    checked_at: new Date().toISOString(),
    run_id: runId,
    source: {
      surface: 'macos',
      app_artifact_checksum: appArtifactChecksum,
      bridge_correlation_id: correlationId,
    },
    dispatch_observations: dispatchObservations,
    blockers: [...new Set(blockers)],
    status_reason: 'The native app did not emit a runtime receipt and observation stream.',
  });
}

function parseJsonLines(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try { return JSON.parse(line); } catch { return null; }
    })
    .filter(Boolean);
}

function waitForRuntimeEvidence(timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(receiptPath) && existsSync(observationsPath)) {
      try {
        const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
        const observations = parseJsonLines(observationsPath);
        if (receipt && observations.length >= commandPayloads.length) return { receipt, observations };
      } catch {
        // Keep polling while the app is writing its evidence files.
      }
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
  }
  return null;
}

function validateRuntimeEvidence(evidence) {
  const blockers = [];
  const expectedOperationIds = new Set(commandPayloads.map((command) => command.operation_id));
  const observedOperationIds = new Set();

  for (const observation of evidence?.observations || []) {
    if (typeof observation.operation_id !== 'string' || !observation.operation_id) {
      blockers.push('missing_runtime_observation_operation_id');
      continue;
    }
    if (!expectedOperationIds.has(observation.operation_id)) {
      blockers.push(`unexpected_runtime_observation_operation_id:${observation.operation_id}`);
    }
    if (!['applied', 'observed', 'executed'].includes(observation.status)) {
      blockers.push(`runtime_observation_not_applied:${observation.operation_id}`);
    }
    observedOperationIds.add(observation.operation_id);
  }

  for (const operationId of expectedOperationIds) {
    if (!observedOperationIds.has(operationId)) {
      blockers.push(`missing_runtime_observation:${operationId}`);
    }
  }

  const receiptSource = evidence?.receipt?.source || {};
  if (evidence?.receipt?.status !== 'PASS' && evidence?.receipt?.status !== 'passed') {
    blockers.push(`runtime_receipt_not_passed:${String(evidence?.receipt?.status || 'missing')}`);
  }
  if (receiptSource.bridge_correlation_id !== correlationId) {
    blockers.push('runtime_receipt_correlation_mismatch');
  }
  if (receiptSource.app_artifact_checksum !== appArtifactChecksum) {
    blockers.push('runtime_receipt_app_artifact_checksum_mismatch');
  }
  return blockers;
}

if (!appPath || !existsSync(appPath) || !statSync(appPath).isDirectory()) {
  const blockers = ['missing_native_macos_app_bundle'];
  writeBlockedDiagnostic(blockers);
  console.error(blockers[0]);
  process.exit(1);
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

const dispatchObservations = [];
let blocked = null;
rmSync(receiptPath, { force: true });
rmSync(observationsPath, { force: true });
rmSync(dispatchObservationsPath, { force: true });
rmSync(`${observationsPath}.artifact.json`, { force: true });
spawnSync('pkill', ['-x', 'UtopiaMac'], { stdio: 'ignore' });
const launch = spawnSync('open', [appPath], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
  timeout: 10_000,
});
dispatchObservations.push({
  command: 'launch',
  operation_id: 'macos-warmup-launch',
  deep_link_hash: null,
  app_path: appPath,
  exit_code: launch.status,
  stdout_hash: sha256(launch.stdout || ''),
  stderr_hash: sha256(launch.stderr || ''),
});
if (launch.status !== 0) {
  blocked = 'macos_debug_bridge_launch_failed';
} else {
  sleep(Number(args['warmup-ms'] || 8_000));
}
for (const command of commandPayloads) {
  if (blocked) break;
  const url = buildGoldenLoopDebugUrl(command);
  const result = spawnSync('open', ['-a', appPath, url], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 10_000,
  });
  dispatchObservations.push({
    command: command.command,
    operation_id: command.operation_id,
    deep_link_hash: sha256(url),
    app_path: appPath,
    exit_code: result.status,
    stdout_hash: sha256(result.stdout || ''),
    stderr_hash: sha256(result.stderr || ''),
  });
  if (result.status !== 0) {
    blocked = `macos_debug_bridge_open_failed:${command.command}`;
    break;
  }
}

writeFileSync(dispatchObservationsPath, dispatchObservations.map((entry) => JSON.stringify(entry)).join('\n') + '\n', 'utf8');

if (blocked) {
  writeBlockedDiagnostic([blocked], dispatchObservations);
  console.error(blocked);
  process.exit(1);
}

const runtimeEvidence = waitForRuntimeEvidence(Number(args['wait-ms'] || 30_000));
if (!runtimeEvidence) {
  writeBlockedDiagnostic(['missing_native_runtime_receipt', 'missing_native_runtime_observations'], dispatchObservations);
  console.error('missing_native_runtime_receipt');
  process.exit(1);
}

const runtimeBlockers = validateRuntimeEvidence(runtimeEvidence);
if (runtimeBlockers.length > 0) {
  console.error(`runtime_evidence_blocked:${runtimeBlockers.join('|')}`);
  process.exit(1);
}

console.log(`PASS ${receiptPath}`);
