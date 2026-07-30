import type {
  SharedStateSyncEnvelope,
  SharedStateSyncRecoveryResult,
  SharedStateSyncSnapshot,
  SharedStateSyncStageResult,
  SharedStateSyncSyncResult,
} from '@/src/providers/shared-state-sync';
import { SHARED_STATE_SYNC_SCHEMA_VERSION } from '@/src/providers/shared-state-sync';

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

export type ReferenceSyncTransportHealth = {
  status: 'ready';
  schemaVersion: string;
  statePath: string;
};

export class ReferenceSyncTransportClient {
  private readonly baseUrl: string;
  private readonly schemaVersion: string;

  constructor(input: { baseUrl: string; schemaVersion?: string }) {
    this.baseUrl = input.baseUrl.replace(/\/$/, '');
    this.schemaVersion = input.schemaVersion ?? SHARED_STATE_SYNC_SCHEMA_VERSION;
  }

  async stage(input: {
    schemaVersion?: string;
    workspaceId: string;
    installationId: string;
    deviceId: string;
    operation: SharedStateSyncEnvelope['operation'];
  }): Promise<SharedStateSyncStageResult> {
    return this.post<SharedStateSyncStageResult>(referenceSyncTransportPaths.stage, {
      schemaVersion: input.schemaVersion ?? this.schemaVersion,
      workspaceId: input.workspaceId,
      installationId: input.installationId,
      deviceId: input.deviceId,
      operation: input.operation,
    });
  }

  async sync(input: {
    schemaVersion?: string;
    workspaceId: string;
    installationId: string;
    deviceId: string;
  }): Promise<SharedStateSyncSyncResult> {
    return this.post<SharedStateSyncSyncResult>(referenceSyncTransportPaths.sync, {
      schemaVersion: input.schemaVersion ?? this.schemaVersion,
      workspaceId: input.workspaceId,
      installationId: input.installationId,
      deviceId: input.deviceId,
    });
  }

  async snapshot(input: {
    schemaVersion?: string;
    workspaceId: string;
    installationId: string;
  }): Promise<SharedStateSyncSnapshot> {
    return this.post<SharedStateSyncSnapshot>(referenceSyncTransportPaths.snapshot, {
      schemaVersion: input.schemaVersion ?? this.schemaVersion,
      workspaceId: input.workspaceId,
      installationId: input.installationId,
    });
  }

  async loseDevice(input: {
    schemaVersion?: string;
    workspaceId: string;
    installationId: string;
    deviceId: string;
  }): Promise<void> {
    await this.post<{ ok: true }>(referenceSyncTransportPaths.loseDevice, {
      schemaVersion: input.schemaVersion ?? this.schemaVersion,
      workspaceId: input.workspaceId,
      installationId: input.installationId,
      deviceId: input.deviceId,
    });
  }

  async recoverDevice(input: {
    schemaVersion?: string;
    workspaceId: string;
    installationId: string;
    deviceId: string;
  }): Promise<SharedStateSyncRecoveryResult> {
    return this.post<SharedStateSyncRecoveryResult>(referenceSyncTransportPaths.recoverDevice, {
      schemaVersion: input.schemaVersion ?? this.schemaVersion,
      workspaceId: input.workspaceId,
      installationId: input.installationId,
      deviceId: input.deviceId,
    });
  }

  async health(): Promise<ReferenceSyncTransportHealth> {
    const response = await this.request<ReferenceSyncTransportHealth>(referenceSyncTransportPaths.health, {
      method: 'GET',
    });
    return response.data;
  }

  private async request<T>(path: string, init: { method?: 'GET' | 'POST'; body?: unknown } = {}): Promise<{ ok: true; data: T }> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: init.method ?? 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    const payload = (await response.json().catch(() => null)) as {
      ok?: boolean;
      data?: T;
      error?: string;
    };

    if (!response.ok || !payload || payload.ok !== true) {
      throw new Error(`reference sync transport request failed (${response.status}): ${String(payload?.error ?? 'unknown')}`);
    }

    return { ok: true, data: payload.data as T };
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const response = await this.request<T>(path, { method: 'POST', body });
    return response.data;
  }
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
