import { describe, expect, it } from 'vitest';

import { canonicalJson, sha256Canonical } from '@/src/domain/canonical-json';
import {
  planNotionDataHomePush,
  pullNotionDataHome,
  type NotionDataHomePushInput,
  type NotionPage,
} from '@/src/providers/notion-data-home';

function richText(content: string) {
  return [{ type: 'text', text: { content } }];
}

function notionPage(id: string, title: string, properties: Record<string, unknown> = {}): NotionPage {
  return {
    id,
    url: `https://notion.so/${id}`,
    parent: { data_source_id: 'db-1' },
    created_time: '2026-07-29T00:00:00.000Z',
    last_edited_time: '2026-07-29T00:00:00.000Z',
    properties: {
      Name: { type: 'title', title: richText(title) },
      ...properties,
    },
  };
}

function basePushInput(overrides: Partial<NotionDataHomePushInput> = {}): NotionDataHomePushInput {
  const pull = pullNotionDataHome({
    installationId: 'app-a',
    declaredDataHomes: ['notion'],
    databaseId: 'db-1',
    sessionPresent: true,
    online: true,
    pages: [notionPage('page-1', 'Alpha', {
      Body: { type: 'rich_text', rich_text: richText('Alpha note') },
    })],
  });
  if (pull.status !== 'ok') throw new Error('expected pull');
  const record = pull.records[0];
  return {
    installationId: 'app-a',
    declaredDataHomes: ['notion'],
    databaseId: 'db-1',
    sessionPresent: true,
    online: true,
    operation: 'create',
    record,
    expectedRevision: record.revision,
    idempotencyKey: 'idem-create-1',
    ...overrides,
  };
}

