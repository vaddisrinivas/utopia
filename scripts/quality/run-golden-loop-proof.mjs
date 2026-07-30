#!/usr/bin/env node

import { mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

import { currentGit } from './evidence-provenance.mjs';

const root = process.cwd();
const outDir = join(root, 'app', 'build', 'evidence', 'golden-loop');
const outPath = join(outDir, 'golden-loop-proof.json');
const configuredTimeout = Number.parseInt(process.env.GOLDEN_LOOP_SUITE_TIMEOUT_MS ?? '', 10);
const suiteTimeoutMs = Number.isFinite(configuredTimeout) && configuredTimeout > 0
  ? configuredTimeout
  : 15 * 60 * 1000;
const maxBufferBytes = 30 * 1024 * 1024;

export const GOLDEN_LOOP_SUITES = [
  {
    id: 'golden_vertical',
    kind: 'required',
    command: ['npx', 'vitest', 'run', 'tests/platform/golden-loop.test.ts'],
  },
  {
    id: 'core_boundary',
    kind: 'required',
    command: ['node', 'scripts/quality/check-core-boundaries.mjs'],
  },
  {
    id: 'core_ports',
    kind: 'required',
    command: ['npm', 'run', 'check:core-port-boundaries'],
  },
  {
    id: 'creator_factory',
    kind: 'required',
    command: [
      'npx',
      'vitest',
      'run',
      'tests/platform/github-app-factory.test.ts',
      'tests/platform/app-factory-examples.test.ts',
      'tests/platform/golden-loop-creator.test.ts',
    ],
  },
  {
    id: 'creator_study',
    kind: 'evidence',
    command: ['node', 'scripts/quality/golden-loop/check-creator-study-receipt.mjs'],
  },
  {
    id: 'install_trust',
    kind: 'required',
    command: [
      'npx',
      'vitest',
      'run',
      'tests/domain/package-install.test.ts',
      'tests/domain/extension-trust.test.ts',
      'tests/db/capability-consent-ledger.test.ts',
    ],
  },
  {
    id: 'registry_privacy',
    kind: 'required',
    command: [
      'npx',
      'vitest',
      'run',
      'tests/platform/registry-worker.test.ts',
      'tests/platform/golden-loop-registry.test.ts',
      'tests/contracts/telemetry.test.ts',
      'tests/contracts/golden-loop-privacy.test.ts',
    ],
  },
  {
    id: 'local_sync_contract',
    kind: 'required',
    command: ['npx', 'vitest', 'run', 'tests/providers/golden-loop-sync.test.ts'],
  },
  {
    id: 'local_runtime_code',
    kind: 'required',
    command: ['node', 'scripts/quality/check-golden-loop-runtime-code.mjs'],
  },
  {
    id: 'local_guarantees',
    kind: 'required',
    command: ['node', 'scripts/quality/run-golden-loop-local-guarantees.mjs'],
  },
  {
    id: 'network_sync_transport',
    kind: 'required',
    command: ['npm', 'run', 'check:reference-sync-transport'],
  },
  {
    id: 'clean_checkout',
    kind: 'evidence',
    command: ['npm', 'run', 'check:clean-checkout'],
  },
  {
    id: 'proof_contracts',
    kind: 'required',
    command: [
      'npx',
      'vitest',
      'run',
      'tests/quality/golden-loop-proof.test.ts',
      'tests/quality/golden-loop-creator-receipt.test.ts',
      'tests/quality/golden-loop-multi-surface-receipts.test.ts',
    ],
  },
  {
    id: 'security_audit',
    kind: 'required',
    command: ['npm', 'run', 'check:security:audit'],
  },
  {
    id: 'cross_runtime_conformance',
    kind: 'evidence',
    command: ['npm', 'run', 'check:conformance'],
  },
  {
    id: 'multi_surface_execution',
    kind: 'evidence',
    command: ['npm', 'run', 'check:multi-surface-sync'],
  },
  {
    id: 'multi_surface_receipts',
    kind: 'evidence',
    command: ['node', 'scripts/quality/golden-loop/check-multi-surface-receipts.mjs'],
  },
  {
    id: 'web_export',
    kind: 'required',
    command: ['npm', 'run', 'export:web'],
  },
  {
    id: 'android_export',
    kind: 'required',
    command: ['npm', 'run', 'export:android'],
  },
];

/**
 * @param {{ id?: string; kind: string }} suite
 * @param {number} exitCode
 * @param {string} output
 * @param {string | null} [signal]
 * @param {boolean} [timedOut]
 */
export function classifyGoldenLoopResult(suite, exitCode, output, signal = null, timedOut = false) {
  if (timedOut || signal) return suite.kind === 'required' ? 'FAIL' : 'BLOCKED';
  if (suite.id === 'launch_readiness' && hasOnlyReleaseBlockers(output)) return 'BLOCKED';
  const explicitlyBlocked =
    /\bBLOCKED\b|live_multi_device_status=BLOCKED|Conformance blocked/i.test(output)
    || /\bblockers=[1-9]\d*\b/i.test(output);
  if (explicitlyBlocked) return 'BLOCKED';
  if (exitCode === 0) return 'PASS';
  return suite.kind === 'evidence' && /\bblocker[:=_]/i.test(output) ? 'BLOCKED' : 'FAIL';
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
  writeFileSync(outPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
}

function run() {
  const summary = {
    proof: 'utopia_golden_loop.v1',
    run_id: `${Date.now()}-${process.pid}`,
    checked_at: new Date().toISOString(),
    git: currentGit(root),
    status: 'RUNNING',
    local_platform_status: 'RUNNING',
    evidence_path: outPath,
    app: {
      id: 'shared-household-board',
      source: 'tests/fixtures/golden-loop/shared-household-board.source.json',
      app_specific_runtime_code: false,
    },
    results: [],
    failures: [],
    blockers: [],
    no_secret_values_written: true,
  };
  write(summary);

  for (const suite of GOLDEN_LOOP_SUITES) {
    process.stdout.write(`\n[golden-loop] ${suite.id}\n`);
    const startedAt = Date.now();
    const result = spawnSync(suite.command[0], suite.command.slice(1), {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        NPM_CONFIG_CACHE: process.env.NPM_CONFIG_CACHE || '/tmp/utopia-npm-cache',
      },
      timeout: suiteTimeoutMs,
      killSignal: 'SIGTERM',
      maxBuffer: maxBufferBytes,
    });
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
    const timedOut = result.error?.code === 'ETIMEDOUT';
    const record = {
      id: suite.id,
      kind: suite.kind,
      command: suite.command.join(' '),
      status: classifyGoldenLoopResult(
        suite,
        result.status ?? 1,
        output,
        result.signal ?? null,
        timedOut,
      ),
      exit_code: result.status ?? 1,
      signal: result.signal ?? null,
      timed_out: timedOut,
      timeout_ms: suiteTimeoutMs,
      duration_ms: Date.now() - startedAt,
      stdout_tail: tail(result.stdout),
      stderr_tail: tail(result.stderr),
      execution_error: result.error
        ? {
            code: result.error.code,
            message: String(result.error.message ?? ''),
          }
        : null,
    };
    summary.results.push(record);
    write(summary);
    process.stdout.write(`[golden-loop] ${record.status} ${suite.id}\n`);
  }

  summary.failures = summary.results
    .filter((record) => record.status === 'FAIL')
    .map((record) => record.id);
  summary.blockers = summary.results
    .filter((record) => record.status === 'BLOCKED')
    .map((record) => record.id);
  const requiredFailures = summary.results
    .filter((record) => record.kind === 'required' && record.status !== 'PASS')
    .map((record) => record.id);
  summary.local_platform_status = requiredFailures.length === 0 ? 'PASS' : 'FAIL';
  summary.status = summary.failures.length > 0
    ? 'FAIL'
    : summary.blockers.length > 0 ? 'BLOCKED' : 'PASS';
  summary.completed_at = new Date().toISOString();
  write(summary);

  console.log(`GOLDEN_LOOP=${summary.status} local_platform=${summary.local_platform_status} evidence=${outPath}`);
  if (summary.blockers.length) console.log(`BLOCKERS=${summary.blockers.join(',')}`);
  if (summary.failures.length) console.log(`FAILURES=${summary.failures.join(',')}`);
  process.exitCode = summary.status === 'PASS' ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}`) run();
