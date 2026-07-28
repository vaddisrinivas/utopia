import { nowIsoNow, ProviderWriteResult, ProviderOperation } from '../contracts';
import { readNotionConfig } from './client';
import { getNotionPort, type NotionWriteResponse } from './port';

export type NotionWriteInput = {
  operation: ProviderOperation;
  recordId: string;
  domain: string;
  collection: string;
  title?: string;
  externalId?: string;
};

export type NotionSourceSnapshot = {
  provider: 'notion';
  operation: ProviderOperation;
  data_source_id: string | null;
  dataSourceId?: string | null;
  page_id: string | null;
  pageId?: string | null;
  block_id: string | null;
  blockId?: string | null;
  range: string | null;
  domain: string;
  collection: string;
  title: string | null;
  parentDatabaseId: string | null;
  archived: boolean;
  createdTime: string | null;
  lastEditedTime: string | null;
  unsupported: Record<string, unknown>;
  provider_snapshot: Record<string, unknown>;
  observed_at: string;
  configured: boolean;
};

export type NotionWriteResult = {
  ok: boolean;
  success: boolean;
  source_snapshot?: NotionSourceSnapshot;
  source?: Record<string, unknown>;
  error?: string;
  response?: NotionWriteResponse;
  provider_record_id?: string | null;
  action_receipt?: {
    provider: 'notion';
    source_snapshot: NotionSourceSnapshot;
    provider_record_id: string | null;
  };
};

export function buildNotionWriteSource(input: NotionWriteInput): ProviderWriteResult {
  const config = readNotionConfig();
  if (!config) {
    return {
      ok: false,
      source: {
        provider: 'notion',
        external_id: '',
        url: null,
        observed_at: nowIsoNow(),
        content_hash: null,
      },
      source_snapshot: {
        provider: 'notion',
        operation: input.operation,
        data_source_id: null,
        page_id: null,
        pageId: null,
        block_id: null,
        range: null,
        domain: input.domain,
        collection: input.collection,
        title: input.title ?? null,
        parentDatabaseId: null,
        archived: false,
        createdTime: null,
        lastEditedTime: null,
        unsupported: {},
        provider_snapshot: {
          mode: 'not_configured',
          source_type: 'notion_adapter',
          configured: false,
        },
        observed_at: nowIsoNow(),
        configured: false,
      },
      operation: input.operation,
      reason: 'Notion write adapter is not configured.',
      requiredConfig: ['NOTION_TOKEN'],
    };
  }

  if (!config.dataSourceId) {
    return {
      ok: false,
      source: {
        provider: 'notion',
        external_id: input.externalId?.trim() || `notion-${input.recordId}`,
        url: null,
        observed_at: nowIsoNow(),
        content_hash: null,
      },
      source_snapshot: {
        provider: 'notion',
        operation: input.operation,
        data_source_id: null,
        page_id: null,
        pageId: null,
        block_id: null,
        range: null,
        domain: input.domain,
        collection: input.collection,
        title: input.title ?? null,
        parentDatabaseId: null,
        archived: false,
        createdTime: null,
        lastEditedTime: null,
        unsupported: {},
        provider_snapshot: {
          mode: 'missing_data_source',
          source_type: 'notion_adapter',
          configured: false,
        },
        observed_at: nowIsoNow(),
        configured: false,
      },
      operation: input.operation,
      reason: 'Notion write adapter missing data source id.',
      requiredConfig: ['NOTION_DATA_SOURCE_ID'],
    };
  }

  const stableId = input.externalId?.trim() || `notion-${input.recordId}`;
  const pageUrl = input.externalId?.trim().startsWith('https://') ? input.externalId!.trim() : null;

  return {
    ok: true,
    source: {
      provider: 'notion',
      external_id: stableId,
      url: pageUrl,
      observed_at: nowIsoNow(),
      content_hash: null,
    },
      source_snapshot: {
        provider: 'notion',
        operation: input.operation,
        data_source_id: config.dataSourceId ?? null,
      dataSourceId: config.dataSourceId ?? null,
      page_id: null,
      pageId: null,
      block_id: null,
      range: null,
      domain: input.domain,
      collection: input.collection,
      title: input.title ?? null,
        parentDatabaseId: null,
        archived: false,
        createdTime: null,
        lastEditedTime: null,
        unsupported: {},
        provider_snapshot: {
          mode: 'ready',
          source_type: 'notion_adapter',
          configured: true,
          data_source_id: config.dataSourceId,
        },
        observed_at: nowIsoNow(),
        configured: true,
      },
    operation: input.operation,
  };
}

