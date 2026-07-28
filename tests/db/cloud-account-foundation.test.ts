import { afterEach, describe, expect, it } from 'vitest';

import { DATABASE_VERSION, runMigrations } from '@/src/db/migrations';
import { NodeSqliteDb } from '@/tests/helpers/node-sqlite-db';

describe('cloud account foundation persistence', () => {
  const dbs: NodeSqliteDb[] = [];

  afterEach(() => {
    for (const db of dbs.splice(0)) db.close();
  });

  it('creates oidc account, device, and session tables with portable constraints', async () => {
    const db = new NodeSqliteDb();
    dbs.push(db);
    await runMigrations(db as any);

    expect(await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version')).toEqual({ user_version: DATABASE_VERSION });

    await db.runAsync(
      `INSERT INTO workspaces (id, label, created_at, updated_at) VALUES (?, ?, ?, ?)`,
      ['workspace-a', 'Workspace A', '2026-07-28T00:00:00.000Z', '2026-07-28T00:00:00.000Z'],
    );
    await db.runAsync(
      `INSERT INTO app_installations (installation_id, workspace_id, app_name, status, launch_path, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ['install-a', 'workspace-a', 'Portable App', 'active', '/apps/install-a', '2026-07-28T00:00:00.000Z', '2026-07-28T00:00:00.000Z'],
    );
    await db.runAsync(
      `INSERT INTO cloud_accounts (
        account_id, workspace_id, issuer, subject, email, email_verified, display_name, status, profile_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['acct-a', 'workspace-a', 'https://issuer.example.test', 'subject-a', 'a@example.test', 1, 'User A', 'active', '{"locale":"en-US"}', '2026-07-28T00:00:00.000Z', '2026-07-28T00:00:00.000Z'],
    );
    await db.runAsync(
      `INSERT INTO cloud_devices (
        device_id, workspace_id, account_id, app_installation_id, platform, device_label, status, proof_key_id, proof_public_key, proof_alg, attestation_format, metadata_json, last_seen_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['device-a', 'workspace-a', 'acct-a', 'install-a', 'ios', 'iPhone', 'active', 'kid-a', 'pubkey-a', 'ES256', 'none', '{"build":"1.0.0"}', '2026-07-28T00:00:00.000Z', '2026-07-28T00:00:00.000Z', '2026-07-28T00:00:00.000Z'],
    );
    await db.runAsync(
      `INSERT INTO cloud_sessions (
        session_id, workspace_id, account_id, device_id, app_installation_id, issuer, subject, status, auth_flow, scope, proof_binding_id, proof_key_id, proof_alg, refresh_family_id, claims_json, created_at, updated_at, access_expires_at, refresh_expires_at, last_proof_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['sess-a', 'workspace-a', 'acct-a', 'device-a', 'install-a', 'https://issuer.example.test', 'subject-a', 'active', 'oidc_code_pkce', 'openid profile', 'binding-a', 'kid-a', 'ES256', 'family-a', '{"amr":["pwd"]}', '2026-07-28T00:00:00.000Z', '2026-07-28T00:00:00.000Z', '2026-07-28T01:00:00.000Z', '2026-07-29T00:00:00.000Z', '2026-07-28T00:10:00.000Z'],
    );

    expect(await db.getFirstAsync<{ total: number }>('SELECT COUNT(*) AS total FROM cloud_accounts')).toEqual({ total: 1 });
    expect(await db.getFirstAsync<{ total: number }>('SELECT COUNT(*) AS total FROM cloud_devices WHERE account_id = ?', ['acct-a'])).toEqual({ total: 1 });
    expect(await db.getFirstAsync<{ total: number }>('SELECT COUNT(*) AS total FROM cloud_sessions WHERE device_id = ?', ['device-a'])).toEqual({ total: 1 });
    await expect(db.runAsync(
      `INSERT INTO cloud_accounts (
        account_id, workspace_id, issuer, subject, email, email_verified, display_name, status, profile_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['acct-a-2', 'workspace-a', 'https://issuer.example.test', 'subject-a', 'b@example.test', 0, 'User B', 'active', '{}', '2026-07-28T00:00:00.000Z', '2026-07-28T00:00:00.000Z'],
    )).rejects.toThrow(/UNIQUE|constraint/i);
  });
});
