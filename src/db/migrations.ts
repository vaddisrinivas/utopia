import type { SQLiteDatabase } from 'expo-sqlite';
import { DEFAULT_APP_INSTALLATION_ID, DEFAULT_WORKSPACE_ID } from '@/packages/shared/contracts/app-installation';
import { loadCatalog } from '@/src/domain/catalog';

export const DATABASE_NAME = 'utopia.db';
export const DATABASE_VERSION = 13;

const TABLES = {
  meta: 'meta',
  records: 'records',
  relations: 'record_relations',
  conversations: 'conversations',
  messages: 'conversation_messages',
  source_snapshots: 'source_snapshots',
  provider_links: 'provider_links',
  outbox: 'outbox_events',
  actions: 'action_events',
  operations: 'operations',
  sync_conflicts: 'sync_conflicts',
  config_sources: 'config_sources',
  config_snapshots: 'config_snapshots',
  config_conflicts: 'config_conflicts',
  workspaces: 'workspaces',
  app_installations: 'app_installations',
  app_packages: 'app_packages',
  app_package_state: 'app_package_state',
  app_installation_package_state: 'app_installation_package_state',
  app_package_receipts: 'app_package_receipts',
  package_migration_journal: 'package_migration_journal',
  cloud_accounts: 'cloud_accounts',
  cloud_devices: 'cloud_devices',
  cloud_sessions: 'cloud_sessions',
  undo_events: 'undo_events',
  workflow_runs: 'workflow_runs',
  agent_runs: 'agent_runs',
  citations: 'citations',
  source_snapshots_causality: 'source_snapshot_relations',
} as const;

export type RecoveryExport = {
  schema_version: number;
  tables: Array<{
    name: string;
    rows: Array<Record<string, unknown>>;
  }>;
};

