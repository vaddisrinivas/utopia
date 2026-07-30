#!/usr/bin/env node

import {createHash} from 'node:crypto';
import {existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync} from 'node:fs';
import {dirname, isAbsolute, join, relative, resolve} from 'node:path';
import {spawnSync} from 'node:child_process';

import {currentGit} from '../evidence-provenance.mjs';
import {validateShellProofReceipt} from '../golden-loop/shell-proof-protocol.mjs';

const root = process.cwd();
const targetPackageId = 'shared-household-board';
const requiredSourceSurface = 'macos';
const proofPath = resolve(
  process.env.UTOPIA_MACOS_SHARED_HOUSEHOLD_RUNTIME_PROOF_PATH
    || 'app/build/evidence/macos-shared-household-runtime-receipt.json',
);
const appPath = process.env.UTOPIA_MACOS_APP_PATH ? resolve(process.env.UTOPIA_MACOS_APP_PATH) : null;
const bridgeCommand = process.env.UTOPIA_MACOS_RUNTIME_BRIDGE || null;
const bridgeReceiptPath = resolve(
  process.env.UTOPIA_MACOS_RUNTIME_BRIDGE_RECEIPT_PATH
    || join(dirname(proofPath), 'shared-household-runtime-bridge-receipt.json'),
);
const rawObservationPath = resolve(
  process.env.UTOPIA_MACOS_RUNTIME_BRIDGE_RAW_OBSERVATION_PATH
    || join(dirname(proofPath), 'shared-household-runtime-observations.jsonl'),
);
const platform = process.env.UTOPIA_MACOS_PLATFORM_OVERRIDE || process.platform;
const timeoutMs = Number.parseInt(process.env.UTOPIA_MACOS_RUNTIME_BRIDGE_TIMEOUT_MS || '45000', 10);
const optIn = process.env.UTOPIA_MACOS_GOLDEN_LOOP === '1';
const canonicalProtocolPath = resolve(root, 'scripts/quality/golden-loop/shell-proof-protocol.mjs');

const blockers = [];
const receipt = {
  proof: 'utopia_macos_shared_household_runtime_receipt',
  status: 'BLOCKED',
  checked_at: new Date().toISOString(),
  git: currentGit(root),
  blockers: blockers,
  target_package: targetPackageId,
  required_source_surface: requiredSourceSurface,
  checked_platform: platform,
  app_path: appPath ? relative(root, appPath) : null,
  app_bundle_exists: false,
  app_artifact: null,
  protocol: {
    required_path: relative(root, canonicalProtocolPath),
    validator_imported: true,
  },
  bridge: {
    configured: Boolean(bridgeCommand),
    command: bridgeCommand
      ? (isAbsolute(bridgeCommand) ? bridgeCommand : resolve(root, bridgeCommand))
      : null,
    receipt_path: relative(root, bridgeReceiptPath),
    raw_observation_path: relative(root, rawObservationPath),
    invoked: false,
    exit_code: null,
    output_bytes: 0,
  },
  shell_proof: {
    observations_path_exists: false,
    observations_hash: null,
    validator: {
      pass: null,
      blockers: [],
      status: null,
      issues: [],
    },
  },
  blockers_note: null,
};

function fail(message) {
  if (!blockers.includes(message)) blockers.push(message);
}

function sha256HexFromString(input) {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

function hashFile(path) {
  try {
    return createHash('sha256').update(readFileSync(path)).digest('hex');
  } catch {
    return null;
  }
}

function hashDirectory(basePath) {
  const digest = createHash('sha256');
  const queue = [basePath];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;

    let stat;
    try {
      stat = statSync(current);
    } catch {
      continue;
    }

    if (stat.isDirectory()) {
      const children = readdirSync(current, {withFileTypes: true})
        .map((entry) => entry.name)
        .sort((left, right) => left.localeCompare(right));
      for (const child of children) queue.push(resolve(current, child));
      continue;
    }

    if (!stat.isFile()) continue;
    digest.update(relative(root, current));
    digest.update(readFileSync(current));
  }

  return digest.digest('hex');
}

