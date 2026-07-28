import { createHmac } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';

const port = 8897;
const replayDir = mkdtempSync(join(tmpdir(), 'utopia-webhook-ingress-'));
process.env.PORT = String(port);
process.env.LIFEOS_SERVER_TOKEN = 'webhook-ingress-test-token';
process.env.NOTION_TOKEN = 'webhook-ingress-notion-token';
process.env.NOTION_WEBHOOK_SIGNING_SECRET = 'webhook-ingress-secret';
process.env.LIFEOS_NOTION_WEBHOOKS_ENABLED = 'true';
delete process.env.NOTION_DATA_SOURCE_ID;
delete process.env.GOOGLE_SHEETS_ACCESS_TOKEN;
delete process.env.GOOGLE_SHEETS_TOKEN;
delete process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
process.env.NOTION_WEBHOOK_REPLAY_PATH = join(replayDir, 'notion.json');
process.env.SHEETS_WEBHOOK_REPLAY_PATH = join(replayDir, 'sheets.json');

const { server } = await import('../src/index');
await delay(25);

function ensure(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function readJson(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

try {
  process.env.LIFEOS_NOTION_WEBHOOKS_ENABLED = 'false';
  const disabledResponse = await fetch(`http://127.0.0.1:${port}/providers/notion/webhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ verification_token: 'disabled_probe' }),
  });
  ensure(disabledResponse.status === 404, 'Notion webhooks must be disabled unless explicitly enabled');
  process.env.LIFEOS_NOTION_WEBHOOKS_ENABLED = 'true';

  const verificationResponse = await fetch(`http://127.0.0.1:${port}/providers/notion/webhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ verification_token: 'secret_test_verification_token' }),
  });
  const verification = await readJson(verificationResponse);
  ensure(verificationResponse.status === 200, 'Notion verification handshake should be acknowledged');
  ensure(verification.status === 'verification_required', 'Notion verification handshake status should be explicit');
  ensure(verification.verification_token_present === true, 'Notion verification response must not lose token presence');
  ensure(!('verification_token' in verification), 'Notion verification response must not echo the token');

  const notionBody = JSON.stringify({
    event_type: 'page.update',
    data_source_id: 'missing-config-source',
    page_id: 'webhook-page-1',
  });
  const notionSignature = createHmac('sha256', process.env.NOTION_WEBHOOK_SIGNING_SECRET!)
    .update(notionBody)
    .digest('hex');
  const notionResponse = await fetch(`http://127.0.0.1:${port}/providers/notion/webhook`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-notion-signature': notionSignature,
    },
    body: notionBody,
  });
  const notion = await readJson(notionResponse);
  ensure(notionResponse.status === 200, 'Notion webhook should acknowledge valid signature');
  ensure(notion.sync_status === 'error', `Notion ingress must invoke reconciliation: ${JSON.stringify(notion)}`);
  ensure(notion.sync_ok === false, 'Notion missing configuration must be reported as non-synced');

  const sheetsBody = JSON.stringify({
    event_id: 'sheets-webhook-1',
    spreadsheet_id: 'missing-config-sheet',
    range: 'Utopia Runtime!A2:K2',
    row: 2,
  });
  const unauthenticatedSheetsResponse = await fetch(`http://127.0.0.1:${port}/providers/sheets/webhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: sheetsBody,
  });
  ensure(unauthenticatedSheetsResponse.status === 401, 'Sheets webhook must reject unauthenticated ingress');

  const sheetsResponse = await fetch(`http://127.0.0.1:${port}/providers/sheets/webhook`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer webhook-ingress-test-token',
    },
    body: sheetsBody,
  });
  const sheets = await readJson(sheetsResponse);
  ensure(sheetsResponse.status === 200, 'Sheets webhook should acknowledge valid event');
  ensure(sheets.sync_status === 'error', `Sheets ingress must invoke reconciliation: ${JSON.stringify(sheets)}`);
  ensure(sheets.sync_ok === false, 'Sheets missing configuration must be reported as non-synced');

  console.log('PASS server/test/provider-webhook-ingress.ts');
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(replayDir, { recursive: true, force: true });
}
