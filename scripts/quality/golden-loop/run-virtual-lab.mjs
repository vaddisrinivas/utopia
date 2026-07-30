#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { currentGit } from '../evidence-provenance.mjs';
import {
  buildDebugAutomationCommand,
  generateDebugAutomationToken,
  redactDebugAutomationCommand,
  validateDebugAutomationCommand,
} from './debug-automation-protocol.mjs';
import { SHELL_PROOF_SCHEMA_VERSION, validateShellProofReceipt } from './shell-proof-protocol.mjs';

const root = process.cwd();
const outDir = join(root, 'app', 'build', 'evidence', 'golden-loop', 'virtual-lab');
const outPath = process.env.UTOPIA_GOLDEN_LOOP_VIRTUAL_LAB_PATH
  || join(outDir, 'virtual-lab-proof.json');
const fixturePath = join(root, 'tests', 'fixtures', 'golden-loop', 'shared-household-board.source.json');

export const VIRTUAL_LAB_PROOF_ID = 'utopia_golden_loop_virtual_lab';
export const VIRTUAL_LAB_SCENARIO_ID = 'convergence-conflict-rollback-v1';
export const VIRTUAL_LAB_OPERATION_IDS = [
  'virtual-install',
  'virtual-write-a',
  'virtual-write-b',
  'virtual-update',
  'virtual-rollback',
  'virtual-restore',
];

export const VIRTUAL_LAB_COMMANDS = [
  'package.install',
  'transport.disconnect',
  'record.write',
  'record.write',
  'transport.reconnect',
  'package.update',
  'package.rollback',
  'backup.export',
  'installation.reset',
  'backup.restore',
  'capability.grant',
  'capability.revoke',
  'state.checksum',
];

const surfaces = [
  { surface: 'android', label: 'android_a', installationId: 'virtual-android-install-a' },
  { surface: 'android', label: 'android_b', installationId: 'virtual-android-install-b' },
  { surface: 'web', label: 'web', installationId: 'virtual-web-install' },
  { surface: 'macos', label: 'macos', installationId: 'virtual-macos-install' },
];

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function writeJson(path, body) {
  const text = `${JSON.stringify(body, null, 2)}\n`;
  writeFileSync(path, text, 'utf8');
  const stat = statSync(path);
  return {
    path,
    sha256: `sha256:${sha256(text)}`,
    bytes: stat.size,
  };
}

function packageChecksum() {
  if (!existsSync(fixturePath)) return `sha256:${'0'.repeat(64)}`;
  return `sha256:${sha256(readFileSync(fixturePath, 'utf8'))}`;
}

function makeObservation(surface, label, checkedAt) {
  return {
    source_timestamp: checkedAt,
    surface,
    label,
    operations: VIRTUAL_LAB_OPERATION_IDS.map((opId) => ({
      op_id: opId,
      type: opId.replace(/^virtual-/, ''),
      status: opId === 'virtual-rollback' ? 'replayed' : 'applied',
      timestamp: checkedAt,
    })),
  };
}

function buildCommandFixture(surface, checkedAt, checksum, token) {
  const installId = surface.installationId;
  const commandArgs = {
    'package.install': {
      package_id: 'shared-household-board',
      package_version: '1.0.0',
      package_checksum: checksum,
    },
    'record.write': {
      collection: 'tasks',
      record_id: `${surface.label}-task`,
      field_values_hash: `sha256:${sha256(`${surface.label}:record.write:${checkedAt}`)}`,
    },
    'package.update': {
      package_id: 'shared-household-board',
      package_version: '1.1.0',
      package_checksum: checksum,
    },
    'backup.restore': {
      backup_id: `${surface.label}-backup`,
    },
    'capability.grant': {
      capability: 'notifications.schedule',
    },
    'capability.revoke': {
      capability: 'notifications.schedule',
    },
    'transport.disconnect': {
      transport_endpoint: 'localhost',
    },
    'transport.reconnect': {
      transport_endpoint: 'localhost',
      transport_session: 'virtual-reference-sync-session',
    },
    'state.checksum': {
      expected_checksum: `sha256:${sha256(`${surface.label}:state.checksum`)}`,
    },
  };

  return VIRTUAL_LAB_COMMANDS.map((command, index) => buildDebugAutomationCommand({
    command,
    installationId: installId,
    operationId: `${surface.label}-${String(index + 1).padStart(2, '0')}-${command.replace('.', '-')}`,
    authorizationToken: token,
    args: commandArgs[command] || {},
  }));
}

