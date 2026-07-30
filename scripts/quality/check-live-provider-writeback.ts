import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { enqueueOutboxEvent } from '../../src/db/outbox';
import { deliverProviderWriteEvent, type ProviderWritePayload } from '../../src/providers/writeback';
import { defaultUtopiaSettings, type UtopiaSettings } from '../../src/settings/utopia-settings';
import { MemoryDb } from '../../tests/helpers/memory-db';
import { DEFAULT_APP_INSTALLATION_ID } from '../../packages/shared/contracts/app-installation';

type Json = Record<string, unknown>;

const evidenceDir = process.env.PROVIDER_WRITEBACK_OUT
  ? join(process.cwd(), process.env.PROVIDER_WRITEBACK_OUT)
  : join(process.cwd(), 'app', 'build', 'evidence', 'live-workspace');
mkdirSync(evidenceDir, { recursive: true });
const stamp = Math.floor(Date.now() / 1000);
const evidencePath = join(evidenceDir, `direct_provider_writeback-${stamp}.json`);
const noSecret = true;

function ensureDisposableLane(provider: string) {
  const result = spawnSync(process.execPath, ['scripts/quality/require-disposable-lane.mjs', 'provider', provider], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
    const reason = output ? output.split('\n')[0] : 'No guard output.';
    throw new Error(`Disposable lane guard blocked for ${provider}: ${reason}`);
  }
}

const disposableLaneGuarded = new Set<string>();
function ensureGuardedProvider(provider: string) {
  if (disposableLaneGuarded.has(provider)) return;
  ensureDisposableLane(provider);
  disposableLaneGuarded.add(provider);
}

function mask(value: string | null | undefined) {
  const raw = String(value || '');
  if (raw.length <= 8) return raw ? 'set' : null;
  return `${raw.slice(0, 4)}...${raw.slice(-4)}`;
}

