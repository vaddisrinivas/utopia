import type {
  ConfigSource,
  ConfigSourceKind,
  ConfigSnapshot,
  ConfigValidationError,
} from '@/src/config/types';

type FetchResponseLike = {
  ok: boolean;
  status: number;
  text: () => Promise<string>;
  json?: () => Promise<unknown>;
};

export type ConfigFetcher = (url: string, init?: RequestInit) => Promise<FetchResponseLike>;

export type ConfigCredentials = Partial<Record<ConfigSourceKind, string>>;

export type ConfigFetchInput = {
  source: ConfigSource;
  now?: string;
  fetcher?: ConfigFetcher;
  localFiles?: Record<string, string>;
  credentials?: ConfigCredentials;
};

export type ConfigFetchResult =
  | { ok: true; source: ConfigSource; snapshot: ConfigSnapshot }
  | { ok: false; source: ConfigSource; error: ConfigValidationError };

type RemoteRequest = {
  url: string;
  init?: RequestInit;
  parse?: (response: FetchResponseLike) => Promise<string>;
};

export function registeredConfigSourceKinds(): ConfigSourceKind[] {
  return ['local', 'github', 'url', 'notion', 'sheets'];
}

export async function fetchConfigSource(input: ConfigFetchInput): Promise<ConfigFetchResult> {
  try {
    const raw = await readRawConfig(input);
    const fetchedAt = input.now ?? new Date().toISOString();
    return {
      ok: true,
      source: input.source,
      snapshot: {
        source_id: input.source.id,
        fetched_at: fetchedAt,
        content_hash: contentHash(raw),
        raw,
        validation_status: 'unvalidated',
      },
    };
  } catch (error) {
    return {
      ok: false,
      source: input.source,
      error: {
        code: 'CONFIG_FETCH_FAILED',
        message: error instanceof Error ? error.message : 'Config fetch failed.',
      },
    };
  }
}

async function readRawConfig(input: ConfigFetchInput): Promise<string> {
  switch (input.source.kind) {
    case 'local':
      return readLocalConfig(input);
    case 'github':
    case 'url':
    case 'notion':
    case 'sheets':
      return readRemoteConfig(input, buildRemoteRequest(input));
    default:
      return assertNever(input.source.kind);
  }
}

function readLocalConfig(input: ConfigFetchInput): string {
  if (!('path' in input.source.location)) {
    throw new Error('Local config source requires a path.');
  }
  const raw = input.localFiles?.[input.source.location.path];
  if (raw == null) {
    throw new Error(`Local config source not available: ${input.source.location.path}`);
  }
  return raw;
}

function buildRemoteRequest(input: ConfigFetchInput): RemoteRequest {
  const { source } = input;
  if (source.kind === 'url') {
    if (!('url' in source.location)) throw new Error('URL config source requires a URL.');
    return { url: source.location.url };
  }

  if (source.kind === 'github') {
    if (!('owner' in source.location)) throw new Error('GitHub config source requires owner/repo/path.');
    const ref = source.location.ref || 'main';
    return {
      url: `https://raw.githubusercontent.com/${encodeURIComponent(source.location.owner)}/${encodeURIComponent(source.location.repo)}/${encodeURIComponent(ref)}/${source.location.path.split('/').map(encodeURIComponent).join('/')}`,
      init: bearerHeaders(input.credentials?.github),
    };
  }

  if (source.kind === 'notion') {
    const token = requireCredential(input, 'notion');
    if ('data_source_id' in source.location && source.location.data_source_id) {
      return {
        url: `https://api.notion.com/v1/data_sources/${encodeURIComponent(source.location.data_source_id)}/query`,
        init: {
          method: 'POST',
          headers: notionHeaders(token),
          body: JSON.stringify({ page_size: 100 }),
        },
        parse: async (response) => JSON.stringify(await response.json?.(), null, 2),
      };
    }
    if ('database_id' in source.location && source.location.database_id) {
      return {
        url: `https://api.notion.com/v1/databases/${encodeURIComponent(source.location.database_id)}/query`,
        init: {
          method: 'POST',
          headers: notionHeaders(token),
          body: JSON.stringify({ page_size: 100 }),
        },
        parse: async (response) => JSON.stringify(await response.json?.(), null, 2),
      };
    }
    if ('page_id' in source.location && source.location.page_id) {
      return {
        url: `https://api.notion.com/v1/blocks/${encodeURIComponent(source.location.page_id)}/children?page_size=100`,
        init: { headers: notionHeaders(token) },
        parse: async (response) => notionBlocksToPlainText(await response.json?.()),
      };
    }
    throw new Error('Notion config source requires a page, database, or data source ID.');
  }

  if (source.kind === 'sheets') {
    const token = requireCredential(input, 'sheets');
    if (!('spreadsheet_id' in source.location)) throw new Error('Sheets config source requires a spreadsheet ID.');
    const range = source.location.range || `${source.location.sheet || 'Utopia Config'}!A:Z`;
    return {
      url: `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(source.location.spreadsheet_id)}/values/${encodeURIComponent(range)}`,
      init: bearerHeaders(token),
      parse: async (response) => sheetsValuesToText(await response.json?.()),
    };
  }

  throw new Error(`Remote config fetch is not available for ${source.kind}.`);
}

async function readRemoteConfig(input: ConfigFetchInput, request: RemoteRequest): Promise<string> {
  const fetcher = input.fetcher ?? fetch;
  const response = await fetcher(request.url, request.init);
  if (!response.ok) {
    throw new Error(`${input.source.kind} config fetch failed with HTTP ${response.status}.`);
  }
  return request.parse ? request.parse(response) : response.text();
}

function requireCredential(input: ConfigFetchInput, kind: ConfigSourceKind): string {
  const token = input.credentials?.[kind]?.trim();
  if (!token) throw new Error(`${kind} config credential is missing.`);
  return token;
}

function bearerHeaders(token: string | undefined): RequestInit {
  const trimmed = token?.trim();
  return trimmed ? { headers: { authorization: `Bearer ${trimmed}` } } : {};
}

function notionHeaders(token: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
    'notion-version': '2026-03-11',
  };
}

function notionBlocksToPlainText(payload: unknown): string {
  const results = typeof payload === 'object' && payload != null && 'results' in payload
    ? (payload as { results?: unknown[] }).results ?? []
    : [];
  return results.map((block) => {
    const candidate = block as Record<string, any>;
    const type = typeof candidate.type === 'string' ? candidate.type : '';
    const richText = candidate[type]?.rich_text;
    if (!Array.isArray(richText)) return '';
    return richText.map((part) => part?.plain_text ?? '').join('');
  }).filter(Boolean).join('\n');
}

function sheetsValuesToText(payload: unknown): string {
  const values = typeof payload === 'object' && payload != null && 'values' in payload
    ? (payload as { values?: unknown[][] }).values ?? []
    : [];
  return values.map((row) => row.map((cell) => String(cell ?? '')).join(',')).join('\n');
}

function contentHash(raw: string): string {
  let hash = 2166136261;
  for (let index = 0; index < raw.length; index += 1) {
    hash ^= raw.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function assertNever(value: never): never {
  throw new Error(`Unsupported config source kind: ${value}`);
}
