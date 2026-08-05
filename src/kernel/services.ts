import { applyPatch, compare } from 'fast-json-patch';
import { z } from 'zod';

import storage from './storage';
import { createDataHome, mergeWithConflicts, type DataHomeConfig, retry as retryAdapter } from './data-home';
import { parsePackage, type AppPackage } from './schema';
import type { AppState, JsonRecord } from './runtime';

type SyncQueue = {
  records: JsonRecord[];
  receipts: AppState['receipts'];
};

type StorageLike = { getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<void> };

type DataState = { records: JsonRecord[]; cursor?: string };

type DataProvider = {
  pull(input: { cursor?: string; limit?: number }): Promise<DataState & { hasMore: boolean }>;
  push(input: { records: JsonRecord[]; cursor?: string }): Promise<{ cursor?: string }>;
};

export function compilePackage(source: unknown): AppPackage {
  return parsePackage(structuredClone(source));
}

export type Provider = {
  pull(cursor?: string): Promise<{ records: JsonRecord[]; cursor?: string }>;
  push(records: JsonRecord[], cursor?: string): Promise<{ cursor?: string }>;
};

function networkUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') throw new Error('HTTPS required');
  return url.toString();
}

async function retry<T>(operation: () => Promise<T>, attempts = 3): Promise<T> {
  try {
    return await retryAdapter(operation, attempts);
  } catch (cause) {
    throw cause;
  }
}

