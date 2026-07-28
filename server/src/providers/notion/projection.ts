export type NotionPropertyMap = Record<string, unknown>;

export type NotionCanonicalProjection = {
  id: string;
  domain: string;
  collection: string;
  title: string;
  properties: Record<string, unknown>;
  relations: Array<{ name: string; target_id: string }>;
};

export function toNotionCanonicalProjection(input: {
  id: string;
  domain?: string;
  collection?: string;
  title?: string;
  properties?: NotionPropertyMap;
  relations?: Array<{ name: string; target_id: string }>;
}) {
  return {
    id: String(input.id || '').trim(),
    domain: String(input.domain || 'food').trim(),
    collection: String(input.collection || 'recipe').trim(),
    title: String(input.title || '').trim(),
    properties: sanitizeNotionProperties(input.properties),
    relations: normalizeRelations(input.relations),
  } satisfies NotionCanonicalProjection;
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

function sanitizeNotionProperties(properties: NotionPropertyMap | undefined) {
  if (!properties || typeof properties !== 'object') {
    return {};
  }
  return Object.entries(properties).reduce<Record<string, unknown>>((acc, [key, value]) => {
    if (typeof key === 'string' && key.trim()) {
      acc[key.trim()] = value;
    }
    return acc;
  }, {});
}
