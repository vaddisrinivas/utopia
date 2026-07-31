import type {
  SharedStateSyncEnvelope,
  SharedStateSyncRecoveryResult,
  SharedStateSyncSnapshot,
  SharedStateSyncStageResult,
  SharedStateSyncSyncResult,
} from '@/src/providers/shared-state-sync';
import { SHARED_STATE_SYNC_SCHEMA_VERSION } from '@/src/providers/shared-state-sync';
import type { SyncTransportPortContract } from '@/packages/shared/contracts/sync-transport';
import { SYNC_TRANSPORT_SCHEMA_VERSION } from '@/packages/shared/contracts/sync-transport';
import { canonicalJson } from '@/packages/shared/contracts/canonical-json';
import { sha256 } from 'js-sha256';

export type ReferenceSyncPath =
  | '/reference-sync/health'
  | '/reference-sync/v1/stage'
  | '/reference-sync/v1/sync'
  | '/reference-sync/v1/snapshot'
  | '/reference-sync/v1/lose-device'
  | '/reference-sync/v1/recover-device';

export const referenceSyncTransportPaths = {
  health: '/reference-sync/health',
  stage: '/reference-sync/v1/stage',
  sync: '/reference-sync/v1/sync',
  snapshot: '/reference-sync/v1/snapshot',
  loseDevice: '/reference-sync/v1/lose-device',
  recoverDevice: '/reference-sync/v1/recover-device',
} as const satisfies Record<string, ReferenceSyncPath>;

export const REFERENCE_SYNC_TRANSPORT_SCHEMA_VERSION = 'utopia.reference-sync-transport.v1' as const;
const TENANT_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,126}[a-z0-9]$|^[a-z0-9]$/i;
const TENANT_ID_MAX_LENGTH = 64;
const REFERENCE_SYNC_REQUEST_BODY_BYTES_MAX = 64 * 1024;
const REFERENCE_SYNC_RESPONSE_BYTES_MAX = 256 * 1024;
const REFERENCE_SYNC_REQUEST_TIMEOUT_MS = 8_000;

export type ReferenceSyncTransportHealth = {
  status: 'ready';
  schemaVersion: string;
  statePath: string;
};

export const referenceSyncTransportContract: SyncTransportPortContract = {
  schemaVersion: SYNC_TRANSPORT_SCHEMA_VERSION,
  transport: {
    kind: 'vendor-neutral-operation-stream',
    requiredCaps: ['append_operations', 'per_installation', 'cursor_checkpoint', 'offline_replay'],
    optionalCaps: ['tombstones', 'conflict_manual_review'],
  },
  readiness: {
    localDeterministic: { status: 'PASS' },
    liveProviderDevice: {
      status: 'BLOCKED',
      requiredNextProof: 'Run the web or Android driver against the reference relay and retain observed transport artifacts.',
    },
  },
  status: 'SUPPORTED',
  reason: 'Reference operation-stream adapter; live device proof remains artifact-gated.',
};

export type ReferenceSyncTransportObservation = Readonly<{
  path: ReferenceSyncPath;
  endpoint: string;
  session: string;
  method: 'GET' | 'POST';
  status: number;
  ok: boolean;
  observedAt: string;
  requestBytes: number;
  requestSha256: string | null;
  responseBytes: number;
  responseSha256: string;
  operationIds: readonly string[];
}>;

export type ReferenceSyncTransportObserver = (observation: ReferenceSyncTransportObservation) => void;

export type ReferenceSyncTransportAdapter = Readonly<{
  contract: SyncTransportPortContract;
  client: ReferenceSyncTransportClient;
}>;

export class ReferenceSyncTransportClient {
  private readonly baseUrl: string;
  private readonly schemaVersion: string;
  private readonly sessionId: string;
  private readonly observer?: ReferenceSyncTransportObserver;

