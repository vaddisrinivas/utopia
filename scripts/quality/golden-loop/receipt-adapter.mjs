#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

import { currentGit, validateEvidenceEnvelope } from '../evidence-provenance.mjs';
import { validateShellProofReceipt } from './shell-proof-protocol.mjs';

export const REQUIRED_SCENARIO_ID = 'convergence-conflict-rollback-v1';

export function resolveRootPath(root, relativeOrAbsolutePath) {
  return isAbsolute(relativeOrAbsolutePath) ? relativeOrAbsolutePath : join(root, relativeOrAbsolutePath);
}

export function readJson(relativeOrAbsolutePath, root = process.cwd()) {
  const absolutePath = resolveRootPath(root, relativeOrAbsolutePath);
  return JSON.parse(readFileSync(absolutePath, 'utf8'));
}

function asChecksum(value) {
  if (typeof value !== 'string' || value.length === 0) return null;
  const trimmed = value.trim();
  return /^sha256:[a-f0-9]{64}$/i.test(trimmed) ? trimmed.toLowerCase() : null;
}

export function pickPackageChecksum(receipt) {
  const candidates = [
    receipt.package_checksum,
    receipt.package_hash,
    receipt.app?.package_checksum,
    receipt.app?.package_hash,
    receipt.execution?.package_checksum,
    receipt.execution?.package_hash,
    receipt.lifecycle?.package_checksum,
    receipt.lifecycle?.package_hash,
  ];
  for (const candidate of candidates) {
    const checksum = asChecksum(candidate);
    if (checksum) return checksum;
  }
  return null;
}

function pickRunId(receipt) {
  const candidates = [
    receipt.run_id,
    receipt.runId,
    receipt.source?.run_id,
    receipt.source?.runId,
    receipt.metadata?.run_id,
    receipt.metadata?.runId,
    receipt.execution?.run_id,
    receipt.execution?.runId,
    receipt.lifecycle?.run_id,
    receipt.lifecycle?.runId,
    receipt.shell_proof?.run_id,
    receipt.shell_proof?.runId,
    receipt.shell_proof?.metadata?.run_id,
    receipt.shell_proof?.metadata?.runId,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string') {
      const trimmed = candidate.trim();
      if (trimmed.length > 0) return trimmed;
    }
  }

  return null;
}

export function validateLifecycleScenario(receipt, label, requiredScenarioId = REQUIRED_SCENARIO_ID) {
  const blockers = [];
  const lifecycle = receipt?.lifecycle;
  if (!lifecycle || typeof lifecycle !== 'object' || Array.isArray(lifecycle)) {
    blockers.push(`missing_lifecycle:${label}`);
    return { blockers, scenario: null, assertions: null };
  }

  const scenario = lifecycle.scenario ?? lifecycle;
  if (!scenario || typeof scenario !== 'object' || Array.isArray(scenario)) {
    blockers.push(`missing_scenario_assertions:${label}`);
    return { blockers, scenario: null, assertions: null };
  }

  if (scenario.scenario_id !== requiredScenarioId) {
    blockers.push(`invalid_scenario_id:${label}:${scenario.scenario_id}`);
  }

  const assertions = scenario.assertions;
  if (!assertions || typeof assertions !== 'object' || Array.isArray(assertions)) {
    blockers.push(`missing_scenario_assertions:${label}`);
    return { blockers, scenario: null, assertions: null };
  }

  if (assertions.conflict_detected !== true) {
    blockers.push(`scenario_conflict_not_detected:${label}`);
  }
  if (!(Number(assertions.rollback_replayed_for_losers) >= 1)) {
    blockers.push(`scenario_rollback_replay_missing:${label}`);
  }
  if (assertions.convergence_replayed !== true) {
    blockers.push(`scenario_convergence_not_replayed:${label}`);
  }

  return {
    blockers,
    scenario,
    assertions,
  };
}

/**
 * @param {{
 *   root?: string;
 *   label?: string;
 *   path?: string;
 *   blockers?: string[];
 *   requireInstallationId?: boolean;
 *   requireChecksum?: boolean;
 *   requiredScenarioId?: string;
 *   requireShellProof?: boolean;
 *   requiredSourceSurface?: string | null;
 *   expectedGit?: ReturnType<typeof currentGit>;
 * }} options
 */