export type NotionPullRecord = {
  id: string;
  properties: Record<string, unknown>;
  archived: boolean;
};

export type NotionRecordPayload = {
  operation: ProviderOperation;
  recordId: string;
  pageId?: string;
  databaseId?: string;
  domain: string;
  collection: string;
  title?: string;
  properties?: Record<string, unknown>;
  archived?: boolean;
  externalId?: string;
};

type NotionWriteInputRecord = {
  operation: ProviderOperation;
  recordId: string;
  pageId?: string;
  domain: string;
  collection: string;
  title?: string;
  properties?: Record<string, unknown>;
  archived?: boolean;
  externalId?: string;
};

const NOTION_UNSUPPORTED_KEYS = new Set(['Name', 'Utopia Domain', 'Utopia Collection', 'Domain', 'Collection']);

export function normalizeNotionProperties(input?: Record<string, unknown>) {
  return input && typeof input === 'object' ? input : {};
}

export function pickNotionUnsupportedProperties(input?: Record<string, unknown>) {
  const properties = normalizeNotionProperties(input);
  return Object.entries(properties).reduce<Record<string, unknown>>((acc, [key, value]) => {
    if (!NOTION_UNSUPPORTED_KEYS.has(key)) {
      acc[key] = value;
    }
    return acc;
  }, {});
}

export function buildNotionCreateSource(input: {
  recordId: string;
  domain: string;
  collection: string;
  title?: string;
  externalId?: string;
}) {
  return buildNotionWriteSource({ ...input, operation: 'create_record' });
}

export function buildNotionUpdateSource(input: { recordId: string; domain: string; collection: string }) {
  return buildNotionWriteSource({ ...input, operation: 'update_record' });
}

export function buildNotionArchiveSource(input: { recordId: string; domain: string; collection: string }) {
  return buildNotionWriteSource({ ...input, operation: 'archive_record' });
}

function normalizeNotionRecordPayload(input: NotionWriteInputRecord) {
  const title = input.title?.trim() || input.recordId;
  const properties = input.properties ? { ...input.properties } : {};
  const domainSourceProperty = properties['Utopia Domain']
    ? { 'Utopia Domain': properties['Utopia Domain'] }
    : { 'Utopia Domain': input.domain };
  const collectionSourceProperty = properties['Utopia Collection']
    ? { 'Utopia Collection': properties['Utopia Collection'] }
    : { 'Utopia Collection': input.collection };

  const payload: Record<string, unknown> = {
    properties: {
      Name: {
        title: [
          {
            type: 'text',
            text: { content: title },
          },
        ],
      },
      ...domainSourceProperty,
      ...collectionSourceProperty,
      ...(properties['Utopia Domain'] ? {} : { Domain: input.domain }),
      ...(properties['Utopia Collection'] ? {} : { Collection: input.collection }),
      ...properties,
    },
  };

  if (input.pageId) {
    payload.id = input.pageId;
  }
  if (input.archived !== undefined) {
    payload.archived = input.archived;
  }
  return payload;
}

function responsePageId(response?: NotionWriteResponse) {
  return typeof response?.id === 'string' && response.id.length > 0 ? response.id : null;
}

