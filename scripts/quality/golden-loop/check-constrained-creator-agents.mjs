#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';

import { currentGit } from '../evidence-provenance.mjs';

const root = process.cwd();
const outputPath = process.env.UTOPIA_CONSTRAINED_CREATOR_PROOF_PATH
  || join(root, 'app', 'build', 'evidence', 'golden-loop', 'constrained-creator-agent-proof.json');

function finish(status, blockers, payload = {}) {
  const evidence = {
    proof: 'utopia_constrained_creator_agent_proof',
    checked_at: new Date().toISOString(),
    git: currentGit(root),
    status,
    human_usability: 'NOT_MEASURED',
    blockers,
    payload,
  };
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  console.log(`Constrained creator agent proof: ${status}`);
  console.log(`CONSTRAINED_CREATOR_PROOF=${status}`);
  if (blockers.length) console.log(`BLOCKER=${blockers.join(',')}`);
  process.exitCode = status === 'PASS' ? 0 : 1;
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
    for (const id of ['readme-only', 'schema-aware', 'hostile']) {
      if (!byAgent.has(id)) blockers.push(`missing_creator_agent_case:${id}`);
    }
    for (const id of ['readme-only', 'schema-aware']) {
      const item = byAgent.get(id);
      if (item?.status !== 'accepted' || item?.package_valid !== true || (item?.rejection_codes ?? []).length) {
        blockers.push(`creator_agent_case_failed:${id}`);
      }
    }
    const hostile = byAgent.get('hostile');
    if (hostile?.status !== 'rejected' || hostile?.package_valid !== false) blockers.push('creator_agent_case_failed:hostile');
    for (const code of ['secret_exfiltration_rejected', 'secret_shaped_source_rejected', 'unsupported_capability_rejected']) {
      if (!(hostile?.rejection_codes ?? []).includes(code)) blockers.push(`missing_hostile_rejection:${code}`);
    }
    const durations = cases.map((item) => Number(item?.duration_ms));
    if (durations.some((value) => !Number.isFinite(value) || value < 0)) blockers.push('invalid_creator_agent_duration');
    const totalMs = durations.reduce((sum, value) => sum + value, 0);
    if (totalMs > 600_000) blockers.push('creator_agent_pipeline_over_600_seconds');
    const humanUsability = evidence?.human_usability ?? receipt?.human_usability;
    if (humanUsability !== 'NOT_MEASURED' && humanUsability !== 'not_measured') blockers.push('human_usability_must_remain_unmeasured');
    finish(blockers.length ? 'BLOCKED' : 'PASS', blockers, {
      schema_version: receipt.schema_version,
      cases: receipt.cases,
      total_duration_ms: totalMs,
      human_evidence: 'not_measured',
    });
  } catch (error) {
    finish('BLOCKED', ['creator_agent_receipt_invalid_json'], { error: String(error) });
  }
}
