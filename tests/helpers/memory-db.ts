import { DEFAULT_APP_INSTALLATION_ID } from '@/packages/shared/contracts/app-installation';

type Row = Record<string, any>;

export class MemoryDb {
  records = new Map<string, Row>();
  recordRelations: Row[] = [];
  operations = new Map<string, Row>();
  conflicts = new Map<string, Row>();
  providerLinks = new Map<string, Row>();
  sourceSnapshots = new Map<string, Row>();
  sourceSnapshotRelations: Row[] = [];
  outbox = new Map<string, Row>();
  workflowRuns = new Map<string, Row>();
  workspaces = new Map<string, Row>();
  appInstallations = new Map<string, Row>();
  appPackages = new Map<string, Row>();
  appInstallationPackageState = new Map<string, Row>();
  appPackageState: Row | null = null;
  appPackageReceipts: Row[] = [];

  async execAsync(_sql: string) {}

  async withTransactionAsync(fn: () => Promise<void>) {
    const snapshot = this.snapshot();
    try {
      await fn();
    } catch (error) {
      this.restore(snapshot);
      throw error;
    }
  }

  async runAsync(sql: string, params: any[] = []) {
    const compact = sql.replace(/\s+/g, ' ').trim();
    if (compact.startsWith('INSERT INTO records')) {
      const [app_installation_id, id, domain, collection, title, properties, source_provider, source_external_id, source_url, source_observed_at, source_content_hash, archived_at, created_at, updated_at, revision, schema_version, deleted, privacy, provenance_json] = params;
      this.records.set(recordKey(app_installation_id, id), { app_installation_id, id, domain, collection, title, properties, source_provider, source_external_id, source_url, source_observed_at, source_content_hash, archived_at, created_at, updated_at, revision, schema_version, deleted, privacy, provenance_json });
      return;
    }
    if (compact === 'DELETE FROM record_relations WHERE app_installation_id = ? AND from_id = ?') {
      this.recordRelations = this.recordRelations.filter((row) => !(row.app_installation_id === params[0] && row.from_id === params[1]));
      return;
    }
    if (compact.startsWith('INSERT INTO record_relations')) {
      const [app_installation_id, from_id, collection, name, target_id, target_domain, target_collection, created_at] = params;
      this.recordRelations = this.recordRelations.filter((row) => !(row.app_installation_id === app_installation_id && row.from_id === from_id && row.name === name && row.target_id === target_id));
      this.recordRelations.push({ app_installation_id, from_id, collection, name, target_id, target_domain, target_collection, created_at });
      return;
    }
    if (compact.startsWith('INSERT INTO operations')) {
      const [op_id, app_installation_id, kind, domain, collection, record_id, expected_revision, result_revision, actor, origin, idempotency_key, changes_json, before_json, after_json, inverse_op_id, status, reject_reason, created_at] = params;
      this.operations.set(op_id, { op_id, app_installation_id, kind, domain, collection, record_id, expected_revision, result_revision, actor, origin, idempotency_key, changes_json, before_json, after_json, inverse_op_id, status, reject_reason, created_at });
      return;
    }
    if (compact === 'UPDATE records SET properties = $properties WHERE app_installation_id = $installation_id AND id = $id') {
      const row = normalizeParams(params);
      const record = this.records.get(recordKey(row.$installation_id, row.$id));
      if (record) record.properties = row.$properties;
      return;
    }
    if (compact === 'UPDATE operations SET status = ? WHERE app_installation_id = ? AND op_id = ?') {
      const [status, appInstallationId, opId] = params;
      const row = this.operations.get(opId);
      if (row && row.app_installation_id === appInstallationId) row.status = status;
      return;
    }
    if (compact.startsWith('INSERT INTO sync_conflicts')) {
      const [id, domain, collection, record_id, provider, external_id, fields_json, base_json, local_json, remote_json, status, resolution_op_id, created_at, resolved_at] = params;
      this.conflicts.set(id, { id, domain, collection, record_id, provider, external_id, fields_json, base_json, local_json, remote_json, status, resolution_op_id, created_at, resolved_at });
      return;
    }
    if (compact === 'UPDATE sync_conflicts SET status = ?, resolution_op_id = ?, resolved_at = ? WHERE id = ?') {
      const [status, resolution_op_id, resolved_at, id] = params;
      const row = this.conflicts.get(id);
      if (row) {
        row.status = status;
        row.resolution_op_id = resolution_op_id;
        row.resolved_at = resolved_at;
      }
      return;
    }
    if (compact.startsWith('INSERT INTO provider_links')) {
      const [id, provider, external_id, name, status, freshness, workspace, url, created_at, updated_at] = params;
      this.providerLinks.set(id, { id, provider, external_id, name, status, freshness, workspace, url, created_at, updated_at });
      return;
    }
    if (compact.startsWith('INSERT INTO source_snapshots')) {
      const [id, provider, external_id, scope, observed_at, payload_json, checksum, created_at, updated_at] = params;
      this.sourceSnapshots.set(id, { id, provider, external_id, scope, observed_at, payload_json, checksum, created_at, updated_at });
      return;
    }
    if (compact.startsWith('INSERT OR IGNORE INTO source_snapshot_relations')) {
      const [snapshot_id, record_id] = params;
      if (!this.sourceSnapshotRelations.some((row) => row.snapshot_id === snapshot_id && row.record_id === record_id)) {
        this.sourceSnapshotRelations.push({ snapshot_id, record_id });
      }
      return;
    }
    if (compact.startsWith('INSERT INTO outbox_events')) {
      const [id, app_installation_id, action_key, domain, payload_json, status, created_at, updated_at] = params;
      this.outbox.set(id, { id, app_installation_id, action_key, domain, payload_json, status, attempts: 0, last_error: null, created_at, updated_at });
      return;
    }
    if (compact === 'UPDATE outbox_events SET status = ?, last_error = ?, updated_at = ? WHERE id = ?') {
      const [status, last_error, updated_at, id] = params;
      const row = this.outbox.get(id);
      if (row) {
        row.status = status;
        row.last_error = last_error;
        row.updated_at = updated_at;
      }
      return;
    }
    if (compact === 'DELETE FROM outbox_events WHERE id = ?') {
      this.outbox.delete(params[0]);
      return;
    }
    if (compact === 'UPDATE outbox_events SET attempts = attempts + ?, status = ?, last_error = ?, updated_at = ? WHERE id = ?') {
      const [attemptsDelta, status, last_error, updated_at, id] = params;
      const row = this.outbox.get(id);
      if (row) {
        row.attempts = Number(row.attempts ?? 0) + Number(attemptsDelta ?? 0);
        row.status = status;
        row.last_error = last_error;
        row.updated_at = updated_at;
      }
      return;
    }
    if (compact.startsWith('INSERT INTO workflow_runs')) {
      const [id, domain, workflow_id, inputs_json, status, payload_json, created_at, updated_at] = params;
      this.workflowRuns.set(id, { id, domain, workflow_id, inputs_json, status, payload_json, created_at, updated_at });
      return;
    }
    if (compact.startsWith('INSERT OR REPLACE INTO app_packages')) {
      const row = normalizeParams(params);
      this.appPackages.set(row.$package_key, {
        package_key: row.$package_key,
        package_id: row.$package_id,
        version: row.$version,
        payload_json: row.$payload_json,
        created_at: row.$created_at,
        updated_at: row.$updated_at,
      });
      return;
    }
    if (compact.startsWith('INSERT OR IGNORE INTO workspaces')) {
      const row = normalizeParams(params);
      if (!this.workspaces.has(row.$id)) {
        this.workspaces.set(row.$id, {
          id: row.$id,
          label: row.$label,
          created_at: row.$created_at,
          updated_at: row.$updated_at,
        });
      }
      return;
    }
    if (compact.startsWith('INSERT OR REPLACE INTO app_installations') || compact.startsWith('INSERT INTO app_installations')) {
      const row = normalizeParams(params);
      const installationId = row.$installation_id ?? row.$id;
      if (compact.startsWith('INSERT INTO app_installations') && this.appInstallations.has(installationId)) {
        throw new Error('UNIQUE constraint failed: app_installations.installation_id');
      }
      this.appInstallations.set(installationId, {
        installation_id: installationId,
        workspace_id: row.$workspace_id ?? 'default-workspace',
        app_name: row.$app_name ?? row.$label,
        status: row.$status ?? 'active',
        package_key: row.$package_key ?? null,
        package_id: row.$package_id ?? null,
        version: row.$version ?? null,
        source_url: row.$source_url ?? null,
        checksum: row.$checksum ?? null,
        launch_path: row.$launch_path ?? null,
        approval_hash: row.$approval_hash ?? null,
        approved_by: row.$approved_by ?? null,
        created_at: row.$created_at,
        updated_at: row.$updated_at,
      });
      return;
    }
    if (compact.startsWith('INSERT OR REPLACE INTO app_installation_package_state')) {
      const row = normalizeParams(params);
      this.appInstallationPackageState.set(row.$installation_id, {
        installation_id: row.$installation_id,
        active_package_key: row.$active_package_key,
        previous_package_key: row.$previous_package_key ?? null,
        updated_at: row.$updated_at,
      });
      return;
    }
    if (compact.startsWith('INSERT OR REPLACE INTO app_package_state')) {
      const row = normalizeParams(params);
      this.appPackageState = {
        id: 'default',
        active_package_key: row.$active_package_key,
        previous_package_key: row.$previous_package_key,
        active_installation_id: row.$active_installation_id ?? null,
        updated_at: row.$updated_at,
      };
      return;
    }
    if (compact.startsWith('INSERT INTO app_package_receipts')) {
      const row = normalizeParams(params);
      this.appPackageReceipts.push({
        id: row.$id,
        action: row.$action,
        package_key: row.$package_key,
        previous_package_key: row.$previous_package_key,
        created_at: row.$created_at,
        request_hash: row.$request_hash ?? null,
        package_hash: row.$package_hash ?? null,
        approval_hash: row.$approval_hash ?? null,
        approved_by: row.$approved_by ?? null,
      });
      return;
    }
    if (compact.startsWith('UPDATE workflow_runs SET')) {
      const id = params[params.length - 1];
      const row = this.workflowRuns.get(id);
      if (!row) return;
      if (compact.includes('status = ?')) {
        row.status = params[0];
      }
      if (compact.includes('payload_json = ?')) {
        const payloadIndex = compact.includes('status = ?') ? 1 : 0;
        row.payload_json = params[payloadIndex];
      }
      row.updated_at = params[params.length - 2];
      return;
    }
    throw new Error(`Unsupported runAsync SQL: ${compact}`);
  }

