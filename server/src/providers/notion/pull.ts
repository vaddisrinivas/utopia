import { toNotionCanonicalProjection } from './projection';
import { readNotionConfig } from './client';
import { getNotionPort, type NotionQueryResponse } from './port';
import { queryNotionDataSourceRecords } from './push';

export type NotionPullInput = {
  domain?: string;
  collection?: string;
  limit?: number;
  pageId?: string;
  externalId?: string;
  signal?: AbortSignal;
};

export type NotionPullResult = {
  status: 'ready' | 'disabled';
  configured: boolean;
  records: ReturnType<typeof toNotionCanonicalProjection>[];
  source_snapshots: unknown[];
  message: string;
};

export type NotionLivePullResult = NotionPullResult & {
  status_code?: number;
  error?: string | null;
};

type NotionRecordLike = {
  id?: string;
  title?: unknown;
  name?: unknown;
  properties?: Record<string, unknown>;
  url?: string;
  created_time?: string;
  last_edited_time?: string;
  archived?: boolean;
  in_trash?: boolean;
  parent?: {
    database_id?: string;
  };
};

type NotionPropertyValue = {
  title?: unknown;
  rich_text?: unknown;
};

function propertyToText(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string') {
    return value.trim();
  }
  if (typeof value === 'number') {
    return String(value);
  }
  const record = value as NotionPropertyValue;
  const title = toArray(record.title).at(0);
  if (title && typeof title === 'object') {
    const candidate = title as { plain_text?: unknown; text?: { content?: unknown } };
    if (typeof candidate.plain_text === 'string') {
      return candidate.plain_text.trim();
    }
    if (typeof candidate.text?.content === 'string') {
      return candidate.text.content.trim();
    }
  }
  const richText = toArray(record.rich_text).at(0);
  if (richText && typeof richText === 'object') {
    const candidate = richText as { plain_text?: unknown; text?: { content?: unknown } };
    if (typeof candidate.plain_text === 'string') {
      return candidate.plain_text.trim();
    }
    if (typeof candidate.text?.content === 'string') {
      return candidate.text.content.trim();
    }
  }
  if (typeof value === 'object') {
    const candidate = value as { name?: unknown };
    if (typeof candidate.name === 'string') {
      return candidate.name;
    }
  }
  return '';
}

const FOOD_DETAIL_KEYS = ['Food detail', 'food_detail', 'Food Detail', 'Detail JSON', 'detail_json'];
const RELATION_KEYS = ['Relations', 'relations', 'Related records', 'related_records'];

function readFirstTextProperty(properties: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = propertyToText(properties[key]);
    if (value) return value;
  }
  return '';
}

function parseJsonProperty(properties: Record<string, unknown>, keys: string[]) {
  const value = readFirstTextProperty(properties, keys);
  if (!value) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function parseRelationProperty(properties: Record<string, unknown>) {
  const value = readFirstTextProperty(properties, RELATION_KEYS);
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed
        .map((relation) => {
          if (!relation || typeof relation !== 'object') return null;
          const record = relation as Record<string, unknown>;
          const name = typeof record.name === 'string' ? record.name.trim() : '';
          const targetId = typeof record.target_id === 'string' ? record.target_id.trim() : '';
          return name && targetId ? { name, target_id: targetId } : null;
        })
        .filter((relation): relation is { name: string; target_id: string } => relation !== null);
    }
  } catch {
    // fallback below
  }
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((target_id) => ({ name: 'supports', target_id }));
}

function toArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readRecordDomain(domainInput: NotionRecordLike, input: NotionPullInput) {
  const properties = candidateProperties(domainInput) || {};
  const domain =
    input.domain ||
    propertyToText(properties['Utopia Domain']) ||
    propertyToText(properties['Lifeos Domain']) ||
    propertyToText((domainInput as { domain?: unknown }).domain) ||
    propertyToText(properties['Domain']) ||
    propertyToText((domainInput as { Domain?: unknown }).Domain);
  const collection =
    input.collection ||
    propertyToText(properties['Utopia Collection']) ||
    propertyToText(properties['Lifeos Collection']) ||
    propertyToText((domainInput as { collection?: unknown }).collection) ||
    propertyToText(properties['Collection']) ||
    propertyToText((domainInput as { Collection?: unknown }).Collection);
  return {
    domain: domain || 'food',
    collection: collection || 'recipe',
  };
}

