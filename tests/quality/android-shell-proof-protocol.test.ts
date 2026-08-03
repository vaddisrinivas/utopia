import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { currentGit } from '../../scripts/quality/evidence-provenance.mjs';
import {
  SHELL_PROOF_SCHEMA_VERSION,
  validateShellProofReceipt,
} from '../../scripts/quality/golden-loop/shell-proof-protocol.mjs';
import { REQUIRED_SCENARIO_ID } from '../../scripts/quality/golden-loop/receipt-adapter.mjs';

const REPO_ROOT = process.cwd();

type ArtifactRecord = {
  path: string;
  bytes: number;
  sha256: string;
};

type BuildReceiptOptions = {
  rootDir: string;
  stage?: string;
};

function sha256(value = '') {
  return createHash('sha256').update(String(value)).digest('hex');
}

function writeArtifact(rootDir: string, relativePath: string, payload: unknown): ArtifactRecord {
  const absolute = join(rootDir, relativePath);
  mkdirSync(join(absolute, '..'), { recursive: true });
  const text = `${JSON.stringify(payload, null, 2)}\n`;
  writeFileSync(absolute, text, 'utf8');
  return {
    path: relativePath,
    bytes: Buffer.byteLength(text),
    sha256: sha256(text),
  };
}

function buildStrictReceipt({ rootDir, stage = 'final' }: BuildReceiptOptions) {
  const now = '2026-07-30T00:00:00.000Z';
  const observation = writeArtifact(rootDir, join('observations', `${stage}.json`), {
    operations: [
      {
        op_id: 'op-1',
        status: 'executed',
        type: 'reference_sync',
        timestamp: now,
        source_timestamp: now,
      },
      {
        op_id: 'op-2',
        status: 'executed',
        type: 'reference_sync',
        timestamp: now,
        source_timestamp: now,
      },
    ],
  });

  const transportObservation = writeArtifact(rootDir, join('observations', `${stage}-transport.json`), {
    session: 'session-android-1',
    endpoint: 'http://127.0.0.1:3123',
    operation_ids: ['op-1', 'op-2'],
    operations: [
      {
        op_id: 'op-1',
        status: 'executed',
        type: 'reference_sync',
        timestamp: now,
        source_timestamp: now,
      },
      {
        op_id: 'op-2',
        status: 'executed',
        type: 'reference_sync',
        timestamp: now,
        source_timestamp: now,
      },
    ],
  });

  return {
    proof: SHELL_PROOF_SCHEMA_VERSION,
    schema_version: SHELL_PROOF_SCHEMA_VERSION,
    status: 'PASS',
    checked_at: now,
    source: {
      surface: 'android',
      emulator_serial: 'emulator-5554',
      package_id: 'app.utopia.goldenloop',
    },
    installation_id: 'install-device-a',
    package_checksum: `sha256:${sha256('package-v2')}`,
    package: {
      checksum: `sha256:${sha256('package-v2')}`,
      version: '2',
      previous_version: '1',
      version_transition: {
        from: '1',
        to: '2',
        checksum: `sha256:${sha256('package-v2')}`,
        previous_checksum: `sha256:${sha256('package-v1')}`,
      },
    },
    durable_data_checksum: `sha256:${sha256('durable-data')}`,
    execution: {
      package_checksum: `sha256:${sha256('package-v2')}`,
      package_version: '2',
      package_previous_version: '1',
      package_version_transition: {
        from: '1',
        to: '2',
        checksum: `sha256:${sha256('package-v2')}`,
        previous_checksum: `sha256:${sha256('package-v1')}`,
      },
      observations: [
        {
          command: 'utopia://chat?prompt=golden-loop-identity&run=1',
          driver: 'adb:emulator-5554',
          source_timestamp: now,
          observer: {
            kind: 'adb',
          },
          artifact: {
            path: observation.path,
            sha256: observation.sha256,
            bytes: observation.bytes,
          },
        },
      ],
      sync_claimed: true,
      transport: {
        sync_claimed: true,
        session: 'session-android-1',
        endpoint: 'http://127.0.0.1:3123',
        operation_count: 2,
        observation: {
          path: transportObservation.path,
          sha256: transportObservation.sha256,
          bytes: transportObservation.bytes,
        },
      },
    },
    convergence: {
      operation_ids: ['op-1', 'op-2'],
      rollback_operation_ids: ['op-1'],
      reconciled_operation_id: 'op-1',
      rollback_replayed: true,
      transport_session: 'session-android-1',
      transport_observation: {
        path: transportObservation.path,
        sha256: transportObservation.sha256,
        bytes: transportObservation.bytes,
      },
    },
    lifecycle: {
      scenario: {
        scenario_id: REQUIRED_SCENARIO_ID,
        assertions: {
          conflict_detected: true,
          rollback_replayed_for_losers: 1,
          convergence_replayed: true,
        },
      },
    },
    git: currentGit(REPO_ROOT),
  };
}

function withLiveGitEnvelope<T extends Record<string, unknown>>(receipt: T, rootDir: string) {
  return {
    ...receipt,
    git: currentGit(rootDir),
  };
}

describe('android shell-proof protocol', () => {
  let rootDir = '';
  const evidenceRoot = join(REPO_ROOT, 'tmp');

  const buildTestRoot = () => {
    mkdirSync(evidenceRoot, { recursive: true });
    return mkdtempSync(join(evidenceRoot, 'android-shell-proof-'));
  };

  afterEach(() => {
    if (!rootDir) return;
    rmSync(rootDir, { recursive: true, force: true });
    rootDir = '';
  });

  it('accepts strict canonical receipt', () => {
    rootDir = buildTestRoot();
    const receiptPath = 'android-shell-proof.json';
    const receipt = withLiveGitEnvelope(buildStrictReceipt({ rootDir }), rootDir);
    const validation = validateShellProofReceipt(receipt, {
      root: rootDir,
      label: 'android',
      path: receiptPath,
      requiredSourceSurface: 'android',
    } as unknown as Parameters<typeof validateShellProofReceipt>[1]);

    expect(validation.pass, validation.blockers.join('\n')).toBe(true);
    expect(validation.blockers).toHaveLength(0);
    expect(validation.operation_ids).toEqual(['op-1', 'op-2']);
    expect(validation.scenario_id).toBe(REQUIRED_SCENARIO_ID);
  });

  it('rejects missing transport session as tamper', () => {
    rootDir = buildTestRoot();
    const receiptPath = 'android-shell-proof.json';
    const receipt = withLiveGitEnvelope(buildStrictReceipt({ rootDir }), rootDir);
    receipt.execution.transport.session = '';

    const validation = validateShellProofReceipt(receipt, {
      root: rootDir,
      label: 'android',
      path: receiptPath,
      requiredSourceSurface: 'android',
    } as unknown as Parameters<typeof validateShellProofReceipt>[1]);

    expect(validation.pass).toBe(false);
    expect(validation.blockers).toContain('missing_sync_transport_session_or_endpoint');
  });

  it('rejects tampered protocol status as fail', () => {
    rootDir = buildTestRoot();
    const receiptPath = 'android-shell-proof.json';
    const receipt = withLiveGitEnvelope(buildStrictReceipt({ rootDir }), rootDir);
    receipt.status = 'FAIL';

    const validation = validateShellProofReceipt(receipt, {
      root: rootDir,
      label: 'android',
      path: receiptPath,
      requiredSourceSurface: 'android',
    } as unknown as Parameters<typeof validateShellProofReceipt>[1]);

    expect(validation.pass).toBe(false);
    expect(validation.blockers).toContain('receipt_not_passed:android');
  });
});
