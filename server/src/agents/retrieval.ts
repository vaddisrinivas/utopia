import { listRecords } from '../runtime/state';
import { pullNotionRecordsLive } from '../providers/notion/pull';
import { pullSheetsRecordsLive } from '../providers/sheets/pull';

export type RetrievalProvider = 'notion' | 'google_sheets';
export type RetrievalFactSensitivity = 'general' | 'personal';
export type RetrievalFreshnessSource = 'local' | 'live' | 'cache';

export type RetrievalFreshness = {
  provider: string;
  source: RetrievalFreshnessSource;
  status: 'fresh' | 'stale' | 'unknown';
  fetchedAt: string | null;
  staleAt: string | null;
  observedAt?: string | null;
  note?: string;
};

export type RetrievalSnapshot = {
  id: string;
  label: string;
  detail: string;
  url: string;
  tone: 'moss' | 'blue' | 'amber';
  score: number;
  excerpt?: string;
  freshness?: RetrievalFreshness;
};

export type RetrievalResult = {
  query: string;
  domain: string;
  snapshots: RetrievalSnapshot[];
};

export type RetrievalProjectedFact = {
  field: string;
  sensitivity: RetrievalFactSensitivity;
  value: string;
};

type RetrievalRuntimeConfig = {
  cacheTtlMs: number;
  circuitFailureThreshold: number;
  circuitOpenMs: number;
  maxConcurrentProviders: number;
  maxSelectedProviders: number;
  maxProviderRecords: number;
  maxProviderSnapshots: number;
  notionTimeoutMs: number;
  sheetsTimeoutMs: number;
};

type ProviderState = {
  consecutiveFailures: number;
  openedUntil: number;
  lastFailureAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
};

type ProviderLiveResult = {
  provider: RetrievalProvider;
  status: 'ready' | 'disabled';
  configured: boolean;
  records: Array<{ id: string; title: string; collection: string; properties: Record<string, unknown>; source?: Record<string, unknown> }>;
  source_snapshots: unknown[];
  message: string;
  status_code?: number;
  error?: string | null;
  freshness: RetrievalFreshness;
};

type CachedProviderLiveResult = {
  key: string;
  expiresAt: number;
  result: ProviderLiveResult;
};

const DEFAULT_CACHE_TTL_MS = 30_000;
const DEFAULT_CIRCUIT_FAILURE_THRESHOLD = 2;
const DEFAULT_CIRCUIT_OPEN_MS = 60_000;
const DEFAULT_MAX_CONCURRENT_PROVIDERS = 1;
const DEFAULT_MAX_SELECTED_PROVIDERS = 2;
const DEFAULT_MAX_PROVIDER_RECORDS = 24;
const DEFAULT_MAX_PROVIDER_SNAPSHOTS = 4;
const DEFAULT_PROVIDER_TIMEOUT_MS = 6_000;

const SECRET_FIELD_PATTERNS = [
  /(^|[._-])(secret|token|api[_-]?key|auth|password|credential|cookie)($|[._-])/i,
  /(^|[._-])(provider[_-]?snapshot|raw[_-]?snapshot|snapshot|json|payload|body|prompt|instruction)($|[._-])/i,
];

const PROMPT_INJECTION_PATTERNS = [
  /\bignore\b.{0,32}\b(instruction|system|previous|developer|tool)\b/i,
  /\b(disregard|override)\b.{0,32}\b(instruction|system|tool)\b/i,
  /\btool[_ -]?call\b/i,
  /<\|/,
];

const ALLOWLISTED_FACT_PATTERNS: Array<{
  pattern: RegExp;
  sensitivity: RetrievalFactSensitivity;
}> = [
  { pattern: /(^|[._-])(status|state|ready|availability)($|[._-])/i, sensitivity: 'general' },
  { pattern: /(^|[._-])(quantity|count|amount|unit|servings)($|[._-])/i, sensitivity: 'general' },
  { pattern: /(^|[._-])(aisle|location|category|type|kind|brand|meal)($|[._-])/i, sensitivity: 'general' },
  { pattern: /(^|[._-])(expires|expires_at|use_by|best_by|updated_at|created_at|scheduled_for)($|[._-])/i, sensitivity: 'personal' },
  { pattern: /(^|[._-])(calories|protein|fat|carbs|fiber|price|cost|currency|minutes|cook_time|prep_time)($|[._-])/i, sensitivity: 'personal' },
];

