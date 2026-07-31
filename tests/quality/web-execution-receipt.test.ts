import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  buildWebExecutionReceipt,
  extractReferenceSyncMetadataFromResponse,
  sanitizeHeadersForEvidence,
} from '../../scripts/quality/golden-loop/web-execution-receipt.mjs';
import { validateShellProofReceipt } from '../../scripts/quality/golden-loop/shell-proof-protocol.mjs';
import { hashText } from '../../scripts/quality/golden-loop/web-execution-receipt.mjs';
import { currentGit } from '../../scripts/quality/evidence-provenance.mjs';
import { nextActionForWebReceipt } from '../../scripts/quality/golden-loop/web-execution-receipt.mjs';

const tempRoots: string[] = [];

type WrittenPackageArtifact = {
  path: string;
  [key: string]: unknown;
};

type WrittenArtifacts = {
  metadataPath: string;
  v1: WrittenPackageArtifact;
  v2: WrittenPackageArtifact;
};

const PLACEHOLDER_WRITTEN = {
  path: 'sha256:' + '0'.repeat(64),
};

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function createTempRoot() {
  const root = mkdtempSync(join(tmpdir(), 'utopia-web-execution-test-'));
  tempRoots.push(root);
  return root;
}

const baseArtifacts = {
  id: 'shared-household-board',
  version: { v1: '1.0.0', v2: '1.1.0' },
  urls: {
    v1: 'https://utoia.thetechcruise.com/p/shared-household-board.json',
    v2: 'https://utoia.thetechcruise.com/p/shared-household-board-1.1.0.json',
  },
  v1: {
    package: { id: 'shared-household-board' },
    checksum: 'sha256:' + 'a'.repeat(64),
    packageUrl: 'https://utoia.thetechcruise.com/p/shared-household-board.json',
  },
  v2: {
    package: { id: 'shared-household-board' },
    checksum: 'sha256:' + 'b'.repeat(64),
    packageUrl: 'https://utoia.thetechcruise.com/p/shared-household-board-1.1.0.json',
  },
} as const;

const baseGit = {
  ...currentGit(process.cwd()),
};

