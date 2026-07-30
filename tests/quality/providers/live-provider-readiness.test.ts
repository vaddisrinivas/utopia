import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { providerAuthorizationDigest } from '@/scripts/quality/require-disposable-lane.mjs';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const scriptPath = join(projectRoot, 'scripts/quality/check-live-provider-readiness.mjs');
const checkOutputPrefix = 'LIVE_PROVIDER_READINESS_JSON=';
const envKeys = [
  'NOTION_TOKEN',
  'NOTION_API_KEY',
  'NOTION_TEST_PAGE_ID',
  'NOTION_TEST_ACCOUNT_ID',
  'NOTION_WORKSPACE_ID',
  'WONDERFOOD_DISPOSABLE_PROVIDER_AUTHORIZATION_KEY',
  'WONDERFOOD_LIVE_PROVIDER_ACK',
  'WONDERFOOD_LIVE_PROVIDER_ACK_NOTION',
  'GOOGLE_SHEETS_TEST_SPREADSHEET_ID',
  'GOOGLE_SHEETS_TEST_ACCOUNT_ID',
  'GOOGLE_ACCOUNT_ID',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GOOGLE_SHEETS_ACCESS_TOKEN',
  'GOOGLE_SHEETS_TOKEN_FILE',
  'WONDERFOOD_LIVE_PROVIDER_ACK_SHEETS',
];

function cleanEnv(overrides: Record<string, string>): NodeJS.ProcessEnv {
  const env = { ...process.env } as Record<string, string | undefined>;
  for (const key of envKeys) {
    delete env[key];
  }
  return {
    ...env,
    ...overrides,
  } as NodeJS.ProcessEnv;
}

function runReadiness(env: NodeJS.ProcessEnv) {
  const result = spawnSync(process.execPath, [scriptPath], {
    cwd: projectRoot,
    env,
    encoding: 'utf8',
  });
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  const readyLine = output
    .split('\n')
    .find((line) => line.startsWith(checkOutputPrefix));
  if (!readyLine) {
    throw new Error(`Missing check payload in output: ${output}`);
  }
  const payload = JSON.parse(readyLine.slice(checkOutputPrefix.length));
  return { status: result.status ?? 1, payload, output };
}

function notionGuardAck(pageId: string, accountId: string, key: string) {
  return `DISPOSABLE_PROVIDER_ONLY:hmac-sha256:${providerAuthorizationDigest('notion', pageId, accountId, key)}`;
}

function sheetsGuardAck(sheetId: string, accountId: string, key: string) {
  return `DISPOSABLE_PROVIDER_ONLY:hmac-sha256:${providerAuthorizationDigest('sheets', sheetId, accountId, key)}`;
}

describe('check:live-provider-readiness', () => {
  it('reports BLOCKED when required env is missing', () => {
    const result = runReadiness(cleanEnv({}));
    expect(result.status).toBe(1);
    expect(result.payload.status).toBe('BLOCKED');
    expect(result.payload.providers.notion.status).toBe('BLOCKED');
    expect(result.payload.providers.sheets.status).toBe('BLOCKED');
  });

  it('reports BLOCKED when disposable lane checks fail', () => {
    const key = 'fixture-provider-authorization-key-32-characters';
    const notionAck = notionGuardAck('11111111-2222-3333-4444-555555555555', 'notion-workspace', key);
    const sheetsAck = sheetsGuardAck('spreadsheet-fixture-id', 'sheets-workspace@example.com', key);
    const result = runReadiness(
      cleanEnv({
        NOTION_TOKEN: 'notion-token',
        NOTION_TEST_PAGE_ID: '11111111-2222-3333-4444-555555555555',
        NOTION_TEST_ACCOUNT_ID: 'notion-workspace',
        GOOGLE_SHEETS_TEST_SPREADSHEET_ID: 'spreadsheet-fixture-id',
        GOOGLE_SHEETS_TEST_ACCOUNT_ID: 'sheets-workspace@example.com',
        GOOGLE_SHEETS_ACCESS_TOKEN: 'google-sheets-access-token',
        GOOGLE_CLIENT_ID: 'google-client-id',
        GOOGLE_CLIENT_SECRET: 'google-client-secret',
        WONDERFOOD_DISPOSABLE_PROVIDER_AUTHORIZATION_KEY: key,
        WONDERFOOD_LIVE_PROVIDER_ACK_NOTION: notionAck,
        WONDERFOOD_LIVE_PROVIDER_ACK_SHEETS: `${sheetsAck}-bad`,
      }),
    );
    expect(result.status).toBe(1);
    expect(result.payload.providers.sheets.disposable_lane).toBe('BLOCKED');
    expect(result.payload.providers.notion.status).toBe('READY');
    expect(result.payload.status).toBe('BLOCKED');
    expect(result.payload.blockers).toContain('sheets_disposable_lane');
  });

  it('reports READY when required env and guards are present', () => {
    const key = 'fixture-provider-authorization-key-32-characters';
    const notionAck = notionGuardAck('11111111-2222-3333-4444-555555555555', 'notion-workspace', key);
    const sheetsAck = sheetsGuardAck('spreadsheet-fixture-id', 'sheets-workspace@example.com', key);
    const result = runReadiness(
      cleanEnv({
        NOTION_TOKEN: 'notion-token',
        NOTION_TEST_PAGE_ID: '11111111-2222-3333-4444-555555555555',
        NOTION_TEST_ACCOUNT_ID: 'notion-workspace',
        GOOGLE_SHEETS_TEST_SPREADSHEET_ID: 'spreadsheet-fixture-id',
        GOOGLE_SHEETS_TEST_ACCOUNT_ID: 'sheets-workspace@example.com',
        GOOGLE_SHEETS_ACCESS_TOKEN: 'google-sheets-access-token',
        GOOGLE_CLIENT_ID: 'google-client-id',
        GOOGLE_CLIENT_SECRET: 'google-client-secret',
        WONDERFOOD_DISPOSABLE_PROVIDER_AUTHORIZATION_KEY: key,
        WONDERFOOD_LIVE_PROVIDER_ACK_NOTION: notionAck,
        WONDERFOOD_LIVE_PROVIDER_ACK_SHEETS: sheetsAck,
      }),
    );
    expect(result.status).toBe(0);
    expect(result.payload.status).toBe('READY');
    expect(result.payload.providers.notion.status).toBe('READY');
    expect(result.payload.providers.sheets.status).toBe('READY');
    expect(result.payload.providers.notion.disposable_lane).toBe('READY');
    expect(result.payload.providers.sheets.disposable_lane).toBe('READY');
  });
});
