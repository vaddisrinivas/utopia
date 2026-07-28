import { describe, expect, it } from 'vitest';

import { fetchConfigSource, registeredConfigSourceKinds } from '@/src/config/fetchers';
import type { ConfigSource } from '@/src/config/types';

const base = {
  enabled: true,
  auto_refresh: false,
  refresh_minutes: 60,
  precedence: 1,
  created_at: '2026-07-23T00:00:00.000Z',
  updated_at: '2026-07-23T00:00:00.000Z',
} satisfies Omit<ConfigSource, 'id' | 'kind' | 'label' | 'location'>;

function source(input: Pick<ConfigSource, 'id' | 'kind' | 'label' | 'location'>): ConfigSource {
  return { ...base, ...input };
}

describe('config fetchers', () => {
  it('registers every portable control-plane source kind', () => {
    expect(registeredConfigSourceKinds()).toEqual(['local', 'github', 'url', 'notion', 'sheets']);
  });

  it('fetches local config as an unvalidated snapshot without data-plane access', async () => {
    const result = await fetchConfigSource({
      source: source({ id: 'local-food', kind: 'local', label: 'Food file', location: { path: 'domains/food.yml' } }),
      now: '2026-07-23T01:00:00.000Z',
      localFiles: { 'domains/food.yml': 'domain: food\nscreens:\n  - home\n' },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot).toMatchObject({
      source_id: 'local-food',
      fetched_at: '2026-07-23T01:00:00.000Z',
      raw: 'domain: food\nscreens:\n  - home\n',
      validation_status: 'unvalidated',
    });
    expect(result.snapshot.content_hash).toMatch(/^fnv1a:/);
  });

  it('fetches GitHub config through the raw content endpoint', async () => {
    const seen: Array<{ url: string; init?: RequestInit }> = [];
    const result = await fetchConfigSource({
      source: source({
        id: 'gh-utopia',
        kind: 'github',
        label: 'GitHub Utopia',
        location: { owner: 'sv', repo: 'utopia', ref: 'main', path: 'config/utopia.yaml' },
      }),
      credentials: { github: 'gh-test-token' },
      fetcher: async (url, init) => {
        seen.push({ url, init });
        return { ok: true, status: 200, text: async () => 'domains: []' };
      },
    });

    expect(result.ok).toBe(true);
    expect(seen[0].url).toBe('https://raw.githubusercontent.com/sv/utopia/main/config/utopia.yaml');
    expect((seen[0].init?.headers as Record<string, string>).authorization).toBe('Bearer gh-test-token');
  });

  it('fetches Notion config with the 2026 API version and plain-text page parsing', async () => {
    const seen: Array<{ url: string; init?: RequestInit }> = [];
    const result = await fetchConfigSource({
      source: source({
        id: 'notion-config',
        kind: 'notion',
        label: 'Notion config',
        location: { page_id: 'page-123' },
      }),
      credentials: { notion: 'notion-test-token' },
      fetcher: async (url, init) => {
        seen.push({ url, init });
        return {
          ok: true,
          status: 200,
          text: async () => '',
          json: async () => ({
            results: [
              { type: 'paragraph', paragraph: { rich_text: [{ plain_text: 'domain: food' }] } },
              { type: 'code', code: { rich_text: [{ plain_text: 'screens: [home]' }] } },
            ],
          }),
        };
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.raw).toBe('domain: food\nscreens: [home]');
    expect(seen[0].url).toContain('/v1/blocks/page-123/children');
    expect((seen[0].init?.headers as Record<string, string>)['notion-version']).toBe('2026-03-11');
  });

  it('fetches Sheets config from a chosen workbook range', async () => {
    const seen: Array<{ url: string; init?: RequestInit }> = [];
    const result = await fetchConfigSource({
      source: source({
        id: 'sheets-config',
        kind: 'sheets',
        label: 'Sheets config',
        location: { spreadsheet_id: 'sheet-123', range: 'Config!A:C' },
      }),
      credentials: { sheets: 'sheets-test-token' },
      fetcher: async (url, init) => {
        seen.push({ url, init });
        return {
          ok: true,
          status: 200,
          text: async () => '',
          json: async () => ({ values: [['key', 'value'], ['domain', 'food']] }),
        };
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.raw).toBe('key,value\ndomain,food');
    expect(seen[0].url).toBe('https://sheets.googleapis.com/v4/spreadsheets/sheet-123/values/Config!A%3AC');
  });

  it('fails closed without touching records when a provider credential is missing', async () => {
    const result = await fetchConfigSource({
      source: source({
        id: 'notion-config',
        kind: 'notion',
        label: 'Notion config',
        location: { page_id: 'page-123' },
      }),
    });

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'CONFIG_FETCH_FAILED',
        message: 'notion config credential is missing.',
      },
    });
  });
});