function receiptInputs(overrides: {
  blockers?: string[];
  executionArtifactDir?: string;
  referenceSync?: Record<string, unknown>;
  written?: WrittenArtifacts;
} = {}) {
  const blockers = overrides.blockers ?? [];
  const syncSessionId = 'sha256:' + 'd'.repeat(64);
  const operationId = 'sha256:' + 'c'.repeat(64);
  const rollbackOperationId = 'sha256:' + 'f'.repeat(64);
  const reconciledOperationId = 'sha256:' + 'g'.repeat(64);
  const referenceSync = overrides.referenceSync ?? {
    observed: true,
    convergence: true,
    operationObserved: true,
    rollbackOperationObserved: true,
    reconciledOperationObserved: true,
    sessionObserved: true,
    endpointObserved: true,
    conflictObserved: true,
    convergenceObserved: true,
    conflictDetected: true,
    rollbackReplayed: true,
    convergenceReplayed: true,
    rollbackOperationIds: [rollbackOperationId],
    reconciledOperationId,
    endpoints: ['/reference-sync/v1/sync'],
    operationIds: [operationId],
    sessionIds: [syncSessionId],
    observations: [
      {
        path: '/reference-sync/v1/sync',
        status: 200,
        method: 'POST',
        endpoint: '/reference-sync/v1/sync',
        operation_ids: [operationId],
        rollback_operation_ids: [rollbackOperationId],
        reconciled_operation_id: reconciledOperationId,
        session_id: syncSessionId,
        conflict_detected: true,
        convergence_replayed: true,
        rollback_replayed: true,
      },
    ],
    latestSessionId: syncSessionId,
    observationIds: ['sha256:' + 'e'.repeat(64)],
  };

  const executionArtifactDir = overrides.executionArtifactDir ?? createTempRoot();
  const written = {
    metadataPath: join(executionArtifactDir, 'written-metadata.json'),
    v1: { ...PLACEHOLDER_WRITTEN, path: join(executionArtifactDir, 'written-v1.json') },
    v2: { ...PLACEHOLDER_WRITTEN, path: join(executionArtifactDir, 'written-v2.json') },
    ...(overrides.written ?? {}),
  } as WrittenArtifacts;

  const receipt = buildWebExecutionReceipt({
    blockers,
    steps: [
      {
        step: 'install_v1',
        status: 'passed',
        packageUrl: baseArtifacts.urls.v1,
        installationId: 'web-install',
        version: baseArtifacts.version.v1,
      },
      {
        step: 'data_write_v1_before_update',
        status: 'passed',
        installationId: 'web-install',
        marker: 'proof-marker',
      },
      {
        step: 'update_v1_to_v2',
        status: 'passed',
        packageUrl: baseArtifacts.urls.v2,
        installationId: 'web-install',
        version: baseArtifacts.version.v2,
      },
      {
        step: 'rollback_to_v1',
        status: 'passed',
        installationId: 'web-install',
        version: baseArtifacts.version.v1,
      },
    ],
    initial: {
      version: baseArtifacts.version.v1,
      installationId: 'web-install',
    },
    updated: {
      version: baseArtifacts.version.v2,
      installationId: 'web-install',
    },
    installationId: 'web-install',
    artifacts: baseArtifacts,
    baseUrl: 'http://127.0.0.1:8094',
    packageChecksum: baseArtifacts.v2.checksum,
    referenceSync,
    written,
    dataPreservation: {
      attempted: true,
      marker: 'proof-marker',
      before_update: {
        checksum: baseArtifacts.v1.checksum,
        found: true,
      },
      after_update: {
        checksum: baseArtifacts.v2.checksum,
        found: true,
      },
      post_rollback: {
        checksum: baseArtifacts.v1.checksum,
        found: true,
      },
      preserved: true,
    },
    screenshotArtifacts: [],
    observationArtifacts: [],
    executionArtifactDir,
    receiptPath: join(executionArtifactDir, 'web-execution-receipt.json'),
    git: baseGit,
  });

  const receiptPath = join(executionArtifactDir, 'web-execution-receipt.json');
  mkdirSync(executionArtifactDir, { recursive: true });
  writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);

  return {
    receipt,
    receiptPath,
    executionArtifactDir,
  };
}

