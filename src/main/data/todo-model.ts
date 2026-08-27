import type {
  CreateTodoInput,
  TodoEntityParent,
  TodoListOptions,
  TodoOverviewItemSnapshot,
  TodoOverviewSnapshot,
  TodoParent,
  TodoSnapshot,
  TodoSubjectCompletionSnapshot,
  TodoSortPlacementSnapshot,
  SubjectSnapshot,
  UpdateScopeCell,
  UpdateTodoInput
} from '../../shared/contracts'
import { BaseModel, BaseRepository, ModelNotFoundError, ModelValidationError } from './model'
import { ScopeApplicationRepository, ScopeRepository, SubjectRepository } from './scope-model'
import type { SqliteAdapter } from './sqlite-adapter'

type TodoRecord = TodoSnapshot

interface TodoRow {
  id: number
  focus_id: number | null
  thread_id: number | null
  commitment_id: number | null
  scope_id: number | null
  subject_id: number | null
  name: string
  due_on: string | null
  done: number
  completed_at: string | null
  shared_across_subjects: number
  created_at: string
  updated_at: string
}

interface TodoSubjectCompletionRow {
  todo_id: number
  subject_id: number
  done: number
  completed_at: string | null
  created_at: string
  updated_at: string
}

interface TodoOverviewRow extends TodoRow {
  overview_focus_id: number
  overview_focus_title: string
  overview_focus_sensitive: number
  overview_thread_id: number | null
  overview_thread_title: string | null
  overview_thread_sensitive: number | null
  overview_commitment_id: number | null
  overview_commitment_title: string | null
  overview_commitment_sensitive: number | null
}

interface TodoListRow {
  id: number
  focus_id: number | null
  thread_id: number | null
  commitment_id: number | null
  scope_id: number | null
  subject_id: number | null
}

interface TodoOrderRow {
  todo_id: number
  sort_key: number
}

interface SortKeyRow {
  sort_key: number | null
}

interface ExistsRow {
  found: number
}

interface ParentColumns {
  focusId: number | null
  threadId: number | null
  commitmentId: number | null
  scopeId: number | null
  subjectId: number | null
}

const SORT_STRIDE = 1024
export const RECENTLY_COMPLETED_TODO_DAYS = 7
const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Ordinary Todo projections include only records whose complete work
 * hierarchy is current. Historical MCP discovery is intentionally handled by
 * the search index's explicit lifecycle modes instead of weakening this rule.
 */
const TODO_HIERARCHY_JOINS = `
  LEFT JOIN commitments todo_commitment ON todo_commitment.id = todo.commitment_id
  LEFT JOIN threads todo_direct_thread ON todo_direct_thread.id = todo.thread_id
  LEFT JOIN threads todo_commitment_thread
    ON todo_commitment_thread.id = todo_commitment.thread_id
  JOIN focuses todo_focus ON todo_focus.id = COALESCE(
    todo.focus_id,
    todo_direct_thread.focus_id,
    todo_commitment.focus_id,
    todo_commitment_thread.focus_id
  )`

const TODO_HIERARCHY_IS_CURRENT = `
  todo_focus.status IN ('active', 'paused')
  AND (
    COALESCE(todo_direct_thread.status, todo_commitment_thread.status) IS NULL OR
    COALESCE(todo_direct_thread.status, todo_commitment_thread.status) IN ('active', 'paused')
  )
  AND (
    todo_commitment.status IS NULL OR todo_commitment.status IN ('active', 'paused')
  )`

function assertId(id: number, field: string): void {
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new ModelValidationError(`${field} must be a positive integer`)
  }
}

function normalizeName(value: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ModelValidationError('Todo name cannot be empty')
  }
  return value.trim()
}

function normalizeDone(value: boolean | undefined): boolean {
  if (value === undefined) return false
  if (typeof value !== 'boolean') throw new ModelValidationError('Todo done must be a boolean')
  return value
}

function normalizeDate(value: string, field: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new ModelValidationError(`${field} must use YYYY-MM-DD`)
  }
  const parsed = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new ModelValidationError(`${field} must be a real calendar date`)
  }
  return value
}

function normalizeOptionalDate(value: string | null | undefined, field: string): string | null {
  return value === null || value === undefined || value.length === 0
    ? null
    : normalizeDate(value, field)
}