export type NotionSourceSnapshot = {
  provider: 'notion';
  data_source_id: string | null;
  dataSourceId?: string | null;
  page_id: string;
  pageId?: string;
  block_id: string | null;
  blockId?: string | null;
  range: string;
  parentDatabaseId: string | null;
  domain: string;
  collection: string;
  archived: boolean;
  inTrash: boolean;
  createdTime: string | null;
  lastEditedTime: string | null;
  properties: Record<string, unknown>;
  unsupported: Record<string, unknown>;
};

function candidateProperties(row: NotionRecordLike): Record<string, unknown> | null {
  if (!row.properties || typeof row.properties !== 'object') {
    return null;
  }
  return row.properties;
}

function inferTitle(row: NotionRecordLike): string {
  const properties = candidateProperties(row) || {};
  return (
    propertyToText(properties.Name) ||
    propertyToText(row.title) ||
    propertyToText(row.name) ||
    String(row.id || '').trim()
  );
}

function buildNotionSourceSnapshot(input: {
  candidate: NotionRecordLike;
  mapped: { domain: string; collection: string };
  pageId: string;
  configDataSourceId: string | undefined;
  properties: Record<string, unknown>;
  unsupported: Record<string, unknown>;
}) {
  return {
    provider: 'notion' as const,
    data_source_id: input.configDataSourceId || null,
    dataSourceId: input.configDataSourceId || null,
    page_id: input.pageId,
    pageId: input.pageId,
    block_id: null,
    blockId: null,
    range: `/pages/${input.pageId}`,
    parentDatabaseId: input.candidate.parent?.database_id ?? null,
    domain: input.mapped.domain,
    collection: input.mapped.collection,
    archived: Boolean(input.candidate.archived),
    inTrash: Boolean(input.candidate.in_trash),
    createdTime: typeof input.candidate.created_time === 'string' ? input.candidate.created_time : null,
    lastEditedTime: typeof input.candidate.last_edited_time === 'string' ? input.candidate.last_edited_time : null,
    properties: input.properties,
    unsupported: input.unsupported,
  };
}

export function pullNotionRecords(input: NotionPullInput = {}): NotionPullResult {
  const config = readNotionConfig();
  if (!config) {
    return {
      status: 'disabled',
      configured: false,
      records: [],
      source_snapshots: [],
      message: 'Notion adapter write/read is disabled without token.',
    };
  }

  if (!config.dataSourceId) {
    return {
      status: 'disabled',
      configured: true,
      records: [],
      source_snapshots: [],
      message: 'NOTION_DATA_SOURCE_ID is missing; data_source_id-first discovery is required.',
    };
  }

  return {
    status: 'ready',
    configured: true,
    records: [],
    source_snapshots: [],
    message: `Notion pull ready for data_source_id ${config.dataSourceId}${input.collection ? ` and collection ${input.collection}` : ''}.`,
  };
}

