import type {
  CreateTodoInput,
  TodoEntityParent,
  TodoListOptions,
  TodoParent,
  TodoSnapshot,
  TodoSortPlacementSnapshot,
  UpdateScopeCell,
  UpdateTodoInput
} from '../../shared/contracts'
import { BaseModel, BaseRepository, ModelNotFoundError, ModelValidationError } from './model'
import { ScopeApplicationRepository, ScopeRepository } from './scope-model'
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
  created_at: string
  updated_at: string
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

  constructor(private readonly database: SqliteAdapter) {
    super()
    this.applications = new ScopeApplicationRepository(database)
    this.scopes = new ScopeRepository(database)
  }

  protected instantiate(record: TodoRecord): TodoModel {
    return new TodoModel(this, record)
  }

  create(input: CreateTodoInput, now = new Date()): TodoModel {
    const name = normalizeName(input.name)
    const dueDate = normalizeOptionalDate(input.dueDate, 'Todo due date')
    const done = normalizeDone(input.done)
    const columns = this.validateParent(input.parent, now)
    const createdAt = timestamp(now)

    const id = this.database.transaction(() => {
      const result = this.database.run(
        `INSERT INTO todos (
           focus_id, thread_id, commitment_id, scope_id, subject_id,
           name, due_on, done, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          columns.focusId,
          columns.threadId,
          columns.commitmentId,
          columns.scopeId,
          columns.subjectId,
          name,
          dueDate,
          done ? 1 : 0,
          createdAt,
          createdAt
        ]
      )

      const aggregate = entityParent(input.parent)
      this.addPlacement(result.lastInsertRowid, this.ensureList(aggregate, now), now)
      if (scopeCell(input.parent)) {
        this.addPlacement(result.lastInsertRowid, this.ensureList(input.parent, now), now)
      }
      return result.lastInsertRowid
    })

    return this.requireModel(id)
  }

  find(id: number): TodoSnapshot | null {
    assertId(id, 'Todo id')
    const row = this.database.get<TodoRow>(
      `SELECT id, focus_id, thread_id, commitment_id, scope_id, subject_id,
              name, due_on, done, created_at, updated_at
       FROM todos WHERE id = ?`,
      [id]
    )
    return row ? this.snapshotFromRow(row) : null
  }

  list(context: TodoParent, options: TodoListOptions = {}): TodoSnapshot[] {
    this.validateListOptions(options)
    this.assertContextReferences(context)
    const list = this.findList(context)
    if (!list) return []

    const clauses = ['placement.list_id = ?']
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
              todo.done, todo.created_at, todo.updated_at
       FROM todo_sort_placements placement
       JOIN todos todo ON todo.id = placement.todo_id
       WHERE ${clauses.join(' AND ')}
       ORDER BY placement.sort_key, todo.id`,
      parameters
    ).map((row) => this.snapshotFromRow(row))
  }

  update(id: number, input: UpdateTodoInput): TodoSnapshot {
    const current = this.find(id)
    if (!current) throw new ModelNotFoundError('Todo', id)
    const name = input.name === undefined ? current.name : normalizeName(input.name)
    const dueDate = input.dueDate === undefined
      ? current.dueDate
      : normalizeOptionalDate(input.dueDate, 'Todo due date')
    const done = input.done === undefined ? current.done : normalizeDone(input.done)
    this.database.run(
      `UPDATE todos SET name = ?, due_on = ?, done = ?, updated_at = ? WHERE id = ?`,
      [name, dueDate, done ? 1 : 0, timestamp(), id]
    )
    return this.find(id) as TodoSnapshot
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
    return this.list(context)
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
      dueDate: row.due_on,
      done: Boolean(row.done),
      sort: this.sortPlacements(Number(row.id)),
      createdAt: row.created_at,
      updatedAt: row.updated_at
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

  private validateParent(parent: TodoParent, now: Date): ParentColumns {
    this.assertContextShape(parent)
    const entity = entityParent(parent)
    const focusId = this.requireEntityParent(entity)
    const scope = scopeCell(parent)
    if (!scope) return parentColumns(parent)

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
