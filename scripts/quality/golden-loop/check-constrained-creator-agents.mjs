#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';

import { currentGit } from '../evidence-provenance.mjs';

const root = process.cwd();
const outputPath = process.env.UTOPIA_CONSTRAINED_CREATOR_PROOF_PATH
  || join(root, 'app', 'build', 'evidence', 'golden-loop', 'constrained-creator-agent-proof.json');
const REQUIRED_AGENTS = ['dumb', 'moderate', 'hostile'];
const MAX_CASE_DURATION_MS = 600_000;

function finish(status, blockers, payload = {}) {
  const evidence = {
    proof: 'utopia_constrained_creator_agent_proof',
    checked_at: new Date().toISOString(),
    git: currentGit(root),
    status,
    human_usability: 'NOT_MEASURED',
    human_evidence: 'BLOCKED',
    blockers,
    payload,
  };
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  console.log(`Constrained creator agent proof: ${status}`);
  console.log(`CONSTRAINED_CREATOR_PROOF=${status}`);
  if (blockers.length) console.log(`BLOCKER=${blockers.join(',')}`);
  process.exitCode = status === 'AUTOMATED_AGENT_PASS' ? 0 : 1;
}

const tsx = join(root, 'node_modules', '.bin', 'tsx');
const result = spawnSync(tsx, ['--tsconfig', 'tsconfig.json', 'scripts/factory/run-creator-proof-harness.ts'], {
  cwd: root,
  encoding: 'utf8',
  maxBuffer: 4 * 1024 * 1024,
});
if (result.status !== 0) {
  finish('BLOCKED', ['creator_agent_harness_unavailable'], { output_tail: `${result.stdout ?? ''}${result.stderr ?? ''}`.slice(-2000) });
} else {
  try {
    const evidence = JSON.parse(readFileSync(outputPath, 'utf8'));
    const blockers = [];
    const receipt = evidence?.payload ?? evidence;
    const cases = Array.isArray(receipt?.cases) ? receipt.cases : [];
    const byAgent = new Map(cases.map((item) => [item?.agent, item]));
    if (receipt?.status !== 'AUTOMATED_AGENT_PASS') blockers.push('creator_agent_automation_status_missing');
    if (receipt?.human_evidence !== 'BLOCKED') blockers.push('human_evidence_must_remain_blocked');
    for (const id of REQUIRED_AGENTS) {
      if (!byAgent.has(id)) blockers.push(`missing_creator_agent_case:${id}`);
    }
    for (const id of ['dumb', 'moderate']) {
      const item = byAgent.get(id);
      if (item?.status !== 'accepted' || item?.package_valid !== true || (item?.rejection_codes ?? []).length) {
        blockers.push(`creator_agent_case_failed:${id}`);
      }
      if (item?.checks?.schema !== 'passed') blockers.push(`creator_agent_schema_check_failed:${id}`);
      if (item?.checks?.compiler !== 'passed') blockers.push(`creator_agent_compiler_check_failed:${id}`);
      if (item?.checks?.install !== 'passed') blockers.push(`creator_agent_install_check_failed:${id}`);
    }
    const hostile = byAgent.get('hostile');
    if (hostile?.status !== 'rejected' || hostile?.package_valid !== false) blockers.push('creator_agent_case_failed:hostile');
    for (const code of ['secret_exfiltration_rejected', 'secret_shaped_source_rejected', 'code_execution_rejected', 'unsupported_capability_rejected']) {
      if (!(hostile?.rejection_codes ?? []).includes(code)) blockers.push(`missing_hostile_rejection:${code}`);
    }
    const durations = cases.map((item) => Number(item?.duration_ms));
    if (durations.some((value) => !Number.isFinite(value) || value < 0)) blockers.push('invalid_creator_agent_duration');
    const totalMs = durations.reduce((sum, value) => sum + value, 0);
    if (durations.some((value) => value > MAX_CASE_DURATION_MS)) blockers.push('creator_agent_case_over_600_seconds');
    if (totalMs > MAX_CASE_DURATION_MS) blockers.push('creator_agent_pipeline_over_600_seconds');
    for (const item of cases) {
      if (item?.workspace?.isolated !== true || item?.workspace?.cleaned !== true) blockers.push(`creator_agent_workspace_not_isolated:${item?.agent ?? 'unknown'}`);
      if (item?.workspace?.directFixtureCopy !== false) blockers.push(`creator_agent_fixture_copy_detected:${item?.agent ?? 'unknown'}`);
      const budget = item?.information_budget;
      if (!budget || Number(item?.workspace?.inputFilesRead) > Number(budget.maxFiles) || Number(item?.workspace?.inputBytesRead) > Number(budget.maxBytes)) {
        blockers.push(`creator_agent_information_budget_exceeded:${item?.agent ?? 'unknown'}`);
      }
    }
    const humanUsability = evidence?.human_usability ?? receipt?.human_usability;
    if (humanUsability !== 'NOT_MEASURED' && humanUsability !== 'not_measured') blockers.push('human_usability_must_remain_unmeasured');
    const status = blockers.length ? 'BLOCKED' : 'AUTOMATED_AGENT_PASS';
    finish(status, blockers, {
      schema_version: receipt.schema_version,
      cases: receipt.cases,
      total_duration_ms: totalMs,
      human_evidence: 'BLOCKED',
    });
  } catch (error) {
    finish('BLOCKED', ['creator_agent_receipt_invalid_json'], { error: String(error) });
  }
}
