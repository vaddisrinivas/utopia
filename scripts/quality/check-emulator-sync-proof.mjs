#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

import { currentGit } from './evidence-provenance.mjs';
import {
  DEFAULT_EMULATOR_IDENTITIES,
  DEFAULT_PROOF_AVD_COUNT,
  EMULATOR_SYNC_PROOF_SCHEMA_VERSION,
  buildInstallProfiles,
  buildNetworkPartitionCommands,
  buildSyncScenario,
  evaluatePrerequisites,
  evaluateSyncScenario,
  normalizeAvdIdentities,
  parseAdbDevices,
  requiredAvdCount,
} from './emulator-sync/emulator-sync-plan.mjs';

const root = process.cwd();
const outRoot = join(root, 'app', 'build', 'evidence', 'emulator-sync');
const evidencePath = join(
  outRoot,
  process.env.UTOPIA_EMULATOR_SYNC_PROOF_PATH
  ?? `emulator-sync-proof-${new Date().toISOString().replace(/[.:]/g, '-')}.json`,
);

function runAdbCommand(args) {
  return spawnSync('adb', args, {
    cwd: root,
    encoding: 'utf8',
    shell: false,
    env: {
      ...process.env,
      ANDROID_SDK_ROOT: process.env.ANDROID_SDK_ROOT ?? process.env.ANDROID_HOME ?? '',
    },
  });
}

function runAdbCommandIfAvailable(args) {
  return runAdbCommand(args);
}

function hashArtifact(path, content) {
  const sha = createHash('sha256').update(content).digest('hex');
  return {
    path,
    bytes: Buffer.byteLength(content),
    sha256: sha,
  };
}

