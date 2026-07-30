import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';

import { afterEach, describe, expect, it } from 'vitest';

import {
  CLEAN_CHECKOUT_STAGES,
  buildCleanCheckoutEnvironment,
  classifyCleanCheckoutResult,
  runCleanCheckoutProof,
} from '../../scripts/quality/run-clean-checkout-proof.mjs';

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function createTempRoot() {
  const root = mkdtempSync(join(process.cwd(), 'utopia-clean-checkout-proof-'));
  tempRoots.push(root);
  mkdirSync(root, { recursive: true });
  return root;
}

describe('clean-checkout proof harness', () => {
  it('only includes local required Golden stages', () => {
    const commandMap = CLEAN_CHECKOUT_STAGES.map((suite) => suite.command.join(' '));
    const allCommands = commandMap.join('\n');

    expect(commandMap).toContain('npm run config:validate');
    expect(commandMap).toContain('npm run typecheck');
    expect(commandMap).toContain('npm run doctor');
    expect(commandMap).toContain('npm run check:core-port-boundaries');
    expect(commandMap).toContain('npm run export:web');
    expect(commandMap).toContain('npm run export:android');
    expect(allCommands).not.toContain('release');
    expect(allCommands).not.toContain('physical');
    expect(allCommands).not.toContain('creator-study');
    expect(allCommands).not.toContain('adb');
  });

  it('classifies PASS/FAIL/BLOCKED distinctly', () => {
    expect(classifyCleanCheckoutResult({ kind: 'required' }, 0, 'PASS')).toBe('PASS');
    expect(classifyCleanCheckoutResult({ kind: 'required' }, 1, 'typecheck failed')).toBe('FAIL');
    expect(classifyCleanCheckoutResult({ kind: 'required' }, 0, 'BLOCKED=missing_receipt')).toBe('BLOCKED');
    expect(classifyCleanCheckoutResult({ kind: 'required' }, 0, 'BLOCKERS=1')).toBe('BLOCKED');
    expect(classifyCleanCheckoutResult({ kind: 'required' }, 0, 'PASS', 'SIGTERM')).toBe('FAIL');
  });

  it('does not forward API keys or service credentials to clean commands', () => {
    const previousOpenAiKey = process.env.OPENAI_API_KEY;
    const previousNotionToken = process.env.NOTION_TOKEN;
    process.env.OPENAI_API_KEY = 'not-forwarded';
    process.env.NOTION_TOKEN = 'not-forwarded';
    const env = buildCleanCheckoutEnvironment('/tmp/utopia-clean-cache');
    expect(env.PATH).toBe(process.env.PATH);
    expect(env.NPM_CONFIG_CACHE).toBe('/tmp/utopia-clean-cache');
    expect(env).not.toHaveProperty('OPENAI_API_KEY');
    expect(env).not.toHaveProperty('NOTION_TOKEN');
    if (previousOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousOpenAiKey;
    if (previousNotionToken === undefined) delete process.env.NOTION_TOKEN;
    else process.env.NOTION_TOKEN = previousNotionToken;
  });

  it('writes a redacted receipt with injected command runner', () => {
    const outDir = createTempRoot();
    const evidenceRoot = join(outDir, 'app', 'build', 'evidence', 'golden-loop', 'clean-checkout');
    const sourceRoot = process.cwd();
    const absoluteSource = sourceRoot;
    const outcomes = [
      { status: 0, stdout: `ok ${absoluteSource}/safe-path`, stderr: '' },
      { status: 0, stdout: 'ok', stderr: `bad-path ${absoluteSource}/safe-path` },
      { status: 1, stdout: `BLOCKED ${absoluteSource}/safe-path`, stderr: '' },
    ];
    let i = 0;
    const runner = () => {
      const current = outcomes[i] ?? outcomes[outcomes.length - 1];
      i += 1;
      return {
        status: current.status,
        stdout: current.stdout,
        stderr: current.stderr,
        signal: null,
        error: null,
      };
    };

    const summary = runCleanCheckoutProof({
      sourceRoot,
      skipCheckout: true,
      checkoutRoot: sourceRoot,
      stages: CLEAN_CHECKOUT_STAGES.slice(0, 3),
      commandRunner: runner,
      outDir: evidenceRoot,
      commandTimeoutMs: 1000,
      runId: 'test-clean-checkout-proof-id',
    });

    const evidencePath = join(absoluteSource, summary.evidence_path);
    const evidence = JSON.parse(readFileSync(evidencePath, 'utf8')) as {
      status: string;
      no_secret_values_written: boolean;
      results: Array<{ stdout_tail: string; stderr_tail: string; }>;
    };
    expect(evidence.status).toBe('BLOCKED');
    expect(evidence.no_secret_values_written).toBe(true);
    expect(evidence.results.every((result) => !result.stdout_tail.includes(absoluteSource))).toBe(true);
    expect(evidence.results.every((result) => !result.stderr_tail.includes(absoluteSource))).toBe(true);
  });
});
