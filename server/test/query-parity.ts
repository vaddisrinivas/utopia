import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { executeQuery } from '../src/kernel/query';
import type { QuerySpec } from '@/packages/shared/contracts/query';
import { compileQueryToSql } from '../src/kernel/query-sql';

type RowFixture = {
  id: string;
  collection: string;
  title: string;
  domain: string;
  updated_at: string;
  properties: Record<string, unknown>;
};

type ParityCase = {
  name: string;
  spec: QuerySpec;
  expected: string[];
};

const rows: RowFixture[] = [
  {
    id: 'meal-1',
    collection: 'inventory',
    title: 'Roasted beets',
    domain: 'food',
    updated_at: '2026-07-01T08:00:00.000Z',
    properties: { status: 'open', score: 10, owner: { name: 'Bo' }, note: { text: 'Rotate and chill' }, meta: { source: 'api' } },
  },
  {
    id: 'meal-2',
    collection: 'inventory',
    title: 'Crisp lettuce',
    domain: 'food',
    updated_at: '2026-07-02T08:00:00.000Z',
    properties: { status: 'closed', score: 7, owner: { name: 'Cy' }, note: { text: 'protein-rich' }, meta: { source: 'manual' } },
  },
  {
    id: 'meal-3',
    collection: 'inventory',
    title: 'Protein pudding',
    domain: 'food',
    updated_at: '2026-07-03T08:00:00.000Z',
    properties: { status: 'open', score: 4, owner: { name: 'Al' }, note: { text: 'protein pudding' }, meta: { source: 'api' } },
  },
  {
    id: 'meal-4',
    collection: 'inventory',
    title: 'Protein pudding mini',
    domain: 'food',
    updated_at: '2026-07-03T08:00:00.000Z',
    properties: { status: 'open', score: 4, owner: {}, note: { text: 'protein' }, meta: {} },
  },
  {
    id: 'meal-5',
    collection: 'inventory',
    title: 'Null score',
    domain: 'food',
    updated_at: '2026-07-04T08:00:00.000Z',
    properties: { status: 'open', score: null, note: { text: 'open' }, meta: { source: 'api' } },
  },
  {
    id: 'meal-6',
    collection: 'inventory',
    title: 'Missing status',
    domain: 'food',
    updated_at: '2026-07-05T08:00:00.000Z',
    properties: { score: 8, note: { text: 'protein' }, meta: { source: 'manual' } },
  },
  {
    id: 'meal-7',
    collection: 'inventory',
    title: 'Null status',
    domain: 'food',
    updated_at: '2026-07-06T08:00:00.000Z',
    properties: { status: null, score: 2, note: { text: 'manual' }, meta: { source: 'api' } },
  },
];

const parityCases: ParityCase[] = [
  {
    name: 'eq nested path',
    spec: {
      from: 'records',
      where: { op: 'eq', field: 'properties.owner.name', value: 'Bo' },
      orderBy: [{ field: 'id', direction: 'asc' }],
    },
    expected: ['meal-1'],
  },
  {
    name: 'neq nested path',
    spec: {
      from: 'records',
      where: { op: 'neq', field: 'properties.owner.name', value: 'Bo' },
      orderBy: [{ field: 'id', direction: 'asc' }],
    },
    expected: ['meal-2', 'meal-3', 'meal-4', 'meal-5', 'meal-6', 'meal-7'],
  },
  {
    name: 'gt / lte with deterministic tie',
    spec: {
      from: 'records',
      where: { op: 'gt', field: 'properties.score', value: 3 },
      orderBy: [{ field: 'properties.score', direction: 'desc' }, { field: 'id', direction: 'asc' }],
    },
    expected: ['meal-1', 'meal-6', 'meal-2', 'meal-3', 'meal-4'],
  },
  {
    name: 'contains nested',
    spec: {
      from: 'records',
      where: { op: 'contains', field: 'properties.note.text', value: 'pro' },
      orderBy: [{ field: 'id', direction: 'asc' }],
    },
    expected: ['meal-2', 'meal-3', 'meal-4', 'meal-6'],
  },
  {
    name: 'starts_with nested',
    spec: {
      from: 'records',
      where: { op: 'starts_with', field: 'properties.note.text', value: 'pro' },
      orderBy: [{ field: 'id', direction: 'asc' }],
    },
    expected: ['meal-2', 'meal-3', 'meal-4', 'meal-6'],
  },
  {
    name: 'exists true source interpretation',
    spec: {
      from: 'records',
      where: { op: 'exists', field: 'properties.status' },
      orderBy: [{ field: 'id', direction: 'asc' }],
    },
    expected: ['meal-1', 'meal-2', 'meal-3', 'meal-4', 'meal-5'],
  },
  {
    name: 'exists false includes null and missing',
    spec: {
      from: 'records',
      where: { op: 'exists', field: 'properties.status', value: false },
      orderBy: [{ field: 'id', direction: 'asc' }],
    },
    expected: ['meal-6', 'meal-7'],
  },
  {
    name: 'null equals must match SQL NULL semantics',
    spec: {
      from: 'records',
      where: { op: 'eq', field: 'properties.status', value: null },
      orderBy: [{ field: 'id', direction: 'asc' }],
    },
    expected: ['meal-7'],
  },
  {
    name: 'not operator',
    spec: {
      from: 'records',
      where: { op: 'not', arg: { op: 'eq', field: 'properties.status', value: 'closed' } },
      orderBy: [{ field: 'id', direction: 'asc' }],
    },
    expected: ['meal-1', 'meal-3', 'meal-4', 'meal-5', 'meal-6', 'meal-7'],
  },
  {
    name: 'and/or with ordered, offset, and limit',
    spec: {
      from: 'records',
      where: {
        op: 'and',
        args: [
          { op: 'eq', field: 'collection', value: 'inventory' },
          {
            op: 'or',
            args: [
              { op: 'eq', field: 'properties.status', value: 'open' },
              { op: 'eq', field: 'properties.status', value: 'closed' },
            ],
          },
        ],
      },
      orderBy: [{ field: 'properties.score', direction: 'desc' }, { field: 'id', direction: 'asc' }],
      limit: 3,
      offset: 1,
    },
    expected: ['meal-2', 'meal-3', 'meal-4'],
  },
  {
    name: 'unsupported operators fail explicitly',
    spec: {
      from: 'records',
      // @ts-expect-error coverage guard for invalid SQL conversion
      where: { op: 'between', field: 'properties.score', value: '7' },
    },
    expected: [],
  },
];