const PROVIDER_SELECTION_PATTERNS: Record<RetrievalProvider, RegExp[]> = {
  notion: [/\bnotion\b/i, /\bpage\b/i, /\bdatabase\b/i],
  google_sheets: [/\bgoogle\s*sheets\b/i, /\bsheets?\b/i, /\bspreadsheet\b/i, /\bworkbook\b/i],
};

const AUTHORITY_SELECTION_PATTERN = /\b(authority|authoritative|provider|source|live|sync|canonical)\b/i;
const providerCache = new Map<string, CachedProviderLiveResult>();
const providerState = new Map<RetrievalProvider, ProviderState>();

function positiveInteger(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw?.trim());
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function readRetrievalRuntimeConfig(): RetrievalRuntimeConfig {
  return {
    cacheTtlMs: positiveInteger(process.env.LIFEOS_RETRIEVAL_CACHE_TTL_MS, DEFAULT_CACHE_TTL_MS),
    circuitFailureThreshold: positiveInteger(process.env.LIFEOS_RETRIEVAL_CIRCUIT_FAILURE_THRESHOLD, DEFAULT_CIRCUIT_FAILURE_THRESHOLD),
    circuitOpenMs: positiveInteger(process.env.LIFEOS_RETRIEVAL_CIRCUIT_OPEN_MS, DEFAULT_CIRCUIT_OPEN_MS),
    maxConcurrentProviders: positiveInteger(process.env.LIFEOS_RETRIEVAL_MAX_CONCURRENT_PROVIDERS, DEFAULT_MAX_CONCURRENT_PROVIDERS),
    maxSelectedProviders: positiveInteger(process.env.LIFEOS_RETRIEVAL_MAX_SELECTED_PROVIDERS, DEFAULT_MAX_SELECTED_PROVIDERS),
    maxProviderRecords: positiveInteger(process.env.LIFEOS_RETRIEVAL_MAX_PROVIDER_RECORDS, DEFAULT_MAX_PROVIDER_RECORDS),
    maxProviderSnapshots: positiveInteger(process.env.LIFEOS_RETRIEVAL_MAX_PROVIDER_SNAPSHOTS, DEFAULT_MAX_PROVIDER_SNAPSHOTS),
    notionTimeoutMs: positiveInteger(process.env.LIFEOS_RETRIEVAL_NOTION_TIMEOUT_MS, DEFAULT_PROVIDER_TIMEOUT_MS),
    sheetsTimeoutMs: positiveInteger(process.env.LIFEOS_RETRIEVAL_SHEETS_TIMEOUT_MS, DEFAULT_PROVIDER_TIMEOUT_MS),
  };
}

function formatCitationDetail(input: {
  collection: string;
  sourceProvider: string;
  sourceExternalId: string;
  updatedAt: string;
}) {
  const parts = [input.collection, input.sourceProvider];
  if (input.sourceExternalId) {
    parts.push(input.sourceExternalId);
  }
  if (input.updatedAt) {
    parts.push(`updated ${input.updatedAt}`);
  }
  return parts.join(' · ');
}

function fallbackRecordUrl(record: { source: { provider: string }; domain: string; id: string }) {
  const encodedId = encodeURIComponent(record.id);
  const encodedDomain = encodeURIComponent(record.domain);

  if (record.source.provider === 'notion') {
    return `utopia://notion/record/${encodedDomain}/${encodedId}`;
  }

  if (record.source.provider === 'google_sheets') {
    return `utopia://sheets/record/${encodedDomain}/${encodedId}`;
  }

  return `utopia://record/${encodedDomain}/${encodedId}`;
}

function toneForProvider(provider: string): 'moss' | 'blue' | 'amber' {
  switch (provider.toLowerCase()) {
    case 'notion':
      return 'moss';
    case 'google_sheets':
      return 'blue';
    default:
      return 'amber';
  }
}

function compactValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(compactValue).filter(Boolean).join(', ');
  if (typeof value === 'object') {
    const candidate = value as Record<string, unknown>;
    for (const key of ['plain_text', 'name', 'content', 'number', 'url']) {
      if (key in candidate) {
        const text = compactValue(candidate[key]);
        if (text) return text;
      }
    }
  }
  return '';
}

function normalizeFactField(field: string): string {
  return field.trim().replace(/\s+/g, '_').replace(/[^A-Za-z0-9_.-]/g, '').toLowerCase();
}

function isSecretField(field: string): boolean {
  return SECRET_FIELD_PATTERNS.some((pattern) => pattern.test(field));
}

