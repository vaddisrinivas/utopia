import type { SheetsApiResponse, SheetsClientConfig } from './client';
import { createOfficialSheetsClient, readSheetsConfig, sheetsFetch } from './client';

export type SheetsPort = {
  getSpreadsheet(input: {
    spreadsheetId: string;
    signal?: AbortSignal;
  }): Promise<SheetsApiResponse<Record<string, unknown>>>;
  batchGetValues(input: {
    spreadsheetId: string;
    ranges: string[];
    majorDimension?: 'ROWS' | 'COLUMNS';
    signal?: AbortSignal;
  }): Promise<SheetsApiResponse<Record<string, unknown>>>;
  batchUpdateValues(input: {
    spreadsheetId: string;
    valueInputOption: string;
    data: Array<{
      range: string;
      majorDimension: string;
      values: string[][];
    }>;
    signal?: AbortSignal;
  }): Promise<SheetsApiResponse<Record<string, unknown>>>;
};

let sheetsPortOverride: SheetsPort | null = null;
const DEFAULT_SHEETS_BASE_URL = 'https://sheets.googleapis.com/v4';

function normalizeSheetsError(error: unknown): SheetsApiResponse<never> {
  const status = typeof (error as { code?: unknown })?.code === 'number'
    ? Number((error as { code: number }).code)
    : 0;
  const message = error instanceof Error ? error.message : 'google sheets sdk request failed';
  return {
    ok: false,
    status,
    error: message,
  };
}

export function createSdkSheetsPort(config?: SheetsClientConfig): SheetsPort | null {
  const resolved = config ?? readSheetsConfig();
  if (!resolved) {
    return null;
  }
  const client = createOfficialSheetsClient(resolved);
  if (!client) {
    return null;
  }

  const sdk = client as any;
  return {
    async getSpreadsheet(input) {
      try {
        const response = await sdk.spreadsheets.get({
          spreadsheetId: input.spreadsheetId,
          ...(input.signal ? { signal: input.signal } : {}),
        });
        return {
          ok: true,
          status: typeof response?.status === 'number' ? response.status : 200,
          data: (response?.data ?? {}) as Record<string, unknown>,
        };
      } catch (error: unknown) {
        return normalizeSheetsError(error);
      }
    },
    async batchGetValues(input) {
      try {
        const response = await sdk.spreadsheets.values.batchGet({
          spreadsheetId: input.spreadsheetId,
          majorDimension: input.majorDimension ?? 'ROWS',
          ranges: input.ranges,
          ...(input.signal ? { signal: input.signal } : {}),
        });
        return {
          ok: true,
          status: typeof response?.status === 'number' ? response.status : 200,
          data: (response?.data ?? {}) as Record<string, unknown>,
        };
      } catch (error: unknown) {
        return normalizeSheetsError(error);
      }
    },
    async batchUpdateValues(input) {
      try {
        const response = await sdk.spreadsheets.values.batchUpdate({
          spreadsheetId: input.spreadsheetId,
          requestBody: {
            valueInputOption: input.valueInputOption,
            data: input.data,
          },
          ...(input.signal ? { signal: input.signal } : {}),
        });
        return {
          ok: true,
          status: typeof response?.status === 'number' ? response.status : 200,
          data: (response?.data ?? {}) as Record<string, unknown>,
        };
      } catch (error: unknown) {
        return normalizeSheetsError(error);
      }
    },
  };
}

function shouldUseFetchSheetsPort() {
  const override = process.env.GOOGLE_SHEETS_API_BASE_URL?.trim();
  return Boolean(override && override !== DEFAULT_SHEETS_BASE_URL);
}

function createFetchSheetsPort(): SheetsPort {
  return {
    async getSpreadsheet(input) {
      return sheetsFetch<Record<string, unknown>>('', {
        method: 'GET',
        ...(input.signal ? { signal: input.signal } : {}),
      });
    },
    async batchGetValues(input) {
      const params = new URLSearchParams();
      params.set('majorDimension', input.majorDimension ?? 'ROWS');
      input.ranges.forEach((range) => params.append('ranges', range));
      return sheetsFetch<Record<string, unknown>>(`/values:batchGet?${params.toString()}`, {
        method: 'GET',
        ...(input.signal ? { signal: input.signal } : {}),
      });
    },
    async batchUpdateValues(input) {
      return sheetsFetch<Record<string, unknown>>('/values:batchUpdate', {
        method: 'POST',
        body: JSON.stringify({
          valueInputOption: input.valueInputOption,
          data: input.data,
        }),
        ...(input.signal ? { signal: input.signal } : {}),
      });
    },
  };
}

export function getSheetsPort(config?: SheetsClientConfig): SheetsPort | null {
  if (sheetsPortOverride) {
    return sheetsPortOverride;
  }
  if (shouldUseFetchSheetsPort()) {
    return createFetchSheetsPort();
  }
  return createSdkSheetsPort(config);
}

export function setSheetsPortForTests(port: SheetsPort | null) {
  sheetsPortOverride = port;
}