function today(now = new Date()): string {
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function timestamp(now = new Date()): string {
  return now.toISOString()
}

function entityParent(parent: TodoParent): TodoEntityParent {
  if (parent.type === 'thread-scope') return { type: 'thread', id: parent.id }
  if (parent.type === 'commitment-scope') return { type: 'commitment', id: parent.id }
  return parent
}

function scopeCell(parent: TodoParent): UpdateScopeCell | null {
  return parent.type === 'thread-scope' || parent.type === 'commitment-scope'
    ? parent.scope
    : null
}

function parentColumns(parent: TodoParent): ParentColumns {
  const entity = entityParent(parent)
  const scope = scopeCell(parent)
  return {
    focusId: entity.type === 'focus' ? entity.id : null,
    threadId: entity.type === 'thread' ? entity.id : null,
    commitmentId: entity.type === 'commitment' ? entity.id : null,
    scopeId: scope?.scopeId ?? null,
    subjectId: scope?.subjectId ?? null
  }
}

function parentFromColumns(columns: ParentColumns): TodoParent {
  if (columns.focusId !== null) return { type: 'focus', id: columns.focusId }
  if (columns.threadId !== null) {
    return columns.scopeId === null
      ? { type: 'thread', id: columns.threadId }
      : {
          type: 'thread-scope',
          id: columns.threadId,
          scope: { scopeId: columns.scopeId, subjectId: columns.subjectId as number }
        }
  }
  if (columns.commitmentId === null) {
    throw new ModelValidationError('Todo parent is invalid')
  }
  return columns.scopeId === null
    ? { type: 'commitment', id: columns.commitmentId }
    : {
        type: 'commitment-scope',
        id: columns.commitmentId,
        scope: { scopeId: columns.scopeId, subjectId: columns.subjectId as number }
      }
}

function columnsFromTodoRow(row: TodoRow): ParentColumns {
  return {
    focusId: row.focus_id === null ? null : Number(row.focus_id),
    threadId: row.thread_id === null ? null : Number(row.thread_id),
    commitmentId: row.commitment_id === null ? null : Number(row.commitment_id),
    scopeId: row.scope_id === null ? null : Number(row.scope_id),
    subjectId: row.subject_id === null ? null : Number(row.subject_id)
  }
}

function columnsFromListRow(row: TodoListRow): ParentColumns {
  return {
    focusId: row.focus_id === null ? null : Number(row.focus_id),
    threadId: row.thread_id === null ? null : Number(row.thread_id),
    commitmentId: row.commitment_id === null ? null : Number(row.commitment_id),
    scopeId: row.scope_id === null ? null : Number(row.scope_id),
    subjectId: row.subject_id === null ? null : Number(row.subject_id)
  }
}

export class TodoModel extends BaseModel<TodoRecord> {
  constructor(repository: TodoRepository, record: TodoRecord) {
    super(repository, record)
  }

  get name(): string {
    return this.record.name
  }

  get parent(): TodoParent {
    return this.record.parent
  }

  get dueDate(): string | null {
    return this.record.dueDate
  }

  get done(): boolean {
    return this.record.done
  }

  get completedAt(): string | null {
    return this.record.completedAt
  }

  get sharedAcrossSubjects(): boolean {
    return this.record.sharedAcrossSubjects
  }

  get subjectCompletions(): readonly TodoSubjectCompletionSnapshot[] {
    return this.record.subjectCompletions
  }

  get sort(): readonly TodoSortPlacementSnapshot[] {
    return this.record.sort
  }

  toSnapshot(): TodoSnapshot {
    return this.record
  }

  update(input: UpdateTodoInput): this {
    const repository = this.persistence as TodoRepository
    return this.replace(repository.update(this.id, input))
  }

  setDone(done: boolean): this {
    return this.update({ done })
  }

  setSubjectDone(subjectId: number, done: boolean): this {
    const repository = this.persistence as TodoRepository
    return this.replace(repository.updateSubjectCompletion(this.id, subjectId, done))
  }
}

/**
 * Persists Todos separately from their list placements. A scoped Todo receives
 * one position in its exact Subject context and another independent position in
 * the aggregate entity list. Partial reorder requests only rearrange the
 * supplied Todos among their existing slots, so filtered views cannot scramble
 * hidden records.
 */
export class TodoRepository extends BaseRepository<TodoRecord, TodoModel> {
  private readonly applications: ScopeApplicationRepository
  private readonly scopes: ScopeRepository
  private readonly subjects: SubjectRepository

  constructor(private readonly database: SqliteAdapter) {
    super()
    this.applications = new ScopeApplicationRepository(database)
    this.scopes = new ScopeRepository(database)
    this.subjects = new SubjectRepository(database)
  }

  protected instantiate(record: TodoRecord): TodoModel {
    return new TodoModel(this, record)
  }

  create(input: CreateTodoInput, now = new Date()): TodoModel {
    const name = normalizeName(input.name)
    const dueDate = normalizeOptionalDate(input.dueDate, 'Todo due date')
    const done = normalizeDone(input.done)
    const sharedAcrossSubjects = input.sharedAcrossSubjects ?? false
    if (typeof sharedAcrossSubjects !== 'boolean') {
      throw new ModelValidationError('Todo shared-across-Subjects flag must be a boolean')
    }
    const columns = sharedAcrossSubjects
      ? this.validateSharedParent(input.parent, done, now)
      : this.validateParent(input.parent, now)
    const createdAt = timestamp(now)

    const id = this.database.transaction(() => {
      const result = this.database.run(
        `INSERT INTO todos (
           focus_id, thread_id, commitment_id, scope_id, subject_id,
           name, due_on, done, completed_at, shared_across_subjects, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          columns.focusId,
          columns.threadId,
          columns.commitmentId,
          columns.scopeId,
          columns.subjectId,
          name,
          dueDate,
          done ? 1 : 0,
          done ? createdAt : null,
          sharedAcrossSubjects ? 1 : 0,
          createdAt,
          createdAt
        ]
      )

      const aggregate = entityParent(input.parent)
      this.addPlacement(result.lastInsertRowid, this.ensureList(aggregate, now), now)
      if (sharedAcrossSubjects) {
        this.reconcileSharedTodo(result.lastInsertRowid, aggregate, now)
      } else if (scopeCell(input.parent)) {
        this.addPlacement(result.lastInsertRowid, this.ensureList(input.parent, now), now)
      }
      return result.lastInsertRowid
    })

    return this.instantiate(this.find(id, now) as TodoSnapshot)
  }

  find(id: number, now = new Date()): TodoSnapshot | null {
    assertId(id, 'Todo id')
    let row = this.findRow(id)
    if (row && Boolean(row.shared_across_subjects)) {
      this.reconcileSharedTodo(id, entityParent(parentFromColumns(columnsFromTodoRow(row))), now)
      row = this.findRow(id)
    }
    return row ? this.snapshotFromRow(row) : null
  }

  private findRow(id: number): TodoRow | undefined {
    return this.database.get<TodoRow>(
      `SELECT id, focus_id, thread_id, commitment_id, scope_id, subject_id,
              name, due_on, done, completed_at, shared_across_subjects, created_at, updated_at
       FROM todos WHERE id = ?`,
      [id]
    )
  }

  list(
    context: TodoParent,
    options: TodoListOptions = {},
    now = new Date()
  ): TodoSnapshot[] {
    this.validateListOptions(options)
    this.assertContextReferences(context)
    this.reconcileSharedTodos(entityParent(context), now)
    const list = this.findList(context)
    if (!list) return []

    const clauses = ['placement.list_id = ?', TODO_HIERARCHY_IS_CURRENT]
    const parameters: Array<number | string> = [list.id]
    if (options.done !== undefined) {
      clauses.push('todo.done = ?')
      parameters.push(options.done ? 1 : 0)
    }
    if (options.dueOnOrBefore !== undefined) {
      clauses.push('todo.due_on IS NOT NULL AND todo.due_on <= ?')
      parameters.push(normalizeDate(options.dueOnOrBefore, 'dueOnOrBefore'))
    }
    if (options.dueOnOrAfter !== undefined) {
      clauses.push('todo.due_on IS NOT NULL AND todo.due_on >= ?')
      parameters.push(normalizeDate(options.dueOnOrAfter, 'dueOnOrAfter'))
    }

    return this.database.all<TodoRow>(
      `SELECT todo.id, todo.focus_id, todo.thread_id, todo.commitment_id,
              todo.scope_id, todo.subject_id, todo.name, todo.due_on,
              todo.done, todo.completed_at, todo.shared_across_subjects,
              todo.created_at, todo.updated_at
       FROM todo_sort_placements placement
       JOIN todos todo ON todo.id = placement.todo_id
       ${TODO_HIERARCHY_JOINS}
       WHERE ${clauses.join(' AND ')}
       ORDER BY placement.sort_key, todo.id`,
      parameters
    ).map((row) => this.snapshotFromRow(row))
  }

  /**
   * Returns each Todo once without imposing one contextual list's ordering.
   * Callers can inspect `sort` to project it into any aggregate or exact list.
   */
  query(options: TodoListOptions = {}, now = new Date()): TodoSnapshot[] {
    this.validateListOptions(options)
    this.reconcileAllSharedTodos(now)
    const clauses: string[] = [TODO_HIERARCHY_IS_CURRENT]
    const parameters: Array<number | string> = []
    if (options.done !== undefined) {
      clauses.push('todo.done = ?')
      parameters.push(options.done ? 1 : 0)
    }
    if (options.dueOnOrBefore !== undefined) {
      clauses.push('todo.due_on IS NOT NULL AND todo.due_on <= ?')
      parameters.push(normalizeDate(options.dueOnOrBefore, 'dueOnOrBefore'))
    }
    if (options.dueOnOrAfter !== undefined) {
      clauses.push('todo.due_on IS NOT NULL AND todo.due_on >= ?')
      parameters.push(normalizeDate(options.dueOnOrAfter, 'dueOnOrAfter'))
    }
    return this.database.all<TodoRow>(
      `SELECT todo.id, todo.focus_id, todo.thread_id, todo.commitment_id,
              todo.scope_id, todo.subject_id, todo.name, todo.due_on,
              todo.done, todo.completed_at, todo.shared_across_subjects,
              todo.created_at, todo.updated_at
       FROM todos todo
       ${TODO_HIERARCHY_JOINS}
       WHERE ${clauses.join(' AND ')}
       ORDER BY todo.done, CASE WHEN todo.due_on IS NULL THEN 1 ELSE 0 END,
                todo.due_on, todo.id`,
      parameters
    ).map((row) => this.snapshotFromRow(row))
  }

  /**
   * Returns every open Todo plus only recently completed Todos. The completion
   * cutoff is part of the SQL predicate, so older closed work is never
   * materialized or sent to a renderer.
   */
  overview(
    now = new Date(),
    recentlyCompletedDays = RECENTLY_COMPLETED_TODO_DAYS
  ): TodoOverviewSnapshot {
    if (!Number.isSafeInteger(recentlyCompletedDays) || recentlyCompletedDays <= 0) {
      throw new ModelValidationError('recently completed Todo days must be a positive integer')
    }
    const completedSince = new Date(now.getTime() - recentlyCompletedDays * DAY_MS).toISOString()
    this.reconcileAllSharedTodos(now)
    const rows = this.database.all<TodoOverviewRow>(
      `SELECT todo.id, todo.focus_id, todo.thread_id, todo.commitment_id,
              todo.scope_id, todo.subject_id, todo.name, todo.due_on,
              todo.done, todo.completed_at, todo.shared_across_subjects,
              todo.created_at, todo.updated_at,
              todo_focus.id AS overview_focus_id,
              todo_focus.title AS overview_focus_title,
              todo_focus.sensitive AS overview_focus_sensitive,
              COALESCE(todo_direct_thread.id, todo_commitment_thread.id)
                AS overview_thread_id,
              COALESCE(todo_direct_thread.title, todo_commitment_thread.title)
                AS overview_thread_title,
              COALESCE(todo_direct_thread.sensitive, todo_commitment_thread.sensitive)
                AS overview_thread_sensitive,
              todo_commitment.id AS overview_commitment_id,
              todo_commitment.title AS overview_commitment_title,
              todo_commitment.sensitive AS overview_commitment_sensitive
       FROM todos todo
       ${TODO_HIERARCHY_JOINS}
       WHERE ${TODO_HIERARCHY_IS_CURRENT}
         AND (todo.done = 0 OR (todo.done = 1 AND todo.completed_at >= ?))
       ORDER BY todo.done,
                CASE WHEN todo.due_on IS NULL THEN 1 ELSE 0 END,
                todo.due_on,
                todo.id`,
      [completedSince]
    )

    return {
      items: rows.map((row) => this.overviewSnapshotFromRow(row)),
      today: today(now),
      recentlyCompletedDays,
      completedSince
    }
  }

  update(id: number, input: UpdateTodoInput, now = new Date()): TodoSnapshot {
    const current = this.findRow(id)
    if (!current) throw new ModelNotFoundError('Todo', id)
    if (Boolean(current.shared_across_subjects) && input.done !== undefined) {
      throw new ModelValidationError(
        'a shared Todo is completed only through its Subject completion cells'
      )
    }
    const snapshot = this.snapshotFromRow(current)
    const name = input.name === undefined ? snapshot.name : normalizeName(input.name)
    const dueDate = input.dueDate === undefined
      ? snapshot.dueDate
      : normalizeOptionalDate(input.dueDate, 'Todo due date')
    const done = input.done === undefined ? snapshot.done : normalizeDone(input.done)
    const completedAt = done
      ? snapshot.done
        ? snapshot.completedAt ?? timestamp(now)
        : timestamp(now)
      : null
    this.database.run(
      `UPDATE todos
       SET name = ?, due_on = ?, done = ?, completed_at = ?, updated_at = ?
       WHERE id = ?`,
      [name, dueDate, done ? 1 : 0, completedAt, timestamp(now), id]
    )
    return this.find(id, now) as TodoSnapshot
  }

  updateSubjectCompletion(
    id: number,
    subjectId: number,
    done: boolean,
    now = new Date()
  ): TodoSnapshot {
    assertId(id, 'Todo id')
    assertId(subjectId, 'Todo Subject id')
    if (typeof done !== 'boolean') {
      throw new ModelValidationError('Todo Subject completion done must be a boolean')
    }
    const row = this.findRow(id)
    if (!row) throw new ModelNotFoundError('Todo', id)
    if (row.shared_across_subjects === 0) {
      throw new ModelValidationError('Todo Subject completion requires a shared Todo')
    }
    const parent = entityParent(parentFromColumns(columnsFromTodoRow(row)))
    return this.database.transaction(() => {
      this.reconcileSharedTodo(id, parent, now)
      const current = this.database.get<TodoSubjectCompletionRow>(
        `SELECT todo_id, subject_id, done, completed_at, created_at, updated_at
         FROM todo_subject_completions WHERE todo_id = ? AND subject_id = ?`,
        [id, subjectId]
      )
      if (!current) {
        throw new ModelValidationError('Todo Subject is not in the current shared context')
      }
      const changedAt = timestamp(now)
      this.database.run(
        `UPDATE todo_subject_completions
         SET done = ?, completed_at = ?, updated_at = ?
         WHERE todo_id = ? AND subject_id = ?`,
        [
          done ? 1 : 0,
          done ? (current.done !== 0 ? current.completed_at ?? changedAt : changedAt) : null,
          changedAt,
          id,
          subjectId
        ]
      )
      this.refreshSharedCompletion(id, now)
      return this.snapshotFromRow(this.findRow(id) as TodoRow)
    })
  }

  /**
   * Reorders all or a filtered subset. Omitted Todos keep their slots relative
   * to one another; supplied Todos are permuted only among the slots they
   * already occupied in this context.
   */
  reorder(
    context: TodoParent,
    orderedTodoIds: readonly number[],
    now = new Date()
  ): TodoSnapshot[] {
    this.assertContextReferences(context)
    this.reconcileSharedTodos(entityParent(context), now)
    const list = this.findList(context)
    if (!list) {
      if (orderedTodoIds.length === 0) return []
      throw new ModelValidationError('Todo sort context does not exist')
    }
    const unique = new Set<number>()
    for (const id of orderedTodoIds) {
      assertId(id, 'Todo id')
      if (unique.has(id)) throw new ModelValidationError('Todo reorder ids must be unique')
      unique.add(id)
    }
    if (orderedTodoIds.length === 0) return this.list(context)

    this.database.transaction(() => {
      const current = this.database.all<TodoOrderRow>(
        `SELECT todo_id, sort_key FROM todo_sort_placements
         WHERE list_id = ? ORDER BY sort_key, todo_id`,
        [list.id]
      )
      const currentIds = new Set(current.map(({ todo_id: todoId }) => Number(todoId)))
      const missing = orderedTodoIds.find((id) => !currentIds.has(id))
      if (missing !== undefined) {
        throw new ModelValidationError(`Todo ${missing} is not in this sort context`)
      }

      let replacementIndex = 0
      const reorderedIds = current.map(({ todo_id: todoId }) =>
        unique.has(Number(todoId))
          ? orderedTodoIds[replacementIndex++]
          : Number(todoId)
      )
      const updatedAt = timestamp(now)
      reorderedIds.forEach((todoId, index) => {
        this.database.run(
          `UPDATE todo_sort_placements SET sort_key = ?, updated_at = ?
           WHERE todo_id = ? AND list_id = ?`,
          [(index + 1) * SORT_STRIDE, updatedAt, todoId, list.id]
        )
      })
    })
    return this.list(context, {}, now)
  }

  delete(id: number): boolean {
    assertId(id, 'Todo id')
    return this.database.transaction(() => {
      const deleted = this.database.run('DELETE FROM todos WHERE id = ?', [id]).changes > 0
      if (deleted) {
        this.database.run(
          `DELETE FROM todo_lists
           WHERE NOT EXISTS (
             SELECT 1 FROM todo_sort_placements placement
             WHERE placement.list_id = todo_lists.id
           )`
        )
      }
      return deleted
    })
  }

  private snapshotFromRow(row: TodoRow): TodoSnapshot {
    return {
      id: Number(row.id),
      name: row.name,
      parent: parentFromColumns(columnsFromTodoRow(row)),
      subject: row.subject_id === null
        ? null
        : this.subjects.find(Number(row.subject_id)) as SubjectSnapshot | null,
      sharedAcrossSubjects: Boolean(row.shared_across_subjects),
      subjectCompletions: row.shared_across_subjects !== 0
        ? this.subjectCompletions(Number(row.id))
        : [],
      dueDate: row.due_on,
      done: Boolean(row.done),
      completedAt: row.completed_at,
      sort: this.sortPlacements(Number(row.id)),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }
  }

  private subjectCompletions(todoId: number): TodoSubjectCompletionSnapshot[] {
    return this.database.all<TodoSubjectCompletionRow>(
      `SELECT todo_id, subject_id, done, completed_at, created_at, updated_at
       FROM todo_subject_completions WHERE todo_id = ? ORDER BY subject_id`,
      [todoId]
    ).flatMap((row) => {
      const subject = this.subjects.find(Number(row.subject_id))
      return subject ? [{
        subject,
        done: Boolean(row.done),
        completedAt: row.completed_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }] : []
    })
  }

  private overviewSnapshotFromRow(row: TodoOverviewRow): TodoOverviewItemSnapshot {
    return {
      ...this.snapshotFromRow(row),
      focus: {
        id: Number(row.overview_focus_id),
        title: row.overview_focus_title,
        sensitive: Boolean(row.overview_focus_sensitive)
      },
      thread: row.overview_thread_id === null
        ? null
        : {
            id: Number(row.overview_thread_id),
            title: row.overview_thread_title as string,
            sensitive: Boolean(row.overview_thread_sensitive)
          },
      commitment: row.overview_commitment_id === null
        ? null
        : {
            id: Number(row.overview_commitment_id),
            title: row.overview_commitment_title as string,
            sensitive: Boolean(row.overview_commitment_sensitive)
          }
    }
  }

  private sortPlacements(todoId: number): TodoSortPlacementSnapshot[] {
    return this.database.all<TodoListRow & { sort_key: number }>(
      `SELECT list.id, list.focus_id, list.thread_id, list.commitment_id,
              list.scope_id, list.subject_id, placement.sort_key
       FROM todo_sort_placements placement
       JOIN todo_lists list ON list.id = placement.list_id
       WHERE placement.todo_id = ?
       ORDER BY CASE WHEN list.scope_id IS NULL THEN 0 ELSE 1 END, list.id`,
      [todoId]
    ).map((row) => ({
      context: parentFromColumns(columnsFromListRow(row)),
      position: Number(row.sort_key)
    }))
  }

  private validateSharedParent(parent: TodoParent, done: boolean, now: Date): ParentColumns {
    this.assertContextShape(parent)
    if (parent.type !== 'thread' && parent.type !== 'commitment') {
      throw new ModelValidationError(
        'a shared Todo requires an aggregate Thread or Commitment parent'
      )
    }
    if (done) {
      throw new ModelValidationError(
        'a shared Todo is completed only through its Subject completion cells'
      )
    }
    this.requireEntityParent(parent)
    this.assertCurrentHierarchy(parent)
    const context = this.sharedContext(parent, now)
    if (context.scopeId === null || context.subjects.length === 0) {
      throw new ModelValidationError('a shared Todo requires at least one current Subject')
    }
    return parentColumns(parent)
  }

  private sharedContext(
    parent: TodoEntityParent,
    now: Date
  ): { scopeId: number | null; subjects: SubjectSnapshot[] } {
    if (parent.type === 'focus') return { scopeId: null, subjects: [] }
    const application = this.applications.get(
      parent.type === 'thread'
        ? { type: 'thread', id: parent.id }
        : { type: 'commitment', id: parent.id }
    )
    const scopeId = application.effectiveScopeId
    return {
      scopeId,
      subjects: scopeId === null ? [] : this.scopes.effectiveSubjects(scopeId, today(now))
    }
  }

  private reconcileAllSharedTodos(now: Date): void {
    const parents = this.database.all<{
      thread_id: number | null
      commitment_id: number | null
    }>(
      `SELECT DISTINCT thread_id, commitment_id FROM todos
       WHERE shared_across_subjects = 1`
    )
    for (const row of parents) {
      if (row.thread_id !== null) {
        this.reconcileSharedTodos({ type: 'thread', id: Number(row.thread_id) }, now)
      } else if (row.commitment_id !== null) {
        this.reconcileSharedTodos({ type: 'commitment', id: Number(row.commitment_id) }, now)
      }
    }
  }

  private reconcileSharedTodos(parent: TodoEntityParent, now: Date): void {
    if (parent.type === 'focus') return
    const column = parent.type === 'thread' ? 'thread_id' : 'commitment_id'
    const rows = this.database.all<{ id: number }>(
      `SELECT id FROM todos WHERE ${column} = ? AND shared_across_subjects = 1 ORDER BY id`,
      [parent.id]
    )
    if (rows.length === 0) return
    this.database.transaction(() => {
      for (const row of rows) this.reconcileSharedTodo(Number(row.id), parent, now)
    })
  }

  private reconcileSharedTodo(todoId: number, parent: TodoEntityParent, now: Date): void {
    if (parent.type === 'focus') return
    const context = this.sharedContext(parent, now)
    const desiredSubjectIds = new Set(context.subjects.map(({ id }) => id))
    const completionRows = this.database.all<TodoSubjectCompletionRow>(
      `SELECT todo_id, subject_id, done, completed_at, created_at, updated_at
       FROM todo_subject_completions WHERE todo_id = ?`,
      [todoId]
    )
    const existingSubjectIds = new Set(
      completionRows.map(({ subject_id: subjectId }) => Number(subjectId))
    )
    let changed = false

    const exactPlacements = this.database.all<{
      list_id: number
      scope_id: number
      subject_id: number
    }>(
      `SELECT placement.list_id, list.scope_id, list.subject_id
       FROM todo_sort_placements placement
       JOIN todo_lists list ON list.id = placement.list_id
       WHERE placement.todo_id = ? AND list.scope_id IS NOT NULL`,
      [todoId]
    )
    for (const placement of exactPlacements) {
      if (
        context.scopeId !== Number(placement.scope_id) ||
        !desiredSubjectIds.has(Number(placement.subject_id))
      ) {
        this.database.run(
          'DELETE FROM todo_sort_placements WHERE todo_id = ? AND list_id = ?',
          [todoId, placement.list_id]
        )
        changed = true
      }
    }

    for (const subjectId of existingSubjectIds) {
      if (desiredSubjectIds.has(subjectId)) continue
      this.database.run(
        'DELETE FROM todo_subject_completions WHERE todo_id = ? AND subject_id = ?',
        [todoId, subjectId]
      )
      changed = true
    }

    const createdAt = timestamp(now)
    for (const subject of context.subjects) {
      if (!existingSubjectIds.has(subject.id)) {
        this.database.run(
          `INSERT INTO todo_subject_completions (
             todo_id, subject_id, done, completed_at, created_at, updated_at
           ) VALUES (?, ?, 0, NULL, ?, ?)`,
          [todoId, subject.id, createdAt, createdAt]
        )
        changed = true
      }
      if (context.scopeId === null) continue
      const exactContext: TodoParent = parent.type === 'thread'
        ? {
            type: 'thread-scope',
            id: parent.id,
            scope: { scopeId: context.scopeId, subjectId: subject.id }
          }
        : {
            type: 'commitment-scope',
            id: parent.id,
            scope: { scopeId: context.scopeId, subjectId: subject.id }
          }
      const list = this.ensureList(exactContext, now)
      const placement = this.database.get<ExistsRow>(
        `SELECT 1 AS found FROM todo_sort_placements
         WHERE todo_id = ? AND list_id = ?`,
        [todoId, list.id]
      )
      if (!placement) {
        this.addPlacement(todoId, list, now)
        changed = true
      }
    }
    this.refreshSharedCompletion(todoId, now, changed)
  }

  private refreshSharedCompletion(todoId: number, now: Date, touched = false): void {
    const summary = this.database.get<{ total: number; incomplete: number }>(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(CASE WHEN done = 0 THEN 1 ELSE 0 END), 0) AS incomplete
       FROM todo_subject_completions WHERE todo_id = ?`,
      [todoId]
    ) as { total: number; incomplete: number }
    const row = this.findRow(todoId)
    if (!row) throw new ModelNotFoundError('Todo', todoId)
    const done = Number(summary.total) === 0 || Number(summary.incomplete) === 0
    const stateChanged = done !== Boolean(row.done)
    if (!stateChanged && !touched) return
    const changedAt = timestamp(now)
    this.database.run(
      `UPDATE todos SET done = ?, completed_at = ?, updated_at = ? WHERE id = ?`,
      [
        done ? 1 : 0,
        done ? (row.done !== 0 ? row.completed_at ?? changedAt : changedAt) : null,
        changedAt,
        todoId
      ]
    )
  }

  private validateParent(parent: TodoParent, now: Date): ParentColumns {
    this.assertContextShape(parent)
    const entity = entityParent(parent)
    if (entity.type === 'focus') {
      throw new ModelValidationError('a Todo must belong to a Thread or Commitment')
    }
    const focusId = this.requireEntityParent(entity)
    this.assertCurrentHierarchy(entity)
    const scope = scopeCell(parent)
    if (!scope) {
      const owner = entity.type === 'thread'
        ? { type: 'thread' as const, id: entity.id }
        : { type: 'commitment' as const, id: entity.id }
      const application = this.applications.get(owner)
      if (
        application.effectiveScopeId !== null &&
        this.scopes.effectiveSubjects(application.effectiveScopeId, today(now)).length > 0
      ) {
        throw new ModelValidationError(
          'a scoped Thread or Commitment Todo requires a Scope and Subject cell'
        )
      }
      return parentColumns(parent)
    }

    assertId(scope.scopeId, 'Todo Scope id')
    assertId(scope.subjectId, 'Todo Subject id')
    const definition = this.scopes.find(scope.scopeId)
    if (!definition) throw new ModelNotFoundError('Scope', scope.scopeId)
    if (definition.focusId !== focusId) {
      throw new ModelValidationError('Todo Scope must belong to its parent Focus')
    }
    const subject = this.database.get<ExistsRow>(
      'SELECT 1 AS found FROM subjects WHERE id = ?',
      [scope.subjectId]
    )
    if (!subject) throw new ModelNotFoundError('Subject', scope.subjectId)

    const owner = entity.type === 'thread'
      ? { type: 'thread' as const, id: entity.id }
      : { type: 'commitment' as const, id: entity.id }
    const application = this.applications.get(owner)
    if (application.effectiveScopeId !== scope.scopeId) {
      throw new ModelValidationError('Todo Scope must match its parent current effective Scope')
    }
    if (!this.scopes.isEffectiveMember(scope.scopeId, scope.subjectId, today(now))) {
      throw new ModelValidationError('Todo Subject is not an effective member of its Scope')
    }
    return parentColumns(parent)
  }

  private assertContextReferences(context: TodoParent): void {
    this.assertContextShape(context)
    const entity = entityParent(context)
    const focusId = this.requireEntityParent(entity)
    const scope = scopeCell(context)
    if (!scope) return
    assertId(scope.scopeId, 'Todo Scope id')
    assertId(scope.subjectId, 'Todo Subject id')
    const definition = this.scopes.find(scope.scopeId)
    if (!definition) throw new ModelNotFoundError('Scope', scope.scopeId)
    if (definition.focusId !== focusId) {
      throw new ModelValidationError('Todo Scope must belong to its parent Focus')
    }
    if (!this.database.get<ExistsRow>('SELECT 1 AS found FROM subjects WHERE id = ?', [scope.subjectId])) {
      throw new ModelNotFoundError('Subject', scope.subjectId)
    }
  }

  private assertContextShape(context: TodoParent): void {
    if (!context || typeof context !== 'object') {
      throw new ModelValidationError('Todo parent is required')
    }
    if (!['focus', 'thread', 'commitment', 'thread-scope', 'commitment-scope'].includes(context.type)) {
      throw new ModelValidationError('Todo parent type is unsupported')
    }
    assertId(context.id, 'Todo parent id')
    if (
      (context.type === 'thread-scope' || context.type === 'commitment-scope') &&
      (!context.scope || typeof context.scope !== 'object')
    ) {
      throw new ModelValidationError('Scoped Todo parent requires a Scope and Subject cell')
    }
  }

  private requireEntityParent(parent: TodoEntityParent): number {
    if (parent.type === 'focus') {
      if (!this.database.get<ExistsRow>('SELECT 1 AS found FROM focuses WHERE id = ?', [parent.id])) {
        throw new ModelNotFoundError('Focus', parent.id)
      }
      return parent.id
    }
    if (parent.type === 'thread') {
      const row = this.database.get<{ focus_id: number }>(
        'SELECT focus_id FROM threads WHERE id = ?',
        [parent.id]
      )
      if (!row) throw new ModelNotFoundError('Thread', parent.id)
      return Number(row.focus_id)
    }
    const row = this.database.get<{ focus_id: number | null; thread_focus_id: number | null }>(
      `SELECT commitment.focus_id, thread.focus_id AS thread_focus_id
       FROM commitments commitment
       LEFT JOIN threads thread ON thread.id = commitment.thread_id
       WHERE commitment.id = ?`,
      [parent.id]
    )
    if (!row) throw new ModelNotFoundError('Commitment', parent.id)
    return Number(row.focus_id ?? row.thread_focus_id)
  }

  private assertCurrentHierarchy(parent: TodoEntityParent): void {
    const current = parent.type === 'focus'
      ? this.database.get<ExistsRow>(
          `SELECT 1 AS found FROM focuses
           WHERE id = ? AND status IN ('active', 'paused')`,
          [parent.id]
        )
      : parent.type === 'thread'
        ? this.database.get<ExistsRow>(
            `SELECT 1 AS found
             FROM threads thread
             JOIN focuses focus ON focus.id = thread.focus_id
             WHERE thread.id = ?
               AND thread.status IN ('active', 'paused')
               AND focus.status IN ('active', 'paused')`,
            [parent.id]
          )
        : this.database.get<ExistsRow>(
            `SELECT 1 AS found
             FROM commitments commitment
             LEFT JOIN threads thread ON thread.id = commitment.thread_id
             JOIN focuses focus ON focus.id = COALESCE(commitment.focus_id, thread.focus_id)
             WHERE commitment.id = ?
               AND commitment.status IN ('active', 'paused')
               AND (thread.id IS NULL OR thread.status IN ('active', 'paused'))
               AND focus.status IN ('active', 'paused')`,
            [parent.id]
          )
    if (!current) {
      throw new ModelValidationError(
        'a Todo requires an active or paused Focus, Thread, and Commitment hierarchy'
      )
    }
  }

  private findList(context: TodoParent): TodoListRow | undefined {
    const columns = parentColumns(context)
    return this.database.get<TodoListRow>(
      `SELECT id, focus_id, thread_id, commitment_id, scope_id, subject_id
       FROM todo_lists
       WHERE focus_id IS ? AND thread_id IS ? AND commitment_id IS ?
         AND scope_id IS ? AND subject_id IS ?`,
      [
        columns.focusId,
        columns.threadId,
        columns.commitmentId,
        columns.scopeId,
        columns.subjectId
      ]
    )
  }

  private ensureList(context: TodoParent, now: Date): TodoListRow {
    const current = this.findList(context)
    if (current) return current
    const columns = parentColumns(context)
    const result = this.database.run(
      `INSERT INTO todo_lists (
         focus_id, thread_id, commitment_id, scope_id, subject_id, created_at
       ) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        columns.focusId,
        columns.threadId,
        columns.commitmentId,
        columns.scopeId,
        columns.subjectId,
        timestamp(now)
      ]
    )
    return this.database.get<TodoListRow>(
      `SELECT id, focus_id, thread_id, commitment_id, scope_id, subject_id
       FROM todo_lists WHERE id = ?`,
      [result.lastInsertRowid]
    ) as TodoListRow
  }

  private addPlacement(todoId: number, list: TodoListRow, now: Date): void {
    const maximum = this.database.get<SortKeyRow>(
      'SELECT MAX(sort_key) AS sort_key FROM todo_sort_placements WHERE list_id = ?',
      [list.id]
    )?.sort_key ?? 0
    const next = Number(maximum) + SORT_STRIDE
    if (!Number.isSafeInteger(next)) {
      throw new ModelValidationError('Todo sort position exceeds the supported range')
    }
    const createdAt = timestamp(now)
    this.database.run(
      `INSERT INTO todo_sort_placements (
         todo_id, list_id, sort_key, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?)`,
      [todoId, list.id, next, createdAt, createdAt]
    )
  }

  private validateListOptions(options: TodoListOptions): void {
    if (options.done !== undefined && typeof options.done !== 'boolean') {
      throw new ModelValidationError('Todo done filter must be a boolean')
    }
    if (
      options.dueOnOrBefore !== undefined &&
      options.dueOnOrAfter !== undefined &&
      normalizeDate(options.dueOnOrAfter, 'dueOnOrAfter') >
        normalizeDate(options.dueOnOrBefore, 'dueOnOrBefore')
    ) {
      throw new ModelValidationError('Todo due-date filter range is inverted')
    }
  }
}
