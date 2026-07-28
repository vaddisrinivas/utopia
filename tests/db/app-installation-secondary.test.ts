import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_WORKSPACE_ID } from '@/packages/shared/contracts/app-installation';
import { executeLocalQueryForChat, LOCAL_QUERY_SCHEMA_VERSION } from '@/src/chat/local-query';
import { sendChatMessage, undoChatAction } from '@/src/chat/client';
import { runMigrations } from '@/src/db/migrations';
import { createInstallationRepository } from '@/src/db/records';
import { listProviderLinksForInstallation, upsertProviderLink } from '@/src/db/sources';
import { startWorkflowRun, getWorkflowRunSnapshot } from '@/src/workflows/runtime';
import type { DomainManifest } from '@/src/domain/catalog';
import { NodeSqliteDb } from '@/tests/helpers/node-sqlite-db';

const { manifest } = vi.hoisted(() => ({
  manifest: {
    schema_version: 'utopia.domain.v1',
    id: 'food',
    label: 'Food',
    render: {
      answer_label: 'Food',
      empty_intro: 'No matching food records.',
    },
    surfaces: [],
    collections: ['inventory'],
    relations: [],
    skills: [],
    workflows: [],
    data_homes: [],
    mcp: { resources: [], tools: [] },
  } as DomainManifest,
}));

vi.mock('@/src/domain/catalog', () => ({
  loadCatalog: () => ({
    activeDomainId: manifest.id,
    activeManifest: manifest,
    catalog: { domains: [manifest] },
  }),
  getDomainManifest: () => manifest,
}));

vi.mock('@/src/settings/utopia-settings', () => ({
  loadUtopiaSettings: async () => ({}),
  usableAiProfiles: () => [],
}));

function record(id: string, title: string) {
  const now = '2026-07-28T00:00:00.000Z';
  return {
    id,
    title,
    collection: 'inventory',
    properties: { body: title },
    relations: [],
    source: {
      provider: 'sqlite' as const,
      external_id: id,
      url: null,
      observed_at: now,
      content_hash: null,
    },
    archived_at: null,
    created_at: now,
    updated_at: now,
  };
}

