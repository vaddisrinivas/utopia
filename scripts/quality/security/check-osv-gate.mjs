#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(process.env.QUALITY_GATE_ROOT?.trim() || process.cwd());
const outputPrefix = 'OSV_GATE_JSON=';
const policyPath = resolve(root, process.env.OSV_GATE_POLICY_PATH?.trim() || 'scripts/quality/security/osv-gate-policy.json');
const reportPath = process.env.OSV_REPORT_PATH?.trim();
const scannerCommand = process.env.OSV_SCANNER_CMD?.trim() || 'osv-scanner';
const scannerArgs = parseArgs(process.env.OSV_SCANNER_ARGS?.trim() || '--recursive . --format json');

function parseJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function parseArgs(value) {
  return value.trim().length ? value.match(/(?:[^\s"]+|"[^"]*")+/g)?.map((token) => token.replace(/^"|"$/g, '')) ?? [] : [];
}

function runCommand(command, args) {
  const commandResult = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 100_000_000,
  });
  if (commandResult.error) {
    if (commandResult.error.code === 'ENOENT') {
      return {
        missingCommand: true,
        output: '',
      };
    }
    failures.push(`osv_scanner_invocation_failed:${commandResult.error.message}`);
    return null;
  }
  return {
    output: commandResult.stdout ?? '',
    stderr: commandResult.stderr ?? '',
    status: commandResult.status ?? 0,
  };
}

const failures = [];
const warnings = [];
let report = null;

const requiredArtifacts = [
  policyPath,
  resolve(root, 'docs/operations-observability.md'),
  resolve(root, 'docs/telemetry-and-privacy-contract.md'),
];

for (const file of requiredArtifacts) {
  if (!existsSync(file)) {
    failures.push(`missing:${relative(root, file)}`);
  }
}

let policy = null;
if (!failures.some((issue) => issue.startsWith('missing:scripts/quality/security/osv-gate-policy.json'))) {
  try {
    policy = parseJson(policyPath);
  } catch {
    failures.push('osv_policy_invalid_json');
  }
}

if (policy && policy.scanner?.name !== 'osv-scanner') {
  failures.push('osv_policy_scanner_mismatch');
}

if (!policy?.mode || !['report-only', 'dry-run'].includes(policy.mode)) {
  warnings.push('osv_policy_mode_not_strict');
}

const scannerResult = runCommand(scannerCommand, scannerArgs);
if (scannerResult && scannerResult.missingCommand) {
  failures.push(`osv_scanner_missing:${scannerCommand}`);
}
if (scannerResult && !scannerResult.missingCommand) {
  const findingsReported = scannerResult.status === 1;
  if (scannerResult.status !== 0 && !(policy?.mode === 'report-only' && findingsReported)) {
    failures.push(`osv_scanner_exit_code:${scannerResult.status}`);
  }
  if (findingsReported) warnings.push('osv_findings_reported');
  const scannerOutput = String(scannerResult.output ?? '').trim();
  if (scannerOutput.length > 0) {
    try {
      report = parseJsonFromText(scannerOutput);
      if (reportPath) {
        const resolvedReportPath = resolve(root, reportPath);
        mkdirSync(dirname(resolvedReportPath), { recursive: true });
        writeFileSync(resolvedReportPath, `${JSON.stringify(report)}\n`);
      }
      if (!Array.isArray(report.results) && !Array.isArray(report.vulns) && !Array.isArray(report.matches)) {
        warnings.push('osv_report_shape_unknown');
      }
    } catch {
      failures.push('osv_report_invalid_json');
    }
  } else if (!reportPath) {
    failures.push('osv_report_missing:scanner_stdout');
  } else {
    const resolvedReportPath = resolve(root, reportPath);
    if (!existsSync(resolvedReportPath)) {
      failures.push(`osv_report_missing:${relative(root, resolvedReportPath)}`);
    } else {
      try {
        const reportText = readFileSync(resolvedReportPath, 'utf8');
        report = parseJsonFromText(reportText);
        if (!Array.isArray(report.results) && !Array.isArray(report.vulns) && !Array.isArray(report.matches)) {
          warnings.push('osv_report_shape_unknown');
        }
      } catch {
        failures.push('osv_report_invalid_json');
      }
    }
  }
}

const payload = {
  proof: 'utopia_osv_gate',
  checked_at: new Date().toISOString(),
  root,
  report_path: reportPath ? relative(root, resolve(root, reportPath)) : null,
  policy_path: relative(root, policyPath),
  status: failures.length ? 'BLOCKED' : 'READY',
  blockers: failures,
  warnings,
  policy_present: Boolean(policy),
  scanner_present: Boolean(scannerResult && !scannerResult.missingCommand),
};

console.log(`${outputPrefix}${JSON.stringify(payload)}`);
if (failures.length > 0) {
  process.exit(1);
}

function parseJsonFromText(text) {
  const raw = text.toString().trim();
  if (!raw) throw new Error('empty');
  return JSON.parse(raw);
}
