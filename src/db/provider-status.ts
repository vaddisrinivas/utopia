import type { SQLiteDatabase } from 'expo-sqlite';

import { isProviderWriteOutboxEvent, listProviderWritebackOutboxEvents, type OutboxEvent } from '@/src/db/outbox';
import { listProviderLinks, type ProviderLink } from '@/src/db/sources';

export type ProviderStatusKey = 'local' | 'notion' | 'google_sheets' | 'summary';
type RemoteProviderStatusKey = 'notion' | 'google_sheets';

export type ProviderSyncStatus = {
  provider: ProviderStatusKey;
  label: string;
  connected: boolean;
  status: 'ready' | 'attention' | 'offline' | 'local';
  headline: string;
  detail: string;
  linkCount: number;
  pendingWrites: number;
  inflightWrites: number;
  failedWrites: number;
  lastUpdatedAt: string | null;
  url: string | null;
};

export type ProviderSyncSummary = {
  providers: Record<ProviderStatusKey, ProviderSyncStatus>;
  generatedAt: string;
};

const PROVIDERS = ['notion', 'google_sheets'] as const;

export async function getProviderSyncSummary(db: SQLiteDatabase | null): Promise<ProviderSyncSummary> {
  if (!db) return emptySummary('Database starting…');
  const [links, writes] = await Promise.all([
    safeListProviderLinks(db),
    safeListProviderWrites(db),
  ]);
  const providerRows = Object.fromEntries(PROVIDERS.map((provider) => [
    provider,
    buildProviderStatus(provider, links.filter((link) => link.provider === provider), writes.filter((event) => providerForWriteEvent(event) === provider)),
  ])) as Record<'notion' | 'google_sheets', ProviderSyncStatus>;
  const pendingWrites = providerRows.notion.pendingWrites + providerRows.google_sheets.pendingWrites;
  const inflightWrites = providerRows.notion.inflightWrites + providerRows.google_sheets.inflightWrites;
  const failedWrites = providerRows.notion.failedWrites + providerRows.google_sheets.failedWrites;
  const linkCount = providerRows.notion.linkCount + providerRows.google_sheets.linkCount;
  const summary: ProviderSyncStatus = {
    provider: 'summary',
    label: 'Sync',
    connected: linkCount > 0,
    status: failedWrites > 0 ? 'attention' : 'ready',
    headline: failedWrites > 0 ? `${failedWrites} write${failedWrites === 1 ? ' needs' : 's need'} attention` : linkCount > 0 ? 'Connected and verified' : 'Local ready',
    detail: failedWrites > 0
      ? 'Provider writes stay pending until reread verification succeeds.'
      : linkCount > 0
        ? `${linkCount} connected source${linkCount === 1 ? '' : 's'} · ${pendingWrites + inflightWrites} queued write${pendingWrites + inflightWrites === 1 ? '' : 's'}.`
        : 'Use the app locally now. Connect Notion or Sheets only when useful.',
    linkCount,
    pendingWrites,
    inflightWrites,
    failedWrites,
    lastUpdatedAt: latestTimestamp([providerRows.notion.lastUpdatedAt, providerRows.google_sheets.lastUpdatedAt]),
    url: null,
  };
  return {
    providers: {
      local: buildLocalStatus(writes),
      notion: providerRows.notion,
      google_sheets: providerRows.google_sheets,
      summary,
    },
    generatedAt: new Date().toISOString(),
  };
}

function buildLocalStatus(writes: OutboxEvent[]): ProviderSyncStatus {
  const failedWrites = writes.filter((event) => event.status === 'failed').length;
  const queuedWrites = writes.filter((event) => event.status === 'pending' || event.status === 'inflight').length;
  return {
    provider: 'local',
    label: 'Local',
    connected: true,
    status: failedWrites > 0 ? 'attention' : 'local',
    headline: failedWrites > 0 ? 'Local ready; sync needs attention' : 'On-device graph ready',
    detail: failedWrites > 0
      ? 'Your local app remains usable while provider writeback waits for review.'
      : queuedWrites > 0
        ? `${queuedWrites} provider write${queuedWrites === 1 ? '' : 's'} queued behind local data.`
        : 'This app works before any provider is connected.',
    linkCount: 1,
    pendingWrites: writes.filter((event) => event.status === 'pending').length,
    inflightWrites: writes.filter((event) => event.status === 'inflight').length,
    failedWrites,
    lastUpdatedAt: latestTimestamp(writes.map((event) => event.updated_at)),
    url: null,
  };
}

