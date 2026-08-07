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
  },
  {
    version: 4,
    name: 'focuses',
    up(database) {
      database.exec(`
        CREATE TABLE focuses (
          id INTEGER PRIMARY KEY,
          kind TEXT NOT NULL DEFAULT 'generic' CHECK (kind IN ('generic')),
          title TEXT NOT NULL CHECK (length(trim(title)) > 0),
          description TEXT,
          status TEXT NOT NULL DEFAULT 'active'
            CHECK (status IN ('active', 'paused', 'cancelled', 'done')),
          status_changed_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        ) STRICT;

        CREATE TABLE focus_status_transitions (
          id INTEGER PRIMARY KEY,
          focus_id INTEGER NOT NULL REFERENCES focuses(id) ON DELETE CASCADE,
          from_status TEXT CHECK (
            from_status IS NULL OR from_status IN ('active', 'paused', 'cancelled', 'done')
          ),
          to_status TEXT NOT NULL
            CHECK (to_status IN ('active', 'paused', 'cancelled', 'done')),
          changed_at TEXT NOT NULL,
          CHECK (from_status IS NOT to_status)
        ) STRICT;

        CREATE INDEX focuses_status_index ON focuses(status, id);
        CREATE INDEX focus_status_transitions_focus_id_index
          ON focus_status_transitions(focus_id, id DESC);

        CREATE TRIGGER focuses_log_initial_status
        AFTER INSERT ON focuses
        BEGIN
          INSERT INTO focus_status_transitions (
            focus_id, from_status, to_status, changed_at
          ) VALUES (
            NEW.id,
            NULL,
            NEW.status,
            strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          );
          UPDATE focuses
          SET status_changed_at = (
            SELECT changed_at FROM focus_status_transitions WHERE id = last_insert_rowid()
          )
          WHERE id = NEW.id;
        END;

        CREATE TRIGGER focuses_log_status_change
        AFTER UPDATE OF status ON focuses
        WHEN OLD.status IS NOT NEW.status
        BEGIN
          INSERT INTO focus_status_transitions (
            focus_id, from_status, to_status, changed_at
          ) VALUES (
            NEW.id,
            OLD.status,
            NEW.status,
            strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          );
          UPDATE focuses
          SET status_changed_at = (
            SELECT changed_at FROM focus_status_transitions WHERE id = last_insert_rowid()
          )
          WHERE id = NEW.id;
        END;

        CREATE TRIGGER focus_status_transitions_are_immutable
        BEFORE UPDATE ON focus_status_transitions
        BEGIN
          SELECT RAISE(ABORT, 'focus status transitions are immutable');
        END;

        CREATE TRIGGER focus_status_transitions_delete_only_with_focus
        BEFORE DELETE ON focus_status_transitions
        WHEN EXISTS (SELECT 1 FROM focuses WHERE id = OLD.focus_id)
        BEGIN
          SELECT RAISE(ABORT, 'focus status transitions are immutable');
        END;
      `)
    }
  },
  {
    version: 5,
    name: 'threads_commitments_and_updates',
    up(database) {
      database.exec(`
        CREATE TABLE threads (
          id INTEGER PRIMARY KEY,
          focus_id INTEGER NOT NULL REFERENCES focuses(id) ON DELETE CASCADE,
          title TEXT NOT NULL CHECK (length(trim(title)) > 0),
          status TEXT NOT NULL DEFAULT 'active'
            CHECK (status IN ('active', 'paused', 'cancelled', 'done')),
          review_frequency_days INTEGER NOT NULL
            CHECK (review_frequency_days > 0),
          status_changed_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        ) STRICT;

        CREATE TABLE commitments (
          id INTEGER PRIMARY KEY,
          focus_id INTEGER REFERENCES focuses(id) ON DELETE CASCADE,
          thread_id INTEGER REFERENCES threads(id) ON DELETE CASCADE,
          commitment_type TEXT NOT NULL
            CHECK (commitment_type IN ('action', 'ongoing')),
          title TEXT NOT NULL CHECK (length(trim(title)) > 0),
          status TEXT NOT NULL DEFAULT 'active'
            CHECK (status IN ('active', 'paused', 'cancelled', 'done')),
          due_on TEXT CHECK (
            due_on IS NULL OR (length(due_on) = 10 AND due_on = date(due_on))
          ),
          cadence_days INTEGER CHECK (cadence_days IS NULL OR cadence_days > 0),
          status_changed_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          CHECK (
            (focus_id IS NOT NULL AND thread_id IS NULL) OR
            (focus_id IS NULL AND thread_id IS NOT NULL)
          )
        ) STRICT;

        CREATE TABLE updates (
          id INTEGER PRIMARY KEY,
          focus_id INTEGER REFERENCES focuses(id) ON DELETE CASCADE,
          thread_id INTEGER REFERENCES threads(id) ON DELETE CASCADE,
          commitment_id INTEGER REFERENCES commitments(id) ON DELETE CASCADE,
          recorded_on TEXT NOT NULL CHECK (
            length(recorded_on) = 10 AND recorded_on = date(recorded_on)
          ),
          observation TEXT NOT NULL CHECK (length(trim(observation)) > 0),
          state TEXT NOT NULL DEFAULT 'none'
            CHECK (state IN ('red', 'yellow', 'green', 'none')),
          created_at TEXT NOT NULL,
          CHECK (
            (focus_id IS NOT NULL AND thread_id IS NULL AND commitment_id IS NULL) OR
            (focus_id IS NULL AND thread_id IS NOT NULL AND commitment_id IS NULL) OR
            (focus_id IS NULL AND thread_id IS NULL AND commitment_id IS NOT NULL)
          )
        ) STRICT;

        CREATE TABLE thread_status_transitions (
          id INTEGER PRIMARY KEY,
          thread_id INTEGER NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
          from_status TEXT CHECK (
            from_status IS NULL OR from_status IN ('active', 'paused', 'cancelled', 'done')
          ),
          to_status TEXT NOT NULL
            CHECK (to_status IN ('active', 'paused', 'cancelled', 'done')),
          changed_at TEXT NOT NULL,
          CHECK (from_status IS NOT to_status)
        ) STRICT;

        CREATE TABLE commitment_status_transitions (
          id INTEGER PRIMARY KEY,
          commitment_id INTEGER NOT NULL REFERENCES commitments(id) ON DELETE CASCADE,
          from_status TEXT CHECK (
            from_status IS NULL OR from_status IN ('active', 'paused', 'cancelled', 'done')
          ),
          to_status TEXT NOT NULL
            CHECK (to_status IN ('active', 'paused', 'cancelled', 'done')),
          changed_at TEXT NOT NULL,
          CHECK (from_status IS NOT to_status)
        ) STRICT;

        CREATE INDEX threads_focus_id_index ON threads(focus_id, id);
        CREATE INDEX commitments_focus_id_index ON commitments(focus_id, id);
        CREATE INDEX commitments_thread_id_index ON commitments(thread_id, id);
        CREATE INDEX updates_focus_date_index ON updates(focus_id, recorded_on DESC, id DESC);
        CREATE INDEX updates_thread_date_index ON updates(thread_id, recorded_on DESC, id DESC);
        CREATE INDEX updates_commitment_date_index
          ON updates(commitment_id, recorded_on DESC, id DESC);
        CREATE INDEX thread_status_transitions_thread_id_index
          ON thread_status_transitions(thread_id, id DESC);
        CREATE INDEX commitment_status_transitions_commitment_id_index
          ON commitment_status_transitions(commitment_id, id DESC);

        CREATE TRIGGER threads_log_initial_status
        AFTER INSERT ON threads
        BEGIN
          INSERT INTO thread_status_transitions (
            thread_id, from_status, to_status, changed_at
          ) VALUES (
            NEW.id, NULL, NEW.status, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          );
          UPDATE threads
          SET status_changed_at = (
            SELECT changed_at FROM thread_status_transitions WHERE id = last_insert_rowid()
          )
          WHERE id = NEW.id;
        END;

        CREATE TRIGGER threads_log_status_change
        AFTER UPDATE OF status ON threads
        WHEN OLD.status IS NOT NEW.status
        BEGIN
          INSERT INTO thread_status_transitions (
            thread_id, from_status, to_status, changed_at
          ) VALUES (
            NEW.id, OLD.status, NEW.status, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          );
          UPDATE threads
          SET status_changed_at = (
            SELECT changed_at FROM thread_status_transitions WHERE id = last_insert_rowid()
          )
          WHERE id = NEW.id;
        END;

        CREATE TRIGGER commitments_log_initial_status
        AFTER INSERT ON commitments
        BEGIN
          INSERT INTO commitment_status_transitions (
            commitment_id, from_status, to_status, changed_at
          ) VALUES (
            NEW.id, NULL, NEW.status, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          );
          UPDATE commitments
          SET status_changed_at = (
            SELECT changed_at FROM commitment_status_transitions WHERE id = last_insert_rowid()
          )
          WHERE id = NEW.id;
        END;

        CREATE TRIGGER commitments_log_status_change
        AFTER UPDATE OF status ON commitments
        WHEN OLD.status IS NOT NEW.status
        BEGIN
          INSERT INTO commitment_status_transitions (
            commitment_id, from_status, to_status, changed_at
          ) VALUES (
            NEW.id, OLD.status, NEW.status, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          );
          UPDATE commitments
          SET status_changed_at = (
            SELECT changed_at FROM commitment_status_transitions WHERE id = last_insert_rowid()
          )
          WHERE id = NEW.id;
        END;

        CREATE TRIGGER thread_status_transitions_are_immutable
        BEFORE UPDATE ON thread_status_transitions
        BEGIN
          SELECT RAISE(ABORT, 'thread status transitions are immutable');
        END;

        CREATE TRIGGER thread_status_transitions_delete_only_with_thread
        BEFORE DELETE ON thread_status_transitions
        WHEN EXISTS (SELECT 1 FROM threads WHERE id = OLD.thread_id)
        BEGIN
          SELECT RAISE(ABORT, 'thread status transitions are immutable');
        END;

        CREATE TRIGGER commitment_status_transitions_are_immutable
        BEFORE UPDATE ON commitment_status_transitions
        BEGIN
          SELECT RAISE(ABORT, 'commitment status transitions are immutable');
        END;

        CREATE TRIGGER commitment_status_transitions_delete_only_with_commitment
        BEFORE DELETE ON commitment_status_transitions
        WHEN EXISTS (SELECT 1 FROM commitments WHERE id = OLD.commitment_id)
        BEGIN
          SELECT RAISE(ABORT, 'commitment status transitions are immutable');
        END;
      `)
    }
  },
  {
    version: 6,
    name: 'focus_goal',
    up(database) {
      database.exec(`
        ALTER TABLE focuses
        ADD COLUMN goal TEXT NOT NULL DEFAULT '';
      `)
    }
  },
  {
    version: 7,
    name: 'optional_update_observation',
    up(database) {
      const updatesTable = database.get<{ found: number }>(
        "SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = 'updates'"
      )
      if (!updatesTable) return

      database.exec(`
        ALTER TABLE updates RENAME TO updates_with_required_observation;

        CREATE TABLE updates (
          id INTEGER PRIMARY KEY,
          focus_id INTEGER REFERENCES focuses(id) ON DELETE CASCADE,
          thread_id INTEGER REFERENCES threads(id) ON DELETE CASCADE,
          commitment_id INTEGER REFERENCES commitments(id) ON DELETE CASCADE,
          recorded_on TEXT NOT NULL CHECK (
            length(recorded_on) = 10 AND recorded_on = date(recorded_on)
          ),
          observation TEXT NOT NULL DEFAULT '',
          state TEXT NOT NULL DEFAULT 'none'
            CHECK (state IN ('red', 'yellow', 'green', 'none')),
          created_at TEXT NOT NULL,
          CHECK (
            (focus_id IS NOT NULL AND thread_id IS NULL AND commitment_id IS NULL) OR
            (focus_id IS NULL AND thread_id IS NOT NULL AND commitment_id IS NULL) OR
            (focus_id IS NULL AND thread_id IS NULL AND commitment_id IS NOT NULL)
          )
        ) STRICT;

        INSERT INTO updates (
          id, focus_id, thread_id, commitment_id, recorded_on, observation, state, created_at
        )
        SELECT
          id, focus_id, thread_id, commitment_id, recorded_on, observation, state, created_at
        FROM updates_with_required_observation;

        DROP TABLE updates_with_required_observation;

        CREATE INDEX updates_focus_date_index
          ON updates(focus_id, recorded_on DESC, id DESC);
        CREATE INDEX updates_thread_date_index
          ON updates(thread_id, recorded_on DESC, id DESC);
        CREATE INDEX updates_commitment_date_index
          ON updates(commitment_id, recorded_on DESC, id DESC);
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
