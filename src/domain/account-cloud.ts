import { sha256Canonical } from '@/src/domain/canonical-json';

export const OIDC_ACCOUNT_SCHEMA_VERSION = 'utopia.oidc-account.v1';
export const OIDC_SESSION_SCHEMA_VERSION = 'utopia.account-session.v1';
export const OIDC_DEVICE_SCHEMA_VERSION = 'utopia.account-device.v1';
export const PROOF_OF_POSSESSION_SCHEMA_VERSION = 'utopia.proof-of-possession.v1';

export type CloudAccountStatus = 'active' | 'disabled' | 'pending_delete';
export type CloudSessionStatus = 'active' | 'expired' | 'revoked' | 'rotated';
export type CloudDeviceStatus = 'pending' | 'active' | 'revoked' | 'lost';
export type CloudAuthFlow = 'oidc_code_pkce' | 'refresh_token' | 'device_rebind';
export type CloudDevicePlatform = 'ios' | 'android' | 'web' | 'desktop' | 'server';
export type ProofOfPossessionAlgorithm = 'ES256' | 'EdDSA' | 'RS256';

export type OidcAccount = Readonly<{
  schemaVersion: typeof OIDC_ACCOUNT_SCHEMA_VERSION;
  accountId: string;
  workspaceId: string;
  issuer: string;
  subject: string;
  email: string | null;
  emailVerified: boolean;
  displayName: string | null;
  status: CloudAccountStatus;
  profile: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}>;

export type AccountDevice = Readonly<{
  schemaVersion: typeof OIDC_DEVICE_SCHEMA_VERSION;
  deviceId: string;
  workspaceId: string;
  accountId: string;
  installationId: string | null;
  platform: CloudDevicePlatform;
  deviceLabel: string;
  status: CloudDeviceStatus;
  proofKeyId: string;
  proofPublicKey: string;
  proofAlgorithm: ProofOfPossessionAlgorithm;
  attestationFormat: string | null;
  metadata: Record<string, unknown>;
  lastSeenAt: string | null;
  createdAt: string;
  updatedAt: string;
}>;

export type ProofOfPossessionContract = Readonly<{
  schemaVersion: typeof PROOF_OF_POSSESSION_SCHEMA_VERSION;
  bindingId: string;
  workspaceId: string;
  accountId: string;
  sessionId: string;
  deviceId: string;
  installationId: string | null;
  issuer: string;
  subject: string;
  keyId: string;
  publicKey: string;
  algorithm: ProofOfPossessionAlgorithm;
  proofHeader: 'DPoP';
  nonceTtlSeconds: number;
  clockSkewSeconds: number;
}>;

export type ProofOfPossessionContractInput = Readonly<{
  workspaceId: string;
  accountId: string;
  sessionId: string;
  deviceId: string;
  installationId?: string | null;
  issuer: string;
  subject: string;
  keyId: string;
  publicKey: string;
  algorithm?: ProofOfPossessionAlgorithm;
  nonceTtlSeconds?: number;
  clockSkewSeconds?: number;
}>;

export type AccountSession = Readonly<{
  schemaVersion: typeof OIDC_SESSION_SCHEMA_VERSION;
  sessionId: string;
  workspaceId: string;
  accountId: string;
  deviceId: string;
  installationId: string | null;
  issuer: string;
  subject: string;
  status: CloudSessionStatus;
  authFlow: CloudAuthFlow;
  scope: string;
  proofBinding: ProofOfPossessionContract;
  refreshFamilyId: string | null;
  claims: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  accessExpiresAt: string | null;
  refreshExpiresAt: string | null;
  lastProofAt: string | null;
}>;

export type AccountAuthSummary = Readonly<{
  mode: 'local_only' | 'connected' | 'attention';
  headline: string;
  detail: string;
  accountLabel: string;
  deviceLabel: string;
  sessionLabel: string;
  activeDeviceCount: number;
  activeSessionCount: number;
}>;

export function createOidcAccount(input: {
  accountId: string;
  workspaceId: string;
  issuer: string;
  subject: string;
  email?: string | null;
  emailVerified?: boolean;
  displayName?: string | null;
  status?: CloudAccountStatus;
  profile?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
}): OidcAccount {
  const createdAt = isoTime(input.createdAt);
  const updatedAt = isoTime(input.updatedAt ?? createdAt);
  return {
    schemaVersion: OIDC_ACCOUNT_SCHEMA_VERSION,
    accountId: requiredText(input.accountId, 'account_id'),
    workspaceId: requiredText(input.workspaceId, 'workspace_id'),
    issuer: normalizeIssuer(input.issuer),
    subject: requiredText(input.subject, 'subject'),
    email: optionalText(input.email),
    emailVerified: Boolean(input.emailVerified),
    displayName: optionalText(input.displayName),
    status: input.status ?? 'active',
    profile: sanitizeObject(input.profile),
    createdAt,
    updatedAt,
  };
}

