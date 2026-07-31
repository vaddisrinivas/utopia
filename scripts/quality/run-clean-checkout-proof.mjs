#!/usr/bin/env node

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

import { currentGit } from './evidence-provenance.mjs';

const DEFAULT_STAGE_TIMEOUT_MS = 15 * 60 * 1000;
const MAX_BUFFER_BYTES = 30 * 1024 * 1024;
const STDOUT_TAIL_BYTES = 6000;
const CLEAN_ENV_KEYS = [
  'CI',
  'FORCE_COLOR',
  'GITHUB_ACTIONS',
  'HOME',
  'LANG',
  'LC_ALL',
  'NO_COLOR',
  'PATH',
  'RUNNER_OS',
  'SHELL',
  'SYSTEMROOT',
  'TEMP',
  'TMP',
  'TMPDIR',
];

export const CLEAN_CHECKOUT_PROOF_ID = 'utopia_golden_loop_clean_checkout';
export const CLEAN_CHECKOUT_STAGES = [
  {
    id: 'pinned_gate_tooling',
    kind: 'required',
    command: ['npm', 'run', 'check:no-mutable-npx'],
  },
  {
    id: 'clean_npm_install',
    kind: 'required',
    command: ['npm', 'ci', '--no-audit', '--no-fund'],
  },
  {
    id: 'clean_npm_install_server',
    kind: 'required',
    command: ['npm', 'ci', '--prefix', 'server', '--no-audit', '--no-fund'],
  },
  {
    id: 'config_validate',
    kind: 'required',
    command: ['npm', 'run', 'config:validate'],
  },
  {
    id: 'typecheck',
    kind: 'required',
    command: ['npm', 'run', 'typecheck'],
  },
  {
    id: 'doctor',
    kind: 'required',
    command: ['npm', 'run', 'doctor'],
  },
  {
    id: 'golden_vertical',
    kind: 'required',
    command: ['npx', 'vitest', 'run', 'tests/platform/golden-loop.test.ts'],
  },
  {
    id: 'creator_factory',
    kind: 'required',
    command: ['npx', 'vitest', 'run', 'tests/platform/golden-loop-creator.test.ts'],
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
      'tests/platform/golden-loop-registry.test.ts',
      'tests/contracts/golden-loop-privacy.test.ts',
      'tests/contracts/telemetry.test.ts',
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
    id: 'security_audit',
    kind: 'required',
    command: ['npm', 'run', 'check:security:audit'],
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

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function tail(value) {
  return String(value ?? '').slice(-STDOUT_TAIL_BYTES);
}

function redactText(value, sourceRoot, checkoutRoot) {
  const sourcePattern = escapeRegExp(sourceRoot);
  const checkoutPattern = escapeRegExp(checkoutRoot);
  return String(value ?? '')
    .replace(new RegExp(sourcePattern, 'g'), '<source-root>')
    .replace(new RegExp(checkoutPattern, 'g'), '<clean-checkout>');
}

function hasExplicitBlocker(output) {
  return /\bBLOCKED\b|live_multi_device_status=BLOCKED|Conformance blocked|release_blocker:|blockers=\d+/i.test(String(output));
}

/**
 * @param {{ kind: string }} suite
 * @param {number} exitCode
 * @param {string} output
 * @param {string | null} signal
 * @param {boolean} timedOut
 */
export function classifyCleanCheckoutResult(suite, exitCode, output, signal = null, timedOut = false) {
  if (timedOut || signal) return suite.kind === 'required' ? 'FAIL' : 'BLOCKED';
  if (hasExplicitBlocker(output)) return 'BLOCKED';
  return exitCode === 0 ? 'PASS' : 'FAIL';
}

export function runCommand(command, args, options = {}) {
  return spawnSync(command, args, {
    encoding: 'utf8',
    maxBuffer: MAX_BUFFER_BYTES,
    ...options,
  });
}

/** @returns {Record<string, string>} */
export function buildCleanCheckoutEnvironment(npmCacheRoot) {
  const env = {};
  for (const key of CLEAN_ENV_KEYS) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  env.NPM_CONFIG_CACHE = npmCacheRoot;
  env.npm_config_cache = npmCacheRoot;
  return env;
}

function runCommandInCheckout(params) {
  const {
    workingDir,
    suite,
    commandTimeoutMs,
    runner,
    npmCacheRoot,
    sourceRoot,
    checkoutRoot,
  } = params;
  const startedAt = Date.now();
  const result = runner(suite.command[0], suite.command.slice(1), {
    cwd: workingDir,
    env: buildCleanCheckoutEnvironment(npmCacheRoot),
    killSignal: 'SIGTERM',
    timeout: commandTimeoutMs,
    maxBuffer: MAX_BUFFER_BYTES,
  });

  const stdout = redactText(result.stdout ?? '', sourceRoot, checkoutRoot);
  const stderr = redactText(result.stderr ?? '', sourceRoot, checkoutRoot);
  const output = `${stdout}${stderr}`;
  const timedOut = result.error?.code === 'ETIMEDOUT';
  const status = classifyCleanCheckoutResult(
    suite,
    result.status ?? 1,
    output,
    result.signal ?? null,
    timedOut,
  );

  return {
    id: suite.id,
    kind: suite.kind,
    command: suite.command.join(' '),
    status,
    exit_code: result.status ?? 1,
    signal: result.signal ?? null,
    timed_out: timedOut,
    duration_ms: Date.now() - startedAt,
    stdout_tail: tail(stdout),
    stderr_tail: tail(stderr),
    execution_error: result.error ? {
      code: result.error.code,
      message: redactText(String(result.error.message ?? ''), sourceRoot, checkoutRoot),
    } : null,
  };
}

export function runCleanCheckoutStages(stages, options = {}) {
  const {
    workingDir,
    sourceRoot,
    checkoutRoot,
    commandTimeoutMs = DEFAULT_STAGE_TIMEOUT_MS,
    runner = runCommand,
    npmCacheRoot,
  } = options;

  const results = [];
  for (const suite of stages) {
    const result = runCommandInCheckout({
      workingDir,
      suite,
      sourceRoot,
      checkoutRoot,
      commandTimeoutMs,
      runner,
      npmCacheRoot,
    });
    results.push(result);
  }

  return { results };
}

export function runCleanCheckoutProof(options = {}) {
  const {
    sourceRoot = process.cwd(),
    stages = CLEAN_CHECKOUT_STAGES,
    commandRunner = runCommand,
    commandTimeoutMs = DEFAULT_STAGE_TIMEOUT_MS,
    outDir = join(sourceRoot, 'app', 'build', 'evidence', 'golden-loop', 'clean-checkout'),
    skipCheckout = false,
    checkoutRoot: explicitCheckoutRoot = null,
    runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}`,
  } = options;

  const stamp = runId;
  const evidencePath = join(outDir, `clean-checkout-proof-${stamp}.json`);
  const summaryPath = evidencePath;
  const evidencePathRelative = relative(sourceRoot, evidencePath);
  const summary = {
    proof: CLEAN_CHECKOUT_PROOF_ID,
    run_id: stamp,
    checked_at: new Date().toISOString(),
    git: null,
    source_git: null,
    status: 'RUNNING',
    evidence_path: evidencePathRelative,
    results: [],
    failures: [],
    blockers: [],
    no_secret_values_written: true,
  };

  const toWrite = () => writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');

  let tempRoot = null;
  let checkoutRoot = explicitCheckoutRoot;
  const cleanupPaths = [];
  let failed = false;

  try {
    summary.source_git = currentGit(sourceRoot);
    summary.git = summary.source_git;
    mkdirSync(outDir, { recursive: true });
    toWrite();

    if (!skipCheckout) {
      if (!sourceRoot) throw new Error('missing sourceRoot');
      if (summary.source_git.dirty) {
        summary.status = 'BLOCKED';
        summary.blockers.push('dirty_source_tree');
        summary.completed_at = new Date().toISOString();
        toWrite();
        return summary;
      }
      tempRoot = mkdtempSync(join(tmpdir(), 'utopia-golden-loop-clean-'));
      checkoutRoot = join(tempRoot, 'repo');
      const npmCacheRoot = join(tempRoot, 'npm-cache');
      const clone = commandRunner('git', ['clone', '--local', '--depth=1', sourceRoot, checkoutRoot], {
        cwd: sourceRoot,
        env: buildCleanCheckoutEnvironment(npmCacheRoot),
      });
      if (clone.status !== 0) {
        failed = true;
        summary.status = 'FAIL';
        summary.failures.push('clean_checkout');
        summary.blockers.push(`checkout_failed:${clone.error?.code ?? 'unknown'}`);
      }
      if (failed) {
        toWrite();
        return summary;
      }
      cleanupPaths.push(tempRoot);
    }

    if (!checkoutRoot) throw new Error('missing checkoutRoot');
    const npmCacheRoot = tempRoot
      ? join(tempRoot, 'npm-cache')
      : join(tmpdir(), `utopia-clean-checkout-cache-${process.pid}`);
    try {
      const runResult = runCleanCheckoutStages(stages, {
        workingDir: checkoutRoot,
        sourceRoot,
        checkoutRoot,
        commandTimeoutMs,
        runner: commandRunner,
        npmCacheRoot,
      });
      summary.results = runResult.results;
      summary.git = currentGit(checkoutRoot);

      summary.failures = summary.results
        .filter((record) => record.status === 'FAIL')
        .map((record) => record.id);
      summary.blockers = summary.results
        .filter((record) => record.status === 'BLOCKED')
        .map((record) => record.id);

      summary.status = summary.failures.length
        ? 'FAIL'
        : summary.blockers.length
          ? 'BLOCKED'
          : 'PASS';
    } catch (error) {
      summary.status = 'FAIL';
      summary.failures.push('runner_exception');
      summary.execution_error = {
        message: redactText(String(error instanceof Error ? error.message : error), sourceRoot, checkoutRoot),
      };
    }

    summary.completed_at = new Date().toISOString();
    toWrite();
    if (summary.failures.length) {
      console.log(`CLEAN_CHECKOUT_GOLDEN_LOOP=${summary.status} failures=${summary.failures.join(',')}`);
    } else if (summary.blockers.length) {
      console.log(`CLEAN_CHECKOUT_GOLDEN_LOOP=${summary.status} blockers=${summary.blockers.join(',')}`);
    } else {
      console.log(`CLEAN_CHECKOUT_GOLDEN_LOOP=PASS evidence=${summary.evidence_path}`);
    }
  } finally {
    for (const pathToDelete of cleanupPaths) {
      rmSync(pathToDelete, { recursive: true, force: true });
    }
  }

  return summary;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const summary = runCleanCheckoutProof();
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  process.exitCode = summary.status === 'PASS' ? 0 : 1;
}
