import type { NotionApiResponse, NotionClientConfig } from './client';
import {
  createOfficialNotionClient,
  notionApiPath,
  notionFetch,
  NOTION_DATA_SOURCE_QUERY_PATH,
  readNotionConfig,
} from './client';

export type NotionQueryResponse = {
  results?: unknown[];
  has_more?: boolean;
  next_cursor?: string | null;
};

export type NotionWriteResponse = {
  id?: string;
  url?: string;
  archived?: boolean;
  parent?: { data_source_id?: string; database_id?: string };
  created_time?: string;
  last_edited_time?: string;
};

export type NotionPort = {
  queryDataSource(input: {
    dataSourceId: string;
    pageSize: number;
    startCursor?: string;
    signal?: AbortSignal;
  }): Promise<NotionApiResponse<NotionQueryResponse>>;
  createPage(input: {
    dataSourceId: string;
    payload: Record<string, unknown>;
    signal?: AbortSignal;
  }): Promise<NotionApiResponse<NotionWriteResponse>>;
  updatePage(input: {
    pageId: string;
    payload: Record<string, unknown>;
    signal?: AbortSignal;
  }): Promise<NotionApiResponse<NotionWriteResponse>>;
};

let notionPortOverride: NotionPort | null = null;
const DEFAULT_NOTION_BASE_URL = 'https://api.notion.com/v1';

function normalizeNotionError(error: unknown): NotionApiResponse<never> {
  const status = typeof (error as { status?: unknown })?.status === 'number'
    ? Number((error as { status: number }).status)
    : 0;
  const body = (error as { body?: unknown })?.body ?? null;
  const message = error instanceof Error ? error.message : 'notion sdk request failed';
  return {
    ok: false,
    status,
    error: {
      status,
      message,
      body,
    },
  };
}

export function createSdkNotionPort(config?: NotionClientConfig): NotionPort | null {
  const resolved = config ?? readNotionConfig();
  if (!resolved) {
    return null;
  }
  const client = createOfficialNotionClient(resolved);
  if (!client) {
    return null;
  }

  const sdk = client as any;
  return {
    async queryDataSource(input) {
      try {
        const data = await sdk.dataSources.query({
          data_source_id: input.dataSourceId,
          page_size: input.pageSize,
          ...(input.startCursor ? { start_cursor: input.startCursor } : {}),
        });
        return { ok: true, status: 200, data: data as NotionQueryResponse };
      } catch (error: unknown) {
        return normalizeNotionError(error);
      }
    },
    async createPage(input) {
      try {
        const data = await sdk.pages.create({
          parent: {
            type: 'data_source_id',
            data_source_id: input.dataSourceId,
          },
          ...(input.payload as Record<string, unknown>),
        });
        return { ok: true, status: 200, data: data as NotionWriteResponse };
      } catch (error: unknown) {
        return normalizeNotionError(error);
      }
    },
    async updatePage(input) {
      try {
        const data = await sdk.pages.update({
          page_id: input.pageId,
          ...(input.payload as Record<string, unknown>),
        });
        return { ok: true, status: 200, data: data as NotionWriteResponse };
      } catch (error: unknown) {
        return normalizeNotionError(error);
      }
    },
  };
}

function shouldUseFetchNotionPort() {
  const override = process.env.NOTION_BASE_URL?.trim();
  return Boolean(override && override !== DEFAULT_NOTION_BASE_URL);
}

function createFetchNotionPort(): NotionPort {
  return {
    async queryDataSource(input) {
      return notionFetch<NotionQueryResponse>(
        notionApiPath(NOTION_DATA_SOURCE_QUERY_PATH, { data_source_id: input.dataSourceId }),
        {
          method: 'POST',
          body: JSON.stringify({
            page_size: input.pageSize,
            ...(input.startCursor ? { start_cursor: input.startCursor } : {}),
          }),
          ...(input.signal ? { signal: input.signal } : {}),
        },
      );
    },
    async createPage(input) {
      return notionFetch<NotionWriteResponse>(
        '/pages',
        {
          method: 'POST',
          body: JSON.stringify({
            parent: {
              type: 'data_source_id',
              data_source_id: input.dataSourceId,
            },
            ...input.payload,
          }),
          ...(input.signal ? { signal: input.signal } : {}),
        },
      );
    },
    async updatePage(input) {
      return notionFetch<NotionWriteResponse>(
        `/pages/${encodeURIComponent(input.pageId)}`,
        {
          method: 'PATCH',
          body: JSON.stringify(input.payload),
          ...(input.signal ? { signal: input.signal } : {}),
        },
      );
    },
  };
}

export function getNotionPort(config?: NotionClientConfig): NotionPort | null {
  if (notionPortOverride) {
    return notionPortOverride;
  }
  if (shouldUseFetchNotionPort()) {
    return createFetchNotionPort();
  }
  return createSdkNotionPort(config);
}

export function setNotionPortForTests(port: NotionPort | null) {
  notionPortOverride = port;
}