  async getFirstAsync<T>(sql: string, params: any[] = []): Promise<T | null> {
    const compact = sql.replace(/\s+/g, ' ').trim();
    if (compact === 'SELECT * FROM records WHERE app_installation_id = ? AND id = ?') {
      return (this.records.get(recordKey(params[0], params[1])) ?? null) as T | null;
    }
    if (compact === 'SELECT op_id, app_installation_id, after_json, status FROM operations WHERE app_installation_id = ? AND idempotency_key = ?') {
      const row = Array.from(this.operations.values()).find((item) => item.app_installation_id === params[0] && item.idempotency_key === params[1]);
      return (row ? { op_id: row.op_id, app_installation_id: row.app_installation_id, after_json: row.after_json, status: row.status } : null) as T | null;
    }
    if (compact === 'SELECT * FROM operations WHERE app_installation_id = ? AND op_id = ?') {
      const row = this.operations.get(params[1]);
      return (row?.app_installation_id === params[0] ? row : null) as T | null;
    }
    if (compact === 'SELECT * FROM sync_conflicts WHERE id = ?') {
      return (this.conflicts.get(params[0]) ?? null) as T | null;
    }
    if (compact === 'SELECT * FROM source_snapshots WHERE provider = ? AND external_id = ? ORDER BY observed_at DESC LIMIT 1') {
      const rows = Array.from(this.sourceSnapshots.values())
        .filter((row) => row.provider === params[0] && row.external_id === params[1])
        .sort((left, right) => String(right.observed_at).localeCompare(String(left.observed_at)));
      return (rows[0] ?? null) as T | null;
    }
    if (compact === 'SELECT * FROM outbox_events WHERE action_key = ? ORDER BY created_at DESC LIMIT 1') {
      const rows = Array.from(this.outbox.values())
        .filter((row) => row.action_key === params[0])
        .sort((left, right) => String(right.created_at).localeCompare(String(left.created_at)));
      return (rows[0] ?? null) as T | null;
    }
    if (compact === 'SELECT * FROM workflow_runs WHERE id = ?') {
      return (this.workflowRuns.get(params[0]) ?? null) as T | null;
    }
    if (compact === "SELECT active_package_key, previous_package_key FROM app_package_state WHERE id = 'default'"
      || compact === "SELECT active_package_key, previous_package_key, active_installation_id FROM app_package_state WHERE id = 'default'") {
      return (this.appPackageState ? {
        active_package_key: this.appPackageState.active_package_key,
        previous_package_key: this.appPackageState.previous_package_key,
        active_installation_id: this.appPackageState.active_installation_id ?? null,
      } : null) as T | null;
    }
    if (compact === 'SELECT active_package_key, previous_package_key FROM app_installation_package_state WHERE installation_id = $installation_id') {
      const row = this.appInstallationPackageState.get(normalizeParams(params).$installation_id);
      return (row ? {
        active_package_key: row.active_package_key,
        previous_package_key: row.previous_package_key,
      } : null) as T | null;
    }
    if (compact === 'SELECT installation_id, workspace_id, app_name, status, created_at, updated_at FROM app_installations WHERE installation_id = $installation_id') {
      const row = this.appInstallations.get(normalizeParams(params).$installation_id);
      return (row ? {
        installation_id: row.installation_id,
        workspace_id: row.workspace_id,
        app_name: row.app_name,
        status: row.status,
        created_at: row.created_at,
        updated_at: row.updated_at,
      } : null) as T | null;
    }
    if (compact === "SELECT installation_id, workspace_id, app_name, status, created_at, updated_at FROM app_installations WHERE status = 'active' ORDER BY updated_at DESC LIMIT 1") {
      const rows = Array.from(this.appInstallations.values())
        .filter((row) => row.status === 'active')
        .sort((left, right) => String(right.updated_at).localeCompare(String(left.updated_at)));
      return (rows[0] ? { ...rows[0] } : null) as T | null;
    }
    if (compact === 'SELECT package_key, payload_json FROM app_packages WHERE package_key = $package_key') {
      const row = this.appPackages.get(normalizeParams(params).$package_key);
      return (row ? { package_key: row.package_key, payload_json: row.payload_json } : null) as T | null;
    }
    if (compact === 'SELECT payload_json FROM app_packages WHERE package_key = $package_key') {
      const row = this.appPackages.get(normalizeParams(params).$package_key);
      return (row ? { payload_json: row.payload_json } : null) as T | null;
    }
    if (compact === 'SELECT COUNT(*) as count FROM app_packages') {
      return { count: this.appPackages.size } as T;
    }
    throw new Error(`Unsupported getFirstAsync SQL: ${compact}`);
  }