type Migration = {
  version: number;
  up: (db: SQLiteDatabase) => Promise<void>;
  down?: (db: SQLiteDatabase) => Promise<void>;
};

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    up: async (db) => {
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS ${TABLES.meta} (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        )
      `);

      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS ${TABLES.records} (
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
        )
      `);

      await db.execAsync(`
        CREATE INDEX IF NOT EXISTS ${TABLES.records}_domain_idx ON ${TABLES.records}(domain, collection)
      `);
      await db.execAsync(`
        CREATE INDEX IF NOT EXISTS ${TABLES.records}_updated_idx ON ${TABLES.records}(updated_at)
      `);

      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS ${TABLES.relations} (
          from_id TEXT NOT NULL,
          collection TEXT NOT NULL,
          name TEXT NOT NULL,
          target_id TEXT NOT NULL,
          target_domain TEXT NOT NULL,
          target_collection TEXT NOT NULL,
          created_at TEXT NOT NULL,
          PRIMARY KEY (from_id, name, target_id)
        )
      `);

      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS ${TABLES.citations} (
          id TEXT PRIMARY KEY,
          record_id TEXT,
          conversation_id TEXT,
          label TEXT NOT NULL,
          detail TEXT NOT NULL,
          href TEXT NOT NULL,
          tone TEXT NOT NULL,
          payload_json TEXT,
          created_at TEXT NOT NULL
        )
      `);

      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS ${TABLES.conversations} (
          id TEXT PRIMARY KEY,
          domain TEXT NOT NULL,
          title TEXT NOT NULL,
          detail TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          archived_at TEXT
        )
      `);

      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS ${TABLES.messages} (
          id TEXT PRIMARY KEY,
          conversation_id TEXT NOT NULL,
          role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
          sort_index INTEGER NOT NULL,
          body TEXT NOT NULL,
          answer_payload TEXT,
          created_at TEXT NOT NULL,
          FOREIGN KEY (conversation_id) REFERENCES ${TABLES.conversations}(id) ON DELETE CASCADE
        )
      `);

      await db.execAsync(`
        CREATE INDEX IF NOT EXISTS ${TABLES.messages}_conversation_idx
          ON ${TABLES.messages}(conversation_id, sort_index);
      `);

      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS ${TABLES.provider_links} (
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
        )
      `);

      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS ${TABLES.source_snapshots} (
          id TEXT PRIMARY KEY,
          provider TEXT NOT NULL,
          external_id TEXT NOT NULL,
          scope TEXT,
          observed_at TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          checksum TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
      `);

      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS ${TABLES.source_snapshots_causality} (
          snapshot_id TEXT NOT NULL,
          record_id TEXT NOT NULL,
          PRIMARY KEY (snapshot_id, record_id)
        )
      `);

      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS ${TABLES.outbox} (
          id TEXT PRIMARY KEY,
          action_key TEXT NOT NULL,
          domain TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          attempts INTEGER NOT NULL DEFAULT 0,
          last_error TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
      `);

      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS ${TABLES.actions} (
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
        )
      `);

      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS ${TABLES.undo_events} (
          id TEXT PRIMARY KEY,
          action_id TEXT NOT NULL UNIQUE,
          payload_json TEXT NOT NULL,
          expires_at TEXT,
          created_at TEXT NOT NULL,
          FOREIGN KEY (action_id) REFERENCES ${TABLES.actions}(id) ON DELETE CASCADE
        )
      `);

      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS ${TABLES.workflow_runs} (
          id TEXT PRIMARY KEY,
          domain TEXT NOT NULL,
          workflow_id TEXT NOT NULL,
          inputs_json TEXT,
          status TEXT NOT NULL DEFAULT 'running',
          payload_json TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
      `);

      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS ${TABLES.agent_runs} (
          id TEXT PRIMARY KEY,
          domain TEXT NOT NULL,
          role TEXT NOT NULL,
          state TEXT NOT NULL,
          request_json TEXT,
          response_json TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
      `);

      await db.execAsync('PRAGMA foreign_keys = ON');
      await db.execAsync(`PRAGMA user_version = 1`);
      await db.runAsync(
        `INSERT OR REPLACE INTO ${TABLES.meta} (key, value) VALUES ($key, $value)`,
        { $key: 'lifecycle', $value: 'ready' }
      );

      const catalog = loadCatalog();
      await db.runAsync(
        `INSERT OR REPLACE INTO ${TABLES.meta} (key, value) VALUES ($key, $value)`,
        {
          $key: 'active_domain_id',
          $value: catalog.activeDomainId,
        }
      );
    },
    down: async (db) => {
      for (const name of Object.values(TABLES).reverse()) {
        await db.execAsync(`DROP TABLE IF EXISTS ${name}`);
      }
      await db.execAsync('PRAGMA user_version = 0');
    },
  },
  {
    version: 2,
    up: async (db) => {
      await db.execAsync(`ALTER TABLE ${TABLES.records} ADD COLUMN revision INTEGER NOT NULL DEFAULT 1`);
      await db.execAsync(`ALTER TABLE ${TABLES.records} ADD COLUMN schema_version TEXT NOT NULL DEFAULT '1.0.0'`);
      await db.execAsync(`ALTER TABLE ${TABLES.records} ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0`);
      await db.execAsync(`ALTER TABLE ${TABLES.records} ADD COLUMN privacy TEXT NOT NULL DEFAULT 'personal' CHECK(privacy IN ('private','personal','shared'))`);
      await db.execAsync(`ALTER TABLE ${TABLES.records} ADD COLUMN provenance_json TEXT`);
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS ${TABLES.operations} (
          op_id TEXT PRIMARY KEY,
          kind TEXT NOT NULL,
          domain TEXT NOT NULL,
          collection TEXT NOT NULL,
          record_id TEXT NOT NULL,
          expected_revision INTEGER,
          result_revision INTEGER,
          actor TEXT NOT NULL CHECK(actor IN ('user','ai','import','sync','agent','api','workflow')),
          origin TEXT NOT NULL,
          idempotency_key TEXT,
          changes_json TEXT,
          before_json TEXT,
          after_json TEXT,
          inverse_op_id TEXT,
          status TEXT NOT NULL DEFAULT 'applied' CHECK(status IN ('applied','rejected','undone','superseded')),
          reject_reason TEXT,
          created_at TEXT NOT NULL
        )
      `);
      await db.execAsync(`
        CREATE UNIQUE INDEX IF NOT EXISTS ${TABLES.operations}_idem_idx
          ON ${TABLES.operations}(idempotency_key) WHERE idempotency_key IS NOT NULL
      `);
      await db.execAsync(`
        CREATE INDEX IF NOT EXISTS ${TABLES.operations}_record_idx
          ON ${TABLES.operations}(record_id, created_at)
      `);
      await db.execAsync(`PRAGMA user_version = 2`);
    },
    down: async (db) => {
      await db.execAsync(`DROP TABLE IF EXISTS ${TABLES.operations}`);
      await db.execAsync(`PRAGMA user_version = 1`);
    },
  },
  {
    version: 3,
    up: async (db) => {
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS ${TABLES.sync_conflicts} (
          id TEXT PRIMARY KEY,
          domain TEXT NOT NULL,
          collection TEXT NOT NULL,
          record_id TEXT NOT NULL,
          provider TEXT NOT NULL,
          external_id TEXT NOT NULL,
          fields_json TEXT NOT NULL,
          base_json TEXT,
          local_json TEXT NOT NULL,
          remote_json TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'needs_review'
            CHECK(status IN ('needs_review','resolved','dismissed')),
          resolution_op_id TEXT,
          created_at TEXT NOT NULL,
          resolved_at TEXT
        )
      `);
      await db.execAsync(`
        CREATE INDEX IF NOT EXISTS ${TABLES.sync_conflicts}_record_idx
          ON ${TABLES.sync_conflicts}(record_id, status, created_at)
      `);
      await db.execAsync(`PRAGMA user_version = 3`);
    },
    down: async (db) => {
      await db.execAsync(`DROP TABLE IF EXISTS ${TABLES.sync_conflicts}`);
      await db.execAsync(`PRAGMA user_version = 2`);
    },
  },
  {
    version: 5,
    up: async (db) => {
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS ${TABLES.config_sources} (
          id TEXT PRIMARY KEY,
          kind TEXT NOT NULL CHECK(kind IN ('local','github','url','notion','sheets')),
          label TEXT NOT NULL,
          location_json TEXT NOT NULL,
          auto_refresh INTEGER NOT NULL DEFAULT 0,
          refresh_minutes INTEGER NOT NULL DEFAULT 60,
          precedence INTEGER NOT NULL DEFAULT 0,
          enabled INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
      `);
      await db.execAsync(`
        CREATE INDEX IF NOT EXISTS ${TABLES.config_sources}_enabled_precedence_idx
          ON ${TABLES.config_sources}(enabled, precedence)
      `);
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS ${TABLES.config_snapshots} (
          source_id TEXT NOT NULL,
          fetched_at TEXT NOT NULL,
          content_hash TEXT NOT NULL,
          etag TEXT,
          raw TEXT NOT NULL,
          validation_status TEXT NOT NULL DEFAULT 'unvalidated'
            CHECK(validation_status IN ('unvalidated','valid','invalid')),
          error_json TEXT,
          PRIMARY KEY (source_id, content_hash),
          FOREIGN KEY (source_id) REFERENCES ${TABLES.config_sources}(id) ON DELETE CASCADE
        )
      `);
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS ${TABLES.config_conflicts} (
          id TEXT PRIMARY KEY,
          key TEXT NOT NULL,
          sources_json TEXT NOT NULL,
          reason TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'needs_review'
            CHECK(status IN ('needs_review','resolved','dismissed')),
          created_at TEXT NOT NULL,
          resolved_at TEXT
        )
      `);
      await db.execAsync(`
        CREATE INDEX IF NOT EXISTS ${TABLES.config_conflicts}_status_idx
          ON ${TABLES.config_conflicts}(status, created_at)
      `);
      await db.execAsync(`PRAGMA user_version = 5`);
    },
    down: async (db) => {
      await db.execAsync(`DROP TABLE IF EXISTS ${TABLES.config_conflicts}`);
      await db.execAsync(`DROP TABLE IF EXISTS ${TABLES.config_snapshots}`);
      await db.execAsync(`DROP TABLE IF EXISTS ${TABLES.config_sources}`);
      await db.execAsync(`PRAGMA user_version = 3`);
    },
  },
  {
    version: 6,
    up: async (db) => {
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS ${TABLES.app_packages} (
          package_key TEXT PRIMARY KEY,
          package_id TEXT NOT NULL,
          version TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
      `);
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS ${TABLES.app_package_state} (
          id TEXT PRIMARY KEY CHECK(id = 'default'),
          active_package_key TEXT,
          previous_package_key TEXT,
          updated_at TEXT NOT NULL
        )
      `);
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS ${TABLES.app_package_receipts} (
          id TEXT PRIMARY KEY,
          action TEXT NOT NULL CHECK(action IN ('bootstrap','activate','rollback')),
          package_key TEXT,
          previous_package_key TEXT,
          created_at TEXT NOT NULL
        )
      `);
      await db.execAsync(`PRAGMA user_version = 6`);
    },
    down: async (db) => {
      await db.execAsync(`DROP TABLE IF EXISTS ${TABLES.app_package_receipts}`);
      await db.execAsync(`DROP TABLE IF EXISTS ${TABLES.app_package_state}`);
      await db.execAsync(`DROP TABLE IF EXISTS ${TABLES.app_packages}`);
      await db.execAsync(`PRAGMA user_version = 5`);
    },
  },
  {
    version: 7,
    up: async (db) => {
      await db.execAsync(`ALTER TABLE ${TABLES.app_package_receipts} ADD COLUMN request_hash TEXT`);
      await db.execAsync(`ALTER TABLE ${TABLES.app_package_receipts} ADD COLUMN package_hash TEXT`);
      await db.execAsync(`ALTER TABLE ${TABLES.app_package_receipts} ADD COLUMN approval_hash TEXT`);
      await db.execAsync(`ALTER TABLE ${TABLES.app_package_receipts} ADD COLUMN approved_by TEXT`);
      await db.execAsync(`PRAGMA user_version = 7`);
    },
    down: async (db) => {
      await db.execAsync(`PRAGMA user_version = 6`);
    },
  },
  {
    version: 8,
    up: async (db) => {
      const now = new Date().toISOString();
      try {
        await db.execAsync(`ALTER TABLE ${TABLES.app_package_state} ADD COLUMN active_installation_id TEXT`);
      } catch {
        // Older local builds may already have this compatibility column.
      }
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS ${TABLES.workspaces} (
          id TEXT PRIMARY KEY,
          label TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
      `);
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS ${TABLES.app_installations} (
          installation_id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL,
          package_key TEXT,
          package_id TEXT,
          version TEXT,
          source_url TEXT,
          checksum TEXT,
          app_name TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'active'
            CHECK(status IN ('active','archived','disabled')),
          launch_path TEXT NOT NULL,
          approval_hash TEXT,
          approved_by TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (workspace_id) REFERENCES ${TABLES.workspaces}(id) ON DELETE CASCADE
        )
      `);
      await db.execAsync(`
        CREATE INDEX IF NOT EXISTS ${TABLES.app_installations}_workspace_status_idx
          ON ${TABLES.app_installations}(workspace_id, status, updated_at)
      `);
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS ${TABLES.app_installation_package_state} (
          installation_id TEXT PRIMARY KEY,
          active_package_key TEXT,
          previous_package_key TEXT,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (installation_id) REFERENCES ${TABLES.app_installations}(installation_id) ON DELETE CASCADE
        )
      `);
      await db.runAsync(
        `INSERT OR IGNORE INTO ${TABLES.workspaces}
          (id, label, created_at, updated_at)
          VALUES ($id, $label, $created_at, $updated_at)`,
        {
          $id: DEFAULT_WORKSPACE_ID,
          $label: 'Default workspace',
          $created_at: now,
          $updated_at: now,
        },
      );
      await db.runAsync(
        `INSERT OR IGNORE INTO ${TABLES.app_installations}
          (installation_id, workspace_id, app_name, status, launch_path, created_at, updated_at)
          VALUES ($installation_id, $workspace_id, $app_name, 'active', $launch_path, $created_at, $updated_at)`,
        {
          $installation_id: DEFAULT_APP_INSTALLATION_ID,
          $workspace_id: DEFAULT_WORKSPACE_ID,
          $app_name: 'Default app',
          $launch_path: `/apps/${DEFAULT_APP_INSTALLATION_ID}`,
          $created_at: now,
          $updated_at: now,
        },
      );
      await db.execAsync(`
        INSERT OR IGNORE INTO ${TABLES.app_installation_package_state}
          (installation_id, active_package_key, previous_package_key, updated_at)
        SELECT '${DEFAULT_APP_INSTALLATION_ID}', active_package_key, previous_package_key, updated_at
        FROM ${TABLES.app_package_state}
        WHERE id = 'default'
          AND (active_package_key IS NOT NULL OR previous_package_key IS NOT NULL)
      `);
      await db.execAsync(`PRAGMA user_version = 8`);
    },
    down: async (db) => {
      await db.execAsync(`DROP TABLE IF EXISTS ${TABLES.app_installation_package_state}`);
      await db.execAsync(`DROP TABLE IF EXISTS ${TABLES.app_installations}`);
      await db.execAsync(`DROP TABLE IF EXISTS ${TABLES.workspaces}`);
      await db.execAsync(`PRAGMA user_version = 7`);
    },
  },
  {
    version: 9,
    up: async (db) => {
      const addColumn = async (table: string, columnSql: string) => {
        try {
          await db.execAsync(`ALTER TABLE ${table} ADD COLUMN ${columnSql}`);
        } catch {
          // Existing debug/dev databases may already have these compatibility columns.
        }
      };
      await addColumn(TABLES.records, `app_installation_id TEXT NOT NULL DEFAULT '${DEFAULT_APP_INSTALLATION_ID}'`);
      await addColumn(TABLES.relations, `app_installation_id TEXT NOT NULL DEFAULT '${DEFAULT_APP_INSTALLATION_ID}'`);
      await addColumn(TABLES.operations, `app_installation_id TEXT NOT NULL DEFAULT '${DEFAULT_APP_INSTALLATION_ID}'`);
      await addColumn(TABLES.outbox, `app_installation_id TEXT NOT NULL DEFAULT '${DEFAULT_APP_INSTALLATION_ID}'`);
      await addColumn(TABLES.actions, `app_installation_id TEXT NOT NULL DEFAULT '${DEFAULT_APP_INSTALLATION_ID}'`);
      await addColumn(TABLES.undo_events, `app_installation_id TEXT NOT NULL DEFAULT '${DEFAULT_APP_INSTALLATION_ID}'`);
      await db.execAsync(`DROP INDEX IF EXISTS ${TABLES.records}_domain_idx`);
      await db.execAsync(`DROP INDEX IF EXISTS ${TABLES.records}_updated_idx`);
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS ${TABLES.records}_scoped (
          app_installation_id TEXT NOT NULL DEFAULT '${DEFAULT_APP_INSTALLATION_ID}',
          id TEXT NOT NULL,
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
          updated_at TEXT NOT NULL,
          revision INTEGER NOT NULL DEFAULT 1,
          schema_version TEXT NOT NULL DEFAULT '1.0.0',
          deleted INTEGER NOT NULL DEFAULT 0,
          privacy TEXT NOT NULL DEFAULT 'personal' CHECK(privacy IN ('private','personal','shared')),
          provenance_json TEXT,
          PRIMARY KEY (app_installation_id, id)
        )
      `);
      await db.execAsync(`
        INSERT OR IGNORE INTO ${TABLES.records}_scoped (
          app_installation_id, id, domain, collection, title, properties, source_provider,
          source_external_id, source_url, source_observed_at, source_content_hash, archived_at,
          created_at, updated_at, revision, schema_version, deleted, privacy, provenance_json
        )
        SELECT app_installation_id, id, domain, collection, title, properties, source_provider,
          source_external_id, source_url, source_observed_at, source_content_hash, archived_at,
          created_at, updated_at, revision, schema_version, deleted, privacy, provenance_json
        FROM ${TABLES.records}
      `);
      await db.execAsync(`DROP TABLE IF EXISTS ${TABLES.records}`);
      await db.execAsync(`ALTER TABLE ${TABLES.records}_scoped RENAME TO ${TABLES.records}`);
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS ${TABLES.relations}_scoped (
          app_installation_id TEXT NOT NULL DEFAULT '${DEFAULT_APP_INSTALLATION_ID}',
          from_id TEXT NOT NULL,
          collection TEXT NOT NULL,
          name TEXT NOT NULL,
          target_id TEXT NOT NULL,
          target_domain TEXT NOT NULL,
          target_collection TEXT NOT NULL,
          created_at TEXT NOT NULL,
          PRIMARY KEY (app_installation_id, from_id, name, target_id)
        )
      `);
      await db.execAsync(`
        INSERT OR IGNORE INTO ${TABLES.relations}_scoped (
          app_installation_id, from_id, collection, name, target_id, target_domain, target_collection, created_at
        )
        SELECT app_installation_id, from_id, collection, name, target_id, target_domain, target_collection, created_at
        FROM ${TABLES.relations}
      `);
      await db.execAsync(`DROP TABLE IF EXISTS ${TABLES.relations}`);
      await db.execAsync(`ALTER TABLE ${TABLES.relations}_scoped RENAME TO ${TABLES.relations}`);
      await db.execAsync(`DROP INDEX IF EXISTS ${TABLES.operations}_idem_idx`);
      await db.execAsync(`DROP INDEX IF EXISTS ${TABLES.operations}_record_idx`);
      await db.execAsync(`
        CREATE UNIQUE INDEX IF NOT EXISTS ${TABLES.records}_installation_id_idx
          ON ${TABLES.records}(app_installation_id, id)
      `);
      await db.execAsync(`
        CREATE INDEX IF NOT EXISTS ${TABLES.relations}_installation_from_idx
          ON ${TABLES.relations}(app_installation_id, from_id)
      `);
      await db.execAsync(`
        CREATE INDEX IF NOT EXISTS ${TABLES.operations}_installation_record_idx
          ON ${TABLES.operations}(app_installation_id, record_id, created_at)
      `);
      await db.execAsync(`
        CREATE UNIQUE INDEX IF NOT EXISTS ${TABLES.operations}_installation_idem_idx
          ON ${TABLES.operations}(app_installation_id, idempotency_key)
          WHERE idempotency_key IS NOT NULL
      `);
      await db.execAsync(`
        CREATE INDEX IF NOT EXISTS ${TABLES.actions}_installation_domain_idx
          ON ${TABLES.actions}(app_installation_id, domain, created_at)
      `);
      await db.execAsync(`
        CREATE INDEX IF NOT EXISTS ${TABLES.outbox}_installation_status_idx
          ON ${TABLES.outbox}(app_installation_id, status, updated_at)
      `);
      await db.execAsync(`PRAGMA user_version = 9`);
    },
    down: async (db) => {
      await db.execAsync(`DROP INDEX IF EXISTS ${TABLES.outbox}_installation_status_idx`);
      await db.execAsync(`DROP INDEX IF EXISTS ${TABLES.actions}_installation_domain_idx`);
      await db.execAsync(`DROP INDEX IF EXISTS ${TABLES.operations}_installation_idem_idx`);
      await db.execAsync(`DROP INDEX IF EXISTS ${TABLES.operations}_installation_record_idx`);
      await db.execAsync(`DROP INDEX IF EXISTS ${TABLES.relations}_installation_from_idx`);
      await db.execAsync(`DROP INDEX IF EXISTS ${TABLES.records}_installation_id_idx`);
      await db.execAsync(`PRAGMA user_version = 8`);
    },
  },
  {
    version: 10,
    up: async (db) => {
      const addColumn = async (table: string, columnSql: string) => {
        try {
          await db.execAsync(`ALTER TABLE ${table} ADD COLUMN ${columnSql}`);
        } catch {
          // Existing debug/dev databases may already have these compatibility columns.
        }
      };
      await addColumn(TABLES.conversations, `workspace_id TEXT NOT NULL DEFAULT '${DEFAULT_WORKSPACE_ID}'`);
      await addColumn(TABLES.conversations, `app_installation_id TEXT NOT NULL DEFAULT '${DEFAULT_APP_INSTALLATION_ID}'`);
      await addColumn(TABLES.conversations, `package_id TEXT`);
      await addColumn(TABLES.conversations, `package_version TEXT`);
      await addColumn(TABLES.workflow_runs, `app_installation_id TEXT NOT NULL DEFAULT '${DEFAULT_APP_INSTALLATION_ID}'`);
      await addColumn(TABLES.provider_links, `app_installation_id TEXT NOT NULL DEFAULT '${DEFAULT_APP_INSTALLATION_ID}'`);
      await addColumn(TABLES.source_snapshots, `app_installation_id TEXT NOT NULL DEFAULT '${DEFAULT_APP_INSTALLATION_ID}'`);
      await addColumn(TABLES.source_snapshots_causality, `app_installation_id TEXT NOT NULL DEFAULT '${DEFAULT_APP_INSTALLATION_ID}'`);
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS ${TABLES.provider_links}_scoped (
          app_installation_id TEXT NOT NULL DEFAULT '${DEFAULT_APP_INSTALLATION_ID}',
          id TEXT NOT NULL,
          provider TEXT NOT NULL,
          external_id TEXT NOT NULL,
          name TEXT NOT NULL,
          status TEXT NOT NULL,
          freshness TEXT,
          workspace TEXT,
          url TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (app_installation_id, id)
        )
      `);
      await db.execAsync(`
        INSERT OR IGNORE INTO ${TABLES.provider_links}_scoped (
          app_installation_id, id, provider, external_id, name, status, freshness, workspace, url, created_at, updated_at
        )
        SELECT app_installation_id, id, provider, external_id, name, status, freshness, workspace, url, created_at, updated_at
        FROM ${TABLES.provider_links}
      `);
      await db.execAsync(`DROP TABLE IF EXISTS ${TABLES.provider_links}`);
      await db.execAsync(`ALTER TABLE ${TABLES.provider_links}_scoped RENAME TO ${TABLES.provider_links}`);
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS ${TABLES.source_snapshots}_scoped (
          app_installation_id TEXT NOT NULL DEFAULT '${DEFAULT_APP_INSTALLATION_ID}',
          id TEXT NOT NULL,
          provider TEXT NOT NULL,
          external_id TEXT NOT NULL,
          scope TEXT,
          observed_at TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          checksum TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (app_installation_id, id)
        )
      `);
      await db.execAsync(`
        INSERT OR IGNORE INTO ${TABLES.source_snapshots}_scoped (
          app_installation_id, id, provider, external_id, scope, observed_at, payload_json, checksum, created_at, updated_at
        )
        SELECT app_installation_id, id, provider, external_id, scope, observed_at, payload_json, checksum, created_at, updated_at
        FROM ${TABLES.source_snapshots}
      `);
      await db.execAsync(`DROP TABLE IF EXISTS ${TABLES.source_snapshots}`);
      await db.execAsync(`ALTER TABLE ${TABLES.source_snapshots}_scoped RENAME TO ${TABLES.source_snapshots}`);
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS ${TABLES.source_snapshots_causality}_scoped (
          app_installation_id TEXT NOT NULL DEFAULT '${DEFAULT_APP_INSTALLATION_ID}',
          snapshot_id TEXT NOT NULL,
          record_id TEXT NOT NULL,
          PRIMARY KEY (app_installation_id, snapshot_id, record_id)
        )
      `);
      await db.execAsync(`
        INSERT OR IGNORE INTO ${TABLES.source_snapshots_causality}_scoped (
          app_installation_id, snapshot_id, record_id
        )
        SELECT app_installation_id, snapshot_id, record_id
        FROM ${TABLES.source_snapshots_causality}
      `);
      await db.execAsync(`DROP TABLE IF EXISTS ${TABLES.source_snapshots_causality}`);
      await db.execAsync(`ALTER TABLE ${TABLES.source_snapshots_causality}_scoped RENAME TO ${TABLES.source_snapshots_causality}`);
      await db.execAsync(`
        CREATE INDEX IF NOT EXISTS ${TABLES.conversations}_installation_domain_idx
          ON ${TABLES.conversations}(app_installation_id, domain, updated_at)
      `);
      await db.execAsync(`
        CREATE INDEX IF NOT EXISTS ${TABLES.workflow_runs}_installation_domain_idx
          ON ${TABLES.workflow_runs}(app_installation_id, domain, updated_at)
      `);
      await db.execAsync(`
        CREATE INDEX IF NOT EXISTS ${TABLES.provider_links}_installation_provider_idx
          ON ${TABLES.provider_links}(app_installation_id, provider, external_id)
      `);
      await db.execAsync(`
        CREATE INDEX IF NOT EXISTS ${TABLES.source_snapshots}_installation_provider_idx
          ON ${TABLES.source_snapshots}(app_installation_id, provider, external_id, observed_at)
      `);
      await db.execAsync(`PRAGMA user_version = 10`);
    },
    down: async (db) => {
      await db.execAsync(`DROP INDEX IF EXISTS ${TABLES.source_snapshots}_installation_provider_idx`);
      await db.execAsync(`DROP INDEX IF EXISTS ${TABLES.provider_links}_installation_provider_idx`);
      await db.execAsync(`DROP INDEX IF EXISTS ${TABLES.workflow_runs}_installation_domain_idx`);
      await db.execAsync(`DROP INDEX IF EXISTS ${TABLES.conversations}_installation_domain_idx`);
      await db.execAsync(`PRAGMA user_version = 9`);
    },
  },
  {
    version: 11,
    up: async (db) => {
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS ${TABLES.package_migration_journal} (
          id TEXT PRIMARY KEY,
          installation_id TEXT NOT NULL,
          workspace_id TEXT NOT NULL,
          state TEXT NOT NULL
            CHECK(state IN ('planned','approved','applying','activated','rolled_back','recovered','failed','manual_review')),
          plan_hash TEXT NOT NULL,
          operation_hash TEXT NOT NULL,
          snapshot_hash TEXT NOT NULL,
          from_package_key TEXT NOT NULL,
          to_package_key TEXT NOT NULL,
          from_checksum TEXT NOT NULL,
          to_checksum TEXT NOT NULL,
          affected_record_count INTEGER NOT NULL DEFAULT 0,
          plan_json TEXT NOT NULL,
          snapshot_json TEXT NOT NULL,
          approval_json TEXT,
          receipt_json TEXT,
          package_hash TEXT NOT NULL,
          actor_hash TEXT,
          policy_category TEXT,
          approval_expires_at TEXT,
          approval_nonce TEXT,
          consumed_receipt_hash TEXT,
          error_reason TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (installation_id) REFERENCES ${TABLES.app_installations}(installation_id) ON DELETE CASCADE,
          FOREIGN KEY (workspace_id) REFERENCES ${TABLES.workspaces}(id) ON DELETE CASCADE
        )
      `);
      await db.execAsync(`
        CREATE INDEX IF NOT EXISTS ${TABLES.package_migration_journal}_installation_state_idx
          ON ${TABLES.package_migration_journal}(installation_id, state, updated_at DESC)
      `);
      await db.execAsync(`
        CREATE INDEX IF NOT EXISTS ${TABLES.package_migration_journal}_approval_nonce_idx
          ON ${TABLES.package_migration_journal}(approval_nonce, installation_id)
      `);
      await db.execAsync(`PRAGMA user_version = 11`);
    },
    down: async (db) => {
      await db.execAsync(`DROP INDEX IF EXISTS ${TABLES.package_migration_journal}_approval_nonce_idx`);
      await db.execAsync(`DROP INDEX IF EXISTS ${TABLES.package_migration_journal}_installation_state_idx`);
      await db.execAsync(`DROP TABLE IF EXISTS ${TABLES.package_migration_journal}`);
      await db.execAsync(`PRAGMA user_version = 10`);
    },
  },
  {
    version: 12,
    up: async (db) => {
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS ${TABLES.cloud_accounts} (
          account_id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL,
          issuer TEXT NOT NULL,
          subject TEXT NOT NULL,
          email TEXT,
          email_verified INTEGER NOT NULL DEFAULT 0 CHECK(email_verified IN (0, 1)),
          display_name TEXT,
          status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'disabled', 'pending_delete')),
          profile_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE (workspace_id, issuer, subject),
          FOREIGN KEY (workspace_id) REFERENCES ${TABLES.workspaces}(id) ON DELETE CASCADE
        )
      `);
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS ${TABLES.cloud_devices} (
          device_id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL,
          account_id TEXT NOT NULL,
          app_installation_id TEXT,
          platform TEXT NOT NULL CHECK(platform IN ('ios', 'android', 'web', 'desktop', 'server')),
          device_label TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('pending', 'active', 'revoked', 'lost')),
          proof_key_id TEXT NOT NULL,
          proof_public_key TEXT NOT NULL,
          proof_alg TEXT NOT NULL,
          attestation_format TEXT,
          metadata_json TEXT NOT NULL,
          last_seen_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE (workspace_id, account_id, proof_key_id),
          UNIQUE (workspace_id, app_installation_id),
          FOREIGN KEY (workspace_id) REFERENCES ${TABLES.workspaces}(id) ON DELETE CASCADE,
          FOREIGN KEY (account_id) REFERENCES ${TABLES.cloud_accounts}(account_id) ON DELETE CASCADE,
          FOREIGN KEY (app_installation_id) REFERENCES ${TABLES.app_installations}(installation_id) ON DELETE SET NULL
        )
      `);
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS ${TABLES.cloud_sessions} (
          session_id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL,
          account_id TEXT NOT NULL,
          device_id TEXT NOT NULL,
          app_installation_id TEXT,
          issuer TEXT NOT NULL,
          subject TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'expired', 'revoked', 'rotated')),
          auth_flow TEXT NOT NULL CHECK(auth_flow IN ('oidc_code_pkce', 'refresh_token', 'device_rebind')),
          scope TEXT NOT NULL,
          proof_binding_id TEXT NOT NULL,
          proof_key_id TEXT NOT NULL,
          proof_alg TEXT NOT NULL,
          refresh_family_id TEXT,
          claims_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          access_expires_at TEXT,
          refresh_expires_at TEXT,
          last_proof_at TEXT,
          UNIQUE (workspace_id, proof_binding_id),
          FOREIGN KEY (workspace_id) REFERENCES ${TABLES.workspaces}(id) ON DELETE CASCADE,
          FOREIGN KEY (account_id) REFERENCES ${TABLES.cloud_accounts}(account_id) ON DELETE CASCADE,
          FOREIGN KEY (device_id) REFERENCES ${TABLES.cloud_devices}(device_id) ON DELETE CASCADE,
          FOREIGN KEY (app_installation_id) REFERENCES ${TABLES.app_installations}(installation_id) ON DELETE SET NULL
        )
      `);
      await db.execAsync(`
        CREATE INDEX IF NOT EXISTS ${TABLES.cloud_accounts}_workspace_status_idx
          ON ${TABLES.cloud_accounts}(workspace_id, status, updated_at DESC)
      `);
      await db.execAsync(`
        CREATE INDEX IF NOT EXISTS ${TABLES.cloud_devices}_account_status_idx
          ON ${TABLES.cloud_devices}(workspace_id, account_id, status, updated_at DESC)
      `);
      await db.execAsync(`
        CREATE INDEX IF NOT EXISTS ${TABLES.cloud_sessions}_account_status_idx
          ON ${TABLES.cloud_sessions}(workspace_id, account_id, status, updated_at DESC)
      `);
      await db.execAsync(`
        CREATE INDEX IF NOT EXISTS ${TABLES.cloud_sessions}_device_status_idx
          ON ${TABLES.cloud_sessions}(workspace_id, device_id, status, updated_at DESC)
      `);
      await db.execAsync(`PRAGMA user_version = 12`);
    },
    down: async (db) => {
      await db.execAsync(`DROP INDEX IF EXISTS ${TABLES.cloud_sessions}_device_status_idx`);
      await db.execAsync(`DROP INDEX IF EXISTS ${TABLES.cloud_sessions}_account_status_idx`);
      await db.execAsync(`DROP INDEX IF EXISTS ${TABLES.cloud_devices}_account_status_idx`);
      await db.execAsync(`DROP INDEX IF EXISTS ${TABLES.cloud_accounts}_workspace_status_idx`);
      await db.execAsync(`DROP TABLE IF EXISTS ${TABLES.cloud_sessions}`);
      await db.execAsync(`DROP TABLE IF EXISTS ${TABLES.cloud_devices}`);
      await db.execAsync(`DROP TABLE IF EXISTS ${TABLES.cloud_accounts}`);
      await db.execAsync(`PRAGMA user_version = 11`);
    },
  },
  {
    version: 13,
    up: async (db) => {
      const addColumn = async (table: string, columnSql: string) => {
        const columnName = columnSql.trim().split(/\s+/, 1)[0];
        const columns = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${table})`);
        if (columns.some((column) => column.name === columnName)) return;
        await db.execAsync(`ALTER TABLE ${table} ADD COLUMN ${columnSql}`);
      };
      await addColumn(
        TABLES.app_installations,
        `data_home_provider TEXT NOT NULL DEFAULT 'sqlite'`,
      );
      await addColumn(
        TABLES.app_installations,
        `data_home_external_id TEXT`,
      );
      await addColumn(
        TABLES.app_installations,
        `data_home_status TEXT NOT NULL DEFAULT 'local'`,
      );
      await addColumn(
        TABLES.app_installations,
        `data_home_updated_at TEXT`,
      );
      await db.execAsync(`PRAGMA user_version = 13`);
    },
    down: async (db) => {
      await db.execAsync(`PRAGMA user_version = 12`);
    },
  },
];

export async function getDatabaseVersion(db: SQLiteDatabase): Promise<number> {
  const row = await db.getFirstAsync<{ user_version: number | string }>('PRAGMA user_version');
  if (row == null) return 0;
  if (typeof row.user_version === 'number') return row.user_version;
  const parsed = Number.parseInt(row.user_version, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function runMigrations(db: SQLiteDatabase): Promise<void> {
  // Journal mode changes require autocommit mode on Android SQLite. Keep this
  // outside the migration transaction so a fresh install cannot remain behind
  // the splash screen while the provider waits for initialization.
  await db.execAsync('PRAGMA journal_mode = WAL');

  const currentVersion = await getDatabaseVersion(db);
  if (currentVersion > DATABASE_VERSION) {
    throw new Error(`Database schema is newer than app can handle: ${currentVersion}`);
  }

  for (const migration of MIGRATIONS) {
    if (migration.version <= currentVersion || migration.version > DATABASE_VERSION) {
      continue;
    }

    await db.withTransactionAsync(async () => {
      await db.execAsync('PRAGMA foreign_keys = OFF');
      await migration.up(db);
      await db.execAsync('PRAGMA foreign_keys = ON');
      await db.execAsync(`PRAGMA user_version = ${migration.version}`);
    });
  }
}

export async function rollbackDatabase(db: SQLiteDatabase, targetVersion: number): Promise<void> {
  const currentVersion = await getDatabaseVersion(db);
  if (targetVersion >= currentVersion) {
    return;
  }

  const migrationsToRollback = MIGRATIONS
    .filter((migration) => migration.version > targetVersion)
    .filter((migration): migration is Migration & { down: NonNullable<Migration['down']> } => typeof migration.down === 'function')
    .sort((a, b) => b.version - a.version);

  await db.withTransactionAsync(async () => {
    for (const migration of migrationsToRollback) {
      await migration.down(db);
    }
  });
}

export async function exportRecoverySnapshot(db: SQLiteDatabase): Promise<RecoveryExport> {
  const tables = Object.values(TABLES);
  const rows = [] as Array<{ name: string; rows: Array<Record<string, unknown>> }>;
  for (const table of tables) {
    try {
      const tableRows = await db.getAllAsync<Record<string, unknown>>(`SELECT * FROM ${table}`);
      rows.push({ name: table, rows: tableRows });
    } catch {
      rows.push({ name: table, rows: [] });
    }
  }

  return {
    schema_version: DATABASE_VERSION,
    tables: rows,
  };
}
