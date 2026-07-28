import type { CanonicalRecord } from '@/src/domain/runtime';

export type ProviderPullResult = {
  status: 'ready' | 'blocked' | 'error';
  message?: string;
  provider: 'notion' | 'google_sheets';
  records: CanonicalRecord[];
  source_snapshots: Array<Record<string, unknown>>;
};

export type ProviderSyncClient = {
  baseUrl: string;
  token?: string;
  signal?: AbortSignal;
};

function endpoint(input: ProviderSyncClient, path: string) {
  const base = input.baseUrl.trim().replace(/\/$/, '');
  return base ? `${base}${path}` : null;
}

async function getJson<T>(input: ProviderSyncClient, path: string): Promise<T | null> {
  const url = endpoint(input, path);
  if (!url) return null;
  try {
    const response = await fetch(url, {
      headers: input.token?.trim() ? { authorization: `Bearer ${input.token.trim()}` } : undefined,
      signal: input.signal,
    });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

export function pullNotionRecords(input: ProviderSyncClient & { domain?: string; collection?: string; limit?: number }) {
  const query = new URLSearchParams({ live: 'true' });
  if (input.domain) query.set('domain', input.domain);
  if (input.collection) query.set('collection', input.collection);
  if (input.limit) query.set('limit', String(input.limit));
  return getJson<ProviderPullResult>(input, `/providers/notion/pull?${query.toString()}`);
}

export function pullSheetsRecords(input: ProviderSyncClient & { domain?: string; collection?: string }) {
  const query = new URLSearchParams({ live: 'true' });
  if (input.domain) query.set('domain', input.domain);
  if (input.collection) query.set('collection', input.collection);
  return getJson<ProviderPullResult>(input, `/providers/sheets/pull?${query.toString()}`);
}
