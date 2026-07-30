import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, it } from 'vitest';

describe('reference sync transport relay proof', () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('runs live relay process and proves convergent network transport scenario', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'utopia-ref-sync-transport-test-'));
    tempRoots.push(tempDir);

    const evidencePath = join(tempDir, 'reference-sync-transport-evidence.json');
    const command = join(process.cwd(), 'node_modules', '.bin', 'tsx');
    const port = String(18500 + ((Date.now() % 500) | 0));

    const output = execFileSync(
      command,
      [
        '--tsconfig',
        join(process.cwd(), 'tsconfig.json'),
        'scripts/quality/check-reference-sync-transport.ts',
      ],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: {
          ...process.env,
          UTOPIA_REFERENCE_SYNC_TRANSPORT_EVIDENCE_PATH: evidencePath,
          UTOPIA_REFERENCE_SYNC_TRANSPORT_PORT: port,
        },
      },
    );

    const proof = JSON.parse(readFileSync(evidencePath, 'utf8')) as {
      status: 'PASS' | 'BLOCKED';
      proof: string;
      distinct_client_ids: string[];
      installation_ids: string[];
      workspace_ids: string[];
      scenario: {
        conflict_detected: boolean;
        offline_write_buffered: boolean;
        rollback_replay: boolean;
        tombstone_applied: boolean;
        cursor_converged: boolean;
        reconnect_recovered: boolean;
        tenant_isolated: boolean;
      };
    };

    expect(output).toBeDefined();
    expect(proof.proof).toBe('reference_sync_transport_live');
    expect(proof.status).toBe('PASS');
    expect(proof.distinct_client_ids.length).toBeGreaterThanOrEqual(2);
    expect(proof.installation_ids.length).toBeGreaterThanOrEqual(1);
    expect(proof.workspace_ids.length).toBeGreaterThanOrEqual(1);
    expect(proof.scenario.conflict_detected).toBe(true);
    expect(proof.scenario.offline_write_buffered).toBe(true);
    expect(proof.scenario.rollback_replay).toBe(true);
    expect(proof.scenario.tombstone_applied).toBe(true);
    expect(proof.scenario.cursor_converged).toBe(true);
    expect(proof.scenario.reconnect_recovered).toBe(true);
    expect(proof.scenario.tenant_isolated).toBe(true);
  });
});