  async getAllAsync<T>(sql: string, params: any[] = []): Promise<T[]> {
    const compact = sql.replace(/\s+/g, ' ').trim();
    if (compact === 'SELECT name, target_id FROM record_relations WHERE app_installation_id = ? AND from_id = ?') {
      return this.recordRelations.filter((row) => row.app_installation_id === params[0] && row.from_id === params[1]).map((row) => ({ name: row.name, target_id: row.target_id })) as T[];
    }
    if (compact === 'SELECT * FROM sync_conflicts WHERE status = ? ORDER BY created_at DESC') {
      return Array.from(this.conflicts.values())
        .filter((row) => row.status === params[0])
        .sort((left, right) => String(right.created_at).localeCompare(String(left.created_at))) as T[];
    }
    if (compact === 'SELECT * FROM workflow_runs WHERE domain = ? ORDER BY updated_at DESC') {
      return Array.from(this.workflowRuns.values())
        .filter((row) => row.domain === params[0])
        .sort((left, right) => String(right.updated_at).localeCompare(String(left.updated_at))) as T[];
    }
    if (compact === 'SELECT * FROM provider_links ORDER BY updated_at DESC') {
      return Array.from(this.providerLinks.values())
        .sort((left, right) => String(right.updated_at).localeCompare(String(left.updated_at))) as T[];
    }
    if (compact === 'SELECT * FROM outbox_events ORDER BY updated_at ASC') {
      return Array.from(this.outbox.values()).sort((left, right) => String(left.updated_at).localeCompare(String(right.updated_at))) as T[];
    }
    if (compact === 'SELECT * FROM outbox_events WHERE status = ? ORDER BY updated_at ASC') {
      return Array.from(this.outbox.values())
        .filter((row) => row.status === params[0])
        .sort((left, right) => String(left.updated_at).localeCompare(String(right.updated_at))) as T[];
    }
    if (compact === 'SELECT * FROM outbox_events WHERE status = ? AND action_key LIKE ? ORDER BY updated_at ASC') {
      const [status, actionKeyLike] = params;
      const prefix = String(actionKeyLike ?? '').replace(/%$/, '');
      return Array.from(this.outbox.values())
        .filter((row) => row.status === status && row.action_key.startsWith(prefix))
        .sort((left, right) => String(left.updated_at).localeCompare(String(right.updated_at))) as T[];
    }
    if (compact === 'SELECT * FROM outbox_events WHERE action_key LIKE ? ORDER BY updated_at ASC') {
      const [actionKeyLike] = params;
      const prefix = String(actionKeyLike ?? '').replace(/%$/, '');
      return Array.from(this.outbox.values())
        .filter((row) => row.action_key.startsWith(prefix))
        .sort((left, right) => String(left.updated_at).localeCompare(String(right.updated_at))) as T[];
    }
    if (compact === 'SELECT installation_id, workspace_id, app_name, status, created_at, updated_at FROM app_installations WHERE workspace_id = $workspace_id ORDER BY created_at ASC, installation_id ASC') {
      return Array.from(this.appInstallations.values())
        .filter((row) => row.workspace_id === normalizeParams(params).$workspace_id)
        .sort((left, right) => `${left.created_at}:${left.installation_id}`.localeCompare(`${right.created_at}:${right.installation_id}`))
        .map((row) => ({
          installation_id: row.installation_id,
          workspace_id: row.workspace_id,
          app_name: row.app_name,
          status: row.status,
          created_at: row.created_at,
          updated_at: row.updated_at,
        })) as T[];
    }
    if (compact === 'SELECT id, collection, properties FROM records WHERE app_installation_id = $installation_id ORDER BY collection ASC, id ASC') {
      const installationId = normalizeParams(params).$installation_id;
      return Array.from(this.records.values())
        .filter((row) => row.app_installation_id === installationId)
        .sort((left, right) => `${left.collection}:${left.id}`.localeCompare(`${right.collection}:${right.id}`))
        .map((row) => ({
          id: row.id,
          collection: row.collection,
          properties: row.properties,
        })) as T[];
    }
    throw new Error(`Unsupported getAllAsync SQL: ${compact}`);
  }

