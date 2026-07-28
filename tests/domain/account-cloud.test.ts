import { describe, expect, it } from 'vitest';

import {
  assertProofOfPossessionBinding,
  buildProofOfPossessionContract,
  createAccountDevice,
  createAccountSession,
  createOidcAccount,
  summarizeAccountAuthState,
} from '@/src/domain/account-cloud';

describe('account cloud foundation', () => {
  it('builds provider-neutral oidc account, device, and session contracts', () => {
    const account = createOidcAccount({
      accountId: 'acct-1',
      workspaceId: 'workspace-a',
      issuer: 'https://issuer.example.test/',
      subject: 'subject-123',
      email: 'user@example.test',
      emailVerified: true,
      displayName: 'Test User',
      profile: { locale: 'en-US' },
      createdAt: '2026-07-28T00:00:00.000Z',
    });
    const device = createAccountDevice({
      deviceId: 'device-1',
      workspaceId: account.workspaceId,
      accountId: account.accountId,
      installationId: 'install-1',
      platform: 'ios',
      deviceLabel: 'iPhone',
      proofKeyId: 'kid-1',
      proofPublicKey: 'pubkey-1',
      metadata: { build: '1.0.0' },
      createdAt: '2026-07-28T00:00:00.000Z',
    });
    const proofBinding = buildProofOfPossessionContract({
      workspaceId: account.workspaceId,
      accountId: account.accountId,
      sessionId: 'sess-1',
      deviceId: device.deviceId,
      installationId: device.installationId,
      issuer: account.issuer,
      subject: account.subject,
      keyId: device.proofKeyId,
      publicKey: device.proofPublicKey,
    });
    const session = createAccountSession({
      sessionId: 'sess-1',
      workspaceId: account.workspaceId,
      accountId: account.accountId,
      deviceId: device.deviceId,
      installationId: device.installationId,
      issuer: account.issuer,
      subject: account.subject,
      scope: 'openid profile email',
      proofBinding,
      claims: { amr: ['pwd'] },
      createdAt: '2026-07-28T00:00:00.000Z',
    });

    expect(account.issuer).toBe('https://issuer.example.test');
    expect(session.proofBinding.bindingId).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(session.scope).toBe('openid profile email');
    expect(assertProofOfPossessionBinding(session, device)).toBe(true);
  });

  it('rejects mismatched proof-of-possession bindings', () => {
    const device = createAccountDevice({
      deviceId: 'device-2',
      workspaceId: 'workspace-a',
      accountId: 'acct-1',
      installationId: 'install-2',
      platform: 'android',
      deviceLabel: 'Pixel',
      proofKeyId: 'kid-2',
      proofPublicKey: 'pubkey-2',
      createdAt: '2026-07-28T00:00:00.000Z',
    });
    const session = createAccountSession({
      sessionId: 'sess-2',
      workspaceId: 'workspace-a',
      accountId: 'acct-1',
      deviceId: 'different-device',
      installationId: 'install-2',
      issuer: 'https://issuer.example.test',
      subject: 'subject-2',
      proofBinding: {
        workspaceId: 'workspace-a',
        accountId: 'acct-1',
        sessionId: 'sess-2',
        deviceId: 'different-device',
        installationId: 'install-2',
        issuer: 'https://issuer.example.test',
        subject: 'subject-2',
        keyId: 'kid-2',
        publicKey: 'pubkey-2',
      },
      createdAt: '2026-07-28T00:00:00.000Z',
    });

    expect(() => assertProofOfPossessionBinding(session, device)).toThrow(/account_device_session_mismatch/);
  });

  it('summarizes local-only and connected account states for UI', () => {
    expect(summarizeAccountAuthState({
      account: null,
      devices: [],
      sessions: [],
    })).toMatchObject({
      mode: 'local_only',
      headline: 'Local-only mode',
      activeDeviceCount: 0,
      activeSessionCount: 0,
    });

    expect(summarizeAccountAuthState({
      account: { email: 'user@example.test', displayName: 'Test User', status: 'active' },
      devices: [{ status: 'active' }, { status: 'revoked' }],
      sessions: [{ status: 'active' }, { status: 'expired' }],
    })).toMatchObject({
      mode: 'connected',
      accountLabel: 'Test User',
      activeDeviceCount: 1,
      activeSessionCount: 1,
    });
  });
});
