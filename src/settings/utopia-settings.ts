import { useEffect, useState } from 'react';

import { readSettingsValue, writeSettingsValue } from './settings-storage';

export type AiProviderKind = 'openai_compatible' | 'azure_openai' | 'anthropic';

export type AiProviderProfile = {
  id: 'primary' | 'fallback';
  enabled: boolean;
  provider: AiProviderKind;
  baseUrl: string;
  apiKey: string;
  model: string;
  apiVersion: string;
};

export type TokenProviderSettings = {
  enabled: boolean;
  token: string;
};

export type UtopiaSettings = {
  ai: {
    primary: AiProviderProfile;
    fallback: AiProviderProfile;
  };
  notion: TokenProviderSettings & {
    pageId: string;
    dataSourceIds: string;
  };
  sheets: TokenProviderSettings & {
    workbookId: string;
    sheetName: string;
  };
  postgres: {
    enabled: boolean;
    databaseUrl: string;
  };
  mcp: TokenProviderSettings & {
    url: string;
  };
  runtime: {
    activeDomain: string;
    enabledDomains: string[];
    enabledWorkflows: string[];
    enabledAgents: string[];
    skillInstructions: Record<string, string>;
    schemaOverrides: string;
    visualIdentityOverrides: string;
    automaticSync: boolean;
    syncMinutes: string;
    webSearch: boolean;
    theme: 'system' | 'light' | 'dark';
    density: 'comfortable' | 'compact';
    surfaceConfig: {
      home: {
        sectionOrder: string;
        showNowCard: boolean;
        showReviewQueue: boolean;
        reviewLimit: string;
        showRecentGraph: boolean;
        recentLimit: string;
        showLifeSpaces: boolean;
        showSourceTrust: boolean;
        showControlCard: boolean;
      };
      chat: {
        sectionOrder: string;
        showThreads: boolean;
        showSources: boolean;
        sourceLimit: string;
        promptRail: boolean;
        promptPresets: string;
        showContextCard: boolean;
        contextNote: string;
      };
      record: {
        sectionOrder: string;
        mainSectionOrder: string;
        sideSectionOrder: string;
        showHero: boolean;
        showNutrition: boolean;
        showIngredients: boolean;
        showInstructions: boolean;
        showHistory: boolean;
        showEditableNote: boolean;
        showProperties: boolean;
        showRelations: boolean;
        nutritionLimit: string;
        showProvenance: boolean;
      };
      search: {
        sectionOrder: string;
        showHero: boolean;
        showQuickActions: boolean;
        showResults: boolean;
        resultLimit: string;
        emptyHint: string;
      };
      capture: {
        sectionOrder: string;
        showHero: boolean;
        showTypePicker: boolean;
        showEditor: boolean;
        showAttachments: boolean;
        showRouteCard: boolean;
        defaultType: string;
        destinationHint: string;
      };
      sources: {
        sectionOrder: string;
        showHero: boolean;
        showMetrics: boolean;
        showNeedsReview: boolean;
        showDataHomes: boolean;
        showCitations: boolean;
        citationLimit: string;
        showSyncPlan: boolean;
        showPolicy: boolean;
        showConfigLink: boolean;
      };
      health: {
        sectionOrder: string;
        showHero: boolean;
        showStatusCard: boolean;
        showTechnicalReceipt: boolean;
        showDetails: boolean;
      };
    };
  };
};

const listeners = new Set<(settings: UtopiaSettings) => void>();
const oldCaptureDestinationDefault = 'Writes to Food local graph with no network dependency.';
const legacyUtopiaFoodDataSourceIds = [
  '3a7dace3-e35e-4ce9-b817-0b80af6e413c',
  '50f76b76-1699-4e01-ad1c-452dcf2d158f',
  '4be44ff0-908c-4c21-bb4a-0b11ffa82c1f',
  '1b18eb8e-2447-46d3-b37d-c4e7a7368d01',
  '57bf958d-98a1-42b7-9424-12507049d218',
  '610b087e-5e45-443c-bb8a-df08aac29718',
  'a406ca56-de0d-4a63-81c6-203adf8d57a5',
] as const;