function buildNotionSourceSnapshot(input: {
  operation: ProviderOperation;
  domain: string;
  collection: string;
  title?: string;
  pageId?: string;
  response?: NotionWriteResponse;
  archived?: boolean;
  dataSourceId?: string;
  unsupported?: Record<string, unknown>;
  includeConfigured?: boolean;
}) {
  const configDataSourceId = input.dataSourceId ?? null;
  const pageId = input.pageId || responsePageId(input.response);
  const normalizedDataSourceId = configDataSourceId?.trim().length ? configDataSourceId : null;
  const normalizedPageId = pageId || null;
  const unsupported = input.unsupported ?? {};
  const mode = input.includeConfigured ? 'ready' : 'deferred';

  return {
    provider: 'notion' as const,
    operation: input.operation,
    data_source_id: normalizedDataSourceId,
    dataSourceId: normalizedDataSourceId,
    page_id: normalizedPageId,
    pageId: normalizedPageId,
    block_id: null,
    blockId: null,
    range: normalizedPageId ? `/pages/${normalizedPageId}` : null,
    domain: input.domain || 'food',
    collection: input.collection || 'recipe',
    title: input.title?.trim() || null,
    parentDatabaseId: input.response?.parent?.database_id ?? null,
    archived: input.archived ?? false,
    createdTime: input.response?.created_time ?? null,
    lastEditedTime: input.response?.last_edited_time ?? null,
    unsupported,
    provider_snapshot: {
      mode,
      source_type: 'notion_api_call',
      provider: 'notion',
      data_source_id: normalizedDataSourceId,
      page_id: normalizedPageId,
      block_id: null,
      range: normalizedPageId ? `/pages/${normalizedPageId}` : null,
      operation: input.operation,
      archived: input.archived ?? false,
      captured_at: nowIsoNow(),
    },
    observed_at: nowIsoNow(),
    configured: input.includeConfigured ?? false,
  };
}

function buildUpdatePayload(input: NotionWriteInputRecord) {
  const payload = normalizeNotionRecordPayload(input);
  const unsupported = pickNotionUnsupportedProperties(input.properties);
  return {
    ...payload,
    ...(Object.keys(unsupported).length > 0 ? { provider_snapshot: unsupported } : {}),
    ...(typeof input.archived === 'boolean' ? { archived: input.archived } : {}),
  };
}

