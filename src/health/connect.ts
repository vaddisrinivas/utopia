import {
  defaultHealthConnectPorts,
  HEALTH_CONNECT_SDK_AVAILABLE,
  HEALTH_CONNECT_SDK_UNAVAILABLE,
  HEALTH_CONNECT_SDK_UPDATE_REQUIRED,
  type HealthPermission,
  type HealthConnectPlatformPort,
  type HealthConnectPorts,
  type HealthConnectSdkPort,
} from '@/src/health/connect.ports';

export const LIFEOS_HEALTH_PERMISSIONS = [
  { accessType: 'read', recordType: 'Nutrition' },
  { accessType: 'read', recordType: 'Hydration' },
  { accessType: 'read', recordType: 'Steps' },
  { accessType: 'read', recordType: 'ActiveCaloriesBurned' },
  { accessType: 'read', recordType: 'Weight' },
  { accessType: 'write', recordType: 'Hydration' },
] as const;

export type HealthConnectAvailability =
  | 'available'
  | 'provider-update-required'
  | 'unavailable'
  | 'unsupported'
  | 'error';

export type HealthConnectStatus = {
  availability: HealthConnectAvailability;
  granted: string[];
  message: string;
};

export type HealthConnectSnapshot = HealthConnectStatus & {
  observedAt: string;
  range: { startTime: string; endTime: string };
  records: {
    nutrition: unknown[];
    hydration: unknown[];
    steps: unknown[];
    activeCalories: unknown[];
    weight: unknown[];
  };
};

export type HealthConnectSnapshotSummary = {
  id: string;
  provider: 'health_connect';
  availability: string;
  granted: string[];
  observed_at: string;
  range: { start_time: string; end_time: string };
  record_counts: {
    nutrition: number;
    hydration: number;
    steps: number;
    activeCalories: number;
    weight: number;
  };
  content_hash: string;
};

export type HealthConnectRoundTripProof = {
  status: 'passed' | 'failed' | 'unsupported';
  message: string;
  clientRecordId: string;
  insertedIds: string[];
  readBeforeDelete: number;
  readAfterDelete: number;
  observedAt: string;
};

function unsupportedStatus(): HealthConnectStatus {
  return {
    availability: 'unsupported',
    granted: [],
    message: 'Health Connect is available on Android only.',
  };
}

function toGrantedKeys(permissions: HealthPermission[]): string[] {
  return permissions.map((permission) => `${permission.accessType}:${permission.recordType}`);
}

function mapStatusFromSdk(value: number, granted: string[]): HealthConnectStatus {
  if (value === HEALTH_CONNECT_SDK_AVAILABLE) {
    return { availability: 'available', granted, message: 'Health Connect is available.' };
  }
  if (value === HEALTH_CONNECT_SDK_UPDATE_REQUIRED) {
    return {
      availability: 'provider-update-required',
      granted,
      message: 'Update Health Connect, then try again.',
    };
  }
  if (value === HEALTH_CONNECT_SDK_UNAVAILABLE) {
    return {
      availability: 'unavailable',
      granted,
      message: 'Health Connect is not available on this device.',
    };
  }
  return {
    availability: 'error',
    granted,
    message: 'Health Connect availability is unknown.',
  };
}

export async function getUtopiaHealthStatus(ports = defaultHealthConnectPorts): Promise<HealthConnectStatus> {
  if (!ports.platform.isAndroid()) {
    return unsupportedStatus();
  }

  try {
    const [sdkStatus, granted] = await Promise.all([
      ports.sdk.getSdkStatus(),
      ports.sdk.getGrantedPermissions().catch(() => []),
    ]);
    return mapStatusFromSdk(
      sdkStatus,
      toGrantedKeys(granted),
    );
  } catch (error) {
    return {
      availability: 'error',
      granted: [],
      message: error instanceof Error ? error.message : 'Health Connect status failed.',
    };
  }
}

export async function requestUtopiaHealthPermissions(ports = defaultHealthConnectPorts): Promise<HealthConnectStatus> {
  if (!ports.platform.isAndroid()) {
    return unsupportedStatus();
  }

  try {
    const initialized = await ports.sdk.initialize();
    if (!initialized) {
      return {
        availability: 'unavailable',
        granted: [],
        message: 'Health Connect could not be initialized.',
      };
    }
    await ports.sdk.requestPermission(LIFEOS_HEALTH_PERMISSIONS);
    return getUtopiaHealthStatus(ports);
  } catch (error) {
    return {
      availability: 'error',
      granted: [],
      message: error instanceof Error ? error.message : 'Health Connect permission request failed.',
    };
  }
}