export const defaultUtopiaSettings: UtopiaSettings = {
  ai: {
    primary: {
      id: 'primary',
      enabled: false,
      provider: 'openai_compatible',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: '',
      model: 'gpt-4o-mini',
      apiVersion: '',
    },
    fallback: {
      id: 'fallback',
      enabled: false,
      provider: 'openai_compatible',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
      apiKey: '',
      model: 'gemini-2.5-flash',
      apiVersion: '',
    },
  },
  notion: {
    enabled: false,
    token: '',
    pageId: '3a45dd53-5a93-81c8-bcc5-daaf19dda1cc',
    dataSourceIds: 'd9f18e59-501d-4020-a394-b33227575062,4758caaf-3f61-4f05-9850-8e75f8f26e22,0342ada7-fe6a-4188-b13f-cf37678fe549,ca253ce0-4558-412f-90b3-01d050d08f60,b11d1d47-4752-49d4-b31f-a625aa76d721,88e025fd-a4b3-4dbe-8da2-1a406e6e3446,ff584573-0d92-4145-8c3d-3e591f5970d2,17e47090-c0ee-480f-bc67-80d2590463a4,b9302602-b33b-4eec-9ecf-25f03b97f35b,9c2bcdbd-16a2-4ca3-9c01-8bc069a67179,221325fd-e376-454a-868d-ee0116c0ed13,bd5318bb-d426-44a5-9ea6-a2233479886c,72b6d3d5-6041-49e7-a5fd-f6bed68a7f7e,61bef4eb-ac70-486a-8b29-6dded5efc48f,fdb1a1c6-6d57-4e7d-be6e-31e9b5e9d389',
  },
  sheets: {
    enabled: false,
    token: '',
    workbookId: '',
    sheetName: 'Utopia',
  },
  postgres: {
    enabled: false,
    databaseUrl: '',
  },
  mcp: {
    enabled: false,
    token: '',
    url: '',
  },
  runtime: {
    activeDomain: 'food',
    enabledDomains: ['food'],
    enabledWorkflows: ['meal-plan-to-shopping', 'receipt-to-kitchen', 'weekly-food-reset'],
    enabledAgents: [],
    skillInstructions: {},
    schemaOverrides: '{}',
    visualIdentityOverrides: '{}',
    automaticSync: false,
    syncMinutes: '30',
    webSearch: true,
    theme: 'system',
    density: 'comfortable',
    surfaceConfig: {
      home: {
        sectionOrder: 'now,review,lifeSpaces,recent,sourceTrust,control',
        showNowCard: true,
        showReviewQueue: true,
        reviewLimit: '2',
        showRecentGraph: true,
        recentLimit: '4',
        showLifeSpaces: true,
        showSourceTrust: true,
        showControlCard: false,
      },
      chat: {
        sectionOrder: 'messages,promptRail',
        showThreads: true,
        showSources: false,
        sourceLimit: '8',
        promptRail: true,
        promptPresets: 'What can I cook tonight from what I already have?\nShow a table of available vs missing ingredients.\nWhat should I buy for green dal and tandoori chicken?\nSummarize nutrition and previous cooking notes.',
        showContextCard: false,
        contextNote: 'Use my connected kitchen data when I enable it.',
      },
      record: {
        sectionOrder: 'hero,nutrition,ingredients,instructions,history,editableNote,properties,relations,provenance',
        mainSectionOrder: 'nutrition,ingredients,instructions,history,editableNote',
        sideSectionOrder: 'properties,relations,provenance',
        showHero: true,
        showNutrition: true,
        showIngredients: true,
        showInstructions: true,
        showHistory: true,
        showEditableNote: true,
        showProperties: true,
        showRelations: true,
        nutritionLimit: '6',
        showProvenance: true,
      },
      search: {
        sectionOrder: 'hero,quickActions,results',
        showHero: true,
        showQuickActions: true,
        showResults: true,
        resultLimit: '8',
        emptyHint: 'Ask Utopia to search connected sources or the web.',
      },
      capture: {
        sectionOrder: 'hero,typePicker,editor,routeCard',
        showHero: true,
        showTypePicker: true,
        showEditor: true,
        showAttachments: true,
        showRouteCard: true,
        defaultType: 'Note',
        destinationHint: 'Saves to Food on this device with no network dependency.',
      },
      sources: {
        sectionOrder: 'hero,metrics,needsReview,dataHomes,citations,syncPlan,policy,configLink',
        showHero: true,
        showMetrics: true,
        showNeedsReview: true,
        showDataHomes: true,
        showCitations: true,
        citationLimit: '4',
        showSyncPlan: true,
        showPolicy: true,
        showConfigLink: true,
      },
      health: {
        sectionOrder: 'hero,status,details',
        showHero: true,
        showStatusCard: true,
        showTechnicalReceipt: false,
        showDetails: true,
      },
    },
  },
};

