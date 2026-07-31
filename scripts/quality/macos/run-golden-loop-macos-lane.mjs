#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import { currentGit } from '../evidence-provenance.mjs';
import { validateShellProofReceipt } from '../golden-loop/shell-proof-protocol.mjs';

const ROOT = process.cwd();
const BUILD_RECEIPT_PATH = resolve(ROOT, process.env.UTOPIA_MACOS_BUILD_RECEIPT_PATH || 'app/build/evidence/macos-build-receipt.json');
const LANE_RECEIPT_PATH = resolve(ROOT, process.env.UTOPIA_MACOS_LANE_C_RECEIPT_PATH || 'app/build/evidence/golden-loop/macos-lane-c-receipt.json');
const BRIDGE_RECEIPT_PATH = resolve(ROOT, process.env.UTOPIA_MACOS_RUNTIME_BRIDGE_RECEIPT_PATH || 'app/build/evidence/golden-loop/macos-debug-bridge-receipt.json');
const BRIDGE_OBSERVATIONS_PATH = resolve(ROOT, process.env.UTOPIA_MACOS_RUNTIME_BRIDGE_RAW_OBSERVATION_PATH || 'app/build/evidence/golden-loop/macos-debug-bridge-observations.jsonl');
const WORKSPACE_PATH = resolve(ROOT, 'macos/macos/UtopiaMac.xcworkspace');
const SCHEME = process.env.UTOPIA_MACOS_SCHEME || 'UtopiaMac-macOS';
const CONFIGURATION = process.env.UTOPIA_MACOS_CONFIGURATION || 'Debug';
const TARGET_PACKAGE_ID = process.env.UTOPIA_MACOS_TARGET_PACKAGE_ID || 'shared-household-board';
const BUILDER = resolve(ROOT, 'scripts/quality/macos/build-macos-app.mjs');
const BRIDGE = resolve(ROOT, 'scripts/quality/macos/run-golden-loop-debug-bridge.mjs');

const laneStatus = {
  blockers: [],
  build: {
    command: `node ${relative(ROOT, BUILDER)}`,
    receipt: null,
    exit_code: null,
    output_bytes: 0,
    executed: false,
  },
  bridge: {
    command: `node ${relative(ROOT, BRIDGE)}`,
    receipt: null,
    observations: null,
    exit_code: null,
    output_bytes: 0,
    invoked: false,
    output_tail: {
      stdout: null,
      stderr: null,
    },
    validation: {
      pass: null,
      blockers: [],
      status: null,
    },
  },
};

function sha256Hex(input) {
  return createHash('sha256').update(input).digest('hex');
}

function relativePath(value) {
  return relative(ROOT, value);
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function artifactFor(path) {
  if (!existsSync(path)) return null;
  try {
    const stat = statSync(path);
    const bytes = stat.isFile() ? stat.size : 0;
    const sha256 = stat.isFile() ? `sha256:${sha256Hex(readFileSync(path))}` : null;
    return { path: relativePath(path), bytes, sha256 };
  } catch {
    return null;
  }
}

function nextActionForBlockers(blockers) {
  if (blockers.includes('missing_native_macos_runner')) {
    return 'Re-run lane C on a macOS runner (macos-latest) with native shell tooling.';
  }
  if (blockers.includes('missing_macos_workspace')) {
    return 'Ensure macos/macos/UtopiaMac.xcworkspace exists in this repository checkout and rerun.';
  }
  if (blockers.includes('missing_golden_loop_debug_token')) {
    return 'Set UTOPIA_GOLDEN_LOOP_DEBUG_TOKEN (or EXPO_PUBLIC_UTOPIA_GOLDEN_LOOP_TOKEN) and rerun.';
  }
  if (blockers.includes('build_receipt_missing') || blockers.includes('build_receipt_unreadable')) {
    return 'Fix macOS build blockers and rerun lane C.';
  }
  if (blockers.some((entry) => entry.startsWith('bridge_driver'))) {
    return 'Rerun lane C after lifecycle bridge executes successfully.';
  }
  if (blockers.some((entry) => entry.startsWith('bridge_receipt_'))) {
    return 'Fix the bridge shell-proof output and rerun lane C.';
  }
  return 'Rerun lane C after resolving blockers.';
}

function runNodeScript(scriptPath, args = [], env = process.env) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: ROOT,
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 16 * 1024 * 1024,
  });
}

