export type CloudMetadataTable = Readonly<{
  name: 'cloud_accounts' | 'cloud_devices' | 'cloud_sessions';
  tenantKey: 'workspace_id';
  compositeKeys: readonly string[];
}>;

export type PostgresRlsPortabilityPlan = Readonly<{
  schemaName: string;
  authContextKey: string;
  accountSubjectConstraint: readonly ['workspace_id', 'issuer', 'subject'];
  tables: readonly CloudMetadataTable[];
  setLocalSql: string;
  resetLocalSql: string;
  policySql: Record<CloudMetadataTable['name'], string>;
}>;

type HarnessRow = {
  workspaceId: string;
  accountId: string;
};

type HarnessSession = HarnessRow & {
  sessionId: string;
  deviceId: string;
  status: string;
};

type HarnessDevice = HarnessRow & {
  deviceId: string;
  status: string;
};

export function createPostgresRlsPortabilityPlan(schemaName = 'utopia'): PostgresRlsPortabilityPlan {
  const normalizedSchema = schemaName.trim() || 'utopia';
  const authContextKey = `${normalizedSchema}.workspace_id`;
  return {
    schemaName: normalizedSchema,
    authContextKey,
    accountSubjectConstraint: ['workspace_id', 'issuer', 'subject'],
    tables: [
      { name: 'cloud_accounts', tenantKey: 'workspace_id', compositeKeys: ['workspace_id', 'issuer', 'subject'] },
      { name: 'cloud_devices', tenantKey: 'workspace_id', compositeKeys: ['workspace_id', 'account_id', 'proof_key_id'] },
      { name: 'cloud_sessions', tenantKey: 'workspace_id', compositeKeys: ['workspace_id', 'proof_binding_id'] },
    ],
    setLocalSql: `SELECT set_config('${authContextKey}', $1, true)`,
    resetLocalSql: `SELECT set_config('${authContextKey}', '', true)`,
    policySql: {
      cloud_accounts: rlsPolicy(normalizedSchema, 'cloud_accounts', authContextKey),
      cloud_devices: rlsPolicy(normalizedSchema, 'cloud_devices', authContextKey),
      cloud_sessions: rlsPolicy(normalizedSchema, 'cloud_sessions', authContextKey),
    },
  };
}

export function createDeterministicRlsHarness() {
  const accounts = new Map<string, HarnessRow>();
  const devices = new Map<string, HarnessDevice>();
  const sessions = new Map<string, HarnessSession>();
  let currentWorkspaceId: string | null = null;

  return {
    beginRequest(workspaceId: string) {
      currentWorkspaceId = requiredText(workspaceId, 'workspace_id');
    },
    clearRequest() {
      currentWorkspaceId = null;
    },
    insertAccount(row: HarnessRow) {
      accounts.set(row.accountId, { ...row, workspaceId: requiredText(row.workspaceId, 'workspace_id'), accountId: requiredText(row.accountId, 'account_id') });
    },
    insertDevice(row: HarnessDevice) {
      devices.set(row.deviceId, {
        ...row,
        workspaceId: requiredText(row.workspaceId, 'workspace_id'),
        accountId: requiredText(row.accountId, 'account_id'),
        deviceId: requiredText(row.deviceId, 'device_id'),
      });
    },
    insertSession(row: HarnessSession) {
      sessions.set(row.sessionId, {
        ...row,
        workspaceId: requiredText(row.workspaceId, 'workspace_id'),
        accountId: requiredText(row.accountId, 'account_id'),
        sessionId: requiredText(row.sessionId, 'session_id'),
        deviceId: requiredText(row.deviceId, 'device_id'),
      });
    },
    listSessionsForCurrentWorkspace() {
      const workspaceId = requireCurrentWorkspace(currentWorkspaceId);
      return Array.from(sessions.values()).filter((row) => row.workspaceId === workspaceId);
    },
    getAccountForCurrentWorkspace(accountId: string) {
      const workspaceId = requireCurrentWorkspace(currentWorkspaceId);
      const row = accounts.get(requiredText(accountId, 'account_id'));
      if (!row || row.workspaceId !== workspaceId) throw new Error('rls_row_not_visible');
      return row;
    },
    getDeviceForCurrentWorkspace(deviceId: string) {
      const workspaceId = requireCurrentWorkspace(currentWorkspaceId);
      const row = devices.get(requiredText(deviceId, 'device_id'));
      if (!row || row.workspaceId !== workspaceId) throw new Error('rls_row_not_visible');
      return row;
    },
    directSessionLookup(workspaceId: string, sessionId: string) {
      const activeWorkspaceId = requireCurrentWorkspace(currentWorkspaceId);
      if (activeWorkspaceId !== requiredText(workspaceId, 'workspace_id')) {
        throw new Error('rls_direct_query_forbidden');
      }
      const row = sessions.get(requiredText(sessionId, 'session_id'));
      if (!row || row.workspaceId !== activeWorkspaceId) throw new Error('rls_row_not_visible');
      return row;
    },
    assertRequestCleared() {
      if (currentWorkspaceId != null) throw new Error('rls_context_leak_detected');
      return true;
    },
  };
}

function rlsPolicy(schemaName: string, tableName: string, authContextKey: string) {
  return [
    `ALTER TABLE ${schemaName}.${tableName} ENABLE ROW LEVEL SECURITY`,
    `CREATE POLICY ${tableName}_tenant_isolation ON ${schemaName}.${tableName}`,
    `USING (workspace_id = current_setting('${authContextKey}', true))`,
    `WITH CHECK (workspace_id = current_setting('${authContextKey}', true))`,
  ].join(' ');
}

function requiredText(value: string, name: string) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) throw new Error(`${name}_required`);
  return trimmed;
}

function requireCurrentWorkspace(value: string | null) {
  if (!value) throw new Error('rls_context_missing');
  return value;
}
