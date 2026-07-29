import type { SQLiteDatabase } from 'expo-sqlite';

import { DEFAULT_APP_INSTALLATION_ID } from '@/packages/shared/contracts/app-installation';
import { isSupportedDataHomeProvider, resolveDataHomeDecision, summarizeDataHomeDecision, type DataHomeProvider, type DataHomeStatus, type DataHomeSummary, type SupportedDataHomeProvider } from '@/src/providers/data-home-contract';
import { deleteProviderTokenValue, readProviderTokenValue, writeProviderTokenValue } from '@/src/providers/provider-token-storage';
import { listProviderLinksForInstallation, upsertProviderLink, type ProviderLink } from '@/src/db/sources';

type TokenStore = {
  readToken(key: string): Promise<string | null>;
  writeToken(key: string, value: string): Promise<void>;
  deleteToken(key: string): Promise<void>;
};

export type DataHomeAdapter = Readonly<{
  installationId: string;
  provider: DataHomeProvider;
  externalId: string | null;
  status: DataHomeStatus;
  declared: boolean;
  reason: string;
  tokenPreview: string;
  tokenState: 'none' | 'stored';
  mode: 'local' | 'external';
  updatedAt: string;
  summary: DataHomeSummary;
}>;

export type DataHomeConnectionInput = Readonly<{
  installationId?: string;
  provider: DataHomeProvider;
  externalId?: string | null;
  token?: string | null;
  declaredDataHomes: readonly string[];
  providerOnline?: boolean;
  label?: string;
  workspace?: string;
  url?: string | null;
  now?: string;
}>;

export type DataHomeDisconnectInput = Readonly<{
  installationId?: string;
  provider: DataHomeProvider;
  declaredDataHomes: readonly string[];
  reason?: 'disconnected' | 'revoked';
  now?: string;
}>;

export type DataHomeClearInput = Readonly<{
  installationId?: string;
  provider: DataHomeProvider;
  now?: string;
}>;

export async function getInstallationDataHome(
  db: SQLiteDatabase,
  input: {
    installationId?: string;
    declaredDataHomes: readonly string[];
    providerOnline?: boolean;
    tokenStore?: TokenStore;
  },
): Promise<DataHomeAdapter> {
  const installationId = normalizeInstallationId(input.installationId);
  const row = await getDataHomeStateRow(db, installationId);
  const tokenStore = input.tokenStore ?? defaultTokenStore;
  const token = await tokenStore.readToken(dataHomeTokenKey(installationId, row?.data_home_provider ?? 'sqlite'));
  const decision = resolveDataHomeDecision({
    installationId,
    declaredDataHomes: input.declaredDataHomes,
    provider: row?.data_home_provider ?? 'sqlite',
    externalId: row?.data_home_external_id ?? null,
    status: row?.data_home_status ?? 'local',
    tokenPresent: Boolean(token),
    providerOnline: input.providerOnline,
    updatedAt: row?.data_home_updated_at ?? new Date().toISOString(),
  });
  const summary = summarizeDataHomeDecision(decision, token);
  return {
    ...decision,
    tokenPreview: summary.tokenPreview,
    tokenState: summary.tokenState,
    summary,
  };
}