export async function pullNotionRecordsLive(input: NotionPullInput = {}): Promise<NotionLivePullResult> {
  const config = readNotionConfig();
  if (!config) {
    return {
      status: 'disabled',
      configured: false,
      records: [],
      source_snapshots: [],
      message: 'Notion adapter read is disabled without token.',
      error: 'NOTION_TOKEN is not configured.',
      status_code: 0,
    };
  }

  if (!config.dataSourceId) {
    return {
      status: 'disabled',
      configured: true,
      records: [],
      source_snapshots: [],
      message: 'NOTION_DATA_SOURCE_ID is missing; data_source_id-first discovery is required.',
      error: 'NOTION_DATA_SOURCE_ID is missing.',
      status_code: 0,
    };
  }

  const port = getNotionPort(config);
  if (!port) {
    return {
      status: 'disabled',
      configured: true,
      records: [],
      source_snapshots: [],
      message: 'Notion SDK port is unavailable.',
      error: 'Notion SDK port is unavailable.',
      status_code: 0,
    };
  }
  const pageSize = Math.max(1, Math.min(input.limit ?? 50, 100));
  const targetPageId = input.pageId?.trim() || input.externalId?.trim() || '';
  let cursor: string | null = null;
  let statusCode = 200;
  const rows: Array<{ projection: ReturnType<typeof toNotionCanonicalProjection>; source: NotionSourceSnapshot }> = [];
  let hasMore = true;
  while (hasMore) {
    const response = await port.queryDataSource({
      dataSourceId: config.dataSourceId,
      pageSize,
      ...(cursor ? { startCursor: cursor } : {}),
      signal: input.signal,
    });

    if (!response.ok) {
      return {
        status: 'disabled',
        configured: true,
        records: [],
        source_snapshots: [],
        message: `Notion pull failed for ${config.dataSourceId}`,
        error: response.error?.message || 'notion pull failed',
        status_code: response.status,
      };
    }

    statusCode = response.status;
    const rowsInput = Array.isArray(response.data?.results) ? response.data.results : [];
    for (const row of rowsInput) {
      if (!row || typeof row !== 'object') {
        continue;
      }
      const candidate = row as NotionRecordLike;
      const pageId = typeof candidate.id === 'string' ? candidate.id : '';
      if (!pageId) {
        continue;
      }

      const properties = candidateProperties(candidate) || {};
      const mapped = readRecordDomain(candidate, input);
      const title = inferTitle(candidate);
      if (!title) {
        continue;
      }

      if (input.domain && mapped.domain !== input.domain) {
        continue;
      }

      if (input.collection && mapped.collection !== input.collection) {
        continue;
      }

      const filtered = {
        ...properties,
        food_detail: parseJsonProperty(properties, FOOD_DETAIL_KEYS),
        notion: {
          domain: properties['Utopia Domain'] ?? properties['Lifeos Domain'] ?? properties.Domain ?? properties['domain'] ?? undefined,
          collection: properties['Utopia Collection'] ?? properties['Lifeos Collection'] ?? properties.Collection ?? properties['collection'] ?? undefined,
          source: 'data_source',
          data_source_id: config.dataSourceId,
        },
      };
      if (filtered.food_detail === undefined) {
        delete filtered.food_detail;
      }
      const relations = parseRelationProperty(properties);
      const unsupportedProperties = Object.entries(properties).reduce<Record<string, unknown>>((acc, [key, value]) => {
        if (key === 'Name' || key === 'notion' || key === 'Domain' || key === 'Collection' || key === 'Utopia Domain' || key === 'Utopia Collection') {
          return acc;
        }
        acc[key] = value;
        return acc;
      }, {});

      rows.push({
        projection: toNotionCanonicalProjection({
          id: pageId,
          domain: mapped.domain,
          collection: mapped.collection,
          title,
          properties: filtered,
          relations,
        }),
        source: buildNotionSourceSnapshot({
          candidate,
          mapped,
          pageId,
          configDataSourceId: config.dataSourceId,
          properties: filtered,
          unsupported: unsupportedProperties,
        }),
      });
    }

    const foundTarget = targetPageId && rows.some((entry) => entry.projection.id === targetPageId);
    const limitSatisfied = !targetPageId && rows.length >= (input.limit ?? 50);
    hasMore = Boolean(response.data?.has_more) && !foundTarget && !limitSatisfied;
    cursor = response.data?.next_cursor || null;
  }

  const limitedRows = rows.slice(0, targetPageId ? rows.length : (input.limit ?? rows.length));

  return {
    status: 'ready',
    configured: true,
    records: limitedRows.map((entry) => entry.projection),
    source_snapshots: limitedRows.map((entry) => entry.source),
    message: `Notion pull succeeded for data_source_id ${config.dataSourceId} with ${limitedRows.length} records.`,
    status_code: statusCode,
    error: null,
  };
}

export async function pullNotionRecordsFromProjection(limit = 50) {
  const result = await queryNotionDataSourceRecords(limit);
  if (!result.ok) {
    return [];
  }
  return result.records.map((record) => toNotionCanonicalProjection({ ...record, domain: 'food', collection: 'recipe' }));
}
