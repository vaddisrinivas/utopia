import { Client as NotionClient } from '@notionhq/client';

export const NOTION_API_VERSION = '2026-03-11';
export const NOTION_BASE_URL = process.env.NOTION_BASE_URL?.trim() || 'https://api.notion.com/v1';
export const NOTION_DATA_SOURCE_QUERY_PATH = '/data_sources/{data_source_id}/query';
export const NOTION_REQUEST_TIMEOUT_MS = 15000;
const DEFAULT_RETRY_ATTEMPTS = 2;
const DEFAULT_RETRY_BASE_DELAY_MS = 250;

export type NotionClientConfig = {
  token: string;
  apiVersion: string;
  dataSourceId?: string;
  webhookSigningSecret?: string;
  requestTrace?: string;
};

export type NotionHeaderMap = Record<string, string>;
export type NotionApiError = {
  status: number;
  message: string;
  body: unknown;
};

export type NotionApiResponse<T> = {
  ok: boolean;
  status: number;
  data?: T;
  error?: NotionApiError;
};

export function readNotionConfig(): NotionClientConfig | null {
  const token = process.env.NOTION_TOKEN?.trim() || process.env.NOTION_API_KEY?.trim();
  if (!token) {
    return null;
  }

  return {
    token,
    apiVersion: NOTION_API_VERSION,
    dataSourceId: process.env.NOTION_DATA_SOURCE_ID?.trim() || undefined,
    webhookSigningSecret: process.env.NOTION_WEBHOOK_SIGNING_SECRET?.trim() || undefined,
    requestTrace: process.env.NOTION_REQUEST_TRACE || undefined,
  };
}

export function createOfficialNotionClient(config?: NotionClientConfig): NotionClient | null {
  const resolved = config ?? readNotionConfig();
  if (!resolved) {
    return null;
  }
  return new NotionClient({
    auth: resolved.token,
    notionVersion: resolved.apiVersion,
  });
}

export function isNotionConfigured(): boolean {
  return readNotionConfig() !== null;
}

export function getNotionHeaders(config?: NotionClientConfig) {
  const resolved = config ?? readNotionConfig();
  if (!resolved) {
    return null;
  }

  return {
    Authorization: `Bearer ${resolved.token}`,
    'Notion-Version': resolved.apiVersion,
    'Content-Type': 'application/json',
  };
}

export function notionDataSourceId(config?: NotionClientConfig) {
  return (config ?? readNotionConfig())?.dataSourceId;
}

export function notionHeadersSafe() {
  const headers = getNotionHeaders();
  if (!headers) {
    return null;
  }
  return {
    ...headers,
    'User-Agent': 'utopia-server',
  } as NotionHeaderMap;
}

export function notionApiUrl(path: string, base = NOTION_BASE_URL) {
  const trimmedPath = path.startsWith('/') ? path.slice(1) : path;
  return `${base}/${trimmedPath}`;
}

function withTimeout(ms: number, signal?: AbortSignal) {
  const controller = new AbortController();
  let settled = false;
  const onAbort = () => {
    if (!settled) {
      controller.abort(signal?.reason);
    }
  };

  if (signal) {
    if (signal.aborted) {
      controller.abort(signal.reason);
    } else {
      signal.addEventListener('abort', onAbort, { once: true });
    }
  }

  const timeoutId = setTimeout(() => {
    if (!settled) {
      controller.abort(new Error(`Notion request timed out after ${ms}ms`));
    }
  }, ms);

  return {
    signal: controller.signal,
    cleanup() {
      settled = true;
      clearTimeout(timeoutId);
      signal?.removeEventListener('abort', onAbort);
    },
  };
}

export function notionApiPath(template: string, params: Record<string, string> = {}) {
  const replaced = template.replace(/{([^}]+)}/g, (match, name) => {
    const key = String(name);
    if (params[key] === undefined) {
      return match;
    }
    return encodeURIComponent(params[key]);
  });
  return notionApiUrl(replaced);
}

