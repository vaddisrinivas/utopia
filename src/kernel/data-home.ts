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

type SecretMap = Record<string, string | undefined>;

export type DataHomeScope = { appId: string; tenantId: string };

export type DataHomeTransport = {
  pull(input: { cursor?: string; limit?: number }): Promise<{ records: JsonRecord[]; cursor?: string; hasMore: boolean }>;
  push(input: { records: JsonRecord[] }): Promise<{ cursor?: string }>;
};

type StorageProvider = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
};

type RawRecord = {
  id: string;
  collection: string;
  createdAt: string;
  updatedAt: string;
  values: Record<string, unknown>;
};

type ScopedRecord = RawRecord & { scope: string };

export type Transport = DataHomeTransport;

export type DataHomeRecord = RawRecord;

type NotionApi = {
  dataSources?: { query: (input: Record<string, unknown>) => Promise<NotionQueryResult> };
  databases?: { query: (input: Record<string, unknown>) => Promise<NotionQueryResult> };
  pages: {
    create: (input: Record<string, unknown>) => Promise<unknown>;
    update: (input: Record<string, unknown>) => Promise<unknown>;
  };
};

type NotionQueryResult = {
  results: unknown[];
  has_more?: boolean;
  next_cursor?: string | null;
};

type SheetsClient = {
  spreadsheets: {
    values: {
      get: (input: { spreadsheetId: string; range: string }) => Promise<{ data: { values?: unknown[][] } }>;
      clear: (input: { spreadsheetId: string; range: string }) => Promise<unknown>;
      update: (input: {
        spreadsheetId: string;
        range: string;
        valueInputOption: string;
        requestBody: { values: Array<Array<string | number>> };
      }) => Promise<unknown>;
      append: (input: {
        spreadsheetId: string;
        range: string;
        valueInputOption: string;
        insertDataOption: string;
        requestBody: { values: Array<Array<string | number>> };
      }) => Promise<unknown>;
    };
  };
};

const MAX_LIMIT = 200;
const IDENTIFIER = /^[A-Za-z0-9_-]+$/;

const fail = (message: string): never => {
  throw new Error(message);
};

const isDataHomeScope = (scope: DataHomeScope | undefined): scope is DataHomeScope =>
  scope?.tenantId !== undefined && scope?.appId !== undefined && scope?.tenantId.length > 0 && scope?.appId.length > 0;

const asJson = (value: unknown): Record<string, unknown> | null => {
  if (typeof value !== 'string') return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};

const ensureObject = (value: unknown): Record<string, unknown> | undefined => {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
};

const toScopedRecord = (value: unknown, scopeKey: string): ScopedRecord | undefined => {
  const raw = ensureObject(value);
  if (!raw) return undefined;

  const id = String(raw.id ?? '').trim();
  const collection = String(raw.collection ?? 'item').trim();
  const createdAt = String(raw.createdAt ?? '').trim();
  const updatedAt = String(raw.updatedAt ?? '').trim();
  const storedScope = String(raw.scope ?? '');
  const values = ensureObject(raw.values);

  if (!id || !createdAt || !updatedAt) return undefined;
  if (storedScope !== scopeKey) return undefined;

  return {
    scope: storedScope,
    id,
    collection,
    createdAt,
    updatedAt,
    values: values ? values as Record<string, unknown> : {},
  };
};

const toPublicRecord = (record: RawRecord | ScopedRecord): JsonRecord => ({
  id: record.id,
  collection: record.collection,
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
  values: record.values,
});

const asScopedRecord = (homeScope: string, record: JsonRecord): ScopedRecord => ({
  scope: homeScope,
  id: String(record.id),
  collection: String(record.collection || 'item'),
  createdAt: String(record.createdAt || new Date().toISOString()),
  updatedAt: String(record.updatedAt || new Date().toISOString()),
  values: record.values ?? {},
});

const toPreparedRecords = (homeScope: string, records: JsonRecord[]) =>
  mergeByUpdatedAt(records.filter((record) => Boolean(record?.id)).map((record) => asScopedRecord(homeScope, record)));

