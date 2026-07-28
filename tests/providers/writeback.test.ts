import { describe, expect, it } from 'vitest';

import { listProviderWritebackOutboxEvents } from '@/src/db/outbox';
import { loadCatalog } from '@/src/domain/catalog';
import { applyOperation } from '@/src/ops/apply';
import { undoOperation } from '@/src/ops/undo';
import { deliverProviderWriteEvent, enqueueProviderWriteForOperation, type ProviderWritePayload } from '@/src/providers/writeback';
import { defaultUtopiaSettings } from '@/src/settings/utopia-settings';
import { MemoryDb } from '../helpers/memory-db';

const manifest = loadCatalog().activeManifest;
const observedAt = '2026-07-23T00:00:00.000Z';

async function createRecord(db: MemoryDb, opId = 'writeback-create') {
  return applyOperation(db as any, manifest, {
    op_id: opId,
    kind: 'create',
    domain: manifest.id,
    collection: 'inventory',
    record_id: 'writeback-yogurt',
    record: {
      title: 'Writeback yogurt',
      properties: { body: 'Greek yogurt', quantity: 2 },
      relations: [],
      source: { provider: 'sqlite', external_id: 'writeback-yogurt', url: null, observed_at: observedAt, content_hash: null },
      archived_at: null,
    },
    actor: 'user',
    origin: 'manual',
  });
}

function payload(row: Record<string, unknown> | undefined) {
  expect(row).toBeTruthy();
  return JSON.parse(String(row!.payload_json)) as ProviderWritePayload;
}

function jsonResponse(value: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(value) };
}

function notionPage(title: string, extra: Record<string, unknown> = {}) {
  return {
    id: extra.id ?? 'notion-page-1',
    in_trash: extra.in_trash ?? false,
    archived: extra.archived ?? false,
    properties: {
      Name: {
        title: [{ type: 'text', plain_text: title, text: { content: title } }],
      },
    },
    ...extra,
  };
}

function sheetsAppendResponse(range = 'Utopia Canonical!A2:I2') {
  return { updates: { updatedRange: range } };
}

function sheetsReadbackRow(payload: ProviderWritePayload, overrides: Partial<Record<'recordId' | 'title' | 'archived' | 'opId', string>> = {}) {
  return {
    range: 'Utopia Canonical!A2:I2',
    values: [[
      overrides.recordId ?? payload.record_id,
      overrides.title ?? payload.record?.title ?? payload.before?.title ?? 'Writeback yogurt',
      payload.record?.domain ?? payload.before?.domain ?? manifest.id,
      payload.record?.collection ?? payload.before?.collection ?? 'inventory',
      JSON.stringify(payload.record?.properties ?? payload.before?.properties ?? {}),
      overrides.archived ?? (payload.operation === 'archive_record' ? 'true' : 'false'),
      String(payload.record?.revision ?? payload.before?.revision ?? ''),
      observedAt,
      overrides.opId ?? payload.op_id,
    ]],
  };
}

async function providerOutboxRows(db: MemoryDb) {
  return listProviderWritebackOutboxEvents(db as any);
}

