import type { JsonRecord } from './runtime';

export type DataHomeMode = 'local' | 'pull' | 'push' | 'sync';
export type DataHomeKind = 'sqlite' | 'postgres' | 'notion' | 'google-sheets';

export type DataHomeConfig = {
  id: string;
  kind: DataHomeKind;
  resource?: string;
  secretRef?: string;
  mode?: DataHomeMode;
};

type DataHomeRecord = {
  id: string;
  collection: string;
  createdAt: string;
  updatedAt: string;
  values: Record<string, unknown>;
};

type SecretMap = Record<string, string | undefined>;

type StorageProvider = { getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<void> };

type RemoteDataHomeConfig = DataHomeConfig & { id: string; secretRef: string; mode?: DataHomeMode };
export type DataHomeScope = { appId: string; tenantId: string };

export type DataHomeTransport = {
  pull(input: { cursor?: string; limit?: number }): Promise<{ records: JsonRecord[]; cursor?: string; hasMore: boolean }>;
  push(input: { records: JsonRecord[] }): Promise<{ cursor?: string }>;
};

export type Transport = DataHomeTransport;

const fail = (message: string): never => { throw new Error(message); };
const reSecretRef = /^[A-Z][A-Z0-9_]*$/;

function networkUrl(value: string): string {
  const url = new URL(value);
  if (!['https:', 'http:'].includes(url.protocol)) {
    throw new Error('invalid endpoint protocol');
  }
  if (url.protocol === 'http:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
    throw new Error('HTTPS required');
  }
  return url.toString();
}

function readSecretRef(config: DataHomeConfig): string {
  const ref = config.secretRef;
  if (ref === undefined) throw new Error(`missing secretRef for ${config.id}`);
  if (!reSecretRef.test(ref)) throw new Error(`invalid secretRef ${config.id}`);
  return ref;
}

function readEndpoint(baseUrl: string | undefined, config: DataHomeConfig): string {
  if (!baseUrl) throw new Error(`missing data home endpoint for ${config.id}`);
  return networkUrl(baseUrl).replace(/\/$/, '');
}

export async function retry<T>(operation: () => Promise<T>, attempts = 3): Promise<T> {
  let error: unknown;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await operation();
    } catch (cause) {
      error = cause;
      if (i + 1 < attempts) await new Promise((done) => setTimeout(done, 50 * 2 ** i));
    }
  }
  throw error;
}

function asRecord(raw: DataHomeRecord): JsonRecord {
  return {
    id: raw.id,
    collection: raw.collection || 'item',
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    values: raw.values ?? {},
  };
}

function dedupe(records: JsonRecord[]) {
  const out = new Map<string, JsonRecord>();
  for (const record of records) {
    const current = out.get(record.id);
    if (!current || record.updatedAt > current.updatedAt) out.set(record.id, record);
  }
  return [...out.values()].sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
}

function paginate<T>(rows: T[], cursor?: string, limit = 200) {
  const start = Number(cursor ?? 0);
  const safe = Number.isFinite(start) && start >= 0 ? Math.trunc(start) : 0;
  const page = rows.slice(safe, safe + limit);
  const next = safe + page.length;
  return { records: page, cursor: next < rows.length ? `${next}` : undefined, hasMore: next < rows.length };
}

function sqliteHome(id: string, storage: StorageProvider): DataHomeTransport {
  const key = `utopia:data-home:${id}:sqlite`;
  const read = async () => {
    const raw = await storage.getItem(key);
    if (!raw) return [] as JsonRecord[];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && typeof item === 'object')
      .map((item) => asRecord(item as DataHomeRecord));
  };

  return {
    async pull({ cursor, limit = 200 }) {
      return paginate((await read()).sort((a, b) => a.updatedAt.localeCompare(b.updatedAt)), cursor, limit);
    },
    async push({ records }) {
      await storage.setItem(key, JSON.stringify(dedupe((await read()).concat(records))));
      return { cursor: dedupe(records).at(-1)?.updatedAt };
    },
  };
}

function remoteHome(config: RemoteDataHomeConfig, baseUrl: string, scope: DataHomeScope): DataHomeTransport {
  const endpoint = `${baseUrl}/data/${encodeURIComponent(`${scope.tenantId}:${scope.appId}:${config.id}`)}`;
  const request = async <T>(operation: 'pull' | 'push', payload: Record<string, unknown>) => {
    const response = await retry(async () => {
      const result = await fetch(`${endpoint}/${operation}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!result.ok) throw new Error(`Data home ${result.status}`);
      return result.json() as Promise<T>;
    }, 3);
    return response;
  };

  return {
    async pull({ cursor, limit = 200 }) {
      const payload = { cursor, limit } as const;
      const result = await request<{ records?: JsonRecord[]; cursor?: string; hasMore?: boolean }>('pull', payload);
      return {
        records: Array.isArray(result.records) ? result.records.map(asRecord) : [],
        cursor: result.cursor,
        hasMore: result.hasMore ?? false,
      };
    },
    async push({ records }) {
      const result = await request<{ cursor?: string }>('push', { records });
      return { cursor: result.cursor };
    },
  };
}

function isSqlite(config: DataHomeConfig): boolean {
  return config.kind === 'sqlite';
}

function isRemote(config: DataHomeConfig): config is RemoteDataHomeConfig {
  return config.kind === 'notion' || config.kind === 'google-sheets' || config.kind === 'postgres';
}

export function createDataHome(
  config: DataHomeConfig,
  _secrets: SecretMap = {},
  storage?: StorageProvider,
  baseUrl?: string,
  scope?: DataHomeScope,
): DataHomeTransport {
  if (isSqlite(config)) return sqliteHome(config.id, storage ?? fail('sqlite storage unavailable'));
  if (!isRemote(config)) fail(`unsupported data home kind ${config.kind}`);
  const withSecretRef = { ...config, secretRef: readSecretRef(config) };
  return remoteHome(withSecretRef, readEndpoint(baseUrl, config), scope ?? fail(`missing data home scope for ${config.id}`));
}

export function mergeWithConflicts(local: JsonRecord[], remote: JsonRecord[]) {
  const merged = dedupe([...local, ...remote]);
  const conflicts: string[] = [];
  const remoteById = new Map(remote.map((record) => [record.id, record]));
  for (const record of merged) {
    const localRecord = local.find((item) => item.id === record.id);
    const remoteRecord = remoteById.get(record.id);
    if (!localRecord || !remoteRecord) continue;
    if (localRecord.updatedAt === remoteRecord.updatedAt && JSON.stringify(localRecord.values) !== JSON.stringify(remoteRecord.values)) {
      conflicts.push(record.id);
    }
  }
  return { merged, conflicts };
}

export { retry as retryAdapter };
