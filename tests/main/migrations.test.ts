import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AppDatabase } from '../../src/main/database'
import { LATEST_SCHEMA_VERSION } from '../../src/main/data/migrations'

describe('database migrations', () => {
  let directory: string
  let databasePath: string

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'onmove-migration-test-'))
    databasePath = join(directory, 'onmove.sqlite3')
  })

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true })
  })

  it('upgrades the original hello-world database without losing data', () => {
    const legacy = new DatabaseSync(databasePath)
    legacy.exec(`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE app_events (
        id INTEGER PRIMARY KEY,
        kind TEXT NOT NULL CHECK (kind IN ('launch', 'greeting')),
        created_at TEXT NOT NULL
      ) STRICT;
      INSERT INTO schema_migrations VALUES (1, '2026-01-01T00:00:00.000Z');
      INSERT INTO app_events (kind, created_at) VALUES ('greeting', '2026-01-02T00:00:00.000Z');
    `)
    legacy.close()

    const database = new AppDatabase(databasePath)
    expect(database.getState().greetingCount).toBe(1)
    expect(database.domain.items.create({ status: 'ready' }).materialize().status.current).toBe(
      'ready'
    )
    database.close()

    const migrated = new DatabaseSync(databasePath)
    const versions = migrated
      .prepare('SELECT version FROM schema_migrations ORDER BY version')
      .all() as Array<{ version: number }>
    migrated.close()
    expect(versions.map(({ version }) => Number(version))).toEqual(
      Array.from({ length: LATEST_SCHEMA_VERSION }, (_, index) => index + 1)
    )
  })

  it('refuses to open a database written by a newer application schema', () => {
    const future = new DatabaseSync(databasePath)
    future.exec(`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      ) STRICT;
      INSERT INTO schema_migrations VALUES (999, '2026-01-01T00:00:00.000Z');
    `)
    future.close()

    expect(() => new AppDatabase(databasePath)).toThrow(/newer than supported/)
  })

  it('adds an empty goal to focuses created before the goal migration', () => {
    const legacy = new DatabaseSync(databasePath)
    legacy.exec(`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      ) STRICT;
      INSERT INTO schema_migrations VALUES
        (1, '2026-01-01T00:00:00.000Z'),
        (2, '2026-01-01T00:00:00.000Z'),
        (3, '2026-01-01T00:00:00.000Z'),
        (4, '2026-01-01T00:00:00.000Z'),
        (5, '2026-01-01T00:00:00.000Z');
      CREATE TABLE focuses (
        id INTEGER PRIMARY KEY,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        status TEXT NOT NULL,
        status_changed_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE threads (
        id INTEGER PRIMARY KEY
      ) STRICT;
      INSERT INTO focuses (
        kind, title, description, status, status_changed_at, created_at, updated_at
      ) VALUES (
        'generic', 'Existing focus', NULL, 'active', NULL,
        '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
      );
      INSERT INTO threads (id) VALUES (1);
    `)
    legacy.close()

    const database = new AppDatabase(databasePath)
    database.close()

    const migrated = new DatabaseSync(databasePath)
    expect(migrated.prepare('SELECT title, goal, needs_review FROM focuses').get()).toMatchObject({
      title: 'Existing focus',
      goal: '',
      needs_review: 1
    })
    expect(migrated.prepare('SELECT needs_review FROM threads').get()).toMatchObject({
      needs_review: 1
    })
    expect(migrated.prepare('SELECT sensitive FROM focuses').get()).toMatchObject({
      sensitive: 0
    })
    expect(migrated.prepare('SELECT sensitive FROM threads').get()).toMatchObject({
      sensitive: 0
    })
    migrated.close()
  })

  it('preserves existing updates while allowing state-only updates', () => {
    const legacy = new DatabaseSync(databasePath)
    legacy.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      ) STRICT;
      INSERT INTO schema_migrations VALUES
        (1, '2026-01-01T00:00:00.000Z'),
        (2, '2026-01-01T00:00:00.000Z'),
        (3, '2026-01-01T00:00:00.000Z'),
        (4, '2026-01-01T00:00:00.000Z'),
        (5, '2026-01-01T00:00:00.000Z'),
        (6, '2026-01-01T00:00:00.000Z');
      CREATE TABLE focuses (
        id INTEGER PRIMARY KEY,
        title TEXT NOT NULL
      ) STRICT;
      CREATE TABLE threads (
        id INTEGER PRIMARY KEY,
        focus_id INTEGER NOT NULL REFERENCES focuses(id) ON DELETE CASCADE
      ) STRICT;
      CREATE TABLE commitments (
        id INTEGER PRIMARY KEY,
        focus_id INTEGER REFERENCES focuses(id) ON DELETE CASCADE,
        thread_id INTEGER REFERENCES threads(id) ON DELETE CASCADE
      ) STRICT;
      CREATE TABLE updates (
        id INTEGER PRIMARY KEY,
        focus_id INTEGER REFERENCES focuses(id) ON DELETE CASCADE,
        thread_id INTEGER REFERENCES threads(id) ON DELETE CASCADE,
        commitment_id INTEGER REFERENCES commitments(id) ON DELETE CASCADE,
        recorded_on TEXT NOT NULL,
        observation TEXT NOT NULL CHECK (length(trim(observation)) > 0),
        state TEXT NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX updates_focus_date_index
        ON updates(focus_id, recorded_on DESC, id DESC);
      CREATE INDEX updates_thread_date_index
        ON updates(thread_id, recorded_on DESC, id DESC);
      CREATE INDEX updates_commitment_date_index
        ON updates(commitment_id, recorded_on DESC, id DESC);
      INSERT INTO focuses (id, title) VALUES (1, 'Existing focus');
      INSERT INTO commitments (id, focus_id, thread_id) VALUES (2, 1, NULL);
      INSERT INTO updates (
        id, focus_id, thread_id, commitment_id, recorded_on, observation, state, created_at
      ) VALUES (
        3, NULL, NULL, 2, '2026-08-06', 'Existing observation', 'green',
        '2026-08-06T12:00:00.000Z'
      );
    `)
    legacy.close()

    const database = new AppDatabase(databasePath)
    database.close()

    const migrated = new DatabaseSync(databasePath)
    const existing = migrated.prepare('SELECT observation, state FROM updates WHERE id = 3').get()
    migrated
      .prepare(
        `INSERT INTO updates (
           focus_id, thread_id, commitment_id, recorded_on, observation, state, created_at
         ) VALUES (NULL, NULL, 2, '2026-08-07', '', 'red', '2026-08-07T12:00:00.000Z')`
      )
      .run()
    const stateOnly = migrated
      .prepare("SELECT observation, state FROM updates WHERE state = 'red'")
      .get()
    const foreignKeyViolations = migrated.prepare('PRAGMA foreign_key_check').all()
    migrated.close()

    expect(existing).toMatchObject({ observation: 'Existing observation', state: 'green' })
    expect(stateOnly).toMatchObject({ observation: '', state: 'red' })
    expect(foreignKeyViolations).toEqual([])
  })
})
