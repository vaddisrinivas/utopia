import { describe, expect, it, vi } from 'vitest';

import {
  defaultUtopiaSettings,
  maskSecret,
  updateUtopiaAiProviderProfile,
  updateUtopiaRuntimePreferences,
  updateUtopiaSourceProviderSettings,
} from '@/src/settings/utopia-settings';
import {
  clearBrowserCredentialState,
  readSettingsValue,
  redactBrowserCredentialPayload,
  writeSettingsValue,
} from '@/src/settings/settings-storage.web';

describe('Utopia settings helpers', () => {
  it('keeps browser credentials out of localStorage while retaining them in memory', async () => {
    const storage = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    });

    const settings = JSON.stringify({
      ai: { primary: { apiKey: 'sk-browser-secret' } },
      notion: { token: 'notion-secret' },
      postgres: { databaseUrl: 'postgres://secret' },
      runtime: { theme: 'dark' },
    });
    await writeSettingsValue(settings);

    expect(storage.get('utopia.settings.v1')).not.toContain('sk-browser-secret');
    expect(storage.get('utopia.settings.v1')).not.toContain('notion-secret');
    expect(storage.get('utopia.settings.v1')).not.toContain('postgres://secret');
    await expect(readSettingsValue()).resolves.toBe(settings);

    clearBrowserCredentialState();
    await expect(readSettingsValue()).resolves.not.toContain('sk-browser-secret');
    vi.unstubAllGlobals();
  });

  it('redacts every browser credential class recursively before persistence', () => {
    const payload = JSON.stringify({
      ai: { apiKey: 'ai-secret' },
      notion: { token: 'notion-secret' },
      sheets: { accessToken: 'sheets-access' },
      postgres: { databaseUrl: 'postgres://user:password@host/db', password: 'db-password' },
      mcp: { refreshToken: 'mcp-refresh' },
      oauth: { clientSecret: 'oauth-secret', nested: { authorization: 'Bearer secret' } },
      runtime: { theme: 'dark' },
    });

    const redacted = redactBrowserCredentialPayload(payload);
    const persisted = JSON.parse(redacted.persisted) as Record<string, any>;

    expect(redacted.hadSecrets).toBe(true);
    expect(redacted.persisted).not.toContain('secret');
    expect(redacted.persisted).not.toContain('password');
    expect(redacted.persisted).not.toContain('Bearer');
    expect(persisted.ai).not.toHaveProperty('apiKey');
    expect(persisted.sheets).not.toHaveProperty('accessToken');
    expect(persisted.postgres).not.toHaveProperty('databaseUrl');
    expect(persisted.oauth.nested).not.toHaveProperty('authorization');
    expect(persisted.runtime.theme).toBe('dark');
  });

  it('ships no private Notion identifiers and preserves user-provided connections', () => {
    expect(defaultUtopiaSettings.notion.pageId).toBe('');
    expect(defaultUtopiaSettings.notion.dataSourceIds).toBe('');

    const configured = updateUtopiaSourceProviderSettings(defaultUtopiaSettings, 'notion', {
      pageId: 'user-page-id',
      dataSourceIds: 'user-data-source-id',
    });
    expect(configured.notion.pageId).toBe('user-page-id');
    expect(configured.notion.dataSourceIds).toBe('user-data-source-id');
  });

  it('updates persistent theme and density preferences without changing AI keys', () => {
    const base = updateUtopiaAiProviderProfile(defaultUtopiaSettings, 'primary', {
      enabled: true,
      apiKey: 'sk-test-theme-kept',
    });

    const updated = updateUtopiaRuntimePreferences(base, {
      theme: 'dark',
      density: 'compact',
    });

    expect(updated.runtime.theme).toBe('dark');
    expect(updated.runtime.density).toBe('compact');
    expect(updated.ai.primary.apiKey).toBe('sk-test-theme-kept');
  });

  it('keeps, replaces, clears, and masks AI provider API keys safely', () => {
    const withKey = updateUtopiaAiProviderProfile(defaultUtopiaSettings, 'primary', {
      enabled: true,
      provider: 'openai_compatible',
      baseUrl: ' https://api.openai.com/v1 ',
      model: ' gpt-5.4 ',
      apiKey: 'sk-1234567890abcdef',
    });

    expect(withKey.ai.primary.baseUrl).toBe('https://api.openai.com/v1');
    expect(withKey.ai.primary.model).toBe('gpt-5.4');
    expect(maskSecret(withKey.ai.primary.apiKey)).toBe('sk-••••cdef');

    const kept = updateUtopiaAiProviderProfile(withKey, 'primary', {
      model: 'gpt-5.4-mini',
      apiKey: '',
    });
    expect(kept.ai.primary.model).toBe('gpt-5.4-mini');
    expect(kept.ai.primary.apiKey).toBe('sk-1234567890abcdef');

    const replaced = updateUtopiaAiProviderProfile(kept, 'primary', {
      apiKey: 'sk-new-secret',
    });
    expect(replaced.ai.primary.apiKey).toBe('sk-new-secret');

    const cleared = updateUtopiaAiProviderProfile(replaced, 'primary', {
      clearApiKey: true,
    });
    expect(cleared.ai.primary.apiKey).toBe('');
    expect(maskSecret(cleared.ai.primary.apiKey)).toBe('Not set');
  });

  it('keeps, replaces, and clears Notion and Sheets tokens safely', () => {
    const notion = updateUtopiaSourceProviderSettings(defaultUtopiaSettings, 'notion', {
      enabled: true,
      token: ' notion-token ',
      pageId: ' page-id ',
      dataSourceIds: ' ds-one, ds-two ',
    });

    expect(notion.notion.enabled).toBe(true);
    expect(notion.notion.token).toBe('notion-token');
    expect(notion.notion.pageId).toBe('page-id');
    expect(notion.notion.dataSourceIds).toBe('ds-one, ds-two');

    const kept = updateUtopiaSourceProviderSettings(notion, 'notion', {
      token: '',
      pageId: 'next-page',
    });
    expect(kept.notion.token).toBe('notion-token');
    expect(kept.notion.pageId).toBe('next-page');

    const sheets = updateUtopiaSourceProviderSettings(kept, 'sheets', {
      enabled: true,
      token: ' sheets-token ',
      workbookId: ' workbook ',
      sheetName: ' Food ',
    });
    expect(sheets.sheets.token).toBe('sheets-token');
    expect(sheets.sheets.workbookId).toBe('workbook');
    expect(sheets.sheets.sheetName).toBe('Food');

    const cleared = updateUtopiaSourceProviderSettings(sheets, 'sheets', { clearToken: true });
    expect(cleared.sheets.token).toBe('');
  });
});
