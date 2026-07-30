import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { currentGit } from '../../scripts/quality/evidence-provenance.mjs';
import { SHELL_PROOF_SCHEMA_VERSION, validateShellProofReceipt } from '../../scripts/quality/golden-loop/shell-proof-protocol.mjs';
import { validateReceipt } from '../../scripts/quality/golden-loop/receipt-adapter.mjs';

const ROOT = process.cwd();
const tempRoots: string[] = [];

type ReceiptAdapterValidationResult = {
  pass: boolean;
  shell_proof: {
    pass: boolean;
  } | null;
  [key: string]: unknown;
};

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function createTempRoot() {
  const root = mkdtempSync(join(tmpdir(), 'utopia-shell-proof-'));
  tempRoots.push(root);
  return root;
}

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function makeObservedArtifact(root: string, body: object) {
  const text = JSON.stringify(body, null, 2);
  const path = join(root, `observation-${sha256(text).slice(0, 8)}.json`);
  writeFileSync(path, text, 'utf8');
  return {
    path,
    sha256: `sha256:${sha256(text)}`,
    bytes: text.length,
  };
}

function makeConvergenceArtifact(
  root: string,
  operationIds: string[],
  session = 'session-web',
  endpoint = '/sync',
) {
  return makeObservedArtifact(root, {
    session,
    endpoint,
    operation_ids: operationIds,
  });
}

function makeReceipt({
  operationArtifact,
  convergenceArtifact,
  transport = {
    endpoint: '/sync',
    session: 'session-web',
    operation_count: 4,
  },
  lifecycleAssertions = {
    conflict_detected: true,
    rollback_replayed_for_losers: 1,
    convergence_replayed: true,
  },
  extra = {},
}: {
  operationArtifact: ReturnType<typeof makeObservedArtifact>;
  convergenceArtifact: ReturnType<typeof makeObservedArtifact>;
  transport?: { endpoint: string; session: string; operation_count?: number; };
  lifecycleAssertions?: {
    conflict_detected?: boolean;
    rollback_replayed_for_losers?: number;
    convergence_replayed?: boolean;
  };
  extra?: Record<string, unknown>;
}) {
  const now = new Date().toISOString();
  return {
    proof: 'utopia_web_shell_execution_receipt',
    schema_version: SHELL_PROOF_SCHEMA_VERSION,
    checked_at: now,
    status: 'PASS',
    git: currentGit(ROOT),
    source: {
      surface: 'web',
      installation_id: 'install-web-1',
    },
    package: {
      checksum: `sha256:${'a'.repeat(64)}`,
      version: '1.1.0',
      previous_version: '1.0.0',
      version_transition: {
        from: '1.0.0',
        to: '1.1.0',
      },
    },
    execution: {
      installation_id: 'install-web-1',
      durable_data_checksum: `sha256:${'d'.repeat(64)}`,
      sync_claimed: true,
      transport: {
        endpoint: transport.endpoint,
        session: transport.session,
        operation_count: transport.operation_count,
      },
      observations: [
        {
          observer_kind: 'shell-driver',
          command: 'bun run shell-sync',
          driver: 'web',
          source_timestamp: now,
          artifact: {
            path: operationArtifact.path,
            sha256: operationArtifact.sha256,
            bytes: operationArtifact.bytes,
          },
        },
      ],
    },
    convergence: {
      operation_ids: ['sync-op-alpha', 'sync-op-beta', 'sync-op-gamma', 'rb-sync-op-beta'],
      rollback_operation_ids: ['rb-sync-op-beta'],
      reconciled_operation_id: 'sync-op-gamma',
      rollback_replayed: true,
      transport_session: transport.session,
      transport_observation: {
        path: convergenceArtifact.path,
        sha256: convergenceArtifact.sha256,
        bytes: convergenceArtifact.bytes,
      },
    },
    lifecycle: {
      scenario: {
        scenario_id: 'convergence-conflict-rollback-v1',
        assertions: lifecycleAssertions,
      },
    },
    ...extra,
  } as Record<string, unknown>;
}