function normalizeProfile(
  id: AiProviderProfile['id'],
  input: Partial<AiProviderProfile> | undefined,
  fallback: AiProviderProfile,
): AiProviderProfile {
  const provider = input?.provider;
  return {
    id,
    enabled: Boolean(input?.enabled),
    provider:
      provider === 'azure_openai' || provider === 'anthropic' || provider === 'openai_compatible'
        ? provider
        : fallback.provider,
    baseUrl: typeof input?.baseUrl === 'string' ? input.baseUrl.trim() : fallback.baseUrl,
    apiKey: typeof input?.apiKey === 'string' ? input.apiKey.trim() : '',
    model: typeof input?.model === 'string' ? input.model.trim() : fallback.model,
    apiVersion: typeof input?.apiVersion === 'string' ? input.apiVersion.trim() : fallback.apiVersion,
  };
}

function normalizeSettings(input: Partial<UtopiaSettings> | null): UtopiaSettings {
  const runtime = input?.runtime;
  const notionDataSourceIds = typeof input?.notion?.dataSourceIds === 'string' ? input.notion.dataSourceIds.trim() : '';
  const strings = (value: unknown, fallback: string[]) =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : fallback;
  const skillInstructions =
    runtime?.skillInstructions && typeof runtime.skillInstructions === 'object'
      ? Object.fromEntries(
          Object.entries(runtime.skillInstructions).filter(
            (entry): entry is [string, string] => typeof entry[1] === 'string',
          ),
        )
      : {};
  return {
    ai: {
      primary: normalizeProfile('primary', input?.ai?.primary, defaultUtopiaSettings.ai.primary),
      fallback: normalizeProfile('fallback', input?.ai?.fallback, defaultUtopiaSettings.ai.fallback),
    },
    notion: {
      enabled: Boolean(input?.notion?.enabled),
      token: typeof input?.notion?.token === 'string' ? input.notion.token.trim() : '',
      pageId: typeof input?.notion?.pageId === 'string' && input.notion.pageId.trim()
        ? input.notion.pageId.trim()
        : defaultUtopiaSettings.notion.pageId,
      dataSourceIds: notionDataSourceIds && !isLegacyUtopiaFoodDataSourceList(notionDataSourceIds)
        ? notionDataSourceIds
        : defaultUtopiaSettings.notion.dataSourceIds,
    },
    sheets: {
      enabled: Boolean(input?.sheets?.enabled),
      token: typeof input?.sheets?.token === 'string' ? input.sheets.token.trim() : '',
      workbookId: typeof input?.sheets?.workbookId === 'string' ? input.sheets.workbookId.trim() : '',
      sheetName: typeof input?.sheets?.sheetName === 'string' ? input.sheets.sheetName.trim() : 'Utopia',
    },
    postgres: {
      enabled: Boolean(input?.postgres?.enabled),
      databaseUrl: typeof input?.postgres?.databaseUrl === 'string' ? input.postgres.databaseUrl.trim() : '',
    },
    mcp: {
      enabled: Boolean(input?.mcp?.enabled),
      token: typeof input?.mcp?.token === 'string' ? input.mcp.token.trim() : '',
      url: typeof input?.mcp?.url === 'string' ? input.mcp.url.trim() : '',
    },
    runtime: {
      activeDomain: typeof runtime?.activeDomain === 'string' ? runtime.activeDomain.trim() || 'food' : 'food',
      enabledDomains: strings(runtime?.enabledDomains, ['food']),
      enabledWorkflows: strings(runtime?.enabledWorkflows, defaultUtopiaSettings.runtime.enabledWorkflows),
      enabledAgents: strings(runtime?.enabledAgents, []),
      skillInstructions,
      schemaOverrides: typeof runtime?.schemaOverrides === 'string' ? runtime.schemaOverrides : '{}',
      visualIdentityOverrides: typeof runtime?.visualIdentityOverrides === 'string' ? runtime.visualIdentityOverrides : '{}',
      automaticSync: Boolean(runtime?.automaticSync),
      syncMinutes: typeof runtime?.syncMinutes === 'string' ? runtime.syncMinutes.trim() || '30' : '30',
      webSearch: runtime?.webSearch !== false,
      theme: runtime?.theme === 'light' || runtime?.theme === 'dark' ? runtime.theme : 'system',
      density: runtime?.density === 'compact' ? 'compact' : 'comfortable',
      surfaceConfig: normalizeSurfaceConfig(runtime?.surfaceConfig),
    },
  };
}

