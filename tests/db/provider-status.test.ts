import { describe, expect, it } from 'vitest';

import { enqueueOutboxEvent, markOutboxEvent } from '@/src/db/outbox';
import { getProviderSyncSummary } from '@/src/db/provider-status';
import { upsertProviderLink } from '@/src/db/sources';
import { MemoryDb } from '@/tests/helpers/memory-db';

describe('provider sync summary', () => {
  it('summarizes local-first state when no providers are connected', async () => {
    const summary = await getProviderSyncSummary(new MemoryDb() as any);

    expect(summary.providers.local.headline).toBe('On-device graph ready');
    expect(summary.providers.notion.connected).toBe(false);
    expect(summary.providers.google_sheets.connected).toBe(false);
    expect(summary.providers.summary.headline).toBe('Local ready');
  });

  it('shows connected providers and provider writeback attention without marking local app broken', async () => {
    const db = new MemoryDb() as any;
    const now = '2026-07-27T12:00:00.000Z';

    await upsertProviderLink(db, {
      id: 'notion-main',
      provider: 'notion',
      external_id: 'notion-db',
      name: 'Food Notion',
      status: 'connected',
      freshness: 'fresh',
      workspace: 'home',
      url: 'https://notion.example/food',
      created_at: now,
      updated_at: now,
    });
    const queued = await enqueueOutboxEvent(db, {
      id: 'provider-write-notion-op-1',
      action_key: 'provider-write:notion:op-1',
      domain: 'food',
      payload_json: JSON.stringify({ schema_version: 'utopia.provider-write.v1', provider: 'notion', op_id: 'op-1' }),
    });
    await markOutboxEvent(db, queued.id, {
      status: 'failed',
      last_error: 'provider_writeback_readback_timeout',
      attemptsDelta: 1,
    });

    const summary = await getProviderSyncSummary(db);

    expect(summary.providers.local.headline).toBe('Local ready; sync needs attention');
    expect(summary.providers.notion.connected).toBe(true);
    expect(summary.providers.notion.status).toBe('attention');
    expect(summary.providers.notion.failedWrites).toBe(1);
    expect(summary.providers.notion.detail).toContain('reread verification');
    expect(summary.providers.summary.headline).toBe('1 write needs attention');
  });
});
