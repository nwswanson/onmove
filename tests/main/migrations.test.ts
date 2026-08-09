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
    const existing = migrated
      .prepare('SELECT observation, state, scope_id, subject_id FROM updates WHERE id = 3')
      .get()
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
    const focusScope = migrated
      .prepare('SELECT mode, scope_id FROM focus_scope_applications WHERE focus_id = 1')
      .get()
    const commitmentScope = migrated
      .prepare(
        'SELECT mode, scope_id FROM commitment_scope_applications WHERE commitment_id = 2'
      )
      .get()
    const focusScopeHistory = migrated
      .prepare(
        `SELECT from_mode, from_scope_id, to_mode, to_scope_id
         FROM scope_application_transitions WHERE focus_id = 1 ORDER BY id`
      )
      .all()
    const commitmentScopeHistory = migrated
      .prepare(
        `SELECT from_mode, from_scope_id, to_mode, to_scope_id
         FROM scope_application_transitions WHERE commitment_id = 2 ORDER BY id`
      )
      .all()
    migrated.close()

    expect(existing).toMatchObject({
      observation: 'Existing observation',
      state: 'green',
      scope_id: null,
      subject_id: null
    })
    expect(stateOnly).toMatchObject({ observation: '', state: 'red' })
    expect(focusScope).toMatchObject({ mode: 'open', scope_id: null })
    expect(commitmentScope).toMatchObject({ mode: 'open', scope_id: null })
    expect(focusScopeHistory).toEqual([
      { from_mode: null, from_scope_id: null, to_mode: 'open', to_scope_id: null }
    ])
    expect(commitmentScopeHistory).toEqual([
      { from_mode: null, from_scope_id: null, to_mode: 'open', to_scope_id: null }
    ])
    expect(foreignKeyViolations).toEqual([])
  })

  it('backfills Commitment applicability and enforces its derived invariant', () => {
    const database = new AppDatabase(databasePath)
    const focus = database.domain.focuses.create({ title: 'Project Atlas' })
    const thread = database.domain.threads.create({
      focusId: focus.id,
      title: 'Sprint execution',
      reviewFrequencyDays: 7
    })
    const threadCommitment = database.domain.commitments.create({
      parent: { type: 'thread', id: thread.id },
      type: 'ongoing',
      title: 'Improve ticket quality'
    })
    const focusCommitment = database.domain.commitments.create({
      parent: { type: 'focus', id: focus.id },
      type: 'ongoing',
      title: 'Align sponsors'
    })
    const threadScope = database.domain.threadScopes.addSubject(
      thread.id,
      { name: 'Customer Operations' }
    )
    database.close()

    const legacy = new DatabaseSync(databasePath)
    legacy.exec(`
      DROP TRIGGER commitment_scope_application_is_derived_insert;
      DROP TRIGGER commitment_scope_application_is_derived_update;
      DROP TRIGGER commitments_create_scope_application;
      UPDATE commitment_scope_applications
      SET mode = 'explicit', scope_id = ${threadScope.scopeId}
      WHERE commitment_id = ${threadCommitment.id};
      UPDATE commitment_scope_applications
      SET mode = 'inherited', scope_id = NULL
      WHERE commitment_id = ${focusCommitment.id};
      DELETE FROM schema_migrations WHERE version = 12;
    `)
    legacy.close()

    const migrated = new AppDatabase(databasePath)
    expect(migrated.domain.commitments.requireModel(threadCommitment.id).scopeApplication())
      .toMatchObject({
        mode: 'inherited',
        declaredScopeId: null,
        effectiveScopeId: threadScope.scopeId,
        inheritedFrom: { type: 'thread', id: thread.id }
      })
    expect(migrated.domain.commitments.requireModel(focusCommitment.id).scopeApplication())
      .toMatchObject({
        mode: 'open',
        effectiveScopeId: null,
        inheritedFrom: null
      })
    migrated.close()

    const raw = new DatabaseSync(databasePath)
    raw.exec('PRAGMA foreign_keys = ON;')
    expect(() => raw.prepare(
      `UPDATE commitment_scope_applications
       SET mode = 'open', scope_id = NULL WHERE commitment_id = ?`
    ).run(threadCommitment.id)).toThrow(/Commitment Scope is derived/)
    expect(() => raw.prepare(
      `UPDATE commitment_scope_applications
       SET mode = 'inherited', scope_id = NULL WHERE commitment_id = ?`
    ).run(focusCommitment.id)).toThrow(/Commitment Scope is derived/)

    const transition = raw.prepare(
      `SELECT id FROM scope_application_transitions
       WHERE commitment_id = ? ORDER BY id DESC LIMIT 1`
    ).get(threadCommitment.id) as { id: number }
    expect(() => raw.prepare(
      'UPDATE scope_application_transitions SET to_mode = to_mode WHERE id = ?'
    ).run(transition.id)).toThrow(/immutable/)
    expect(() => raw.prepare(
      'DELETE FROM scope_application_transitions WHERE id = ?'
    ).run(transition.id)).toThrow(/immutable/)
    expect(() => raw.prepare(
      'DELETE FROM commitment_scope_applications WHERE commitment_id = ?'
    ).run(threadCommitment.id)).toThrow(/must retain its Scope application/)
    raw.close()
  })

  it('enforces complete scoped Update cells and Scope ownership at the SQLite boundary', () => {
    const database = new AppDatabase(databasePath)
    const firstFocus = database.domain.focuses.create({ title: 'First' })
    const secondFocus = database.domain.focuses.create({ title: 'Second' })
    const subject = database.domain.subjects.create({ name: 'Alex' })
    const firstScope = database.domain.scopes.create({
      focusId: firstFocus.id,
      name: 'First Scope',
      dimension: 'people'
    })
    const secondScope = database.domain.scopes.create({
      focusId: secondFocus.id,
      name: 'Second Scope',
      dimension: 'people'
    })
    const commitment = database.domain.commitments.create({
      parent: { type: 'focus', id: firstFocus.id },
      type: 'ongoing',
      title: 'Hold a conversation'
    })
    database.close()

    const raw = new DatabaseSync(databasePath)
    raw.exec('PRAGMA foreign_keys = ON;')
    expect(() => raw.prepare(
      `INSERT INTO updates (
         focus_id, thread_id, commitment_id, scope_id, subject_id,
         recorded_on, observation, state, sensitive, created_at
       ) VALUES (NULL, NULL, ?, ?, NULL, '2026-08-08', '', 'none', 0, ?)`
    ).run(commitment.id, firstScope.id, '2026-08-08T12:00:00.000Z')).toThrow()
    expect(() => raw.prepare(
      `INSERT INTO updates (
         focus_id, thread_id, commitment_id, scope_id, subject_id,
         recorded_on, observation, state, sensitive, created_at
       ) VALUES (NULL, NULL, ?, ?, ?, '2026-08-08', '', 'none', 0, ?)`
    ).run(
      commitment.id,
      secondScope.id,
      subject.id,
      '2026-08-08T12:00:00.000Z'
    )).toThrow(/scope owned by its parent focus/)
    raw.close()
  })

  it('enforces Todo parent, Scope, and sort-placement integrity at the SQLite boundary', () => {
    const now = new Date('2026-08-09T12:00:00.000Z')
    const database = new AppDatabase(databasePath)
    const firstFocus = database.domain.focuses.create({ title: 'First' })
    const secondFocus = database.domain.focuses.create({ title: 'Second' })
    const thread = database.domain.threads.create({
      focusId: firstFocus.id,
      title: 'Sprint execution',
      reviewFrequencyDays: 7
    }, now)
    const scoped = database.domain.threadScopes.addSubject(
      thread.id,
      { name: 'Customer Operations' },
      now
    )
    const otherSubject = database.domain.subjects.create({ name: 'Other Subject' })
    const otherScope = database.domain.scopes.create({
      focusId: secondFocus.id,
      name: 'Other Scope',
      dimension: 'subject'
    }, now)
    const focusTodo = database.domain.todos.create({
      parent: { type: 'focus', id: firstFocus.id },
      name: 'Focus Todo'
    }, now)
    const scopedTodo = database.domain.todos.create({
      parent: {
        type: 'thread-scope',
        id: thread.id,
        scope: { scopeId: scoped.scopeId as number, subjectId: scoped.subjects[0].id }
      },
      name: 'Scoped Todo'
    }, now)
    database.close()

    const raw = new DatabaseSync(databasePath)
    raw.exec('PRAGMA foreign_keys = ON;')
    expect(() => raw.prepare(
      `INSERT INTO todos (
         focus_id, thread_id, commitment_id, scope_id, subject_id,
         name, due_on, done, created_at, updated_at
       ) VALUES (NULL, ?, NULL, ?, ?, 'Cross Focus', NULL, 0, ?, ?)`
    ).run(
      thread.id,
      otherScope.id,
      otherSubject.id,
      now.toISOString(),
      now.toISOString()
    )).toThrow(/Scope owned by its parent focus/)
    expect(() => raw.prepare(
      `INSERT INTO todos (
         focus_id, thread_id, commitment_id, scope_id, subject_id,
         name, due_on, done, created_at, updated_at
       ) VALUES (?, NULL, NULL, ?, ?, 'Scoped Focus', NULL, 0, ?, ?)`
    ).run(
      firstFocus.id,
      scoped.scopeId,
      scoped.subjects[0].id,
      now.toISOString(),
      now.toISOString()
    )).toThrow()
    expect(() => raw.prepare(
      "UPDATE todos SET due_on = '2026-02-30' WHERE id = ?"
    ).run(focusTodo.id)).toThrow()
    expect(() => raw.prepare(
      'UPDATE todos SET focus_id = ?, thread_id = NULL WHERE id = ?'
    ).run(firstFocus.id, scopedTodo.id)).toThrow(/parent context is immutable/)

    const focusList = raw.prepare(
      'SELECT id FROM todo_lists WHERE focus_id = ?'
    ).get(firstFocus.id) as { id: number }
    expect(() => raw.prepare(
      `INSERT INTO todo_sort_placements (
         todo_id, list_id, sort_key, created_at, updated_at
       ) VALUES (?, ?, 9999, ?, ?)`
    ).run(scopedTodo.id, focusList.id, now.toISOString(), now.toISOString()))
      .toThrow(/must match its parent context/)
    raw.close()
  })
})
