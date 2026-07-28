import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export type HealthSnapshotInput = {
  availability?: string;
  granted?: unknown;
  observedAt?: string;
  range?: { startTime?: string; endTime?: string };
  records?: {
    nutrition?: unknown[];
    hydration?: unknown[];
    steps?: unknown[];
    activeCalories?: unknown[];
    weight?: unknown[];
  };
};

type StoredHealthSnapshot = {
  id: string;
  provider: 'health_connect';
  availability: string;
  granted: string[];
  observed_at: string;
  range: { start_time: string; end_time: string };
  records: Required<NonNullable<HealthSnapshotInput['records']>>;
  content_hash: string;
};

type HealthSnapshotState = { version: 1; snapshots: StoredHealthSnapshot[] };

function storagePath() {
  return process.env.LIFEOS_HEALTH_SNAPSHOTS_PATH?.trim() || `${process.cwd()}/server-data/health-connect-snapshots.json`;
}

function readState(path = storagePath()): HealthSnapshotState {
  if (!existsSync(path)) return { version: 1, snapshots: [] };
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as HealthSnapshotState;
    if (parsed && Array.isArray(parsed.snapshots)) return { version: 1, snapshots: parsed.snapshots };
  } catch {
    // Recover from a malformed local cache by starting a clean state.
  }
  return { version: 1, snapshots: [] };
}

function persist(state: HealthSnapshotState, path = storagePath()) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(state, null, 2), 'utf8');
}

function asText(value: unknown, fallback = '') {
  return typeof value === 'string' ? value.trim() : fallback;
}

function isIsoDate(value: string) {
  return Boolean(value) && Number.isFinite(Date.parse(value));
}

function asRecords(value: unknown): Required<NonNullable<HealthSnapshotInput['records']>> {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const list = (key: string) => Array.isArray(source[key]) ? source[key]!.slice(0, 1000) : [];
  return {
    nutrition: list('nutrition'),
    hydration: list('hydration'),
    steps: list('steps'),
    activeCalories: list('activeCalories'),
    weight: list('weight'),
  };
}

export function saveHealthSnapshot(input: HealthSnapshotInput) {
  const observedAt = asText(input.observedAt);
  const startTime = asText(input.range?.startTime);
  const endTime = asText(input.range?.endTime);
  if (!observedAt || !startTime || !endTime) {
    return { ok: false as const, status: 'invalid' as const, message: 'observedAt, range.startTime and range.endTime are required.' };
  }
  if (!isIsoDate(observedAt) || !isIsoDate(startTime) || !isIsoDate(endTime)) {
    return { ok: false as const, status: 'invalid' as const, message: 'Health snapshot timestamps must be valid ISO dates.' };
  }
  if (Date.parse(startTime) >= Date.parse(endTime)) {
    return { ok: false as const, status: 'invalid' as const, message: 'range.startTime must be before range.endTime.' };
  }

  const snapshot = {
    provider: 'health_connect' as const,
    availability: asText(input.availability, 'unknown'),
    granted: Array.isArray(input.granted) ? input.granted.filter((value): value is string => typeof value === 'string').slice(0, 32) : [],
    observed_at: observedAt,
    range: { start_time: startTime, end_time: endTime },
    records: asRecords(input.records),
  };
  const contentHash = createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
  const state = readState();
  const existing = state.snapshots.find((row) => row.content_hash === contentHash);
  if (existing) {
    return { ok: true as const, status: 'duplicate' as const, message: 'Health snapshot already stored.', snapshot: existing };
  }

  const stored: StoredHealthSnapshot = {
    ...snapshot,
    id: `health-connect-${contentHash.slice(0, 20)}`,
    content_hash: contentHash,
  };
  state.snapshots.push(stored);
  state.snapshots = state.snapshots.slice(-100);
  persist(state);
  return { ok: true as const, status: 'stored' as const, message: 'Health snapshot stored.', snapshot: stored };
}

export function listHealthSnapshots() {
  return readState().snapshots.map((snapshot) => ({
    id: snapshot.id,
    provider: snapshot.provider,
    availability: snapshot.availability,
    granted: snapshot.granted,
    observed_at: snapshot.observed_at,
    range: snapshot.range,
    record_counts: {
      nutrition: snapshot.records.nutrition.length,
      hydration: snapshot.records.hydration.length,
      steps: snapshot.records.steps.length,
      activeCalories: snapshot.records.activeCalories.length,
      weight: snapshot.records.weight.length,
    },
    content_hash: snapshot.content_hash,
  }));
}

/** Full-fidelity export used by backup/data-portability flows. */
export function exportHealthSnapshots() {
  return readState().snapshots.map((snapshot) => ({
    ...snapshot,
    records: {
      nutrition: snapshot.records.nutrition,
      hydration: snapshot.records.hydration,
      steps: snapshot.records.steps,
      activeCalories: snapshot.records.activeCalories,
      weight: snapshot.records.weight,
    },
  }));
}

export function deleteHealthSnapshot(id: string) {
  const normalizedId = id.trim();
  if (!normalizedId) return { ok: false as const, status: 'invalid' as const, message: 'Snapshot id is required.' };
  const path = storagePath();
  const state = readState(path);
  const index = state.snapshots.findIndex((snapshot) => snapshot.id === normalizedId);
  if (index < 0) return { ok: false as const, status: 'not_found' as const, message: 'Health snapshot not found.' };
  const [snapshot] = state.snapshots.splice(index, 1);
  persist(state, path);
  return { ok: true as const, status: 'deleted' as const, message: 'Health snapshot deleted.', snapshot: { id: snapshot.id } };
}