function validateCommandFixture(commands, token) {
  const blockers = [];
  const redacted = [];
  for (const command of commands) {
    const result = validateDebugAutomationCommand(command, { expectedToken: token });
    if (!result.pass) blockers.push(...result.blockers.map((blocker) => `${command.operation_id}:${blocker}`));
    redacted.push(redactDebugAutomationCommand(command));
  }
  return { pass: blockers.length === 0, blockers, redacted };
}

function makeConvergence(checkedAt) {
  return {
    checked_at: checkedAt,
    endpoint: 'localhost://reference-sync-transport/virtual',
    session: 'virtual-reference-sync-session',
    operation_ids: VIRTUAL_LAB_OPERATION_IDS,
  };
}

function makeReceipt({ surface, label, installationId }, checkedAt, checksum, observation, convergence, synthetic = true) {
  return {
    proof: 'utopia_virtual_surface_execution_receipt',
    schema_version: SHELL_PROOF_SCHEMA_VERSION,
    checked_at: checkedAt,
    status: 'passed',
    git: currentGit(root),
    source: {
      surface,
      installation_id: installationId,
    },
    package: {
      checksum,
      version: '1.1.0',
      previous_version: '1.0.0',
      version_transition: {
        from: '1.0.0',
        to: '1.1.0',
      },
    },
    execution: {
      installation_id: installationId,
      durable_data_checksum: `sha256:${sha256(`virtual-durable:${label}`)}`,
      sync_claimed: true,
      transport: {
        endpoint: 'localhost://reference-sync-transport/virtual',
        session: 'virtual-reference-sync-session',
        operation_count: VIRTUAL_LAB_OPERATION_IDS.length,
      },
      observations: [
        {
          observer_kind: 'virtual-shell-driver',
          command: 'npm run proof:golden-loop:virtual',
          driver: label,
          source_timestamp: checkedAt,
          artifact: observation,
        },
      ],
    },
    convergence: {
      operation_ids: VIRTUAL_LAB_OPERATION_IDS,
      rollback_operation_ids: ['virtual-rollback'],
      reconciled_operation_id: 'virtual-write-b',
      rollback_replayed: true,
      transport_session: 'virtual-reference-sync-session',
      transport_observation: convergence,
    },
    lifecycle: {
      scenario: {
        scenario_id: VIRTUAL_LAB_SCENARIO_ID,
        assertions: {
          conflict_detected: true,
          rollback_replayed_for_losers: 1,
          convergence_replayed: true,
        },
      },
    },
    virtual_only: true,
    synthetic_plan_is_not_device_proof: synthetic,
  };
}

function validateVirtualStructure(receipt, receiptPath, surface) {
  const strictCandidate = {
    ...receipt,
    synthetic_plan_is_not_device_proof: false,
  };
  const result = validateShellProofReceipt(strictCandidate, {
    root,
    label: receipt.source?.surface || surface,
    path: receiptPath,
    requiredSourceSurface: surface,
  });
  return {
    pass: result.pass,
    blockers: result.blockers,
    operation_ids: result.operation_ids,
    source_surface: result.source_surface,
    installation_id: result.installation_id,
  };
}

function runCleanSnapshotCandidate() {
  const result = spawnSync(process.execPath, ['scripts/quality/golden-loop/run-clean-snapshot-candidate.mjs'], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      UTOPIA_CLEAN_SNAPSHOT_CANDIDATE_PATH: join(outDir, 'clean-snapshot-candidate.json'),
    },
    timeout: 60_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  return {
    status: result.status === 0 ? 'CANDIDATE_PASS' : 'FAIL',
    exit_code: result.status ?? 1,
    stdout_tail: String(result.stdout ?? '').slice(-2000),
    stderr_tail: String(result.stderr ?? '').slice(-2000),
    timed_out: result.error?.code === 'ETIMEDOUT',
    evidence_path: join(outDir, 'clean-snapshot-candidate.json'),
    output,
  };
}

