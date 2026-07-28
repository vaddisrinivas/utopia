import { describe, expect, it } from 'vitest';

import { createDeterministicRlsHarness, createPostgresRlsPortabilityPlan } from '@/src/domain/cloud-portability';

describe('cloud portability foundation', () => {
  it('emits provider-neutral postgres and rls portability plan', () => {
    const plan = createPostgresRlsPortabilityPlan('utopia');

    expect(plan.setLocalSql).toContain("set_config('utopia.workspace_id'");
    expect(plan.policySql.cloud_sessions).toContain('ENABLE ROW LEVEL SECURITY');
    expect(plan.tables.map((table) => table.name)).toEqual([
      'cloud_accounts',
      'cloud_devices',
      'cloud_sessions',
    ]);
  });

  it('uses deterministic mocks to prove cross-tenant queries fail and pooled context resets', () => {
    const harness = createDeterministicRlsHarness();
    harness.insertAccount({ workspaceId: 'workspace-a', accountId: 'acct-a' });
    harness.insertAccount({ workspaceId: 'workspace-b', accountId: 'acct-b' });
    harness.insertDevice({ workspaceId: 'workspace-a', accountId: 'acct-a', deviceId: 'device-a', status: 'active' });
    harness.insertSession({ workspaceId: 'workspace-a', accountId: 'acct-a', deviceId: 'device-a', sessionId: 'sess-a', status: 'active' });
    harness.insertSession({ workspaceId: 'workspace-b', accountId: 'acct-b', deviceId: 'device-b', sessionId: 'sess-b', status: 'active' });

    harness.beginRequest('workspace-a');
    expect(harness.getAccountForCurrentWorkspace('acct-a')).toMatchObject({ accountId: 'acct-a' });
    expect(harness.listSessionsForCurrentWorkspace().map((row) => row.sessionId)).toEqual(['sess-a']);
    expect(() => harness.directSessionLookup('workspace-b', 'sess-b')).toThrow(/rls_direct_query_forbidden/);
    harness.clearRequest();
    expect(harness.assertRequestCleared()).toBe(true);
    expect(() => harness.listSessionsForCurrentWorkspace()).toThrow(/rls_context_missing/);
  });
});