  constructor(input: {
    baseUrl: string;
    schemaVersion?: string;
    sessionId?: string;
    observer?: ReferenceSyncTransportObserver;
  }) {
    this.baseUrl = input.baseUrl.replace(/\/$/, '');
    this.schemaVersion = input.schemaVersion ?? SHARED_STATE_SYNC_SCHEMA_VERSION;
    this.sessionId = input.sessionId?.trim() || `reference-sync-${Date.now().toString(36)}`;
    this.observer = input.observer;
  }

  async stage(input: {
    schemaVersion?: string;
    workspaceId: string;
    installationId: string;
    deviceId: string;
    operation: SharedStateSyncEnvelope['operation'];
  }): Promise<SharedStateSyncStageResult> {
    assertTenantContext(input);
    return this.post<SharedStateSyncStageResult>(referenceSyncTransportPaths.stage, {
      schemaVersion: input.schemaVersion ?? this.schemaVersion,
      workspaceId: input.workspaceId,
      installationId: input.installationId,
      deviceId: input.deviceId,
      operation: input.operation,
    }, input);
  }

  async sync(input: {
    schemaVersion?: string;
    workspaceId: string;
    installationId: string;
    deviceId: string;
  }): Promise<SharedStateSyncSyncResult> {
    assertTenantContext(input);
    return this.post<SharedStateSyncSyncResult>(referenceSyncTransportPaths.sync, {
      schemaVersion: input.schemaVersion ?? this.schemaVersion,
      workspaceId: input.workspaceId,
      installationId: input.installationId,
      deviceId: input.deviceId,
    }, input);
  }

  async snapshot(input: {
    schemaVersion?: string;
    workspaceId: string;
    installationId: string;
  }): Promise<SharedStateSyncSnapshot> {
    assertTenantContext(input);
    return this.post<SharedStateSyncSnapshot>(referenceSyncTransportPaths.snapshot, {
      schemaVersion: input.schemaVersion ?? this.schemaVersion,
      workspaceId: input.workspaceId,
      installationId: input.installationId,
    }, input);
  }

  async loseDevice(input: {
    schemaVersion?: string;
    workspaceId: string;
    installationId: string;
    deviceId: string;
  }): Promise<void> {
    assertTenantContext(input);
    await this.post<{ ok: true }>(referenceSyncTransportPaths.loseDevice, {
      schemaVersion: input.schemaVersion ?? this.schemaVersion,
      workspaceId: input.workspaceId,
      installationId: input.installationId,
      deviceId: input.deviceId,
    }, input);
  }

  async recoverDevice(input: {
    schemaVersion?: string;
    workspaceId: string;
    installationId: string;
    deviceId: string;
  }): Promise<SharedStateSyncRecoveryResult> {
    assertTenantContext(input);
    return this.post<SharedStateSyncRecoveryResult>(referenceSyncTransportPaths.recoverDevice, {
      schemaVersion: input.schemaVersion ?? this.schemaVersion,
      workspaceId: input.workspaceId,
      installationId: input.installationId,
      deviceId: input.deviceId,
    }, input);
  }

  async health(): Promise<ReferenceSyncTransportHealth> {
    const response = await this.request<ReferenceSyncTransportHealth>(referenceSyncTransportPaths.health, {
      method: 'GET',
    });
    if (response.data.schemaVersion !== REFERENCE_SYNC_TRANSPORT_SCHEMA_VERSION) {
      throw new Error(`reference sync transport health schema mismatch: ${response.data.schemaVersion}`);
    }
    return response.data;
  }