export async function openUtopiaHealthSettings(ports = defaultHealthConnectPorts): Promise<boolean> {
  if (!ports.platform.isAndroid()) return false;
  try {
    await ports.navigation.openURL('utopia://health-connect');
    return true;
  } catch {
    return false;
  }
}

export async function readUtopiaHealthSnapshot(
  range: { startTime: string; endTime: string },
  ports = defaultHealthConnectPorts,
): Promise<HealthConnectSnapshot> {
  const availability = await getUtopiaHealthStatus(ports);
  let status = availability;
  if (status.availability === 'available') {
    try {
      const initialized = await ports.sdk.initialize();
      if (!initialized) {
        status = {
          ...status,
          availability: 'error',
          message: 'Health Connect could not be initialized for reading.',
        };
      } else {
        status = await getUtopiaHealthStatus(ports);
      }
    } catch (error) {
      status = {
        ...status,
        availability: 'error',
        message: error instanceof Error ? error.message : 'Health Connect read initialization failed.',
      };
    }
  }

  const base = {
    ...status,
    observedAt: new Date().toISOString(),
    range,
    records: {
      nutrition: [],
      hydration: [],
      steps: [],
      activeCalories: [],
      weight: [],
    },
  } satisfies HealthConnectSnapshot;

  if (status.availability !== 'available') {
    return base;
  }

  const timeRangeFilter = { operator: 'between' as const, ...range };
  const read = async (
    recordType: 'Nutrition' | 'Hydration' | 'Steps' | 'ActiveCaloriesBurned' | 'Weight',
  ) => {
    try {
      const result = await ports.sdk.readRecords(recordType, { timeRangeFilter });
      return result.records ?? [];
    } catch {
      return [];
    }
  };

  const [nutrition, hydration, steps, activeCalories, weight] = await Promise.all([
    read('Nutrition'),
    read('Hydration'),
    read('Steps'),
    read('ActiveCaloriesBurned'),
    read('Weight'),
  ]);

  return {
    ...base,
    records: { nutrition, hydration, steps, activeCalories, weight },
  };
}

export async function runUtopiaHealthRoundTripProof(ports = defaultHealthConnectPorts): Promise<HealthConnectRoundTripProof> {
  const observedAt = new Date().toISOString();
  const clientRecordId = `utopia-health-check-${Date.now()}`;
  if (!ports.platform.isAndroid()) {
    return {
      status: 'unsupported',
      message: 'Health Connect check runs on Android.',
      clientRecordId,
      insertedIds: [],
      readBeforeDelete: 0,
      readAfterDelete: 0,
      observedAt,
    };
  }

  const start = new Date(Date.now() - 60_000).toISOString();
  const end = new Date(Date.now() + 60_000).toISOString();
  const proofRecord = {
    recordType: 'Hydration' as const,
    startTime: start,
    endTime: end,
    volume: { value: 250, unit: 'milliliters' as const },
    metadata: { clientRecordId, clientRecordVersion: 1, recordingMethod: 3 },
  };

  const readProofRecords = async () => {
    const result = await ports.sdk.readRecords('Hydration', {
      timeRangeFilter: { operator: 'between', startTime: start, endTime: end },
    });
    return (result.records ?? []).filter((record) => (record as { metadata?: { clientRecordId?: string } })?.metadata?.clientRecordId === clientRecordId);
  };

  try {
    const initialized = await ports.sdk.initialize();
    if (!initialized) throw new Error('Health Connect could not be initialized.');
    const status = await getUtopiaHealthStatus(ports);
    for (const required of ['read:Hydration', 'write:Hydration']) {
      if (!status.granted.includes(required)) throw new Error(`Missing Health Connect permission: ${required}`);
    }

    const insertedIds = await ports.sdk.insertRecords([proofRecord]);
    const before = await readProofRecords();
    await ports.sdk.deleteRecordsByUuids('Hydration', insertedIds, [clientRecordId]);
    const after = await readProofRecords();

    const passed = before.length > 0 && after.length === 0;
    return {
      status: passed ? 'passed' : 'failed',
      message: passed
        ? 'Health Connect write → read → delete check passed.'
        : 'Health Connect check could not verify read/delete cleanup.',
      clientRecordId,
      insertedIds,
      readBeforeDelete: before.length,
      readAfterDelete: after.length,
      observedAt,
    };
  } catch (error) {
    return {
      status: 'failed',
      message: error instanceof Error ? error.message : 'Health Connect check failed.',
      clientRecordId,
      insertedIds: [],
      readBeforeDelete: 0,
      readAfterDelete: 0,
      observedAt,
    };
  }
}