const databasePath = createFixtureDatabase();

for (const current of parityCases) {
  if (current.spec.where && (current.spec.where as { op: string }).op === 'between') {
    assert.throws(() => compileQueryToSql(current.spec), /unsupported_query_predicate/);
    continue;
  }

  const referenceRows = executeQuery(rows, current.spec).rows;
  const referenceIds = referenceRows.map((row) => row.id);
  assert.deepEqual(referenceIds, current.expected, `${current.name}: reference ids`);

  const sqliteRows = runSqliteQuery(current.spec);
  assert.deepEqual(sqliteRows, referenceIds, `${current.name}: SQLite parity`);
}

rmSync(databasePath, { force: true });

function createFixtureDatabase(): string {
  const dbPath = join(mkdtempSync(join(tmpdir(), 'query-parity-')), 'records.db');
  execute(dbPath, `CREATE TABLE records (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    domain TEXT NOT NULL,
    collection TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    properties TEXT NOT NULL,
    source_provider TEXT NOT NULL,
    source_external_id TEXT NOT NULL,
    source_observed_at TEXT NOT NULL,
    source_content_hash TEXT,
    archived_at TEXT,
    created_at TEXT NOT NULL,
    source_url TEXT
  );`);

  for (const row of rows) {
    execute(dbPath, `INSERT INTO records (
      id, title, domain, collection, updated_at, properties, source_provider, source_external_id,
      source_observed_at, source_content_hash, archived_at, created_at, source_url
    ) VALUES (
      ${sqlLiteral(row.id)},
      ${sqlLiteral(row.title)},
      ${sqlLiteral(row.domain)},
      ${sqlLiteral(row.collection)},
      ${sqlLiteral(row.updated_at)},
      ${sqlLiteral(JSON.stringify(row.properties))},
      'sqlite',
      ${sqlLiteral(row.id)},
      ${sqlLiteral(row.updated_at)},
      NULL,
      NULL,
      ${sqlLiteral(row.updated_at)},
      NULL
    );`);
  }

  return dbPath;
}

function runSqliteQuery(spec: QuerySpec): string[] {
  const compiled = compileQueryToSql(spec);
  let paramIndex = 0;
  const parameterizedSql = compiled.sql.replace(/\?/g, () => `@p${++paramIndex}`);
  const params = compiled.params.map((value, index) => ['-cmd', `.param set @p${index + 1} ${sqlLiteral(value)}`]).flat();
  const output = execFileSync('sqlite3', [
    '-json',
    databasePath,
    ...params,
    parameterizedSql,
  ], { encoding: 'utf8' });
  const decoded = output.trim() === '' ? '[]' : output;
  return decoded === '[]' ? [] : JSON.parse(decoded).map((row: { id: string }) => row.id);
}

function sqlLiteral(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number' || Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return value ? '1' : '0';
  const asText = String(value);
  return `'${asText.replace(/'/g, "''")}'`;
}

function execute(path: string, statement: string): void {
  execFileSync('sqlite3', [path, statement], { encoding: 'utf8' });
}
