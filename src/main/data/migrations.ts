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
  },
  {
    version: 8,
    name: 'review_inclusion',
    up(database) {
      database.exec(`
        ALTER TABLE focuses
        ADD COLUMN needs_review INTEGER NOT NULL DEFAULT 1
          CHECK (needs_review IN (0, 1));

        ALTER TABLE threads
        ADD COLUMN needs_review INTEGER NOT NULL DEFAULT 1
          CHECK (needs_review IN (0, 1));
      `)
    }
  },
  {
    version: 9,
    name: 'sensitive_content_flags',
    up(database) {
      for (const table of ['focuses', 'threads', 'commitments', 'updates']) {
        const exists = database.get<{ found: number }>(
          "SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = ?",
          [table]
        )
        if (!exists) continue
        database.exec(`
          ALTER TABLE ${table}
          ADD COLUMN sensitive INTEGER NOT NULL DEFAULT 0
            CHECK (sensitive IN (0, 1));
        `)
      }
    }
  },
  {
    version: 10,
    name: 'focus_scopes_and_scoped_updates',
    up(database) {
      database.exec(`
        CREATE TABLE subjects (
          id INTEGER PRIMARY KEY,
          kind TEXT NOT NULL DEFAULT 'generic' CHECK (length(trim(kind)) > 0),
          name TEXT NOT NULL CHECK (length(trim(name)) > 0),
          description TEXT,
          external_key TEXT UNIQUE CHECK (
            external_key IS NULL OR length(trim(external_key)) > 0
          ),
          sensitive INTEGER NOT NULL DEFAULT 0 CHECK (sensitive IN (0, 1)),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        ) STRICT;

        CREATE TABLE scopes (
          id INTEGER PRIMARY KEY,
          focus_id INTEGER NOT NULL REFERENCES focuses(id) ON DELETE CASCADE,
          name TEXT NOT NULL CHECK (length(trim(name)) > 0),
          dimension TEXT NOT NULL CHECK (length(trim(dimension)) > 0),
          source_type TEXT NOT NULL DEFAULT 'explicit'
            CHECK (source_type IN ('explicit', 'derived')),
          base_scope_id INTEGER REFERENCES scopes(id)
            ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
          derived_relationship TEXT,
          context_subject_id INTEGER REFERENCES subjects(id) ON DELETE NO ACTION,
          sensitive INTEGER NOT NULL DEFAULT 0 CHECK (sensitive IN (0, 1)),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          CHECK (base_scope_id IS NULL OR base_scope_id <> id),
          CHECK (
            (source_type = 'explicit' AND derived_relationship IS NULL AND context_subject_id IS NULL) OR
            (source_type = 'derived' AND length(trim(derived_relationship)) > 0 AND context_subject_id IS NOT NULL)
          )
        ) STRICT;

        CREATE TABLE scope_memberships (
          id INTEGER PRIMARY KEY,
          scope_id INTEGER NOT NULL REFERENCES scopes(id) ON DELETE CASCADE,
          subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE NO ACTION,
          effect TEXT NOT NULL DEFAULT 'include' CHECK (effect IN ('include', 'exclude')),
          effective_from TEXT NOT NULL CHECK (
            length(effective_from) = 10 AND effective_from = date(effective_from)
          ),
          effective_until TEXT CHECK (
            effective_until IS NULL OR
            (length(effective_until) = 10 AND effective_until = date(effective_until))
          ),
          created_at TEXT NOT NULL,
          CHECK (effective_until IS NULL OR effective_until > effective_from),
          UNIQUE (scope_id, subject_id, effect, effective_from)
        ) STRICT;

        CREATE TABLE focus_scope_applications (
          focus_id INTEGER PRIMARY KEY REFERENCES focuses(id) ON DELETE CASCADE,
          mode TEXT NOT NULL DEFAULT 'open'
            CHECK (mode IN ('open', 'explicit', 'derived')),
          scope_id INTEGER REFERENCES scopes(id) ON DELETE CASCADE,
          updated_at TEXT NOT NULL,
          CHECK (
            (mode = 'open' AND scope_id IS NULL) OR
            (mode IN ('explicit', 'derived') AND scope_id IS NOT NULL)
          )
        ) STRICT;

        CREATE TABLE thread_scope_applications (
          thread_id INTEGER PRIMARY KEY REFERENCES threads(id) ON DELETE CASCADE,
          mode TEXT NOT NULL DEFAULT 'open'
            CHECK (mode IN ('open', 'inherited', 'explicit', 'derived')),
          scope_id INTEGER REFERENCES scopes(id) ON DELETE CASCADE,
          updated_at TEXT NOT NULL,
          CHECK (
            (mode IN ('open', 'inherited') AND scope_id IS NULL) OR
            (mode IN ('explicit', 'derived') AND scope_id IS NOT NULL)
          )
        ) STRICT;

        CREATE TABLE commitment_scope_applications (
          commitment_id INTEGER PRIMARY KEY REFERENCES commitments(id) ON DELETE CASCADE,
          mode TEXT NOT NULL DEFAULT 'open'
            CHECK (mode IN ('open', 'inherited', 'explicit', 'derived')),
          scope_id INTEGER REFERENCES scopes(id) ON DELETE CASCADE,
          updated_at TEXT NOT NULL,
          CHECK (
            (mode IN ('open', 'inherited') AND scope_id IS NULL) OR
            (mode IN ('explicit', 'derived') AND scope_id IS NOT NULL)
          )
        ) STRICT;

        CREATE INDEX subjects_kind_name_index ON subjects(kind, name, id);
        CREATE INDEX scopes_focus_dimension_index ON scopes(focus_id, dimension, id);
        CREATE INDEX scopes_base_scope_id_index ON scopes(base_scope_id);
        CREATE INDEX scope_memberships_effective_index
          ON scope_memberships(scope_id, effective_from, effective_until, subject_id);

        INSERT INTO focus_scope_applications (focus_id, mode, scope_id, updated_at)
        SELECT id, 'open', NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now') FROM focuses;

        CREATE TRIGGER focuses_create_scope_application
        AFTER INSERT ON focuses
        BEGIN
          INSERT INTO focus_scope_applications (focus_id, mode, scope_id, updated_at)
          VALUES (NEW.id, 'open', NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
        END;

        CREATE TRIGGER focus_scope_application_matches_scope_insert
        BEFORE INSERT ON focus_scope_applications
        WHEN NEW.scope_id IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM scopes
          WHERE id = NEW.scope_id AND focus_id = NEW.focus_id AND source_type = NEW.mode
        )
        BEGIN
          SELECT RAISE(ABORT, 'focus scope application must use a matching scope owned by the focus');
        END;

        CREATE TRIGGER focus_scope_application_matches_scope_update
        BEFORE UPDATE OF mode, scope_id ON focus_scope_applications
        WHEN NEW.scope_id IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM scopes
          WHERE id = NEW.scope_id AND focus_id = NEW.focus_id AND source_type = NEW.mode
        )
        BEGIN
          SELECT RAISE(ABORT, 'focus scope application must use a matching scope owned by the focus');
        END;

        CREATE TRIGGER focus_scope_application_is_required
        AFTER DELETE ON focus_scope_applications
        WHEN EXISTS (SELECT 1 FROM focuses WHERE id = OLD.focus_id)
        BEGIN
          INSERT INTO focus_scope_applications (focus_id, mode, scope_id, updated_at)
          VALUES (OLD.focus_id, 'open', NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
        END;
      `)

      const threadColumns = database.all<{ name: string }>('PRAGMA table_info(threads)')
      const hasCompleteThreads = threadColumns.some(({ name }) => name === 'focus_id')
      if (hasCompleteThreads) {
        database.exec(`
          INSERT INTO thread_scope_applications (thread_id, mode, scope_id, updated_at)
          SELECT id, 'open', NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now') FROM threads;

          CREATE TRIGGER threads_create_scope_application
          AFTER INSERT ON threads
          BEGIN
            INSERT INTO thread_scope_applications (thread_id, mode, scope_id, updated_at)
            SELECT
              NEW.id,
              CASE WHEN parent.mode = 'open' THEN 'open' ELSE 'inherited' END,
              NULL,
              strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            FROM focus_scope_applications parent
            WHERE parent.focus_id = NEW.focus_id;
          END;

          CREATE TRIGGER thread_scope_application_matches_scope_insert
          BEFORE INSERT ON thread_scope_applications
          WHEN NEW.scope_id IS NOT NULL AND NOT EXISTS (
            SELECT 1
            FROM scopes scope
            JOIN threads thread ON thread.id = NEW.thread_id
            WHERE scope.id = NEW.scope_id
              AND scope.focus_id = thread.focus_id
              AND scope.source_type = NEW.mode
          )
          BEGIN
            SELECT RAISE(ABORT, 'thread scope application must use a matching scope owned by its focus');
          END;

          CREATE TRIGGER thread_scope_application_matches_scope_update
          BEFORE UPDATE OF mode, scope_id ON thread_scope_applications
          WHEN NEW.scope_id IS NOT NULL AND NOT EXISTS (
            SELECT 1
            FROM scopes scope
            JOIN threads thread ON thread.id = NEW.thread_id
            WHERE scope.id = NEW.scope_id
              AND scope.focus_id = thread.focus_id
              AND scope.source_type = NEW.mode
          )
          BEGIN
            SELECT RAISE(ABORT, 'thread scope application must use a matching scope owned by its focus');
          END;

          CREATE TRIGGER thread_scope_application_is_required
          AFTER DELETE ON thread_scope_applications
          WHEN EXISTS (SELECT 1 FROM threads WHERE id = OLD.thread_id)
          BEGIN
            INSERT INTO thread_scope_applications (thread_id, mode, scope_id, updated_at)
            VALUES (OLD.thread_id, 'open', NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
          END;
        `)
      }

      const commitmentColumns = database.all<{ name: string }>('PRAGMA table_info(commitments)')
      const hasCompleteCommitments = commitmentColumns.some(({ name }) => name === 'focus_id')
      if (hasCompleteCommitments) {
        database.exec(`
          INSERT INTO commitment_scope_applications (
            commitment_id, mode, scope_id, updated_at
          )
          SELECT id, 'open', NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          FROM commitments;

          CREATE TRIGGER commitments_create_scope_application
          AFTER INSERT ON commitments
          BEGIN
            INSERT INTO commitment_scope_applications (
              commitment_id, mode, scope_id, updated_at
            )
            VALUES (
              NEW.id,
              CASE
                WHEN NEW.focus_id IS NOT NULL THEN
                  CASE WHEN (
                    SELECT mode FROM focus_scope_applications WHERE focus_id = NEW.focus_id
                  ) = 'open' THEN 'open' ELSE 'inherited' END
                ELSE
                  CASE WHEN (
                    SELECT mode FROM thread_scope_applications WHERE thread_id = NEW.thread_id
                  ) = 'open' THEN 'open' ELSE 'inherited' END
              END,
              NULL,
              strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            );
          END;

          CREATE TRIGGER commitment_scope_application_matches_scope_insert
          BEFORE INSERT ON commitment_scope_applications
          WHEN NEW.scope_id IS NOT NULL AND NOT EXISTS (
            SELECT 1
            FROM scopes scope
            JOIN commitments commitment ON commitment.id = NEW.commitment_id
            LEFT JOIN threads thread ON thread.id = commitment.thread_id
            WHERE scope.id = NEW.scope_id
              AND scope.focus_id = COALESCE(commitment.focus_id, thread.focus_id)
              AND scope.source_type = NEW.mode
          )
          BEGIN
            SELECT RAISE(ABORT, 'commitment scope application must use a matching scope owned by its focus');
          END;

          CREATE TRIGGER commitment_scope_application_matches_scope_update
          BEFORE UPDATE OF mode, scope_id ON commitment_scope_applications
          WHEN NEW.scope_id IS NOT NULL AND NOT EXISTS (
            SELECT 1
            FROM scopes scope
            JOIN commitments commitment ON commitment.id = NEW.commitment_id
            LEFT JOIN threads thread ON thread.id = commitment.thread_id
            WHERE scope.id = NEW.scope_id
              AND scope.focus_id = COALESCE(commitment.focus_id, thread.focus_id)
              AND scope.source_type = NEW.mode
          )
          BEGIN
            SELECT RAISE(ABORT, 'commitment scope application must use a matching scope owned by its focus');
          END;

          CREATE TRIGGER commitment_scope_application_is_required
          AFTER DELETE ON commitment_scope_applications
          WHEN EXISTS (SELECT 1 FROM commitments WHERE id = OLD.commitment_id)
          BEGIN
            INSERT INTO commitment_scope_applications (
              commitment_id, mode, scope_id, updated_at
            ) VALUES (
              OLD.commitment_id, 'open', NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            );
          END;
        `)
      }

      const updateColumns = database.all<{ name: string }>('PRAGMA table_info(updates)')
      const hasCompleteUpdates = ['focus_id', 'thread_id', 'commitment_id', 'sensitive'].every(
        (column) => updateColumns.some(({ name }) => name === column)
      )
      if (hasCompleteUpdates) {
        database.exec(`
          ALTER TABLE updates RENAME TO updates_without_scope;

          CREATE TABLE updates (
            id INTEGER PRIMARY KEY,
            focus_id INTEGER REFERENCES focuses(id) ON DELETE CASCADE,
            thread_id INTEGER REFERENCES threads(id) ON DELETE CASCADE,
            commitment_id INTEGER REFERENCES commitments(id) ON DELETE CASCADE,
            scope_id INTEGER REFERENCES scopes(id)
              ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
            subject_id INTEGER REFERENCES subjects(id)
              ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
            recorded_on TEXT NOT NULL CHECK (
              length(recorded_on) = 10 AND recorded_on = date(recorded_on)
            ),
            observation TEXT NOT NULL DEFAULT '',
            state TEXT NOT NULL DEFAULT 'none'
              CHECK (state IN ('red', 'yellow', 'green', 'none')),
            sensitive INTEGER NOT NULL DEFAULT 0 CHECK (sensitive IN (0, 1)),
            created_at TEXT NOT NULL,
            CHECK (
              (focus_id IS NOT NULL AND thread_id IS NULL AND commitment_id IS NULL) OR
              (focus_id IS NULL AND thread_id IS NOT NULL AND commitment_id IS NULL) OR
              (focus_id IS NULL AND thread_id IS NULL AND commitment_id IS NOT NULL)
            ),
            CHECK (
              (scope_id IS NULL AND subject_id IS NULL) OR
              (scope_id IS NOT NULL AND subject_id IS NOT NULL AND focus_id IS NULL)
            )
          ) STRICT;

          INSERT INTO updates (
            id, focus_id, thread_id, commitment_id, scope_id, subject_id,
            recorded_on, observation, state, sensitive, created_at
          )
          SELECT
            id, focus_id, thread_id, commitment_id, NULL, NULL,
            recorded_on, observation, state, sensitive, created_at
          FROM updates_without_scope;

          DROP TABLE updates_without_scope;

          CREATE INDEX updates_focus_date_index
            ON updates(focus_id, recorded_on DESC, id DESC);
          CREATE INDEX updates_thread_date_index
            ON updates(thread_id, recorded_on DESC, id DESC);
          CREATE INDEX updates_commitment_date_index
            ON updates(commitment_id, recorded_on DESC, id DESC);
          CREATE INDEX updates_scope_cell_date_index
            ON updates(scope_id, subject_id, recorded_on DESC, id DESC);

          CREATE TRIGGER updates_scope_matches_parent_focus_insert
          BEFORE INSERT ON updates
          WHEN NEW.scope_id IS NOT NULL AND NOT EXISTS (
            SELECT 1
            FROM scopes scope
            LEFT JOIN threads thread ON thread.id = NEW.thread_id
            LEFT JOIN commitments commitment ON commitment.id = NEW.commitment_id
            LEFT JOIN threads commitment_thread ON commitment_thread.id = commitment.thread_id
            WHERE scope.id = NEW.scope_id
              AND scope.focus_id = COALESCE(
                thread.focus_id,
                commitment.focus_id,
                commitment_thread.focus_id
              )
          )
          BEGIN
            SELECT RAISE(ABORT, 'scoped update must use a scope owned by its parent focus');
          END;

          CREATE TRIGGER updates_scope_matches_parent_focus_update
          BEFORE UPDATE OF focus_id, thread_id, commitment_id, scope_id ON updates
          WHEN NEW.scope_id IS NOT NULL AND NOT EXISTS (
            SELECT 1
            FROM scopes scope
            LEFT JOIN threads thread ON thread.id = NEW.thread_id
            LEFT JOIN commitments commitment ON commitment.id = NEW.commitment_id
            LEFT JOIN threads commitment_thread ON commitment_thread.id = commitment.thread_id
            WHERE scope.id = NEW.scope_id
              AND scope.focus_id = COALESCE(
                thread.focus_id,
                commitment.focus_id,
                commitment_thread.focus_id
              )
          )
          BEGIN
            SELECT RAISE(ABORT, 'scoped update must use a scope owned by its parent focus');
          END;
        `)
      }
    }
  },
  {
    version: 11,
    name: 'scope_application_transition_history',
    up(database) {
      const requiredTables = [
        'focuses',
        'threads',
        'commitments',
        'scopes',
        'focus_scope_applications',
        'thread_scope_applications',
        'commitment_scope_applications'
      ]
      const hasCompleteScopeDomain = requiredTables.every((table) => database.get<{ found: number }>(
        "SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = ?",
        [table]
      ))
      if (!hasCompleteScopeDomain) return

      database.exec(`
        CREATE TABLE scope_application_transitions (
          id INTEGER PRIMARY KEY,
          focus_id INTEGER REFERENCES focuses(id) ON DELETE CASCADE,
          thread_id INTEGER REFERENCES threads(id) ON DELETE CASCADE,
          commitment_id INTEGER REFERENCES commitments(id) ON DELETE CASCADE,
          from_mode TEXT CHECK (
            from_mode IS NULL OR from_mode IN ('open', 'inherited', 'explicit', 'derived')
          ),
          from_scope_id INTEGER REFERENCES scopes(id)
            ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
          to_mode TEXT NOT NULL
            CHECK (to_mode IN ('open', 'inherited', 'explicit', 'derived')),
          to_scope_id INTEGER REFERENCES scopes(id)
            ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
          changed_at TEXT NOT NULL,
          CHECK (
            (focus_id IS NOT NULL AND thread_id IS NULL AND commitment_id IS NULL) OR
            (focus_id IS NULL AND thread_id IS NOT NULL AND commitment_id IS NULL) OR
            (focus_id IS NULL AND thread_id IS NULL AND commitment_id IS NOT NULL)
          ),
          CHECK (
            (from_mode IS NULL AND from_scope_id IS NULL) OR
            (from_mode IN ('open', 'inherited') AND from_scope_id IS NULL) OR
            (from_mode IN ('explicit', 'derived') AND from_scope_id IS NOT NULL)
          ),
          CHECK (
            (to_mode IN ('open', 'inherited') AND to_scope_id IS NULL) OR
            (to_mode IN ('explicit', 'derived') AND to_scope_id IS NOT NULL)
          ),
          CHECK (
            from_mode IS NULL OR
            from_mode IS NOT to_mode OR
            from_scope_id IS NOT to_scope_id
          )
        ) STRICT;

        CREATE INDEX scope_application_transitions_focus_index
          ON scope_application_transitions(focus_id, id);
        CREATE INDEX scope_application_transitions_thread_index
          ON scope_application_transitions(thread_id, id);
        CREATE INDEX scope_application_transitions_commitment_index
          ON scope_application_transitions(commitment_id, id);
        CREATE INDEX scope_application_transitions_from_scope_index
          ON scope_application_transitions(from_scope_id, id);
        CREATE INDEX scope_application_transitions_to_scope_index
          ON scope_application_transitions(to_scope_id, id);

        INSERT INTO scope_application_transitions (
          focus_id, from_mode, from_scope_id, to_mode, to_scope_id, changed_at
        )
        SELECT focus_id, NULL, NULL, mode, scope_id, updated_at
        FROM focus_scope_applications;

        INSERT INTO scope_application_transitions (
          thread_id, from_mode, from_scope_id, to_mode, to_scope_id, changed_at
        )
        SELECT thread_id, NULL, NULL, mode, scope_id, updated_at
        FROM thread_scope_applications;

        INSERT INTO scope_application_transitions (
          commitment_id, from_mode, from_scope_id, to_mode, to_scope_id, changed_at
        )
        SELECT commitment_id, NULL, NULL, mode, scope_id, updated_at
        FROM commitment_scope_applications;

        CREATE TRIGGER focus_scope_application_log_initial
        AFTER INSERT ON focus_scope_applications
        BEGIN
          INSERT INTO scope_application_transitions (
            focus_id, from_mode, from_scope_id, to_mode, to_scope_id, changed_at
          ) VALUES (
            NEW.focus_id, NULL, NULL, NEW.mode, NEW.scope_id, NEW.updated_at
          );
        END;

        CREATE TRIGGER focus_scope_application_log_change
        AFTER UPDATE OF mode, scope_id ON focus_scope_applications
        WHEN OLD.mode IS NOT NEW.mode OR OLD.scope_id IS NOT NEW.scope_id
        BEGIN
          INSERT INTO scope_application_transitions (
            focus_id, from_mode, from_scope_id, to_mode, to_scope_id, changed_at
          ) VALUES (
            NEW.focus_id, OLD.mode, OLD.scope_id, NEW.mode, NEW.scope_id,
            CASE
              WHEN NEW.updated_at IS OLD.updated_at
                THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
              ELSE NEW.updated_at
            END
          );
        END;

        CREATE TRIGGER thread_scope_application_log_initial
        AFTER INSERT ON thread_scope_applications
        BEGIN
          INSERT INTO scope_application_transitions (
            thread_id, from_mode, from_scope_id, to_mode, to_scope_id, changed_at
          ) VALUES (
            NEW.thread_id, NULL, NULL, NEW.mode, NEW.scope_id, NEW.updated_at
          );
        END;

        CREATE TRIGGER thread_scope_application_log_change
        AFTER UPDATE OF mode, scope_id ON thread_scope_applications
        WHEN OLD.mode IS NOT NEW.mode OR OLD.scope_id IS NOT NEW.scope_id
        BEGIN
          INSERT INTO scope_application_transitions (
            thread_id, from_mode, from_scope_id, to_mode, to_scope_id, changed_at
          ) VALUES (
            NEW.thread_id, OLD.mode, OLD.scope_id, NEW.mode, NEW.scope_id,
            CASE
              WHEN NEW.updated_at IS OLD.updated_at
                THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
              ELSE NEW.updated_at
            END
          );
        END;

        CREATE TRIGGER commitment_scope_application_log_initial
        AFTER INSERT ON commitment_scope_applications
        BEGIN
          INSERT INTO scope_application_transitions (
            commitment_id, from_mode, from_scope_id, to_mode, to_scope_id, changed_at
          ) VALUES (
            NEW.commitment_id, NULL, NULL, NEW.mode, NEW.scope_id, NEW.updated_at
          );
        END;

        CREATE TRIGGER commitment_scope_application_log_change
        AFTER UPDATE OF mode, scope_id ON commitment_scope_applications
        WHEN OLD.mode IS NOT NEW.mode OR OLD.scope_id IS NOT NEW.scope_id
        BEGIN
          INSERT INTO scope_application_transitions (
            commitment_id, from_mode, from_scope_id, to_mode, to_scope_id, changed_at
          ) VALUES (
            NEW.commitment_id, OLD.mode, OLD.scope_id, NEW.mode, NEW.scope_id,
            CASE
              WHEN NEW.updated_at IS OLD.updated_at
                THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
              ELSE NEW.updated_at
            END
          );
        END;

        CREATE TRIGGER focus_scope_application_delete_only_with_focus
        BEFORE DELETE ON focus_scope_applications
        WHEN EXISTS (SELECT 1 FROM focuses WHERE id = OLD.focus_id)
        BEGIN
          SELECT RAISE(ABORT, 'a surviving Focus must retain its Scope application');
        END;

        CREATE TRIGGER thread_scope_application_delete_only_with_thread
        BEFORE DELETE ON thread_scope_applications
        WHEN EXISTS (SELECT 1 FROM threads WHERE id = OLD.thread_id)
        BEGIN
          SELECT RAISE(ABORT, 'a surviving Thread must retain its Scope application');
        END;

        CREATE TRIGGER commitment_scope_application_delete_only_with_commitment
        BEFORE DELETE ON commitment_scope_applications
        WHEN EXISTS (SELECT 1 FROM commitments WHERE id = OLD.commitment_id)
        BEGIN
          SELECT RAISE(ABORT, 'a surviving Commitment must retain its Scope application');
        END;

        CREATE TRIGGER scope_application_transitions_are_immutable
        BEFORE UPDATE ON scope_application_transitions
        BEGIN
          SELECT RAISE(ABORT, 'Scope application transitions are immutable');
        END;

        CREATE TRIGGER scope_application_transitions_delete_only_with_owner
        BEFORE DELETE ON scope_application_transitions
        WHEN
          (OLD.focus_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM focuses WHERE id = OLD.focus_id
          )) OR
          (OLD.thread_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM threads WHERE id = OLD.thread_id
          )) OR
          (OLD.commitment_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM commitments WHERE id = OLD.commitment_id
          ))
        BEGIN
          SELECT RAISE(ABORT, 'Scope application transitions are immutable');
        END;
      `)
    }
  },
  {
    version: 12,
    name: 'commitments_derive_thread_scope',
    up(database) {
      const requiredTables = [
        'commitments',
        'commitment_scope_applications',
        'thread_scope_applications'
      ]
      const hasCompleteScopeDomain = requiredTables.every((table) => database.get<{ found: number }>(
        "SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = ?",
        [table]
      ))
      if (!hasCompleteScopeDomain) return

      database.exec(`
        DROP TRIGGER IF EXISTS commitments_create_scope_application;

        UPDATE commitment_scope_applications
        SET
          mode = CASE
            WHEN EXISTS (
              SELECT 1 FROM commitments
              WHERE commitments.id = commitment_scope_applications.commitment_id
                AND commitments.thread_id IS NOT NULL
            ) THEN 'inherited'
            ELSE 'open'
          END,
          scope_id = NULL,
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE
          scope_id IS NOT NULL OR
          mode IS NOT CASE
            WHEN EXISTS (
              SELECT 1 FROM commitments
              WHERE commitments.id = commitment_scope_applications.commitment_id
                AND commitments.thread_id IS NOT NULL
            ) THEN 'inherited'
            ELSE 'open'
          END;

        CREATE TRIGGER commitments_create_scope_application
        AFTER INSERT ON commitments
        BEGIN
          INSERT INTO commitment_scope_applications (
            commitment_id, mode, scope_id, updated_at
          ) VALUES (
            NEW.id,
            CASE WHEN NEW.thread_id IS NOT NULL THEN 'inherited' ELSE 'open' END,
            NULL,
            strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          );
        END;

        CREATE TRIGGER commitment_scope_application_is_derived_insert
        BEFORE INSERT ON commitment_scope_applications
        WHEN
          (
            EXISTS (
              SELECT 1 FROM commitments
              WHERE commitments.id = NEW.commitment_id
                AND commitments.thread_id IS NOT NULL
            ) AND (NEW.mode IS NOT 'inherited' OR NEW.scope_id IS NOT NULL)
          ) OR (
            EXISTS (
              SELECT 1 FROM commitments
              WHERE commitments.id = NEW.commitment_id
                AND commitments.focus_id IS NOT NULL
            ) AND (NEW.mode IS NOT 'open' OR NEW.scope_id IS NOT NULL)
          )
        BEGIN
          SELECT RAISE(
            ABORT,
            'Commitment Scope is derived: Thread-owned Commitments inherit and Focus-owned Commitments are open'
          );
        END;

        CREATE TRIGGER commitment_scope_application_is_derived_update
        BEFORE UPDATE OF mode, scope_id ON commitment_scope_applications
        WHEN
          (
            EXISTS (
              SELECT 1 FROM commitments
              WHERE commitments.id = NEW.commitment_id
                AND commitments.thread_id IS NOT NULL
            ) AND (NEW.mode IS NOT 'inherited' OR NEW.scope_id IS NOT NULL)
          ) OR (
            EXISTS (
              SELECT 1 FROM commitments
              WHERE commitments.id = NEW.commitment_id
                AND commitments.focus_id IS NOT NULL
            ) AND (NEW.mode IS NOT 'open' OR NEW.scope_id IS NOT NULL)
          )
        BEGIN
          SELECT RAISE(
            ABORT,
            'Commitment Scope is derived: Thread-owned Commitments inherit and Focus-owned Commitments are open'
          );
        END;
      `)
    }
  },
  {
    version: 13,
    name: 'contextual_todos',
    up(database) {
      const requiredTables = ['focuses', 'threads', 'commitments', 'scopes', 'subjects']
      const hasCompleteWorkDomain = requiredTables.every((table) => database.get<{ found: number }>(
        "SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = ?",
        [table]
      ))
      if (!hasCompleteWorkDomain) return
      database.exec(`
        CREATE TABLE todos (
          id INTEGER PRIMARY KEY,
          focus_id INTEGER REFERENCES focuses(id) ON DELETE CASCADE,
          thread_id INTEGER REFERENCES threads(id) ON DELETE CASCADE,
          commitment_id INTEGER REFERENCES commitments(id) ON DELETE CASCADE,
          scope_id INTEGER REFERENCES scopes(id)
            ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
          subject_id INTEGER REFERENCES subjects(id)
            ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
          name TEXT NOT NULL CHECK (length(trim(name)) > 0),
          due_on TEXT CHECK (
            due_on IS NULL OR (length(due_on) = 10 AND due_on = date(due_on))
          ),
          done INTEGER NOT NULL DEFAULT 0 CHECK (done IN (0, 1)),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          CHECK (
            (focus_id IS NOT NULL AND thread_id IS NULL AND commitment_id IS NULL) OR
            (focus_id IS NULL AND thread_id IS NOT NULL AND commitment_id IS NULL) OR
            (focus_id IS NULL AND thread_id IS NULL AND commitment_id IS NOT NULL)
          ),
          CHECK (
            (scope_id IS NULL AND subject_id IS NULL) OR
            (scope_id IS NOT NULL AND subject_id IS NOT NULL AND focus_id IS NULL)
          )
        ) STRICT;

        CREATE INDEX todos_focus_index ON todos(focus_id, id);
        CREATE INDEX todos_thread_index ON todos(thread_id, id);
        CREATE INDEX todos_commitment_index ON todos(commitment_id, id);
        CREATE INDEX todos_scope_cell_index ON todos(scope_id, subject_id, id);
        CREATE INDEX todos_due_index ON todos(due_on, done, id);

        CREATE TABLE todo_lists (
          id INTEGER PRIMARY KEY,
          focus_id INTEGER REFERENCES focuses(id) ON DELETE CASCADE,
          thread_id INTEGER REFERENCES threads(id) ON DELETE CASCADE,
          commitment_id INTEGER REFERENCES commitments(id) ON DELETE CASCADE,
          scope_id INTEGER REFERENCES scopes(id)
            ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
          subject_id INTEGER REFERENCES subjects(id)
            ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
          created_at TEXT NOT NULL,
          CHECK (
            (focus_id IS NOT NULL AND thread_id IS NULL AND commitment_id IS NULL) OR
            (focus_id IS NULL AND thread_id IS NOT NULL AND commitment_id IS NULL) OR
            (focus_id IS NULL AND thread_id IS NULL AND commitment_id IS NOT NULL)
          ),
          CHECK (
            (scope_id IS NULL AND subject_id IS NULL) OR
            (scope_id IS NOT NULL AND subject_id IS NOT NULL AND focus_id IS NULL)
          )
        ) STRICT;

        CREATE UNIQUE INDEX todo_lists_focus_unique
          ON todo_lists(focus_id) WHERE focus_id IS NOT NULL;
        CREATE UNIQUE INDEX todo_lists_thread_aggregate_unique
          ON todo_lists(thread_id) WHERE thread_id IS NOT NULL AND scope_id IS NULL;
        CREATE UNIQUE INDEX todo_lists_thread_scope_unique
          ON todo_lists(thread_id, scope_id, subject_id)
          WHERE thread_id IS NOT NULL AND scope_id IS NOT NULL;
        CREATE UNIQUE INDEX todo_lists_commitment_aggregate_unique
          ON todo_lists(commitment_id) WHERE commitment_id IS NOT NULL AND scope_id IS NULL;
        CREATE UNIQUE INDEX todo_lists_commitment_scope_unique
          ON todo_lists(commitment_id, scope_id, subject_id)
          WHERE commitment_id IS NOT NULL AND scope_id IS NOT NULL;

        CREATE TABLE todo_sort_placements (
          todo_id INTEGER NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
          list_id INTEGER NOT NULL REFERENCES todo_lists(id) ON DELETE CASCADE,
          sort_key INTEGER NOT NULL CHECK (sort_key >= 0),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (todo_id, list_id)
        ) STRICT;

        CREATE INDEX todo_sort_placements_list_order_index
          ON todo_sort_placements(list_id, sort_key, todo_id);

        CREATE TRIGGER todos_scope_matches_parent_focus_insert
        BEFORE INSERT ON todos
        WHEN NEW.scope_id IS NOT NULL AND NOT EXISTS (
          SELECT 1
          FROM scopes scope
          LEFT JOIN threads thread ON thread.id = NEW.thread_id
          LEFT JOIN commitments commitment ON commitment.id = NEW.commitment_id
          LEFT JOIN threads commitment_thread ON commitment_thread.id = commitment.thread_id
          WHERE scope.id = NEW.scope_id
            AND scope.focus_id = COALESCE(
              thread.focus_id,
              commitment.focus_id,
              commitment_thread.focus_id
            )
        )
        BEGIN
          SELECT RAISE(ABORT, 'scoped Todo must use a Scope owned by its parent focus');
        END;

        CREATE TRIGGER todos_scope_matches_parent_focus_update
        BEFORE UPDATE OF focus_id, thread_id, commitment_id, scope_id ON todos
        WHEN NEW.scope_id IS NOT NULL AND NOT EXISTS (
          SELECT 1
          FROM scopes scope
          LEFT JOIN threads thread ON thread.id = NEW.thread_id
          LEFT JOIN commitments commitment ON commitment.id = NEW.commitment_id
          LEFT JOIN threads commitment_thread ON commitment_thread.id = commitment.thread_id
          WHERE scope.id = NEW.scope_id
            AND scope.focus_id = COALESCE(
              thread.focus_id,
              commitment.focus_id,
              commitment_thread.focus_id
            )
        )
        BEGIN
          SELECT RAISE(ABORT, 'scoped Todo must use a Scope owned by its parent focus');
        END;

        CREATE TRIGGER todos_parent_is_immutable
        BEFORE UPDATE OF focus_id, thread_id, commitment_id, scope_id, subject_id ON todos
        WHEN
          OLD.focus_id IS NOT NEW.focus_id OR
          OLD.thread_id IS NOT NEW.thread_id OR
          OLD.commitment_id IS NOT NEW.commitment_id OR
          OLD.scope_id IS NOT NEW.scope_id OR
          OLD.subject_id IS NOT NEW.subject_id
        BEGIN
          SELECT RAISE(ABORT, 'Todo parent context is immutable');
        END;

        CREATE TRIGGER todo_lists_scope_matches_parent_focus_insert
        BEFORE INSERT ON todo_lists
        WHEN NEW.scope_id IS NOT NULL AND NOT EXISTS (
          SELECT 1
          FROM scopes scope
          LEFT JOIN threads thread ON thread.id = NEW.thread_id
          LEFT JOIN commitments commitment ON commitment.id = NEW.commitment_id
          LEFT JOIN threads commitment_thread ON commitment_thread.id = commitment.thread_id
          WHERE scope.id = NEW.scope_id
            AND scope.focus_id = COALESCE(
              thread.focus_id,
              commitment.focus_id,
              commitment_thread.focus_id
            )
        )
        BEGIN
          SELECT RAISE(ABORT, 'Todo list Scope must be owned by its parent focus');
        END;

        CREATE TRIGGER todo_list_context_is_immutable
        BEFORE UPDATE OF focus_id, thread_id, commitment_id, scope_id, subject_id ON todo_lists
        WHEN
          OLD.focus_id IS NOT NEW.focus_id OR
          OLD.thread_id IS NOT NEW.thread_id OR
          OLD.commitment_id IS NOT NEW.commitment_id OR
          OLD.scope_id IS NOT NEW.scope_id OR
          OLD.subject_id IS NOT NEW.subject_id
        BEGIN
          SELECT RAISE(ABORT, 'Todo list context is immutable');
        END;

        CREATE TRIGGER todo_sort_placement_matches_context_insert
        BEFORE INSERT ON todo_sort_placements
        WHEN NOT EXISTS (
          SELECT 1
          FROM todos todo
          JOIN todo_lists list ON list.id = NEW.list_id
          WHERE todo.id = NEW.todo_id
            AND todo.focus_id IS list.focus_id
            AND todo.thread_id IS list.thread_id
            AND todo.commitment_id IS list.commitment_id
            AND (
              list.scope_id IS NULL OR (
                todo.scope_id IS list.scope_id AND todo.subject_id IS list.subject_id
              )
            )
        )
        BEGIN
          SELECT RAISE(ABORT, 'Todo sort placement must match its parent context');
        END;

        CREATE TRIGGER todo_sort_placement_matches_context_update
        BEFORE UPDATE OF todo_id, list_id ON todo_sort_placements
        WHEN NOT EXISTS (
          SELECT 1
          FROM todos todo
          JOIN todo_lists list ON list.id = NEW.list_id
          WHERE todo.id = NEW.todo_id
            AND todo.focus_id IS list.focus_id
            AND todo.thread_id IS list.thread_id
            AND todo.commitment_id IS list.commitment_id
            AND (
              list.scope_id IS NULL OR (
                todo.scope_id IS list.scope_id AND todo.subject_id IS list.subject_id
              )
            )
        )
        BEGIN
          SELECT RAISE(ABORT, 'Todo sort placement must match its parent context');
        END;
      `)
    }
  },
  {
    version: 14,
    name: 'notes_and_durable_rich_text',
    up(database) {
      const requiredTables = ['focuses', 'threads', 'commitments', 'updates']
      const hasCompleteWorkDomain = requiredTables.every((table) => database.get<{ found: number }>(
        "SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = ?",
        [table]
      ))
      if (!hasCompleteWorkDomain) return

      database.exec(`
        ALTER TABLE focuses ADD COLUMN goal_revision INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE focuses ADD COLUMN description_revision INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE updates ADD COLUMN observation_revision INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE updates ADD COLUMN updated_at TEXT;
        UPDATE updates SET updated_at = created_at WHERE updated_at IS NULL;

        CREATE TABLE notes (
          id INTEGER PRIMARY KEY,
          focus_id INTEGER REFERENCES focuses(id) ON DELETE CASCADE,
          thread_id INTEGER REFERENCES threads(id) ON DELETE CASCADE,
          commitment_id INTEGER REFERENCES commitments(id) ON DELETE CASCADE,
          title TEXT NOT NULL CHECK (length(trim(title)) > 0),
          content TEXT NOT NULL DEFAULT '',
          content_revision INTEGER NOT NULL DEFAULT 0 CHECK (content_revision >= 0),
          sort_key INTEGER NOT NULL DEFAULT 0 CHECK (sort_key >= 0),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          CHECK (
            (focus_id IS NOT NULL AND thread_id IS NULL AND commitment_id IS NULL) OR
            (focus_id IS NULL AND thread_id IS NOT NULL AND commitment_id IS NULL) OR
            (focus_id IS NULL AND thread_id IS NULL AND commitment_id IS NOT NULL)
          )
        ) STRICT;

        CREATE INDEX notes_focus_index ON notes(focus_id, sort_key, id);
        CREATE INDEX notes_thread_index ON notes(thread_id, sort_key, id);
        CREATE INDEX notes_commitment_index ON notes(commitment_id, sort_key, id);

        CREATE TABLE rich_text_history (
          document_type TEXT NOT NULL CHECK (
            document_type IN ('focus-goal', 'focus-description', 'update-observation', 'note-content')
          ),
          entity_id INTEGER NOT NULL CHECK (entity_id > 0),
          revision INTEGER NOT NULL CHECK (revision > 0),
          value TEXT NOT NULL,
          changed_at TEXT NOT NULL,
          PRIMARY KEY (document_type, entity_id, revision)
        ) STRICT, WITHOUT ROWID;

        CREATE INDEX rich_text_history_changed_index
          ON rich_text_history(changed_at, document_type, entity_id);

        INSERT INTO notes (focus_id, title, created_at, updated_at)
          SELECT id, 'Default', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
                 strftime('%Y-%m-%dT%H:%M:%fZ', 'now') FROM focuses;
        INSERT INTO notes (thread_id, title, created_at, updated_at)
          SELECT id, 'Default', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
                 strftime('%Y-%m-%dT%H:%M:%fZ', 'now') FROM threads;
        INSERT INTO notes (commitment_id, title, created_at, updated_at)
          SELECT id, 'Default', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
                 strftime('%Y-%m-%dT%H:%M:%fZ', 'now') FROM commitments;

        CREATE TRIGGER focuses_create_default_note
        AFTER INSERT ON focuses
        BEGIN
          INSERT INTO notes (focus_id, title, created_at, updated_at)
          VALUES (
            NEW.id, 'Default', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
            strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          );
        END;

        CREATE TRIGGER threads_create_default_note
        AFTER INSERT ON threads
        BEGIN
          INSERT INTO notes (thread_id, title, created_at, updated_at)
          VALUES (
            NEW.id, 'Default', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
            strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          );
        END;

        CREATE TRIGGER commitments_create_default_note
        AFTER INSERT ON commitments
        BEGIN
          INSERT INTO notes (commitment_id, title, created_at, updated_at)
          VALUES (
            NEW.id, 'Default', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
            strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          );
        END;

        CREATE TRIGGER focuses_version_goal
        AFTER UPDATE OF goal ON focuses
        WHEN OLD.goal IS NOT NEW.goal
        BEGIN
          UPDATE focuses SET goal_revision = OLD.goal_revision + 1 WHERE id = NEW.id;
          INSERT INTO rich_text_history (document_type, entity_id, revision, value, changed_at)
          VALUES ('focus-goal', NEW.id, OLD.goal_revision + 1, NEW.goal, NEW.updated_at);
        END;

        CREATE TRIGGER focuses_version_description
        AFTER UPDATE OF description ON focuses
        WHEN OLD.description IS NOT NEW.description
        BEGIN
          UPDATE focuses SET description_revision = OLD.description_revision + 1 WHERE id = NEW.id;
          INSERT INTO rich_text_history (document_type, entity_id, revision, value, changed_at)
          VALUES (
            'focus-description', NEW.id, OLD.description_revision + 1,
            COALESCE(NEW.description, ''), NEW.updated_at
          );
        END;

        CREATE TRIGGER updates_version_observation
        AFTER UPDATE OF observation ON updates
        WHEN OLD.observation IS NOT NEW.observation
        BEGIN
          UPDATE updates SET observation_revision = OLD.observation_revision + 1 WHERE id = NEW.id;
          INSERT INTO rich_text_history (document_type, entity_id, revision, value, changed_at)
          VALUES (
            'update-observation', NEW.id, OLD.observation_revision + 1,
            NEW.observation, NEW.updated_at
          );
        END;

        CREATE TRIGGER updates_fill_updated_at
        AFTER INSERT ON updates
        WHEN NEW.updated_at IS NULL
        BEGIN
          UPDATE updates SET updated_at = NEW.created_at WHERE id = NEW.id;
        END;

        CREATE TRIGGER notes_version_content
        AFTER UPDATE OF content ON notes
        WHEN OLD.content IS NOT NEW.content
        BEGIN
          UPDATE notes SET content_revision = OLD.content_revision + 1 WHERE id = NEW.id;
          INSERT INTO rich_text_history (document_type, entity_id, revision, value, changed_at)
          VALUES ('note-content', NEW.id, OLD.content_revision + 1, NEW.content, NEW.updated_at);
        END;

        CREATE TRIGGER focuses_delete_rich_text_history
        AFTER DELETE ON focuses
        BEGIN
          DELETE FROM rich_text_history
          WHERE entity_id = OLD.id AND document_type IN ('focus-goal', 'focus-description');
        END;

        CREATE TRIGGER updates_delete_rich_text_history
        AFTER DELETE ON updates
        BEGIN
          DELETE FROM rich_text_history
          WHERE entity_id = OLD.id AND document_type = 'update-observation';
        END;

        CREATE TRIGGER notes_delete_rich_text_history
        AFTER DELETE ON notes
        BEGIN
          DELETE FROM rich_text_history
          WHERE entity_id = OLD.id AND document_type = 'note-content';
        END;
      `)
    }
  },
  {
    version: 15,
    name: 'review_pokes',
    up(database) {
      const requiredTables = ['focuses', 'threads', 'commitments']
      const hasCompleteWorkDomain = requiredTables.every((table) => database.get<{ found: number }>(
        "SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = ?",
        [table]
      ))
      if (!hasCompleteWorkDomain) return

      database.exec(`
        ALTER TABLE focuses ADD COLUMN review_poked_on TEXT CHECK (
          review_poked_on IS NULL OR (
            length(review_poked_on) = 10 AND review_poked_on = date(review_poked_on)
          )
        );
        ALTER TABLE threads ADD COLUMN review_poked_on TEXT CHECK (
          review_poked_on IS NULL OR (
            length(review_poked_on) = 10 AND review_poked_on = date(review_poked_on)
          )
        );
        ALTER TABLE commitments ADD COLUMN review_poked_on TEXT CHECK (
          review_poked_on IS NULL OR (
            length(review_poked_on) = 10 AND review_poked_on = date(review_poked_on)
          )
        );
      `)
    }
  },
  {
    version: 16,
    name: 'commitment_parent_moves',
    up(database) {
      const requiredTables = [
        'focuses',
        'threads',
        'commitments',
        'commitment_scope_applications'
      ]
      const hasCompleteWorkDomain = requiredTables.every((table) => database.get<{ found: number }>(
        "SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = ?",
        [table]
      ))
      if (!hasCompleteWorkDomain) return
      const commitmentColumns = database.all<{ name: string }>('PRAGMA table_info(commitments)')
      const initialChangedAt = commitmentColumns.some(({ name }) => name === 'created_at')
        ? 'created_at'
        : "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')"

      database.exec(`
        CREATE TABLE commitment_parent_transitions (
          id INTEGER PRIMARY KEY,
          commitment_id INTEGER NOT NULL REFERENCES commitments(id) ON DELETE CASCADE,
          from_focus_id INTEGER,
          from_thread_id INTEGER,
          to_focus_id INTEGER,
          to_thread_id INTEGER,
          changed_at TEXT NOT NULL,
          CHECK (
            (from_focus_id IS NULL AND from_thread_id IS NULL) OR
            (from_focus_id IS NOT NULL AND from_thread_id IS NULL) OR
            (from_focus_id IS NULL AND from_thread_id IS NOT NULL)
          ),
          CHECK (
            (to_focus_id IS NOT NULL AND to_thread_id IS NULL) OR
            (to_focus_id IS NULL AND to_thread_id IS NOT NULL)
          ),
          CHECK (
            from_focus_id IS NOT to_focus_id OR from_thread_id IS NOT to_thread_id
          )
        ) STRICT;

        CREATE INDEX commitment_parent_transitions_commitment_index
          ON commitment_parent_transitions(commitment_id, id);

        INSERT INTO commitment_parent_transitions (
          commitment_id, from_focus_id, from_thread_id,
          to_focus_id, to_thread_id, changed_at
        )
        SELECT id, NULL, NULL, focus_id, thread_id, ${initialChangedAt}
        FROM commitments;

        CREATE TRIGGER commitments_log_initial_parent
        AFTER INSERT ON commitments
        BEGIN
          INSERT INTO commitment_parent_transitions (
            commitment_id, from_focus_id, from_thread_id,
            to_focus_id, to_thread_id, changed_at
          ) VALUES (
            NEW.id, NULL, NULL, NEW.focus_id, NEW.thread_id,
            strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          );
        END;

        CREATE TRIGGER commitments_reject_cross_focus_move
        BEFORE UPDATE OF focus_id, thread_id ON commitments
        WHEN
          OLD.focus_id IS NOT NEW.focus_id OR OLD.thread_id IS NOT NEW.thread_id
        BEGIN
          SELECT CASE WHEN
            COALESCE(
              OLD.focus_id,
              (SELECT focus_id FROM threads WHERE id = OLD.thread_id)
            ) IS NOT COALESCE(
              NEW.focus_id,
              (SELECT focus_id FROM threads WHERE id = NEW.thread_id)
            )
          THEN RAISE(ABORT, 'a Commitment cannot move outside its Focus') END;
        END;

        CREATE TRIGGER commitments_sync_scope_after_parent_move
        AFTER UPDATE OF focus_id, thread_id ON commitments
        WHEN
          OLD.focus_id IS NOT NEW.focus_id OR OLD.thread_id IS NOT NEW.thread_id
        BEGIN
          UPDATE commitment_scope_applications
          SET
            mode = CASE WHEN NEW.thread_id IS NOT NULL THEN 'inherited' ELSE 'open' END,
            scope_id = NULL,
            updated_at = NEW.updated_at
          WHERE commitment_id = NEW.id;

          INSERT INTO commitment_parent_transitions (
            commitment_id, from_focus_id, from_thread_id,
            to_focus_id, to_thread_id, changed_at
          ) VALUES (
            NEW.id, OLD.focus_id, OLD.thread_id,
            NEW.focus_id, NEW.thread_id, NEW.updated_at
          );
        END;

        CREATE TRIGGER commitment_parent_transitions_are_immutable
        BEFORE UPDATE ON commitment_parent_transitions
        BEGIN
          SELECT RAISE(ABORT, 'Commitment parent transitions are immutable');
        END;

        CREATE TRIGGER commitment_parent_transitions_delete_only_with_commitment
        BEFORE DELETE ON commitment_parent_transitions
        WHEN EXISTS (
          SELECT 1 FROM commitments WHERE id = OLD.commitment_id
        )
        BEGIN
          SELECT RAISE(ABORT, 'Commitment parent transitions are immutable');
        END;
      `)
    }
  },
  {
    version: 17,
    name: 'todo_completion_timestamps',
    up(database) {
      const hasTodos = database.get<{ found: number }>(
        "SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = 'todos'"
      )
      if (!hasTodos) return

      database.exec(`
        ALTER TABLE todos ADD COLUMN completed_at TEXT CHECK (
          completed_at IS NULL OR datetime(completed_at) IS NOT NULL
        );

        UPDATE todos
        SET completed_at = COALESCE(updated_at, created_at)
        WHERE done = 1 AND completed_at IS NULL;

        CREATE INDEX todos_overview_index
          ON todos(done, completed_at, due_on, id);

        CREATE TRIGGER todos_completion_state_insert
        BEFORE INSERT ON todos
        WHEN
          (NEW.done = 0 AND NEW.completed_at IS NOT NULL) OR
          (NEW.done = 1 AND NEW.completed_at IS NULL)
        BEGIN
          SELECT RAISE(ABORT, 'Todo completion timestamp must match done state');
        END;

        CREATE TRIGGER todos_completion_state_update
        BEFORE UPDATE OF done, completed_at ON todos
        WHEN
          (NEW.done = 0 AND NEW.completed_at IS NOT NULL) OR
          (NEW.done = 1 AND NEW.completed_at IS NULL)
        BEGIN
          SELECT RAISE(ABORT, 'Todo completion timestamp must match done state');
        END;
      `)
    }
  },
  {
    version: 18,
    name: 'shared_subject_todos',
    up(database) {
      const hasTodos = database.get<{ found: number }>(
        "SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = 'todos'"
      )
      if (!hasTodos) return

      database.exec(`
        ALTER TABLE todos ADD COLUMN shared_across_subjects INTEGER NOT NULL DEFAULT 0
          CHECK (shared_across_subjects IN (0, 1));

        CREATE TABLE todo_subject_completions (
          todo_id INTEGER NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
          subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE NO ACTION,
          done INTEGER NOT NULL DEFAULT 0 CHECK (done IN (0, 1)),
          completed_at TEXT CHECK (
            completed_at IS NULL OR datetime(completed_at) IS NOT NULL
          ),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (todo_id, subject_id),
          CHECK (
            (done = 0 AND completed_at IS NULL) OR
            (done = 1 AND completed_at IS NOT NULL)
          )
        ) STRICT;

        CREATE INDEX todo_subject_completions_subject_index
          ON todo_subject_completions(subject_id, todo_id);

        CREATE TRIGGER todos_shared_parent_insert
        BEFORE INSERT ON todos
        WHEN NEW.shared_across_subjects = 1 AND (
          NEW.focus_id IS NOT NULL OR
          (NEW.thread_id IS NULL AND NEW.commitment_id IS NULL) OR
          NEW.scope_id IS NOT NULL OR NEW.subject_id IS NOT NULL
        )
        BEGIN
          SELECT RAISE(ABORT, 'shared Todo requires an aggregate Thread or Commitment parent');
        END;

        CREATE TRIGGER todos_shared_parent_update
        BEFORE UPDATE OF shared_across_subjects, focus_id, thread_id, commitment_id, scope_id, subject_id
        ON todos
        WHEN NEW.shared_across_subjects = 1 AND (
          NEW.focus_id IS NOT NULL OR
          (NEW.thread_id IS NULL AND NEW.commitment_id IS NULL) OR
          NEW.scope_id IS NOT NULL OR NEW.subject_id IS NOT NULL
        )
        BEGIN
          SELECT RAISE(ABORT, 'shared Todo requires an aggregate Thread or Commitment parent');
        END;

        CREATE TRIGGER todos_shared_mode_is_immutable
        BEFORE UPDATE OF shared_across_subjects ON todos
        WHEN OLD.shared_across_subjects IS NOT NEW.shared_across_subjects
        BEGIN
          SELECT RAISE(ABORT, 'Todo sharing mode is immutable');
        END;

        CREATE TRIGGER todo_subject_completion_requires_shared_insert
        BEFORE INSERT ON todo_subject_completions
        WHEN NOT EXISTS (
          SELECT 1 FROM todos
          WHERE id = NEW.todo_id AND shared_across_subjects = 1
        )
        BEGIN
          SELECT RAISE(ABORT, 'Todo Subject completion requires a shared Todo');
        END;

        CREATE TRIGGER todo_subject_completion_identity_is_immutable
        BEFORE UPDATE OF todo_id, subject_id ON todo_subject_completions
        WHEN OLD.todo_id IS NOT NEW.todo_id OR OLD.subject_id IS NOT NEW.subject_id
        BEGIN
          SELECT RAISE(ABORT, 'Todo Subject completion identity is immutable');
        END;

        DROP TRIGGER todo_sort_placement_matches_context_insert;
        DROP TRIGGER todo_sort_placement_matches_context_update;

        CREATE TRIGGER todo_sort_placement_matches_context_insert
        BEFORE INSERT ON todo_sort_placements
        WHEN NOT EXISTS (
          SELECT 1
          FROM todos todo
          JOIN todo_lists list ON list.id = NEW.list_id
          WHERE todo.id = NEW.todo_id
            AND todo.focus_id IS list.focus_id
            AND todo.thread_id IS list.thread_id
            AND todo.commitment_id IS list.commitment_id
            AND (
              list.scope_id IS NULL OR (
                todo.shared_across_subjects = 0 AND
                todo.scope_id IS list.scope_id AND todo.subject_id IS list.subject_id
              ) OR (
                todo.shared_across_subjects = 1 AND todo.scope_id IS NULL AND
                EXISTS (
                  SELECT 1 FROM todo_subject_completions completion
                  WHERE completion.todo_id = todo.id
                    AND completion.subject_id = list.subject_id
                )
              )
            )
        )
        BEGIN
          SELECT RAISE(ABORT, 'Todo sort placement must match its parent context');
        END;

        CREATE TRIGGER todo_sort_placement_matches_context_update
        BEFORE UPDATE OF todo_id, list_id ON todo_sort_placements
        WHEN NOT EXISTS (
          SELECT 1
          FROM todos todo
          JOIN todo_lists list ON list.id = NEW.list_id
          WHERE todo.id = NEW.todo_id
            AND todo.focus_id IS list.focus_id
            AND todo.thread_id IS list.thread_id
            AND todo.commitment_id IS list.commitment_id
            AND (
              list.scope_id IS NULL OR (
                todo.shared_across_subjects = 0 AND
                todo.scope_id IS list.scope_id AND todo.subject_id IS list.subject_id
              ) OR (
                todo.shared_across_subjects = 1 AND todo.scope_id IS NULL AND
                EXISTS (
                  SELECT 1 FROM todo_subject_completions completion
                  WHERE completion.todo_id = todo.id
                    AND completion.subject_id = list.subject_id
                )
              )
            )
        )
        BEGIN
          SELECT RAISE(ABORT, 'Todo sort placement must match its parent context');
        END;
      `)
    }
  },
  {
    version: 19,
    name: 'thread_focus_moves',
    up(database) {
      const requiredTables = [
        'focuses',
        'threads',
        'todos',
        'todo_lists',
        'commitments',
        'thread_scope_applications'
      ]
      const hasCompleteDomain = requiredTables.every((table) => database.get<{ found: number }>(
        "SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = ?",
        [table]
      ))
      if (!hasCompleteDomain) return
      const threadColumns = database.all<{ name: string }>('PRAGMA table_info(threads)')
      const hasThreadColumn = (name: string): boolean =>
        threadColumns.some((column) => column.name === name)
      const initialChangedAt = hasThreadColumn('created_at')
        ? 'created_at'
        : "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')"
      const movedChangedAt = hasThreadColumn('updated_at')
        ? 'NEW.updated_at'
        : "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')"

      database.exec(`
        CREATE TABLE thread_move_operations (
          thread_id INTEGER PRIMARY KEY REFERENCES threads(id) ON DELETE CASCADE,
          from_focus_id INTEGER NOT NULL REFERENCES focuses(id) ON DELETE CASCADE,
          to_focus_id INTEGER NOT NULL REFERENCES focuses(id) ON DELETE CASCADE,
          created_at TEXT NOT NULL,
          CHECK (from_focus_id <> to_focus_id)
        ) STRICT;

        CREATE TABLE thread_parent_transitions (
          id INTEGER PRIMARY KEY,
          thread_id INTEGER NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
          from_focus_id INTEGER,
          to_focus_id INTEGER NOT NULL,
          changed_at TEXT NOT NULL,
          CHECK (from_focus_id IS NULL OR from_focus_id <> to_focus_id)
        ) STRICT;

        CREATE INDEX thread_parent_transitions_thread_index
          ON thread_parent_transitions(thread_id, id);

        INSERT INTO thread_parent_transitions (
          thread_id, from_focus_id, to_focus_id, changed_at
        )
        SELECT id, NULL, focus_id, ${initialChangedAt} FROM threads;

        CREATE TRIGGER threads_log_initial_parent
        AFTER INSERT ON threads
        BEGIN
          INSERT INTO thread_parent_transitions (
            thread_id, from_focus_id, to_focus_id, changed_at
          ) VALUES (
            NEW.id, NULL, NEW.focus_id,
            strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          );
        END;

        CREATE TRIGGER threads_focus_move_requires_operation
        BEFORE UPDATE OF focus_id ON threads
        WHEN OLD.focus_id IS NOT NEW.focus_id AND NOT EXISTS (
          SELECT 1 FROM thread_move_operations operation
          WHERE operation.thread_id = OLD.id
            AND operation.from_focus_id = OLD.focus_id
            AND operation.to_focus_id = NEW.focus_id
        )
        BEGIN
          SELECT RAISE(ABORT, 'Thread Focus changes require a planned move operation');
        END;

        CREATE TRIGGER threads_log_parent_move
        AFTER UPDATE OF focus_id ON threads
        WHEN OLD.focus_id IS NOT NEW.focus_id
        BEGIN
          INSERT INTO thread_parent_transitions (
            thread_id, from_focus_id, to_focus_id, changed_at
          ) VALUES (NEW.id, OLD.focus_id, NEW.focus_id, ${movedChangedAt});
        END;

        CREATE TRIGGER thread_parent_transitions_are_immutable
        BEFORE UPDATE ON thread_parent_transitions
        BEGIN
          SELECT RAISE(ABORT, 'Thread parent transitions are immutable');
        END;

        CREATE TRIGGER thread_parent_transitions_delete_only_with_thread
        BEFORE DELETE ON thread_parent_transitions
        WHEN EXISTS (SELECT 1 FROM threads WHERE id = OLD.thread_id)
        BEGIN
          SELECT RAISE(ABORT, 'Thread parent transitions are immutable');
        END;

        CREATE TRIGGER thread_move_operations_are_immutable
        BEFORE UPDATE ON thread_move_operations
        BEGIN
          SELECT RAISE(ABORT, 'Thread move operations are immutable');
        END;

        CREATE TRIGGER thread_move_operation_requires_finished_move
        BEFORE DELETE ON thread_move_operations
        WHEN EXISTS (
          SELECT 1 FROM threads thread
          WHERE thread.id = OLD.thread_id AND (
            thread.focus_id IS NOT OLD.to_focus_id OR
            EXISTS (
              SELECT 1 FROM thread_scope_applications application
              JOIN scopes scope ON scope.id = application.scope_id
              WHERE application.thread_id = thread.id
                AND scope.focus_id IS NOT OLD.to_focus_id
            ) OR
            EXISTS (
              SELECT 1 FROM updates update_record
              LEFT JOIN commitments commitment
                ON commitment.id = update_record.commitment_id
              JOIN scopes scope ON scope.id = update_record.scope_id
              WHERE (update_record.thread_id = thread.id OR commitment.thread_id = thread.id)
                AND scope.focus_id IS NOT OLD.to_focus_id
            ) OR
            EXISTS (
              SELECT 1 FROM todos todo
              LEFT JOIN commitments commitment ON commitment.id = todo.commitment_id
              JOIN scopes scope ON scope.id = todo.scope_id
              WHERE (todo.thread_id = thread.id OR commitment.thread_id = thread.id)
                AND scope.focus_id IS NOT OLD.to_focus_id
            ) OR
            EXISTS (
              SELECT 1 FROM todo_lists list
              LEFT JOIN commitments commitment ON commitment.id = list.commitment_id
              JOIN scopes scope ON scope.id = list.scope_id
              WHERE (list.thread_id = thread.id OR commitment.thread_id = thread.id)
                AND scope.focus_id IS NOT OLD.to_focus_id
            )
          )
        )
        BEGIN
          SELECT RAISE(ABORT, 'Thread move operation cannot finish with foreign Scope records');
        END;

        DROP TRIGGER todos_parent_is_immutable;
        CREATE TRIGGER todos_parent_is_immutable
        BEFORE UPDATE OF focus_id, thread_id, commitment_id, scope_id, subject_id ON todos
        WHEN (
          OLD.focus_id IS NOT NEW.focus_id OR
          OLD.thread_id IS NOT NEW.thread_id OR
          OLD.commitment_id IS NOT NEW.commitment_id OR
          OLD.scope_id IS NOT NEW.scope_id OR
          OLD.subject_id IS NOT NEW.subject_id
        ) AND NOT (
          OLD.focus_id IS NEW.focus_id AND
          OLD.thread_id IS NEW.thread_id AND
          OLD.commitment_id IS NEW.commitment_id AND
          OLD.subject_id IS NEW.subject_id AND
          OLD.scope_id IS NOT NULL AND NEW.scope_id IS NOT NULL AND
          EXISTS (
            SELECT 1
            FROM thread_move_operations operation
            JOIN scopes old_scope ON old_scope.id = OLD.scope_id
            JOIN scopes new_scope ON new_scope.id = NEW.scope_id
            LEFT JOIN commitments commitment ON commitment.id = NEW.commitment_id
            WHERE operation.thread_id = COALESCE(NEW.thread_id, commitment.thread_id)
              AND old_scope.focus_id = operation.from_focus_id
              AND new_scope.focus_id = operation.to_focus_id
          )
        )
        BEGIN
          SELECT RAISE(ABORT, 'Todo parent context is immutable');
        END;

        DROP TRIGGER todo_list_context_is_immutable;
        CREATE TRIGGER todo_list_context_is_immutable
        BEFORE UPDATE OF focus_id, thread_id, commitment_id, scope_id, subject_id ON todo_lists
        WHEN (
          OLD.focus_id IS NOT NEW.focus_id OR
          OLD.thread_id IS NOT NEW.thread_id OR
          OLD.commitment_id IS NOT NEW.commitment_id OR
          OLD.scope_id IS NOT NEW.scope_id OR
          OLD.subject_id IS NOT NEW.subject_id
        ) AND NOT (
          OLD.focus_id IS NEW.focus_id AND
          OLD.thread_id IS NEW.thread_id AND
          OLD.commitment_id IS NEW.commitment_id AND
          OLD.subject_id IS NEW.subject_id AND
          OLD.scope_id IS NOT NULL AND NEW.scope_id IS NOT NULL AND
          EXISTS (
            SELECT 1
            FROM thread_move_operations operation
            JOIN scopes old_scope ON old_scope.id = OLD.scope_id
            JOIN scopes new_scope ON new_scope.id = NEW.scope_id
            LEFT JOIN commitments commitment ON commitment.id = NEW.commitment_id
            WHERE operation.thread_id = COALESCE(NEW.thread_id, commitment.thread_id)
              AND old_scope.focus_id = operation.from_focus_id
              AND new_scope.focus_id = operation.to_focus_id
          )
        )
        BEGIN
          SELECT RAISE(ABORT, 'Todo list context is immutable');
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
