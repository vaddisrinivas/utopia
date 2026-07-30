import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { afterEach, describe, expect, it } from 'vitest';

import { validateReceipt } from '../../scripts/quality/golden-loop/receipt-adapter.mjs';

const root = process.cwd();
const scriptPath = join(root, 'scripts/quality/golden-loop/run-virtual-lab.mjs');
const tempRoots: string[] = [];

afterEach(() => {
  for (const temp of tempRoots.splice(0)) rmSync(temp, { recursive: true, force: true });
});

function createTempRoot() {
  const temp = mkdtempSync(join(tmpdir(), 'utopia-golden-loop-virtual-'));
  tempRoots.push(temp);
  return temp;
}

function runVirtualLab(outputPath: string) {
  const result = spawnSync(process.execPath, [scriptPath], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      UTOPIA_GOLDEN_LOOP_VIRTUAL_LAB_PATH: outputPath,
    },
  });

  return {
    status: result.status ?? 1,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
    evidence: JSON.parse(readFileSync(outputPath, 'utf8')) as {
      proof: string;
      status: 'PASS' | 'FAIL';
      categories: Record<string, string>;
      debug_automation_contract: {
        command_artifacts: Array<{ command_count: number }>;
      };
      can_replace_real_device_or_human_evidence: boolean;
      surfaces: Array<{
        label: string;
        receipt_path: string;
        eligible_as_real_surface_receipt: boolean;
        structure: {
          pass: boolean;
          blockers: string[];
        };
      }>;
    },
  };
}

describe('Golden Loop virtual lab', () => {
  it('produces a local automation receipt without claiming real devices or human usability', () => {
    const temp = createTempRoot();
    const outputPath = join(temp, 'virtual-lab-proof.json');

    const result = runVirtualLab(outputPath);

    expect(result.status).toBe(0);
    expect(result.evidence.proof).toBe('utopia_golden_loop_virtual_lab');
    expect(result.evidence.status).toBe('PASS');
    expect(result.evidence.categories.physical_device).toBe('NOT_REQUIRED');
    expect(result.evidence.categories.human_usability).toBe('NOT_MEASURED');
    expect(result.evidence.categories.real_multi_surface_receipts).toBe('NOT_PROVEN');
    expect(result.evidence.categories.clean_snapshot).toBe('CANDIDATE_PASS');
    expect(result.evidence.can_replace_real_device_or_human_evidence).toBe(false);
    expect(result.evidence.surfaces).toHaveLength(4);
    expect(result.evidence.surfaces.every((surface) => surface.structure.pass)).toBe(true);
    expect(result.evidence.surfaces.every((surface) => surface.eligible_as_real_surface_receipt === false)).toBe(true);
    expect(result.evidence.debug_automation_contract.command_artifacts).toHaveLength(4);
    expect(result.evidence.debug_automation_contract.command_artifacts.every((artifact) => artifact.command_count >= 12)).toBe(true);
  });

  it('keeps virtual receipts blocked by the real multi-surface receipt adapter', () => {
    const temp = createTempRoot();
    const outputPath = join(temp, 'virtual-lab-proof.json');
    const result = runVirtualLab(outputPath);
    const firstReceipt = result.evidence.surfaces[0];
    expect(firstReceipt).toBeDefined();

    const blockers: string[] = [];
    const validation = validateReceipt({
      root,
      label: firstReceipt.label,
      path: firstReceipt.receipt_path,
      blockers,
      requireInstallationId: true,
      requireShellProof: true,
      requiredSourceSurface: 'android',
    });

    expect(validation.pass).toBe(false);
    expect(blockers).toContain(`synthetic_receipt:${firstReceipt.label}`);
  });
});
