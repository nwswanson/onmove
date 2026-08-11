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

  it('adds nullable, calendar-validated review poke dates to every reviewable aggregate', () => {
    const database = new AppDatabase(databasePath)
    const focus = database.domain.focuses.create({ title: 'Reviewable focus' })
    const thread = database.domain.threads.create({
      focusId: focus.id,
      title: 'Reviewable thread',
      reviewFrequencyDays: 7
    })
    const commitment = database.domain.commitments.create({
      parent: { type: 'thread', id: thread.id },
      type: 'ongoing',
      title: 'Reviewable commitment'
    })
    database.close()

    const migrated = new DatabaseSync(databasePath)
    expect(migrated.prepare('SELECT review_poked_on FROM focuses WHERE id = ?').get(focus.id))
      .toMatchObject({ review_poked_on: null })
    expect(migrated.prepare('SELECT review_poked_on FROM threads WHERE id = ?').get(thread.id))
      .toMatchObject({ review_poked_on: null })
    expect(migrated.prepare('SELECT review_poked_on FROM commitments WHERE id = ?').get(commitment.id))
      .toMatchObject({ review_poked_on: null })

    for (const table of ['focuses', 'threads', 'commitments']) {
      expect(() => migrated.prepare(
        `UPDATE ${table} SET review_poked_on = '2026-02-30' WHERE id = 1`
      ).run()).toThrow()
    }
    migrated.close()
  })

  it('backfills and enforces Todo completion timestamps', () => {
    const database = new AppDatabase(databasePath)
    const focus = database.domain.focuses.create({ title: 'Completion history' })
    const open = database.domain.todos.create({
      parent: { type: 'focus', id: focus.id },
      name: 'Open Todo'
    })
    const done = database.domain.todos.create({
      parent: { type: 'focus', id: focus.id },
      name: 'Done Todo',
      done: true
    })
    database.close()

    const versionSixteen = new DatabaseSync(databasePath)
    versionSixteen.exec(`
      DROP TRIGGER todos_completion_state_insert;
      DROP TRIGGER todos_completion_state_update;
      DROP INDEX todos_overview_index;
      ALTER TABLE todos DROP COLUMN completed_at;
      DELETE FROM schema_migrations WHERE version = 17;
    `)
    versionSixteen.close()

    const upgraded = new AppDatabase(databasePath)
    upgraded.close()

    const migrated = new DatabaseSync(databasePath)
    expect(migrated.prepare(
      'SELECT done, completed_at FROM todos WHERE id = ?'
    ).get(open.id)).toMatchObject({ done: 0, completed_at: null })
    expect(migrated.prepare(
      'SELECT done, completed_at FROM todos WHERE id = ?'
    ).get(done.id)).toMatchObject({ done: 1, completed_at: expect.any(String) })
    expect(() => migrated.prepare(
      'UPDATE todos SET done = 1, completed_at = NULL WHERE id = ?'
    ).run(open.id)).toThrow(/completion timestamp/)
    expect(() => migrated.prepare(
      'UPDATE todos SET done = 0, completed_at = ? WHERE id = ?'
    ).run('2026-08-10T12:00:00.000Z', done.id)).toThrow(/completion timestamp/)
    migrated.close()
  })

  it('upgrades v17 Todos and enforces shared aggregate Subject completion cells', () => {
    const database = new AppDatabase(databasePath)
    const focus = database.domain.focuses.create({ title: 'Shared Todo migration' })
    const subject = database.domain.subjects.create({ name: 'Customer Operations' })
    const ordinary = database.domain.todos.create({
      parent: { type: 'focus', id: focus.id },
      name: 'Ordinary Todo'
    })
    database.close()

    const previous = new DatabaseSync(databasePath)
    previous.exec(`
      DROP TRIGGER todos_shared_parent_insert;
      DROP TRIGGER todos_shared_parent_update;
      DROP TRIGGER todos_shared_mode_is_immutable;
      DROP TRIGGER todo_subject_completion_requires_shared_insert;
      DROP TRIGGER todo_subject_completion_identity_is_immutable;
      DROP TRIGGER todo_sort_placement_matches_context_insert;
      DROP TRIGGER todo_sort_placement_matches_context_update;
      DROP TABLE todo_subject_completions;
      ALTER TABLE todos DROP COLUMN shared_across_subjects;

      CREATE TRIGGER todo_sort_placement_matches_context_insert
      BEFORE INSERT ON todo_sort_placements
      WHEN NOT EXISTS (
        SELECT 1 FROM todos todo JOIN todo_lists list ON list.id = NEW.list_id
        WHERE todo.id = NEW.todo_id
          AND todo.focus_id IS list.focus_id
          AND todo.thread_id IS list.thread_id
          AND todo.commitment_id IS list.commitment_id
          AND (list.scope_id IS NULL OR (
            todo.scope_id IS list.scope_id AND todo.subject_id IS list.subject_id
          ))
      )
      BEGIN
        SELECT RAISE(ABORT, 'Todo sort placement must match its parent context');
      END;

      CREATE TRIGGER todo_sort_placement_matches_context_update
      BEFORE UPDATE OF todo_id, list_id ON todo_sort_placements
      WHEN NOT EXISTS (
        SELECT 1 FROM todos todo JOIN todo_lists list ON list.id = NEW.list_id
        WHERE todo.id = NEW.todo_id
          AND todo.focus_id IS list.focus_id
          AND todo.thread_id IS list.thread_id
          AND todo.commitment_id IS list.commitment_id
          AND (list.scope_id IS NULL OR (
            todo.scope_id IS list.scope_id AND todo.subject_id IS list.subject_id
          ))
      )
      BEGIN
        SELECT RAISE(ABORT, 'Todo sort placement must match its parent context');
      END;

      DELETE FROM schema_migrations WHERE version = 18;
    `)
    previous.close()

    const upgraded = new AppDatabase(databasePath)
    upgraded.close()

    const migrated = new DatabaseSync(databasePath)
    expect(migrated.prepare(
      'SELECT shared_across_subjects FROM todos WHERE id = ?'
    ).get(ordinary.id)).toEqual({ shared_across_subjects: 0 })
    expect(migrated.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'todo_subject_completions'"
    ).get()).toEqual({ name: 'todo_subject_completions' })
    expect(() => migrated.prepare(
      `INSERT INTO todo_subject_completions (
         todo_id, subject_id, done, completed_at, created_at, updated_at
       ) VALUES (?, ?, 0, NULL, ?, ?)`
    ).run(
      ordinary.id,
      subject.id,
      '2026-08-10T12:00:00.000Z',
      '2026-08-10T12:00:00.000Z'
    )).toThrow(/requires a shared Todo/)
    expect(() => migrated.prepare(
      'UPDATE todos SET shared_across_subjects = 1 WHERE id = ?'
    ).run(ordinary.id)).toThrow(/aggregate Thread or Commitment parent|sharing mode/)
    migrated.close()
  })

  it('upgrades v18 with Thread parent history and guarded Focus moves', () => {
    const database = new AppDatabase(databasePath)
    const source = database.domain.focuses.create({ title: 'Source focus' })
    const target = database.domain.focuses.create({ title: 'Target focus' })
    const thread = database.domain.threads.create({
      focusId: source.id,
      title: 'Existing thread',
      reviewFrequencyDays: 7
    })
    database.close()

    const previous = new DatabaseSync(databasePath)
    previous.exec(`
      DROP TRIGGER threads_log_initial_parent;
      DROP TRIGGER threads_focus_move_requires_operation;
      DROP TRIGGER threads_log_parent_move;
      DROP TRIGGER thread_parent_transitions_are_immutable;
      DROP TRIGGER thread_parent_transitions_delete_only_with_thread;
      DROP TRIGGER thread_move_operations_are_immutable;
      DROP TRIGGER thread_move_operation_requires_finished_move;
      DROP TRIGGER todos_parent_is_immutable;
      DROP TRIGGER todo_list_context_is_immutable;
      DROP TABLE thread_parent_transitions;
      DROP TABLE thread_move_operations;

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

      DELETE FROM schema_migrations WHERE version = 19;
    `)
    previous.close()

    const upgraded = new AppDatabase(databasePath)
    expect(upgraded.domain.threads.requireModel(thread.id).parentHistory()).toMatchObject([{
      fromFocusId: null,
      toFocusId: source.id
    }])
    upgraded.close()

    const migrated = new DatabaseSync(databasePath)
    migrated.exec('PRAGMA foreign_keys = ON;')
    expect(() => migrated.prepare(
      'UPDATE threads SET focus_id = ? WHERE id = ?'
    ).run(target.id, thread.id)).toThrow(/planned move operation/)
    expect(() => migrated.prepare(
      'UPDATE thread_parent_transitions SET changed_at = changed_at WHERE thread_id = ?'
    ).run(thread.id)).toThrow(/immutable/)
    expect(migrated.prepare(
      'SELECT count(*) AS count FROM thread_parent_transitions WHERE thread_id = ?'
    ).get(thread.id)).toEqual({ count: 1 })
    migrated.close()
  })

  it('audits Commitment parent moves and keeps derived Scope applications synchronized', () => {
    const database = new AppDatabase(databasePath)
    const focus = database.domain.focuses.create({ title: 'Primary focus' })
    const otherFocus = database.domain.focuses.create({ title: 'Other focus' })
    const source = database.domain.threads.create({
      focusId: focus.id,
      title: 'Source',
      reviewFrequencyDays: 7
    })
    const target = database.domain.threads.create({
      focusId: focus.id,
      title: 'Target',
      reviewFrequencyDays: 7
    })
    const outside = database.domain.threads.create({
      focusId: otherFocus.id,
      title: 'Outside',
      reviewFrequencyDays: 7
    })
    const commitment = database.domain.commitments.create({
      parent: { type: 'thread', id: source.id },
      type: 'ongoing',
      title: 'Move safely'
    })
    database.close()

    const migrated = new DatabaseSync(databasePath)
    migrated.prepare(
      `UPDATE commitments
       SET focus_id = NULL, thread_id = ?, updated_at = ?
       WHERE id = ?`
    ).run(target.id, '2026-08-10T12:00:00.000Z', commitment.id)
    expect(migrated.prepare(
      `SELECT mode, scope_id FROM commitment_scope_applications
       WHERE commitment_id = ?`
    ).get(commitment.id)).toMatchObject({ mode: 'inherited', scope_id: null })
    expect(migrated.prepare(
      `SELECT count(*) AS count FROM commitment_parent_transitions
       WHERE commitment_id = ?`
    ).get(commitment.id)).toMatchObject({ count: 2 })
    expect(() => migrated.prepare(
      `UPDATE commitments
       SET focus_id = NULL, thread_id = ?, updated_at = ?
       WHERE id = ?`
    ).run(outside.id, '2026-08-10T12:01:00.000Z', commitment.id)).toThrow(
      /cannot move outside its Focus/
    )
    expect(() => migrated.prepare(
      'UPDATE commitment_parent_transitions SET changed_at = ? WHERE commitment_id = ?'
    ).run('2026-08-10T13:00:00.000Z', commitment.id)).toThrow(/immutable/)
    migrated.close()
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
