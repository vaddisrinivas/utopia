#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root_dir"

node --input-type=module <<'NODE'
import { currentGit, readEvidence, validateEvidenceEnvelope } from './scripts/quality/evidence-provenance.mjs';

const root = process.cwd();
const relativePath = 'app/build/evidence/physical-device-release.json';
const evidence = readEvidence(root, relativePath);
const issues = [];

if (!evidence) {
  issues.push('physical_device_evidence_missing');
} else {
  const envelope = validateEvidenceEnvelope(root, relativePath, evidence, currentGit(root));
  issues.push(...envelope.issues);
  if (evidence.proof !== 'utopia_physical_device_release') issues.push('proof_mismatch');
  if (evidence.status !== 'passed') issues.push(`status_not_passed:${String(evidence.status)}`);
  if (!evidence.device || typeof evidence.device !== 'object') issues.push('device_summary_missing');
  if (evidence.device?.serial || evidence.device_serial) issues.push('device_serial_must_not_be_written');
  if (evidence.app?.installed !== true) issues.push('app_install_not_proved');
  if (evidence.app?.launch_verified !== true) issues.push('app_launch_not_proved');
  if (evidence.app?.basic_flow_verified !== true) issues.push('basic_flow_not_proved');
}

if (issues.length > 0) {
  console.error(`release-proof-physical-device: BLOCKED (${issues.join(', ')}; expected ${relativePath})`);
  process.exit(1);
}

console.log(`release-proof-physical-device: PASS (${relativePath})`);
NODE