const mergeByUpdatedAt = <T extends { id: string; updatedAt: string }>(records: T[]) => {
  const byId = new Map<string, T>();
  for (const record of records) {
    const prior = byId.get(record.id);
    if (!prior || new Date(record.updatedAt).getTime() > new Date(prior.updatedAt).getTime()) {
      byId.set(record.id, record);
    }
  }
  return [...byId.values()].sort((a, b) => a.updatedAt.localeCompare(b.updatedAt) || a.id.localeCompare(b.id));
};

const sanitize = (value: string, field: string) => {
  if (!IDENTIFIER.test(value)) fail(`invalid ${field}`);
  return value;
};

const scopeKey = (scope: DataHomeScope, homeId: string) => {
  return `${sanitize(scope.tenantId, 'tenantId')}:${sanitize(scope.appId, 'appId')}:${sanitize(homeId, 'data home id')}`;
};

const toScopedId = (prefix: string, id: string) => `${prefix}:${id}`;

const fromScopedId = (prefix: string, id: string) => {
  const marker = `${prefix}:`;
  return id.startsWith(marker) ? id.slice(marker.length) : undefined;
};

const paginated = <T,>(items: T[], cursor: string | undefined, limit: number) => {
  const start = Number(cursor ?? 0);
  const offset = Number.isFinite(start) && start >= 0 ? Math.trunc(start) : 0;
  const nextOffset = Math.min(offset + limit, items.length);
  return {
    records: items.slice(offset, nextOffset),
    cursor: nextOffset < items.length ? `${nextOffset}` : undefined,
    hasMore: nextOffset < items.length,
  };
};

const normalizeSecretRef = (config: DataHomeConfig) => {
  if (!config.secretRef) fail(`missing secretRef for ${config.id}`);
  const normalized = String(config.secretRef);
  if (!/^[A-Z][A-Z0-9_]+$/.test(normalized)) fail(`invalid secretRef ${config.id}`);
  return normalized;
};

export async function retry<T>(operation: () => Promise<T>, attempts = 3, delayMs = 50): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt + 1 >= attempts) break;
      await new Promise((done) => setTimeout(done, delayMs * 2 ** attempt));
    }
  }
  throw lastError;
}

