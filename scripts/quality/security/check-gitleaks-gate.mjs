#!/usr/bin/env node
import { relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { writeSecurityArtifact } from './security-artifact.mjs';

const root = resolve(process.env.QUALITY_GATE_ROOT?.trim() || process.cwd());
const command = process.env.GITLEAKS_CMD?.trim() || 'gitleaks';
const args = (process.env.GITLEAKS_ARGS?.trim() || 'detect --source . --no-banner --report-format json --report-path -')
  .match(/(?:[^\s"]+|"[^"]*")+/g)?.map((token) => token.replace(/^"|"$/g, '')) ?? [];
const artifactPath = process.env.GITLEAKS_REPORT_PATH?.trim() || 'app/build/evidence/gitleaks-report.json';
const blockers = [];
let findings = [];
const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', maxBuffer: 100_000_000 });

if (result.error?.code === 'ENOENT') blockers.push(`gitleaks_missing:${command}`);
else if (result.error) blockers.push(`gitleaks_invocation_failed:${result.error.message}`);
else {
  const output = String(result.stdout || '').trim();
  if (!output) blockers.push('gitleaks_report_missing:scanner_stdout');
  else {
    try {
      const parsed = JSON.parse(output);
      findings = Array.isArray(parsed) ? parsed : parsed.findings;
      if (!Array.isArray(findings)) blockers.push('gitleaks_report_invalid_shape');
      else writeSecurityArtifact(root, artifactPath, {
        schemaVersion: 'utopia.security-artifact.v1',
        kind: 'gitleaks',
        findings,
      });
    } catch {
      blockers.push('gitleaks_report_invalid_json');
    }
  }
  if ((result.status ?? 0) !== 0) blockers.push(`gitleaks_findings_or_exit_code:${result.status ?? 1}`);
}

const payload = {
  proof: 'utopia_gitleaks_gate',
  checked_at: new Date().toISOString(),
  status: blockers.length ? 'BLOCKED' : 'READY',
  blockers,
  artifact_path: relative(root, resolve(root, artifactPath)),
  findings: findings.length,
  scanner_present: !result.error,
};
console.log(`GITLEAKS_GATE_JSON=${JSON.stringify(payload)}`);
if (blockers.length) process.exit(1);
