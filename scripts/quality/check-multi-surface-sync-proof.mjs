#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { isAbsolute, join } from 'node:path';

import { currentGit, validateEvidenceEnvelope } from './evidence-provenance.mjs';
import {
  DEFAULT_EMULATOR_IDENTITIES,
  REQUIRED_AVD_COUNT,
  DEFAULT_PROOF_AVD_COUNT,
  normalizeAvdIdentities,
  parseAdbDevices,
} from './emulator-sync/emulator-sync-plan.mjs';

const root = process.cwd();
const webReceiptPath = process.env.UTOPIA_WEB_SYNC_RECEIPT_PATH ?? 'app/build/evidence/web-product-smoke/web-product-smoke.json';
const macosReceiptPath = process.env.UTOPIA_MACOS_SYNC_RECEIPT_PATH ?? 'app/build/evidence/macos-build-receipt.json';
const outDir = join(root, 'app', 'build', 'evidence', 'multi-surface-sync');
const explicitOutPath = process.env.UTOPIA_MULTI_SURFACE_SYNC_PROOF_PATH;
const outPath = explicitOutPath
  ? (isAbsolute(explicitOutPath) ? explicitOutPath : join(outDir, explicitOutPath))
  : join(outDir, 'multi-surface-sync-proof.json');

function runAdbCommand(args) {
  return spawnSync('adb', args, {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      ANDROID_SDK_ROOT: process.env.ANDROID_SDK_ROOT ?? process.env.ANDROID_HOME ?? '',
    },
  });
}

function hashArtifact(fullPath, pathToRecord) {
  if (!existsSync(fullPath)) return null;
  const stat = statSync(fullPath);
  return {
    path: pathToRecord,
    bytes: stat.size,
    sha256: createHash('sha256').update(readFileSync(fullPath)).digest('hex'),
  };
}

function resolveRootPath(relativeOrAbsolutePath) {
  return isAbsolute(relativeOrAbsolutePath) ? relativeOrAbsolutePath : join(root, relativeOrAbsolutePath);
}

function hashArtifactsFromPath(fullPath, recordPath) {
  if (!existsSync(fullPath)) return [];
  const stat = statSync(fullPath);
  if (stat.isFile()) {
    const artifact = hashArtifact(fullPath, recordPath);
    return artifact ? [artifact] : [];
  }
  if (!stat.isDirectory()) return [];

  const artifacts = [];
  const entries = readdirSync(fullPath, { withFileTypes: true })
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));

  for (const name of entries) {
    artifacts.push(...hashArtifactsFromPath(join(fullPath, name), join(recordPath, name)));
  }
  return artifacts;
}

function hashArtifacts(paths) {
  const artifacts = [];
  for (const artifactPath of paths) {
    const fullPath = isAbsolute(artifactPath) ? artifactPath : join(root, artifactPath);
    artifacts.push(...hashArtifactsFromPath(fullPath, artifactPath));
  }
  return artifacts;
}

function readJson(relPath) {
  return JSON.parse(readFileSync(resolveRootPath(relPath), 'utf8'));
}

function requireBooleanReceipt(path, requiredProof, blockers, label) {
  const result = {
    exists: false,
    proof: null,
    pass: false,
    status: 'missing',
    issues: [],
  };
  const absolutePath = resolveRootPath(path);
  if (!existsSync(absolutePath)) {
    blockers.push(`missing:${label}_receipt:${path}`);
    result.issues.push('receipt_file_missing');
    return result;
  }

  let receipt;
  try {
    receipt = readJson(path);
  } catch (error) {
    blockers.push(`invalid:${label}_receipt:${path}`);
    result.issues.push(`receipt_parse_error:${error instanceof Error ? error.message : String(error)}`);
    return result;
  }

  result.exists = true;
  result.proof = typeof receipt.proof === 'string' ? receipt.proof : null;
  result.status = receipt.status ?? (receipt.pass === true ? 'passed' : 'failed');
  result.pass = receipt.pass === true || receipt.status === 'passed';
  result.proofMismatch = result.proof !== requiredProof;

  const envelope = validateEvidenceEnvelope(root, path, receipt, currentGit(root));
  if (!envelope.valid) {
    blockers.push(`invalid_envelope:${label}_receipt`);
    result.issues.push(...envelope.issues);
  }
  if (result.proofMismatch) {
    blockers.push(`proof_mismatch:${label}_receipt:${result.proof}`);
  }
  if (!result.pass) {
    blockers.push(`receipt_not_passed:${label}`);
  }

  return result;
}

