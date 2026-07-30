import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

const scriptPath = join(process.cwd(), 'scripts/quality/golden-loop/check-creator-study-receipt.mjs');
const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function mkTempRoot() {
  const root = mkdtempSync(join(tmpdir(), 'utopia-creator-study-receipt-'));
  tempRoots.push(root);
  return root;
}

function buildReceipt(overrides: Record<string, unknown> = {}) {
  const now = new Date().toISOString();
  return {
    proof: 'external_novice_study_receipt',
    checked_at: now,
    duration_seconds: 420,
    package: { id: 'portable.demo', version: '1.0.0', valid: true },
    package_valid: true,
    unaided: true,
    install_opened: true,
    provenance: { actor: 'novice', reason: 'Unaided study install.' },
    ...overrides,
  };
}

function runCheck(options: { receipt: Record<string, unknown> | null; env?: NodeJS.ProcessEnv }) {
  const root = mkTempRoot();
  const evidencePath = join(root, 'creator-study-receipt-check.json');
  const receiptPath = join(root, 'creator-study-receipt.json');

  if (options.receipt) {
    writeFileSync(receiptPath, `${JSON.stringify(options.receipt, null, 2)}\n`, 'utf8');
  }

  mkdirSync(join(root), { recursive: true });

  const env = {
    ...process.env,
    ...(options.env ?? {}),
    UTOPIA_CREATOR_STUDY_RECEIPT_CHECK_PATH: evidencePath,
    ...(options.receipt ? { UTOPIA_CREATOR_STUDY_RECEIPT_PATH: receiptPath } : {}),
  };

  const result = spawnSync(process.execPath, [scriptPath], { env, encoding: 'utf8' });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  const evidence = JSON.parse(readFileSync(evidencePath, 'utf8')) as {
    status: 'passed' | 'blocked';
    blockers: string[];
  };

  return { evidence, output };
}

describe('creator study receipt check', () => {
  it('passes with a fresh unaided, valid package, install-opened, and provenance receipt', () => {
    const output = runCheck({ receipt: buildReceipt() });
    expect(output.evidence.status).toBe('passed');
    expect(output.evidence.blockers).toEqual([]);
    expect(output.output).toContain('CREATOR_STUDY_RECEIPT=PASS');
  });

  it('blocks when receipt is missing', () => {
    const root = mkTempRoot();
    const evidencePath = join(root, 'creator-study-receipt-check.json');
    let result;
    try {
      execFileSync(process.execPath, [scriptPath], {
        env: {
          ...process.env,
          UTOPIA_CREATOR_STUDY_RECEIPT_PATH: join(root, 'creator-study-receipt.json'),
          UTOPIA_CREATOR_STUDY_RECEIPT_CHECK_PATH: evidencePath,
        },
        encoding: 'utf8',
      });
      throw new Error('expected blocked');
    } catch (error) {
      result = error as { status?: number; stderr?: string };
    }

    expect(result?.status).toBe(1);
    const evidence = JSON.parse(readFileSync(evidencePath, 'utf8')) as {
      status: 'passed' | 'blocked';
      blockers: string[];
    };
    expect(evidence.status).toBe('blocked');
    expect(evidence.blockers).toContain('creator_study_receipt_missing');
  });

  it('blocks when study was assisted or stale, install not opened, invalid package, or missing provenance', () => {
    const run = runCheck({
      receipt: buildReceipt({
        unaided: false,
        duration_seconds: 601,
        install_opened: false,
        package_valid: false,
        provenance: null,
      }),
    });

    expect(run.evidence.status).toBe('blocked');
    expect(run.evidence.blockers).toEqual(expect.arrayContaining([
      'creator_study_receipt_invalid_duration',
      'creator_study_receipt_not_unaided',
      'creator_study_receipt_invalid_package',
      'creator_study_receipt_install_not_opened',
      'creator_study_receipt_missing_provenance',
    ]));
  });
});
