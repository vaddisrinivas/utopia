import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { currentGit } from '../../scripts/quality/evidence-provenance.mjs';
import { validateReceipt, REQUIRED_SCENARIO_ID } from '../../scripts/quality/golden-loop/receipt-adapter.mjs';

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function createTempRoot() {
  const root = mkdtempSync(join(tmpdir(), 'utopia-receipt-adapter-'));
  tempRoots.push(root);
  return root;
}

function writeReceipt(root: string, receipt: Record<string, unknown>) {
  const path = join(root, 'receipt.json');
  writeFileSync(path, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
  return { root, path };
}

function makeReceipt(
  overrides: Record<string, unknown> = {},
  git = currentGit(process.cwd()),
) {
  const checksum = 'sha256:' + 'a'.repeat(64);
  const base = {
    proof: 'utopia_multi_surface_web_execution_receipt',
    checked_at: new Date().toISOString(),
    status: 'passed',
    pass: true,
    git,
    installation_id: 'install-1',
    package_checksum: checksum,
    lifecycle: {
      scenario_id: REQUIRED_SCENARIO_ID,
      scenario: {
        scenario_id: REQUIRED_SCENARIO_ID,
        assertions: {
          conflict_detected: true,
          rollback_replayed_for_losers: 1,
          convergence_replayed: true,
        },
      },
    },
  };

  return { ...base, ...overrides };
}

describe('receipt adapter', () => {
  it('validates a passable execution receipt', () => {
    const tempRoot = createTempRoot();
    const root = process.cwd();
    const git = currentGit(root);
    const blockers: string[] = [];
    const { path } = writeReceipt(tempRoot, makeReceipt({}, git));

    const result = validateReceipt({
      root,
      label: 'web',
      path,
      blockers,
      requireInstallationId: true,
      expectedGit: git,
    });

    expect(blockers).toEqual([]);
    expect(result.pass).toBe(true);
    expect(result.checksum).toBe('sha256:' + 'a'.repeat(64));
    expect(result.installation_id).toBe('install-1');
  });

  it('flags missing package checksum', () => {
    const tempRoot = createTempRoot();
    const root = process.cwd();
    const git = currentGit(root);
    const blockers: string[] = [];
    const { path } = writeReceipt(tempRoot, makeReceipt({ package_checksum: '' }, git));

    validateReceipt({
      root,
      label: 'web',
      path,
      blockers,
      requireInstallationId: true,
      expectedGit: git,
    });

    expect(blockers).toContain('missing_package_checksum:web');
  });

  it('flags invalid scenario id', () => {
    const tempRoot = createTempRoot();
    const root = process.cwd();
    const git = currentGit(root);
    const blockers: string[] = [];
    const { path } = writeReceipt(tempRoot, makeReceipt({
      lifecycle: {
        scenario_id: 'other-scenario',
        scenario: {
          scenario_id: 'other-scenario',
          assertions: {
            conflict_detected: true,
            rollback_replayed_for_losers: 1,
            convergence_replayed: true,
          },
        },
      },
    }, git));

    validateReceipt({
      root,
      label: 'web',
      path,
      blockers,
      requireInstallationId: true,
      expectedGit: git,
    });

    expect(blockers.some((entry) => entry.startsWith('invalid_scenario_id:web:'))).toBe(true);
  });
});