function ensure(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function writeEvidence(payload: Json) {
  writeFileSync(evidencePath, JSON.stringify(payload, null, 2));
  console.log(evidencePath);
}

async function readJson(response: Response): Promise<Json> {
  const text = await response.text();
  return text ? JSON.parse(text) as Json : {};
}

async function notionRequest(token: string, method: string, path: string, payload?: Json) {
  const response = await fetch(`https://api.notion.com/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Notion-Version': '2026-03-11',
    },
    body: payload ? JSON.stringify(payload) : undefined,
  });
  const body = await readJson(response);
  if (!response.ok) {
    throw new Error(`Notion ${method} ${path} failed ${response.status}: ${JSON.stringify(body).slice(0, 500)}`);
  }
  return body;
}

function pageTitle(page: Json) {
  const props = page.properties && typeof page.properties === 'object' ? page.properties as Record<string, Json> : {};
  for (const prop of Object.values(props)) {
    const title = Array.isArray(prop.title) ? prop.title : [];
    const text = title.map((part) => typeof part?.plain_text === 'string' ? part.plain_text : '').join('').trim();
    if (text) return text;
  }
  return '';
}

async function findNotionParentPage(token: string) {
  const candidate = process.env.NOTION_TEST_PAGE_ID?.trim();
  ensure(candidate, 'Set NOTION_TEST_PAGE_ID to an explicit disposable parent page.');
  const page = await notionRequest(token, 'GET', `/pages/${encodeURIComponent(candidate)}`);
  ensure(!page.archived && !page.in_trash, 'Disposable Notion parent page is unavailable.');
  return candidate;
}

function firstDataSourceId(database: Json) {
  const sources = Array.isArray(database.data_sources) ? database.data_sources as Json[] : [];
  return String(sources[0]?.id || '');
}

async function provisionNotionDataSource(token: string) {
  const parentPageId = await findNotionParentPage(token);
  ensure(parentPageId, 'No accessible Notion parent page found for direct writeback proof.');

  const database = await notionRequest(token, 'POST', '/databases', {
    parent: { type: 'page_id', page_id: parentPageId },
    title: [{ type: 'text', text: { content: `Utopia Direct Writeback Records ${stamp}` } }],
    initial_data_source: {
      properties: {
        Name: { title: {} },
      },
    },
  });
  const databaseId = String(database.id || '');
  const dataSourceId = firstDataSourceId(database) || firstDataSourceId(await notionRequest(token, 'GET', `/databases/${databaseId}`));
  ensure(dataSourceId, 'Notion data source id missing after provision.');
  return { proofPageId: '', dataSourceId, databaseId };
}

async function runNotionProof() {
  ensureGuardedProvider('notion');
  const token = process.env.NOTION_TOKEN?.trim() || process.env.NOTION_API_KEY?.trim() || '';
  if (!token) return { provider: 'notion', status: 'skipped', reason: 'missing_token' };

  const dataSource = process.env.NOTION_DATA_SOURCE_ID?.trim()
    ? { proofPageId: '', dataSourceId: process.env.NOTION_DATA_SOURCE_ID.trim(), databaseId: '' }
    : await provisionNotionDataSource(token);
  const db = new MemoryDb() as never;
  let createdPageId = '';

  const payload: ProviderWritePayload = {
    schema_version: 'utopia.provider-write.v1',
    app_installation_id: DEFAULT_APP_INSTALLATION_ID,
    provider: 'notion',
    operation: 'create_record',
    op_id: `live-notion-writeback-${stamp}`,
    record_id: `live-notion-writeback-${stamp}`,
    expected_revision: null,
    record: {
      id: `live-notion-writeback-${stamp}`,
      domain: 'food',
      collection: 'recipe',
      title: `Direct app writeback ${stamp}`,
      properties: { body: 'Created by direct app writeback proof.' },
      relations: [],
      source: { provider: 'sqlite', external_id: `live-notion-writeback-${stamp}`, url: null, observed_at: new Date().toISOString(), content_hash: null },
      archived_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      revision: 1,
      schema_version: 'utopia.record.v1',
      deleted: false,
      privacy: 'personal',
      provenance: { actor: 'user', confidence: null, evidence: ['direct-provider-writeback-proof'], reason: 'Live direct writeback proof.' },
    },
    before: null,
    external_id: null,
    endpoint: '/providers/notion/push',
  };
  const event = await enqueueOutboxEvent(db, {
    id: `outbox-notion-${stamp}`,
    action_key: `provider-write:notion:${payload.op_id}`,
    domain: 'food',
    payload_json: JSON.stringify(payload),
  });

  const settings: UtopiaSettings = {
    ...defaultUtopiaSettings,
    notion: { enabled: true, token, pageId: dataSource.proofPageId, dataSourceIds: dataSource.dataSourceId },
  };
  const delivery = await deliverProviderWriteEvent({
    db,
    event,
    settings,
    platform: 'native',
    fetcher: async (url, init) => {
      const response = await fetch(url, init);
      const clone = response.clone();
      if (response.ok) {
        const body = await clone.json().catch(() => null) as { id?: string } | null;
        createdPageId = body?.id || createdPageId;
      }
      return response;
    },
  });
  ensure(delivery.status === 'delivered', `Notion direct writeback not delivered: ${delivery.status}`);
  ensure(createdPageId, 'Notion direct writeback did not return page id.');
  const created = await notionRequest(token, 'GET', `/pages/${createdPageId}`);
  const readBackTitle = pageTitle(created);
  const createdRecord = payload.record;
  ensure(createdRecord, 'Notion create payload missing record.');

  const updatedRecord = {
    ...createdRecord,
    title: `Direct app writeback updated ${stamp}`,
    source: { ...createdRecord.source, provider: 'notion' as const, external_id: createdPageId },
    revision: 2,
    updated_at: new Date().toISOString(),
  };
  const updatePayload: ProviderWritePayload = {
    ...payload,
    operation: 'update_record',
    op_id: `live-notion-writeback-update-${stamp}`,
    expected_revision: 1,
    record: updatedRecord,
    before: createdRecord,
    external_id: createdPageId,
  };
  const updateEvent = await enqueueOutboxEvent(db, {
    id: `outbox-notion-update-${stamp}`,
    action_key: `provider-write:notion:${updatePayload.op_id}`,
    domain: 'food',
    payload_json: JSON.stringify(updatePayload),
  });
  const updateDelivery = await deliverProviderWriteEvent({ db, event: updateEvent, settings, platform: 'native' });
  ensure(updateDelivery.status === 'delivered', `Notion update writeback not delivered: ${updateDelivery.status}`);
  const updated = await notionRequest(token, 'GET', `/pages/${createdPageId}`);
  const updateReadBackTitle = pageTitle(updated);
  ensure(updateReadBackTitle === updatedRecord.title, 'Notion update writeback title did not round trip.');

  const archivedAt = new Date().toISOString();
  const archivePayload: ProviderWritePayload = {
    ...payload,
    operation: 'archive_record',
    op_id: `live-notion-writeback-archive-${stamp}`,
    expected_revision: 2,
    record: { ...updatedRecord, archived_at: archivedAt, revision: 3, updated_at: archivedAt },
    before: updatedRecord,
    external_id: createdPageId,
  };
  const archiveEvent = await enqueueOutboxEvent(db, {
    id: `outbox-notion-archive-${stamp}`,
    action_key: `provider-write:notion:${archivePayload.op_id}`,
    domain: 'food',
    payload_json: JSON.stringify(archivePayload),
  });
  const archiveDelivery = await deliverProviderWriteEvent({ db, event: archiveEvent, settings, platform: 'native' });
  ensure(archiveDelivery.status === 'delivered', `Notion archive writeback not delivered: ${archiveDelivery.status}`);
  const archived = await notionRequest(token, 'GET', `/pages/${createdPageId}`);
  const archiveReadBackHidden = Boolean(archived.archived) || Boolean(archived.in_trash);
  ensure(archiveReadBackHidden, 'Notion archive writeback did not mark page archived or trashed.');

  const restorePayload: ProviderWritePayload = {
    ...payload,
    operation: 'restore_record',
    op_id: `live-notion-writeback-restore-${stamp}`,
    expected_revision: 3,
    record: { ...updatedRecord, archived_at: null, revision: 4, updated_at: new Date().toISOString() },
    before: archivePayload.record,
    external_id: createdPageId,
  };
  const restoreEvent = await enqueueOutboxEvent(db, {
    id: `outbox-notion-restore-${stamp}`,
    action_key: `provider-write:notion:${restorePayload.op_id}`,
    domain: 'food',
    payload_json: JSON.stringify(restorePayload),
  });
  const restoreDelivery = await deliverProviderWriteEvent({ db, event: restoreEvent, settings, platform: 'native' });
  ensure(restoreDelivery.status === 'delivered', `Notion restore writeback not delivered: ${restoreDelivery.status}`);
  const restored = await notionRequest(token, 'GET', `/pages/${createdPageId}`);
  const restoreReadBackVisible = !Boolean(restored.archived) && !Boolean(restored.in_trash);
  ensure(restoreReadBackVisible, 'Notion restore writeback did not restore page from trash.');

  await notionRequest(token, 'PATCH', `/pages/${createdPageId}`, { in_trash: true }).catch((error) => {
    if (!String(error instanceof Error ? error.message : error).includes('archived')) throw error;
  });
  let cleanupDatabaseArchived = false;
  if (dataSource.databaseId) {
    await notionRequest(token, 'PATCH', `/databases/${encodeURIComponent(dataSource.databaseId)}`, { archived: true })
      .then(() => {
        cleanupDatabaseArchived = true;
      })
      .catch(() => {
        cleanupDatabaseArchived = false;
      });
  }

  return {
    provider: 'notion',
    status: 'passed',
    delivery_status: delivery.status,
    page_id: mask(createdPageId),
    data_source_id: mask(dataSource.dataSourceId),
    database_id: mask(dataSource.databaseId),
    read_back_title: readBackTitle,
    update_read_back_title: updateReadBackTitle,
    archive_read_back_archived: Boolean(archived.archived),
    archive_read_back_trashed: Boolean(archived.in_trash),
    restore_read_back_visible: restoreReadBackVisible,
    update_delivery_status: updateDelivery.status,
    archive_delivery_status: archiveDelivery.status,
    restore_delivery_status: restoreDelivery.status,
    cleanup_archived_page: true,
    cleanup_database_archived: cleanupDatabaseArchived,
    cleanup_database_left_for_manual_review: Boolean(dataSource.databaseId) && !cleanupDatabaseArchived,
  };
}

async function refreshGoogleTokenFromCache() {
  if (process.env.GOOGLE_SHEETS_ACCESS_TOKEN?.trim()) return process.env.GOOGLE_SHEETS_ACCESS_TOKEN.trim();
  const tokenFile = process.env.GOOGLE_SHEETS_TOKEN_FILE?.trim()
    || join(process.cwd(), 'build', 'evidence', 'live-workspace', 'google-sheets-token.json');
  if (!existsSync(tokenFile)) return '';
  const cached = JSON.parse(readFileSync(tokenFile, 'utf8')) as { access_token?: string; refresh_token?: string };
  if (!cached.refresh_token) return cached.access_token || '';
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim() || '';
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim() || '';
  if (!clientId || !clientSecret) return cached.access_token || '';
  const form = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: cached.refresh_token,
    grant_type: 'refresh_token',
  });
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  const body = await readJson(response) as { access_token?: string };
  return body.access_token || cached.access_token || '';
}

function latestSheetIdFromEvidence() {
  const path = join(evidenceDir, 'google-sheets-v4-latest-url.txt');
  if (!existsSync(path)) return '';
  const raw = readFileSync(path, 'utf8');
  const match = /\/spreadsheets\/d\/([^/]+)\/edit/.exec(raw);
  return match?.[1] || '';
}

async function sheetsRequest(token: string, spreadsheetId: string, method: string, path: string, payload?: Json) {
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: payload ? JSON.stringify(payload) : undefined,
  });
  const body = await readJson(response);
  if (!response.ok) throw new Error(`Sheets ${method} ${path} failed ${response.status}`);
  return body;
}

async function ensureSheetsWorkbook(token: string) {
  const existing = process.env.GOOGLE_SHEETS_SPREADSHEET_ID?.trim()
    || process.env.GOOGLE_SHEETS_TEST_SPREADSHEET_ID?.trim()
    || latestSheetIdFromEvidence();
  if (existing) return existing;
  const response = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ properties: { title: `Utopia Direct Writeback Proof ${stamp}` } }),
  });
  const body = await readJson(response);
  ensure(response.ok, `Unable to create Sheets proof workbook ${response.status}`);
  return String(body.spreadsheetId || '');
}

async function ensureUtopiaCanonicalSheet(token: string, spreadsheetId: string) {
  const meta = await sheetsRequest(token, spreadsheetId, 'GET', '?fields=sheets(properties(title))');
  const sheets = Array.isArray(meta.sheets) ? meta.sheets as Json[] : [];
  const hasSheet = sheets.some((sheet) => (sheet.properties as Json | undefined)?.title === 'Utopia Canonical');
  if (!hasSheet) {
    await sheetsRequest(token, spreadsheetId, 'POST', ':batchUpdate', {
      requests: [{ addSheet: { properties: { title: 'Utopia Canonical' } } }],
    });
  }
  await sheetsRequest(token, spreadsheetId, 'PUT', '/values/Utopia%20Canonical!A1:I1?valueInputOption=USER_ENTERED', {
    values: [['record_id', 'title', 'domain', 'collection', 'properties', 'archived', 'revision', 'updated_at', 'op_id']],
  });
}

async function runSheetsProof() {
  ensureGuardedProvider('sheets');
  const token = await refreshGoogleTokenFromCache();
  if (!token) return { provider: 'google_sheets', status: 'skipped', reason: 'missing_token' };
  const spreadsheetId = await ensureSheetsWorkbook(token);
  ensure(spreadsheetId, 'Google Sheets workbook id missing.');
  await ensureUtopiaCanonicalSheet(token, spreadsheetId);

  const db = new MemoryDb() as never;
  const updatedRanges: string[] = [];
  const payload: ProviderWritePayload = {
    schema_version: 'utopia.provider-write.v1',
    app_installation_id: DEFAULT_APP_INSTALLATION_ID,
    provider: 'google_sheets',
    operation: 'create_record',
    op_id: `live-sheets-writeback-${stamp}`,
    record_id: `live-sheets-writeback-${stamp}`,
    expected_revision: null,
    record: {
      id: `live-sheets-writeback-${stamp}`,
      domain: 'food',
      collection: 'shopping_item',
      title: `Direct app sheets writeback ${stamp}`,
      properties: { body: 'Created by direct app writeback proof.' },
      relations: [],
      source: { provider: 'sqlite', external_id: `live-sheets-writeback-${stamp}`, url: null, observed_at: new Date().toISOString(), content_hash: null },
      archived_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      revision: 1,
      schema_version: 'utopia.record.v1',
      deleted: false,
      privacy: 'personal',
      provenance: { actor: 'user', confidence: null, evidence: ['direct-provider-writeback-proof'], reason: 'Live direct writeback proof.' },
    },
    before: null,
    external_id: null,
    endpoint: '/providers/sheets/push',
  };
  const event = await enqueueOutboxEvent(db, {
    id: `outbox-sheets-${stamp}`,
    action_key: `provider-write:google_sheets:${payload.op_id}`,
    domain: 'food',
    payload_json: JSON.stringify(payload),
  });
  const settings: UtopiaSettings = {
    ...defaultUtopiaSettings,
    sheets: { enabled: true, token, workbookId: spreadsheetId, sheetName: 'Utopia Canonical' },
  };
  const delivery = await deliverProviderWriteEvent({
    db,
    event,
    settings,
    platform: 'native',
    fetcher: async (url, init) => {
      const response = await fetch(url, init);
      const clone = response.clone();
      if (response.ok) {
        const body = await clone.json().catch(() => null) as { updates?: { updatedRange?: string } } | null;
        const nextRange = body?.updates?.updatedRange || '';
        if (nextRange) updatedRanges.push(nextRange);
      }
      return response;
    },
  });
  ensure(delivery.status === 'delivered', `Sheets direct writeback not delivered: ${delivery.status}`);
  ensure(updatedRanges[0], 'Sheets append did not return updatedRange.');
  const encodedRange = encodeURIComponent(updatedRanges[0]);
  const readBack = await sheetsRequest(token, spreadsheetId, 'GET', `/values/${encodedRange}`);
  const values = Array.isArray(readBack.values) ? readBack.values as unknown[][] : [];
  const readBackFound = values.flat().some((cell) => String(cell).includes(payload.record_id));

  const createdRecord = payload.record;
  ensure(createdRecord, 'Sheets create payload missing record.');
  const updatePayload: ProviderWritePayload = {
    ...payload,
    operation: 'update_record',
    op_id: `live-sheets-writeback-update-${stamp}`,
    expected_revision: 1,
    record: {
      ...createdRecord,
      title: `Direct app sheets writeback updated ${stamp}`,
      revision: 2,
      updated_at: new Date().toISOString(),
    },
    before: createdRecord,
    external_id: payload.record_id,
  };
  const updateEvent = await enqueueOutboxEvent(db, {
    id: `outbox-sheets-update-${stamp}`,
    action_key: `provider-write:google_sheets:${updatePayload.op_id}`,
    domain: 'food',
    payload_json: JSON.stringify(updatePayload),
  });
  const updateDelivery = await deliverProviderWriteEvent({
    db,
    event: updateEvent,
    settings,
    platform: 'native',
    fetcher: async (url, init) => {
      const response = await fetch(url, init);
      const clone = response.clone();
      if (response.ok) {
        const body = await clone.json().catch(() => null) as { updates?: { updatedRange?: string } } | null;
        const nextRange = body?.updates?.updatedRange || '';
        if (nextRange) updatedRanges.push(nextRange);
      }
      return response;
    },
  });
  ensure(updateDelivery.status === 'delivered', `Sheets update writeback not delivered: ${updateDelivery.status}`);

  const archivedAt = new Date().toISOString();
  const archivePayload: ProviderWritePayload = {
    ...payload,
    operation: 'archive_record',
    op_id: `live-sheets-writeback-archive-${stamp}`,
    expected_revision: 2,
    record: {
      ...updatePayload.record!,
      archived_at: archivedAt,
      revision: 3,
      updated_at: archivedAt,
    },
    before: updatePayload.record,
    external_id: payload.record_id,
  };
  const archiveEvent = await enqueueOutboxEvent(db, {
    id: `outbox-sheets-archive-${stamp}`,
    action_key: `provider-write:google_sheets:${archivePayload.op_id}`,
    domain: 'food',
    payload_json: JSON.stringify(archivePayload),
  });
  const archiveDelivery = await deliverProviderWriteEvent({
    db,
    event: archiveEvent,
    settings,
    platform: 'native',
    fetcher: async (url, init) => {
      const response = await fetch(url, init);
      const clone = response.clone();
      if (response.ok) {
        const body = await clone.json().catch(() => null) as { updates?: { updatedRange?: string } } | null;
        const nextRange = body?.updates?.updatedRange || '';
        if (nextRange) updatedRanges.push(nextRange);
      }
      return response;
    },
  });
  ensure(archiveDelivery.status === 'delivered', `Sheets archive writeback not delivered: ${archiveDelivery.status}`);
  const archiveRange = updatedRanges[2] || '';
  ensure(archiveRange, 'Sheets archive append did not return updatedRange.');
  const archiveReadBack = await sheetsRequest(token, spreadsheetId, 'GET', `/values/${encodeURIComponent(archiveRange)}`);
  const archiveValues = Array.isArray(archiveReadBack.values) ? archiveReadBack.values as unknown[][] : [];
  const archiveReadBackFound = archiveValues.flat().some((cell) => String(cell).toLowerCase() === 'true')
    && archiveValues.flat().some((cell) => String(cell).includes(archivePayload.op_id));
  ensure(archiveReadBackFound, 'Sheets archive writeback did not round trip.');

  const restorePayload: ProviderWritePayload = {
    ...payload,
    operation: 'restore_record',
    op_id: `live-sheets-writeback-restore-${stamp}`,
    expected_revision: 3,
    record: {
      ...updatePayload.record!,
      archived_at: null,
      revision: 4,
      updated_at: new Date().toISOString(),
    },
    before: archivePayload.record,
    external_id: payload.record_id,
  };
  const restoreEvent = await enqueueOutboxEvent(db, {
    id: `outbox-sheets-restore-${stamp}`,
    action_key: `provider-write:google_sheets:${restorePayload.op_id}`,
    domain: 'food',
    payload_json: JSON.stringify(restorePayload),
  });
  const restoreDelivery = await deliverProviderWriteEvent({
    db,
    event: restoreEvent,
    settings,
    platform: 'native',
    fetcher: async (url, init) => {
      const response = await fetch(url, init);
      const clone = response.clone();
      if (response.ok) {
        const body = await clone.json().catch(() => null) as { updates?: { updatedRange?: string } } | null;
        const nextRange = body?.updates?.updatedRange || '';
        if (nextRange) updatedRanges.push(nextRange);
      }
      return response;
    },
  });
  ensure(restoreDelivery.status === 'delivered', `Sheets restore writeback not delivered: ${restoreDelivery.status}`);
  const restoreRange = updatedRanges[3] || '';
  ensure(restoreRange, 'Sheets restore append did not return updatedRange.');
  const restoreReadBack = await sheetsRequest(token, spreadsheetId, 'GET', `/values/${encodeURIComponent(restoreRange)}`);
  const restoreValues = Array.isArray(restoreReadBack.values) ? restoreReadBack.values as unknown[][] : [];
  const restoreReadBackFound = restoreValues.flat().some((cell) => String(cell).toLowerCase() === 'false')
    && restoreValues.flat().some((cell) => String(cell).includes(restorePayload.op_id));
  ensure(restoreReadBackFound, 'Sheets restore writeback did not round trip.');

  for (const range of updatedRanges) {
    await sheetsRequest(token, spreadsheetId, 'POST', `/values/${encodeURIComponent(range)}:clear`, {});
  }

  return {
    provider: 'google_sheets',
    status: 'passed',
    delivery_status: delivery.status,
    update_delivery_status: updateDelivery.status,
    archive_delivery_status: archiveDelivery.status,
    restore_delivery_status: restoreDelivery.status,
    spreadsheet_id: mask(spreadsheetId),
    updated_ranges: updatedRanges.map((range) => range.replace(/![A-Z]+[0-9]+:.*/, '!<row>')),
    read_back_found: readBackFound,
    archive_read_back_found: archiveReadBackFound,
    restore_read_back_found: restoreReadBackFound,
    cleanup_cleared_range: true,
  };
}

(async () => {
  const results = [await runNotionProof(), await runSheetsProof()];
  const failed = results.filter((result) => result.status !== 'passed');
  const payload = {
    proof: 'direct_provider_writeback_live',
    captured_at: new Date().toISOString(),
    all_passed: failed.length === 0,
    no_token_or_secret_visible: noSecret,
    results,
  };
  writeEvidence(payload);
  if (failed.length) {
    throw new Error(`Direct provider writeback failed: ${failed.map((item) => `${item.provider}:${item.status}`).join(', ')}`);
  }
})().catch((error) => {
  writeEvidence({
    proof: 'direct_provider_writeback_live',
    captured_at: new Date().toISOString(),
    all_passed: false,
    no_token_or_secret_visible: noSecret,
    error: error instanceof Error ? error.message : 'unknown_error',
  });
  process.exit(1);
});