function isLegacyUtopiaFoodDataSourceList(value: string) {
  const ids = value.split(',').map((id) => id.trim()).filter(Boolean);
  return ids.length > 0 && ids.every((id) => legacyUtopiaFoodDataSourceIds.includes(id as (typeof legacyUtopiaFoodDataSourceIds)[number]));
}

function normalizePositiveString(value: unknown, fallback: string) {
  const text = typeof value === 'string' ? value.trim() : '';
  const parsed = Number.parseInt(text, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? String(parsed) : fallback;
}

function normalizeOrderString(value: unknown, fallback: string) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text.length ? text : fallback;
}

function normalizeDefaultOrder(value: unknown, fallback: string, legacy: string) {
  const text = normalizeOrderString(value, fallback);
  return text === legacy ? fallback : text;
}

function normalizeSurfaceConfig(value: unknown): UtopiaSettings['runtime']['surfaceConfig'] {
  const config = value && typeof value === 'object' ? value as Partial<UtopiaSettings['runtime']['surfaceConfig']> : {};
  const defaults = defaultUtopiaSettings.runtime.surfaceConfig;
  return {
    home: {
      sectionOrder: normalizeDefaultOrder(config.home?.sectionOrder, defaults.home.sectionOrder, 'now,review,lifeSpaces,recent,sourceTrust,control'),
      showNowCard: config.home?.showNowCard !== false,
      showReviewQueue: config.home?.showReviewQueue !== false,
      reviewLimit: normalizePositiveString(config.home?.reviewLimit, defaults.home.reviewLimit),
      showRecentGraph: config.home?.showRecentGraph !== false,
      recentLimit: normalizePositiveString(config.home?.recentLimit, defaults.home.recentLimit),
      showLifeSpaces: config.home?.showLifeSpaces !== false,
      showSourceTrust: config.home?.showSourceTrust !== false,
      showControlCard: config.home?.showControlCard !== false,
    },
    chat: {
      sectionOrder: normalizeOrderString(config.chat?.sectionOrder, defaults.chat.sectionOrder),
      showThreads: config.chat?.showThreads !== false,
      showSources: config.chat?.showSources !== false,
      sourceLimit: normalizePositiveString(config.chat?.sourceLimit, defaults.chat.sourceLimit),
      promptRail: config.chat?.promptRail !== false,
      promptPresets: typeof config.chat?.promptPresets === 'string' ? config.chat.promptPresets : defaults.chat.promptPresets,
      showContextCard: config.chat?.showContextCard !== false,
      contextNote: typeof config.chat?.contextNote === 'string' ? config.chat.contextNote : defaults.chat.contextNote,
    },
    record: {
      sectionOrder: normalizeOrderString(config.record?.sectionOrder, defaults.record.sectionOrder),
      mainSectionOrder: normalizeOrderString(config.record?.mainSectionOrder, defaults.record.mainSectionOrder),
      sideSectionOrder: normalizeOrderString(config.record?.sideSectionOrder, defaults.record.sideSectionOrder),
      showHero: config.record?.showHero !== false,
      showNutrition: config.record?.showNutrition !== false,
      showIngredients: config.record?.showIngredients !== false,
      showInstructions: config.record?.showInstructions !== false,
      showHistory: config.record?.showHistory !== false,
      showEditableNote: config.record?.showEditableNote !== false,
      showProperties: config.record?.showProperties !== false,
      showRelations: config.record?.showRelations !== false,
      nutritionLimit: normalizePositiveString(config.record?.nutritionLimit, defaults.record.nutritionLimit),
      showProvenance: config.record?.showProvenance !== false,
    },
    search: {
      sectionOrder: normalizeOrderString(config.search?.sectionOrder, defaults.search.sectionOrder),
      showHero: config.search?.showHero !== false,
      showQuickActions: config.search?.showQuickActions !== false,
      showResults: config.search?.showResults !== false,
      resultLimit: normalizePositiveString(config.search?.resultLimit, defaults.search.resultLimit),
      emptyHint: typeof config.search?.emptyHint === 'string' ? config.search.emptyHint : defaults.search.emptyHint,
    },
    capture: {
      sectionOrder: normalizeOrderString(config.capture?.sectionOrder, defaults.capture.sectionOrder),
      showHero: config.capture?.showHero !== false,
      showTypePicker: config.capture?.showTypePicker !== false,
      showEditor: config.capture?.showEditor !== false,
      showAttachments: config.capture?.showAttachments !== false,
      showRouteCard: config.capture?.showRouteCard !== false,
      defaultType: typeof config.capture?.defaultType === 'string' ? config.capture.defaultType : defaults.capture.defaultType,
      destinationHint: typeof config.capture?.destinationHint === 'string' && config.capture.destinationHint !== oldCaptureDestinationDefault ? config.capture.destinationHint : defaults.capture.destinationHint,
    },
    sources: {
      sectionOrder: normalizeOrderString(config.sources?.sectionOrder, defaults.sources.sectionOrder),
      showHero: config.sources?.showHero !== false,
      showMetrics: config.sources?.showMetrics !== false,
      showNeedsReview: config.sources?.showNeedsReview !== false,
      showDataHomes: config.sources?.showDataHomes !== false,
      showCitations: config.sources?.showCitations !== false,
      citationLimit: normalizePositiveString(config.sources?.citationLimit, defaults.sources.citationLimit),
      showSyncPlan: config.sources?.showSyncPlan !== false,
      showPolicy: config.sources?.showPolicy !== false,
      showConfigLink: config.sources?.showConfigLink !== false,
    },
    health: {
      sectionOrder: normalizeOrderString(config.health?.sectionOrder, defaults.health.sectionOrder),
      showHero: config.health?.showHero !== false,
      showStatusCard: config.health?.showStatusCard !== false,
      showTechnicalReceipt: Boolean(config.health?.showTechnicalReceipt),
      showDetails: config.health?.showDetails !== false,
    },
  };
}