  private async request<T>(
    path: string,
    init: { method?: 'GET' | 'POST'; body?: unknown } = {},
    tenant: TenantContext | null = null,
  ): Promise<{ ok: true; data: T }> {
    const method = init.method ?? 'POST';
    const requestBody = init.body === undefined ? null : canonicalJson(init.body);
    if (requestBody !== null && requestBody.length > REFERENCE_SYNC_REQUEST_BODY_BYTES_MAX) throw new Error('reference_sync_transport_request_too_large');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REFERENCE_SYNC_REQUEST_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: { 'content-type': 'application/json', 'x-utopia-sync-session': this.sessionId },
        body: requestBody ?? undefined,
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw new Error('reference_sync_transport_request_timeout');
      throw error;
    } finally {
      clearTimeout(timeout);
    }
    const responseBody = await response.text();
    if (responseBody.length > REFERENCE_SYNC_RESPONSE_BYTES_MAX) throw new Error('reference_sync_transport_response_too_large');
    const payload = safeJsonParse(responseBody);
    if (!isJsonObject(payload)) throw new Error(`reference_sync_transport_response_malformed_json:${response.status}`);
    const responseData = isJsonObject(payload.data) ? payload.data : {};
    assertTenantEcho(responseData, tenant);
    const requestData = requestBody ? safeJsonParse(requestBody) : null;
    const requestOperation = isJsonObject(requestData) && isJsonObject(requestData.operation)
      ? requestData.operation
      : {};
    const operationIds = [
      requestOperation.op_id,
      responseData.opId,
      responseData.operationId,
      ...(Array.isArray(responseData.operationIds) ? responseData.operationIds : []),
    ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
    this.observer?.({
      path: path as ReferenceSyncPath,
      endpoint: `${this.baseUrl}${path}`,
      session: this.sessionId,
      method,
      status: response.status,
      ok: response.ok && payload.ok === true,
      observedAt: new Date().toISOString(),
      requestBytes: requestBody?.length ?? 0,
      requestSha256: requestBody ? `sha256:${sha256(requestBody)}` : null,
      responseBytes: responseBody.length,
      responseSha256: `sha256:${sha256(responseBody)}`,
      operationIds: [...new Set(operationIds)],
    });

    if (!response.ok || payload.ok !== true) {
      throw new Error(`reference sync transport request failed (${response.status}): ${String(payload.error ?? 'unknown')}`);
    }

    return { ok: true, data: payload.data as T };
  }

  private async post<T>(path: string, body: unknown, tenant?: TenantContext): Promise<T> {
    const response = await this.request<T>(path, { method: 'POST', body }, tenant);
    return response.data;
  }
}

function safeJsonParse(value: string): unknown {
  try { return JSON.parse(value); } catch { return null; }
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

type TenantContext = {
  workspaceId?: string;
  installationId?: string;
  deviceId?: string;
};

function assertTenantContext(input: { workspaceId: string; installationId: string; deviceId?: string }): void {
  assertTenantId('workspaceId', input.workspaceId);
  assertTenantId('installationId', input.installationId);
  if (input.deviceId !== undefined) {
    assertTenantId('deviceId', input.deviceId);
  }
}

function assertTenantId(name: 'workspaceId' | 'installationId' | 'deviceId', value: string): void {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`reference_sync_transport_invalid_${name}`);
  }
  if (value.length > TENANT_ID_MAX_LENGTH) {
    throw new Error(`reference_sync_transport_${name}_too_long`);
  }
  if (!TENANT_ID_PATTERN.test(value)) {
    throw new Error(`reference_sync_transport_invalid_${name}`);
  }
}

function assertTenantEcho(responseData: Record<string, unknown>, tenant: TenantContext | null): void {
  if (!tenant) return;
  for (const [name, actual] of Object.entries(tenant)) {
    if (typeof actual !== 'string' || actual.length === 0) continue;
    const value = responseData[name as keyof TenantContext];
    if (value !== undefined && value !== actual) {
      throw new Error(`reference_sync_transport_tenant_mismatch:${name}`);
    }
  }
}

export function createReferenceSyncTransportAdapter(input: {
  baseUrl: string;
  schemaVersion?: string;
  sessionId?: string;
}): ReferenceSyncTransportAdapter {
  if (!isReferenceSyncServerUrl(input.baseUrl)) {
    throw new Error('reference_sync_transport_unavailable:invalid_base_url');
  }
  return {
    contract: referenceSyncTransportContract,
    client: new ReferenceSyncTransportClient(input),
  };
}

export function isReferenceSyncServerUrl(input: string): input is string {
  if (typeof input !== 'string' || !input.trim()) return false;
  try {
    const url = new URL(input);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}
