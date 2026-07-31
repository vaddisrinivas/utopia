import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createReferenceSyncTransportAdapter,
  ReferenceSyncTransportClient,
  referenceSyncTransportContract,
  referenceSyncTransportPaths,
} from '@/src/providers/reference-sync-transport';
import { SHARED_STATE_SYNC_SCHEMA_VERSION } from '@/src/providers/shared-state-sync';
import { canonicalJson } from '@/packages/shared/contracts/canonical-json';

describe('reference sync transport relay proof', () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('exposes the sync-contract adapter and sends an observed session header', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, data: { status: 'ready', schemaVersion: 'utopia.reference-sync-transport.v1', statePath: '/tmp/state.json' } }),
      text: async () => JSON.stringify({ ok: true, data: { status: 'ready', schemaVersion: 'utopia.reference-sync-transport.v1', statePath: '/tmp/state.json' } }),
      requestInit: init,
    }));
    vi.stubGlobal('fetch', fetchMock);

    const adapter = createReferenceSyncTransportAdapter({
      baseUrl: 'http://127.0.0.1:18481',
      sessionId: 'observed-session-1',
    });

    expect(adapter.contract).toEqual(referenceSyncTransportContract);
    expect(adapter.contract.readiness.liveProviderDevice.status).toBe('BLOCKED');
    await adapter.client.health();
    expect(fetchMock).toHaveBeenCalledWith(
      `http://127.0.0.1:18481${referenceSyncTransportPaths.health}`,
      expect.objectContaining({
        headers: expect.objectContaining({ 'x-utopia-sync-session': 'observed-session-1' }),
      }),
    );
  });

  it('observer records operation IDs from the executed request and response', async () => {
    const observations: Array<{
      operationIds: readonly string[];
      requestSha256: string | null;
      responseSha256: string;
      requestBytes: number;
      responseBytes: number;
    }> = [];
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ ok: true, data: { opId: 'response-op' } }),
    })));
    const client = new ReferenceSyncTransportClient({
      baseUrl: 'http://127.0.0.1:18481',
      sessionId: 'observed-session-2',
      observer: (observation) => observations.push(observation),
    });

    await client.stage({
      workspaceId: 'workspace-1',
      installationId: 'install-1',
      deviceId: 'device-1',
      operation: { op_id: 'request-op', record_id: 'record-1' } as never,
    });

    expect(observations[0]?.operationIds).toEqual(['request-op', 'response-op']);
    expect(observations[0]?.requestSha256).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(observations[0]?.responseSha256).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(observations[0]?.requestBytes).toBeGreaterThan(0);
    expect(observations[0]?.responseBytes).toBeGreaterThan(0);
  });

  it('serializes request bodies with canonical JSON', async () => {
    let requestBody: string | null = null;
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      requestBody = typeof init?.body === 'string' ? init.body : null;
      return { ok: true, status: 200, text: async () => JSON.stringify({ ok: true, data: { status: 'ready', schemaVersion: 'utopia.reference-sync-transport.v1', statePath: '/tmp/state.json' } }) };
    }));
    const client = new ReferenceSyncTransportClient({ baseUrl: 'http://127.0.0.1:18481', sessionId: 'deterministic-session' });
    await client.stage({ workspaceId: 'workspace-1', installationId: 'install-1', deviceId: 'device-1', operation: { zeta: 'one', op_id: 'request-op', record_id: 'record-1', alpha: 1 } as never });
    expect(requestBody).toBe(canonicalJson({
      schemaVersion: SHARED_STATE_SYNC_SCHEMA_VERSION,
      workspaceId: 'workspace-1',
      installationId: 'install-1',
      deviceId: 'device-1',
      operation: { zeta: 'one', op_id: 'request-op', record_id: 'record-1', alpha: 1 },
    }));
  });

  it('fails closed for a malformed response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, text: async () => 'not-json' })));
    const client = new ReferenceSyncTransportClient({ baseUrl: 'http://127.0.0.1:18481', sessionId: 'non-json-session' });
    await expect(client.health()).rejects.toThrow('reference_sync_transport_response_malformed_json');
  });

  it('fails closed before network access when the relay URL is unavailable', () => {
    expect(() => createReferenceSyncTransportAdapter({ baseUrl: 'not-a-url' })).toThrow(
      'reference_sync_transport_unavailable:invalid_base_url',
    );
  });

  it('rejects invalid tenant identifiers before issuing a request', async () => {
    const client = new ReferenceSyncTransportClient({
      baseUrl: 'http://127.0.0.1:18481',
      sessionId: 'observed-session-3',
    });
    await expect(client.stage({
      workspaceId: '../bad',
      installationId: 'install-1',
      deviceId: 'device-1',
      operation: { op_id: 'request-op' } as never,
    })).rejects.toThrow('reference_sync_transport_invalid_workspaceId');
  });

  it('rejects tenant echo mismatches from server responses', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ ok: true, data: { workspaceId: 'other-workspace' } }),
    })));
    const client = new ReferenceSyncTransportClient({
      baseUrl: 'http://127.0.0.1:18481',
      sessionId: 'observed-session-4',
    });
    await expect(client.stage({
      workspaceId: 'workspace-1',
      installationId: 'install-1',
      deviceId: 'device-1',
      operation: { op_id: 'request-op' } as never,
    })).rejects.toThrow('reference_sync_transport_tenant_mismatch:workspaceId');
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