function isRetryableStatus(status: number) {
  return status === 429 || (status >= 500 && status < 600);
}

function parseRetryAfter(raw: string | null | undefined): number | null {
  if (!raw) {
    return null;
  }
  const trimmed = String(raw).trim();
  if (!trimmed) {
    return null;
  }
  const numeric = Number(trimmed);
  if (Number.isFinite(numeric) && numeric > 0) {
    return Math.max(1, numeric) * 1000;
  }
  return null;
}

function parseRetryDelayMs(raw: Headers | undefined, fallbackAttempt: number) {
  const fromRetryAfter = parseRetryAfter(raw?.get('retry-after') || undefined);
  if (fromRetryAfter && Number.isFinite(fromRetryAfter)) {
    return Math.min(fromRetryAfter, 5000);
  }
  return Math.min(DEFAULT_RETRY_BASE_DELAY_MS * 2 ** fallbackAttempt, 5000);
}

function parseResponseText(raw: string | null | undefined): unknown {
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type NotionFetchOptions = {
  maxRetries?: number;
  retry?: boolean;
};

export async function notionFetch<T>(
  path: string,
  init: RequestInit = {},
  options: NotionFetchOptions = {},
): Promise<NotionApiResponse<T>> {
  const headers = notionHeadersSafe();
  if (!headers) {
    return {
      ok: false,
      status: 0,
      error: {
        status: 0,
        message: 'NOTION_TOKEN is not configured',
        body: null,
      },
    };
  }

  const url = /^https?:\/\//i.test(path) ? path : notionApiUrl(path);
  const requestTrace = readNotionConfig()?.requestTrace;
  const requestInit: RequestInit = {
    method: init.method || 'GET',
    headers: {
      ...headers,
      ...(init.headers as Record<string, string> | undefined),
    },
    body: init.body,
  };

  if (requestTrace) {
    console.info(`[notion-api] ${requestInit.method || 'GET'} ${url}`, requestTrace);
  }

  const retry = options.retry !== false;
  const maxRetries = Math.max(0, options.maxRetries ?? DEFAULT_RETRY_ATTEMPTS);
  let attempt = 0;

  while (attempt <= maxRetries) {
    const timeout = withTimeout(NOTION_REQUEST_TIMEOUT_MS, init.signal as AbortSignal | undefined);
    try {
      const response = await fetch(url, {
        ...requestInit,
        signal: timeout.signal,
      });
      const text = await response.text();
      const parsed = parseResponseText(text);

      if (!response.ok) {
        const sourceError = {
          status: response.status,
          message: `Notion API error ${response.status}`,
          body: parsed,
        };
        if (!retry || !isRetryableStatus(response.status) || attempt >= maxRetries) {
          return {
            ok: false,
            status: response.status,
            error: sourceError,
          };
        }

        const responseHeaders = response.headers;
        const waitMs = parseRetryDelayMs(responseHeaders, attempt);
        attempt += 1;
        await delay(waitMs);
        continue;
      }

      return {
        ok: true,
        status: response.status,
        data: parsed as T,
      };
    } catch (error: unknown) {
      if ((init.signal as AbortSignal | undefined)?.aborted) {
        const message = error instanceof Error ? error.message : 'notion request aborted';
        return {
          ok: false,
          status: 0,
          error: {
            status: 0,
            message,
            body: error,
          },
        };
      }
      if (!retry || attempt >= maxRetries) {
        const message = error instanceof Error ? error.message : 'unknown-notion-request-failure';
        return {
          ok: false,
          status: 0,
          error: {
            status: 0,
            message,
            body: error,
          },
        };
      }

      const waitMs = parseRetryDelayMs(undefined, attempt);
      attempt += 1;
      await delay(waitMs);
    } finally {
      timeout.cleanup();
    }
  }

  return {
    ok: false,
    status: 0,
    error: {
      status: 0,
      message: 'Notion API failed after retries.',
      body: { message: 'All retry attempts exhausted.' },
    },
  };
}