export async function connectInstallationDataHome(
  db: SQLiteDatabase,
  input: DataHomeConnectionInput,
  tokenStore: TokenStore = defaultTokenStore,
): Promise<DataHomeAdapter> {
  const installationId = normalizeInstallationId(input.installationId);
  const provider = normalizeProvider(input.provider);
  validateProvider(provider, input.declaredDataHomes);
  if (provider !== 'sqlite' && !input.token?.trim()) {
    throw new Error('oauth_token_required');
  }
  const now = input.now ?? new Date().toISOString();
  const current = await getDataHomeStateRow(db, installationId);
  if (!current) {
    throw new Error(`app_installation_not_found:${installationId}`);
  }
  const tokenKey = dataHomeTokenKey(installationId, provider);
  const previousToken = provider === 'sqlite' ? null : await tokenStore.readToken(tokenKey);
  if (provider !== 'sqlite') {
    await tokenStore.writeToken(tokenKey, input.token!.trim());
  }
  try {
    await db.withTransactionAsync(async () => {
      await updateDataHomeState(db, {
        installationId,
        provider,
        externalId: input.externalId ?? null,
        status: provider === 'sqlite' ? 'local' : input.providerOnline === false ? 'offline' : 'connected',
        now,
      });
      if (provider !== 'sqlite') {
        await upsertProviderLink(db, {
          id: `data-home:${provider}`,
          app_installation_id: installationId,
          provider,
          external_id: (input.externalId ?? provider).trim(),
          name: input.label?.trim() || provider,
          status: input.providerOnline === false ? 'offline' : 'connected',
          freshness: now,
          workspace: input.workspace?.trim() || provider,
          url: input.url ?? null,
          created_at: now,
          updated_at: now,
        });
      }
    });
  } catch (error) {
    if (provider !== 'sqlite') {
      if (previousToken) {
        await tokenStore.writeToken(tokenKey, previousToken);
      } else {
        await tokenStore.deleteToken(tokenKey);
      }
    }
    throw error;
  }
  return getInstallationDataHome(db, {
    installationId,
    declaredDataHomes: input.declaredDataHomes,
    providerOnline: input.providerOnline,
    tokenStore,
  });
}

export async function disconnectInstallationDataHome(
  db: SQLiteDatabase,
  input: DataHomeDisconnectInput,
  tokenStore: TokenStore = defaultTokenStore,
): Promise<DataHomeAdapter> {
  const installationId = normalizeInstallationId(input.installationId);
  const provider = normalizeProvider(input.provider);
  const now = input.now ?? new Date().toISOString();
  const current = await getDataHomeStateRow(db, installationId);
  if (!current) {
    throw new Error(`app_installation_not_found:${installationId}`);
  }
  if (provider !== 'sqlite') {
    await tokenStore.deleteToken(dataHomeTokenKey(installationId, provider));
  }
  await updateDataHomeState(db, {
    installationId,
    provider,
    externalId: current?.data_home_external_id ?? null,
    status: input.reason === 'revoked' ? 'revoked' : 'disconnected',
    now,
  });
  return getInstallationDataHome(db, {
    installationId,
    declaredDataHomes: input.declaredDataHomes,
    tokenStore,
  });
}

