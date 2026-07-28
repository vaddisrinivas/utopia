import { NotionClientConfig, notionDataSourceId } from './client';

export type NotionDataSource = {
  id: string;
  type: 'data_source';
  name: string;
};

export type NotionDiscoveryResult = {
  status: 'ready' | 'disabled';
  configured: boolean;
  dataSourceId?: string;
  dataSources: NotionDataSource[];
  note: string;
};

export function discoverNotionDataSources(config?: NotionClientConfig): NotionDiscoveryResult {
  if (!config) {
    return {
      status: 'disabled',
      configured: false,
      dataSources: [],
      note: 'Notion token/api key is not configured.',
    };
  }

  const dataSourceId = notionDataSourceId(config);
  if (!dataSourceId) {
    return {
      status: 'disabled',
      configured: true,
      dataSources: [],
      note: 'NOTION_DATA_SOURCE_ID is not configured; dynamic query by data_source_id will fail in live mode.',
    };
  }

  return {
    status: 'ready',
    configured: true,
    dataSourceId,
    dataSources: [{ id: dataSourceId, type: 'data_source', name: 'configured-data-source' }],
    note: 'Discovery is available. Query by data_source_id in live-mode.',
  };
}
