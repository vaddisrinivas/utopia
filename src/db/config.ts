import type { SQLiteDatabase } from 'expo-sqlite';

import type { ConfigConflict, ConfigSource, ConfigSnapshot } from '@/src/config/types';

export type ConfigDb = Pick<SQLiteDatabase, 'runAsync'>;

export async function saveConfigSource(db: ConfigDb, source: ConfigSource): Promise<void> {
  await db.runAsync(
    `INSERT OR REPLACE INTO config_sources (
      id,
      kind,
      label,
      location_json,
      auto_refresh,
      refresh_minutes,
      precedence,
      enabled,
      created_at,
      updated_at
    ) VALUES ($id, $kind, $label, $location_json, $auto_refresh, $refresh_minutes, $precedence, $enabled, $created_at, $updated_at)`,
    {
      $id: source.id,
      $kind: source.kind,
      $label: source.label,
      $location_json: JSON.stringify(source.location),
      $auto_refresh: source.auto_refresh ? 1 : 0,
      $refresh_minutes: source.refresh_minutes,
      $precedence: source.precedence,
      $enabled: source.enabled ? 1 : 0,
      $created_at: source.created_at,
      $updated_at: source.updated_at,
    }
  );
}

export async function saveConfigSnapshot(db: ConfigDb, snapshot: ConfigSnapshot): Promise<void> {
  await db.runAsync(
    `INSERT OR REPLACE INTO config_snapshots (
      source_id,
      fetched_at,
      content_hash,
      etag,
      raw,
      validation_status,
      error_json
    ) VALUES ($source_id, $fetched_at, $content_hash, $etag, $raw, $validation_status, $error_json)`,
    {
      $source_id: snapshot.source_id,
      $fetched_at: snapshot.fetched_at,
      $content_hash: snapshot.content_hash,
      $etag: snapshot.etag ?? null,
      $raw: snapshot.raw,
      $validation_status: snapshot.validation_status,
      $error_json: snapshot.error ? JSON.stringify(snapshot.error) : null,
    }
  );
}

export async function saveConfigConflict(db: ConfigDb, conflict: ConfigConflict): Promise<void> {
  await db.runAsync(
    `INSERT OR REPLACE INTO config_conflicts (
      id,
      key,
      sources_json,
      reason,
      status,
      created_at,
      resolved_at
    ) VALUES ($id, $key, $sources_json, $reason, $status, $created_at, $resolved_at)`,
    {
      $id: conflict.id,
      $key: conflict.key,
      $sources_json: JSON.stringify(conflict.sources),
      $reason: conflict.reason,
      $status: conflict.status,
      $created_at: conflict.created_at,
      $resolved_at: conflict.resolved_at ?? null,
    }
  );
}