export function createAccountDevice(input: {
  deviceId: string;
  workspaceId: string;
  accountId: string;
  installationId?: string | null;
  platform: CloudDevicePlatform;
  deviceLabel: string;
  status?: CloudDeviceStatus;
  proofKeyId: string;
  proofPublicKey: string;
  proofAlgorithm?: ProofOfPossessionAlgorithm;
  attestationFormat?: string | null;
  metadata?: Record<string, unknown>;
  lastSeenAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}): AccountDevice {
  const createdAt = isoTime(input.createdAt);
  const updatedAt = isoTime(input.updatedAt ?? createdAt);
  return {
    schemaVersion: OIDC_DEVICE_SCHEMA_VERSION,
    deviceId: requiredText(input.deviceId, 'device_id'),
    workspaceId: requiredText(input.workspaceId, 'workspace_id'),
    accountId: requiredText(input.accountId, 'account_id'),
    installationId: optionalText(input.installationId),
    platform: input.platform,
    deviceLabel: requiredText(input.deviceLabel, 'device_label'),
    status: input.status ?? 'active',
    proofKeyId: requiredText(input.proofKeyId, 'proof_key_id'),
    proofPublicKey: requiredText(input.proofPublicKey, 'proof_public_key'),
    proofAlgorithm: input.proofAlgorithm ?? 'ES256',
    attestationFormat: optionalText(input.attestationFormat),
    metadata: sanitizeObject(input.metadata),
    lastSeenAt: optionalIsoTime(input.lastSeenAt),
    createdAt,
    updatedAt,
  };
}

export function buildProofOfPossessionContract(input: ProofOfPossessionContractInput): ProofOfPossessionContract {
  const algorithm = input.algorithm ?? 'ES256';
  const contract = {
    workspaceId: requiredText(input.workspaceId, 'workspace_id'),
    accountId: requiredText(input.accountId, 'account_id'),
    sessionId: requiredText(input.sessionId, 'session_id'),
    deviceId: requiredText(input.deviceId, 'device_id'),
    installationId: optionalText(input.installationId),
    issuer: normalizeIssuer(input.issuer),
    subject: requiredText(input.subject, 'subject'),
    keyId: requiredText(input.keyId, 'proof_key_id'),
    publicKey: requiredText(input.publicKey, 'proof_public_key'),
    algorithm,
    proofHeader: 'DPoP' as const,
    nonceTtlSeconds: positiveInt(input.nonceTtlSeconds ?? 300, 'nonce_ttl_seconds'),
    clockSkewSeconds: positiveInt(input.clockSkewSeconds ?? 60, 'clock_skew_seconds'),
  };
  return {
    schemaVersion: PROOF_OF_POSSESSION_SCHEMA_VERSION,
    bindingId: sha256Canonical(contract),
    ...contract,
  };
}

export function createAccountSession(input: {
  sessionId: string;
  workspaceId: string;
  accountId: string;
  deviceId: string;
  installationId?: string | null;
  issuer: string;
  subject: string;
  status?: CloudSessionStatus;
  authFlow?: CloudAuthFlow;
  scope?: string;
  refreshFamilyId?: string | null;
  claims?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
  accessExpiresAt?: string | null;
  refreshExpiresAt?: string | null;
  lastProofAt?: string | null;
  proofBinding: ProofOfPossessionContractInput | ProofOfPossessionContract;
}): AccountSession {
  const createdAt = isoTime(input.createdAt);
  const updatedAt = isoTime(input.updatedAt ?? createdAt);
  const proofBinding = 'bindingId' in input.proofBinding
    ? input.proofBinding
    : buildProofOfPossessionContract(input.proofBinding);
  const session: AccountSession = {
    schemaVersion: OIDC_SESSION_SCHEMA_VERSION,
    sessionId: requiredText(input.sessionId, 'session_id'),
    workspaceId: requiredText(input.workspaceId, 'workspace_id'),
    accountId: requiredText(input.accountId, 'account_id'),
    deviceId: requiredText(input.deviceId, 'device_id'),
    installationId: optionalText(input.installationId),
    issuer: normalizeIssuer(input.issuer),
    subject: requiredText(input.subject, 'subject'),
    status: input.status ?? 'active',
    authFlow: input.authFlow ?? 'oidc_code_pkce',
    scope: normalizeScope(input.scope),
    proofBinding,
    refreshFamilyId: optionalText(input.refreshFamilyId),
    claims: sanitizeObject(input.claims),
    createdAt,
    updatedAt,
    accessExpiresAt: optionalIsoTime(input.accessExpiresAt),
    refreshExpiresAt: optionalIsoTime(input.refreshExpiresAt),
    lastProofAt: optionalIsoTime(input.lastProofAt),
  };
  assertProofOfPossessionBinding(session, null);
  return session;
}

