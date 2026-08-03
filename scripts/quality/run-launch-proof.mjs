#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { currentGit } from './evidence-provenance.mjs';

const root = process.cwd();
const stamp = new Date().toISOString().replace(/[.:]/g, '-');
const outDir = join(root, 'app', 'build', 'evidence', 'launch-proof', stamp);
const outPath = join(outDir, 'summary.json');

export const LAUNCH_PROOF_SUITES = [
  { id: 'pinned_gate_tooling', command: ['npm', 'run', 'check:no-mutable-npx'], kind: 'required' },
  { id: 'launch_contract', command: ['npm', 'run', 'check:launch-readiness'], kind: 'required' },
  { id: 'config', command: ['npm', 'run', 'config:validate'], kind: 'required' },
  { id: 'typecheck', command: ['npm', 'run', 'typecheck'], kind: 'required' },
  { id: 'doctor', command: ['npm', 'run', 'doctor'], kind: 'required' },
  { id: 'package_compiler', command: ['npm', 'run', 'check:package-compiler'], kind: 'required' },
  { id: 'conformance', command: ['npm', 'run', 'check:conformance'], kind: 'evidence' },
  { id: 'osv_security', command: ['npm', 'run', 'check:security:osv'], kind: 'required' },
  { id: 'npm_audit_gate', command: ['npm', 'run', 'check:security:audit'], kind: 'required' },
  { id: 'sbom', command: ['npm', 'run', 'check:sbom'], kind: 'required' },
  { id: 'chat_send', command: ['npm', 'run', 'phase3:check:chat-send'], kind: 'required' },
  { id: 'chat_rollback', command: ['npm', 'run', 'phase3:check:chat-rollback-idempotency'], kind: 'required' },
  { id: 'web_export', command: ['npm', 'run', 'export:web'], kind: 'required' },
  { id: 'android_export', command: ['npm', 'run', 'export:android'], kind: 'required' },
  { id: 'shared_state_sync', command: ['npm', 'run', 'check:shared-state-sync'], kind: 'required' },
  { id: 'sync_transport', command: ['node', 'scripts/quality/check-sync-transport.mjs'], kind: 'required' },
  { id: 'provider_readiness', command: ['npm', 'run', 'check:live-provider-readiness'], kind: 'evidence' },
  { id: 'emulator_sync', command: ['node', 'scripts/quality/check-emulator-sync-proof.mjs'], kind: 'evidence' },
  { id: 'multi_surface_sync', command: ['node', 'scripts/quality/check-multi-surface-sync-proof.mjs'], kind: 'evidence' },
];

export function classifyLaunchProofResult(suite, exitCode, output) {
  if (suite.id === 'launch_contract' && hasOnlyReleaseBlockers(output)) return 'BLOCKED';
  if (/\bBLOCKED\b|live_multi_device_status=BLOCKED|LIVE_PROVIDER_READINESS_JSON|Conformance blocked/.test(output)) {
    return 'BLOCKED';
  }
  if (exitCode === 0) return 'PASS';
  return 'FAIL';
}

function hasOnlyReleaseBlockers(output) {
  const failures = output.match(/"failures"\s*:\s*\[([\s\S]*?)\]/);
  if (!failures) return false;
  const reasons = [...failures[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  return reasons.length > 0 && reasons.every((reason) => reason.startsWith('release_blocker:'));
}

function tail(value) {
  return String(value ?? '').slice(-6000);
}

function write(summary) {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(summary, null, 2)}\n`);
}

function run() {
  const summary = {
    proof: 'utopia_launch_proof',
    checked_at: new Date().toISOString(),
    git: currentGit(root),
    status: 'RUNNING',
    evidence_path: outPath,
    results: [],
    no_secret_values_written: true,
  };
  write(summary);

  for (const suite of LAUNCH_PROOF_SUITES) {
    process.stdout.write(`\n[launch-proof] ${suite.id}\n`);
    const result = spawnSync(suite.command[0], suite.command.slice(1), {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, NPM_CONFIG_CACHE: process.env.NPM_CONFIG_CACHE || '/tmp/utopia-npm-cache' },
      maxBuffer: 1024 * 1024 * 20,
    });
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
    const record = {
      id: suite.id,
      kind: suite.kind,
      command: suite.command.join(' '),
      status: classifyLaunchProofResult(suite, result.status ?? 1, output),
      exit_code: result.status ?? 1,
      signal: result.signal ?? null,
      stdout_tail: tail(result.stdout),
      stderr_tail: tail(result.stderr),
    };
    summary.results.push(record);
    write(summary);
    process.stdout.write(`[launch-proof] ${record.status} ${suite.id}\n`);
  }

  const failures = summary.results.filter((record) => record.status === 'FAIL').map((record) => record.id);
  const blockers = summary.results.filter((record) => record.status === 'BLOCKED').map((record) => record.id);
  summary.status = failures.length ? 'FAIL' : (blockers.length ? 'BLOCKED' : 'PASS');
  summary.failures = failures;
  summary.blockers = blockers;
  summary.completed_at = new Date().toISOString();
  write(summary);

  console.log(`LAUNCH_PROOF=${summary.status} evidence=${outPath}`);
  if (blockers.length) console.log(`BLOCKERS=${blockers.join(',')}`);
  if (failures.length) console.log(`FAILURES=${failures.join(',')}`);
  process.exitCode = summary.status === 'PASS' ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}`) run();
