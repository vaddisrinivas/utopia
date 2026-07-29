import { afterEach, describe, expect, it } from 'vitest';

import { DEFAULT_WORKSPACE_ID } from '@/packages/shared/contracts/app-installation';
import { createAppInstallation } from '@/src/db/app-package-registry';
import { runMigrations } from '@/src/db/migrations';
import { getRecordForInstallation, upsertRecord } from '@/src/db/records';
import {
  clearInstallationDataHome,
  connectInstallationDataHome,
  disconnectInstallationDataHome,
  getInstallationDataHome,
  reauthorizeInstallationDataHome,
  revokeInstallationDataHome,
} from '@/src/providers/data-home-adapter';
import { NodeSqliteDb } from '@/tests/helpers/node-sqlite-db';

type Manifest = {
  schema_version: 'utopia.domain.v1';
  id: 'food';
  label: 'Food';
  surfaces: [];
  collections: ['inventory'];
  relations: [];
  skills: [];
  workflows: [];
  data_homes: ['sqlite', 'notion', 'google_sheets', 'postgres'];
  mcp: { resources: []; tools: [] };
};

const manifest: Manifest = {
  schema_version: 'utopia.domain.v1',
  id: 'food',
  label: 'Food',
  surfaces: [],
  collections: ['inventory'],
  relations: [],
  skills: [],
  workflows: [],
  data_homes: ['sqlite', 'notion', 'google_sheets', 'postgres'],
  mcp: { resources: [], tools: [] },
};