function directoryBytes(basePath) {
  let bytes = 0;
  const queue = [basePath];
  while (queue.length > 0) {
    const current = queue.shift();
    let stat;
    try {
      stat = statSync(current);
    } catch {
      continue;
    }

    if (stat.isDirectory()) {
      const children = readdirSync(current, {withFileTypes: true}).map((entry) => entry.name);
      for (const child of children) queue.push(resolve(current, child));
      continue;
    }

    if (stat.isFile()) bytes += stat.size;
  }
  return bytes;
}

function extractBundleExecutable(appBundlePath) {
  const plistPath = resolve(appBundlePath, 'Contents', 'Info.plist');
  if (!existsSync(plistPath)) return null;
  let contents;
  try {
    contents = readFileSync(plistPath, 'utf8');
  } catch {
    return null;
  }
  const found = contents.match(/<key>\s*CFBundleExecutable\s*<\/key>\s*<string>([^<]+)<\/string>/);
  if (!found || !found[1]) return null;
  const executable = resolve(appBundlePath, 'Contents', 'MacOS', found[1]);
  return existsSync(executable) ? executable : null;
}

function readReceiptJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

if (!optIn) fail('missing_macos_golden_loop_opt_in');
if (platform !== 'darwin') fail('platform_not_darwin');

if (!appPath) {
  fail('missing_app_path');
} else {
  receipt.app_path = appPath;
  if (!appPath.endsWith('.app')) fail('app_path_not_dot_app');
  if (!existsSync(appPath)) fail(`app_path_missing:${relative(root, appPath)}`);
  if (appPath && !appPath.endsWith('/UtopiaMac.app')) {
    fail(`app_path_not_expected_bundle:${relative(root, appPath)}`);
  }
}

let expectedAppArtifactChecksum = null;

if (appPath && existsSync(appPath) && appPath.endsWith('.app')) {
  try {
    const appStats = statSync(appPath);
    receipt.app_bundle_exists = appStats.isDirectory();
    if (!appStats.isDirectory()) {
      fail('app_path_not_directory');
    } else {
      const manifestPath = resolve(appPath, 'Contents', 'Info.plist');
      const executablePath = extractBundleExecutable(appPath);
      const infoHash = existsSync(manifestPath) ? hashFile(manifestPath) : null;
      const executableHash = executablePath ? hashFile(executablePath) : null;
      const bundleBytes = directoryBytes(appPath);
      const bundleHash = hashDirectory(appPath);
      const combinedHash = `${infoHash ?? ''}${executableHash ? `:${executableHash}` : ''}`.length > 0
        ? sha256HexFromString(`${bundleHash ?? ''}:${infoHash ?? ''}:${executableHash ?? ''}`)
        : null;

      if (!bundleHash) fail('app_artifact_hash_missing');

      receipt.app_artifact = {
        path: relative(root, appPath),
        binding_mode: executableHash && infoHash ? 'executable_plus_manifest' : 'app_bundle',
        sha256: bundleHash,
        bytes: bundleBytes,
        executable: executablePath ? relative(root, executablePath) : null,
        manifest_sha256: infoHash,
        executable_sha256: executableHash,
        bundle_plus_manifest_sha256: combinedHash,
      };

      expectedAppArtifactChecksum = bundleHash ? `sha256:${bundleHash}` : null;
    }
  } catch {
    fail('app_path_unreadable');
  }
}