async function readRaw(): Promise<string | null> {
  return readSettingsValue();
}

async function writeRaw(value: string): Promise<void> {
  await writeSettingsValue(value);
}

export async function loadUtopiaSettings(): Promise<UtopiaSettings> {
  try {
    const raw = await readRaw();
    return raw ? normalizeSettings(JSON.parse(raw) as Partial<UtopiaSettings>) : defaultUtopiaSettings;
  } catch {
    return defaultUtopiaSettings;
  }
}

export async function saveUtopiaSettings(settings: UtopiaSettings): Promise<UtopiaSettings> {
  const normalized = normalizeSettings(settings);
  await writeRaw(JSON.stringify(normalized));
  listeners.forEach((listener) => listener(normalized));
  return normalized;
}

export async function clearUtopiaCredentialState(): Promise<void> {
  const settings = await loadUtopiaSettings();
  await saveUtopiaSettings({
    ...settings,
    ai: {
      primary: { ...settings.ai.primary, apiKey: '' },
      fallback: { ...settings.ai.fallback, apiKey: '' },
    },
    notion: { ...settings.notion, token: '' },
    sheets: { ...settings.sheets, token: '' },
    postgres: { ...settings.postgres, databaseUrl: '' },
    mcp: { ...settings.mcp, token: '' },
  });
}