  private snapshot() {
    return {
      records: new Map(this.records),
      recordRelations: this.recordRelations.map((row) => ({ ...row })),
      operations: new Map(this.operations),
      conflicts: new Map(this.conflicts),
      providerLinks: new Map(this.providerLinks),
      sourceSnapshots: new Map(this.sourceSnapshots),
      sourceSnapshotRelations: this.sourceSnapshotRelations.map((row) => ({ ...row })),
      outbox: new Map(this.outbox),
      workflowRuns: new Map(this.workflowRuns),
      workspaces: new Map(this.workspaces),
      appInstallations: new Map(this.appInstallations),
      appPackages: new Map(this.appPackages),
      appInstallationPackageState: new Map(this.appInstallationPackageState),
      appPackageState: this.appPackageState ? { ...this.appPackageState } : null,
      appPackageReceipts: this.appPackageReceipts.map((row) => ({ ...row })),
    };
  }

  private restore(snapshot: ReturnType<MemoryDb['snapshot']>) {
    this.records = new Map(snapshot.records);
    this.recordRelations = snapshot.recordRelations.map((row) => ({ ...row }));
    this.operations = new Map(snapshot.operations);
    this.conflicts = new Map(snapshot.conflicts);
    this.providerLinks = new Map(snapshot.providerLinks);
    this.sourceSnapshots = new Map(snapshot.sourceSnapshots);
    this.sourceSnapshotRelations = snapshot.sourceSnapshotRelations.map((row) => ({ ...row }));
    this.outbox = new Map(snapshot.outbox);
    this.workflowRuns = new Map(snapshot.workflowRuns);
    this.workspaces = new Map(snapshot.workspaces);
    this.appInstallations = new Map(snapshot.appInstallations);
    this.appPackages = new Map(snapshot.appPackages);
    this.appInstallationPackageState = new Map(snapshot.appInstallationPackageState);
    this.appPackageState = snapshot.appPackageState ? { ...snapshot.appPackageState } : null;
    this.appPackageReceipts = snapshot.appPackageReceipts.map((row) => ({ ...row }));
  }
}

function normalizeParams(params: unknown): Record<string, any> {
  return params && typeof params === 'object' && !Array.isArray(params) ? params as Record<string, any> : {};
}

function recordKey(appInstallationId: string | null | undefined, recordId: string) {
  const scope = appInstallationId?.trim() || DEFAULT_APP_INSTALLATION_ID;
  return scope === DEFAULT_APP_INSTALLATION_ID ? recordId : `${scope}:${recordId}`;
}
