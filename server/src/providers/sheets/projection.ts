export type SheetsRow = string[];

type SourceCellValue = {
  provider?: unknown;
  external_id?: unknown;
  url?: unknown;
  observed_at?: unknown;
  content_hash?: unknown;
};

export type SheetsRecordProjection = {
  id: string;
  domain: string;
  collection: string;
  title: string;
  properties: Record<string, unknown>;
  relations: Array<{ name: string; target_id: string }>;
  archived: boolean;
  version: number;
  updated_at: string;
  source?: SourceCellValue;
};

export function toSheetsCanonicalProjection(input: {
  id: string;
  domain?: string;
  collection?: string;
  title?: string;
  properties?: Record<string, unknown>;
  relations?: Array<{ name: string; target_id: string }>;
  archived?: boolean;
  version?: number;
  updatedAt?: string;
  source?: SourceCellValue;
}) {
  return {
    id: String(input.id || '').trim(),
    domain: String(input.domain || 'food').trim(),
    collection: String(input.collection || 'recipe').trim(),
    title: String(input.title || '').trim(),
    properties: input.properties ?? {},
    relations: normalizeRelations(input.relations),
    archived: Boolean(input.archived),
    version: typeof input.version === 'number' && Number.isFinite(input.version) ? input.version : 1,
    updated_at: typeof input.updatedAt === 'string' && input.updatedAt.trim().length > 0 ? input.updatedAt.trim() : new Date().toISOString(),
    source: input.source,
  } satisfies SheetsRecordProjection;
}

function normalizeRelations(input: unknown): Array<{ name: string; target_id: string }> {
  if (!Array.isArray(input)) return [];
  return input
    .map((relation) => {
      if (!relation || typeof relation !== 'object') return null;
      const record = relation as Record<string, unknown>;
      const name = typeof record.name === 'string' ? record.name.trim() : '';
      const targetId = typeof record.target_id === 'string' ? record.target_id.trim() : '';
      return name && targetId ? { name, target_id: targetId } : null;
    })
    .filter((relation): relation is { name: string; target_id: string } => relation !== null);
}

function toFallbackSource(id: string) {
  return {
    external_id: id,
  };
}

function normalizeText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function parseLegacyRow(row: SheetsRow, defaults: { domain: string; collection: string }) {
  const [id, title, status] = row;
  const fallbackId = `sheet-${Date.now()}`;
  return toSheetsCanonicalProjection({
    id: normalizeText(id) || fallbackId,
    domain: defaults.domain,
    collection: defaults.collection,
    title: normalizeText(title) || normalizeText(id) || 'Untitled',
    properties: { raw: row },
    archived: normalizeText(status).toLowerCase() === 'archived',
    source: toFallbackSource(id || fallbackId),
  });
}

export function mapSheetRowToProjection(row: SheetsRow, defaults: { domain: string; collection: string }) {
  if (!Array.isArray(row)) {
    return toSheetsCanonicalProjection({
      id: `sheet-${Date.now()}`,
      domain: defaults.domain,
      collection: defaults.collection,
      title: '',
      properties: {},
      archived: false,
      source: toFallbackSource(`sheet-${Date.now()}`),
    });
  }

  if (row.length < 3) {
    return parseLegacyRow(row, defaults);
  }

  const sourceCell = normalizeText(row[6]);
  const propertiesCell = normalizeText(row[4]);
  const parsedProperties = (() => {
    if (!propertiesCell) {
      return { raw: row };
    }

    try {
      const parsed = JSON.parse(propertiesCell);
      return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : { value: propertiesCell };
    } catch {
      return { value: propertiesCell };
    }
  })();

  const source = (() => {
    if (!sourceCell) {
      return toFallbackSource(row[0]);
    }
    try {
      const parsed = JSON.parse(sourceCell);
      if (parsed && typeof parsed === 'object') {
        return parsed as SourceCellValue;
      }
    } catch {
      // keep fallback
    }
    return {
      ...toFallbackSource(row[0]),
      source: sourceCell,
    };
  })();

  return toSheetsCanonicalProjection({
    id: row[0]?.trim() || `sheet-${Date.now()}`,
    domain: defaults.domain,
    collection: defaults.collection,
    title: row[1]?.trim() || row[0] || 'Untitled',
    properties: parsedProperties,
    archived: normalizeText(row[5]).toLowerCase() === 'true' || normalizeText(row[5]) === '1',
    source,
  });
}