export async function syncUtopiaHealthSnapshot(
  input: {
    baseUrl: string;
    token?: string;
    snapshot: HealthConnectSnapshot;
    signal?: AbortSignal;
  },
  ports = defaultHealthConnectPorts,
): Promise<{ status: 'stored' | 'duplicate' | 'error'; id?: string; message: string } | null> {
  const baseUrl = input.baseUrl.trim().replace(/\/$/, '');
  if (!baseUrl) return null;
  try {
    const response = await ports.http.request(`${baseUrl}/health/connect/snapshot`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(input.token?.trim() ? { authorization: `Bearer ${input.token.trim()}` } : {}),
      },
      body: JSON.stringify(input.snapshot),
      signal: input.signal,
    });
    const payload = (await response.json().catch(() => null)) as { status?: 'stored' | 'duplicate'; message?: string; snapshot?: { id?: string } } | null;
    if (!response.ok || !payload) return { status: 'error', message: payload?.message || 'Health snapshot sync failed.' };
    return { status: payload.status || 'error', id: payload.snapshot?.id, message: payload.message || 'Health snapshot synced.' };
  } catch (error) {
    return { status: 'error', message: error instanceof Error ? error.message : 'Health snapshot sync failed.' };
  }
}

export async function listUtopiaHealthSnapshots(
  input: {
    baseUrl: string;
    token?: string;
    signal?: AbortSignal;
  },
  ports = defaultHealthConnectPorts,
): Promise<HealthConnectSnapshotSummary[]> {
  const baseUrl = input.baseUrl.trim().replace(/\/$/, '');
  if (!baseUrl) return [];
  try {
    const response = await ports.http.request(`${baseUrl}/health/connect/snapshots`, {
      headers: { ...(input.token?.trim() ? { authorization: `Bearer ${input.token.trim()}` } : {}) },
      signal: input.signal,
    });
    if (!response.ok) return [];
    const payload = (await response.json().catch(() => null)) as { snapshots?: HealthConnectSnapshotSummary[] } | null;
    return Array.isArray(payload?.snapshots) ? payload.snapshots : [];
  } catch {
    return [];
  }
}

export async function deleteUtopiaHealthSnapshot(
  input: {
    baseUrl: string;
    token?: string;
    id: string;
    signal?: AbortSignal;
  },
  ports = defaultHealthConnectPorts,
): Promise<{ status: 'deleted' | 'not_found' | 'error'; message: string }> {
  const baseUrl = input.baseUrl.trim().replace(/\/$/, '');
  if (!baseUrl || !input.id.trim()) return { status: 'error', message: 'Health snapshot id is required.' };
  try {
    const response = await ports.http.request(`${baseUrl}/health/connect/snapshot/${encodeURIComponent(input.id.trim())}`, {
      method: 'DELETE',
      headers: { ...(input.token?.trim() ? { authorization: `Bearer ${input.token.trim()}` } : {}) },
      signal: input.signal,
    });
    const payload = (await response.json().catch(() => null)) as { status?: 'deleted' | 'error'; message?: string } | null;
    if (response.status === 404) return { status: 'not_found', message: payload?.message || 'Health snapshot not found.' };
    if (!response.ok) return { status: 'error', message: payload?.message || 'Health snapshot delete failed.' };
    return { status: 'deleted', message: payload?.message || 'Health snapshot deleted.' };
  } catch (error) {
    return { status: 'error', message: error instanceof Error ? error.message : 'Health snapshot delete failed.' };
  }
}

export function healthConnectExportUrl(baseUrl: string) {
  const normalized = baseUrl.trim().replace(/\/$/, '');
  return normalized ? `${normalized}/health/connect/export` : '';
}

export { defaultHealthConnectPorts };
export type { HealthConnectPorts, HealthConnectPlatformPort, HealthConnectSdkPort };
