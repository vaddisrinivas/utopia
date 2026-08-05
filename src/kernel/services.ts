import { applyPatch, compare } from 'fast-json-patch';
import { z } from 'zod';

import storage from './storage';
import { readSecret } from './security';
import { createDataHome, mergeWithConflicts, type DataHomeConfig, retry as retryAdapter } from './data-home';
import { parsePackage, type AppPackage } from './schema';
import type { AppState, JsonRecord } from './runtime';

type SyncQueue = { records: JsonRecord[]; receipts: AppState['receipts'] };
export type SecretResolver = (reference: string) => Promise<string | undefined> | string | undefined;
type SecretSources = Record<string, string | undefined> | SecretResolver;
type StorageLike = { getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<void> };
type DataState = { records: JsonRecord[]; cursor?: string };

type DataProvider = {
  pull(input: { cursor?: string; limit?: number }): Promise<DataState & { hasMore: boolean }>;
  push(input: { records: JsonRecord[]; cursor?: string }): Promise<{ cursor?: string }>;
};

const TENANT = 'UTOPIA_TENANT_ID';

export type Provider = {
  pull(cursor?: string): Promise<{ records: JsonRecord[]; cursor?: string }>;
  push(records: JsonRecord[], cursor?: string): Promise<{ cursor?: string }>;
};

export function compilePackage(source: unknown): AppPackage {
  return parsePackage(structuredClone(source));
}

function networkUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') throw new Error('HTTPS required');
  return url.toString();
}

const nowIso = () => new Date().toISOString();
const queueKey = (appId: string, homeId: string) => `utopia:${appId}:data-home:${homeId}:outbox`;

const dedupe = (records: JsonRecord[]) => {
  const out = new Map<string, JsonRecord>();
  for (const record of records) {
    const existing = out.get(record.id);
    if (!existing || record.updatedAt > existing.updatedAt) out.set(record.id, record);
  }
  return [...out.values()].sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
};

const appendReceipts = (state: AppState, items: NonNullable<AppState['receipts']>): AppState => ({
  ...state,
  receipts: [...(state.receipts ?? []).slice(-49), ...items].slice(-50),
});

async function readQueue(storageLike: StorageLike, appId: string, homeId: string): Promise<SyncQueue> {
  const raw = await storageLike.getItem(queueKey(appId, homeId));
  if (!raw) return { records: [], receipts: [] };
  try {
    const parsed = JSON.parse(raw) as SyncQueue;
    return { records: Array.isArray(parsed?.records) ? parsed.records : [], receipts: Array.isArray(parsed?.receipts) ? parsed.receipts : [] };
  } catch {
    return { records: [], receipts: [] };
  }
}

async function writeQueue(storageLike: StorageLike, appId: string, homeId: string, queue: SyncQueue): Promise<void> {
  await storageLike.setItem(queueKey(appId, homeId), JSON.stringify(queue));
}

const normalizeSecretSource = (input: SecretSources = {}): Record<string, string> | SecretResolver => {
  if (typeof input === 'function') return input;
  return Object.fromEntries(Object.entries(input).filter(([, value]) => typeof value === 'string' && value.length)) as Record<string, string>;
};

async function resolveSecret(source: SecretSources, ref: string) {
  const normalized = normalizeSecretSource(source);
  if (typeof normalized === 'function') return normalized(ref);
  return normalized[ref];
}

function receiptForConflict(config: string, recordId: string) {
  return { id: `${config}:${recordId}:${nowIso()}`, operation: 'conflict', status: 'unavailable', at: nowIso(), recordId } as const;
}

function offlineUnavailable(config: string, operation: 'sync' | 'pull') {
  return { id: `${config}:${operation}-unavailable:${nowIso()}`, operation, status: 'unavailable', at: nowIso() } as const;
}

async function syncModeSync(
  config: DataHomeConfig,
  state: AppState,
  queue: SyncQueue,
  provider: DataProvider,
  storageLike: StorageLike,
  appId: string,
  baseState: AppState,
) {
  const queueRecords = queue.records.filter((record) => record && record.id);
  const localState = dedupe([...baseState.records, ...queue.records]);
  let remote: JsonRecord[] = [];
  try {
    remote = await (async function pullAll() {
      let cursor: string | undefined;
      const output: JsonRecord[] = [];
      for (let page = 0; page < 64; page += 1) {
        const result = await provider.pull({ cursor, limit: 200 });
        output.push(...result.records);
        if (!result.hasMore || !result.cursor || result.cursor === cursor) break;
        cursor = result.cursor;
      }
      return output;
    })();

    const { merged, conflicts } = mergeWithConflicts(localState, remote);
    const records = dedupe([...merged, ...queueRecords]);
    const mergedReceipt = conflicts.length ? conflicts.map((recordId) => receiptForConflict(config.id, recordId)) : [];

    if (config.mode === 'pull') return appendReceipts({ records }, mergedReceipt);

    try {
      const result = await provider.push({ records: dedupe([...records, ...queue.records]) });
      await writeQueue(storageLike, appId, config.id, { records: [], receipts: [] });
      return appendReceipts({ records, receipts: queue.receipts }, [...(queue.receipts ?? []), ...mergedReceipt, {
        id: result.cursor ?? `sync:${nowIso()}`,
        operation: 'sync', status: 'completed', at: nowIso(),
      }]);
    } catch {
      await writeQueue(storageLike, appId, config.id, { records: dedupe([...records, ...remote, ...localState]), receipts: dedupeReceipts(queue, mergedReceipt) });
      const receipts = dedupeReceipts(queue, [...mergedReceipt, { id: `offline:${nowIso()}`, operation: 'sync', status: 'unavailable', at: nowIso() }]);
      return appendReceipts({ records }, receipts);
    }
  } catch {
    const merged = dedupe([...localState, ...remote, ...queueRecords]);
    if (remote.length === 0) return appendReceipts({ records: dedupe([...localState, ...queueRecords]), receipts: queue.receipts }, [
      offlineUnavailable(config.id, 'pull'),
    ]);
    return appendReceipts({ records: merged, receipts: queue.receipts }, [
      offlineUnavailable(config.id, 'sync'),
    ]);
  }
}