function runBuild(blockers) {
  if (!existsSync(WORKSPACE_PATH)) {
    blockers.push('missing_macos_workspace');
    return null;
  }

  const result = runNodeScript(BUILDER, [], {
    ...process.env,
    UTOPIA_MACOS_SCHEME: SCHEME,
    UTOPIA_MACOS_CONFIGURATION: CONFIGURATION,
    UTOPIA_MACOS_BUILD_RECEIPT_PATH: BUILD_RECEIPT_PATH,
  });

  laneStatus.build.executed = true;
  laneStatus.build.exit_code = Number.isInteger(result.status) ? result.status : 1;
  laneStatus.build.output_bytes = (result.stdout?.length ?? 0) + (result.stderr?.length ?? 0);

  if (laneStatus.build.exit_code !== 0) {
    blockers.push(`build_failed:${laneStatus.build.exit_code}`);
    return null;
  }

  const receipt = readJson(BUILD_RECEIPT_PATH);
  laneStatus.build.receipt = artifactFor(BUILD_RECEIPT_PATH);

  if (!receipt || receipt.proof !== 'utopia_macos_build_receipt') {
    blockers.push('build_receipt_unreadable');
    return null;
  }
  if (receipt.status !== 'passed') {
    blockers.push('build_receipt_blocked');
    blockers.push(...(Array.isArray(receipt.blockers) ? receipt.blockers.map((entry) => `build_${entry}`) : []));
    return receipt;
  }

  const appPath = receipt.app_path ? resolve(ROOT, receipt.app_path) : null;
  if (!appPath || !isAbsolute(appPath) || !existsSync(appPath) || !statSync(appPath).isDirectory()) {
    blockers.push(`build_missing_app:${receipt.app_path ?? 'missing'}`);
    return receipt;
  }
  return { ...receipt, app_path: appPath };
}

function runBridge(buildReceipt, blockers) {
  const token = (process.env.UTOPIA_MACOS_GOLDEN_LOOP_DEBUG_TOKEN
    || process.env.EXPO_PUBLIC_UTOPIA_GOLDEN_LOOP_TOKEN
    || '').trim();
  if (!token || token.length < 32) {
    blockers.push('missing_golden_loop_debug_token');
    return null;
  }
  const appArtifactChecksum = buildReceipt?.artifact?.sha256
    ? `sha256:${String(buildReceipt.artifact.sha256).replace(/^sha256:/i, '')}`
    : null;

  const commandArgs = [
    '--app',
    buildReceipt?.app_path,
    '--package',
    TARGET_PACKAGE_ID,
    '--source-surface',
    'macos',
    '--receipt-path',
    BRIDGE_RECEIPT_PATH,
    '--raw-observations-path',
    BRIDGE_OBSERVATIONS_PATH,
  ];
  if (appArtifactChecksum) commandArgs.push('--app-artifact-checksum', appArtifactChecksum);

  const result = runNodeScript(BRIDGE, commandArgs, {
    ...process.env,
    UTOPIA_GOLDEN_LOOP_DEBUG_TOKEN: token,
    UTOPIA_MACOS_RUNTIME_BRIDGE_RECEIPT_PATH: BRIDGE_RECEIPT_PATH,
    UTOPIA_MACOS_RUNTIME_BRIDGE_RAW_OBSERVATION_PATH: BRIDGE_OBSERVATIONS_PATH,
  });

  laneStatus.bridge.invoked = true;
  laneStatus.bridge.exit_code = Number.isInteger(result.status) ? result.status : 1;
  laneStatus.bridge.output_bytes = (result.stdout?.length ?? 0) + (result.stderr?.length ?? 0);
  laneStatus.bridge.output_tail = {
    stdout: (result.stdout ?? '').slice(-4000),
    stderr: (result.stderr ?? '').slice(-4000),
  };

  if (laneStatus.bridge.exit_code !== 0) {
    blockers.push(`bridge_driver_exit_${laneStatus.bridge.exit_code}`);
  }

  laneStatus.bridge.receipt = artifactFor(BRIDGE_RECEIPT_PATH);
  laneStatus.bridge.observations = artifactFor(BRIDGE_OBSERVATIONS_PATH);

  if (!existsSync(BRIDGE_RECEIPT_PATH)) {
    blockers.push('bridge_receipt_missing');
    return null;
  }

  const bridgeReceipt = readJson(BRIDGE_RECEIPT_PATH);
  if (!bridgeReceipt) {
    blockers.push('bridge_receipt_unreadable');
    return null;
  }
  if (bridgeReceipt.source?.app_artifact_checksum !== appArtifactChecksum) {
    blockers.push('bridge_receipt_app_artifact_checksum_mismatch');
  }

  const validation = validateShellProofReceipt(bridgeReceipt, {
    root: ROOT,
    label: 'macos_lifecycle_bridge',
    path: relativePath(BRIDGE_RECEIPT_PATH),
    requiredSourceSurface: 'macos',
  });
  laneStatus.bridge.validation = validation;
  if (!validation.pass) {
    blockers.push('bridge_receipt_invalid');
    blockers.push(...validation.blockers.map((entry) => `bridge_receipt_blocker:${entry}`));
  }
  return validation;
}