export async function writeNotionRecord(input: NotionWriteInputRecord): Promise<NotionWriteResult> {
  const config = readNotionConfig();
  const targetPageId = input.pageId?.trim() || input.externalId?.trim();

  if (!config) {
    return {
      ok: false,
      success: false,
      error: 'NOTION_TOKEN is not configured.',
    };
  }
  if (!config.dataSourceId) {
    return {
      ok: false,
      success: false,
      error: 'NOTION_DATA_SOURCE_ID is missing.',
      source_snapshot: {
        provider: 'notion',
        operation: input.operation,
        data_source_id: null,
        page_id: targetPageId ?? null,
        pageId: targetPageId ?? null,
        block_id: null,
        range: targetPageId ? `/pages/${targetPageId}` : null,
        domain: input.domain,
        collection: input.collection,
        title: input.title ?? null,
        parentDatabaseId: null,
        archived: input.archived ?? false,
        createdTime: null,
        lastEditedTime: null,
        unsupported: pickNotionUnsupportedProperties(input.properties),
        provider_snapshot: {
          mode: 'missing_data_source',
          source_type: 'notion_adapter',
          configured: false,
          data_source_id: null,
          page_id: input.pageId ?? null,
        },
        observed_at: nowIsoNow(),
        configured: false,
      },
    };
  }

  const port = getNotionPort(config);
  if (!port) {
    return {
      ok: false,
      success: false,
      error: 'Notion SDK port is unavailable.',
    };
  }

  const sourceSnapshot = buildNotionSourceSnapshot({
    operation: input.operation,
    domain: input.domain,
    collection: input.collection,
    title: input.title,
    unsupported: pickNotionUnsupportedProperties(input.properties),
    dataSourceId: config.dataSourceId,
    includeConfigured: true,
  });

  const payload = normalizeNotionRecordPayload(input);
  const unsupported = pickNotionUnsupportedProperties(input.properties);
  if (input.operation === 'create_record') {
    const response = await port.createPage({
      dataSourceId: config.dataSourceId,
      payload: {
        ...payload,
        ...(Object.keys(unsupported).length > 0 ? { provider_snapshot: unsupported } : {}),
      },
    });

    if (!response.ok) {
      return {
        ok: false,
        success: false,
        error: response.error?.message || 'notion create page failed',
        source_snapshot: sourceSnapshot,
      };
    }

    const responseSnapshot = buildNotionSourceSnapshot({
      operation: input.operation,
      domain: input.domain,
      collection: input.collection,
      title: input.title,
      response: response.data,
      dataSourceId: config.dataSourceId,
      unsupported,
      includeConfigured: true,
    });
    const providerRecordId = responsePageId(response.data);

    return {
      ok: true,
      success: true,
      provider_record_id: providerRecordId,
      response: response.data,
      source: response.data
        ? {
            provider: 'notion',
            external_id: response.data.id || input.recordId,
            url: response.data.url || null,
            observed_at: nowIsoNow(),
            content_hash: null,
          }
        : undefined,
      source_snapshot: responseSnapshot,
      action_receipt: {
        provider: 'notion',
        source_snapshot: responseSnapshot,
        provider_record_id: providerRecordId,
      },
    };
  }

  if (!targetPageId) {
    return {
      ok: false,
      success: false,
      error: 'pageId/external id is required for update/archive operations',
      source_snapshot: sourceSnapshot,
    };
  }

  const response = await port.updatePage({
    pageId: targetPageId,
    payload: buildUpdatePayload(input),
  });
  if (!response.ok) {
    return {
      ok: false,
      success: false,
      error: response.error?.message || `notion ${input.operation} failed`,
      source_snapshot: sourceSnapshot,
    };
  }

  const responseSnapshot = buildNotionSourceSnapshot({
    operation: input.operation,
    domain: input.domain,
    collection: input.collection,
    title: input.title,
    pageId: targetPageId,
    response: response.data,
    archived: input.archived ?? input.operation === 'archive_record',
    dataSourceId: config.dataSourceId,
    unsupported,
    includeConfigured: true,
  });
  const providerRecordId = responsePageId(response.data) || targetPageId || null;

  return {
    ok: true,
    success: true,
    provider_record_id: providerRecordId,
    response: response.data,
    source: response.data
        ? {
            provider: 'notion',
            external_id: response.data.id || targetPageId || input.recordId,
            url: response.data.url || null,
            observed_at: nowIsoNow(),
            content_hash: null,
        }
      : undefined,
    source_snapshot: responseSnapshot,
    action_receipt: {
      provider: 'notion',
      source_snapshot: responseSnapshot,
      provider_record_id: providerRecordId,
    },
  };
}

export async function queryNotionDataSourceRecords(limit = 50): Promise<{ ok: boolean; records: NotionPullRecord[]; error?: string }> {
  const config = readNotionConfig();
  if (!config?.dataSourceId) {
    return { ok: false, records: [], error: 'NOTION_DATA_SOURCE_ID is not configured.' };
  }
  if (!config.token) {
    return { ok: false, records: [], error: 'NOTION_TOKEN is not configured.' };
  }

  const port = getNotionPort(config);
  if (!port) {
    return { ok: false, records: [], error: 'Notion SDK port is unavailable.' };
  }
  const response = await port.queryDataSource({
    dataSourceId: config.dataSourceId,
    pageSize: Math.max(1, Math.min(limit, 100)),
  });

  if (!response.ok) {
    return { ok: false, records: [], error: response.error?.message || 'notion source query failed' };
  }

  const raw = Array.isArray((response.data as { results?: unknown[] })?.results)
    ? (response.data as { results: unknown[] }).results
    : [];
  const records: NotionPullRecord[] = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') {
      continue;
    }
    const rec = row as Record<string, unknown>;
    const id = typeof rec.id === 'string' ? rec.id : '';
    if (!id) {
      continue;
    }
    const properties = rec.properties && typeof rec.properties === 'object' && !Array.isArray(rec.properties)
      ? (rec.properties as Record<string, unknown>)
      : {};
    records.push({
      id,
      properties,
      archived: Boolean(rec.archived),
    });
  }

  return {
    ok: true,
    records,
  };
}
