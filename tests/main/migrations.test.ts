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

  it('migrates the legacy MCP write switch into bounded per-resource defaults', () => {
    const current = new AppDatabase(databasePath)
    current.close()

    const legacy = new DatabaseSync(databasePath)
    legacy.exec(`
      DROP TABLE mcp_thread_permission_overrides;
      DROP TABLE mcp_focus_permission_overrides;
      DROP TABLE mcp_permission_defaults;
      DELETE FROM schema_migrations WHERE version = 38;
      UPDATE mcp_settings SET allow_mutations = 1;
    `)
    legacy.close()

    const migrated = new AppDatabase(databasePath)
    const policy = migrated.mcpSettings.get().permissionPolicy
    expect(Object.keys(policy.defaults)).toHaveLength(8)
    expect(Object.values(policy.defaults)).toEqual(
      expect.arrayContaining([expect.objectContaining({ view: true, edit: true })])
    )
    expect(Object.values(policy.defaults).every(({ view, edit }) => view && edit)).toBe(true)
    expect(policy.overrides).toEqual([])
    migrated.close()
  })

  it('backfills indexed creation timestamps for existing search documents', () => {
    const current = new AppDatabase(databasePath)
    const focus = current.domain.focuses.create({ title: 'Indexed before timestamp migration' })
    expect(current.queries.search(
      { text: 'indexed before timestamp migration' },
      current.mcpSettings.accessPolicy()
    )).toEqual([expect.objectContaining({ reference: { type: 'focus', id: focus.id } })])
    current.close()

    const legacy = new DatabaseSync(databasePath)
    legacy.exec(`
      DROP INDEX search_documents_dates_index;
      ALTER TABLE search_documents DROP COLUMN created_at;
      DELETE FROM schema_migrations WHERE version = 39;
    `)
    const before = legacy.prepare(
      'SELECT source_key, updated_at FROM search_documents WHERE entity_type = ?'
    ).get('focus') as { source_key: string; updated_at: string }
    legacy.close()

    const migrated = new AppDatabase(databasePath)
    migrated.close()

    const raw = new DatabaseSync(databasePath)
    expect(raw.prepare(
      'SELECT source_key, created_at, updated_at FROM search_documents WHERE entity_type = ?'
    ).get('focus')).toEqual({ ...before, created_at: before.updated_at })
    expect(raw.prepare(
      'SELECT dirty FROM search_index_state WHERE singleton = 1'
    ).get()).toEqual({ dirty: 1 })
    expect(raw.prepare(
      'SELECT version FROM schema_migrations WHERE version = 39'
    ).get()).toEqual({ version: 39 })
    raw.close()
  })

  it('adds a durable search generation and marks the projection for rebuilding', () => {
    const current = new AppDatabase(databasePath)
    current.queries.search({ text: null }, current.mcpSettings.accessPolicy())
    current.close()

    const legacy = new DatabaseSync(databasePath)
    legacy.exec(`
      ALTER TABLE search_index_state DROP COLUMN generation;
      DELETE FROM schema_migrations WHERE version = 40;
    `)
    legacy.close()

    const migrated = new AppDatabase(databasePath)
    migrated.close()

    const raw = new DatabaseSync(databasePath)
    expect(raw.prepare(
      'SELECT dirty, generation FROM search_index_state WHERE singleton = 1'
    ).get()).toEqual({ dirty: 1, generation: 0 })
    expect(raw.prepare(
      'SELECT version FROM schema_migrations WHERE version = 40'
    ).get()).toEqual({ version: 40 })
    raw.close()
  })

  it('adds cascading shell-owned Focus and Thread navigation references', () => {
    const database = new AppDatabase(databasePath)
    const focus = database.domain.focuses.create({ title: 'Pinned migration Focus' })
    const thread = database.domain.threads.create({
      focusId: focus.id,
      title: 'Pinned migration Thread',
      reviewFrequencyDays: 7
    })
    database.navigationPins.set({ type: 'focus', id: focus.id }, true)
    database.navigationPins.set({ type: 'thread', id: thread.id }, true)
    database.close()

    const raw = new DatabaseSync(databasePath)
    expect(raw.prepare(
      'SELECT focus_id, thread_id FROM sidebar_navigation_pins ORDER BY id'
    ).all()).toEqual([
      { focus_id: focus.id, thread_id: null },
      { focus_id: null, thread_id: thread.id }
    ])
    expect(raw.prepare(
      'SELECT version FROM schema_migrations WHERE version = 41'
    ).get()).toEqual({ version: 41 })
    raw.close()
  })

  it('thins legacy per-edit rich-text history to the newest 30 recovery documents', () => {
    const current = new AppDatabase(databasePath)
    const focus = current.domain.focuses.create({ title: 'Legacy writing' })
    const [note] = focus.toSnapshot().notes
    current.close()

    const legacy = new DatabaseSync(databasePath)
    legacy.exec(`
      DROP TRIGGER notes_version_content;
      DROP TRIGGER focuses_delete_rich_text_history;
      DROP TRIGGER updates_delete_rich_text_history;
      DROP TRIGGER notes_delete_rich_text_history;
      DROP INDEX rich_text_history_changed_index;
      DROP TABLE rich_text_history_state;
      DROP TABLE rich_text_history;

      CREATE TABLE rich_text_history (
        document_type TEXT NOT NULL,
        entity_id INTEGER NOT NULL,
        revision INTEGER NOT NULL CHECK (revision > 0),
        value TEXT NOT NULL,
        changed_at TEXT NOT NULL,
        PRIMARY KEY (document_type, entity_id, revision)
      ) STRICT, WITHOUT ROWID;
      CREATE INDEX rich_text_history_changed_index
        ON rich_text_history(changed_at, document_type, entity_id);
      DELETE FROM schema_migrations WHERE version IN (36, 37);
    `)
    const insert = legacy.prepare(
      `INSERT INTO rich_text_history (
         document_type, entity_id, revision, value, changed_at
       ) VALUES ('note-content', ?, ?, ?, ?)`
    )
    for (let revision = 1; revision <= 35; revision += 1) {
      insert.run(
        note.id,
        revision,
        `Legacy revision ${revision}`,
        `2026-08-18T12:00:${String(revision).padStart(2, '0')}.000Z`
      )
    }
    legacy.prepare(
      'UPDATE notes SET content = ?, content_revision = ? WHERE id = ?'
    ).run('Legacy revision 35', 35, note.id)
    legacy.close()

    const migrated = new AppDatabase(databasePath)
    const reference = { type: 'note', id: note.id, field: 'content' } as const
    const history = migrated.domain.richTextDocuments.history(reference)
    expect(history).toHaveLength(30)
    expect(history.at(0)).toMatchObject({ revision: 35, reason: 'legacy' })
    expect(history.at(-1)).toMatchObject({ revision: 6, reason: 'legacy' })

    migrated.domain.richTextDocuments.save(reference, 'Legacy revision 35!')
    expect(migrated.domain.richTextDocuments.get(reference).revision).toBe(36)
    expect(migrated.domain.richTextDocuments.history(reference)).toHaveLength(30)
    migrated.close()
  })

  it('upgrades the previous schema with a bounded archive without touching live Updates', () => {
    const current = new AppDatabase(databasePath)
    const focus = current.domain.focuses.create({ title: 'Existing focus' })
    const thread = current.domain.threads.create({
      focusId: focus.id,
      title: 'Existing thread',
      reviewFrequencyDays: 7
    })
    const update = current.domain.updates.create({
      parent: { type: 'thread', id: thread.id },
      date: '2026-08-11',
      observation: 'Existing evidence',
      state: 'yellow'
    })
    current.close()

    const previous = new DatabaseSync(databasePath)
    previous.exec(`
      DROP TRIGGER archived_updates_enforce_retention;
      DROP TRIGGER archived_updates_are_immutable;
      DROP TRIGGER updates_archive_before_delete;
      DROP TRIGGER focuses_prepare_update_archive_context;
      DROP TRIGGER threads_prepare_update_archive_context;
      DROP TRIGGER commitments_prepare_update_archive_context;
      DROP TRIGGER scopes_prepare_update_archive_context;
      DROP TRIGGER subjects_prepare_update_archive_context;
      DROP TABLE update_archive_context;
      DROP TABLE archived_updates;
      DELETE FROM schema_migrations WHERE version IN (23, 24);
    `)
    previous.close()

    const migrated = new AppDatabase(databasePath)
    expect(migrated.domain.updates.find(update.id)).toMatchObject({
      observation: 'Existing evidence',
      state: 'yellow'
    })
    expect(migrated.domain.archivedUpdates.list()).toEqual([])
    expect(migrated.domain.updates.delete(update.id)).toBe(true)
    expect(migrated.domain.archivedUpdates.listForOriginalUpdate(update.id)).toMatchObject([{
      context: { focusTitle: 'Existing focus' },
      effectiveSensitive: false
    }])
    migrated.close()
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
      type: 'tracking',
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

  it('backfills Commitment review schedules from legacy update cadence', () => {
    const current = new AppDatabase(databasePath)
    const focus = current.domain.focuses.create({ title: 'Legacy schedule' })
    const thread = current.domain.threads.create({
      focusId: focus.id,
      title: 'Legacy thread',
      reviewFrequencyDays: 7
    })
    const commitment = current.domain.commitments.create({
      parent: { type: 'thread', id: thread.id },
      type: 'tracking',
      title: 'Carry the existing cadence forward',
      cadenceDays: 14
    })
    current.close()

    const previous = new DatabaseSync(databasePath)
    previous.exec(`
      ALTER TABLE commitments DROP COLUMN review_frequency_days;
      ALTER TABLE commitments DROP COLUMN needs_review;
      DELETE FROM schema_migrations WHERE version = 25;
    `)
    previous.close()

    const migrated = new AppDatabase(databasePath)
    expect(migrated.domain.commitments.find(commitment.id)).toMatchObject({
      cadenceDays: 14,
      reviewFrequencyDays: 14,
      needsReview: true
    })
    migrated.close()
  })

  it('promotes tracking to the generic Commitment type without losing legacy due semantics', () => {
    const current = new AppDatabase(databasePath)
    const focus = current.domain.focuses.create({ title: 'Typed commitments' })
    const thread = current.domain.threads.create({
      focusId: focus.id,
      title: 'Typed thread',
      reviewFrequencyDays: 7
    })
    const dueDated = current.domain.commitments.create({
      parent: { type: 'thread', id: thread.id },
      type: 'tracking',
      title: 'Ship the launch',
      dueDate: '2026-09-15'
    })
    const undated = current.domain.commitments.create({
      parent: { type: 'thread', id: thread.id },
      type: 'tracking',
      title: 'Maintain launch health'
    })
    current.close()

    const previous = new DatabaseSync(databasePath)
    previous.exec(`
      DROP TRIGGER routine_runs_delete_only_with_routine;
      DROP TABLE routine_review_cell_issues;
      DROP TABLE routine_review_cell_attestations;
      DROP TABLE routine_review_cells;
      ALTER TABLE routine_definitions DROP COLUMN needs_attestation;
      DELETE FROM schema_migrations WHERE version IN (28, 29, 30, 32);
      DROP TABLE routine_run_issues;
      DROP TABLE routine_review_run_items;
      DROP TABLE routine_review_runs;
      DROP TABLE routine_template_items;
      DROP TABLE routine_template_versions;
      DROP TABLE routine_definitions;
      ALTER TABLE commitments DROP COLUMN behavior_type;
      DELETE FROM schema_migrations WHERE version = 27;
      ALTER TABLE commitments DROP COLUMN commitment_type;
      ALTER TABLE commitments RENAME COLUMN legacy_due_type TO commitment_type;
      DELETE FROM schema_migrations WHERE version = 26;
    `)
    previous.close()

    const migrated = new AppDatabase(databasePath)
    expect(migrated.domain.commitments.find(dueDated.id)).toMatchObject({
      type: 'tracking',
      dueDate: '2026-09-15'
    })
    expect(migrated.domain.commitments.find(undated.id)).toMatchObject({
      type: 'tracking',
      dueDate: null
    })
    migrated.close()

    const raw = new DatabaseSync(databasePath)
    expect(raw.prepare(
      `SELECT commitment_type, behavior_type, legacy_due_type FROM commitments
       WHERE id = ?`
    ).get(dueDated.id)).toMatchObject({
      commitment_type: 'tracking',
      behavior_type: 'tracking',
      legacy_due_type: 'action'
    })
    expect(raw.prepare(
      `SELECT commitment_type, behavior_type, legacy_due_type FROM commitments
       WHERE id = ?`
    ).get(undated.id)).toMatchObject({
      commitment_type: 'tracking',
      behavior_type: 'tracking',
      legacy_due_type: 'ongoing'
    })
    expect(() => raw.prepare(
      "UPDATE commitments SET commitment_type = 'unknown' WHERE id = ?"
    ).run(dueDated.id)).toThrow()
    raw.close()
  })

  it('freezes Routine item notes and resolutions after explicit finalization', () => {
    const database = new AppDatabase(databasePath)
    const focus = database.domain.focuses.create({ title: 'Routine notes' })
    const thread = database.domain.threads.create({
      focusId: focus.id,
      title: 'Routine thread',
      reviewFrequencyDays: 7
    })
    const routine = database.domain.routines.create({
      parent: { type: 'thread', id: thread.id },
      name: 'Evidence review',
      scheduleWeekdays: ['thursday'],
      checklist: [{ inspection: 'Verify evidence.' }]
    }, new Date('2026-08-13T10:00:00.000Z'))
    const item = routine.snapshot('2026-08-13').currentRun!.items[0]
    database.domain.routines.attestCellItem(item.id, {
      resolution: 'attested'
    }, new Date('2026-08-13T11:00:00.000Z'))
    database.domain.routines.finalizeCell(
      routine.snapshot('2026-08-13').currentRun!.cells[0].id,
      new Date('2026-08-13T11:05:00.000Z')
    )
    database.close()

    const raw = new DatabaseSync(databasePath)
    expect(raw.prepare(
      'SELECT note FROM routine_review_cell_attestations WHERE id = ?'
    ).get(item.id)).toMatchObject({ note: '' })
    expect(() => raw.prepare(
      'UPDATE routine_review_cell_attestations SET note = ? WHERE id = ?'
    ).run('Immutable evidence', item.id)).toThrow(/Finalized.*immutable/)
    expect(() => raw.prepare(
      "UPDATE routine_review_cell_attestations SET resolution = 'pending', attested_at = NULL WHERE id = ?"
    ).run(item.id)).toThrow(/Finalized.*immutable/)
    raw.close()
  })

  it('rejects replacing a Routine Run after attestation evidence begins', () => {
    const database = new AppDatabase(databasePath)
    const focus = database.domain.focuses.create({ title: 'Protected Routine evidence' })
    const thread = database.domain.threads.create({
      focusId: focus.id,
      title: 'Protected Routine thread',
      reviewFrequencyDays: 7
    })
    const routine = database.domain.routines.create({
      parent: { type: 'thread', id: thread.id },
      name: 'Protected inspection',
      scheduleWeekdays: ['thursday'],
      checklist: [{ inspection: 'Verify protected evidence.' }]
    }, new Date('2026-08-13T10:00:00.000Z'))
    const run = routine.snapshot('2026-08-13').currentRun!
    database.domain.routines.attestCellItem(run.items[0].id, {
      resolution: 'pending',
      note: 'This draft is durable evidence.'
    }, new Date('2026-08-13T11:00:00.000Z'))
    database.close()

    const raw = new DatabaseSync(databasePath)
    expect(() => raw.prepare(
      'DELETE FROM routine_review_runs WHERE id = ?'
    ).run(run.id)).toThrow(/immutable after attestation begins/)
    raw.close()
  })

  it('migrates legacy Routine anchors to constrained weekday schedules', () => {
    const database = new AppDatabase(databasePath)
    const focus = database.domain.focuses.create({ title: 'Legacy Routine schedule' })
    const thread = database.domain.threads.create({
      focusId: focus.id,
      title: 'Legacy Routine thread',
      reviewFrequencyDays: 7
    })
    const routine = database.domain.routines.create({
      parent: { type: 'thread', id: thread.id },
      name: 'Weekend inspection',
      scheduleWeekdays: ['friday'],
      checklist: [{ inspection: 'Verify evidence.' }]
    }, new Date('2026-08-14T10:00:00.000Z'))
    database.close()

    const legacy = new DatabaseSync(databasePath)
    legacy.exec(`
      DELETE FROM schema_migrations WHERE version = 31;
      DROP TABLE routine_schedule_weekdays;
      UPDATE routine_definitions SET anchor_on = '2026-08-16';
    `)
    legacy.close()

    const migrated = new AppDatabase(databasePath)
    expect(migrated.domain.routines.materialize(routine.id, '2026-08-17')).toMatchObject({
      scheduleWeekdays: ['monday'],
      attestationRequested: true,
      needsAttestation: true
    })
    migrated.close()
  })

  it('stores calendar-validated scoped review pokes with aggregate cascades', () => {
    const now = new Date('2026-08-10T12:00:00.000Z')
    const database = new AppDatabase(databasePath)
    const focus = database.domain.focuses.create({ title: 'Scoped reviews' })
    const thread = database.domain.threads.create({
      focusId: focus.id,
      title: 'Regional health',
      reviewFrequencyDays: 7
    }, now)
    const scope = database.domain.threadScopes.addSubject(thread.id, { name: 'North' }, now)
    const subject = scope.subjects[0]
    const commitment = database.domain.commitments.create({
      parent: { type: 'thread', id: thread.id },
      type: 'tracking',
      title: 'Keep rollout current',
      cadenceDays: 7
    }, now)
    const cell = { scopeId: scope.scopeId!, subjectId: subject.id }
    thread.pokeReview(now, cell)
    commitment.pokeReview(now, cell)
    database.close()

    const migrated = new DatabaseSync(databasePath)
    expect(migrated.prepare(
      `SELECT reviewed_on FROM thread_review_cell_pokes
       WHERE thread_id = ? AND scope_id = ? AND subject_id = ?`
    ).get(thread.id, cell.scopeId, cell.subjectId)).toMatchObject({ reviewed_on: '2026-08-10' })
    expect(migrated.prepare(
      `SELECT reviewed_on FROM commitment_review_cell_pokes
       WHERE commitment_id = ? AND scope_id = ? AND subject_id = ?`
    ).get(commitment.id, cell.scopeId, cell.subjectId))
      .toMatchObject({ reviewed_on: '2026-08-10' })
    expect(() => migrated.prepare(
      `UPDATE thread_review_cell_pokes SET reviewed_on = '2026-02-30'
       WHERE thread_id = ?`
    ).run(thread.id)).toThrow()
    migrated.prepare('DELETE FROM threads WHERE id = ?').run(thread.id)
    expect(migrated.prepare('SELECT count(*) AS count FROM thread_review_cell_pokes').get())
      .toMatchObject({ count: 0 })
    expect(migrated.prepare('SELECT count(*) AS count FROM commitment_review_cell_pokes').get())
      .toMatchObject({ count: 0 })
    migrated.close()
  })

  it('adds a constrained singleton for the last main window size', () => {
    const database = new AppDatabase(databasePath)
    database.windowPreferences.setSize(
      { width: 1180, height: 720 },
      new Date('2026-08-11T10:00:00.000Z')
    )
    database.close()

    const migrated = new DatabaseSync(databasePath)
    expect(migrated.prepare(
      'SELECT singleton, width, height, updated_at FROM app_window_preferences'
    ).get()).toEqual({
      singleton: 1,
      width: 1180,
      height: 720,
      updated_at: '2026-08-11T10:00:00.000Z'
    })
    expect(() => migrated.prepare(`
      INSERT INTO app_window_preferences (singleton, width, height, updated_at)
      VALUES (2, 1200, 800, '2026-08-11T10:00:01.000Z')
    `).run()).toThrow()
    expect(() => migrated.prepare(`
      UPDATE app_window_preferences SET width = 0 WHERE singleton = 1
    `).run()).toThrow()
    migrated.close()
  })

  it('adds nullable calendar-validated due dates to Focuses and Threads', () => {
    const database = new AppDatabase(databasePath)
    const focus = database.domain.focuses.create({
      title: 'Dated focus',
      dueDate: '2026-09-15'
    })
    const thread = database.domain.threads.create({
      focusId: focus.id,
      title: 'Dated thread',
      reviewFrequencyDays: 7,
      dueDate: '2026-09-10'
    })
    database.close()

    const migrated = new DatabaseSync(databasePath)
    expect(migrated.prepare('SELECT due_on FROM focuses WHERE id = ?').get(focus.id))
      .toMatchObject({ due_on: '2026-09-15' })
    expect(migrated.prepare('SELECT due_on FROM threads WHERE id = ?').get(thread.id))
      .toMatchObject({ due_on: '2026-09-10' })
    expect(() => migrated.prepare(
      "UPDATE focuses SET due_on = '2026-02-30' WHERE id = ?"
    ).run(focus.id)).toThrow()
    expect(() => migrated.prepare(
      "UPDATE threads SET due_on = '2026-02-30' WHERE id = ?"
    ).run(thread.id)).toThrow()
    migrated.close()
  })

  it('backfills and enforces Todo completion timestamps', () => {
    const database = new AppDatabase(databasePath)
    const focus = database.domain.focuses.create({ title: 'Completion history' })
    const thread = database.domain.threads.create({
      focusId: focus.id,
      title: 'Completion thread',
      reviewFrequencyDays: 7
    })
    const open = database.domain.todos.create({
      parent: { type: 'thread', id: thread.id },
      name: 'Open Todo'
    })
    const done = database.domain.todos.create({
      parent: { type: 'thread', id: thread.id },
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
    const thread = database.domain.threads.create({
      focusId: focus.id,
      title: 'Shared Todo thread',
      reviewFrequencyDays: 7
    })
    const subject = database.domain.subjects.create({ name: 'Customer Operations' })
    const ordinary = database.domain.todos.create({
      parent: { type: 'thread', id: thread.id },
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
      type: 'tracking',
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
      INSERT INTO threads (id, focus_id) VALUES (1, 1);
      INSERT INTO commitments (id, focus_id, thread_id) VALUES (2, NULL, 1);
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
    expect(commitmentScope).toMatchObject({ mode: 'inherited', scope_id: null })
    expect(focusScopeHistory).toEqual([
      { from_mode: null, from_scope_id: null, to_mode: 'open', to_scope_id: null }
    ])
    expect(commitmentScopeHistory).toEqual([
      { from_mode: null, from_scope_id: null, to_mode: 'open', to_scope_id: null },
      { from_mode: 'open', from_scope_id: null, to_mode: 'inherited', to_scope_id: null }
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
    const openThread = database.domain.threads.create({
      focusId: focus.id,
      title: 'Sponsor alignment',
      reviewFrequencyDays: 7
    })
    const threadCommitment = database.domain.commitments.create({
      parent: { type: 'thread', id: thread.id },
      type: 'tracking',
      title: 'Improve ticket quality'
    })
    const openCommitment = database.domain.commitments.create({
      parent: { type: 'thread', id: openThread.id },
      type: 'tracking',
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
      WHERE commitment_id = ${openCommitment.id};
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
    expect(migrated.domain.commitments.requireModel(openCommitment.id).scopeApplication())
      .toMatchObject({
        mode: 'inherited',
        effectiveScopeId: null,
        inheritedFrom: { type: 'thread', id: openThread.id }
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
       SET mode = 'open', scope_id = NULL WHERE commitment_id = ?`
    ).run(openCommitment.id)).toThrow(/Commitment Scope is derived/)

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
    const thread = database.domain.threads.create({
      focusId: firstFocus.id,
      title: 'Scoped work',
      reviewFrequencyDays: 7
    })
    const commitment = database.domain.commitments.create({
      parent: { type: 'thread', id: thread.id },
      type: 'tracking',
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
    const otherThread = database.domain.threads.create({
      focusId: firstFocus.id,
      title: 'Other work',
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
    const threadTodo = database.domain.todos.create({
      parent: { type: 'thread', id: otherThread.id },
      name: 'Thread Todo'
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
    ).run(threadTodo.id)).toThrow()
    expect(() => raw.prepare(
      'UPDATE todos SET thread_id = ? WHERE id = ?'
    ).run(otherThread.id, scopedTodo.id)).toThrow(/parent context is immutable/)

    const otherThreadList = raw.prepare(
      'SELECT id FROM todo_lists WHERE thread_id = ? AND scope_id IS NULL'
    ).get(otherThread.id) as { id: number }
    expect(() => raw.prepare(
      `INSERT INTO todo_sort_placements (
         todo_id, list_id, sort_key, created_at, updated_at
       ) VALUES (?, ?, 9999, ?, ?)`
    ).run(scopedTodo.id, otherThreadList.id, now.toISOString(), now.toISOString()))
      .toThrow(/must match its parent context/)
    raw.close()
  })

  it('retires Focus-owned work while rescuing every affected Update into the archive', () => {
    const database = new AppDatabase(databasePath)
    const focus = database.domain.focuses.create({ title: 'Legacy overview' })
    const thread = database.domain.threads.create({
      focusId: focus.id,
      title: 'Surviving thread',
      reviewFrequencyDays: 7
    })
    const directFocusUpdate = database.domain.updates.create({
      parent: { type: 'thread', id: thread.id },
      date: '2026-08-10',
      observation: 'Legacy direct Focus evidence',
      state: 'yellow'
    })
    const focusCommitment = database.domain.commitments.create({
      parent: { type: 'thread', id: thread.id },
      type: 'tracking',
      title: 'Legacy Focus commitment'
    })
    const commitmentUpdate = database.domain.updates.create({
      parent: { type: 'commitment', id: focusCommitment.id },
      date: '2026-08-11',
      observation: 'Legacy Commitment evidence',
      state: 'red'
    })
    const focusRoutine = database.domain.routines.create({
      parent: { type: 'thread', id: thread.id },
      name: 'Legacy Focus routine',
      scheduleWeekdays: ['friday'],
      checklist: [{ inspection: 'Verify the migration.' }]
    })
    const survivingUpdate = database.domain.updates.create({
      parent: { type: 'thread', id: thread.id },
      date: '2026-08-12',
      observation: 'Keep this Thread evidence',
      state: 'green'
    })
    database.close()

    const legacy = new DatabaseSync(databasePath)
    legacy.exec('PRAGMA foreign_keys = ON;')
    legacy.exec(`
      DROP TRIGGER commitments_require_thread_parent_insert;
      DROP TRIGGER commitments_require_thread_parent_update;
      DROP TRIGGER updates_disallow_focus_parent_insert;
      DROP TRIGGER updates_disallow_focus_parent_update;
      DROP TRIGGER todos_disallow_focus_parent_insert;
      DROP TRIGGER todos_disallow_focus_parent_update;
      DROP TRIGGER todo_lists_disallow_focus_parent_insert;
      DROP TRIGGER todo_lists_disallow_focus_parent_update;
      DROP TRIGGER focuses_goal_is_retired;
      DROP TRIGGER focuses_goal_is_retired_insert;
      DELETE FROM schema_migrations WHERE version = 33;
    `)
    legacy.prepare(
      'UPDATE updates SET focus_id = ?, thread_id = NULL WHERE id = ?'
    ).run(focus.id, directFocusUpdate.id)
    legacy.prepare(
      'UPDATE commitments SET focus_id = ?, thread_id = NULL WHERE id IN (?, ?)'
    ).run(focus.id, focusCommitment.id, focusRoutine.id)
    legacy.prepare(`
      INSERT INTO todos (
        focus_id, thread_id, commitment_id, scope_id, subject_id,
        name, due_on, done, created_at, updated_at
      ) VALUES (?, NULL, NULL, NULL, NULL, ?, NULL, 0, ?, ?)
    `).run(
      focus.id,
      'Legacy Focus Todo',
      '2026-08-12T12:00:00.000Z',
      '2026-08-12T12:00:00.000Z'
    )
    legacy.prepare('UPDATE focuses SET goal = ? WHERE id = ?')
      .run('Legacy goal', focus.id)
    legacy.close()

    const migrated = new AppDatabase(databasePath)
    expect(migrated.dataArchive.export('test').tables.focuses).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: focus.id, goal: '' })
    ]))
    expect(migrated.domain.updates.find(directFocusUpdate.id)).toBeNull()
    expect(migrated.domain.updates.find(commitmentUpdate.id)).toBeNull()
    expect(migrated.domain.archivedUpdates.listForOriginalUpdate(directFocusUpdate.id))
      .toMatchObject([{
        observation: 'Legacy direct Focus evidence',
        context: { focusTitle: 'Legacy overview' }
      }])
    expect(migrated.domain.archivedUpdates.listForOriginalUpdate(commitmentUpdate.id))
      .toMatchObject([{
        observation: 'Legacy Commitment evidence',
        context: { commitmentTitle: 'Legacy Focus commitment' }
      }])
    expect(migrated.domain.commitments.find(focusCommitment.id)).toBeNull()
    expect(migrated.domain.commitments.find(focusRoutine.id)).toBeNull()
    expect(migrated.domain.updates.find(survivingUpdate.id)).toMatchObject({
      observation: 'Keep this Thread evidence'
    })
    migrated.close()

    const raw = new DatabaseSync(databasePath)
    expect(raw.prepare("SELECT count(*) AS count FROM todos WHERE focus_id = ?").get(focus.id))
      .toEqual({ count: 0 })
    expect(raw.prepare(
      "SELECT count(*) AS count FROM rich_text_history WHERE document_type = 'focus-goal'"
    ).get()).toEqual({ count: 0 })
    expect(() => raw.prepare(
      `INSERT INTO commitments (
         focus_id, thread_id, commitment_type, behavior_type, title, status,
         sensitive, created_at, updated_at
       ) VALUES (?, NULL, 'tracking', 'tracking', 'Rejected', 'active', 0, ?, ?)`
    ).run(
      focus.id,
      '2026-08-13T12:00:00.000Z',
      '2026-08-13T12:00:00.000Z'
    )).toThrow(/must belong to a Thread/)
    raw.close()
  })
})
