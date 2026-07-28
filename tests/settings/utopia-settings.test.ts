import { describe, expect, it } from 'vitest';

import {
  defaultUtopiaSettings,
  maskSecret,
  updateUtopiaAiProviderProfile,
  updateUtopiaRuntimePreferences,
  updateUtopiaSourceProviderSettings,
} from '@/src/settings/utopia-settings';

describe('Utopia settings helpers', () => {
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
