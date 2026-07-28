import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setNotionPortForTests } from '../src/providers/notion/port';

process.env.WONDER_RUNTIME_STATE_PATH = join(mkdtempSync(join(tmpdir(), 'utopia-retrieval-controls-')), 'wonder-runtime.json');
process.env.NOTION_TOKEN = 'retrieval-controls-token';
process.env.NOTION_DATA_SOURCE_ID = 'retrieval-controls-source';
process.env.LIFEOS_RETRIEVAL_CACHE_TTL_MS = '60000';
process.env.LIFEOS_RETRIEVAL_CIRCUIT_FAILURE_THRESHOLD = '1';
process.env.LIFEOS_RETRIEVAL_CIRCUIT_OPEN_MS = '60000';
process.env.LIFEOS_RETRIEVAL_NOTION_TIMEOUT_MS = '50';

const { runRetrieval, resetRetrievalRuntimeForTests } = await import('../src/agents/retrieval');

try {
  resetRetrievalRuntimeForTests();
  let cacheCalls = 0;
  setNotionPortForTests({
    async queryDataSource(input) {
      assert.equal(input.dataSourceId, 'retrieval-controls-source');
      cacheCalls += 1;
      return {
        ok: true,
        status: 200,
        data: {
          results: [{
            id: 'notion-cache-page',
            properties: {
              Name: { title: [{ plain_text: 'Cache page' }] },
              'Utopia Domain': 'food',
              'Utopia Collection': 'recipe',
              status: 'ready',
            },
            parent: { database_id: 'retrieval-db' },
          }],
          has_more: false,
          next_cursor: null,
        },
      };
    },
    async createPage() {
      throw new Error('retrieval runtime controls should not create pages');
    },
    async updatePage() {
      throw new Error('retrieval runtime controls should not update pages');
    },
  });

  const first = await runRetrieval({ query: 'show notion cache page', domain: 'food' });
  const second = await runRetrieval({ query: 'show notion cache page', domain: 'food' });
  assert.equal(cacheCalls, 1, 'second notion retrieval should hit cache');
  assert.equal(first.snapshots.some((snapshot) => snapshot.detail.includes('live')), true);
  assert.equal(second.snapshots.some((snapshot) => snapshot.detail.includes('cached')), true);

  resetRetrievalRuntimeForTests();
  setNotionPortForTests(null);
  let timeoutCalls = 0;
  let timeoutAborts = 0;
  setNotionPortForTests({
    async queryDataSource(input) {
      assert.equal(input.dataSourceId, 'retrieval-controls-source');
      timeoutCalls += 1;
      return new Promise((_resolve, reject) => {
        const signal = input.signal;
        if (signal?.aborted) {
          timeoutAborts += 1;
          reject(signal.reason);
          return;
        }
        signal?.addEventListener('abort', () => {
          timeoutAborts += 1;
          reject(signal.reason);
        }, { once: true });
      });
    },
    async createPage() {
      throw new Error('retrieval runtime controls should not create pages');
    },
    async updatePage() {
      throw new Error('retrieval runtime controls should not update pages');
    },
  });

  const timeoutFirst = await runRetrieval({ query: 'show notion timeout state', domain: 'food' });
  const timeoutSecond = await runRetrieval({ query: 'show notion timeout state', domain: 'food' });
  assert.equal(timeoutCalls, 1, 'open circuit should suppress the second live call');
  assert.equal(timeoutAborts, 1, 'timeout should abort the live provider request');
  assert.equal(timeoutFirst.snapshots.some((snapshot) => snapshot.label === 'Notion'), true);
  assert.equal(timeoutSecond.snapshots.some((snapshot) => snapshot.detail.includes('circuit open') || snapshot.detail.includes('paused after repeated failures')), true);

  console.log('PASS server/test/retrieval-runtime-controls.ts');
} finally {
  setNotionPortForTests(null);
}