type DataHomeFactories = {
  notionClient: (token: string) => NotionApi;
  postgresClient: (credential: string) => {
    connect: () => Promise<void>;
    query: (text: string, values?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;
    end: () => Promise<void>;
  };
  googleAuth: (credentials: Record<string, unknown>) => unknown;
  sheetsClient: (opts: { version: 'v4'; auth: unknown }) => SheetsClient;
};

type DataHomeFactoriesInput = Partial<DataHomeFactories>;

const defaultFactories = (): DataHomeFactories => {
  const unavailable = (kind: DataHomeKind): never => fail(`${kind} adapter unavailable on this runtime`);
  return {
    notionClient: () => unavailable('notion'),
    postgresClient: () => unavailable('postgres'),
    googleAuth: () => unavailable('google-sheets'),
    sheetsClient: () => unavailable('google-sheets'),
  };
};

const createFactories = (input: DataHomeFactoriesInput = {}): DataHomeFactories => {
  const base = defaultFactories();
  return {
    notionClient: input.notionClient ?? base.notionClient,
    postgresClient: input.postgresClient ?? base.postgresClient,
    googleAuth: input.googleAuth ?? base.googleAuth,
    sheetsClient: input.sheetsClient ?? base.sheetsClient,
  };
};

function sqliteHome(config: DataHomeConfig, storage: StorageProvider, scoped: DataHomeScope): DataHomeTransport {
  const homeScope = scopeKey(scoped, config.id);
  const storageKey = `utopia:data-home:${homeScope}`;

  const read = async (): Promise<ScopedRecord[]> => {
    const raw = await storage.getItem(storageKey);
    if (!raw) return [];
    const parsed = asJson(raw);
    if (!parsed || !Array.isArray((parsed as { records?: unknown[] }).records)) return [];

    const rows = ((parsed as { records: unknown[] }).records).map((row) => toScopedRecord(row, homeScope));
    return rows.filter((row): row is ScopedRecord => Boolean(row));
  };

  return {
    async pull({ cursor, limit = MAX_LIMIT }) {
      const rows = mergeByUpdatedAt(await read()).map((row) => toPublicRecord(row));
      return paginated(rows, cursor, limit);
    },
    async push({ records }) {
      const current = await read();
      const prepared = mergeByUpdatedAt([...current, ...toPreparedRecords(homeScope, records)]);
      const kept = prepared.filter((item) => item.values.deleted !== true);
      await storage.setItem(
        storageKey,
        JSON.stringify({
          v: 1,
          scope: homeScope,
          records: kept,
        }),
      );
      return { cursor: kept.at(-1)?.updatedAt };
    },
  };
}

function postgresHome(config: DataHomeConfig, credential: string, scoped: DataHomeScope, factories: DataHomeFactories): DataHomeTransport {
  const homeScope = scopeKey(scoped, config.id);
  const resource = sanitize(config.resource ?? 'utopia_records', 'resource');

  const connect = async () => {
    const client = factories.postgresClient(credential);
    await client.connect();
    await client.query(`create table if not exists "${resource}" (
      scope text not null,
      id text not null,
      collection text not null,
      created_at text not null,
      updated_at text not null,
      values_json text not null,
      primary key (scope, id)
    )`);
    return client;
  };

  return {
    async pull({ cursor, limit = MAX_LIMIT }) {
      return retry(async () => {
        const client = await connect();
        try {
          const offset = Number(cursor ?? 0);
          const safeOffset = Number.isFinite(offset) && offset >= 0 ? Math.trunc(offset) : 0;
          const result = await client.query(
            `select id, collection, created_at, updated_at, values_json from "${resource}" where scope = $1 order by updated_at asc limit $2 offset $3`,
            [homeScope, limit, safeOffset],
          );
          const records = mergeByUpdatedAt(result.rows.map((row) => ({
            id: String(row.id ?? ''),
            collection: String(row.collection ?? 'item'),
            createdAt: String(row.created_at ?? ''),
            updatedAt: String(row.updated_at ?? ''),
            values: asJson(row.values_json) ?? {},
          } satisfies RawRecord)));
          return paginated(records.map((row) => toPublicRecord(row)), `${safeOffset}`, limit);
        } finally {
          await client.end();
        }
      });
    },
    async push({ records }) {
      return retry(async () => {
        const client = await connect();
        try {
          const prepared = toPreparedRecords(homeScope, records);
          for (const record of prepared) {
            const { id, collection, createdAt, updatedAt, values } = record;

            if (values.deleted === true) {
              await client.query(`delete from "${resource}" where scope = $1 and id = $2`, [homeScope, id]);
              continue;
            }

            await client.query(
              `insert into "${resource}" (scope, id, collection, created_at, updated_at, values_json)
               values ($1, $2, $3, $4, $5, $6)
               on conflict (scope, id) do update set
                 collection = excluded.collection,
                 created_at = excluded.created_at,
                 updated_at = excluded.updated_at,
                 values_json = excluded.values_json
               where "${resource}".updated_at <= excluded.updated_at`,
              [homeScope, id, collection, createdAt, updatedAt, JSON.stringify(values)],
            );
          }

          return { cursor: prepared.at(-1)?.updatedAt };
        } finally {
          await client.end();
        }
      });
    },
  };
}

function notionHome(config: DataHomeConfig, token: string, scoped: DataHomeScope, factories: DataHomeFactories): DataHomeTransport {
  const notion = factories.notionClient(token);
  const useDataSource = Boolean(notion.dataSources?.query);
  const useDatabase = Boolean(notion.databases?.query);
  if (!useDataSource && !useDatabase) fail(`unsupported notion query methods for ${config.id}`);

  const homeScope = scopeKey(scoped, config.id);
  const resource = config.resource;
  if (!resource) fail(`missing notion resource for ${config.id}`);

  const propertyText = (value: unknown): string | undefined => {
    const valueRecord = ensureObject(value);
    const richText = valueRecord ? (valueRecord.rich_text as unknown[]) : undefined;
    const title = valueRecord ? (valueRecord.title as unknown[]) : undefined;
    if (Array.isArray(richText) || Array.isArray(title)) {
      const values = (Array.isArray(richText) ? richText : title) as unknown[];
      return values
        .map((entry) => {
          const typed = ensureObject(entry);
          if (!typed) return '';
          const plain = typed.plain_text;
          if (typeof plain === 'string') return plain;
          const text = ensureObject(typed.text);
          return text?.content ?? '';
        })
        .join('');
    }

    const dateValue = valueRecord ? ensureObject(valueRecord.date) : undefined;
    const start = dateValue ? dateValue.start : undefined;
    return typeof start === 'string' ? start : undefined;
  };

  const decodeProperties = (properties: Record<string, unknown> | undefined): ScopedRecord | undefined => {
    if (!properties) return undefined;
    const idRaw = propertyText(properties.UtopiaId);
    const scopedId = idRaw ? fromScopedId(homeScope, idRaw) : undefined;
    if (!scopedId) return undefined;

    const payload = asJson(propertyText(properties.Payload) ?? '{}') ?? {};
    const values = payload as Record<string, unknown>;

    return {
      scope: homeScope,
      id: scopedId,
      collection: propertyText(properties.Collection) ?? 'item',
      createdAt: propertyText(properties.Created) ?? new Date().toISOString(),
      updatedAt: propertyText(properties.Updated) ?? new Date().toISOString(),
      values,
    };
  };

  const queryPages = async () => {
    const out: unknown[] = [];
    let cursor: string | undefined;
    do {
      const response = await retry(async () => useDataSource
        ? notion.dataSources!.query({ data_source_id: resource, result_type: 'page', page_size: 100, start_cursor: cursor })
        : notion.databases!.query({ database_id: resource, page_size: 100, start_cursor: cursor } as Record<string, unknown>)
      );
      const next = response as unknown as NotionQueryResult;
      out.push(...(next.results ?? []));
      cursor = next.has_more ? next.next_cursor ?? undefined : undefined;
    } while (cursor);
    return out;
  };

  const encodeText = (text: string) => (text.length > 0 ? [{ type: 'text', text: { content: text } }] : []);

  return {
    async pull({ cursor, limit = MAX_LIMIT }) {
      const pages = await queryPages();
      const records = pages
        .map((page) => {
          const item = ensureObject(page);
          if (!item) return undefined;
          return decodeProperties(ensureObject(item.properties) as Record<string, unknown> | undefined);
        })
        .filter((record): record is ScopedRecord => Boolean(record));

      const merged = mergeByUpdatedAt(records);
      const mapped = merged
        .filter((record) => !cursor || record.updatedAt > cursor)
        .map((record) => toPublicRecord(record));
      return paginated(mapped, cursor, limit);
    },
    async push({ records }) {
      const pages = await queryPages();
      const existing = new Map<string, { pageId: string; updatedAt: string }>();

      for (const page of pages) {
        const item = ensureObject(page);
        if (!item) continue;
        const decoded = decodeProperties(ensureObject(item.properties) as Record<string, unknown> | undefined);
        if (!decoded) continue;
        const pageId = String(item.id ?? '');
        if (pageId) existing.set(decoded.id, { pageId, updatedAt: decoded.updatedAt });
      }

      const prepared = toPreparedRecords(homeScope, records);

      for (const record of prepared) {
        const prior = existing.get(record.id);
        if (prior && prior.updatedAt > record.updatedAt) continue;

        const scopedId = toScopedId(homeScope, record.id);
        const payload = JSON.stringify(record.values ?? {});
        const properties = {
          Name: { title: encodeText(record.values?.name ? String(record.values.name) : record.id) },
          UtopiaId: { rich_text: encodeText(scopedId) },
          Collection: { rich_text: encodeText(record.collection) },
          Created: { date: { start: record.createdAt } },
          Updated: { date: { start: record.updatedAt } },
          Payload: { rich_text: encodeText(payload) },
        };

        if (prior && record.values.deleted === true) {
          await notion.pages.update({ page_id: prior.pageId, archived: true });
          continue;
        }

        if (prior) {
          await notion.pages.update({ page_id: prior.pageId, properties });
          continue;
        }

        const parent = useDataSource ? { data_source_id: resource } : { database_id: resource };
        await notion.pages.create({ parent, properties });
      }

      return { cursor: prepared.at(-1)?.updatedAt };
    },
  };
}

function sheetsHome(config: DataHomeConfig, credential: string, scoped: DataHomeScope, factories: DataHomeFactories): DataHomeTransport {
  const homeScope = scopeKey(scoped, config.id);
  const credentials = asJson(credential);
  if (!credentials) fail(`invalid google-sheets credentials for ${config.id}`);

  const [spreadsheetId, explicitRange] = (config.resource ?? '').split('!');
  if (!spreadsheetId) fail(`missing google-sheets resource for ${config.id}`);

  const requestedRange = (explicitRange ?? 'A1:E').trim() || 'A1:E';
  const sheetName = requestedRange.includes('!') ? requestedRange.split('!')[0] : 'Utopia';

  const auth = factories.googleAuth(credentials as Record<string, unknown>);
  const sheets = factories.sheetsClient({ version: 'v4', auth });

  const readAllRows = async (): Promise<unknown[][]> => {
    const response = await sheets.spreadsheets.values.get({ spreadsheetId, range: requestedRange });
    return response.data.values ?? [];
  };

  const decodeRow = (row: unknown[]): ScopedRecord | undefined => {
    const scopedId = String(row?.[0] ?? '').trim();
    const id = scopedId ? fromScopedId(homeScope, scopedId) : undefined;
    if (!id) return undefined;

    return {
      scope: homeScope,
      id,
      collection: String(row?.[1] ?? 'item'),
      createdAt: String(row?.[2] ?? ''),
      updatedAt: String(row?.[3] ?? ''),
      values: asJson(row?.[4]) ?? {},
    };
  };

  return {
    async pull({ cursor, limit = MAX_LIMIT }) {
      const rows = await readAllRows();
      const headerOffset = rows.length && ensureObject(rows[0])?.A1 === 'UtopiaId' ? 1 : 0;
      const records = rows
        .slice(headerOffset)
        .map((row) => decodeRow(row as unknown[]))
        .filter((record): record is ScopedRecord => Boolean(record))
        .filter((record) => !cursor || record.updatedAt > cursor)
        .map((record) => toPublicRecord(record));
      return paginated(mergeByUpdatedAt(records), cursor, limit);
    },
    async push({ records }) {
      const rows = await readAllRows();
      const existing = new Map<string, { row: number; updatedAt: string }>();
      rows.forEach((row, index) => {
        const decoded = decodeRow(row as unknown[]);
        if (!decoded) return;
        existing.set(decoded.id, { row: index + 1, updatedAt: decoded.updatedAt });
      });

      const prepared = toPreparedRecords(homeScope, records);

      for (const record of prepared) {
        const rowId = toScopedId(homeScope, record.id);
        const prior = existing.get(record.id);
        const payload = JSON.stringify(record.values ?? {});
        const rangeValues = [rowId, record.collection, record.createdAt, record.updatedAt, payload];

        if (prior && record.values.deleted === true) {
          await sheets.spreadsheets.values.clear({ spreadsheetId, range: `${sheetName}!A${prior.row}:E${prior.row}` });
          continue;
        }

        if (prior) {
          if (prior.updatedAt > record.updatedAt) continue;
          await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: `${sheetName}!A${prior.row}:E${prior.row}`,
            valueInputOption: 'RAW',
            requestBody: { values: [rangeValues] },
          });
          continue;
        }

        await sheets.spreadsheets.values.append({
          spreadsheetId,
          range: requestedRange,
          valueInputOption: 'RAW',
          insertDataOption: 'INSERT_ROWS',
          requestBody: { values: [rangeValues] },
        });
      }

      return { cursor: prepared.at(-1)?.updatedAt };
    },
  };
}