function record(id: string, title: string, sourceProvider: 'sqlite' | 'notion') {
  const now = '2026-07-29T00:00:00.000Z';
  return {
    id,
    title,
    collection: 'inventory',
    properties: { body: title },
    relations: [],
    source: {
      provider: sourceProvider,
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

class MemoryTokenStore {
  tokens = new Map<string, string>();

  async readToken(key: string): Promise<string | null> {
    return this.tokens.get(key) ?? null;
  }

  async writeToken(key: string, value: string): Promise<void> {
    this.tokens.set(key, value);
  }

  async deleteToken(key: string): Promise<void> {
    this.tokens.delete(key);
  }
}

describe('data home adapter', () => {
  const dbs: NodeSqliteDb[] = [];

  afterEach(() => {
    for (const db of dbs.splice(0)) db.close();
  });

  it('keeps provider bindings and tokens isolated per installation', async () => {
    const db = new NodeSqliteDb();
    dbs.push(db);
    const tokens = new MemoryTokenStore();
    await runMigrations(db as any);
    await createAppInstallation(db as any, { id: 'app-a', workspaceId: DEFAULT_WORKSPACE_ID, label: 'App A' });
    await createAppInstallation(db as any, { id: 'app-b', workspaceId: DEFAULT_WORKSPACE_ID, label: 'App B' });

    await connectInstallationDataHome(db as any, {
      installationId: 'app-a',
      provider: 'notion',
      externalId: 'notion-a',
      token: 'token-a-secret',
      declaredDataHomes: manifest.data_homes,
      label: 'App A Notion',
      workspace: 'Workspace A',
    }, tokens);
    await connectInstallationDataHome(db as any, {
      installationId: 'app-b',
      provider: 'notion',
      externalId: 'notion-b',
      token: 'token-b-secret',
      declaredDataHomes: manifest.data_homes,
      label: 'App B Notion',
      workspace: 'Workspace B',
    }, tokens);

    const a = await getInstallationDataHome(db as any, {
      installationId: 'app-a',
      declaredDataHomes: manifest.data_homes,
      tokenStore: tokens,
    });
    const b = await getInstallationDataHome(db as any, {
      installationId: 'app-b',
      declaredDataHomes: manifest.data_homes,
      tokenStore: tokens,
    });

    expect(a.summary).toMatchObject({
      installationId: 'app-a',
      provider: 'notion',
      mode: 'external',
      status: 'connected',
      externalId: 'notion-a',
      declared: true,
    });
    expect(b.summary).toMatchObject({
      installationId: 'app-b',
      provider: 'notion',
      mode: 'external',
      status: 'connected',
      externalId: 'notion-b',
      declared: true,
    });
    expect(a.tokenPreview).not.toContain('token-a-secret');
    expect(b.tokenPreview).not.toContain('token-b-secret');
    expect(JSON.stringify(a.summary)).not.toContain('token-a-secret');
    expect(JSON.stringify(b.summary)).not.toContain('token-b-secret');
    expect(await tokens.readToken('utopia.data-home-token.v1:app-a:notion')).toBe('token-a-secret');
    expect(await tokens.readToken('utopia.data-home-token.v1:app-b:notion')).toBe('token-b-secret');

    const appARow = await db.getFirstAsync<{ data_home_provider: string; data_home_external_id: string | null }>(
      'SELECT data_home_provider, data_home_external_id FROM app_installations WHERE installation_id = ?',
      ['app-a'],
    );
    const appBRow = await db.getFirstAsync<{ data_home_provider: string; data_home_external_id: string | null }>(
      'SELECT data_home_provider, data_home_external_id FROM app_installations WHERE installation_id = ?',
      ['app-b'],
    );
    expect(appARow).toEqual({ data_home_provider: 'notion', data_home_external_id: 'notion-a' });
    expect(appBRow).toEqual({ data_home_provider: 'notion', data_home_external_id: 'notion-b' });
  });

  it('redacts tokens, revokes and reconnects deterministically, and falls back offline', async () => {
    const db = new NodeSqliteDb();
    dbs.push(db);
    const tokens = new MemoryTokenStore();
    await runMigrations(db as any);
    await createAppInstallation(db as any, { id: 'app-a', workspaceId: DEFAULT_WORKSPACE_ID, label: 'App A' });

    await connectInstallationDataHome(db as any, {
      installationId: 'app-a',
      provider: 'notion',
      externalId: 'notion-a',
      token: 'token-a-secret',
      declaredDataHomes: manifest.data_homes,
    }, tokens);
    const connected = await getInstallationDataHome(db as any, {
      installationId: 'app-a',
      declaredDataHomes: manifest.data_homes,
      tokenStore: tokens,
    });
    expect(connected.tokenPreview).toBe('Stored securely');

    const offline = await getInstallationDataHome(db as any, {
      installationId: 'app-a',
      declaredDataHomes: manifest.data_homes,
      providerOnline: false,
      tokenStore: tokens,
    });
    expect(offline.summary).toMatchObject({
      mode: 'local',
      status: 'offline',
      reason: 'provider_offline',
    });

    const revoked = await revokeInstallationDataHome(db as any, {
      installationId: 'app-a',
      provider: 'notion',
      declaredDataHomes: manifest.data_homes,
    }, tokens);
    expect(revoked.summary).toMatchObject({
      mode: 'local',
      status: 'revoked',
      reason: 'provider_revoked',
    });
    expect(await tokens.readToken('utopia.data-home-token.v1:app-a:notion')).toBeNull();

    const reconnected = await reauthorizeInstallationDataHome(db as any, {
      installationId: 'app-a',
      provider: 'notion',
      externalId: 'notion-a',
      token: 'token-a-rotated',
      declaredDataHomes: manifest.data_homes,
    }, tokens);
    expect(reconnected.summary).toMatchObject({
      mode: 'external',
      status: 'connected',
      reason: 'provider_connected',
      externalId: 'notion-a',
    });
    expect(await tokens.readToken('utopia.data-home-token.v1:app-a:notion')).toBe('token-a-rotated');

    const unsupported = db as any;
    await expect(connectInstallationDataHome(unsupported, {
      installationId: 'app-a',
      provider: 'postgres',
      externalId: 'postgres-home',
      token: 'postgres-secret',
      declaredDataHomes: manifest.data_homes,
    }, tokens)).rejects.toThrow('unsupported_data_home_provider:postgres');
  });

  it("clears only one installation's provider data", async () => {
    const db = new NodeSqliteDb();
    dbs.push(db);
    const tokens = new MemoryTokenStore();
    await runMigrations(db as any);
    await createAppInstallation(db as any, { id: 'app-a', workspaceId: DEFAULT_WORKSPACE_ID, label: 'App A' });
    await createAppInstallation(db as any, { id: 'app-b', workspaceId: DEFAULT_WORKSPACE_ID, label: 'App B' });

    await connectInstallationDataHome(db as any, {
      installationId: 'app-a',
      provider: 'notion',
      externalId: 'notion-a',
      token: 'token-a-secret',
      declaredDataHomes: manifest.data_homes,
    }, tokens);
    await connectInstallationDataHome(db as any, {
      installationId: 'app-b',
      provider: 'notion',
      externalId: 'notion-b',
      token: 'token-b-secret',
      declaredDataHomes: manifest.data_homes,
    }, tokens);

    await upsertRecord(db as any, manifest as any, {
      ...record('app-a-record', 'App A record', 'notion'),
      app_installation_id: 'app-a',
    });
    await upsertRecord(db as any, manifest as any, {
      ...record('app-b-record', 'App B record', 'notion'),
      app_installation_id: 'app-b',
    });

    const result = await clearInstallationDataHome(db as any, {
      installationId: 'app-a',
      provider: 'notion',
    });
    expect(result.clearedRecords).toBe(1);
    expect(result.clearedSnapshots).toBe(0);
    expect(await getRecordForInstallation(db as any, 'app-a', 'app-a-record')).toBeNull();
    expect((await getRecordForInstallation(db as any, 'app-b', 'app-b-record'))?.title).toBe('App B record');
    expect(await tokens.readToken('utopia.data-home-token.v1:app-a:notion')).toBe('token-a-secret');
    expect(await tokens.readToken('utopia.data-home-token.v1:app-b:notion')).toBe('token-b-secret');

    const appARow = await db.getFirstAsync<{ data_home_provider: string; data_home_status: string }>(
      'SELECT data_home_provider, data_home_status FROM app_installations WHERE installation_id = ?',
      ['app-a'],
    );
    expect(appARow).toEqual({ data_home_provider: 'notion', data_home_status: 'connected' });

    await disconnectInstallationDataHome(db as any, {
      installationId: 'app-a',
      provider: 'notion',
      declaredDataHomes: manifest.data_homes,
    }, tokens);
    expect(await tokens.readToken('utopia.data-home-token.v1:app-a:notion')).toBeNull();
  });
});