function main() {
  const runId = process.env.UTOPIA_EMULATOR_SYNC_RUN_ID
    || `run-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`;
  const requestedAvds = normalizeAvdIdentities(process.env.UTOPIA_EMULATOR_SYNC_AVD_IDS || DEFAULT_EMULATOR_IDENTITIES.join(','));
  const planAvdIds = requestedAvds.slice(0, DEFAULT_PROOF_AVD_COUNT);

  let adbCommandExists = false;
  let adbServerReady = false;
  let deviceOutput = '';

  const versionResult = runAdbCommand(['version']);
  adbCommandExists = versionResult.status === 0;
  if (adbCommandExists) {
    const startServer = runAdbCommand(['start-server']);
    adbServerReady = startServer.status === 0;
    const devicesResult = runAdbCommandIfAvailable(['devices', '-l']);
    if (devicesResult.status === 0) {
      deviceOutput = devicesResult.stdout || devicesResult.stderr || '';
    }
  }

  const parsedDevices = parseAdbDevices(deviceOutput).filter((device) => device.status === 'device');
  const availableAvdIds = parsedDevices
    .map((device) => device.serial)
    .filter((serial) => planAvdIds.includes(serial));

  const prerequisites = evaluatePrerequisites({
    adbStatus: adbCommandExists,
    adbService: adbServerReady,
    requestedAvdCount: planAvdIds.length,
    availableAvdCount: availableAvdIds.length,
  });

  const plan = {
    proof: 'utopia_emulator_sync_plan',
    schemaVersion: EMULATOR_SYNC_PROOF_SCHEMA_VERSION,
    run_id: runId,
    requested_avd_ids: planAvdIds,
    available_avd_ids: availableAvdIds,
    required_avd_count: requiredAvdCount(),
    network_controls: {},
    installations: [],
    scenario: null,
    scenario_evaluation: null,
    app_execution_receipt: null,
    artifacts: {
      evidence_dir: 'app/build/evidence/emulator-sync',
    },
    blockers: [...prerequisites.blockers],
  };

  const artifacts = [];

  const outDir = join(outRoot, runId);
  mkdirSync(outDir, { recursive: true });

  const devicesRecordPath = join(outDir, 'adb-devices.txt');
  writeFileSync(devicesRecordPath, deviceOutput || 'adb unavailable\n', 'utf8');
  artifacts.push(hashArtifact('app/build/evidence/emulator-sync/' + runId + '/adb-devices.txt', readFileOrEmpty(devicesRecordPath)));

  if (prerequisites.status === 'READY') {
    const installations = buildInstallProfiles(availableAvdIds, runId);
    plan.installations = installations;
    plan.network_controls = Object.fromEntries(
      installations.map((install) => {
        return [
          install.avdId,
          {
            disconnect: buildNetworkPartitionCommands(install.avdId).disconnect,
            reconnect: buildNetworkPartitionCommands(install.avdId).reconnect,
            status_probes: buildNetworkPartitionCommands(install.avdId).statusProbe,
          },
        ];
      }),
    );

    const scenario = buildSyncScenario(installations);
    const scenarioEvaluation = evaluateSyncScenario(scenario);
    plan.scenario = scenario;
    plan.scenario_evaluation = scenarioEvaluation;

    if (scenarioEvaluation.all_passed) {
      plan.app_execution_receipt = {
        status: 'BLOCKED',
        requirement: 'A real multi-install Utopia run must provide app-level conflict, reconnect, rollback, and convergence evidence.',
        synthetic_plan_is_not_device_proof: true,
        blockers: ['emulator_app_execution_receipt_missing'],
      };
      plan.blockers = ['emulator_app_execution_receipt_missing'];
    } else {
      plan.blockers = ['local_scenario_assertions_failed'];
    }

    const scenarioPath = join(outDir, 'deterministic-scenario.json');
    const scenarioEvaluationPath = join(outDir, 'deterministic-scenario-evaluation.json');
    writeFileSync(scenarioPath, `${JSON.stringify(scenario, null, 2)}\n`, 'utf8');
    writeFileSync(scenarioEvaluationPath, `${JSON.stringify(scenarioEvaluation, null, 2)}\n`, 'utf8');

    artifacts.push(
      hashArtifact(
        'app/build/evidence/emulator-sync/' + runId + '/deterministic-scenario.json',
        JSON.stringify(scenario, null, 2),
      ),
      hashArtifact(
        'app/build/evidence/emulator-sync/' + runId + '/deterministic-scenario-evaluation.json',
        JSON.stringify(scenarioEvaluation, null, 2),
      ),
    );

  }

  const status = plan.blockers.length === 0 ? 'PASS' : 'BLOCKED';

  const proof = {
    proof: 'utopia_emulator_sync_proof',
    schemaVersion: EMULATOR_SYNC_PROOF_SCHEMA_VERSION,
    status,
    checked_at: new Date().toISOString(),
    run_id: runId,
    git: currentGit(root),
    environment: {
      adb_path: adbCommandExists ? 'adb' : null,
      adb_version_exit_code: versionResult.status,
      adb_service_exit_code: adbServerReady ? 0 : 1,
      requested_avds: planAvdIds,
      available_avds: availableAvdIds,
      run_scope: {
        max_avd_count: DEFAULT_PROOF_AVD_COUNT,
        required_avd_count: requiredAvdCount(),
        requested_count: planAvdIds.length,
        available_count: availableAvdIds.length,
      },
      host: {
        proof_mode: 'android_emulator_sync_dryrun',
        platform: process.platform,
        node: process.version,
      },
    },
    proof_scope: {
      physical_device_claim: 'not_applicable',
      live_provider_claim: 'BLOCKED',
      emulator_sync_plan: true,
      artifact_provenance_required: true,
      requires_network_partition_controls: true,
    },
    evidence: {
      plan,
      status_reason: status === 'PASS'
        ? 'real emulator app execution receipt verified'
        : `blocked:${plan.blockers.join('|')}`,
      artifacts,
    },
  };

  const payload = `${JSON.stringify(proof, null, 2)}\n`;
  writeFileSync(evidencePath, payload, 'utf8');
  mkdirSync(outRoot, { recursive: true });

  console.log(`${proof.proof}: ${proof.status}`);
  console.log(`EMULATOR_SYNC_PROOF=${evidencePath}`);

  if (status === 'BLOCKED') {
    console.log(`BLOCKER=${plan.blockers.join(',')}`);
    process.exitCode = 1;
  }
}

function readFileOrEmpty(path) {
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

try {
  main();
} catch (error) {
  console.error(`FAIL ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
