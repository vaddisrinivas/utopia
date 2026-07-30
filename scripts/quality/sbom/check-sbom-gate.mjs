#!/usr/bin/env node
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(process.env.QUALITY_GATE_ROOT?.trim() || process.cwd());
const outputPrefix = 'SBOM_GATE_JSON=';
const policyPath = resolve(root, process.env.SBOM_GATE_POLICY_PATH?.trim() || 'scripts/quality/sbom/sbom-policy.json');
const sbomPath = process.env.RELEASE_SBOM_PATH?.trim() || 'app/build/evidence/sbom.json';
const syftCommand = process.env.SYFT_CMD?.trim() || 'syft';
const syftArgs = parseArgs(process.env.SYFT_ARGS?.trim() || '. -o cyclonedx-json');

function readJson(path) {
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
    failures.push(`sbom_generator_invocation_failed:${commandResult.error.message}`);
    return null;
  }
  if (commandResult.status !== 0) {
    failures.push(`sbom_generator_exit_code:${commandResult.status}`);
  }
  return {
    output: commandResult.stdout ?? '',
    stderr: commandResult.stderr ?? '',
    status: commandResult.status ?? 0,
  };
}

const failures = [];
const warnings = [];

if (!existsSync(policyPath)) {
  failures.push(`missing:${relative(root, policyPath)}`);
}

if (!existsSync(resolve(root, 'docs/operations-observability.md'))) {
  failures.push('missing:docs/operations-observability.md');
}

let policy = null;
if (existsSync(policyPath)) {
  try {
    policy = readJson(policyPath);
  } catch {
    failures.push('sbom_policy_invalid_json');
  }
}

let sbom = null;
const resolvedSbomPath = resolve(root, sbomPath);
const syftResult = runCommand(syftCommand, syftArgs);

if (syftResult && syftResult.missingCommand) {
  failures.push(`sbom_tool_missing:${syftCommand}`);
}
if (syftResult && !syftResult.missingCommand) {
  const syftOutput = String(syftResult.output ?? '').trim();
  if (syftOutput.length > 0) {
    try {
      sbom = JSON.parse(syftOutput);
      mkdirSync(dirname(resolvedSbomPath), { recursive: true });
      writeFileSync(resolvedSbomPath, `${JSON.stringify(sbom)}\n`);
    } catch {
      failures.push('sbom_invalid_json');
    }
  } else {
    failures.push('sbom_output_missing:syft_stdout');
  }
}

if (sbom) {
  if (!sbom?.bomFormat || !sbom?.specVersion || !Array.isArray(sbom?.components)) {
    failures.push('sbom_missing_required_fields');
  } else if (sbom.components.length === 0) {
    warnings.push('sbom_has_no_components');
  }
}

if (policy && typeof policy.format === 'string' && policy.format.toLowerCase() !== 'cyclonedx') {
  warnings.push('sbom_policy_format_unexpected');
}

const payload = {
  proof: 'utopia_sbom_gate',
  checked_at: new Date().toISOString(),
  root,
  status: failures.length ? 'BLOCKED' : 'READY',
  blockers: failures,
  warnings,
  policy_path: relative(root, policyPath),
  sbom_path: sbomPath || null,
  policy,
  sbom_present: Boolean(sbom),
};

console.log(`${outputPrefix}${JSON.stringify(payload)}`);
if (failures.length > 0) {
  process.exit(1);
}