function looksLikePromptInjection(text: string): boolean {
  return PROMPT_INJECTION_PATTERNS.some((pattern) => pattern.test(text));
}

function classifyFactField(field: string): RetrievalFactSensitivity | null {
  const normalized = normalizeFactField(field);
  if (!normalized || isSecretField(normalized)) {
    return null;
  }
  const match = ALLOWLISTED_FACT_PATTERNS.find(({ pattern }) => pattern.test(normalized));
  return match?.sensitivity ?? null;
}

function sanitizeFactText(value: unknown): string {
  const text = compactValue(value)
    .replace(/\s+/g, ' ')
    .replace(/[<>{}`]/g, '')
    .trim();
  if (!text || looksLikePromptInjection(text)) {
    return '';
  }
  return text.slice(0, 120);
}

function cacheKeyForProvider(provider: RetrievalProvider, input: { domain: string; collection?: string; limit: number }) {
  return [provider, input.domain, input.collection ?? '', String(input.limit)].join(':');
}

function providerLabel(provider: RetrievalProvider): string {
  return provider === 'notion' ? 'Notion' : 'Google Sheets';
}

function providerTimeoutMs(provider: RetrievalProvider, config: RetrievalRuntimeConfig): number {
  return provider === 'notion' ? config.notionTimeoutMs : config.sheetsTimeoutMs;
}

function providerStateFor(provider: RetrievalProvider): ProviderState {
  const current = providerState.get(provider);
  if (current) return current;
  const initial: ProviderState = {
    consecutiveFailures: 0,
    openedUntil: 0,
    lastFailureAt: null,
    lastSuccessAt: null,
    lastError: null,
  };
  providerState.set(provider, initial);
  return initial;
}

function recordProviderSuccess(provider: RetrievalProvider, at: string): void {
  providerState.set(provider, {
    consecutiveFailures: 0,
    openedUntil: 0,
    lastFailureAt: providerStateFor(provider).lastFailureAt,
    lastSuccessAt: at,
    lastError: null,
  });
}

function recordProviderFailure(
  provider: RetrievalProvider,
  input: { at: string; error: string; failureThreshold: number; openMs: number },
): void {
  const current = providerStateFor(provider);
  const failures = current.consecutiveFailures + 1;
  providerState.set(provider, {
    consecutiveFailures: failures,
    openedUntil: failures >= input.failureThreshold ? Date.now() + input.openMs : 0,
    lastFailureAt: input.at,
    lastSuccessAt: current.lastSuccessAt,
    lastError: input.error,
  });
}

function freshStatus(fetchedAt: string | null, staleAt: string | null): RetrievalFreshness['status'] {
  if (!fetchedAt || !staleAt) return 'unknown';
  return Date.parse(staleAt) > Date.now() ? 'fresh' : 'stale';
}

function freshnessLabel(freshness: RetrievalFreshness): string {
  const source = freshness.source === 'cache'
    ? 'cached'
    : freshness.source === 'live'
      ? 'live'
      : 'local';
  const parts = [source];
  if (freshness.fetchedAt) {
    parts.push(`fetched ${freshness.fetchedAt}`);
  } else if (freshness.observedAt) {
    parts.push(`observed ${freshness.observedAt}`);
  }
  if (freshness.note) {
    parts.push(freshness.note);
  }
  return parts.join(' · ');
}

function cloneProviderResult(result: ProviderLiveResult): ProviderLiveResult {
  return {
    ...result,
    records: [...result.records],
    source_snapshots: [...result.source_snapshots],
    freshness: { ...result.freshness },
  };
}

function providerFailureMessage(provider: RetrievalProvider, error: string): string {
  return `${providerLabel(provider)} retrieval unavailable right now.`;
}

function createDisabledProviderResult(
  provider: RetrievalProvider,
  input: {
    configured: boolean;
    message: string;
    error?: string | null;
    statusCode?: number;
    freshness: RetrievalFreshness;
  },
): ProviderLiveResult {
  return {
    provider,
    status: 'disabled',
    configured: input.configured,
    records: [],
    source_snapshots: [],
    message: input.message,
    error: input.error ?? null,
    status_code: input.statusCode,
    freshness: input.freshness,
  };
}

function providerResultShouldTripCircuit(result: ProviderLiveResult): boolean {
  if (result.status === 'ready') return false;
  if (!result.configured) return false;
  if (result.status_code && result.status_code >= 400 && result.status_code < 500 && result.status_code !== 429) {
    return false;
  }
  const errorText = `${result.error ?? ''} ${result.message}`.toLowerCase();
  return result.status_code === 0
    || result.status_code === undefined
    || result.status_code === 429
    || /timeout|timed out|abort|temporarily|unavailable|error/i.test(errorText);
}

async function withProviderTimeout<T>(
  timeoutMs: number,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new Error(`Provider timed out after ${timeoutMs}ms`));
  }, timeoutMs);
  try {
    return await run(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

async function callLiveProvider(
  provider: RetrievalProvider,
  input: { domain: string; limit: number; config: RetrievalRuntimeConfig },
): Promise<ProviderLiveResult> {
  const now = new Date();
  const nowIso = now.toISOString();
  const circuit = providerStateFor(provider);
  if (circuit.openedUntil > Date.now()) {
    return createDisabledProviderResult(provider, {
      configured: true,
      message: `${providerLabel(provider)} retrieval paused after repeated failures.`,
      error: circuit.lastError ?? 'circuit_open',
      freshness: {
        provider,
        source: 'live',
        status: 'stale',
        fetchedAt: circuit.lastFailureAt,
        staleAt: new Date(circuit.openedUntil).toISOString(),
        note: 'circuit open',
      },
    });
  }

  const key = cacheKeyForProvider(provider, { domain: input.domain, limit: input.limit });
  const cached = providerCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    const result = cloneProviderResult(cached.result);
    result.freshness = {
      ...result.freshness,
      source: 'cache',
      status: freshStatus(result.freshness.fetchedAt, result.freshness.staleAt),
      note: 'cache hit',
    };
    return result;
  }

  try {
    const live = provider === 'notion'
      ? await withProviderTimeout(providerTimeoutMs(provider, input.config), (signal) => pullNotionRecordsLive({
        domain: input.domain,
        limit: input.limit,
        signal,
      }))
      : await withProviderTimeout(providerTimeoutMs(provider, input.config), (signal) => pullSheetsRecordsLive({
        domain: input.domain,
        limit: input.limit,
        signal,
      }));

    const freshness: RetrievalFreshness = {
      provider,
      source: 'live',
      status: 'fresh',
      fetchedAt: nowIso,
      staleAt: new Date(Date.now() + input.config.cacheTtlMs).toISOString(),
    };
    const result: ProviderLiveResult = {
      provider,
      status: live.status,
      configured: live.configured,
      records: live.records,
      source_snapshots: live.source_snapshots,
      message: live.message,
      status_code: live.status_code,
      error: live.error ?? null,
      freshness,
    };
    if (result.status === 'ready') {
      providerCache.set(key, {
        key,
        expiresAt: Date.now() + input.config.cacheTtlMs,
        result: cloneProviderResult(result),
      });
      recordProviderSuccess(provider, nowIso);
      return result;
    }
    if (providerResultShouldTripCircuit(result)) {
      recordProviderFailure(provider, {
        at: nowIso,
        error: result.error || result.message,
        failureThreshold: input.config.circuitFailureThreshold,
        openMs: input.config.circuitOpenMs,
      });
    }
    return {
      ...result,
      freshness: {
        ...freshness,
        status: 'stale',
        note: result.error ?? result.message,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : `unknown_${provider}_retrieval_failure`;
    recordProviderFailure(provider, {
      at: nowIso,
      error: message,
      failureThreshold: input.config.circuitFailureThreshold,
      openMs: input.config.circuitOpenMs,
    });
    return createDisabledProviderResult(provider, {
      configured: true,
      message: providerFailureMessage(provider, message),
      error: message,
      statusCode: 0,
      freshness: {
        provider,
        source: 'live',
        status: 'stale',
        fetchedAt: nowIso,
        staleAt: new Date(Date.now() + input.config.circuitOpenMs).toISOString(),
        note: 'timeout or transport failure',
      },
    });
  }
}

async function mapWithConcurrency<T, U>(
  values: readonly T[],
  concurrency: number,
  run: (value: T, index: number) => Promise<U>,
): Promise<U[]> {
  const limit = Math.max(1, concurrency);
  const out = new Array<U>(values.length);
  let cursor = 0;
  async function worker() {
    while (cursor < values.length) {
      const index = cursor++;
      out[index] = await run(values[index], index);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, values.length) }, () => worker()),
  );
  return out;
}

export function resetRetrievalRuntimeForTests(): void {
  providerCache.clear();
  providerState.clear();
}

export function projectPromptFacts(properties: Record<string, unknown>): RetrievalProjectedFact[] {
  const out: RetrievalProjectedFact[] = [];
  const visit = (prefix: string, value: unknown, depth: number) => {
    if (depth > 2 || value === null || value === undefined) {
      return;
    }
    if (Array.isArray(value)) {
      const text = sanitizeFactText(value);
      const sensitivity = classifyFactField(prefix);
      if (text && sensitivity) {
        out.push({ field: normalizeFactField(prefix), sensitivity, value: text });
      }
      return;
    }
    if (typeof value === 'object') {
      for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
        const nextPrefix = prefix ? `${prefix}.${key}` : key;
        if (isSecretField(nextPrefix)) {
          continue;
        }
        visit(nextPrefix, nested, depth + 1);
      }
      return;
    }
    const sensitivity = classifyFactField(prefix);
    const text = sanitizeFactText(value);
    if (!sensitivity || !text) {
      return;
    }
    out.push({
      field: normalizeFactField(prefix),
      sensitivity,
      value: text,
    });
  };

  for (const [key, value] of Object.entries(properties)) {
    if (['notion', 'relations', 'unsupported', 'provider_snapshot'].includes(key.toLowerCase())) {
      continue;
    }
    visit(key, value, 0);
  }

  const seen = new Set<string>();
  return out
    .filter((fact) => {
      const key = `${fact.field}:${fact.value}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 8);
}

export function renderPromptFacts(properties: Record<string, unknown>): string {
  return projectPromptFacts(properties)
    .map((fact) => `[${fact.sensitivity}] ${fact.field} = ${fact.value}`)
    .join('\n');
}

export function selectRetrievalProviders(query: string): RetrievalProvider[] {
  const trimmed = query.trim();
  if (!trimmed) {
    return [];
  }

  const selected = (Object.entries(PROVIDER_SELECTION_PATTERNS) as Array<[RetrievalProvider, RegExp[]]>)
    .filter(([, patterns]) => patterns.some((pattern) => pattern.test(trimmed)))
    .map(([provider]) => provider);

  if (selected.length > 0) {
    return selected;
  }

  if (AUTHORITY_SELECTION_PATTERN.test(trimmed)) {
    const authority = process.env.LIFEOS_AUTHORITY_PROVIDER?.trim().toLowerCase();
    if (authority === 'google_sheets') {
      return ['google_sheets'];
    }
    if (authority === 'notion') {
      return ['notion'];
    }
  }

  return [];
}

export async function runRetrieval(input: { query: string; domain: string }): Promise<RetrievalResult> {
  const config = readRetrievalRuntimeConfig();
  const trimmedQuery = input.query.trim();
  const hasQuery = trimmedQuery.length > 0;
  const recordLimit = 6;
  const recordQuery = hasQuery
    ? listRecords({
      domain: input.domain,
      includeArchived: false,
      query: trimmedQuery,
      limit: recordLimit,
    })
    : listRecords({
      domain: input.domain,
      includeArchived: false,
      limit: recordLimit,
    });

  const localSnapshots: RetrievalSnapshot[] = recordQuery
    .map((record, index) => {
      const freshness: RetrievalFreshness = {
        provider: record.source.provider,
        source: 'local',
        status: 'unknown',
        fetchedAt: record.updated_at,
        staleAt: null,
        observedAt: record.source.observed_at,
      };
      return {
        id: record.id,
        label: record.title || record.id,
        detail: `${formatCitationDetail({
          collection: record.collection,
          sourceProvider: record.source.provider,
          sourceExternalId: record.source.external_id,
          updatedAt: record.updated_at,
        })} · ${freshnessLabel(freshness)}`,
        url: record.source.url || fallbackRecordUrl(record),
        tone: toneForProvider(record.source.provider),
        score: Number((1 - index * 0.1).toFixed(1)),
        excerpt: renderPromptFacts(record.properties),
        freshness,
      };
    })
    .filter((snapshot) => snapshot.label.trim().length > 0 && snapshot.id.trim().length > 0);

  const selectedProviders = [...new Set(selectRetrievalProviders(trimmedQuery))]
    .slice(0, config.maxSelectedProviders);
  const needle = trimmedQuery.toLowerCase();
  const stopWords = new Set(['what', 'which', 'where', 'when', 'does', 'about', 'the', 'this', 'that', 'item', 'canonical', 'please', 'tell', 'show', 'give', 'with', 'from', 'live', 'spreadsheet']);
  const queryTerms = needle.split(/[^a-z0-9_]+/).filter((term) => term.length > 2 && !stopWords.has(term));

  function providerSnapshots(
    records: Array<{ id: string; title: string; collection: string; properties: Record<string, unknown>; source?: Record<string, unknown> }>,
    result: ProviderLiveResult,
  ): RetrievalSnapshot[] {
    return records
      .map((record, index) => {
        const projectedFacts = projectPromptFacts(record.properties);
        const searchable = [
          record.title,
          record.collection,
          ...projectedFacts.map((fact) => `${fact.field} ${fact.value}`),
        ].join(' ').toLowerCase();
        const matchCount = queryTerms.filter((term) => searchable.includes(term)).length;
        const externalId = typeof record.source?.external_id === 'string' ? record.source.external_id : record.id;
        return {
          id: record.id,
          label: record.title || record.id,
          detail: `${record.collection} · ${providerLabel(result.provider).toLowerCase()} · ${externalId} · ${freshnessLabel(result.freshness)}`,
          url: result.provider === 'notion'
            ? `utopia://notion/page/${encodeURIComponent(record.id)}`
            : `utopia://sheets/record/${encodeURIComponent(input.domain)}/${encodeURIComponent(record.id)}`,
          tone: result.provider === 'notion' ? 'moss' as const : 'blue' as const,
          score: queryTerms.length > 0
            ? Number((matchCount / queryTerms.length + (matchCount > 0 ? 0.1 : 0)).toFixed(2))
            : Number((0.6 - index * 0.05).toFixed(2)),
          matchCount,
          excerpt: projectedFacts
            .map((fact) => `[${fact.sensitivity}] ${fact.field} = ${fact.value}`)
            .join('\n'),
          freshness: { ...result.freshness },
          searchable,
        };
      })
      .filter((snapshot) => queryTerms.length === 0 || snapshot.matchCount > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, config.maxProviderSnapshots)
      .map(({ searchable: _searchable, matchCount: _matchCount, ...snapshot }) => snapshot);
  }

  const providerResults = await mapWithConcurrency(selectedProviders, config.maxConcurrentProviders, async (provider) => {
    return callLiveProvider(provider, {
      domain: input.domain,
      limit: Math.max(recordLimit, config.maxProviderRecords),
      config,
    });
  });

  const providerSources = providerResults
    .filter((result) => result.status === 'ready')
    .flatMap((result) => providerSnapshots(result.records, result))
    .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label))
    .slice(0, config.maxProviderSnapshots);

  const dedupedProviderSources = providerSources
    .filter((snapshot, index, all) => all.findIndex((candidate) => candidate.id === snapshot.id && candidate.tone === snapshot.tone) === index);
  const mergedSources = [...localSnapshots, ...dedupedProviderSources]
    .filter((snapshot, index, all) => all.findIndex((candidate) => candidate.id === snapshot.id && candidate.tone === snapshot.tone) === index)
    .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label) || a.tone.localeCompare(b.tone))
    .slice(0, recordLimit);

  if (mergedSources.length > 0) {
    return {
      query: input.query,
      domain: input.domain,
      snapshots: mergedSources,
    };
  }

  const degradedProviderSnapshots = providerResults
    .filter((result) => result.status !== 'ready')
    .slice(0, recordLimit)
    .map((result, index): RetrievalSnapshot => ({
      id: `provider:${result.provider}:${index}`,
      label: providerLabel(result.provider),
      detail: `${result.message} · ${freshnessLabel(result.freshness)}`,
      url: 'utopia://app/sources',
      tone: toneForProvider(result.provider),
      score: 0.2,
      freshness: result.freshness,
    }));

  if (degradedProviderSnapshots.length > 0) {
    return {
      query: input.query,
      domain: input.domain,
      snapshots: degradedProviderSnapshots,
    };
  }

  if (!hasQuery) {
    return {
      query: input.query,
      domain: input.domain,
      snapshots: [
        {
          id: `domain:${input.domain}`,
          label: input.domain || 'utopia-domain',
          detail: 'No authority rows yet. Open Sources to connect Notion or Sheets.',
          url: 'utopia://app/sources',
          tone: 'moss',
          score: 0.5,
        },
      ],
    };
  }

  return {
    query: input.query,
    domain: input.domain,
    snapshots: [],
  };
}