describe('app installation secondary isolation', () => {
  const dbs: NodeSqliteDb[] = [];

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const db of dbs.splice(0)) db.close();
  });

  it('scopes chat, search, workflows, provider bindings, and chat operation context by installation', async () => {
    const db = new NodeSqliteDb();
    dbs.push(db);
    await runMigrations(db as any);

    const appA = createInstallationRepository({ db: db as any, workspaceId: DEFAULT_WORKSPACE_ID, installationId: 'app-a' });
    const appB = createInstallationRepository({ db: db as any, workspaceId: DEFAULT_WORKSPACE_ID, installationId: 'app-b' });
    await appA.upsertRecord(manifest, { ...record('shared-record', 'Alpha apples'), idempotency_key: 'a-create' });
    await appB.upsertRecord(manifest, { ...record('shared-record', 'Beta bananas'), idempotency_key: 'b-create' });

    const chat = await sendChatMessage({
      db: db as any,
      domainId: 'food',
      installationId: 'app-a',
      workspaceId: DEFAULT_WORKSPACE_ID,
      conversationId: 'chat-app-a',
      text: 'show bananas',
    });
    const chatPayload = JSON.stringify(chat.thread.messages);
    expect(chatPayload).toContain('Alpha apples');
    expect(chatPayload).not.toContain('Beta bananas');
    const conversation = await db.getFirstAsync<{ app_installation_id: string; package_id: string | null }>(
      'SELECT app_installation_id, package_id FROM conversations WHERE id = ?',
      ['chat-app-a'],
    );
    expect(conversation).toEqual({ app_installation_id: 'app-a', package_id: 'food' });

    const searchA = await executeLocalQueryForChat({
      db: db as any,
      domainId: 'food',
      installationId: 'app-a',
      request: {
        schemaVersion: LOCAL_QUERY_SCHEMA_VERSION,
        purpose: 'prove scoped search',
        requestedFields: ['id', 'title'],
        query: {
          from: 'records',
          where: { op: 'contains', field: 'title', value: 'Beta' },
          project: ['id', 'title'],
        },
      },
    });
    expect(searchA).toMatchObject({ ok: true, result: { rows: [] } });
    const searchB = await executeLocalQueryForChat({
      db: db as any,
      domainId: 'food',
      installationId: 'app-b',
      request: {
        schemaVersion: LOCAL_QUERY_SCHEMA_VERSION,
        purpose: 'prove scoped search',
        requestedFields: ['id', 'title'],
        query: {
          from: 'records',
          where: { op: 'contains', field: 'title', value: 'Beta' },
          project: ['id', 'title'],
        },
      },
    });
    expect(searchB.ok && searchB.result.rows.map((row) => row.fields.title)).toEqual(['Beta bananas']);

    const workflow = await startWorkflowRun({
      db: db as any,
      id: 'wf-a',
      appInstallationId: 'app-a',
      domain: 'food',
      workflowId: 'inventory-cleanup',
      steps: [{ id: 'write', title: 'Write scoped record' }],
    });
    expect(workflow.row.app_installation_id).toBe('app-a');
    expect(await getWorkflowRunSnapshot(db as any, 'wf-a', 'app-b')).toBeNull();
    const forged = await appA.applyOperation(manifest, {
      op_id: 'workflow-forged-b',
      app_installation_id: 'app-b',
      kind: 'update',
      domain: 'food',
      collection: 'inventory',
      record_id: 'shared-record',
      expected_revision: 1,
      changes: { body: 'forged' },
      actor: 'ai',
      origin: 'workflow',
    });
    expect(forged.status).toBe('rejected');
    expect(forged.reject_reason).toBe('installation_scope_mismatch');
    expect((await appB.getRecord('shared-record'))?.title).toBe('Beta bananas');

    const now = '2026-07-28T00:00:00.000Z';
    await upsertProviderLink(db as any, {
      id: 'notion:source',
      app_installation_id: 'app-a',
      provider: 'notion',
      external_id: 'source',
      name: 'A source',
      status: 'Synced',
      freshness: now,
      workspace: 'A',
      url: 'https://notion.so/a',
      created_at: now,
      updated_at: now,
    });
    await upsertProviderLink(db as any, {
      id: 'notion:source',
      app_installation_id: 'app-b',
      provider: 'notion',
      external_id: 'source',
      name: 'B source',
      status: 'Synced',
      freshness: now,
      workspace: 'B',
      url: 'https://notion.so/b',
      created_at: now,
      updated_at: now,
    });
    expect((await listProviderLinksForInstallation(db as any, 'app-a')).map((link) => link.name)).toEqual(['A source']);
    expect((await listProviderLinksForInstallation(db as any, 'app-b')).map((link) => link.name)).toEqual(['B source']);

    const serverBodies: unknown[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url, init: RequestInit) => {
      serverBodies.push(JSON.parse(String(init.body)));
      return {
        ok: true,
        json: async () => ({
          conversation_id: 'server-chat',
          messages: [{ id: 'assistant-server', role: 'assistant', text: 'ok' }],
        }),
      };
    }));
    await sendChatMessage({
      db: null,
      domainId: 'food',
      installationId: 'app-a',
      workspaceId: DEFAULT_WORKSPACE_ID,
      conversationId: 'server-chat',
      text: 'create a note',
      serverUrl: 'https://utopia.local',
    });
    expect(serverBodies[0]).toMatchObject({
      conversation_id: 'server-chat',
      app_installation_id: 'app-a',
      workspace_id: DEFAULT_WORKSPACE_ID,
      package_id: 'food',
      package_version: '1.0.0',
    });

    const bCreate = await db.getFirstAsync<{ op_id: string }>(
      "SELECT op_id FROM operations WHERE app_installation_id = 'app-b' AND kind = 'create' LIMIT 1",
    );
    const undo = await undoChatAction({
      db: db as any,
      domainId: 'food',
      installationId: 'app-a',
      receipt: {
        id: 'receipt-b',
        status: 'completed',
        record_ids: ['shared-record'],
        operation_id: bCreate!.op_id,
        created_at: now,
        updated_at: now,
      },
    });
    expect(undo.status).toBe('failed');
    expect(undo.undo_result?.message).toContain('No matching local operation');
  });
});