function gatewayHome(config: DataHomeConfig, credential: string, scoped: DataHomeScope, baseUrl: string): DataHomeTransport {
  const endpoint = new URL(baseUrl);
  if (endpoint.protocol !== 'https:' && endpoint.hostname !== 'localhost' && endpoint.hostname !== '127.0.0.1') fail('HTTPS required');
  const request = async (operation: 'pull' | 'push', payload: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${credential}`,
        'content-type': 'application/json',
        'x-utopia-app-id': scoped.appId,
        'x-utopia-tenant-id': scoped.tenantId,
      },
      body: JSON.stringify({ operation, dataHome: { id: config.id, kind: config.kind, resource: config.resource }, ...payload }),
    });
    if (!response.ok) fail(`data home gateway ${response.status}`);
    const result = ensureObject(await response.json());
    return result ?? fail('invalid data home gateway response');
  };
  return {
    async pull(input) {
      const result = await request('pull', input);
      const records = Array.isArray(result.records)
        ? result.records.map((record) => ensureObject(record)).filter((record): record is Record<string, unknown> => Boolean(record))
          .map((record) => ({
            id: String(record.id ?? ''),
            collection: String(record.collection ?? 'item'),
            createdAt: String(record.createdAt ?? ''),
            updatedAt: String(record.updatedAt ?? ''),
            values: ensureObject(record.values) ?? {},
          })).filter((record) => record.id && record.createdAt && record.updatedAt)
        : [];
      return { records, cursor: typeof result.cursor === 'string' ? result.cursor : undefined, hasMore: result.hasMore === true };
    },
    async push(input) {
      const result = await request('push', { records: input.records });
      return { cursor: typeof result.cursor === 'string' ? result.cursor : undefined };
    },
  };
}

export function createDataHome(
  config: DataHomeConfig,
  secrets: SecretMap = {},
  storage: StorageProvider = { getItem: async () => null, setItem: async () => undefined },
  baseUrl?: string,
  scope?: DataHomeScope,
  factories: DataHomeFactoriesInput = {},
): DataHomeTransport {
  const resolvedFactories = createFactories(factories);

  if (config.kind === 'sqlite') {
    if (!isDataHomeScope(scope)) fail(`missing data home scope for ${config.id}`);
    const activeScope = scope as DataHomeScope;
    return sqliteHome(config, storage, activeScope);
  }

  if (!isDataHomeScope(scope)) fail(`missing data home scope for ${config.id}`);
  const activeScope = scope as DataHomeScope;

  const ref = normalizeSecretRef(config);
  const credential = secrets[ref];
  if (!credential) fail(`credential missing for ${ref}`);
  const resolvedCredential = String(credential);

  if (baseUrl) return gatewayHome(config, resolvedCredential, activeScope, baseUrl);
  if (config.kind === 'postgres') return postgresHome(config, resolvedCredential, activeScope, resolvedFactories);
  if (config.kind === 'notion') return notionHome(config, resolvedCredential, activeScope, resolvedFactories);
  if (config.kind === 'google-sheets') return sheetsHome(config, resolvedCredential, activeScope, resolvedFactories);

  return fail(`unsupported data home kind ${config.kind}`);
}

export function mergeWithConflicts(local: JsonRecord[], remote: JsonRecord[]) {
  const merged = mergeByUpdatedAt([...local, ...remote]);
  const remoteById = new Map(remote.map((record) => [record.id, record]));
  const conflicts: string[] = [];

  for (const localRecord of local) {
    const remoteRecord = remoteById.get(localRecord.id);
    if (!remoteRecord) continue;
    if (localRecord.updatedAt === remoteRecord.updatedAt && JSON.stringify(localRecord.values) !== JSON.stringify(remoteRecord.values)) {
      conflicts.push(localRecord.id);
    }
  }

  return { merged, conflicts };
}

export { retry as retryAdapter };
