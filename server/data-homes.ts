import { Client as Notion } from '@notionhq/client';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { google } from 'googleapis';
import { z } from 'zod';

import type { JsonRecord } from '@/src/kernel/runtime';
import type { Provider } from '@/src/kernel/services';

const Base = z.object({
  id: z.string().min(1),
  resource: z.string().min(1),
  secretRef: z.string().regex(/^UTOPIA_[A-Z0-9_]+$/),
});
const Config = z.discriminatedUnion('kind', [
  Base.extend({ kind: z.literal('postgres') }),
  Base.extend({ kind: z.literal('notion') }),
  Base.extend({ kind: z.literal('google-sheets'), range: z.string().min(1).default('Utopia!A:E') }),
]);
type Config = z.infer<typeof Config>;

const text = (value: unknown) => Array.isArray(value)
  ? value.map((item) => String((item as { plain_text?: string }).plain_text ?? '')).join('')
  : '';
const richText = (value: string) => value.match(/[\s\S]{1,2000}/g)?.map((content) => ({ type: 'text' as const, text: { content } })) ?? [];

function notionHome(config: Extract<Config, { kind: 'notion' }>, token: string): Provider {
  const notion = new Notion({ auth: token });
  const notionMethods = notion as { dataSources?: { query?: (input: Record<string, unknown>) => Promise<{ results: unknown[] }> }; databases?: { query?: (input: Record<string, unknown>) => Promise<{ results: unknown[]; has_more?: boolean; next_cursor?: string | null }> } };
  const canQueryDataSource = Boolean(notionMethods.dataSources?.query);
  const canQueryDatabase = Boolean(notionMethods.databases?.query);
  const missingQuery = !canQueryDataSource && !canQueryDatabase;

  if (missingQuery) throw new Error(`unsupported notion client methods for ${config.id}`);

  const pages = async () => {
      const results = canQueryDataSource
        ? (await notionMethods.dataSources!.query!({ data_source_id: config.resource, page_size: 100, result_type: 'page' })).results
        : (await notionMethods.databases!.query!({ database_id: config.resource, page_size: 100 })).results;
    return results.filter((item): item is { properties: unknown; id: string; created_time: string; last_edited_time: string } => Boolean(item && typeof item === 'object' && 'id' in item && 'properties' in (item as { properties?: unknown })));
  };

  const decode = (page: Awaited<ReturnType<typeof pages>>[number]): JsonRecord => {
    const props = page.properties as Record<string, Record<string, unknown>>;
    const payload = JSON.parse(text(props.Payload?.rich_text) || '{}') as Record<string, unknown>;
    return {
      id: text(props.UtopiaId?.rich_text) || page.id,
      collection: text(props.Collection?.rich_text) || 'item',
      createdAt: String((props.Created?.date as { start?: string } | undefined)?.start ?? page.created_time),
      updatedAt: String((props.Updated?.date as { start?: string } | undefined)?.start ?? page.last_edited_time),
      values: payload,
    };
  };
  return {
    async pull() {
      const records = (await pages()).map(decode);
      return { records, cursor: records.reduce((latest, item) => item.updatedAt > latest ? item.updatedAt : latest, '') || undefined };
    },
    async push(records) {
      const existing = new Map((await pages()).map((page) => [decode(page).id, page.id]));
      for (const record of records) {
        const properties = {
          Name: { title: richText(String(record.values.name ?? record.id)) },
          UtopiaId: { rich_text: richText(record.id) },
          Collection: { rich_text: richText(record.collection) },
          Created: { date: { start: record.createdAt } },
          Updated: { date: { start: record.updatedAt } },
          Payload: { rich_text: richText(JSON.stringify(record.values)) },
        };
        const pageId = existing.get(record.id);
        if (pageId) await notion.pages.update({ page_id: pageId, properties });
        else await notion.pages.create({
          parent: canQueryDataSource
            ? { type: 'data_source_id', data_source_id: config.resource }
            : { type: 'database_id', database_id: config.resource },
          properties,
        });
      }
      return { cursor: records.reduce((latest, item) => item.updatedAt > latest ? item.updatedAt : latest, '') || undefined };
    },
  };
}

