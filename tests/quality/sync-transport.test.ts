import { execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, it } from 'vitest';

import { SYNC_TRANSPORT_SCHEMA_VERSION } from '@/packages/shared/contracts/sync-transport';

describe('sync transport evaluation lane', () => {
  const temps: string[] = [];

  afterEach(() => {
    for (const root of temps.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it('uses local shared-state proof and keeps live provider/device sync BLOCKED', () => {
    const root = mkdtempSync(join(tmpdir(), 'utopia-sync-transport-'));
    temps.push(root);

    const proofPath = join(root, 'shared-state-sync-proof.json');
    const evidencePath = join(root, 'sync-transport-evidence.json');

    const proof = {
      proof: 'shared_state_sync_local_conflict_merge_recovery',
      schemaVersion: 'utopia.vendor-neutral-shared-state-sync.v1',
      live_multi_device_sync_claims: {
        status: 'BLOCKED',
        reason: 'real live provider/device proof is missing',
        deterministic_multi_writer_evidence: false,
        readiness: {
          local_deterministic: 'PASS',
          live_provider_device: 'BLOCKED',
        },
        required_next_proof: 'real installations/devices',
      },
    };

    mkdirSync(root, { recursive: true });
    writeFileSync(proofPath, JSON.stringify(proof));

    const output = execSync('node scripts/quality/check-sync-transport.mjs', {
      cwd: process.cwd(),
      env: {
        ...process.env,
        UTOPIA_SHARED_STATE_SYNC_PROOF_PATH: proofPath,
        UTOPIA_SYNC_TRANSPORT_EVIDENCE_PATH: evidencePath,
      },
      encoding: 'utf8',
    });

    const evidence = JSON.parse(readFileSync(evidencePath, 'utf8')) as {
      schemaVersion: string;
      status: 'SUPPORTED' | 'BLOCKED';
      syncPort: { readiness: { liveProviderDevice: { status: 'PASS' | 'BLOCKED' } } };
    };

    expect(evidence.schemaVersion).toBe(SYNC_TRANSPORT_SCHEMA_VERSION);
    expect(evidence.status).toBe('BLOCKED');
    expect(evidence.syncPort.readiness.liveProviderDevice.status).toBe('BLOCKED');
    expect(output).toContain('live_multi_device_status=BLOCKED');
  });

  it('evaluates PowerSync as documentation-led with shim-required facets', () => {
    const root = mkdtempSync(join(tmpdir(), 'utopia-sync-transport-vendor-'));
    temps.push(root);
    const proofPath = join(root, 'shared-state-sync-proof.json');
    const evidencePath = join(root, 'sync-transport-evidence.json');

    const proof = {
      proof: 'shared_state_sync_local_conflict_merge_recovery',
      schemaVersion: 'utopia.vendor-neutral-shared-state-sync.v1',
      live_multi_device_sync_claims: {
        status: 'BLOCKED',
        reason: 'real live provider/device proof is missing',
        deterministic_multi_writer_evidence: false,
        readiness: {
          local_deterministic: 'PASS',
          live_provider_device: 'BLOCKED',
        },
        required_next_proof: 'real installations/devices',
      },
    };

    mkdirSync(root, { recursive: true });
    writeFileSync(proofPath, JSON.stringify(proof));

    execSync('node scripts/quality/check-sync-transport.mjs', {
      cwd: process.cwd(),
      env: {
        ...process.env,
        UTOPIA_SHARED_STATE_SYNC_PROOF_PATH: proofPath,
        UTOPIA_SYNC_TRANSPORT_EVIDENCE_PATH: evidencePath,
      },
      encoding: 'utf8',
    });

    const evidence = JSON.parse(readFileSync(evidencePath, 'utf8')) as {
      vendors: Array<{
        vendor: 'powersync';
        syncPortStatus: 'SUPPORTED' | 'BLOCKED';
        supported: string[];
        shimRequired: string[];
        blocked: string[];
      }>;
    };

    const powersync = evidence.vendors.find((vendor) => vendor.vendor === 'powersync');
    expect(powersync).toBeDefined();
    expect(powersync?.syncPortStatus).toBe('BLOCKED');
    expect(powersync?.shimRequired).toEqual([
      'tombstones',
      'cursor_checkpoint',
      'conflict_manual_review',
      'per_installation',
    ]);
    expect(powersync?.blocked).toEqual([]);
    expect(powersync?.supported).toEqual([
      'append_operations',
      'offline_replay',
    ]);
  });
});
