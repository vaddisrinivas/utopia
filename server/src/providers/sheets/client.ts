import { readFileSync } from 'node:fs';
import { google } from 'googleapis';

export const SHEETS_API_BASE_URL = process.env.GOOGLE_SHEETS_API_BASE_URL?.trim() || 'https://sheets.googleapis.com/v4';
export const SHEETS_REQUEST_TIMEOUT_MS = 15000;
export const SHEETS_WORKBOOK_TAB_PREFIX = 'Utopia';
export const SHEETS_WORKBOOK_DEFAULT_RANGE = 'A:Z';

export type SheetsClientConfig = {
  accessToken: string;
  spreadsheetId?: string;
  workbookName?: string;
  dataSourceId?: string;
};

export type SheetsApiResponse<T> = {
  ok: boolean;
  status: number;
  data?: T;
  error?: string;
};

export function readSheetsConfig(): SheetsClientConfig | null {
  let accessToken = process.env.GOOGLE_SHEETS_ACCESS_TOKEN?.trim() || process.env.GOOGLE_SHEETS_TOKEN?.trim() || '';
  if (!accessToken) {
    const tokenFile = process.env.GOOGLE_SHEETS_TOKEN_FILE?.trim();
    if (tokenFile) {
      try {
        const cached = JSON.parse(readFileSync(tokenFile, 'utf8')) as { access_token?: unknown };
        accessToken = typeof cached.access_token === 'string' ? cached.access_token.trim() : '';
      } catch {
        // Treat an unreadable/expired local cache as unconfigured; never expose its contents.
      }
    }
  }
  if (!accessToken) {
    return null;
  }
  return {
    accessToken,
    spreadsheetId: process.env.GOOGLE_SHEETS_SPREADSHEET_ID?.trim() || process.env.SHEETS_SPREADSHEET_ID?.trim(),
    workbookName: process.env.GOOGLE_SHEETS_WORKBOOK_NAME?.trim() || undefined,
    dataSourceId:
      process.env.GOOGLE_SHEETS_DATA_SOURCE_ID?.trim() ||
      process.env.SHEETS_DATA_SOURCE_ID?.trim(),
  };
}

export function isSheetsConfigured() {
  return readSheetsConfig() !== null;
}

export function createOfficialSheetsClient(config?: SheetsClientConfig) {
  const resolved = config ?? readSheetsConfig();
  if (!resolved) {
    return null;
  }
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: resolved.accessToken });
  return google.sheets({ version: 'v4', auth });
}

export function createOfficialDriveClient(config?: SheetsClientConfig) {
  const resolved = config ?? readSheetsConfig();
  if (!resolved) {
    return null;
  }
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: resolved.accessToken });
  return google.drive({ version: 'v3', auth });
}

export function sheetsEndpoint(path: string, config?: SheetsClientConfig) {
  const resolved = config ?? readSheetsConfig();
  if (!resolved?.spreadsheetId) {
    return null;
  }
  const normalized = path.startsWith('/') ? path.slice(1) : path;
  return `${SHEETS_API_BASE_URL}/spreadsheets/${resolved.spreadsheetId}/${normalized}`;
}

export function sheetsHeaders(config?: SheetsClientConfig) {
  const resolved = config ?? readSheetsConfig();
  if (!resolved) {
    return null;
  }
  return {
    Authorization: `Bearer ${resolved.accessToken}`,
    'Content-Type': 'application/json',
  };
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
      controller.abort(new Error(`Sheets request timed out after ${ms}ms`));
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

export async function sheetsFetch<T>(path: string, init: RequestInit = {}): Promise<SheetsApiResponse<T>> {
  const headers = sheetsHeaders();
  if (!headers) {
    return {
      ok: false,
      status: 0,
      error: 'GOOGLE_SHEETS_ACCESS_TOKEN is not configured',
    };
  }

  const endpoint = sheetsEndpoint(path);
  if (!endpoint) {
    return {
      ok: false,
      status: 0,
      error: 'GOOGLE_SHEETS_SPREADSHEET_ID is missing',
    };
  }

  const requestInit: RequestInit = {
    method: init.method || 'GET',
    headers: {
      ...headers,
      ...(init.headers as Record<string, string> | undefined),
    },
    body: init.body,
  };

  const timeout = withTimeout(SHEETS_REQUEST_TIMEOUT_MS, init.signal as AbortSignal | undefined);
  try {
    const response = await fetch(endpoint, {
      ...requestInit,
      signal: timeout.signal,
    });
    const text = await response.text();
    let payload: unknown = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = text;
      }
    }

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error: typeof payload === 'string' ? payload : `Sheets API error ${response.status}`,
      };
    }

    return {
      ok: true,
      status: response.status,
      data: payload as T,
    };
  } catch (error: unknown) {
    return {
      ok: false,
      status: 0,
      error: error instanceof Error ? error.message : 'unknown-sheets-request-failure',
    };
  } finally {
    timeout.cleanup();
  }
}