export async function clearInstallationDataHome(
  db: SQLiteDatabase,
  input: DataHomeClearInput,
): Promise<{ clearedRecords: number; clearedSnapshots: number; clearedLinks: number; clearedOutbox: number }> {
  const installationId = normalizeInstallationId(input.installationId);
  const provider = normalizeProvider(input.provider);
  if (provider === 'sqlite') {
    return { clearedRecords: 0, clearedSnapshots: 0, clearedLinks: 0, clearedOutbox: 0 };
  }
  const recordIds = await db.getAllAsync<{ id: string }>(
    'SELECT id FROM records WHERE app_installation_id = ? AND source_provider = ?',
    [installationId, provider],
  );
  const snapshotIds = await db.getAllAsync<{ id: string }>(
    'SELECT id FROM source_snapshots WHERE app_installation_id = ? AND provider = ?',
    [installationId, provider],
  );
  const linkCount = await getInstallationDataHomeLinkCount(db, installationId, provider);
  const outboxCount = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) AS count FROM outbox_events WHERE app_installation_id = ? AND action_key LIKE ?`,
    [installationId, `provider-write:${installationId}:${provider}:%`],
  );

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `DELETE FROM record_relations
        WHERE app_installation_id = ?
          AND (
            from_id IN (SELECT id FROM records WHERE app_installation_id = ? AND source_provider = ?)
            OR target_id IN (SELECT id FROM records WHERE app_installation_id = ? AND source_provider = ?)
          )`,
      [installationId, installationId, provider, installationId, provider],
    );
    await db.runAsync(
      `DELETE FROM source_snapshot_relations
        WHERE app_installation_id = ?
          AND (
            record_id IN (SELECT id FROM records WHERE app_installation_id = ? AND source_provider = ?)
            OR snapshot_id IN (SELECT id FROM source_snapshots WHERE app_installation_id = ? AND provider = ?)
          )`,
      [installationId, installationId, provider, installationId, provider],
    );
    await db.runAsync(
      `DELETE FROM records WHERE app_installation_id = ? AND source_provider = ?`,
      [installationId, provider],
    );
    await db.runAsync(
      `DELETE FROM source_snapshots WHERE app_installation_id = ? AND provider = ?`,
      [installationId, provider],
    );

    await db.runAsync(
      `DELETE FROM provider_links WHERE app_installation_id = ? AND provider = ?`,
      [installationId, provider],
    );
    await db.runAsync(
      `DELETE FROM outbox_events WHERE app_installation_id = ? AND action_key LIKE ?`,
      [installationId, `provider-write:${installationId}:${provider}:%`],
    );
  });

  return {
    clearedRecords: recordIds.length,
    clearedSnapshots: snapshotIds.length,
    clearedLinks: linkCount,
    clearedOutbox: outboxCount?.count ?? 0,
  };
}

export async function reauthorizeInstallationDataHome(
  db: SQLiteDatabase,
  input: DataHomeConnectionInput,
  tokenStore: TokenStore = defaultTokenStore,
): Promise<DataHomeAdapter> {
  return connectInstallationDataHome(db, input, tokenStore);
}

export async function revokeInstallationDataHome(
  db: SQLiteDatabase,
  input: DataHomeDisconnectInput,
  tokenStore: TokenStore = defaultTokenStore,
): Promise<DataHomeAdapter> {
  return disconnectInstallationDataHome(db, { ...input, reason: 'revoked' }, tokenStore);
}

export async function getInstallationDataHomeLinkCount(
  db: SQLiteDatabase,
  installationId?: string,
  provider?: DataHomeProvider,
): Promise<number> {
  const scoped = normalizeInstallationId(installationId);
  const rows: ProviderLink[] = await listProviderLinksForInstallation(db, scoped);
  if (provider) {
    return rows.filter((row) => row.provider === provider).length;
  }
  return rows.length;
}

function normalizeInstallationId(value?: string | null): string {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : DEFAULT_APP_INSTALLATION_ID;
}

function normalizeProvider(provider: DataHomeProvider): DataHomeProvider {
  const trimmed = provider.trim();
  return trimmed.length ? (trimmed as DataHomeProvider) : 'sqlite';
}

function validateProvider(
  provider: DataHomeProvider,
  declaredDataHomes: readonly string[],
): asserts provider is SupportedDataHomeProvider {
  if (provider === 'sqlite') return;
  if (!isSupportedDataHomeProvider(provider)) {
    throw new Error(`unsupported_data_home_provider:${provider}`);
  }
  if (!declaredDataHomes.includes(provider)) {
    throw new Error(`undeclared_data_home_provider:${provider}`);
  }
}

async function getDataHomeStateRow(db: SQLiteDatabase, installationId: string): Promise<{
  data_home_provider: string | null;
  data_home_external_id: string | null;
  data_home_status: DataHomeStatus | null;
  data_home_updated_at: string | null;
} | null> {
  return db.getFirstAsync<{
    data_home_provider: string | null;
    data_home_external_id: string | null;
    data_home_status: DataHomeStatus | null;
    data_home_updated_at: string | null;
  }>(
    `SELECT data_home_provider, data_home_external_id, data_home_status, data_home_updated_at
      FROM app_installations
      WHERE installation_id = ?`,
    [installationId],
  );
}

async function updateDataHomeState(
  db: SQLiteDatabase,
  input: {
    installationId: string;
    provider: DataHomeProvider;
    externalId: string | null;
    status: DataHomeStatus;
    now: string;
  },
): Promise<void> {
  const result = await db.runAsync(
    `UPDATE app_installations
      SET data_home_provider = ?,
          data_home_external_id = ?,
          data_home_status = ?,
          data_home_updated_at = ?
      WHERE installation_id = ?`,
    [input.provider, input.externalId, input.status, input.now, input.installationId],
  );
  if (typeof result.changes === 'number' && result.changes !== 1) {
    throw new Error(`app_installation_not_found:${input.installationId}`);
  }
}

function dataHomeTokenKey(installationId: string, provider: DataHomeProvider): string {
  return `utopia.data-home-token.v1:${installationId}:${provider}`;
}

const defaultTokenStore: TokenStore = {
  readToken: readProviderTokenValue,
  writeToken: writeProviderTokenValue,
  deleteToken: deleteProviderTokenValue,
};
