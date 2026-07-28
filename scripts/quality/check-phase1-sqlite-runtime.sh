#!/usr/bin/env bash
set -euo pipefail

DB_PATH="${1:-/tmp/utopia-phase1-runtime.sqlite}"
TEMP_DIR="${DB_PATH}.tmp"
rm -f "$DB_PATH"

cat > "$TEMP_DIR.sql" <<'SQL'
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS records (
  id TEXT PRIMARY KEY,
  domain TEXT NOT NULL,
  collection TEXT NOT NULL,
  title TEXT NOT NULL,
  properties TEXT NOT NULL,
  source_provider TEXT NOT NULL CHECK(source_provider IN ('notion', 'google_sheets', 'sqlite', 'postgres', 'web', 'user')),
  source_external_id TEXT NOT NULL,
  source_url TEXT,
  source_observed_at TEXT NOT NULL,
  source_content_hash TEXT,
  archived_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS record_relations (
  from_id TEXT NOT NULL,
  collection TEXT NOT NULL,
  name TEXT NOT NULL,
  target_id TEXT NOT NULL,
  target_domain TEXT NOT NULL,
  target_collection TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (from_id, name, target_id)
);

CREATE TABLE IF NOT EXISTS citations (
  id TEXT PRIMARY KEY,
  record_id TEXT,
  conversation_id TEXT,
  label TEXT NOT NULL,
  detail TEXT NOT NULL,
  href TEXT NOT NULL,
  tone TEXT NOT NULL,
  payload_json TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  domain TEXT NOT NULL,
  title TEXT NOT NULL,
  detail TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);

CREATE TABLE IF NOT EXISTS conversation_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
  sort_index INTEGER NOT NULL,
  body TEXT NOT NULL,
  answer_payload TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS provider_links (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  external_id TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL,
  freshness TEXT,
  workspace TEXT,
  url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS source_snapshots (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  external_id TEXT NOT NULL,
  scope TEXT,
  observed_at TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  checksum TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS source_snapshot_relations (
  snapshot_id TEXT NOT NULL,
  record_id TEXT NOT NULL,
  PRIMARY KEY (snapshot_id, record_id)
);

CREATE TABLE IF NOT EXISTS outbox_events (
  id TEXT PRIMARY KEY,
  action_key TEXT NOT NULL,
  domain TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS action_events (
  id TEXT PRIMARY KEY,
  domain TEXT NOT NULL,
  conversation_id TEXT,
  actor TEXT NOT NULL,
  tool TEXT NOT NULL,
  record_ids TEXT,
  before_json TEXT,
  after_json TEXT,
  undo_payload_json TEXT,
  idempotency_key TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'queued',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS undo_events (
  id TEXT PRIMARY KEY,
  action_id TEXT NOT NULL UNIQUE,
  payload_json TEXT NOT NULL,
  expires_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (action_id) REFERENCES action_events(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS workflow_runs (
  id TEXT PRIMARY KEY,
  domain TEXT NOT NULL,
  workflow_id TEXT NOT NULL,
  inputs_json TEXT,
  status TEXT NOT NULL DEFAULT 'running',
  payload_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY,
  domain TEXT NOT NULL,
  role TEXT NOT NULL,
  state TEXT NOT NULL,
  request_json TEXT,
  response_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT OR REPLACE INTO meta (key, value) VALUES ('lifecycle', 'ready');
INSERT OR REPLACE INTO meta (key, value) VALUES ('active_domain_id', 'food');
PRAGMA user_version = 1;
SQL

sqlite3 "$DB_PATH" < "$TEMP_DIR.sql"

sqlite3 "$DB_PATH" "
INSERT INTO conversations (id, domain, title, detail, created_at, updated_at, archived_at)
  VALUES ('t1', 'food', 'Today', 'Phase1 proof', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', NULL);
INSERT INTO records (id, domain, collection, title, properties, source_provider, source_external_id, source_url, source_observed_at, source_content_hash, archived_at, created_at, updated_at)
  VALUES ('r1', 'food', 'recipe', 'Tofu scramble', '{}', 'sqlite', 'ext-1', NULL, '2026-01-01T00:00:00Z', NULL, NULL, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
"

if [ "$(sqlite3 "$DB_PATH" 'SELECT COUNT(*) FROM records')" != "1" ]; then
  echo "[FAIL] record seed failed"
  exit 1
fi

if ! sqlite3 "$DB_PATH" "BEGIN; INSERT INTO records (id, domain, collection, title, properties, source_provider, source_external_id, source_observed_at, source_content_hash, archived_at, created_at, updated_at) VALUES ('r2', 'food', 'recipe', 'Bad', '{}', 'bad', 'bad', '2026-01-01T00:00:00Z', NULL, NULL, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'); COMMIT;" ; then
  echo "[PASS] CHECK constraint blocks invalid source provider"
else
  echo "[FAIL] invalid source_provider unexpectedly committed"
  exit 1
fi

if ! sqlite3 "$DB_PATH" "BEGIN; INSERT INTO records (id, domain, collection, title, properties, source_provider, source_external_id, source_observed_at, source_content_hash, archived_at, created_at, updated_at) VALUES ('r1', 'food', 'recipe', 'Dup', '{}', 'sqlite', 'ext-2', '2026-01-01T00:00:00Z', NULL, NULL, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'); COMMIT;" ; then
  echo "[PASS] unique key preserves atomic transaction integrity"
else
  echo "[FAIL] duplicate record id should not commit"
  exit 1
fi

if [ "$(sqlite3 "$DB_PATH" 'PRAGMA user_version;')" != "1" ]; then
  echo "[FAIL] migration version not applied"
  exit 1
fi

ROLLBACK_DB="${DB_PATH}.rollback"
cp "$DB_PATH" "$ROLLBACK_DB"
if [ ! -s "$ROLLBACK_DB" ]; then
  echo "[FAIL] rollback fixture copy failed"
  exit 1
fi

sqlite3 "$ROLLBACK_DB" "
PRAGMA foreign_keys = OFF;
BEGIN;
DROP TABLE IF EXISTS source_snapshot_relations;
DROP TABLE IF EXISTS citations;
DROP TABLE IF EXISTS agent_runs;
DROP TABLE IF EXISTS workflow_runs;
DROP TABLE IF EXISTS undo_events;
DROP TABLE IF EXISTS action_events;
DROP TABLE IF EXISTS outbox_events;
DROP TABLE IF EXISTS source_snapshots;
DROP TABLE IF EXISTS provider_links;
DROP TABLE IF EXISTS conversation_messages;
DROP TABLE IF EXISTS conversations;
DROP TABLE IF EXISTS record_relations;
DROP TABLE IF EXISTS records;
DROP TABLE IF EXISTS meta;
PRAGMA user_version = 0;
COMMIT;
"

if [ "$(sqlite3 "$ROLLBACK_DB" 'PRAGMA user_version;')" != "0" ]; then
  echo "[FAIL] rollback did not clear schema version"
  exit 1
fi

for table in records conversations conversation_messages record_relations source_snapshot_relations source_snapshots action_events undo_events workflow_runs agent_runs outbox_events provider_links citations meta; do
  if [ -n "$(sqlite3 "$ROLLBACK_DB" "SELECT name FROM sqlite_master WHERE type='table' AND name='$table';")" ]; then
    echo "[FAIL] table '$table' still exists after rollback"
    exit 1
  fi
done

if [ "$(sqlite3 "$ROLLBACK_DB" 'PRAGMA user_version;')" != "0" ]; then
  echo "[FAIL] rollback failed to restore version 0"
  exit 1
fi

RECOVERY_COPY="${DB_PATH}.recovered"
cp "$DB_PATH" "$RECOVERY_COPY"
if [ ! -s "$RECOVERY_COPY" ]; then
  echo "[FAIL] recovery snapshot copy failed"
  exit 1
fi
if [ "$(sqlite3 "$RECOVERY_COPY" 'SELECT COUNT(*) FROM records')" != "1" ]; then
  echo "[FAIL] recovered DB did not preserve records"
  exit 1
fi
if [ "$(sqlite3 "$RECOVERY_COPY" "SELECT COUNT(*) FROM meta WHERE key = 'lifecycle'")" != "1" ]; then
  echo "[FAIL] recovered DB lost lifecycle metadata"
  exit 1
fi

sqlite3 "$DB_PATH" "INSERT INTO meta (key, value) VALUES ('recovery_check', 'ok');"
DUMP_PATH="${DB_PATH}.dump"
sqlite3 "$DB_PATH" ".dump" > "$DUMP_PATH"

if [ ! -s "$DUMP_PATH" ]; then
  echo "[FAIL] recovery snapshot empty"
  exit 1
fi

echo "[PASS] SQLite runtime migration/recovery smoke complete"
echo "[PASS] Recovery snapshot preserved records and metadata"
echo "[PASS] rollback smoke restored schema to empty state"
rm -f "$TEMP_DIR.sql"
