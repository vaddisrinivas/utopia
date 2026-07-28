import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { syncNotionFromWebhook } from '../src/providers/sync/notion';
import { getWebhookReplayState, clearWebhookReplayState } from '../src/providers/webhooks/notion';
import { setNotionPortForTests } from '../src/providers/notion/port';

const replayPath = join(mkdtempSync(join(tmpdir(), 'utopia-webhook-retry-')), 'notion.json');
const previous = {
  token: process.env.NOTION_TOKEN,
  dataSource: process.env.NOTION_DATA_SOURCE_ID,
  replay: process.env.NOTION_WEBHOOK_REPLAY_PATH,
};
let queryAttempts = 0;

process.env.NOTION_TOKEN = 'retry-test-token';
process.env.NOTION_DATA_SOURCE_ID = 'retry-source';
process.env.NOTION_WEBHOOK_REPLAY_PATH = replayPath;
clearWebhookReplayState(replayPath);

setNotionPortForTests({
  async queryDataSource(input) {
    if (input.dataSourceId !== 'retry-source') {
      return { ok: false, status: 500, error: { status: 500, message: `unexpected data source ${input.dataSourceId}`, body: null } };
    }
    queryAttempts += 1;
    if (queryAttempts === 1) {
      return { ok: false, status: 503, error: { status: 503, message: 'temporary provider outage', body: null } };
    }
    return {
      ok: true,
      status: 200,
      data: {
        results: [{
          object: 'page',
          id: 'retry-page',
          properties: { Name: { title: [{ plain_text: 'Retry record' }] }, 'Utopia Domain': 'food', 'Utopia Collection': 'recipe' },
          created_time: '2026-01-01T00:00:00.000Z',
          last_edited_time: '2026-01-01T00:01:00.000Z',
          archived: false,
          parent: { database_id: 'retry-db' },
        }],
      },
    };
  },
  async createPage() {
    throw new Error('provider-webhook-retry should not create pages');
  },
  async updatePage() {
    throw new Error('provider-webhook-retry should not update pages');
  },
});

try {
  const event = { event_type: 'page.update', data_source_id: 'retry-source', external_id: 'retry-page' };
  const failed = await syncNotionFromWebhook({ event, domain: 'food', collection: 'recipe' });
  if (failed.status !== 'error') throw new Error(`expected transient error, got ${failed.status}`);
  if (getWebhookReplayState(replayPath).events.length !== 0) throw new Error('failed pull was incorrectly committed as replayed');

  const retried = await syncNotionFromWebhook({ event, domain: 'food', collection: 'recipe' });
  if (retried.status !== 'synced') throw new Error(`expected retry sync, got ${retried.status}`);
  if (getWebhookReplayState(replayPath).events.length !== 1) throw new Error('successful retry was not committed');
  console.log('PASS server/test/provider-webhook-retry.ts');
} finally {
  setNotionPortForTests(null);
  if (previous.token === undefined) delete process.env.NOTION_TOKEN; else process.env.NOTION_TOKEN = previous.token;
  if (previous.dataSource === undefined) delete process.env.NOTION_DATA_SOURCE_ID; else process.env.NOTION_DATA_SOURCE_ID = previous.dataSource;
  if (previous.replay === undefined) delete process.env.NOTION_WEBHOOK_REPLAY_PATH; else process.env.NOTION_WEBHOOK_REPLAY_PATH = previous.replay;
  rmSync(replayPath, { force: true });
}
