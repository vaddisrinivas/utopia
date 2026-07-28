#!/usr/bin/env node

import { createHmac, timingSafeEqual } from 'node:crypto';

const DEVICE_ACK = 'DISPOSABLE_EMULATOR_ONLY';
const unsafeLabel = /(^|[-_:])(prod|production|personal|primary|default|real)([-_:]|$)/i;

function required(env, names, label) {
  for (const name of names) {
    const value = env[name]?.trim();
    if (value) return value;
  }
  throw new Error(`set ${label}`);
}

export function providerAuthorizationDigest(provider, targetId, accountId, authorizationKey) {
  if (typeof authorizationKey !== 'string' || authorizationKey.length < 32) {
    throw new Error('provider authorization key must contain at least 32 characters');
  }
  return createHmac('sha256', authorizationKey)
    .update(JSON.stringify({
      schemaVersion: 'utopia.disposable-provider-authorization.v1',
      provider,
      targetId,
      accountId,
    }))
    .digest('hex');
}

function providerBinding(provider, env) {
  if (provider === 'notion') {
    return {
      targetId: required(env, ['NOTION_TEST_PAGE_ID'], 'NOTION_TEST_PAGE_ID'),
      accountId: required(env, ['NOTION_TEST_ACCOUNT_ID', 'NOTION_WORKSPACE_ID'], 'NOTION_TEST_ACCOUNT_ID'),
    };
  }
  if (provider === 'sheets' || provider === 'google-sheets') {
    return {
      targetId: required(env, ['GOOGLE_SHEETS_TEST_SPREADSHEET_ID'], 'GOOGLE_SHEETS_TEST_SPREADSHEET_ID'),
      accountId: required(env, ['GOOGLE_SHEETS_TEST_ACCOUNT_ID', 'GOOGLE_ACCOUNT_ID'], 'GOOGLE_SHEETS_TEST_ACCOUNT_ID'),
    };
  }
  if (provider === 'postgres') {
    return {
      targetId: required(env, ['POSTGRES_TEST_HOUSEHOLD_ID', 'WONDERFOOD_POSTGRES_HOUSEHOLD_ID'], 'POSTGRES_TEST_HOUSEHOLD_ID'),
      accountId: required(env, ['POSTGRES_TEST_API_ROOT', 'WONDERFOOD_POSTGRES_API_ROOT'], 'POSTGRES_TEST_API_ROOT'),
    };
  }
  if (provider === 'local-postgres') {
    return {
      targetId: required(env, ['WONDERFOOD_LOCAL_POSTGRES_DB'], 'WONDERFOOD_LOCAL_POSTGRES_DB'),
      accountId: 'local-loopback',
    };
  }
  throw new Error('provider kind must be notion, sheets, postgres, or local-postgres');
}

export function validateDisposableLane(lane, env = process.env, provider = '') {
  if (lane === 'provider') {
    const normalizedProvider = provider.trim().toLowerCase();
    const { targetId, accountId } = providerBinding(normalizedProvider, env);
    const authorizationKey = required(
      env,
      ['WONDERFOOD_DISPOSABLE_PROVIDER_AUTHORIZATION_KEY'],
      'WONDERFOOD_DISPOSABLE_PROVIDER_AUTHORIZATION_KEY',
    );
    const digest = providerAuthorizationDigest(normalizedProvider, targetId, accountId, authorizationKey);
    const expected = `DISPOSABLE_PROVIDER_ONLY:hmac-sha256:${digest}`;
    const providerAckName = `WONDERFOOD_LIVE_PROVIDER_ACK_${normalizedProvider.replace(/[^A-Z0-9]/gi, '_').toUpperCase()}`;
    const supplied = env[providerAckName] || env.WONDERFOOD_LIVE_PROVIDER_ACK || '';
    const matches = supplied.length === expected.length
      && timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
    if (!matches) {
      throw new Error(`provider authorization is not HMAC-bound to the exact ${normalizedProvider} target and account`);
    }
    return;
  }

  if (lane === 'device') {
    if (env.WONDERFOOD_DEVICE_MUTATION_ACK !== DEVICE_ACK) {
      throw new Error(`set WONDERFOOD_DEVICE_MUTATION_ACK=${DEVICE_ACK}`);
    }
    const serial = (env.LIFEOS_ANDROID_SERIAL || env.ANDROID_SERIAL || '').trim();
    const avd = env.LIFEOS_EMULATOR_AVD?.trim();
    if (!serial && !avd) throw new Error('set an explicit emulator serial or LIFEOS_EMULATOR_AVD');
    if (serial && !serial.startsWith('emulator-')) {
      throw new Error('physical devices are forbidden in the disposable device lane');
    }
    if (avd && unsafeLabel.test(avd)) throw new Error('emulator target label is not disposable');
    return;
  }

  throw new Error('lane must be provider or device');
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  try {
    validateDisposableLane(process.argv[2], process.env, process.argv[3]);
    console.log(`Disposable ${process.argv[2]} lane: authorized`);
  } catch (error) {
    console.error(`Disposable lane guard: BLOCKED (${error instanceof Error ? error.message : 'invalid configuration'}). No mutation attempted.`);
    process.exit(2);
  }
}
