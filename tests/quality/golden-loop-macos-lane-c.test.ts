import { existsSync, mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

const root = process.cwd();

function readText(relativePath: string) {
  return readFileSync(join(root, relativePath), 'utf8');
}

describe('macOS lane C orchestration', () => {
  it('fails closed when the workspace is missing without writing a lane receipt', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'utopia-macos-lane-c-'));
    const laneReceipt = join(fixture, 'macos-lane-c-receipt.json');

    try {
      const result = spawnSync(process.execPath, [join(root, 'scripts/quality/macos/run-golden-loop-macos-lane.mjs')], {
        cwd: fixture,
        env: {
          ...process.env,
          UTOPIA_MACOS_BUILD_RECEIPT_PATH: join(fixture, 'build-receipt.json'),
          UTOPIA_MACOS_LANE_C_RECEIPT_PATH: laneReceipt,
          UTOPIA_MACOS_RUNTIME_BRIDGE_RECEIPT_PATH: join(fixture, 'bridge-receipt.json'),
          UTOPIA_MACOS_RUNTIME_BRIDGE_RAW_OBSERVATION_PATH: join(fixture, 'bridge-observations.jsonl'),
        },
        encoding: 'utf8',
        stdio: 'pipe',
      });

      expect(result.status).toBe(1);
      expect(result.stderr || '').toContain('next_action:');
      expect(existsSync(laneReceipt)).toBe(false);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it('declares macOS lane C workflow wiring with required commands and artifacts', () => {
    const workflow = readText('.github/workflows/golden-loop-macos.yml');

    expect(workflow).toContain('runs-on: macos-latest');
    expect(workflow).toContain('workflow_dispatch');
    expect(workflow).toContain('node scripts/quality/macos/run-golden-loop-macos-lane.mjs');
    expect(workflow).toContain('actions/upload-artifact');
    expect(workflow).toContain('app/build/evidence/golden-loop/macos-lane-c-receipt.json');
    expect(workflow).toContain('app/build/evidence/golden-loop/macos-debug-bridge-receipt.json');
    expect(workflow).toContain('app/build/evidence/golden-loop/macos-debug-bridge-observations.jsonl');
    expect(workflow).toContain('app/build/evidence/golden-loop/macos-debug-bridge-observations.jsonl.dispatch.jsonl');
    expect(workflow).toContain('app/build/evidence/golden-loop/macos-build-receipt.json');
  });

  it('requires the built app to emit correlated runtime evidence', () => {
    const bridge = readText('scripts/quality/macos/run-golden-loop-debug-bridge.mjs');

    expect(bridge).toContain("spawnSync('open', ['-a', appPath, url]");
    expect(bridge).toContain('missing_native_runtime_receipt');
    expect(bridge).toContain('runtime_receipt_correlation_mismatch');
    expect(bridge).not.toContain("status: blocked ? 'BLOCKED' : 'PASS'");
  });
});
