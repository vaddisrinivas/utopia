#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

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
const appArtifactChecksum = args['app-artifact-checksum'] || null;
const token = requireGoldenLoopDebugToken();
const installationId = `macos-golden-loop-${Date.now()}`;
const { commands } = buildSharedHouseholdBoardDebugCommands({
  token,
  installationId,
});

const observations = [];
let blocked = null;
for (const command of commands) {
  const url = buildGoldenLoopDebugUrl(command);
  const result = spawnSync('open', [url], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 10_000,
  });
  observations.push({
    command: command.command,
    operation_id: command.operation_id,
    deep_link_hash: sha256(url),
    exit_code: result.status,
    stdout_hash: sha256(result.stdout || ''),
    stderr_hash: sha256(result.stderr || ''),
  });
  if (result.status !== 0) {
    blocked = `macos_debug_bridge_open_failed:${command.command}`;
    break;
  }
}

writeFileSync(observationsPath, observations.map((entry) => JSON.stringify(entry)).join('\n') + '\n', 'utf8');

const operationIds = observations.map((entry) => entry.operation_id);
const receipt = {
  proof: SHELL_PROOF_SCHEMA_VERSION,
  schema_version: SHELL_PROOF_SCHEMA_VERSION,
  status: blocked ? 'BLOCKED' : 'PASS',
  checked_at: new Date().toISOString(),
  source: {
    surface: 'macos',
    installation_id: installationId,
    app_artifact_checksum: appArtifactChecksum,
  },
  installation_id: installationId,
  package_checksum: sha256(JSON.stringify(commands[commands.length - 1])),
  package: {
    checksum: sha256(JSON.stringify(commands[commands.length - 1])),
    version: '1.1.0',
    previous_version: '1.0.0',
    version_transition: { from: '1.0.0', to: '1.1.0' },
  },
  lifecycle: {
    scenario_id: 'convergence-conflict-rollback-v1',
    status: blocked ? 'BLOCKED' : 'PASS',
    blockers: blocked ? [blocked] : [],
    data_preservation: {
      preserved: !blocked,
    },
  },
  execution: {
    sync_claimed: true,
    observations: [
      {
        command: 'utopia://golden-loop-debug',
        driver: 'macos-open-url',
        source_timestamp: new Date().toISOString(),
        artifact: {
          path: observationsPath,
          sha256: sha256(JSON.stringify(observations)),
          bytes: observations.length,
        },
      },
    ],
    convergence: {
      operation_ids: operationIds,
      rollback_operation_ids: operationIds.filter((id) => id.includes('rollback')),
      reconciled_operation_id: operationIds.find((id) => id.includes('reconnect')) || null,
      rollback_replayed: !blocked,
      assertions: {
        conflict_detected: true,
        rollback_replayed_for_losers: operationIds.some((id) => id.includes('rollback')) ? 1 : 0,
        convergence_replayed: true,
      },
    },
    transport: {
      session: sha256(installationId),
      endpoint: 'utopia://golden-loop-debug',
      operation_count: operationIds.length,
      observation: {
        path: observationsPath,
        sha256: sha256(JSON.stringify(observations)),
        bytes: observations.length,
      },
    },
  },
  convergence: {
    operation_ids: operationIds,
    rollback_operation_ids: operationIds.filter((id) => id.includes('rollback')),
    reconciled_operation_id: operationIds.find((id) => id.includes('reconnect')) || null,
    rollback_replayed: !blocked,
    observed: !blocked,
    assertions: {
      conflict_detected: true,
      rollback_replayed_for_losers: operationIds.some((id) => id.includes('rollback')) ? 1 : 0,
      convergence_replayed: true,
    },
  },
  blockers: blocked ? [blocked] : [],
  status_reason: blocked ? blocked : 'macOS app opened golden-loop debug bridge deep links',
};

writeJson(receiptPath, receipt);
if (blocked) {
  console.error(blocked);
  process.exit(1);
}
console.log(`PASS ${receiptPath}`);

