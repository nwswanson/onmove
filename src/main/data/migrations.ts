import type { SqliteAdapter } from './sqlite-adapter'

export interface Migration {
  readonly version: number
  readonly name: string
  up: (database: SqliteAdapter) => void
}

const migrations: readonly Migration[] = [
  {
    version: 1,
    name: 'hello_world_events',
    up(database) {
      database.exec(`
        CREATE TABLE IF NOT EXISTS app_events (
          id INTEGER PRIMARY KEY,
          kind TEXT NOT NULL CHECK (kind IN ('launch', 'greeting')),
          created_at TEXT NOT NULL
        ) STRICT;
      `)
    }
  },
  {
    version: 2,
    name: 'hierarchical_domain_model',
    up(database) {
      database.exec(`
        CREATE TABLE relations (
          id INTEGER PRIMARY KEY,
          name TEXT NOT NULL CHECK (length(trim(name)) > 0),
          meta_json TEXT NOT NULL DEFAULT '{}'
            CHECK (json_valid(meta_json) AND json_type(meta_json) = 'object'),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        ) STRICT;

        CREATE TABLE items (
          id INTEGER PRIMARY KEY,
          parent_id INTEGER REFERENCES items(id) ON DELETE CASCADE,
          relation_id INTEGER REFERENCES relations(id) ON DELETE SET NULL,
          current_status TEXT CHECK (
            current_status IS NULL OR length(trim(current_status)) > 0
          ),
          status_changed_at TEXT,
          status_meta_json TEXT NOT NULL DEFAULT '{}'
            CHECK (json_valid(status_meta_json) AND json_type(status_meta_json) = 'object'),
          meta_json TEXT NOT NULL DEFAULT '{}'
            CHECK (json_valid(meta_json) AND json_type(meta_json) = 'object'),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          CHECK (parent_id IS NULL OR parent_id <> id)
        ) STRICT;

        CREATE TABLE status_transitions (
          id INTEGER PRIMARY KEY,
          item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
          from_status TEXT,
          to_status TEXT,
          changed_at TEXT NOT NULL,
          meta_json TEXT NOT NULL DEFAULT '{}'
            CHECK (json_valid(meta_json) AND json_type(meta_json) = 'object'),
          CHECK (from_status IS NOT to_status)
        ) STRICT;

        CREATE INDEX items_parent_id_index ON items(parent_id);
        CREATE INDEX items_relation_id_index ON items(relation_id);
        CREATE INDEX status_transitions_item_id_index
          ON status_transitions(item_id, id DESC);

        CREATE TRIGGER items_log_initial_status
        AFTER INSERT ON items
        WHEN NEW.current_status IS NOT NULL
        BEGIN
          INSERT INTO status_transitions (
            item_id, from_status, to_status, changed_at, meta_json
          ) VALUES (
            NEW.id,
            NULL,
            NEW.current_status,
            strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
            NEW.status_meta_json
          );
          UPDATE items
          SET status_changed_at = (
            SELECT changed_at FROM status_transitions WHERE id = last_insert_rowid()
          )
          WHERE id = NEW.id;
        END;

        CREATE TRIGGER items_log_status_change
        AFTER UPDATE OF current_status ON items
        WHEN OLD.current_status IS NOT NEW.current_status
        BEGIN
          INSERT INTO status_transitions (
            item_id, from_status, to_status, changed_at, meta_json
          ) VALUES (
            NEW.id,
            OLD.current_status,
            NEW.current_status,
            strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
            NEW.status_meta_json
          );
          UPDATE items
          SET status_changed_at = (
            SELECT changed_at FROM status_transitions WHERE id = last_insert_rowid()
          )
          WHERE id = NEW.id;
        END;

        CREATE TRIGGER status_transitions_are_immutable
        BEFORE UPDATE ON status_transitions
        BEGIN
          SELECT RAISE(ABORT, 'status transitions are immutable');
        END;
      `)
    }
  },
  {
    version: 3,
    name: 'protect_status_transition_deletion',
    up(database) {
      database.exec(`
        CREATE TRIGGER status_transitions_delete_only_with_item
        BEFORE DELETE ON status_transitions
        WHEN EXISTS (SELECT 1 FROM items WHERE id = OLD.item_id)
        BEGIN
          SELECT RAISE(ABORT, 'status transitions are immutable');
        END;
      `)
    }
  }
]

interface MigrationRow {
  version: number
}

export const LATEST_SCHEMA_VERSION = migrations.at(-1)?.version ?? 0

export function runMigrations(database: SqliteAdapter, now = new Date()): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    ) STRICT;
  `)

  const appliedRows = database.all<MigrationRow>(
    'SELECT version FROM schema_migrations ORDER BY version'
  )
  const applied = new Set(appliedRows.map(({ version }) => Number(version)))
  const futureVersion = appliedRows.find(({ version }) => Number(version) > LATEST_SCHEMA_VERSION)

  if (futureVersion) {
    throw new Error(
      `Database schema version ${futureVersion.version} is newer than supported version ${LATEST_SCHEMA_VERSION}`
    )
  }

  for (const migration of migrations) {
    if (applied.has(migration.version)) continue

    database.transaction(() => {
      migration.up(database)
      database.run(
        'INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)',
        [migration.version, now.toISOString()]
      )
    })
  }
}
