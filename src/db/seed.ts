import type { SQLiteDatabase } from 'expo-sqlite';

import { loadCatalog } from '@/src/domain/catalog';
import { upsertRecord } from '@/src/db/records';
import { sampleRecordsAsCanonical } from '@/src/data/sample';

type SeedOptions = {
  seedInDev?: boolean;
};

export async function seedDatabase(db: SQLiteDatabase, options: SeedOptions = {}): Promise<void> {
  const catalog = loadCatalog();
  // A fresh release install must not render an empty shell. The bundled rows
  // are explicitly local sample data; live provider rows can replace them
  // after the user connects a source.
  if (!options.seedInDev) {
    return;
  }

  const createdAt = new Date().toISOString();

  for (const sample of sampleRecordsAsCanonical(catalog.activeManifest.id)) {
    const existing = await db.getFirstAsync<{ properties: string; source_external_id: string }>(
      'SELECT properties, source_external_id FROM records WHERE id = ?',
      [sample.id]
    );
    if (existing) {
      let properties: Record<string, unknown> = {};
      try {
        const parsed = JSON.parse(existing.properties);
        if (parsed && typeof parsed === 'object') {
          properties = parsed as Record<string, unknown>;
        }
      } catch {
        properties = {};
      }
      const isBundledSample = existing.source_external_id.startsWith('sample-');
      const hasRichFoodDetail = Boolean(properties.food_detail);
      if (!isBundledSample && hasRichFoodDetail) {
        continue;
      }
    }

    const manifest = catalog.activeManifest;
    await upsertRecord(
      db,
      manifest,
      {
        id: sample.id,
        title: sample.title,
        collection: sample.collection,
        properties: {
          ...sample.properties,
        },
        source: { ...sample.source, observed_at: createdAt },
        archived_at: null,
        created_at: createdAt,
        updated_at: createdAt,
        relations: sample.relations,
      }
    );
  }

}