function buildProviderStatus(provider: RemoteProviderStatusKey, links: ProviderLink[], writes: OutboxEvent[]): ProviderSyncStatus {
  const failedWrites = writes.filter((event) => event.status === 'failed').length;
  const pendingWrites = writes.filter((event) => event.status === 'pending').length;
  const inflightWrites = writes.filter((event) => event.status === 'inflight').length;
  const connected = links.length > 0;
  const latestLink = [...links].sort((left, right) => String(right.updated_at).localeCompare(String(left.updated_at)))[0] ?? null;
  const label = provider === 'google_sheets' ? 'Google Sheets' : provider === 'notion' ? 'Notion' : provider;
  return {
    provider,
    label,
    connected,
    status: failedWrites > 0 ? 'attention' : connected ? 'ready' : 'offline',
    headline: failedWrites > 0 ? `${failedWrites} write${failedWrites === 1 ? ' needs' : 's need'} attention` : connected ? 'Connected' : 'Connect when useful',
    detail: failedWrites > 0
      ? 'Wonder will not call provider sync complete until reread verification passes.'
      : connected
        ? `${links.length} source${links.length === 1 ? '' : 's'} · ${pendingWrites + inflightWrites} queued write${pendingWrites + inflightWrites === 1 ? '' : 's'}.`
        : provider === 'google_sheets'
          ? 'Best simple sharing path: share the Sheet and app package.'
          : 'Best for Notion-first homes: share the page/database and app package.',
    linkCount: links.length,
    pendingWrites,
    inflightWrites,
    failedWrites,
    lastUpdatedAt: latestTimestamp([...links.map((link) => link.updated_at), ...writes.map((event) => event.updated_at)]),
    url: latestLink?.url ?? null,
  };
}

function providerForWriteEvent(event: OutboxEvent): RemoteProviderStatusKey | null {
  const keyParts = event.action_key.split(':');
  const fromKey = keyParts[0] === 'provider-write'
    ? keyParts.length >= 4 ? keyParts[2] : keyParts[1]
    : null;
  if (fromKey === 'notion' || fromKey === 'google_sheets') return fromKey;
  try {
    const payload = JSON.parse(event.payload_json) as { provider?: unknown };
    return payload.provider === 'notion' || payload.provider === 'google_sheets' ? payload.provider : null;
  } catch {
    return null;
  }
}

function latestTimestamp(values: Array<string | null | undefined>): string | null {
  return values
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .sort((left, right) => right.localeCompare(left))[0] ?? null;
}

async function safeListProviderLinks(db: SQLiteDatabase): Promise<ProviderLink[]> {
  try {
    return await listProviderLinks(db);
  } catch {
    return [];
  }
}

async function safeListProviderWrites(db: SQLiteDatabase): Promise<OutboxEvent[]> {
  try {
    return (await listProviderWritebackOutboxEvents(db)).filter(isProviderWriteOutboxEvent);
  } catch {
    return [];
  }
}

function emptySummary(detail: string): ProviderSyncSummary {
  const local: ProviderSyncStatus = {
    provider: 'local',
    label: 'Local',
    connected: false,
    status: 'offline',
    headline: 'Starting',
    detail,
    linkCount: 0,
    pendingWrites: 0,
    inflightWrites: 0,
    failedWrites: 0,
    lastUpdatedAt: null,
    url: null,
  };
  return {
    providers: {
      local,
      notion: { ...local, provider: 'notion', label: 'Notion', headline: 'Connect when useful' },
      google_sheets: { ...local, provider: 'google_sheets', label: 'Google Sheets', headline: 'Connect when useful' },
      summary: { ...local, provider: 'summary', label: 'Sync' },
    },
    generatedAt: new Date().toISOString(),
  };
}