function findMacosAppBundle() {
  const candidates = [
    join(root, 'macos/macos/build/Build/Products'),
  ];
  const appBundles = [];
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    for (const productConfig of readdirSync(candidate, { withFileTypes: true })) {
      if (!productConfig.isDirectory()) continue;
      const fullConfig = join(candidate, productConfig.name);
      const children = readdirSync(fullConfig, { withFileTypes: true });
      for (const child of children) {
        if (!child.isDirectory()) continue;
        if (!child.name.endsWith('.app')) continue;
        appBundles.push(join(fullConfig, child.name));
      }
    }
  }
  return appBundles;
}

function main() {
  mkdirSync(outDir, { recursive: true });

  const requestedAvds = normalizeAvdIdentities(process.env.UTOPIA_EMULATOR_SYNC_AVD_IDS ?? DEFAULT_EMULATOR_IDENTITIES.join(','));
  const planAvdIds = requestedAvds.slice(0, DEFAULT_PROOF_AVD_COUNT);

  let adbDeviceOutput = '';
  const adbVersion = runAdbCommand(['version']);
  const adbService = runAdbCommand(['start-server']);
  if (adbService.status === 0) {
    const devices = runAdbCommand(['devices', '-l']);
    adbDeviceOutput = devices.stdout || devices.stderr || '';
  }

  const parsedDevices = parseAdbDevices(adbDeviceOutput)
    .filter((device) => device.status === 'device')
    .map((device) => device.serial);

  const availableAvdIds = parsedDevices.filter((serial) => serial.startsWith('emulator-') && planAvdIds.includes(serial));

  const blockers = [];
  if (adbVersion.status !== 0) blockers.push('adb_unavailable');
  if (adbService.status !== 0) blockers.push('adb_service_unavailable');
  if (availableAvdIds.length < Math.min(REQUIRED_AVD_COUNT, planAvdIds.length)) {
    blockers.push('insufficient_emulator_surfaces:2');
  }

  const webReceipt = requireBooleanReceipt(webReceiptPath, 'utopia_web_product_smoke', blockers, 'web');
  const macosReceipt = requireBooleanReceipt(macosReceiptPath, 'utopia_macos_build_receipt', blockers, 'macos');

  const macosAppArtifacts = findMacosAppBundle();
  if (macosAppArtifacts.length === 0) {
    blockers.push('missing_macos_build_artifact');
  }

  const status = blockers.length === 0 ? 'PASS' : 'BLOCKED';

  const evidence = {
    proof: 'utopia_multi_surface_sync_proof',
    status,
    checked_at: new Date().toISOString(),
    git: currentGit(root),
    blockers,
    surfaces: {
      emulators: {
        requested_avd_ids: planAvdIds,
        available_avd_ids: availableAvdIds,
        required_count: REQUIRED_AVD_COUNT,
      },
      web: {
        requested_receipt_path: webReceiptPath,
        exists: webReceipt.exists,
        proof: webReceipt.proof,
        pass: webReceipt.pass,
        status: webReceipt.status,
        issues: webReceipt.issues,
      },
      macos: {
        requested_receipt_path: macosReceiptPath,
        receipt_exists: macosReceipt.exists,
        proof: macosReceipt.proof,
        pass: macosReceipt.pass,
        status: macosReceipt.status,
        issues: macosReceipt.issues,
        artifacts: macosAppArtifacts.flatMap((artifactPath) => hashArtifactsFromPath(
          artifactPath,
          artifactPath.replace(`${root}/`, ''),
        )),
      },
      environment: {
        adb_version_exit_code: adbVersion.status,
        adb_service_exit_code: adbService.status,
        adb_devices_output_sha: adbDeviceOutput ? createHash('sha256').update(adbDeviceOutput).digest('hex') : null,
      },
    },
    evidence: {
      evidence_dir: 'app/build/evidence/multi-surface-sync',
      artifacts: [
        ...hashArtifacts([webReceiptPath]),
        ...hashArtifacts([macosReceiptPath]),
        ...macosAppArtifacts.flatMap((artifactPath) => hashArtifactsFromPath(
          artifactPath,
          artifactPath.replace(`${root}/`, ''),
        )),
      ],
    },
    status_reason: status === 'PASS'
      ? 'local multi-surface inventory + receipt matrix passed; no emulator app-execution receipts claimed'
      : `blocked:${blockers.join('|')}`,
  };

  writeFileSync(outPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  console.log(`${evidence.proof}: ${evidence.status}`);
  if (status !== 'PASS') {
    console.log(`BLOCKER=${blockers.join(',')}`);
  }
  if (status !== 'PASS') process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