describe('web execution receipt', () => {
  it('writes executable observation artifacts to temp and validates canonical shell-proof', () => {
    const { receipt, receiptPath, executionArtifactDir } = receiptInputs();
    const validation = validateShellProofReceipt(receipt, {
      root: process.cwd(),
      label: 'web',
      path: receiptPath,
      requiredSourceSurface: 'web',
    });

    expect(validation.pass).toBe(true);

    const observationArtifacts = receipt.artifacts?.observation_artifacts ?? [];
    expect(observationArtifacts.length).toBeGreaterThanOrEqual(1);
    for (const artifact of observationArtifacts) {
      const artifactBody = readFileSync(artifact.path, 'utf8');
      const parsed = JSON.parse(artifactBody) as Record<string, unknown>;
      expect((parsed as Record<string, unknown>).operations).toBeDefined();
      expect(typeof (artifact.path)).toBe('string');
      expect(artifact.path.startsWith(executionArtifactDir)).toBe(true);
    }
  });

  it('returns BLOCKED when public lifecycle hook is missing', () => {
    const { receipt, receiptPath } = receiptInputs({
      blockers: ['missing_public_data_write_hook:app-lifecycle'],
    });
    const validation = validateShellProofReceipt(receipt, {
      root: process.cwd(),
      label: 'web',
      path: receiptPath,
      requiredSourceSurface: 'web',
    });

    expect(receipt.status).toBe('BLOCKED');
    expect(receipt.blockers).toContain('missing_public_data_write_hook:app-lifecycle');
    expect(receipt.source?.surface).toBe('web');
    expect(validation.pass).toBe(false);
  });

  it('rejects receipt when package checksum is tampered', () => {
    const { receipt, receiptPath } = receiptInputs();
    const tampered = {
      ...receipt,
      package: {
        ...receipt.package,
        checksum: 'sha256:not-a-checksum',
      },
    };
    writeFileSync(receiptPath, `${JSON.stringify(tampered, null, 2)}\n`);
    const validation = validateShellProofReceipt(tampered, {
      root: process.cwd(),
      label: 'web',
      path: receiptPath,
      requiredSourceSurface: 'web',
    });

    expect(validation.pass).toBe(false);
    expect(validation.blockers).toContain('missing_package_checksum');
  });

  it('redacts sensitive headers from evidence helpers', () => {
    const rawHeaders = {
      Authorization: 'token-abc',
      'X-API-Key': 'secret',
      cookie: 'session=abc',
      Accept: 'application/json',
    };

    const sanitized = sanitizeHeadersForEvidence(rawHeaders);
    expect(sanitized).toEqual({
      Accept: 'application/json',
    });
  });

  it('extracts hashed reference-sync session and operation IDs', () => {
    const raw = JSON.stringify({
      ok: true,
      data: {
        workspaceId: 'workspace-1',
        installationId: 'install-1',
        deviceId: 'device-1',
        opId: 'op-123',
      },
    });

    const metadata = extractReferenceSyncMetadataFromResponse(raw);
    expect(metadata.sessionId).toBe(hashText('workspace-1|install-1|device-1'));
    expect(metadata.operationIds).toEqual([hashText('op-123')]);
    expect(metadata.session).toMatchObject({
      workspace_id_hash: hashText('workspace-1'),
      installation_id_hash: hashText('install-1'),
      device_id_hash: hashText('device-1'),
      session_id_hash: hashText('workspace-1|install-1|device-1'),
    });
  });

  it('uses only the observed request session for network proof context', () => {
    const metadata = extractReferenceSyncMetadataFromResponse(
      JSON.stringify({ ok: true, data: { opId: 'op-observed' } }),
      { session: 'request-session-1', endpoint: 'http://127.0.0.1:18481/reference-sync/v1/stage' },
    );

    expect(metadata.sessionId).toBe(hashText('request-session-1'));
    expect(metadata.rawSession).toBe('request-session-1');
    expect(metadata.endpoint).toBe('http://127.0.0.1:18481/reference-sync/v1/stage');
    expect(metadata.sessionObserved).toBe(true);
    expect(metadata.endpointObserved).toBe(true);
  });

  it('blocks session claims when a network response has no observed session context', () => {
    const metadata = extractReferenceSyncMetadataFromResponse(
      JSON.stringify({ ok: true, data: { opId: 'op-unscoped' } }),
      { endpoint: 'http://127.0.0.1:18481/reference-sync/v1/stage' },
    );

    expect(metadata.sessionId).toBeNull();
    expect(metadata.sessionObserved).toBe(false);
  });

  it('does not persist raw cursor values in serialized sync evidence', () => {
    const rawCursor = 'secret-sync-cursor-123';
    const { receiptPath, receipt } = receiptInputs({
      referenceSync: {
        observed: true,
        convergence: true,
        operationObserved: true,
        rollbackOperationObserved: true,
        reconciledOperationObserved: true,
        sessionObserved: true,
        endpointObserved: true,
        conflictObserved: true,
        convergenceObserved: true,
        conflictDetected: true,
        rollbackReplayed: true,
        convergenceReplayed: true,
        rollbackOperationIds: ['sha256:' + 'f'.repeat(64)],
        reconciledOperationId: 'sha256:' + 'g'.repeat(64),
        endpoints: ['/reference-sync/v1/sync'],
        operationIds: ['sha256:' + 'c'.repeat(64)],
        sessionIds: ['sha256:' + 'd'.repeat(64)],
        observations: [
          {
            path: '/reference-sync/v1/sync',
            status: 200,
            method: 'POST',
            operation_ids: ['sha256:' + 'c'.repeat(64)],
            session_id: 'sha256:' + 'd'.repeat(64),
            cursor: rawCursor,
          },
        ],
        latestSessionId: 'sha256:' + 'd'.repeat(64),
        observationIds: ['sha256:' + 'e'.repeat(64)],
      },
    });

    const serializedReceipt = readFileSync(receiptPath, 'utf8');
    expect(serializedReceipt.includes(rawCursor)).toBe(false);
    for (const artifact of receipt.artifacts?.observation_artifacts ?? []) {
      const body = readFileSync(artifact.path, 'utf8');
      expect(body.includes(rawCursor)).toBe(false);
    }
  });

  it('cannot rely on synthetic step IDs without observed transport IDs', () => {
    const { receiptPath, receipt } = receiptInputs({
      referenceSync: {
        observed: true,
        convergence: false,
        operationObserved: false,
        rollbackOperationObserved: false,
        reconciledOperationObserved: false,
        sessionObserved: true,
        endpointObserved: true,
        conflictObserved: false,
        convergenceObserved: false,
        conflictDetected: null,
        rollbackReplayed: null,
        convergenceReplayed: null,
        rollbackOperationIds: [],
        reconciledOperationId: null,
        endpoints: ['/reference-sync/v1/sync'],
        operationIds: [],
        sessionIds: ['sha256:' + 'd'.repeat(64)],
        observations: [
          {
            path: '/reference-sync/v1/sync',
            status: 200,
            method: 'POST',
            operation_ids: [],
            session_id: 'sha256:' + 'd'.repeat(64),
          },
        ],
        latestSessionId: 'sha256:' + 'd'.repeat(64),
        observationIds: ['sha256:' + 'e'.repeat(64)],
      },
    });

    writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
    const validation = validateShellProofReceipt(receipt, {
      root: process.cwd(),
      label: 'web',
      path: receiptPath,
      requiredSourceSurface: 'web',
    });

    expect(validation.pass).toBe(false);
    expect(receipt.blockers).toContain('missing_public_reference_sync_operation_hook:operation');
    expect(receipt.blockers).toContain('missing_public_reference_sync_convergence_hook:convergence');
  });

  it('accepts a complete transport fixture with explicit sync IDs', () => {
    const { receipt, receiptPath } = receiptInputs();
    const validation = validateShellProofReceipt(receipt, {
      root: process.cwd(),
      label: 'web',
      path: receiptPath,
      requiredSourceSurface: 'web',
    });

    expect(validation.pass).toBe(true);
  });

  it('rejects transport artifacts whose observed operation count drifts', () => {
    const { receipt, receiptPath } = receiptInputs();
    const transportRef = receipt.execution?.transport?.observation;
    if (!transportRef || typeof transportRef.path !== 'string') {
      throw new Error('transport observation fixture is missing');
    }
    const mutatedTransport = JSON.stringify({
      session: 'sha256:' + 'd'.repeat(64),
      endpoint: '/reference-sync/v1/sync',
      operation_ids: [],
      operations: [],
    });
    writeFileSync(transportRef.path, mutatedTransport);
    transportRef.sha256 = hashText(mutatedTransport);
    transportRef.bytes = Buffer.byteLength(mutatedTransport);

    const validation = validateShellProofReceipt(receipt, {
      root: process.cwd(),
      label: 'web',
      path: receiptPath,
      requiredSourceSurface: 'web',
    });

    expect(validation.pass).toBe(false);
    expect(validation.blockers).toContain('transport_observation_operation_count_mismatch:0:3');
  });

  it('computes explicit web next action for blocked runtime conditions', () => {
    expect(nextActionForWebReceipt(['missing_web_runtime_driver:playwright']))
      .toContain('Install Playwright');
    expect(nextActionForWebReceipt(['missing_public_reference_sync_session_hook:session']))
      .toContain('App Library screen');
  });
});
