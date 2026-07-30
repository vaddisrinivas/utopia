#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';

import { currentGit } from '../evidence-provenance.mjs';

const root = process.cwd();
const defaultReceiptPath = resolve(root, 'app', 'build', 'evidence', 'golden-loop', 'creator-study-receipt.json');
const defaultOutputPath = resolve(root, 'app', 'build', 'evidence', 'golden-loop', 'creator-study-receipt-validation.json');

const RECEIPT_PATH = process.env.UTOPIA_CREATOR_STUDY_RECEIPT_PATH || defaultReceiptPath;
const OUTPUT_PATH = process.env.UTOPIA_CREATOR_STUDY_RECEIPT_CHECK_PATH || defaultOutputPath;
const MAX_SECONDS = 600;

function fail(message, blockers = []) {
  const evidence = {
    proof: 'utopia_creator_study_receipt_check',
    checked_at: new Date().toISOString(),
    git: currentGit(root),
    status: 'blocked',
    blockers,
    issue: message,
    receipt_path: relative(root, RECEIPT_PATH),
  };

  mkdirSync(resolve(OUTPUT_PATH, '..'), { recursive: true });
  writeFileSync(OUTPUT_PATH, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  console.log(`Creator study receipt check: BLOCKED (${blockers.join(', ') || message})`);
  console.log(`CREATOR_STUDY_RECEIPT=BLOCKED`);
  if (blockers.length) console.log(`BLOCKER=${blockers.join(',')}`);
  process.exitCode = 1;
}

function parseJson(path) {
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function boolValue(value) {
  return value === true;
}

function toStringOrNull(value) {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function resolveFreshness(receipt, now) {
  const checkedAt = Date.parse(receipt?.checked_at);
  if (!Number.isFinite(checkedAt)) return { stale: false, blockers: ['creator_study_receipt_missing_checked_at'] };
  if (checkedAt > now) return { stale: false, blockers: [`creator_study_receipt_checked_at_in_future:${receipt.checked_at}`] };
  const ageMs = now - checkedAt;
  if (ageMs > MAX_SECONDS * 1000) return { stale: true, blockers: ['creator_study_receipt_too_old'] };
  return { stale: false, blockers: [] };
}

function evaluateReceipt(receipt) {
  const blockers = [];
  const now = Date.now();
  const freshness = resolveFreshness(receipt, now);
  blockers.push(...freshness.blockers);

  const duration = Number(receipt?.duration_seconds);
  if (!Number.isFinite(duration) || duration < 0 || duration > MAX_SECONDS) blockers.push('creator_study_receipt_invalid_duration');

  const unaided = boolValue(receipt?.unaided)
    || receipt?.assistance === 'unaided'
    || toStringOrNull(receipt?.assistance?.mode) === 'unaided'
    || toStringOrNull(receipt?.mode) === 'unaided'
    || toStringOrNull(receipt?.assistanceMode) === 'unaided';
  if (!unaided) blockers.push('creator_study_receipt_not_unaided');

  const packageRecord = receipt?.package ?? receipt?.package_record ?? receipt?.package_record_json;
  const explicitPackageValidity = [
    receipt?.package_valid,
    receipt?.valid_package,
    receipt?.packageValid,
  ].find((value) => typeof value === 'boolean');
  const validPackage = typeof explicitPackageValidity === 'boolean'
    ? explicitPackageValidity
    : boolValue(packageRecord?.valid)
      || boolValue(packageRecord?.is_valid)
      || boolValue(packageRecord?.validPackage);
  if (!validPackage) blockers.push('creator_study_receipt_invalid_package');

  const installOpened = boolValue(receipt?.install_opened)
    || boolValue(receipt?.installOpened)
    || boolValue(receipt?.install?.opened)
    || boolValue(receipt?.installation?.opened);
  if (!installOpened) blockers.push('creator_study_receipt_install_not_opened');

  const provenance = receipt?.provenance;
  const hasProvenance = boolValue(provenance)
    || (typeof provenance === 'object' && provenance !== null && (toStringOrNull(provenance.actor) || toStringOrNull(provenance.reason)))
    || boolValue(receipt?.source_provenance);
  if (!hasProvenance) blockers.push('creator_study_receipt_missing_provenance');

  const proof = toStringOrNull(receipt?.proof);
  if (!proof) blockers.push('creator_study_receipt_missing_proof');

  return {
    status: blockers.length ? 'BLOCKED' : 'PASS',
    blockers,
    checks: {
      proof,
      checked_at: receipt?.checked_at,
      within_600_seconds: !freshness.stale,
      duration_seconds: Number.isFinite(duration) ? duration : null,
      unaided,
      valid_package: validPackage,
      install_opened: installOpened,
      provenance_present: hasProvenance,
    },
  };
}

function main() {
  const receipt = parseJson(RECEIPT_PATH);
  if (!receipt) {
    fail('creator study receipt missing', ['creator_study_receipt_missing']);
    return;
  }

  const result = evaluateReceipt(receipt);
  const evidence = {
    proof: 'utopia_creator_study_receipt_check',
    checked_at: new Date().toISOString(),
    git: currentGit(root),
    status: result.status === 'PASS' ? 'passed' : 'blocked',
    blockers: result.blockers,
    payload: {
      status: result.status,
      checks: result.checks,
      receipt_path: relative(root, RECEIPT_PATH),
      output_path: relative(root, OUTPUT_PATH),
    },
  };

  mkdirSync(resolve(OUTPUT_PATH, '..'), { recursive: true });
  writeFileSync(OUTPUT_PATH, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');

  console.log(`Creator study receipt check: ${result.status}`);
  console.log(`CREATOR_STUDY_RECEIPT=${result.status}`);
  if (result.status === 'BLOCKED') {
    console.log(`BLOCKER=${result.blockers.join(',')}`);
    process.exitCode = 1;
  }
}

main();
