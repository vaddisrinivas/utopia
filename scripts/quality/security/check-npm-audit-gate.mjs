#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(process.env.QUALITY_GATE_ROOT?.trim() || process.cwd());
const policyPath = resolve(root, process.env.NPM_AUDIT_GATE_POLICY_PATH?.trim() || 'scripts/quality/security/npm-audit-gate-policy.json');
const outputPrefix = 'NPM_AUDIT_GATE_JSON=';

const SEVERITY_ORDER = ['info', 'low', 'moderate', 'high', 'critical'];

function parseJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function sevAtLeast(actual, floor) {
  const current = SEVERITY_ORDER.indexOf(actual);
  const cutoff = SEVERITY_ORDER.indexOf(floor);
  return current >= cutoff;
}

function normalizedExceptions(policy) {
  const map = new Map();
  for (const item of policy.exceptions ?? []) {
    const key = `${item.name}::${item.severity}::${item.range}`;
    map.set(key, item);
    if (typeof item.range !== 'string') {
      throw new Error(`Policy exception range must be string: ${key}`);
    }
    if (typeof item.nodes !== 'undefined' && !Array.isArray(item.nodes)) {
      throw new Error(`Policy exception nodes must be array: ${key}`);
    }
  }
  return map;
}

let failures = [];
let warnings = [];

const policy = parseJson(policyPath);
const exceptions = normalizedExceptions(policy);
const severityFloor = policy.severityFloor ?? 'moderate';

const auditResult = spawnSync('npm', ['audit', '--omit=dev', '--json'], {
  cwd: root,
  encoding: 'utf8',
  maxBuffer: 80_000_000,
});

if (auditResult.error) {
  failures.push(`npm_audit_invocation_failed:${auditResult.error.message}`);
} else {
  const stdout = String(auditResult.stdout ?? '').trim();
  const stderr = String(auditResult.stderr ?? '').trim();
  try {
    const audit = JSON.parse(stdout);
    const vulnerabilities = Object.entries(audit.vulnerabilities ?? {});

    let matched = 0;
    const seenExceptions = new Set();

    for (const [name, item] of vulnerabilities) {
      if (!sevAtLeast(item.severity, severityFloor)) {
        continue;
      }
      const key = `${name}::${item.severity}::${item.range}`;
      if (exceptions.has(key)) {
        matched += 1;
        seenExceptions.add(key);
        continue;
      }
      failures.push(`untriaged_npm_audit:${name}:${item.severity}:${item.range}`);
    }

    const staleExceptions = [...exceptions.keys()].filter((key) => !seenExceptions.has(key));
    if (staleExceptions.length > 0) {
      warnings.push(`stale_audit_exceptions:${staleExceptions.length}`);
    }

    const payload = {
      proof: 'utopia_npm_audit_gate',
      checked_at: new Date().toISOString(),
      root,
      status: failures.length ? 'BLOCKED' : 'READY',
      blockers: failures,
      warnings,
      floor: severityFloor,
      triage_entries: exceptions.size,
      vulnerabilities_seen: vulnerabilities.length,
      vulnerabilities_match: matched,
      vulnerabilities_blocked: vulnerabilities.length - matched,
      audit_exit_code: auditResult.status ?? 0,
      policy_path: policyPath,
      stderr_tail: stderr.slice(-4096),
    };

    console.log(`${outputPrefix}${JSON.stringify(payload)}`);

    if (failures.length > 0) {
      process.exit(1);
    }
    process.exit(0);
  } catch (err) {
    failures.push(`npm_audit_invalid_json:${err.message}`);
  }
}

const payload = {
  proof: 'utopia_npm_audit_gate',
  checked_at: new Date().toISOString(),
  root,
  status: 'BLOCKED',
  blockers: failures,
  warnings,
  floor: severityFloor,
  triage_entries: 0,
  vulnerabilities_seen: 0,
  vulnerabilities_match: 0,
  vulnerabilities_blocked: 0,
  audit_exit_code: auditResult?.status ?? 1,
  policy_path: policyPath,
};

console.log(`${outputPrefix}${JSON.stringify(payload)}`);
process.exit(1);