describe('notion data home adapter', () => {
  it('pulls pages into installation-scoped canonical records with a stable cursor', () => {
    const input = {
      installationId: 'app-a',
      declaredDataHomes: ['sqlite', 'notion'],
      databaseId: 'db-1',
      sessionPresent: true,
      online: true,
      pages: [
        notionPage('page-2', 'Beta', {
          Status: { type: 'select', select: { name: 'Open' } },
          Count: { type: 'number', number: 3 },
          Done: { type: 'checkbox', checkbox: true },
          Tags: { type: 'multi_select', multi_select: [{ name: 'A' }, { name: 'B' }] },
          Related: { type: 'relation', relation: [{ id: 'target-1' }] },
          Published: { type: 'date', date: { start: '2026-07-29' } },
        }),
        notionPage('page-1', 'Alpha', {
          Body: { type: 'rich_text', rich_text: richText('Alpha note') },
        }),
      ],
    } as const;

    const first = pullNotionDataHome(input);
    const second = pullNotionDataHome(input);

    expect(first.status).toBe('ok');
    expect(second.status).toBe('ok');
    if (first.status !== 'ok' || second.status !== 'ok') throw new Error('expected pull');
    expect(first.cursor).toBe(second.cursor);
    expect(canonicalJson(first)).toBe(canonicalJson(second));
    expect(Number.isSafeInteger(first.records[0]?.revision)).toBe(true);
    expect(first.records[0]?.revision).toBe(Date.parse('2026-07-29T00:00:00.000Z'));
    expect(first.cursor).toBe(`notion-cursor:${sha256Canonical({
      installationId: 'app-a',
      databaseId: 'db-1',
      previousCursor: null,
      records: first.records.map((record) => ({
        id: record.id,
        source: record.source,
        title: record.title,
        updated_at: record.updated_at,
        archived_at: record.archived_at,
        revision: record.revision,
        properties: record.properties,
        relations: record.relations,
      })),
    })}`);
    expect(first.records.map((record) => record.id)).toEqual([
      'notion:app-a:db-1:page-1',
      'notion:app-a:db-1:page-2',
    ]);
    expect(first.records[0]?.properties.Body).toEqual({ type: 'rich_text', value: 'Alpha note' });
  });

  it('keeps installations isolated, rejects bad parent scope, and blocks cross-installation writes', () => {
    const sharedPage = notionPage('page-1', 'Alpha');
    const left = pullNotionDataHome({
      installationId: 'app-a',
      declaredDataHomes: ['notion'],
      databaseId: 'db-1',
      sessionPresent: true,
      online: true,
      pages: [sharedPage],
    });
    const right = pullNotionDataHome({
      installationId: 'app-b',
      declaredDataHomes: ['notion'],
      databaseId: 'db-1',
      sessionPresent: true,
      online: true,
      pages: [sharedPage],
    });

    expect(left.status).toBe('ok');
    expect(right.status).toBe('ok');
    if (left.status !== 'ok' || right.status !== 'ok') throw new Error('expected pulls');
    expect(left.records[0]?.id).toBe('notion:app-a:db-1:page-1');
    expect(right.records[0]?.id).toBe('notion:app-b:db-1:page-1');
    expect(left.cursor).not.toBe(right.cursor);

    const badParent = pullNotionDataHome({
      installationId: 'app-a',
      declaredDataHomes: ['notion'],
      databaseId: 'db-1',
      sessionPresent: true,
      online: true,
      pages: [{
        ...sharedPage,
        parent: { data_source_id: 'db-2' },
      }],
    });
    expect(badParent.status).toBe('blocked');
    if (badParent.status !== 'blocked') throw new Error('expected block');
    expect(badParent.reason).toBe('notion_parent_scope_mismatch');

    const blocked = planNotionDataHomePush({
      ...basePushInput({
        installationId: 'app-b',
        record: { ...left.records[0]!, revision: 1 },
      }),
      installationId: 'app-b',
    });
    expect(blocked.status).toBe('blocked');
    if (blocked.status !== 'blocked') throw new Error('expected block');
    expect(blocked.reason).toBe('cross_installation_record');
  });

  it('plans create, update, and archive-only delete requests deterministically', () => {
    const baseInput = basePushInput();
    const create = planNotionDataHomePush(baseInput);
    expect(create.status).toBe('ok');
    if (create.status !== 'ok') throw new Error('expected create plan');
    expect(create.request.method).toBe('POST');
    expect(create.request.url).toBe('https://api.notion.com/v1/pages');
    expect(create.idempotencyKey).toBe('idem-create-1');
    expect(create.expectedRevision).toBe(baseInput.record.revision);
    expect(JSON.parse(create.request.body)).toEqual({
      parent: { data_source_id: 'db-1' },
      properties: {
        Body: { rich_text: [{ type: 'text', text: { content: 'Alpha note' } }] },
        Name: { title: [{ type: 'text', text: { content: 'Alpha' } }] },
      },
    });

    const updatedRecord = {
      ...basePushInput().record,
      version: null,
      last_edited_time: '2026-07-29T00:01:00.000Z',
      updated_at: '2026-07-29T00:01:00.000Z',
      revision: Date.parse('2026-07-29T00:01:00.000Z'),
      properties: {
        Name: { type: 'title', value: 'Alpha' },
        Body: { type: 'rich_text', value: 'Alpha updated' },
      },
    };
    const update = planNotionDataHomePush({
      ...baseInput,
      operation: 'update',
      expectedRevision: updatedRecord.revision,
      idempotencyKey: 'idem-update-1',
      record: updatedRecord,
    });
    expect(update.status).toBe('ok');
    if (update.status !== 'ok') throw new Error('expected update plan');
    expect(update.request.method).toBe('PATCH');
    expect(update.request.url).toBe('https://api.notion.com/v1/pages/page-1');
    expect(JSON.parse(update.request.body)).toEqual({
      properties: {
        Body: { rich_text: [{ type: 'text', text: { content: 'Alpha updated' } }] },
        Name: { title: [{ type: 'text', text: { content: 'Alpha' } }] },
      },
    });

    const archived = planNotionDataHomePush({
      ...baseInput,
      operation: 'delete',
      expectedRevision: baseInput.record.revision,
      deleteMode: 'archive',
      idempotencyKey: 'idem-delete-1',
    });
    expect(archived.status).toBe('ok');
    if (archived.status !== 'ok') throw new Error('expected archive plan');
    expect(JSON.parse(archived.request.body)).toEqual({ in_trash: true });

    const hardDelete = planNotionDataHomePush({
      ...baseInput,
      operation: 'delete',
      deleteMode: 'hard',
      expectedRevision: baseInput.record.revision,
      idempotencyKey: 'idem-delete-hard-1',
    });
    expect(hardDelete.status).toBe('blocked');
    if (hardDelete.status !== 'blocked') throw new Error('expected block');
    expect(hardDelete.reason).toBe('destructive_delete_rejected');
  });

  it('blocks offline and missing-session requests', () => {
    const offlinePull = pullNotionDataHome({
      installationId: 'app-a',
      declaredDataHomes: ['notion'],
      databaseId: 'db-1',
      sessionPresent: true,
      online: false,
      pages: [],
    });
    const noSessionPush = planNotionDataHomePush({
      ...basePushInput(),
      sessionPresent: false,
    });

    expect(offlinePull.status).toBe('blocked');
    if (offlinePull.status !== 'blocked') throw new Error('expected block');
    expect(offlinePull.reason).toBe('offline');
    expect(noSessionPush.status).toBe('blocked');
    if (noSessionPush.status !== 'blocked') throw new Error('expected block');
    expect(noSessionPush.reason).toBe('session_required');
  });

  it('fails closed when timestamps are missing', () => {
    const missingTimestamps = pullNotionDataHome({
      installationId: 'app-a',
      declaredDataHomes: ['notion'],
      databaseId: 'db-1',
      sessionPresent: true,
      online: true,
      pages: [{
        id: 'page-1',
        parent: { data_source_id: 'db-1' },
        properties: {
          Name: { type: 'title', title: richText('Alpha') },
        },
      }],
    });

    expect(missingTimestamps.status).toBe('blocked');
    if (missingTimestamps.status !== 'blocked') throw new Error('expected block');
    expect(missingTimestamps.reason).toBe('notion_timestamp_required');
  });

  it('rejects unsupported schema, malformed rich text, and formula writeback', () => {
    const baseInput = basePushInput();
    const unsupportedPull = pullNotionDataHome({
      installationId: 'app-a',
      declaredDataHomes: ['notion'],
      databaseId: 'db-1',
      sessionPresent: true,
      online: true,
      pages: [
        notionPage('page-1', 'Alpha', {
          Secret: { type: 'button', button: {} },
        }),
      ],
    });
    expect(unsupportedPull.status).toBe('blocked');
    if (unsupportedPull.status !== 'blocked') throw new Error('expected block');
    expect(unsupportedPull.reason).toBe('unsupported_property_type:button');

    const malformedRichText = planNotionDataHomePush({
      ...baseInput,
      operation: 'update',
      expectedRevision: baseInput.record.revision,
      idempotencyKey: 'idem-bad-rich-text',
      record: {
        ...baseInput.record,
        properties: {
          Name: { type: 'title', value: 'Alpha' },
          Body: { type: 'rich_text', value: [{ type: 'text' }] },
        },
      },
    });
    expect(malformedRichText.status).toBe('blocked');
    if (malformedRichText.status !== 'blocked') throw new Error('expected block');
    expect(malformedRichText.reason).toBe('malformed_rich_text');

    const formulaWriteback = planNotionDataHomePush({
      ...baseInput,
      operation: 'update',
      expectedRevision: baseInput.record.revision,
      idempotencyKey: 'idem-formula',
      record: {
        ...baseInput.record,
        properties: {
          Name: { type: 'title', value: 'Alpha' },
          Computed: { type: 'formula', value: { type: 'string', string: 'readonly' } },
        },
      },
    });
    expect(formulaWriteback.status).toBe('blocked');
    if (formulaWriteback.status !== 'blocked') throw new Error('expected block');
    expect(formulaWriteback.reason).toBe('writeback_unsupported:formula');
  });

  it('rejects revision conflicts and keeps serialized results free of token fragments', () => {
    const baseInput = basePushInput();
    const conflict = planNotionDataHomePush({
      ...baseInput,
      operation: 'update',
      expectedRevision: baseInput.record.revision + 1,
      idempotencyKey: 'idem-conflict',
      record: {
        ...baseInput.record,
        revision: baseInput.record.revision,
      },
    });
    expect(conflict.status).toBe('blocked');
    if (conflict.status !== 'blocked') throw new Error('expected block');
    expect(conflict.reason).toBe('revision_conflict');

    const pull = pullNotionDataHome({
      installationId: 'app-a',
      declaredDataHomes: ['notion'],
      databaseId: 'db-1',
      sessionPresent: true,
      online: true,
      pages: [notionPage('page-1', 'Alpha', { Body: { type: 'rich_text', rich_text: richText('Alpha note') } })],
    });
    const push = planNotionDataHomePush(baseInput);
    const serialized = canonicalJson({ pull, push }).toLowerCase();
    expect(serialized).not.toContain('secret');
    expect(serialized).not.toContain('token');
    expect(serialized).not.toContain('password');
  });
});