describe('enqueueProviderWriteForOperation', () => {
  it('queues duplicate-safe Notion create payloads from applied operations', async () => {
    const db = new MemoryDb();
    await createRecord(db);

    const first = await enqueueProviderWriteForOperation({ db: db as any, provider: 'notion', opId: 'writeback-create' });
    const duplicate = await enqueueProviderWriteForOperation({ db: db as any, provider: 'notion', opId: 'writeback-create' });
    const rows = await providerOutboxRows(db);
    const body = payload(rows[0]);

    expect(first.status).toBe('queued');
    expect(duplicate.status).toBe('duplicate');
    expect(rows).toHaveLength(1);
    expect(body.schema_version).toBe('utopia.provider-write.v1');
    expect(body.provider).toBe('notion');
    expect(body.operation).toBe('create_record');
    expect(body.endpoint).toBe('/providers/notion/push');
    expect(body.record?.properties.quantity).toBe(2);
  });

  it('queues Sheets update payloads and queues Undo as the inverse update', async () => {
    const db = new MemoryDb();
    const created = await createRecord(db, 'writeback-undo-create');
    const updated = await applyOperation(db as any, manifest, {
      op_id: 'writeback-update',
      kind: 'update',
      domain: manifest.id,
      collection: 'inventory',
      record_id: 'writeback-yogurt',
      expected_revision: created.record!.revision,
      changes: { quantity: 4 },
      actor: 'user',
      origin: 'manual',
    });
    const updateQueued = await enqueueProviderWriteForOperation({ db: db as any, provider: 'google_sheets', opId: 'writeback-update' });
    const undone = await undoOperation(db as any, manifest, 'writeback-update');
    const undoQueued = await enqueueProviderWriteForOperation({ db: db as any, provider: 'google_sheets', opId: undone.op_id });
    const rows = (await providerOutboxRows(db)).map((row) => payload(row));

    expect(updated.status).toBe('applied');
    expect(updateQueued.status).toBe('queued');
    expect(undone.status).toBe('applied');
    expect(undoQueued.status).toBe('queued');
    expect(rows).toHaveLength(2);
    expect(rows[0].operation).toBe('update_record');
    expect(rows[0].record?.properties.quantity).toBe(4);
    expect(rows[1].operation).toBe('update_record');
    expect(rows[1].record?.properties.quantity).toBe(2);
    expect(rows[1].endpoint).toBe('/providers/sheets/push');
  });

  it('queues archive provider payloads from archive operations', async () => {
    const db = new MemoryDb();
    const created = await createRecord(db, 'writeback-archive-create');
    await applyOperation(db as any, manifest, {
      op_id: 'writeback-archive',
      kind: 'archive',
      domain: manifest.id,
      collection: 'inventory',
      record_id: 'writeback-yogurt',
      expected_revision: created.record!.revision,
      actor: 'user',
      origin: 'manual',
    });

    const queued = await enqueueProviderWriteForOperation({ db: db as any, provider: 'notion', opId: 'writeback-archive' });
    const body = payload((await providerOutboxRows(db))[0]);

    expect(queued.status).toBe('queued');
    expect(body.operation).toBe('archive_record');
    expect(body.record?.archived_at).toBeTruthy();
  });

  it('queues archive Undo as provider restore for Notion and Sheets', async () => {
    const db = new MemoryDb();
    const created = await createRecord(db, 'writeback-restore-create');
    await applyOperation(db as any, manifest, {
      op_id: 'writeback-restore-archive',
      kind: 'archive',
      domain: manifest.id,
      collection: 'inventory',
      record_id: 'writeback-yogurt',
      expected_revision: created.record!.revision,
      actor: 'user',
      origin: 'manual',
    });
    const undone = await undoOperation(db as any, manifest, 'writeback-restore-archive');
    expect(undone.status).toBe('applied');

    const notionQueued = await enqueueProviderWriteForOperation({ db: db as any, provider: 'notion', opId: undone.op_id });
    const sheetsQueued = await enqueueProviderWriteForOperation({ db: db as any, provider: 'google_sheets', opId: undone.op_id });
    expect(notionQueued.status).toBe('queued');
    expect(sheetsQueued.status).toBe('queued');
    const rows = (await providerOutboxRows(db)).map((row) => payload(row));
    expect(rows.map((row) => row.operation)).toEqual(['restore_record', 'restore_record']);
    expect(rows.map((row) => row.endpoint)).toEqual(['/providers/notion/push', '/providers/sheets/push']);
    expect(rows.every((row) => row.record?.archived_at == null && row.record?.deleted === false)).toBe(true);
  });

  it('delivers queued Notion writes with device settings and marks outbox done', async () => {
    const db = new MemoryDb();
    await createRecord(db, 'writeback-deliver-notion');
    const queued = await enqueueProviderWriteForOperation({ db: db as any, provider: 'notion', opId: 'writeback-deliver-notion' });
    expect(queued.status).toBe('queued');
    if (queued.status !== 'queued') throw new Error('expected queued writeback');
    const calls: Array<{ url: string; init: { method: string; headers: Record<string, string>; body?: string } }> = [];
    const delivered = await deliverProviderWriteEvent({
      db: db as any,
      event: queued.event,
      settings: {
        ...defaultUtopiaSettings,
        notion: { enabled: true, token: 'test-token', pageId: '', dataSourceIds: 'ds-1' },
      },
      fetcher: async (url, init) => {
        calls.push({ url, init });
        if (init.method === 'GET') return jsonResponse(notionPage('Writeback yogurt'));
        return jsonResponse({ id: 'notion-page-1' });
      },
      platform: 'native',
    });

    expect(delivered.status).toBe('delivered');
    expect(db.outbox.get(queued.event.id)?.status).toBe('done');
    expect(calls[0].url).toBe('https://api.notion.com/v1/pages');
    expect(calls[1].url).toBe('https://api.notion.com/v1/pages/notion-page-1');
    expect(calls[0].init.headers.authorization).toBe('Bearer test-token');
  });

  it('fails Notion delivery when provider readback does not match', async () => {
    const db = new MemoryDb();
    await createRecord(db, 'writeback-deliver-notion-mismatch');
    const queued = await enqueueProviderWriteForOperation({ db: db as any, provider: 'notion', opId: 'writeback-deliver-notion-mismatch' });
    expect(queued.status).toBe('queued');
    if (queued.status !== 'queued') throw new Error('expected queued writeback');

    const failed = await deliverProviderWriteEvent({
      db: db as any,
      event: queued.event,
      settings: {
        ...defaultUtopiaSettings,
        notion: { enabled: true, token: 'test-token', pageId: '', dataSourceIds: 'ds-1' },
      },
      fetcher: async (_url, init) => init.method === 'GET'
        ? jsonResponse(notionPage('Wrong title'))
        : jsonResponse({ id: 'notion-page-1' }),
      platform: 'native',
    });

    expect(failed.status).toBe('failed');
    expect(db.outbox.get(queued.event.id)?.status).toBe('failed');
    expect(db.outbox.get(queued.event.id)?.last_error).toBe('provider_writeback_readback_title_mismatch');
  });

  it('keeps Notion delivery pending verification on timeout during write or readback', async () => {
    const db = new MemoryDb();
    await createRecord(db, 'writeback-deliver-notion-timeout');
    const queued = await enqueueProviderWriteForOperation({ db: db as any, provider: 'notion', opId: 'writeback-deliver-notion-timeout' });
    expect(queued.status).toBe('queued');
    if (queued.status !== 'queued') throw new Error('expected queued writeback');

    const writeTimeout = await deliverProviderWriteEvent({
      db: db as any,
      event: queued.event,
      settings: {
        ...defaultUtopiaSettings,
        notion: { enabled: true, token: 'test-token', pageId: '', dataSourceIds: 'ds-1' },
      },
      fetcher: async () => {
        throw new Error('request timed out');
      },
      platform: 'native',
    });

    expect(writeTimeout.status).toBe('pending_verification');
    expect(db.outbox.get(queued.event.id)?.status).toBe('pending');
    expect(db.outbox.get(queued.event.id)?.last_error).toBe('provider_writeback_readback_timeout');

    const readTimeout = await deliverProviderWriteEvent({
      db: db as any,
      event: queued.event,
      settings: {
        ...defaultUtopiaSettings,
        notion: { enabled: true, token: 'test-token', pageId: '', dataSourceIds: 'ds-1' },
      },
      fetcher: async (url, init) => {
        if (init.method === 'GET') throw new Error('request timed out');
        return jsonResponse({ id: 'notion-page-1' });
      },
      platform: 'native',
    });

    expect(readTimeout.status).toBe('pending_verification');
    expect(db.outbox.get(queued.event.id)?.status).toBe('pending');
    expect(db.outbox.get(queued.event.id)?.last_error).toBe('provider_writeback_readback_timeout');
  });

  it('delivers Notion archive as a trash request against the provider page id', async () => {
    const db = new MemoryDb();
    const created = await createRecord(db, 'writeback-deliver-notion-archive-create');
    const providerRecord = {
      ...created.record!,
      source: { ...created.record!.source, provider: 'notion' as const, external_id: 'notion-page-1' },
    };
    await applyOperation(db as any, manifest, {
      op_id: 'writeback-deliver-notion-archive',
      kind: 'archive',
      domain: manifest.id,
      collection: 'inventory',
      record_id: 'writeback-yogurt',
      expected_revision: providerRecord.revision,
      actor: 'user',
      origin: 'manual',
    });
    const queued = await enqueueProviderWriteForOperation({ db: db as any, provider: 'notion', opId: 'writeback-deliver-notion-archive' });
    expect(queued.status).toBe('queued');
    if (queued.status !== 'queued') throw new Error('expected queued archive writeback');
    queued.payload.external_id = 'notion-page-1';
    queued.event.payload_json = JSON.stringify(queued.payload);
    const calls: Array<{ url: string; init: { method: string; headers: Record<string, string>; body?: string } }> = [];

    const delivered = await deliverProviderWriteEvent({
      db: db as any,
      event: queued.event,
      settings: {
        ...defaultUtopiaSettings,
        notion: { enabled: true, token: 'test-token', pageId: '', dataSourceIds: 'ds-1' },
      },
      fetcher: async (url, init) => {
        calls.push({ url, init });
        if (init.method === 'GET') return jsonResponse(notionPage('Writeback yogurt', { in_trash: true }));
        return jsonResponse({ id: 'notion-page-1' });
      },
      platform: 'native',
    });

    expect(delivered.status).toBe('delivered');
    expect(calls[0].url).toBe('https://api.notion.com/v1/pages/notion-page-1');
    expect(JSON.parse(calls[0].init.body || '{}')).toEqual({ in_trash: true });
  });

  it('delivers Notion archive Undo as a restore request against the provider page id', async () => {
    const db = new MemoryDb();
    const created = await createRecord(db, 'writeback-deliver-notion-restore-create');
    await applyOperation(db as any, manifest, {
      op_id: 'writeback-deliver-notion-restore-archive',
      kind: 'archive',
      domain: manifest.id,
      collection: 'inventory',
      record_id: 'writeback-yogurt',
      expected_revision: created.record!.revision,
      actor: 'user',
      origin: 'manual',
    });
    const undone = await undoOperation(db as any, manifest, 'writeback-deliver-notion-restore-archive');
    expect(undone.status).toBe('applied');
    const queued = await enqueueProviderWriteForOperation({ db: db as any, provider: 'notion', opId: undone.op_id });
    expect(queued.status).toBe('queued');
    if (queued.status !== 'queued') throw new Error('expected queued restore writeback');
    queued.payload.external_id = 'notion-page-1';
    queued.event.payload_json = JSON.stringify(queued.payload);
    const calls: Array<{ url: string; init: { method: string; headers: Record<string, string>; body?: string } }> = [];

    const delivered = await deliverProviderWriteEvent({
      db: db as any,
      event: queued.event,
      settings: {
        ...defaultUtopiaSettings,
        notion: { enabled: true, token: 'test-token', pageId: '', dataSourceIds: 'ds-1' },
      },
      fetcher: async (url, init) => {
        calls.push({ url, init });
        if (init.method === 'GET') return jsonResponse(notionPage('Writeback yogurt', { in_trash: false }));
        return jsonResponse({ id: 'notion-page-1' });
      },
      platform: 'native',
    });

    expect(delivered.status).toBe('delivered');
    expect(calls[0].url).toBe('https://api.notion.com/v1/pages/notion-page-1');
    expect(JSON.parse(calls[0].init.body || '{}')).toMatchObject({ in_trash: false });
  });

  it('delivers queued Sheets writes only after row readback verifies', async () => {
    const db = new MemoryDb();
    await createRecord(db, 'writeback-deliver-sheets-ok');
    const queued = await enqueueProviderWriteForOperation({ db: db as any, provider: 'google_sheets', opId: 'writeback-deliver-sheets-ok' });
    expect(queued.status).toBe('queued');
    if (queued.status !== 'queued') throw new Error('expected queued writeback');
    const calls: Array<{ url: string; init: { method: string; headers: Record<string, string>; body?: string } }> = [];

    const delivered = await deliverProviderWriteEvent({
      db: db as any,
      event: queued.event,
      settings: {
        ...defaultUtopiaSettings,
        sheets: { enabled: true, token: 'sheet-token', workbookId: 'book-1', sheetName: 'Utopia Canonical' },
      },
      fetcher: async (url, init) => {
        calls.push({ url, init });
        if (init.method === 'GET') return jsonResponse(sheetsReadbackRow(queued.payload));
        return jsonResponse(sheetsAppendResponse());
      },
      platform: 'native',
    });

    expect(delivered.status).toBe('delivered');
    expect(db.outbox.get(queued.event.id)?.status).toBe('done');
    expect(calls[0].url).toContain(':append');
    expect(calls[1].url).toContain('/values/Utopia%20Canonical!A2%3AI2');
  });

  it('fails Sheets delivery when appended row readback does not match', async () => {
    const db = new MemoryDb();
    await createRecord(db, 'writeback-deliver-sheets-mismatch');
    const queued = await enqueueProviderWriteForOperation({ db: db as any, provider: 'google_sheets', opId: 'writeback-deliver-sheets-mismatch' });
    expect(queued.status).toBe('queued');
    if (queued.status !== 'queued') throw new Error('expected queued writeback');

    const failed = await deliverProviderWriteEvent({
      db: db as any,
      event: queued.event,
      settings: {
        ...defaultUtopiaSettings,
        sheets: { enabled: true, token: 'sheet-token', workbookId: 'book-1', sheetName: 'Utopia Canonical' },
      },
      fetcher: async (_url, init) => init.method === 'GET'
        ? jsonResponse(sheetsReadbackRow(queued.payload, { opId: 'wrong-op' }))
        : jsonResponse(sheetsAppendResponse()),
      platform: 'native',
    });

    expect(failed.status).toBe('failed');
    expect(db.outbox.get(queued.event.id)?.status).toBe('failed');
    expect(db.outbox.get(queued.event.id)?.last_error).toBe('provider_writeback_readback_row_mismatch');
  });

  it('keeps Sheets delivery pending verification when readback cannot be verified', async () => {
    const db = new MemoryDb();
    await createRecord(db, 'writeback-deliver-sheets-timeout');
    const queued = await enqueueProviderWriteForOperation({ db: db as any, provider: 'google_sheets', opId: 'writeback-deliver-sheets-timeout' });
    expect(queued.status).toBe('queued');
    if (queued.status !== 'queued') throw new Error('expected queued writeback');

    const pending = await deliverProviderWriteEvent({
      db: db as any,
      event: queued.event,
      settings: {
        ...defaultUtopiaSettings,
        sheets: { enabled: true, token: 'sheet-token', workbookId: 'book-1', sheetName: 'Utopia Canonical' },
      },
      fetcher: async (url, init) => {
        if (init.method === 'GET') throw new Error('network timeout');
        return jsonResponse(sheetsAppendResponse());
      },
      platform: 'native',
    });

    expect(pending.status).toBe('pending_verification');
    expect(db.outbox.get(queued.event.id)?.status).toBe('pending');
    expect(db.outbox.get(queued.event.id)?.last_error).toBe('provider_writeback_readback_timeout');
  });

  it('blocks browser delivery and marks failed provider responses', async () => {
    const db = new MemoryDb();
    await createRecord(db, 'writeback-deliver-sheets');
    const queued = await enqueueProviderWriteForOperation({ db: db as any, provider: 'google_sheets', opId: 'writeback-deliver-sheets' });
    expect(queued.status).toBe('queued');
    if (queued.status !== 'queued') throw new Error('expected queued writeback');
    const settings = {
      ...defaultUtopiaSettings,
      sheets: { enabled: true, token: 'sheet-token', workbookId: 'book-1', sheetName: 'Utopia Canonical' },
    };

    const blocked = await deliverProviderWriteEvent({ db: db as any, event: queued.event, settings, platform: 'web' });
    const failed = await deliverProviderWriteEvent({
      db: db as any,
      event: queued.event,
      settings,
      fetcher: async () => ({ ok: false, status: 409, text: async () => 'version conflict' }),
      platform: 'native',
    });

    expect(blocked.status).toBe('blocked');
    expect(failed.status).toBe('failed');
    expect(db.outbox.get(queued.event.id)?.status).toBe('failed');
    expect(db.outbox.get(queued.event.id)?.attempts).toBe(1);
    expect(db.outbox.get(queued.event.id)?.last_error).toBe('version conflict');
  });
});