async function syncModePush(config: DataHomeConfig, state: AppState, queue: SyncQueue, provider: DataProvider, storageLike: StorageLike, appId: string) {
  const merged = dedupe([...state.records, ...queue.records]);
  try {
    const result = await provider.push({ records: merged });
    await writeQueue(storageLike, appId, config.id, { records: [], receipts: [] });
    return appendReceipts({ ...state, receipts: [...(state.receipts ?? []), ...(queue.receipts ?? [])] }, [
      { id: result.cursor ?? '', operation: 'push', status: 'completed', at: nowIso() },
    ]);
  } catch {
    await writeQueue(storageLike, appId, config.id, {
      records: merged,
      receipts: dedupeReceipts(queue, [{ id: `offline:${nowIso()}`, operation: 'push', status: 'unavailable', at: nowIso() }]),
    });
    return appendReceipts({ ...state, receipts: [...(state.receipts ?? []), ...(queue.receipts ?? [])] }, [
      { id: `offline:${nowIso()}`, operation: 'push', status: 'unavailable', at: nowIso() },
    ]);
  }
}

function dedupeReceipts(queue: SyncQueue, extra: NonNullable<AppState['receipts']>) {
  return [...(queue.receipts ?? []).slice(-50), ...extra].slice(-50);
}

export function mergeState(local: AppState, remote: AppState): AppState {
  return { records: dedupe([...local.records, ...remote.records]), undo: local.undo, receipts: [...(local.receipts ?? []), ...(remote.receipts ?? [])] };
}

export function statePatch(before: AppState, after: AppState) {
  return compare(before, after);
}

export function applyStatePatch(state: AppState, patch: ReturnType<typeof statePatch>): AppState {
  return applyPatch(structuredClone(state), patch, true, false).newDocument;
}

const ChatResponse = z.object({ text: z.string(), toolCalls: z.array(z.unknown()).optional() });

export function httpProvider(url: string, headers: Record<string, string> = {}): Provider {
  const endpoint = networkUrl(url);
  const request = async (body: unknown) => {
    const response = await retryAdapter(async () => {
      const result = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
      if (!result.ok) throw new Error(`Provider HTTP ${result.status}`);
      return result.json() as Promise<{ records?: JsonRecord[]; cursor?: string }>;
    }, 3);

    return response;
  };
  return {
    pull(cursor) {
      return request({ operation: 'pull', cursor }).then((result) => ({ records: result.records ?? [], cursor: result.cursor }));
    },
    push(records, cursor) {
      return request({ operation: 'push', records, cursor });
    },
  };
}

export async function syncDataHome(
  pkg: AppPackage,
  state: AppState,
  _baseUrl: string,
  id = pkg.defaultDataHome,
  storageLike: StorageLike = storage,
  secretSources: SecretSources = readSecret,
): Promise<AppState> {
  const config = pkg.dataHomes.find((home) => home.id === id);
  if (!config) return appendReceipts(state, [{ id: `${id}:missing:${nowIso()}`, operation: 'sync', status: 'unavailable', at: nowIso() }]);
  if (config.kind === 'sqlite' || config.mode === 'local') return state;

  let provider: DataProvider;
  try {
    const tenantId = await resolveSecret(secretSources, TENANT);
    const credential = await resolveSecret(secretSources, config.secretRef ?? '');
    if (!tenantId) throw new Error('UTOPIA_TENANT_ID missing');
    if (!credential) throw new Error(`credential missing for ${config.secretRef ?? 'home'}`);
    provider = createDataHome(config as DataHomeConfig, { [config.secretRef || '']: credential }, storageLike, _baseUrl, { appId: pkg.id, tenantId });
  } catch {
    return appendReceipts(state, [{ id: `${config.id}:provider:${nowIso()}`, operation: 'sync', status: 'unavailable', at: nowIso() }]);
  }

  const queue = await readQueue(storageLike, pkg.id, config.id);
  if (config.mode === 'push') return syncModePush(config, state, queue, provider, storageLike, pkg.id);
  if (config.mode === 'sync' || config.mode === 'pull') return syncModeSync(config, state, queue, provider, storageLike, pkg.id, state);

  return appendReceipts(state, [{ id: `${config.id}:mode:${nowIso()}`, operation: 'sync', status: 'unavailable', at: nowIso() }]);
}

export async function chat(endpoint: string, messages: Array<{ role: 'user' | 'assistant'; content: string }>, context: unknown = {}) {
  const requestId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}`;
  const response = await fetch(networkUrl(endpoint), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ requestId, messages, context }),
  });
  if (!response.ok) throw new Error(`Chat HTTP ${response.status}`);
  return ChatResponse.parse(await response.json());
}
