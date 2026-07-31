import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { validateShellProofReceipt, SHELL_PROOF_SCHEMA_VERSION } from '../golden-loop/shell-proof-protocol.mjs';

export const DEFAULT_MAX_AGE_MS = 15 * 60 * 1000;

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function read(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    return {
      proof: SHELL_PROOF_SCHEMA_VERSION,
      status: 'BLOCKED',
      checked_at: new Date().toISOString(),
      blocker: { reason: `missing_or_invalid_receipt:${error instanceof Error ? error.message : String(error)}` },
    };
  }
}

function freshness(checkedAt, now, maxAgeMs) {
  const time = Date.parse(checkedAt || '');
  if (!Number.isFinite(time)) return 'missing_or_invalid_checked_at';
  if (time > now + 5_000) return 'checked_at_in_future';
  if (now - time > maxAgeMs) return 'receipt_checked_at_too_old';
  return null;
}

export function validateAndroidProofReceipt(receipt, {
  root,
  label = 'android',
  path = 'android-proof.json',
  now = Date.now(),
  maxAgeMs = DEFAULT_MAX_AGE_MS,
} = {}) {
  const blockers = [];
  const source = object(receipt?.source);
  const execution = object(receipt?.execution);
  const observations = Array.isArray(execution?.observations) ? execution.observations : [];
  const status = receipt?.status;
  const isBlocked = status === 'BLOCKED';

  if (receipt?.proof !== SHELL_PROOF_SCHEMA_VERSION) blockers.push('invalid_proof_schema');
  if (!['PASS', 'BLOCKED'].includes(status)) blockers.push('invalid_status');
  const ageBlocker = freshness(receipt?.checked_at, now, maxAgeMs);
  if (ageBlocker) blockers.push(ageBlocker);
  if (receipt?.synthetic_plan_is_not_device_proof === true) blockers.push(`synthetic_receipt:${label}`);

  if (isBlocked) {
    if (!object(receipt?.blocker) || typeof receipt.blocker.reason !== 'string' || !receipt.blocker.reason) {
      blockers.push('missing_blocker_reason');
    }
    return { pass: false, status, blockers, serial: source?.emulator_serial || null, runId: receipt?.run_id || null };
  }

  if (source?.surface !== 'android') blockers.push('invalid_source_surface');
  if (!/^emulator-[0-9]+$/.test(source?.emulator_serial || '')) blockers.push('missing_emulator_serial');
  if (typeof receipt?.run_id !== 'string' || !receipt.run_id.trim()) blockers.push('missing_run_id');
  if (typeof receipt?.package_checksum !== 'string' || !/^sha256:[a-f0-9]{64}$/i.test(receipt.package_checksum)) {
    blockers.push('missing_package_checksum');
  }
  if (observations.length === 0) blockers.push('missing_runtime_observations');
  for (const observation of observations) {
    if (typeof observation?.driver !== 'string' || !observation.driver.startsWith('adb:')) {
      blockers.push('missing_adb_observation_driver');
    }
    if (!observation?.artifact || typeof observation.artifact.path !== 'string') {
      blockers.push('missing_observation_artifact');
    }
  }

  if (blockers.length === 0 && root) {
    const protocol = validateShellProofReceipt(receipt, {
      root,
      label,
      path,
      requiredSourceSurface: 'android',
    });
    blockers.push(...protocol.blockers);
  }
  return { pass: blockers.length === 0, status, blockers, serial: source?.emulator_serial || null, runId: receipt?.run_id || null };
}

export function aggregateAndroidProofReceipts(receipts, { now = Date.now(), maxAgeMs = DEFAULT_MAX_AGE_MS } = {}) {
  const blockers = [];
  const valid = [];
  for (const entry of receipts) {
    const result = validateAndroidProofReceipt(entry.receipt, {
      root: entry.root,
      label: entry.label,
      path: entry.path,
      now,
      maxAgeMs,
    });
    if (!result.pass) blockers.push(...result.blockers.map((blocker) => `${entry.label}:${blocker}`));
    if (result.status !== 'PASS') blockers.push(`${entry.label}:runtime_not_passed`);
    valid.push(result);
  }
  const serials = valid.map((result) => result.serial).filter(Boolean);
  if (serials.length !== 2) blockers.push(`expected_two_android_emulators:${serials.length}`);
  if (new Set(serials).size !== serials.length) blockers.push('android_emulator_serials_not_distinct');
  const runIds = valid.map((result) => result.runId).filter(Boolean);
  if (new Set(runIds).size > 1) blockers.push('android_receipt_run_ids_mismatch');
  return { status: blockers.length === 0 ? 'PASS' : 'BLOCKED', blockers, serials, runId: runIds[0] || null };
}

function cli() {
  const args = process.argv.slice(2);
  const output = args[args.indexOf('--output') + 1];
  const paths = args.filter((arg, index) => !arg.startsWith('--') && args[index - 1] !== '--output');
  const now = Date.now();
  const entries = paths.map((path) => {
    const absolute = resolve(path);
    const evidenceRoot = dirname(dirname(absolute));
    return { receipt: read(absolute), root: evidenceRoot, path: absolute, label: absolute };
  });
  const result = aggregateAndroidProofReceipts(entries, { now });
  if (output) {
    mkdirSync(dirname(resolve(output)), { recursive: true });
    writeFileSync(resolve(output), `${JSON.stringify({ proof: SHELL_PROOF_SCHEMA_VERSION, checked_at: new Date(now).toISOString(), ...result }, null, 2)}\n`);
  }
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.status === 'PASS' ? 0 : 2;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) cli();