export function assertProofOfPossessionBinding(session: AccountSession, device: AccountDevice | null): true {
  const binding = session.proofBinding;
  if (binding.workspaceId !== session.workspaceId) throw new Error('proof_of_possession_workspace_mismatch');
  if (binding.accountId !== session.accountId) throw new Error('proof_of_possession_account_mismatch');
  if (binding.sessionId !== session.sessionId) throw new Error('proof_of_possession_session_mismatch');
  if (binding.deviceId !== session.deviceId) throw new Error('proof_of_possession_device_mismatch');
  if (binding.issuer !== session.issuer) throw new Error('proof_of_possession_issuer_mismatch');
  if (binding.subject !== session.subject) throw new Error('proof_of_possession_subject_mismatch');
  if (binding.installationId !== session.installationId) throw new Error('proof_of_possession_installation_mismatch');
  if (binding.keyId !== session.proofBinding.keyId) throw new Error('proof_of_possession_key_mismatch');
  if (device) {
    if (device.workspaceId !== session.workspaceId) throw new Error('account_device_workspace_mismatch');
    if (device.accountId !== session.accountId) throw new Error('account_device_account_mismatch');
    if (device.deviceId !== session.deviceId) throw new Error('account_device_session_mismatch');
    if (device.installationId !== session.installationId) throw new Error('account_device_installation_mismatch');
    if (device.proofKeyId !== binding.keyId) throw new Error('account_device_proof_key_mismatch');
    if (device.proofPublicKey !== binding.publicKey) throw new Error('account_device_proof_public_key_mismatch');
    if (device.proofAlgorithm !== binding.algorithm) throw new Error('account_device_proof_alg_mismatch');
  }
  return true;
}

export function summarizeAccountAuthState(input: {
  account: Pick<OidcAccount, 'email' | 'displayName' | 'status'> | null;
  devices: ReadonlyArray<Pick<AccountDevice, 'status'>>;
  sessions: ReadonlyArray<Pick<AccountSession, 'status'>>;
}): AccountAuthSummary {
  const account = input.account;
  const activeDeviceCount = input.devices.filter((device) => device.status === 'active').length;
  const activeSessionCount = input.sessions.filter((session) => session.status === 'active').length;
  const accountLabel = account?.displayName?.trim() || account?.email?.trim() || 'No account linked';
  const deviceLabel = activeDeviceCount === 1 ? '1 active device' : `${activeDeviceCount} active devices`;
  const sessionLabel = activeSessionCount === 1 ? '1 active session' : `${activeSessionCount} active sessions`;

  if (!account) {
    return {
      mode: 'local_only',
      headline: 'Local-only mode',
      detail: 'No cloud account is linked. Food keeps working on this device.',
      accountLabel,
      deviceLabel,
      sessionLabel,
      activeDeviceCount,
      activeSessionCount,
    };
  }

  if (account.status !== 'active' || activeDeviceCount === 0 || activeSessionCount === 0) {
    return {
      mode: 'attention',
      headline: 'Account needs attention',
      detail: account.status !== 'active'
        ? `Account is ${account.status.replace('_', ' ')}.`
        : activeDeviceCount === 0
          ? 'No active devices are registered.'
          : 'No active sessions are registered.',
      accountLabel,
      deviceLabel,
      sessionLabel,
      activeDeviceCount,
      activeSessionCount,
    };
  }

  return {
    mode: 'connected',
    headline: 'Cloud account connected',
    detail: 'Account and device auth are active for this workspace.',
    accountLabel,
    deviceLabel,
    sessionLabel,
    activeDeviceCount,
    activeSessionCount,
  };
}

export function describeAccountDevice(device: Pick<AccountDevice, 'deviceLabel' | 'platform' | 'status' | 'lastSeenAt'>, sessionCount = 0): string {
  const status = device.status.replace('_', ' ');
  const seen = device.lastSeenAt ? `Last seen ${device.lastSeenAt}` : 'Never seen';
  const sessions = sessionCount === 1 ? '1 session' : `${sessionCount} sessions`;
  return `${device.platform} - ${status} - ${sessions} - ${seen}`;
}

function normalizeIssuer(value: string) {
  const trimmed = requiredText(value, 'issuer');
  return trimmed.replace(/\/+$/, '');
}

function normalizeScope(value?: string | null) {
  const scope = optionalText(value) ?? 'openid';
  return scope.split(/\s+/).filter(Boolean).join(' ');
}

function sanitizeObject(value?: Record<string, unknown>) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function requiredText(value: string, name: string) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) throw new Error(`${name}_required`);
  return trimmed;
}

function optionalText(value?: string | null) {
  const trimmed = String(value ?? '').trim();
  return trimmed ? trimmed : null;
}

function isoTime(value?: string | null) {
  const normalized = optionalText(value) ?? new Date().toISOString();
  if (Number.isNaN(Date.parse(normalized))) throw new Error('timestamp_invalid');
  return normalized;
}

function optionalIsoTime(value?: string | null) {
  const normalized = optionalText(value);
  if (normalized == null) return null;
  if (Number.isNaN(Date.parse(normalized))) throw new Error('timestamp_invalid');
  return normalized;
}

function positiveInt(value: number, name: string) {
  const normalized = Math.trunc(Number(value));
  if (!Number.isFinite(normalized) || normalized <= 0) throw new Error(`${name}_invalid`);
  return normalized;
}