export function httpProvider(url: string, headers: Record<string, string> = {}): Provider {
  const endpoint = networkUrl(url);
  const request = async (body: unknown) => {
    return retry(async () => {
      const response = await fetch(endpoint, {
        method: 'POST', headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error(`Provider HTTP ${response.status}`);
      return response.json() as Promise<{ records?: JsonRecord[]; cursor?: string }>;
    }, 3);
  };
  return {
    async pull(cursor) { const result = await request({ operation: 'pull', cursor }); return { records: result.records ?? [], cursor: result.cursor }; },
    async push(records, cursor) { return request({ operation: 'push', records, cursor }); },
  };
}

function nowIso() {
  return new Date().toISOString();
}

function queueKey(appId: string, homeId: string) {
  return `utopia:${appId}:data-home:${homeId}:outbox`;
}

async function readQueue(storageLike: StorageLike, appId: string, homeId: string): Promise<SyncQueue> {
  const raw = await storageLike.getItem(queueKey(appId, homeId));
  if (!raw) return { records: [], receipts: [] };
  try {
    const parsed = JSON.parse(raw) as SyncQueue;
    return {
      records: Array.isArray(parsed?.records) ? parsed.records : [],
      receipts: Array.isArray(parsed?.receipts) ? parsed.receipts : [],
    };
  } catch {
    return { records: [], receipts: [] };
  }
}

async function writeQueue(storageLike: StorageLike, appId: string, homeId: string, queue: SyncQueue): Promise<void> {
  await storageLike.setItem(queueKey(appId, homeId), JSON.stringify(queue));
}

function appendReceipts(state: AppState, items: NonNullable<AppState['receipts']>): AppState {
  return { ...state, receipts: [...(state.receipts ?? []).slice(-49), ...items].slice(-50) };
}

async function pullAll(provider: DataProvider, limit = 200): Promise<JsonRecord[]> {
  let cursor: string | undefined;
  const output: JsonRecord[] = [];
  for (let page = 0; page < 64; page += 1) {
    const result = await provider.pull({ cursor, limit });
    output.push(...result.records);
    if (!result.hasMore || !result.cursor || result.cursor === cursor) break;
    cursor = result.cursor;
  }
  return output;
}

function dedupeRecords(values: JsonRecord[]): JsonRecord[] {
  const records = new Map<string, JsonRecord>();
  for (const record of values) {
    const existing = records.get(record.id);
    if (!existing || existing.updatedAt < record.updatedAt) records.set(record.id, record);
  }
  return [...records.values()].sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
}

function resolveSecrets(): Record<string, string> {
  const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env;
  return env && typeof env === 'object' ? env : {};
}

export async function syncDataHome(
  pkg: AppPackage,
  state: AppState,
  _baseUrl: string,
  id = pkg.defaultDataHome,
  storageLike: StorageLike = storage,
): Promise<AppState> {
  const config = pkg.dataHomes.find((home) => home.id === id);
  if (!config) return appendReceipts(state, [{ id: `${id}:missing:${nowIso()}`, operation: 'sync', status: 'unavailable', at: nowIso() }]);

  if (config.kind === 'sqlite' || config.mode === 'local') {
    return state;
  }

  let provider;
  try {
    provider = createDataHome(config as DataHomeConfig, resolveSecrets(), storageLike, _baseUrl);
  } catch (cause) {
    return appendReceipts(state, [{
      id: `${config.id}:provider:${nowIso()}`,
      operation: 'sync',
      status: 'unavailable',
      at: nowIso(),
    }]);
  }
  const queue = await readQueue(storageLike, pkg.id, config.id);
  const mergedWithQueue = dedupeRecords([...state.records, ...queue.records]);

  const queueRecords = queue.records.filter((record) => record && record.id);
  const receiptItems: NonNullable<AppState['receipts']> = [];

  const writeOfflineReceipt = (...items: NonNullable<AppState['receipts']>[number][]) => {
    receiptItems.push(...items);
  };

  const saveQueued = async (records: JsonRecord[]) => {
    await writeQueue(storageLike, pkg.id, config.id, {
      records: dedupeRecords(records),
      receipts: [...(queue.receipts ?? []).slice(-50), ...receiptItems].slice(-50),
    });
  };

  if (config.mode === 'push') {
    try {
      const result = await provider.push({ records: mergedWithQueue });
      await writeQueue(storageLike, pkg.id, config.id, { records: [], receipts: [] });
      return appendReceipts({ ...state, receipts: [...(state.receipts ?? []), ...(queue.receipts ?? [])] }, [
        { id: result.cursor ?? '', operation: 'push', status: 'completed', at: nowIso() },
      ]);
    } catch {
      await saveQueued(mergedWithQueue);
      return appendReceipts(
        { ...state, receipts: [...(state.receipts ?? []), ...(queue.receipts ?? [])] },
        [{ id: `offline:${nowIso()}`, operation: 'push', status: 'unavailable', at: nowIso() }],
      );
    }
  }

  if (config.mode === 'sync' || config.mode === 'pull') {
    let remoteRecords: JsonRecord[] = [];
    const mergedState = (records: JsonRecord[]): AppState => ({ records: dedupeRecords([...records, ...queueRecords]) });

    try {
      remoteRecords = await pullAll(provider);
      const { merged, conflicts } = mergeWithConflicts(state.records, remoteRecords);
      const nextState = mergedState(merged);
      if (conflicts.length) {
        writeOfflineReceipt(...conflicts.map((recordId): NonNullable<AppState['receipts']>[number] => ({
          id: `${config.id}:${recordId}:${nowIso()}`,
          operation: 'conflict',
          status: 'unavailable',
          at: nowIso(),
          recordId,
        })));
      }
      if (config.mode === 'pull') {
        return appendReceipts(nextState, [...(queue.receipts ?? []), ...receiptItems]);
      }

      try {
        const result = await provider.push({ records: dedupeRecords([...nextState.records, ...queue.records]) });
        await writeQueue(storageLike, pkg.id, config.id, { records: [], receipts: [] });
        return appendReceipts(
          nextState,
          [...(queue.receipts ?? []), ...receiptItems, { id: result.cursor ?? `sync:${nowIso()}`, operation: 'sync', status: 'completed', at: nowIso() }],
        );
      } catch {
        writeOfflineReceipt({ id: `offline:${nowIso()}`, operation: 'sync', status: 'unavailable', at: nowIso() });
        await saveQueued(dedupeRecords([...state.records, ...queueRecords, ...merged, ...remoteRecords]));
        return appendReceipts({ ...nextState, receipts: queue.receipts }, [...receiptItems, ...(queue.receipts ?? [])]);
      }
    } catch {
      if (remoteRecords.length === 0) {
        return appendReceipts(
          { records: dedupeRecords([...state.records, ...queueRecords]), receipts: queue.receipts },
          [{
            id: `${config.id}:pull-unavailable:${nowIso()}`,
            operation: 'pull',
            status: 'unavailable',
            at: nowIso(),
          }, ...receiptItems],
        );
      }
      return appendReceipts(
        { records: dedupeRecords([...state.records, ...queueRecords, ...remoteRecords]), receipts: queue.receipts },
        [{ id: `${config.id}:sync-error:${nowIso()}`, operation: 'sync', status: 'unavailable', at: nowIso() }, ...receiptItems],
      );
    }
  }

  return appendReceipts(state, [{
    id: `${config.id}:mode:${nowIso()}`,
    operation: 'sync',
    status: 'unavailable',
    at: nowIso(),
  }]);
}

export function mergeState(local: AppState, remote: AppState): AppState {
  return {
    records: dedupeRecords([...local.records, ...remote.records]),
    undo: local.undo,
    receipts: [...(local.receipts ?? []), ...(remote.receipts ?? [])],
  };
}

export function statePatch(before: AppState, after: AppState) {
  return compare(before, after);
}

export function applyStatePatch(state: AppState, patch: ReturnType<typeof statePatch>): AppState {
  return applyPatch(structuredClone(state), patch, true, false).newDocument;
}

const ChatResponse = z.object({ text: z.string(), toolCalls: z.array(z.unknown()).optional() });
export async function chat(endpoint: string, messages: Array<{ role: 'user' | 'assistant'; content: string }>, context: unknown = {}) {
  const requestId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}`;
  const response = await fetch(networkUrl(endpoint), {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ requestId, messages, context }),
  });
  if (!response.ok) throw new Error(`Chat HTTP ${response.status}`);
  return ChatResponse.parse(await response.json());
}
