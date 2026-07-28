export type SheetsColumn = {
  name: string;
  index: number;
};

export type SheetsTab = {
  title: string;
  sheetId: number;
  gridColumns: number;
  gridRows: number;
};

export type SheetsWorkBookMetadata = {
  spreadsheetId: string;
  workbookTitle: string;
  spreadsheetUrl: string;
  tabs: SheetsTab[];
};

type RawSpreadsheetResource = {
  properties?: {
    title?: string;
    spreadsheetUrl?: string;
  };
  spreadsheetId?: string;
  spreadsheetUrl?: string;
  sheets?: Array<{
    properties?: {
      title?: string;
      sheetId?: number;
      gridProperties?: {
        columnCount?: number;
        rowCount?: number;
      };
    };
  }>;
};

export const WELL_KNOWN_TABS = ['Utopia Runtime', 'Utopia Source Pack', 'Utopia Health', 'Utopia Sync Loop'];
// Keep the product-facing Runtime dashboard separate from the machine-readable
// table used for provider sync. Existing workbooks may not have this tab yet;
// callers must fall back to the dashboard for backwards compatibility.
export const CANONICAL_RUNTIME_TAB_NAME = 'Utopia Canonical';
export const WELL_KNOWN_RUNTIME_COLUMNS = [
  'id',
  'utopia_id',
  'version',
  'updated_at',
  'source',
  'title',
  'domain',
  'collection',
  'properties',
  'food_detail',
  'relations',
  'archived',
  'external_id',
] as const;

export const REQUIRED_RUNTIME_COLUMNS = ['title', 'domain', 'collection', 'properties', 'archived'] as const;

export function parseWorkBookMetadata(response: RawSpreadsheetResource, spreadsheetIdFallback: string): SheetsWorkBookMetadata {
  const tabs = Array.isArray(response.sheets) ? response.sheets : [];
  return {
    spreadsheetId: response.spreadsheetId || spreadsheetIdFallback,
    workbookTitle: response.properties?.title || 'Utopia Runtime',
    spreadsheetUrl: response.properties?.spreadsheetUrl || response.spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${spreadsheetIdFallback}/edit`,
    tabs: tabs
      .map((tab) => {
        const title = tab.properties?.title || 'Untitled';
        return {
          title,
          sheetId: tab.properties?.sheetId || 0,
          gridColumns: tab.properties?.gridProperties?.columnCount || 0,
          gridRows: tab.properties?.gridProperties?.rowCount || 0,
        };
      })
      .filter((item) => item.title),
  };
}

export function findMissingTabs(tabs: SheetsTab[], required: string[] = WELL_KNOWN_TABS) {
  const names = new Set(tabs.map((tab) => tab.title));
  return required.filter((requiredTab) => !names.has(requiredTab));
}
