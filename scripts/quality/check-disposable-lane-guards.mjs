#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { providerAuthorizationDigest } from './require-disposable-lane.mjs';

const guard = fileURLToPath(new URL('./require-disposable-lane.mjs', import.meta.url));

function run(lane, extra = {}, provider) {
  return spawnSync(process.execPath, [guard, lane, ...(provider ? [provider] : [])], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH || '', ...extra },
  });
}

assert.equal(run('provider').status, 2);
assert.equal(run('device').status, 2);
const notionTarget = '11111111-2222-3333-4444-555555555555';
const notionAccount = 'workspace-fixture';
const authorizationKey = 'fixture-provider-authorization-key-32-characters';
const notionAck = `DISPOSABLE_PROVIDER_ONLY:hmac-sha256:${providerAuthorizationDigest('notion', notionTarget, notionAccount, authorizationKey)}`;
const notionEnv = {
  WONDERFOOD_LIVE_PROVIDER_ACK: notionAck,
  WONDERFOOD_DISPOSABLE_PROVIDER_AUTHORIZATION_KEY: authorizationKey,
  NOTION_TEST_PAGE_ID: notionTarget,
  NOTION_TEST_ACCOUNT_ID: notionAccount,
};
const runGoogleSheetsLiveProofSource = readFileSync(fileURLToPath(new URL('./run-google-sheets-live-proof.sh', import.meta.url)), 'utf8');
assert.equal(run('provider', notionEnv, 'notion').status, 0);
assert.equal(run('provider', {
  ...notionEnv,
  WONDERFOOD_LIVE_PROVIDER_ACK: 'wrong-shared-ack',
  WONDERFOOD_LIVE_PROVIDER_ACK_NOTION: notionAck,
}, 'notion').status, 0);
assert.equal(run('provider', { ...notionEnv, NOTION_TEST_PAGE_ID: 'different-target' }, 'notion').status, 2);
assert.equal(run('provider', { ...notionEnv, NOTION_TEST_ACCOUNT_ID: 'different-account' }, 'notion').status, 2);

const sheetsTarget = 'spreadsheet-fixture-id';
const sheetsAccount = 'sheets-fixture@example.invalid';
const sheetsAck = `DISPOSABLE_PROVIDER_ONLY:hmac-sha256:${providerAuthorizationDigest('sheets', sheetsTarget, sheetsAccount, authorizationKey)}`;
const sheetsEnv = {
  WONDERFOOD_LIVE_PROVIDER_ACK: sheetsAck,
  WONDERFOOD_DISPOSABLE_PROVIDER_AUTHORIZATION_KEY: authorizationKey,
  GOOGLE_SHEETS_TEST_SPREADSHEET_ID: sheetsTarget,
  GOOGLE_SHEETS_TEST_ACCOUNT_ID: sheetsAccount,
};
assert.equal(run('provider', sheetsEnv, 'sheets').status, 0);
assert.equal(run('provider', {
  ...sheetsEnv,
  WONDERFOOD_LIVE_PROVIDER_ACK: 'wrong-shared-ack',
  WONDERFOOD_LIVE_PROVIDER_ACK_SHEETS: sheetsAck,
}, 'sheets').status, 0);
assert.equal(run('provider', { ...sheetsEnv, GOOGLE_SHEETS_TEST_SPREADSHEET_ID: 'wrong-sheet' }, 'sheets').status, 2);
assert.equal(run('provider', { ...sheetsEnv, GOOGLE_SHEETS_TEST_ACCOUNT_ID: 'wrong-account' }, 'sheets').status, 2);
assert.equal(run('device', {
  WONDERFOOD_DEVICE_MUTATION_ACK: 'DISPOSABLE_EMULATOR_ONLY',
  ANDROID_SERIAL: 'physical-secret-serial',
}).status, 2);
assert.equal(run('device', {
  WONDERFOOD_DEVICE_MUTATION_ACK: 'DISPOSABLE_EMULATOR_ONLY',
  ANDROID_SERIAL: 'emulator-5554',
}).status, 0);
assert.match(runGoogleSheetsLiveProofSource, /GOOGLE_SHEETS_PROVISION_DISPOSABLE/);

const secret = 'must-not-appear';
const blocked = run('provider', { NOTION_TOKEN: secret }, 'notion');
assert.equal(`${blocked.stdout}${blocked.stderr}`.includes(secret), false);

const guardedEntrypoints = [
  'check-live-provider-writeback.ts',
  'check-native-visual-matrix.sh',
  'run-android-utopia-e2e-proof.sh',
  'run-emulatorx-health-connect.sh',
  'run-google-sheets-live-proof.sh',
  'run-google-sheets-scenario-proof.sh',
  'run-local-postgres-live-proof.sh',
  'run-local-postgres-scenario-proof.sh',
  'run-notion-live-proof.sh',
  'run-notion-scenario-proof.sh',
  'run-postgres-live-proof.sh',
  'run-provider-live-proofs.sh',
  'run-provider-standalone-visual-proof.sh',
];
for (const file of guardedEntrypoints) {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8');
  assert.match(source, /require-disposable-lane\.mjs/);
}

console.log('Disposable live-lane guards: PASS');
