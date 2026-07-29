export const DATA_HOME_CONTRACT_SCHEMA_VERSION = 'utopia.data-home-contract.v1' as const;
export const DATA_HOME_SUMMARY_SCHEMA_VERSION = 'utopia.data-home-summary.v1' as const;

export type DataHomeProvider = 'sqlite' | 'notion' | 'google_sheets' | 'postgres' | (string & {});
export type SupportedDataHomeProvider = 'sqlite' | 'notion' | 'google_sheets';
export type DataHomeMode = 'local' | 'external';
export type DataHomeStatus = 'local' | 'connected' | 'disconnected' | 'revoked' | 'offline' | 'blocked';

export type DataHomeDecision = Readonly<{
  schemaVersion: typeof DATA_HOME_CONTRACT_SCHEMA_VERSION;
  installationId: string;
  provider: DataHomeProvider;
  mode: DataHomeMode;
  status: DataHomeStatus;
  externalId: string | null;
  declared: boolean;
  reason: string;
  updatedAt: string;
}>;

export type DataHomeSummary = Omit<DataHomeDecision, 'schemaVersion'> & Readonly<{
  schemaVersion: typeof DATA_HOME_SUMMARY_SCHEMA_VERSION;
  tokenState: 'none' | 'stored';
  tokenPreview: string;
}>;

export function isSupportedDataHomeProvider(provider: string): provider is SupportedDataHomeProvider {
  return provider === 'sqlite' || provider === 'notion' || provider === 'google_sheets';
}

export function maskProviderToken(token: string): string {
  const trimmed = token.trim();
  if (!trimmed) return 'Not set';
  return 'Stored securely';
}

export function resolveDataHomeDecision(input: {
  installationId: string;
  declaredDataHomes: readonly string[];
  provider?: string | null;
  externalId?: string | null;
  tokenPresent?: boolean;
  providerOnline?: boolean;
  status?: DataHomeStatus | null;
  updatedAt?: string;
}): DataHomeDecision {
  const updatedAt = input.updatedAt ?? new Date().toISOString();
  const provider = normalizeProvider(input.provider);
  const declared = provider === 'sqlite' || input.declaredDataHomes.includes(provider);

  if (provider === 'sqlite') {
    return {
      schemaVersion: DATA_HOME_CONTRACT_SCHEMA_VERSION,
      installationId: input.installationId.trim(),
      provider,
      mode: 'local',
      status: 'local',
      externalId: null,
      declared: true,
      reason: 'default_local_sqlite',
      updatedAt,
    };
  }

  if (!isSupportedDataHomeProvider(provider)) {
    return blockedDecision(input.installationId, provider, updatedAt, declared, `unsupported_provider:${provider}`);
  }
  if (!declared) {
    return blockedDecision(input.installationId, provider, updatedAt, false, `undeclared_provider:${provider}`);
  }

  if (input.status === 'revoked') {
    return blockedDecision(input.installationId, provider, updatedAt, true, 'provider_revoked', input.externalId, 'revoked');
  }
  if (input.status === 'disconnected' || input.tokenPresent === false) {
    return blockedDecision(input.installationId, provider, updatedAt, true, 'oauth_token_missing', input.externalId, 'disconnected');
  }
  if (input.providerOnline === false) {
    return blockedDecision(input.installationId, provider, updatedAt, true, 'provider_offline', input.externalId, 'offline');
  }

  return {
    schemaVersion: DATA_HOME_CONTRACT_SCHEMA_VERSION,
    installationId: input.installationId.trim(),
    provider,
    mode: 'external',
    status: input.status === 'blocked' ? 'blocked' : 'connected',
    externalId: input.externalId?.trim() || null,
    declared: true,
    reason: 'provider_connected',
    updatedAt,
  };
}

export function summarizeDataHomeDecision(decision: DataHomeDecision, token: string | null): DataHomeSummary {
  return {
    ...decision,
    schemaVersion: DATA_HOME_SUMMARY_SCHEMA_VERSION,
    tokenState: token ? 'stored' : 'none',
    tokenPreview: token ? maskProviderToken(token) : 'Not set',
  };
}

function normalizeProvider(provider?: string | null): DataHomeProvider {
  const trimmed = provider?.trim();
  return trimmed ? (trimmed as DataHomeProvider) : 'sqlite';
}

function blockedDecision(
  installationId: string,
  provider: DataHomeProvider,
  updatedAt: string,
  declared: boolean,
  reason: string,
  externalId: string | null = null,
  status: DataHomeStatus = 'blocked',
): DataHomeDecision {
  return {
    schemaVersion: DATA_HOME_CONTRACT_SCHEMA_VERSION,
    installationId: installationId.trim(),
    provider,
    mode: 'local',
    status,
    externalId: externalId?.trim() || null,
    declared,
    reason,
    updatedAt,
  };
}