function sheetsHome(config: Extract<Config, { kind: 'google-sheets' }>, credentials: string): Provider {
  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(credentials) as Record<string, string>,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const sheets = google.sheets({ version: 'v4', auth });
  const rows = async () => (await sheets.spreadsheets.values.get({
    spreadsheetId: config.resource,
    range: config.range,
  })).data.values ?? [];
  const decode = (row: unknown[]): JsonRecord => ({
    id: String(row[0]),
    collection: String(row[1] || 'item'),
    createdAt: String(row[2] || ''),
    updatedAt: String(row[3] || ''),
    values: JSON.parse(String(row[4] || '{}')) as Record<string, unknown>,
  });
  return {
    async pull() {
      const records = (await rows()).slice(1).filter((row) => row[0]).map(decode);
      return { records, cursor: records.reduce((latest, item) => item.updatedAt > latest ? item.updatedAt : latest, '') || undefined };
    },
    async push(records) {
      const current = await rows();
      const index = new Map(current.slice(1).map((row, offset) => [String(row[0]), offset + 2]));
      const sheet = config.range.split('!')[0];
      for (const record of records) {
        const values = [[record.id, record.collection, record.createdAt, record.updatedAt, JSON.stringify(record.values)]];
        const row = index.get(record.id);
        if (row) await sheets.spreadsheets.values.update({
          spreadsheetId: config.resource, range: `${sheet}!A${row}:E${row}`,
          valueInputOption: 'RAW', requestBody: { values },
        });
        else await sheets.spreadsheets.values.append({
          spreadsheetId: config.resource, range: config.range,
          valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS', requestBody: { values },
        });
      }
      return { cursor: records.reduce((latest, item) => item.updatedAt > latest ? item.updatedAt : latest, '') || undefined };
    },
  };
}

function postgresHome(connectionString: string): Provider {
  const db = drizzle(connectionString);
  const ready = db.execute(sql`create table if not exists utopia_records (
    id text primary key, collection text not null, created_at timestamptz not null,
    updated_at timestamptz not null, values_json jsonb not null
  )`);
  return {
    async pull(cursor) {
      await ready;
      const result = await db.execute(sql`select id, collection, created_at, updated_at, values_json from utopia_records
        where updated_at > ${cursor || '1970-01-01T00:00:00.000Z'} order by updated_at asc limit 1000`);
      const records = result.rows.map((row) => ({
        id: String(row.id), collection: String(row.collection),
        createdAt: new Date(String(row.created_at)).toISOString(),
        updatedAt: new Date(String(row.updated_at)).toISOString(),
        values: row.values_json as Record<string, unknown>,
      }));
      return { records, cursor: records.at(-1)?.updatedAt };
    },
    async push(records) {
      await ready;
      await db.transaction(async (tx) => {
        for (const record of records) await tx.execute(sql`insert into utopia_records
          (id, collection, created_at, updated_at, values_json) values
          (${record.id}, ${record.collection}, ${record.createdAt}, ${record.updatedAt}, ${JSON.stringify(record.values)}::jsonb)
          on conflict (id) do update set collection=excluded.collection, updated_at=excluded.updated_at, values_json=excluded.values_json
          where utopia_records.updated_at <= excluded.updated_at`);
      });
      return { cursor: records.reduce((latest, item) => item.updatedAt > latest ? item.updatedAt : latest, '') || undefined };
    },
  };
}

export function createDataHomes(value: unknown, env: NodeJS.ProcessEnv = process.env): Record<string, Provider> {
  return Object.fromEntries(z.array(Config).parse(value).map((config) => {
    const secret = env[config.secretRef];
    if (!secret) throw new Error(`${config.secretRef} missing`);
    const home = config.kind === 'postgres' ? postgresHome(secret)
      : config.kind === 'notion' ? notionHome(config, secret) : sheetsHome(config, secret);
    return [config.id, home];
  }));
}
