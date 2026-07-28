import type { SQLiteDatabase } from 'expo-sqlite';

import { DEFAULT_APP_INSTALLATION_ID } from '@/packages/shared/contracts/app-installation';
import type { CanonicalRecord } from '@/src/domain/runtime';
import { enqueueOutboxEvent, getOutboxEventByActionKey, markOutboxEvent, type OutboxEvent } from '@/src/db/outbox';
import type { DirectSyncProvider } from '@/src/providers/provider-local-copy';
import type { UtopiaSettings } from '@/src/settings/utopia-settings';

export type ProviderWriteOperation = 'create_record' | 'update_record' | 'archive_record' | 'restore_record';

export type ProviderWritePayload = {
  schema_version: 'utopia.provider-write.v1';
  app_installation_id: string;
  provider: DirectSyncProvider;
  operation: ProviderWriteOperation;
  op_id: string;
  record_id: string;
  expected_revision: number | null;
  record: CanonicalRecord | null;
  before: CanonicalRecord | null;
  external_id: string | null;
  endpoint: '/providers/notion/push' | '/providers/sheets/push';
};

export type ProviderWritebackResult =
  | { status: 'queued'; event: OutboxEvent; payload: ProviderWritePayload }
  | { status: 'duplicate'; event: OutboxEvent; payload: ProviderWritePayload }
  | { status: 'rejected'; op_id: string; reject_reason: string };

export type ProviderWriteDeliveryResult =
  | { status: 'delivered'; event_id: string; provider: DirectSyncProvider; statusCode: number; readback: Record<string, unknown> }
  | { status: 'blocked'; event_id: string; provider?: DirectSyncProvider; reason: string }
  | { status: 'pending_verification'; event_id: string; provider: DirectSyncProvider; statusCode: number; reason: string }
  | { status: 'failed'; event_id: string; provider: DirectSyncProvider; statusCode: number; reason: string };

type FetchLike = (url: string, init: {
  method: string;
  headers: Record<string, string>;
  body?: string;
}) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

type OperationRow = {
  op_id: string;
  app_installation_id: string;
  kind: string;
  domain: string;
  collection: string;
  record_id: string;
  expected_revision: number | null;
  result_revision: number | null;
  before_json: string | null;
  after_json: string | null;
  status: string;
};

function safeId(value: string) {
  return value.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 180);
}

function normalizeInstallationId(value?: string | null): string {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : DEFAULT_APP_INSTALLATION_ID;
}

function parseRecord(value: string | null): CanonicalRecord | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as CanonicalRecord;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function endpointFor(provider: DirectSyncProvider): ProviderWritePayload['endpoint'] {
  return provider === 'google_sheets' ? '/providers/sheets/push' : '/providers/notion/push';
}

function externalIdFor(provider: DirectSyncProvider, record: CanonicalRecord | null) {
  if (!record) return null;
  return record.source.provider === provider ? record.source.external_id : record.id;
}

function providerOperation(row: OperationRow, after: CanonicalRecord | null): ProviderWriteOperation {
  if (row.kind === 'restore') return 'restore_record';
  if (row.kind === 'archive' || row.kind === 'delete' || after?.deleted || after?.archived_at) return 'archive_record';
  if (!row.before_json) return 'create_record';
  return 'update_record';
}

export async function enqueueProviderWriteForOperation(input: {
  db: SQLiteDatabase;
  provider: DirectSyncProvider;
  opId: string;
  appInstallationId?: string | null;
}): Promise<ProviderWritebackResult> {
  const appInstallationId = normalizeInstallationId(input.appInstallationId);
  const row = await input.db.getFirstAsync<OperationRow>(
    'SELECT * FROM operations WHERE app_installation_id = ? AND op_id = ?',
    [appInstallationId, input.opId],
  );
  if (!row) return { status: 'rejected', op_id: input.opId, reject_reason: 'operation_not_found' };
  if (row.status !== 'applied') return { status: 'rejected', op_id: input.opId, reject_reason: `operation_not_applied:${row.status}` };

  const before = parseRecord(row.before_json);
  const after = parseRecord(row.after_json);
  if (!after && !before) return { status: 'rejected', op_id: input.opId, reject_reason: 'operation_has_no_record_image' };

  const record = after ?? before;
  const payload: ProviderWritePayload = {
    schema_version: 'utopia.provider-write.v1',
    app_installation_id: appInstallationId,
    provider: input.provider,
    operation: providerOperation(row, after),
    op_id: row.op_id,
    record_id: row.record_id,
    expected_revision: row.expected_revision ?? null,
    record: after,
    before,
    external_id: externalIdFor(input.provider, record),
    endpoint: endpointFor(input.provider),
  };
  const actionKey = `provider-write:${appInstallationId}:${input.provider}:${row.op_id}`;
  const duplicate = await getOutboxEventByActionKey(input.db, actionKey);
  if (duplicate) return { status: 'duplicate', event: duplicate, payload };

  const event = await enqueueOutboxEvent(input.db, {
    id: `provider-write-${safeId(input.provider)}-${safeId(row.op_id)}`,
    action_key: actionKey,
    domain: row.domain,
    app_installation_id: appInstallationId,
    payload_json: JSON.stringify(payload),
  });
  return { status: 'queued', event, payload };
}