describe('shell proof protocol', () => {
  it('accepts strict shell execution receipts with linked observation artifacts', () => {
    const root = createTempRoot();
    const receiptPath = join(root, 'receipt.json');

    const operationArtifact = makeObservedArtifact(root, {
      source_timestamp: new Date().toISOString(),
      operations: [
        { op_id: 'sync-op-alpha', type: 'install', status: 'applied', timestamp: new Date().toISOString() },
        { op_id: 'sync-op-beta', type: 'write', status: 'applied', timestamp: new Date().toISOString() },
        { op_id: 'sync-op-gamma', type: 'update', status: 'applied', timestamp: new Date().toISOString() },
        { op_id: 'rb-sync-op-beta', type: 'rollback', status: 'replayed', timestamp: new Date().toISOString() },
      ],
    });

    const convergenceArtifact = makeConvergenceArtifact(root, [
      'sync-op-alpha',
      'sync-op-beta',
      'sync-op-gamma',
      'rb-sync-op-beta',
    ]);

    const receipt = makeReceipt({
      operationArtifact,
      convergenceArtifact,
    });

    writeFileSync(receiptPath, JSON.stringify(receipt, null, 2), 'utf8');

    const result = validateShellProofReceipt(receipt, {
      root: ROOT,
      label: 'web',
      path: receiptPath,
      requiredSourceSurface: 'web',
    }) as {
      pass: boolean;
      source_surface: string | null;
      package: { checksum: string | null } | null;
      transport: { endpoint?: string } | null;
      convergence: { transport_session?: string | null; reference_transport_observation?: { path?: string | null } | null } | null;
      operation_ids: string[] | null;
      blockers: string[];
      [key: string]: unknown;
    };

    expect(result.pass).toBe(true);
    expect(result.source_surface).toBe('web');
    expect(result.package?.checksum).toBe(`sha256:${'a'.repeat(64)}`);
    expect(result.transport?.endpoint).toBe('/sync');
    expect(result.convergence?.transport_session).toBe('session-web');
    expect(result.operation_ids).toContain('rb-sync-op-beta');
    expect(result.convergence?.reference_transport_observation?.path).toBe(convergenceArtifact.path);
  });

  it('rejects receipts with sync claimed but missing transport session or endpoint', () => {
    const root = createTempRoot();
    const receiptPath = join(root, 'receipt.json');

    const operationArtifact = makeObservedArtifact(root, {
      operations: [{ op_id: 'sync-op-alpha', status: 'applied', timestamp: new Date().toISOString() }],
    });
    const convergenceArtifact = makeConvergenceArtifact(root, ['sync-op-alpha'], '', '');

    const receipt = makeReceipt({
      operationArtifact,
      convergenceArtifact,
      transport: { endpoint: '', session: '' },
    });

    writeFileSync(receiptPath, JSON.stringify(receipt, null, 2), 'utf8');

    const result = validateShellProofReceipt(receipt, {
      root: ROOT,
      label: 'web',
      path: receiptPath,
      requiredSourceSurface: 'web',
    }) as {
      pass: boolean;
      blockers: string[];
      [key: string]: unknown;
    };

    expect(result.pass).toBe(false);
    expect(result.blockers).toContain('missing_sync_transport_session_or_endpoint');
  });

  it('rejects convergence operation IDs that are not present in observed operation artifacts', () => {
    const root = createTempRoot();
    const receiptPath = join(root, 'receipt.json');

    const operationArtifact = makeObservedArtifact(root, {
      operations: [
        { op_id: 'sync-op-alpha', status: 'applied', timestamp: new Date().toISOString() },
        { op_id: 'sync-op-beta', status: 'applied', timestamp: new Date().toISOString() },
      ],
    });
    const convergenceArtifact = makeConvergenceArtifact(root, ['sync-op-alpha']);

    const receipt = makeReceipt({
      operationArtifact,
      convergenceArtifact,
      extra: {
        convergence: {
          operation_ids: ['sync-op-alpha', 'unknown-op'],
          rollback_operation_ids: ['unknown-op'],
          reconciled_operation_id: 'unknown-op',
        },
      },
    });

    writeFileSync(receiptPath, JSON.stringify(receipt, null, 2), 'utf8');

    const result = validateShellProofReceipt(receipt, {
      root: ROOT,
      label: 'web',
      path: receiptPath,
      requiredSourceSurface: 'web',
    }) as {
      pass: boolean;
      blockers: string[];
      [key: string]: unknown;
    };

    expect(result.pass).toBe(false);
    expect(result.blockers).toContain('convergence_operation_not_executed:unknown-op');
  });

  it('rejects tampered observation artifacts even when self-reported op IDs still match', () => {
    const root = createTempRoot();
    const receiptPath = join(root, 'receipt.json');

    const operationArtifact = {
      path: join(root, 'tampered-observation.json'),
      operations: [
        { op_id: 'sync-op-alpha', status: 'applied', timestamp: new Date().toISOString() },
      ],
    };
    const operationText = JSON.stringify({
      source_timestamp: new Date().toISOString(),
      operations: operationArtifact.operations,
    }, null, 2);
    writeFileSync(operationArtifact.path, operationText, 'utf8');
    const operationsDescriptor = {
      path: operationArtifact.path,
      sha256: `sha256:${sha256(operationText)}`,
      bytes: operationText.length,
    };

    const convergenceArtifact = makeConvergenceArtifact(root, ['sync-op-alpha']);

    const receipt = makeReceipt({
      operationArtifact: {
        ...operationsDescriptor,
      },
      convergenceArtifact,
      extra: {
        convergence: {
          operation_ids: ['sync-op-alpha'],
          rollback_operation_ids: [],
          reconciled_operation_id: 'sync-op-alpha',
        },
      },
    });

    writeFileSync(receiptPath, JSON.stringify(receipt, null, 2), 'utf8');
    writeFileSync(operationArtifact.path, `${operationText}\n// tampered`, 'utf8');

    const result = validateShellProofReceipt(receipt, {
      root: ROOT,
      label: 'web',
      path: receiptPath,
      requiredSourceSurface: 'web',
    }) as {
      pass: boolean;
      blockers: string[];
      [key: string]: unknown;
    };

    expect(result.pass).toBe(false);
    expect(result.blockers.some((entry) => entry.includes('artifact_stale:'))).toBe(true);
  });

  it('adapter requires shell protocol when explicitly requested', () => {
    const temp = createTempRoot();
    const path = join(temp, 'legacy.json');

    const legacyReceipt = {
      proof: 'utopia_multi_surface_web_execution_receipt',
      checked_at: new Date().toISOString(),
      status: 'passed',
      package_checksum: `sha256:${'a'.repeat(64)}`,
      installation_id: 'legacy-install',
      lifecycle: {
        scenario_id: 'convergence-conflict-rollback-v1',
        scenario: {
          scenario_id: 'convergence-conflict-rollback-v1',
          assertions: {
            conflict_detected: true,
            rollback_replayed_for_losers: 1,
            convergence_replayed: true,
          },
        },
      },
      git: currentGit(ROOT),
    };

    writeFileSync(path, JSON.stringify(legacyReceipt, null, 2), 'utf8');

    const blockers: string[] = [];
    const result = validateReceipt({
      root: ROOT,
      label: 'web',
      path,
      blockers,
      requireShellProof: true,
      requiredSourceSurface: 'web',
    }) as unknown as ReceiptAdapterValidationResult;

    expect(result.pass).toBe(false);
    expect(result.shell_proof?.pass).toBe(false);
    expect(blockers.length).toBeGreaterThan(0);
  });
});