function main() {
  mkdirSync(outDir, { recursive: true });

  const checkedAt = new Date().toISOString();
  const checksum = packageChecksum();
  const token = generateDebugAutomationToken();
  const blockers = [];
  const surfaceReceipts = [];
  const commandArtifacts = [];
  const cleanSnapshot = runCleanSnapshotCandidate();
  if (cleanSnapshot.status !== 'CANDIDATE_PASS') blockers.push('clean_snapshot_candidate_failed');

  for (const surface of surfaces) {
    const commands = buildCommandFixture(surface, checkedAt, checksum, token);
    const commandValidation = validateCommandFixture(commands, token);
    if (!commandValidation.pass) blockers.push(...commandValidation.blockers.map((blocker) => `${surface.label}:${blocker}`));
    const commandArtifact = writeJson(
      join(outDir, `${surface.label}-commands.json`),
      {
        checked_at: checkedAt,
        surface: surface.surface,
        label: surface.label,
        commands: commandValidation.redacted,
      },
    );
    commandArtifacts.push({
      label: surface.label,
      artifact: commandArtifact,
      command_count: commands.length,
    });
    const observation = writeJson(
      join(outDir, `${surface.label}-observation.json`),
      makeObservation(surface.surface, surface.label, checkedAt),
    );
    const convergence = writeJson(
      join(outDir, `${surface.label}-convergence.json`),
      makeConvergence(checkedAt),
    );
    const receiptPath = join(outDir, `${surface.label}-virtual-receipt.json`);
    const receipt = makeReceipt(surface, checkedAt, checksum, observation, convergence, true);
    writeJson(receiptPath, receipt);
    const structure = validateVirtualStructure(receipt, receiptPath, surface.surface);
    if (!structure.pass) blockers.push(...structure.blockers.map((blocker) => `${surface.label}:${blocker}`));
    surfaceReceipts.push({
      label: surface.label,
      source_surface: surface.surface,
      installation_id: surface.installationId,
      receipt_path: receiptPath,
      structure,
      eligible_as_real_surface_receipt: false,
      reason_not_real: 'virtual_only_synthetic_plan_is_not_device_proof',
      command_artifact: commandArtifact,
      command_count: commands.length,
    });
  }

  const status = blockers.length === 0 ? 'PASS' : 'FAIL';
  const evidence = {
    proof: VIRTUAL_LAB_PROOF_ID,
    checked_at: checkedAt,
    status,
    git: currentGit(root),
    blockers,
    app: {
      id: 'shared-household-board',
      fixture: 'tests/fixtures/golden-loop/shared-household-board.source.json',
      package_checksum: checksum,
    },
    categories: {
      core: status,
      web: status,
      android_a: status,
      android_b: status,
      macos: status,
      network_sync: status,
      update_rollback: status,
      recovery: status,
      creator_automation: 'NOT_MEASURED',
      clean_snapshot: cleanSnapshot.status,
      human_usability: 'NOT_MEASURED',
      physical_device: 'NOT_REQUIRED',
      real_multi_surface_receipts: 'NOT_PROVEN',
    },
    clean_snapshot: {
      status: cleanSnapshot.status,
      evidence_path: cleanSnapshot.evidence_path,
      touches_main_index: false,
      final_reproducibility_requires_reachable_commit: true,
    },
    debug_automation_contract: {
      mode: 'goldenLoopDebug',
      token_policy: 'random_per_run_redacted_from_receipts',
      ingress_policy: 'loopback_or_adb_only',
      arbitrary_files_urls_sql_or_code: false,
      commands: VIRTUAL_LAB_COMMANDS,
      command_artifacts: commandArtifacts,
    },
    surfaces: surfaceReceipts,
    can_replace_real_device_or_human_evidence: false,
    next_real_gates: [
      'real_web_shell_receipt',
      'real_macos_shell_receipt',
      'real_android_x2_receipts',
      'clean_checkout_from_committed_tree',
      'unaided_creator_receipt',
    ],
  };

  writeFileSync(outPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  console.log(`GOLDEN_LOOP_VIRTUAL_LAB=${status} evidence=${outPath}`);
  if (blockers.length) console.log(`BLOCKERS=${blockers.join(',')}`);
  process.exitCode = status === 'PASS' ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}`) main();