function parsePayload(event: OutboxEvent): ProviderWritePayload | null {
  try {
    const parsed = JSON.parse(event.payload_json) as ProviderWritePayload;
    return parsed?.schema_version === 'utopia.provider-write.v1' ? parsed : null;
  } catch {
    return null;
  }
}

function recordTitle(record: CanonicalRecord | null) {
  return record?.title?.trim() || record?.id || 'Utopia record';
}

function notionProperties(record: CanonicalRecord | null) {
  return {
    Name: {
      title: [{ type: 'text', text: { content: recordTitle(record) } }],
    },
  };
}

function firstDataSourceId(settings: UtopiaSettings) {
  return settings.notion.dataSourceIds.split(',').map((id) => id.trim()).filter(Boolean)[0] ?? '';
}

function buildNotionRequest(payload: ProviderWritePayload, settings: UtopiaSettings) {
  if (!settings.notion.enabled || !settings.notion.token.trim()) return { blocked: 'Notion token is missing.' };
  const dataSourceId = firstDataSourceId(settings);
  if (payload.operation === 'create_record') {
    if (!dataSourceId) return { blocked: 'Notion data source ID is missing.' };
    return {
      url: 'https://api.notion.com/v1/pages',
      init: {
        method: 'POST',
        headers: {
          authorization: `Bearer ${settings.notion.token.trim()}`,
          'content-type': 'application/json',
          'notion-version': '2026-03-11',
        },
        body: JSON.stringify({
          parent: { data_source_id: dataSourceId },
          properties: notionProperties(payload.record),
        }),
      },
    };
  }
  const pageId = payload.external_id?.trim();
  if (!pageId) return { blocked: 'Notion page ID is missing for update/archive.' };
  const body = payload.operation === 'archive_record'
    ? { in_trash: true }
    : payload.operation === 'restore_record'
      ? { in_trash: false, properties: notionProperties(payload.record) }
      : { properties: notionProperties(payload.record) };
  return {
    url: `https://api.notion.com/v1/pages/${encodeURIComponent(pageId)}`,
    init: {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${settings.notion.token.trim()}`,
        'content-type': 'application/json',
        'notion-version': '2026-03-11',
      },
      body: JSON.stringify(body),
    },
  };
}

function sheetRow(payload: ProviderWritePayload) {
  const record = payload.record ?? payload.before;
  const archived = payload.operation === 'archive_record'
    ? 'true'
    : payload.operation === 'restore_record'
      ? 'false'
      : String(record?.archived_at ? true : record?.deleted ?? false);
  return [
    payload.record_id,
    recordTitle(record),
    record?.domain ?? '',
    record?.collection ?? '',
    JSON.stringify(record?.properties ?? {}),
    archived,
    String(record?.revision ?? ''),
    new Date().toISOString(),
    payload.op_id,
  ];
}

function buildSheetsRequest(payload: ProviderWritePayload, settings: UtopiaSettings) {
  if (!settings.sheets.enabled || !settings.sheets.token.trim()) return { blocked: 'Google Sheets token is missing.' };
  if (!settings.sheets.workbookId.trim()) return { blocked: 'Google Sheets workbook ID is missing.' };
  const sheetName = settings.sheets.sheetName.trim() || 'Utopia Canonical';
  const range = encodeURIComponent(`${sheetName}!A:I`);
  return {
    url: `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(settings.sheets.workbookId.trim())}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    init: {
      method: 'POST',
      headers: {
        authorization: `Bearer ${settings.sheets.token.trim()}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ values: [sheetRow(payload)] }),
    },
  };
}

function parseJsonText(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function notionTitleFromPage(page: Record<string, unknown>) {
  const properties = page.properties && typeof page.properties === 'object' ? page.properties as Record<string, unknown> : {};
  const name = properties.Name && typeof properties.Name === 'object' ? properties.Name as Record<string, unknown> : {};
  const title = Array.isArray(name.title) ? name.title : [];
  return title.map((item) => {
    const text = item && typeof item === 'object' ? (item as Record<string, unknown>).plain_text : '';
    return typeof text === 'string' ? text : '';
  }).join('').trim();
}

function archivedExpected(payload: ProviderWritePayload) {
  if (payload.operation === 'archive_record') return true;
  if (payload.operation === 'restore_record') return false;
  return Boolean(payload.record?.archived_at || payload.record?.deleted);
}

async function verifyNotionWriteback(input: {
  payload: ProviderWritePayload;
  settings: UtopiaSettings;
  writeBody: Record<string, unknown>;
  fetcher: FetchLike;
}): Promise<{ ok: true; snapshot: Record<string, unknown> } | { ok: false; statusCode: number; reason: string }> {
  const pageId = String(input.writeBody.id || input.payload.external_id || '').trim();
  if (!pageId) return { ok: false, statusCode: 0, reason: 'provider_writeback_readback_missing_page_id' };
  const response = await input.fetcher(`https://api.notion.com/v1/pages/${encodeURIComponent(pageId)}`, {
    method: 'GET',
    headers: {
      authorization: `Bearer ${input.settings.notion.token.trim()}`,
      'notion-version': '2026-03-11',
    },
  });
  const bodyText = await response.text().catch(() => '');
  const page = parseJsonText(bodyText);
  if (!response.ok) return { ok: false, statusCode: response.status, reason: bodyText.slice(0, 240) || `readback HTTP ${response.status}` };
  const title = notionTitleFromPage(page);
  const inTrash = Boolean(page.in_trash ?? page.archived);
  const expectedArchived = archivedExpected(input.payload);
  const expectedTitle = recordTitle(input.payload.record ?? input.payload.before);
  if (inTrash !== expectedArchived) return { ok: false, statusCode: response.status, reason: 'provider_writeback_readback_archive_mismatch' };
  if (!expectedArchived && title !== expectedTitle) return { ok: false, statusCode: response.status, reason: 'provider_writeback_readback_title_mismatch' };
  return { ok: true, snapshot: { provider_page_id: pageId, title, in_trash: inTrash } };
}

function sheetRows(value: Record<string, unknown>): unknown[][] {
  return Array.isArray(value.values) ? value.values.filter(Array.isArray) as unknown[][] : [];
}

async function verifySheetsWriteback(input: {
  payload: ProviderWritePayload;
  settings: UtopiaSettings;
  writeBody: Record<string, unknown>;
  fetcher: FetchLike;
}): Promise<{ ok: true; snapshot: Record<string, unknown> } | { ok: false; statusCode: number; reason: string }> {
  const sheetName = input.settings.sheets.sheetName.trim() || 'Utopia Canonical';
  const range = typeof (input.writeBody.updates as Record<string, unknown> | undefined)?.updatedRange === 'string'
    ? String((input.writeBody.updates as Record<string, unknown>).updatedRange)
    : `${sheetName}!A:I`;
  const response = await input.fetcher(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(input.settings.sheets.workbookId.trim())}/values/${encodeURIComponent(range)}?majorDimension=ROWS`, {
    method: 'GET',
    headers: {
      authorization: `Bearer ${input.settings.sheets.token.trim()}`,
      'content-type': 'application/json',
    },
  });
  const bodyText = await response.text().catch(() => '');
  const body = parseJsonText(bodyText);
  if (!response.ok) return { ok: false, statusCode: response.status, reason: bodyText.slice(0, 240) || `readback HTTP ${response.status}` };
  const expected = sheetRow(input.payload).map((cell) => String(cell));
  const row = sheetRows(body).find((candidate) =>
    String(candidate[0] ?? '') === expected[0]
    && String(candidate[1] ?? '') === expected[1]
    && String(candidate[5] ?? '').toLowerCase() === expected[5].toLowerCase()
    && String(candidate[8] ?? '') === expected[8]
  );
  if (!row) return { ok: false, statusCode: response.status, reason: 'provider_writeback_readback_row_mismatch' };
  return { ok: true, snapshot: { range, record_id: row[0], title: row[1], archived: row[5], op_id: row[8] } };
}

async function verifyProviderWriteback(input: {
  payload: ProviderWritePayload;
  settings: UtopiaSettings;
  writeBody: Record<string, unknown>;
  fetcher: FetchLike;
}): Promise<{ ok: true; snapshot: Record<string, unknown> } | { ok: false; statusCode: number; reason: string }> {
  return input.payload.provider === 'notion'
    ? verifyNotionWriteback(input)
    : verifySheetsWriteback(input);
}

export async function deliverProviderWriteEvent(input: {
  db: SQLiteDatabase;
  event: OutboxEvent;
  settings: UtopiaSettings;
  fetcher?: FetchLike;
  platform?: 'native' | 'web' | 'node';
}): Promise<ProviderWriteDeliveryResult> {
  const payload = parsePayload(input.event);
  if (!payload) return { status: 'blocked', event_id: input.event.id, reason: 'unsupported_outbox_payload' };
  if (input.platform === 'web') {
    return { status: 'blocked', event_id: input.event.id, provider: payload.provider, reason: 'Direct provider writes are blocked by browser CORS; use native app delivery.' };
  }
  const request = payload.provider === 'notion'
    ? buildNotionRequest(payload, input.settings)
    : buildSheetsRequest(payload, input.settings);
  if ('blocked' in request) {
    return { status: 'blocked', event_id: input.event.id, provider: payload.provider, reason: request.blocked ?? 'provider_config_missing' };
  }
  const fetcher = input.fetcher ?? fetch;
  let response: { ok: boolean; status: number; text: () => Promise<string> };
  try {
    response = await fetcher(request.url, request.init);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const hasTimeout = reason.toLowerCase().includes('timeout') || reason.toLowerCase().includes('timed out') || reason.toLowerCase().includes('abort');
    const finalReason = hasTimeout ? 'provider_writeback_readback_timeout' : `provider_writeback_unknown_write_error:${reason}`;
    await markOutboxEvent(input.db, input.event.id, { status: 'pending', last_error: finalReason, attemptsDelta: 1 });
    return { status: 'pending_verification', event_id: input.event.id, provider: payload.provider, statusCode: 0, reason: finalReason };
  }

  const bodyText = await response.text().catch(() => '');
  if (response.ok) {
    try {
      const verified = await verifyProviderWriteback({
        payload,
        settings: input.settings,
        writeBody: parseJsonText(bodyText),
        fetcher,
      });
      if (!verified.ok) {
        const isDeterministicMismatch = verified.reason === 'provider_writeback_readback_title_mismatch'
          || verified.reason === 'provider_writeback_readback_archive_mismatch'
          || verified.reason === 'provider_writeback_readback_row_mismatch'
          || verified.reason === 'provider_writeback_readback_missing_page_id';
        if (!isDeterministicMismatch && (verified.statusCode >= 500 || verified.statusCode === 0 || verified.reason.toLowerCase().includes('timeout'))) {
          await markOutboxEvent(input.db, input.event.id, { status: 'pending', last_error: verified.reason, attemptsDelta: 1 });
          return { status: 'pending_verification', event_id: input.event.id, provider: payload.provider, statusCode: verified.statusCode || response.status, reason: verified.reason };
        }
        await markOutboxEvent(input.db, input.event.id, { status: 'failed', last_error: verified.reason, attemptsDelta: 1 });
        return { status: 'failed', event_id: input.event.id, provider: payload.provider, statusCode: verified.statusCode || response.status, reason: verified.reason };
      }
      await markOutboxEvent(input.db, input.event.id, { status: 'done', last_error: null });
      return { status: 'delivered', event_id: input.event.id, provider: payload.provider, statusCode: response.status, readback: verified.snapshot };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const lowerReason = reason.toLowerCase();
      const finalReason = lowerReason.includes('timeout') || lowerReason.includes('timed out') || lowerReason.includes('abort')
        ? 'provider_writeback_readback_timeout'
        : `provider_writeback_readback_unknown:${reason}`;
      await markOutboxEvent(input.db, input.event.id, { status: 'pending', last_error: finalReason, attemptsDelta: 1 });
      return { status: 'pending_verification', event_id: input.event.id, provider: payload.provider, statusCode: 0, reason: finalReason };
    }
  }
  const reason = bodyText.slice(0, 240) || `HTTP ${response.status}`;
  await markOutboxEvent(input.db, input.event.id, { status: 'failed', last_error: reason, attemptsDelta: 1 });
  return { status: 'failed', event_id: input.event.id, provider: payload.provider, statusCode: response.status, reason };
}