export function subscribeUtopiaSettings(listener: (settings: UtopiaSettings) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useUtopiaSettingsSnapshot(): UtopiaSettings {
  const [settings, setSettings] = useState(defaultUtopiaSettings);

  useEffect(() => {
    let cancelled = false;
    void loadUtopiaSettings().then((value) => {
      if (!cancelled) setSettings(value);
    });
    const unsubscribe = subscribeUtopiaSettings(setSettings);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return settings;
}

export function updateUtopiaRuntimePreferences(
  settings: UtopiaSettings,
  input: Partial<Pick<UtopiaSettings['runtime'], 'theme' | 'density'>>,
): UtopiaSettings {
  return normalizeSettings({
    ...settings,
    runtime: {
      ...settings.runtime,
      ...(input.theme ? { theme: input.theme } : {}),
      ...(input.density ? { density: input.density } : {}),
    },
  });
}

export async function saveUtopiaRuntimePreferences(
  input: Partial<Pick<UtopiaSettings['runtime'], 'theme' | 'density'>>,
): Promise<UtopiaSettings> {
  return saveUtopiaSettings(updateUtopiaRuntimePreferences(await loadUtopiaSettings(), input));
}

export type AiProviderProfileUpdate = Partial<Omit<AiProviderProfile, 'id' | 'apiKey'>> & {
  apiKey?: string;
  clearApiKey?: boolean;
};

export function updateUtopiaAiProviderProfile(
  settings: UtopiaSettings,
  id: AiProviderProfile['id'],
  patch: AiProviderProfileUpdate,
): UtopiaSettings {
  const current = settings.ai[id];
  const nextApiKey = patch.clearApiKey ? '' : typeof patch.apiKey === 'string' && patch.apiKey.trim().length > 0 ? patch.apiKey.trim() : current.apiKey;
  return normalizeSettings({
    ...settings,
    ai: {
      ...settings.ai,
      [id]: {
        ...current,
        ...patch,
        id,
        apiKey: nextApiKey,
      },
    },
  });
}

export async function saveUtopiaAiProviderProfile(
  id: AiProviderProfile['id'],
  patch: AiProviderProfileUpdate,
): Promise<UtopiaSettings> {
  return saveUtopiaSettings(updateUtopiaAiProviderProfile(await loadUtopiaSettings(), id, patch));
}

export type SourceProviderSettingsUpdate = Partial<TokenProviderSettings> & {
  clearToken?: boolean;
  pageId?: string;
  dataSourceIds?: string;
  workbookId?: string;
  sheetName?: string;
};

export function updateUtopiaSourceProviderSettings(
  settings: UtopiaSettings,
  provider: 'notion' | 'sheets',
  patch: SourceProviderSettingsUpdate,
): UtopiaSettings {
  const current = settings[provider];
  const nextToken = patch.clearToken ? '' : typeof patch.token === 'string' && patch.token.trim().length > 0 ? patch.token.trim() : current.token;
  return normalizeSettings({
    ...settings,
    [provider]: {
      ...current,
      ...patch,
      enabled: patch.enabled ?? current.enabled,
      token: nextToken,
    },
  });
}

export async function saveUtopiaSourceProviderSettings(
  provider: 'notion' | 'sheets',
  patch: SourceProviderSettingsUpdate,
): Promise<UtopiaSettings> {
  return saveUtopiaSettings(updateUtopiaSourceProviderSettings(await loadUtopiaSettings(), provider, patch));
}

export function maskSecret(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return 'Not set';
  if (trimmed.length <= 8) return '••••';
  return `${trimmed.slice(0, 3)}••••${trimmed.slice(-4)}`;
}

export function usableAiProfiles(settings: UtopiaSettings): AiProviderProfile[] {
  return [settings.ai.primary, settings.ai.fallback].filter(
    (profile) =>
      profile.enabled &&
      profile.baseUrl.trim().length > 0 &&
      profile.apiKey.trim().length > 0 &&
      profile.model.trim().length > 0,
  );
}

export function providerLabel(profile: AiProviderProfile): string {
  if (profile.provider === 'azure_openai') return `Azure · ${profile.model || 'deployment'}`;
  if (profile.provider === 'anthropic') return `Anthropic · ${profile.model || 'model'}`;
  const base = profile.baseUrl.toLowerCase();
  const vendor = base.includes('openrouter')
    ? 'OpenRouter'
    : base.includes('generativelanguage.googleapis.com')
      ? 'Gemini'
      : base.includes('api.openai.com')
        ? 'OpenAI'
        : 'OpenAI-compatible';
  return `${vendor} · ${profile.model || 'model'}`;
}