function writeReceipt(status, blockers) {
  const proof = {
    proof: 'utopia_macos_golden_loop_lane_c_receipt',
    status,
    checked_at: new Date().toISOString(),
    git: currentGit(ROOT),
    lane: 'C',
    source_surface: 'macos',
    workspace: {
      path: relativePath(WORKSPACE_PATH),
      scheme: SCHEME,
      configuration: CONFIGURATION,
    },
    target_package: TARGET_PACKAGE_ID,
    blockers: [...new Set(blockers)],
    blockers_note: blockers.length
      ? 'Lane failed while executing required native macOS lane steps.'
      : null,
    next_action: blockers.length ? nextActionForBlockers(blockers) : null,
    artifacts: [],
    build: {
      receipt: laneStatus.build.receipt ? {
        ...laneStatus.build.receipt,
        status: laneStatus.build.exit_code === 0 ? 'PASS' : 'BLOCKED',
        proof: laneStatus.build.receipt ? 'utopia_macos_build_receipt' : null,
        exit_code: laneStatus.build.exit_code,
      } : null,
      command_executed: laneStatus.build.executed,
      command_exit_code: laneStatus.build.exit_code,
      command_output_bytes: laneStatus.build.output_bytes,
    },
    lifecycle_driver: {
      proof: laneStatus.bridge.validation?.proof ?? null,
      status: laneStatus.bridge.validation?.status ?? null,
      exit_code: laneStatus.bridge.exit_code,
      validation: {
        pass: laneStatus.bridge.validation?.pass ?? null,
        blockers: laneStatus.bridge.validation?.blockers ?? [],
      },
      command_executed: laneStatus.bridge.invoked,
      command_exit_code: laneStatus.bridge.exit_code,
      command_output_bytes: laneStatus.bridge.output_bytes,
      command_output_tail: laneStatus.bridge.output_tail,
      receipt: laneStatus.bridge.receipt ? { ...laneStatus.bridge.receipt, proof: 'utopia.shell-proof-protocol.v1' } : null,
      observations: laneStatus.bridge.observations ? laneStatus.bridge.observations : null,
      transport: laneStatus.bridge.validation?.transport ?? null,
      convergence: laneStatus.bridge.validation?.convergence ?? null,
      scenario_id: laneStatus.bridge.validation?.scenario_id ?? null,
      operation_ids: laneStatus.bridge.validation?.operation_ids ?? [],
    },
  };

  if (proof.build.receipt) proof.artifacts.push({ type: 'build-receipt', ...proof.build.receipt });
  if (proof.lifecycle_driver.receipt) proof.artifacts.push({ type: 'bridge-receipt', ...proof.lifecycle_driver.receipt });
  if (proof.lifecycle_driver.observations) {
    proof.artifacts.push({ type: 'bridge-observations', ...proof.lifecycle_driver.observations });
  }
  writeFileSync(LANE_RECEIPT_PATH, `${JSON.stringify(proof, null, 2)}\n`, 'utf8');
}

function assertNativeShell(blockers) {
  if (process.platform !== 'darwin') {
    blockers.push('missing_native_macos_runner');
    console.error('Native macOS runner required for lane C.');
    console.error(`next_action: ${nextActionForBlockers(blockers)}`);
    process.exit(1);
  }
  if (!existsSync(WORKSPACE_PATH)) {
    blockers.push('missing_macos_workspace');
    console.error('macOS workspace not found for lane C.');
    console.error(`next_action: ${nextActionForBlockers(blockers)}`);
    process.exit(1);
  }
}

function ensureDir(path) {
  if (existsSync(path)) return;
  const directory = dirname(path);
  mkdirSync(directory, { recursive: true });
}

function main() {
  const blockers = [];
  assertNativeShell(blockers);

  const buildReceipt = runBuild(blockers);
  const appReceipt = buildReceipt && buildReceipt.status === 'passed' ? buildReceipt : null;
  if (appReceipt && laneStatus.build.exit_code === 0) {
    runBridge(appReceipt, blockers);
  }

  const status = blockers.length === 0 ? 'PASS' : 'BLOCKED';
  ensureDir(LANE_RECEIPT_PATH);
  writeReceipt(status, blockers);
  if (status !== 'PASS') process.exitCode = 1;
}

main();