if (optIn && blockers.length === 0) {
  if (!bridgeCommand) {
    fail('missing_runtime_automation_bridge');
  } else {
    if (!existsSync(bridgeCommand)) fail(`runtime_bridge_command_missing:${bridgeCommand}`);

    const bridgeArgs = [
      '--app',
      appPath,
      '--package',
      targetPackageId,
      '--source-surface',
      requiredSourceSurface,
      '--receipt-path',
      bridgeReceiptPath,
      '--raw-observations-path',
      rawObservationPath,
    ];

    if (expectedAppArtifactChecksum) {
      bridgeArgs.push('--app-artifact-checksum', expectedAppArtifactChecksum);
    }

    const bridgeResult = spawnSync(bridgeCommand, bridgeArgs, {
      cwd: root,
      encoding: 'utf8',
      env: {...process.env, UTOPIA_MACOS_GOLDEN_LOOP: '1'},
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: Number.isFinite(timeoutMs) ? timeoutMs : 45000,
    });

    const stdout = String(bridgeResult.stdout ?? '');
    const stderr = String(bridgeResult.stderr ?? '');
    receipt.bridge.invoked = true;
    receipt.bridge.exit_code = typeof bridgeResult.status === 'number' ? bridgeResult.status : null;
    receipt.bridge.output_bytes = stdout.length + stderr.length;

    if (bridgeResult.error) {
      fail(`runtime_bridge_spawn_error:${bridgeResult.error.message}`);
    } else if (bridgeResult.status !== 0) {
      fail(`runtime_bridge_exit_${bridgeResult.status}`);
    }

    if (existsSync(bridgeReceiptPath)) {
      const bridgeReceipt = readReceiptJson(bridgeReceiptPath);
      if (bridgeReceipt === null) {
        fail(`runtime_bridge_receipt_invalid_json:${relative(root, bridgeReceiptPath)}`);
      } else {
        const bridgeArtifactChecksum = bridgeReceipt?.source?.app_artifact_checksum;
        if (!expectedAppArtifactChecksum) {
          fail('app_artifact_checksum_not_available');
        } else if (!bridgeArtifactChecksum) {
          fail('missing_bridge_app_artifact_checksum');
        } else if (bridgeArtifactChecksum !== expectedAppArtifactChecksum) {
          fail(`app_artifact_checksum_mismatch:${expectedAppArtifactChecksum}:${bridgeArtifactChecksum}`);
        }

        try {
          const result = validateShellProofReceipt(bridgeReceipt, {
            root,
            label: 'bridge_receipt',
            path: relative(root, bridgeReceiptPath),
            requiredSourceSurface,
          });

          receipt.shell_proof.validator = {
            pass: result.pass,
            blockers: result.blockers,
            status: result.status,
            issues: [],
          };

          if (!result.pass) fail('shell_proof_receipt_rejected');
          for (const blocker of result.blockers) {
            fail(`shell_proof_validator_blocker:${blocker}`);
          }
        } catch (error) {
          fail(`shell_proof_validation_failed:${error instanceof Error ? error.message : String(error)}`);
        }
      }
    } else {
      fail(`runtime_bridge_receipt_missing:${relative(root, bridgeReceiptPath)}`);
    }

    if (existsSync(rawObservationPath)) {
      const observationBytes = readFileSync(rawObservationPath);
      receipt.shell_proof.observations_path_exists = true;
      receipt.shell_proof.observations_hash = createHash('sha256').update(observationBytes).digest('hex');
    } else {
      fail(`runtime_bridge_raw_observations_missing:${relative(root, rawObservationPath)}`);
    }
  }
}

receipt.status = blockers.length === 0 ? 'PASS' : 'BLOCKED';
receipt.blockers_note = blockers.length === 0
  ? null
  : 'Proof script blocked until opt-in app, bridge, and shell-proof receipt validate.';

mkdirSync(dirname(proofPath), {recursive: true});
writeFileSync(proofPath, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');

console.log(`utopia_macos_shared_household_runtime_receipt: ${receipt.status} (${relative(root, proofPath)})`);
if (blockers.length) console.log(`BLOCKERS=${blockers.join(',')}`);
process.exitCode = receipt.status === 'PASS' ? 0 : 1;