export function validateReceipt({
  root,
  label,
  path,
  blockers,
  requireInstallationId = false,
  requireChecksum = true,
  requiredScenarioId = REQUIRED_SCENARIO_ID,
  requireShellProof = false,
  requiredSourceSurface = null,
  expectedGit = null,
} = {}) {
  const normalizedRoot = root ?? process.cwd();
  const result = {
    requested_path: path,
    exists: false,
    proof: null,
    status: null,
    checked_at: null,
    pass: false,
    issues: [],
    checksum: null,
    envelope: null,
    installation_id: null,
    scenario: null,
    assertions: null,
    shell_proof: null,
    package_transition: null,
    run_id: null,
    durable_data_checksum: null,
    operation_ids: null,
    transport: null,
    convergence: null,
    source_surface: null,
  };

  const absolutePath = resolveRootPath(normalizedRoot, path);
  const blockList = Array.isArray(blockers) ? blockers : [];

  if (!existsSync(absolutePath)) {
    blockList.push(`missing:${label}_receipt`);
    result.issues.push('receipt_missing');
    return result;
  }

  let receipt;
  try {
    receipt = readJson(path, normalizedRoot);
  } catch (error) {
    blockList.push(`invalid:${label}_receipt_json`);
    result.issues.push(`parse_error:${error instanceof Error ? error.message : String(error)}`);
    return result;
  }

  result.exists = true;
  result.envelope = validateEvidenceEnvelope(
    normalizedRoot,
    path,
    receipt,
    expectedGit ?? currentGit(normalizedRoot),
  );
  if (!result.envelope.valid) {
    blockList.push(`invalid_envelope:${label}_receipt`);
    result.issues.push(...result.envelope.issues);
  }

  result.proof = typeof receipt.proof === 'string' ? receipt.proof : null;
  result.checked_at = typeof receipt.checked_at === 'string' ? receipt.checked_at : null;
  result.status = receipt.status ?? (receipt.pass === true ? 'passed' : 'failed');
  result.pass = receipt.status === 'passed' || receipt.status === 'PASS' || receipt.pass === true;
  if (!result.pass) blockList.push(`receipt_not_passed:${label}`);

  if (receipt.synthetic_plan_is_not_device_proof === true) {
    blockList.push(`synthetic_receipt:${label}`);
  }

  result.installation_id = typeof receipt.installation_id === 'string'
    ? receipt.installation_id
    : null;

  const { blockers: lifecycleBlockers, scenario, assertions } = validateLifecycleScenario(
    receipt,
    label,
    requiredScenarioId,
  );
  if (lifecycleBlockers.length) {
    blockList.push(...lifecycleBlockers);
  }
  result.scenario = scenario;
  result.assertions = assertions;

  const shellProof = validateShellProofReceipt(receipt, {
    root: normalizedRoot,
    label,
    path,
    requiredSourceSurface,
  });
  result.shell_proof = shellProof;
  const checksum = pickPackageChecksum(receipt) || shellProof.package?.checksum || null;
  if (!checksum && requireChecksum) {
    blockList.push(`missing_package_checksum:${label}`);
  } else if (checksum) {
    result.checksum = checksum;
  }
  if (!result.installation_id) {
    result.installation_id = shellProof.pass ? shellProof.installation_id : null;
  }
  result.package_transition = shellProof.pass ? {
    from: shellProof.package?.transition_from || null,
    to: shellProof.package?.transition_to || null,
    version: shellProof.package?.version || null,
    previous_version: shellProof.package?.previous_version || null,
    checksum: shellProof.package?.checksum || null,
  } : null;
  result.run_id = shellProof.pass
    ? (pickRunId(receipt) ?? pickRunId(shellProof))
    : pickRunId(receipt);
  result.durable_data_checksum = shellProof.pass ? shellProof.durable_data_checksum : null;
  result.operation_ids = shellProof.pass ? shellProof.operation_ids : null;
  result.transport = shellProof.pass ? shellProof.transport : null;
  result.convergence = shellProof.pass ? shellProof.convergence : null;
  result.source_surface = shellProof.pass ? shellProof.source_surface : null;

  if (requireInstallationId && !result.installation_id) {
    blockList.push(`missing_installation_id:${label}`);
  }

  if (requireShellProof && !shellProof.pass) {
    blockList.push('missing_or_blocked_shell_protocol');
    for (const blocker of shellProof.blockers) {
      blockList.push(`shell_protocol:${blocker}`);
    }
  }

  if (requireShellProof && shellProof.transport?.sync_claimed !== true && (shellProof.convergence?.operation_ids?.length ?? 0) > 0) {
    blockList.push('sync_claim_missing_transport_info');
  }

  result.pass = result.pass && blockList.length === 0;

  return result;
}
