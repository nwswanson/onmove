import type {
  CreateTodoInput,
  DueOverviewSnapshot,
  FocusSnapshot,
  HealthState,
  ReviewOverviewSnapshot,
  TagSummarySnapshot,
  TagUseSnapshot,
  TodoOverviewSnapshot,
  TodoParent,
  TodoSnapshot,
  UpdateScopeCell,
  UpdateSnapshot
} from '../../shared/contracts'
import { richTextPlainText } from '../../shared/rich-text-value'
import type { DomainStore } from '../data/domain'
import { ModelNotFoundError, ModelValidationError } from '../data/model'
import type { SqliteAdapter } from '../data/sqlite-adapter'
import {
  EffectiveSensitivityRepository,
  type OnMoveAccessPolicy,
  type SensitiveEntityType
} from './access-policy'
import { SearchIndexRepository, type SearchQuery, type SearchResult } from './search-index'

export type ApplicationEntityReference =
  | { type: 'focus'; id: number }
  | { type: 'thread'; id: number }
  | { type: 'commitment'; id: number }
  | { type: 'routine'; id: number }

export interface ListFocusesQuery {
  statuses?: readonly string[]
  limit?: number
  offset?: number
}

export interface ApplicationEntityContext {
  reference: ApplicationEntityReference
  uri: string
  contextPath: Array<{ type: 'focus' | 'thread' | 'commitment' | 'routine'; id: number; title: string }>
  effectiveSensitive: boolean
  entity: unknown
  scope: unknown
  updates: unknown[]
  todos: unknown[]
  notes: unknown[]
  commitments: unknown[]
  routines: unknown[]
  threads: unknown[]
}

export interface CreateApplicationUpdate {
  parent: { type: 'thread' | 'commitment'; id: number }
  subjectId?: number
  date?: string
  observation?: string
  state?: HealthState
  sensitive?: boolean
}

export interface CreateApplicationTodo {
  parent: { type: 'thread' | 'commitment'; id: number }
  subjectId?: number
  sharedAcrossSubjects?: boolean
  name: string
  dueDate?: string | null
}

export interface UpdateApplicationTodo {
  id: number
  name?: string
  dueDate?: string | null
  done?: boolean
}

export interface PokeApplicationReview {
  target: { type: 'thread' | 'commitment'; id: number }
  subjectId?: number
}

interface AuditInput {
  toolName: string
  entityType: string
  entityId: number
  category: string
  clientName?: string
  affectedSensitive: boolean
}

function assertPositiveId(id: number, field: string): void {
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new ModelValidationError(`${field} must be a positive integer`)
  }
}

function boundedPage(limit = 50, offset = 0): { limit: number; offset: number } {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new ModelValidationError('limit must be between 1 and 100')
  }
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 10_000) {
    throw new ModelValidationError('offset must be between 0 and 10000')
  }
  return { limit, offset }
}

function plainProjection(value: unknown, key = ''): unknown {
  if (typeof value === 'string') {
    return ['description', 'observation', 'content', 'note'].includes(key)
      ? richTextPlainText(value)
      : value
  }
  if (Array.isArray(value)) return value.map((entry) => plainProjection(entry))
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value).map(([entryKey, entryValue]) => [
      entryKey,
      plainProjection(entryValue, entryKey)
    ])
  )
}

function uri(reference: ApplicationEntityReference): string {
  return `onmove://${reference.type}/${reference.id}`
}

function trackingCommitment(record: { type: string }): boolean {
  return record.type === 'tracking'
}

export class McpMutationAuditRepository {
  constructor(private readonly database: SqliteAdapter) {}

  record(input: AuditInput, now = new Date()): void {
    this.database.run(
      `INSERT INTO mcp_mutation_audit (
         occurred_at, tool_name, entity_type, entity_id, category,
         client_name, affected_sensitive
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        now.toISOString(), input.toolName, input.entityType, input.entityId,
        input.category, input.clientName ?? null, input.affectedSensitive ? 1 : 0
      ]
    )
  }
}

/** Receiver-neutral read boundary shared by Electron IPC and the MCP adapter. */
export class OnMoveQueryService {
  readonly searchIndex: SearchIndexRepository

  constructor(
    private readonly domain: DomainStore,
    private readonly sensitivity: EffectiveSensitivityRepository,
    database: SqliteAdapter
  ) {
    this.searchIndex = new SearchIndexRepository(database)
  }

  // Electron-facing projections preserve durable rich-text envelopes. MCP
  // methods below adapt the same repositories into model-readable plaintext.
  listFocusSnapshots(): FocusSnapshot[] {
    return this.domain.focuses.list()
  }

  reviewOverview(asOf?: string): ReviewOverviewSnapshot {
    return this.domain.reviews.getOverview(asOf)
  }

  dueOverview(asOf?: string): DueOverviewSnapshot {
    return this.domain.due.getOverview(asOf)
  }

  todoOverview(now = new Date()): TodoOverviewSnapshot {
    return this.domain.todos.overview(now)
  }

  tagSummaries(): TagSummarySnapshot[] {
    return this.domain.tags.list()
  }

  tagUses(name: string): TagUseSnapshot[] {
    return this.domain.tags.uses(name)
  }

  listFocuses(query: ListFocusesQuery, access: OnMoveAccessPolicy): unknown[] {
    const { limit, offset } = boundedPage(query.limit, query.offset)
    const statuses = query.statuses ?? []
    return this.domain.focuses.list()
      .filter((focus) => statuses.length === 0 || statuses.includes(focus.status))
      .filter((focus) => this.sensitivity.canRead('focus', focus.id, access))
      .slice(offset, offset + limit)
      .map((focus) => plainProjection(focus))
  }

  getFocus(id: number, access: OnMoveAccessPolicy): ApplicationEntityContext | null {
    assertPositiveId(id, 'focus id')
    const focus = this.domain.focuses.find(id)
    if (!focus || !this.sensitivity.canRead('focus', id, access)) return null
    const threads = this.domain.threads.listForFocus(id).filter((thread) =>
      this.sensitivity.canRead('thread', thread.id, access))
    const scope = this.domain.focusScopes.get(id)
    const visibleScope = {
      ...scope,
      subjects: scope.subjects.filter((subject) =>
        this.sensitivity.canRead('subject', subject.id, access))
    }
    return {
      reference: { type: 'focus', id },
      uri: uri({ type: 'focus', id }),
      contextPath: [{ type: 'focus', id, title: focus.title }],
      effectiveSensitive: Boolean(this.sensitivity.isSensitive('focus', id)),
      entity: plainProjection(focus),
      scope: plainProjection(visibleScope),
      updates: [],
      todos: [],
      notes: this.visibleNotes({ type: 'focus', id }, access),
      commitments: [],
      routines: [],
      threads: threads.map((thread) => plainProjection(thread))
    }
  }

  getThread(id: number, access: OnMoveAccessPolicy): ApplicationEntityContext | null {
    assertPositiveId(id, 'thread id')
    const thread = this.domain.threads.find(id)
    if (!thread || !this.sensitivity.canRead('thread', id, access)) return null
    const focus = this.domain.focuses.find(thread.focusId)
    if (!focus) return null
    const scope = this.domain.threadScopes.get(id)
    const visibleSubjects = (subjects: typeof scope.subjects): typeof scope.subjects =>
      subjects.filter((subject) => this.sensitivity.canRead('subject', subject.id, access))
    const commitments = this.domain.commitments.listForThread(id)
      .filter((commitment) => this.sensitivity.canRead('commitment', commitment.id, access))
    const routines = this.domain.routines.list()
      .filter((routine) => routine.parent.type === 'thread' && routine.parent.id === id)
      .filter((routine) => this.sensitivity.canRead('routine', routine.id, access))
    return {
      reference: { type: 'thread', id },
      uri: uri({ type: 'thread', id }),
      contextPath: [
        { type: 'focus', id: focus.id, title: focus.title },
        { type: 'thread', id, title: thread.title }
      ],
      effectiveSensitive: Boolean(this.sensitivity.isSensitive('thread', id)),
      entity: plainProjection(thread),
      scope: plainProjection({
        ...scope,
        subjects: visibleSubjects(scope.subjects),
        focusSubjects: visibleSubjects(scope.focusSubjects)
      }),
      updates: this.visibleUpdates({ type: 'thread', id }, access),
      todos: this.visibleTodos({ type: 'thread', id }, access),
      notes: this.visibleNotes({ type: 'thread', id }, access),
      commitments: commitments.map((commitment) => plainProjection(commitment)),
      routines: routines.map((routine) => plainProjection(routine)),
      threads: []
    }
  }

  getCommitment(id: number, access: OnMoveAccessPolicy): ApplicationEntityContext | null {
    assertPositiveId(id, 'commitment id')
    const commitment = this.domain.commitments.find(id)
    if (!commitment || !trackingCommitment(commitment) ||
        !this.sensitivity.canRead('commitment', id, access)) return null
    if (commitment.parent.type !== 'thread') return null
    const thread = this.domain.threads.find(commitment.parent.id)
    const focus = thread ? this.domain.focuses.find(thread.focusId) : null
    if (!thread || !focus) return null
    const cells = this.domain.commitments.scopeMatrix(id).filter((cell) =>
      this.sensitivity.canRead('subject', cell.subjectId, access))
    return {
      reference: { type: 'commitment', id },
      uri: uri({ type: 'commitment', id }),
      contextPath: [
        { type: 'focus', id: focus.id, title: focus.title },
        { type: 'thread', id: thread.id, title: thread.title },
        { type: 'commitment', id, title: commitment.title }
      ],
      effectiveSensitive: Boolean(this.sensitivity.isSensitive('commitment', id)),
      entity: plainProjection(commitment),
      scope: plainProjection({
        scopeId: this.domain.scopeApplications.get({ type: 'commitment', id }).effectiveScopeId,
        cells
      }),
      updates: this.visibleUpdates({ type: 'commitment', id }, access),
      todos: this.visibleTodos({ type: 'commitment', id }, access),
      notes: this.visibleNotes({ type: 'commitment', id }, access),
      commitments: [],
      routines: [],
      threads: []
    }
  }

  getRoutine(id: number, access: OnMoveAccessPolicy): ApplicationEntityContext | null {
    assertPositiveId(id, 'routine id')
    const routine = this.domain.routines.find(id)
    if (!routine || !this.sensitivity.canRead('routine', id, access)) return null
    if (routine.parent.type !== 'thread') return null
    const thread = this.domain.threads.find(routine.parent.id)
    const focus = thread ? this.domain.focuses.find(thread.focusId) : null
    if (!thread || !focus) return null
    const visibleSubject = (subject: { id: number } | null): boolean =>
      subject === null || this.sensitivity.canRead('subject', subject.id, access)
    const projectRun = (run: typeof routine.currentRun) => {
      if (!run) return null
      const cells = run.cells.filter((cell) => visibleSubject(cell.subject))
      return {
        ...run,
        cells,
        items: [],
        progress: {
          complete: cells.reduce((total, cell) => total + cell.progress.complete, 0),
          required: cells.reduce((total, cell) => total + cell.progress.required, 0)
        },
        scope: run.scope
          ? { ...run.scope, subjects: run.scope.subjects.filter(visibleSubject) }
          : null
      }
    }
    const visibleRoutine = {
      ...routine,
      scope: routine.scope
        ? { ...routine.scope, subjects: routine.scope.subjects.filter(visibleSubject) }
        : null,
      currentRun: projectRun(routine.currentRun),
      previousRuns: routine.previousRuns.map(projectRun).filter((run) => run !== null)
    }
    return {
      reference: { type: 'routine', id },
      uri: uri({ type: 'routine', id }),
      contextPath: [
        { type: 'focus', id: focus.id, title: focus.title },
        { type: 'thread', id: thread.id, title: thread.title },
        { type: 'routine', id, title: routine.name }
      ],
      effectiveSensitive: Boolean(this.sensitivity.isSensitive('routine', id)),
      entity: plainProjection(visibleRoutine),
      scope: plainProjection(visibleRoutine.scope),
      updates: [], todos: [], notes: [], commitments: [], routines: [], threads: []
    }
  }

  listRoutines(access: OnMoveAccessPolicy, limit = 50, offset = 0): unknown[] {
    const page = boundedPage(limit, offset)
    return this.domain.routines.list()
      .filter((routine) => this.sensitivity.canRead('routine', routine.id, access))
      .slice(page.offset, page.offset + page.limit)
      .map((routine) => this.getRoutine(routine.id, access))
      .filter((routine) => routine !== null)
  }

  getReviews(access: OnMoveAccessPolicy, asOf?: string): unknown {
    const overview = this.domain.reviews.getOverview(asOf)
    return plainProjection({
      ...overview,
      items: overview.items.flatMap((item) => {
        const type = item.kind as 'thread' | 'commitment'
        const id = item.commitment?.id ?? item.thread?.id
        if (!id || !this.sensitivity.canRead(type, id, access)) return []
        if (item.cell && !this.sensitivity.canRead('subject', item.cell.subjectId, access)) return []
        return [{
          ...item,
          updates: item.updates.filter((update) =>
            this.sensitivity.canRead('update', update.id, access)),
          commitments: item.commitments.filter((commitment) =>
            this.sensitivity.canRead('commitment', commitment.id, access))
        }]
      })
    })
  }

  getDue(access: OnMoveAccessPolicy, asOf?: string): unknown {
    const overview = this.domain.due.getOverview(asOf)
    return plainProjection({
      ...overview,
      items: overview.items.filter((item) =>
        this.sensitivity.canRead(
          item.kind as SensitiveEntityType,
          Number(item.key.split(':').at(-1)),
          access
        ))
    })
  }

  getTodos(access: OnMoveAccessPolicy, now = new Date()): TodoOverviewSnapshot {
    const overview = this.todoOverview(now)
    return {
      ...overview,
      items: overview.items.filter((todo) => this.sensitivity.canRead('todo', todo.id, access))
    }
  }

  listTags(access: OnMoveAccessPolicy): unknown[] {
    return this.domain.tags.list().flatMap((tag) => {
      const uses = this.domain.tags.uses(tag.name).filter((use) =>
        access.sensitiveContent === 'allow' || !use.effectiveSensitive)
      return uses.length === 0 ? [] : [{ name: tag.name, useCount: uses.length }]
    })
  }

  getTagUses(name: string, access: OnMoveAccessPolicy, limit = 50, offset = 0): unknown[] {
    const page = boundedPage(limit, offset)
    return plainProjection(this.domain.tags.uses(name)
      .filter((use) => access.sensitiveContent === 'allow' || !use.effectiveSensitive)
      .slice(page.offset, page.offset + page.limit)) as unknown[]
  }

  search(query: SearchQuery, access: OnMoveAccessPolicy): SearchResult[] {
    return this.searchIndex.search(query, access)
  }

  private visibleUpdates(
    parent: { type: 'thread' | 'commitment'; id: number },
    access: OnMoveAccessPolicy
  ): unknown[] {
    const updates = parent.type === 'thread'
      ? this.domain.updates.listForThread(parent.id)
      : this.domain.updates.listForCommitment(parent.id)
    return updates.filter((update) => this.sensitivity.canRead('update', update.id, access))
      .map((update) => plainProjection(update))
  }

  private visibleTodos(parent: TodoParent, access: OnMoveAccessPolicy): unknown[] {
    return this.domain.todos.list(parent)
      .filter((todo) => this.sensitivity.canRead('todo', todo.id, access))
      .map((todo) => plainProjection(todo))
  }

  private visibleNotes(
    parent: { type: 'focus' | 'thread' | 'commitment'; id: number },
    access: OnMoveAccessPolicy
  ): unknown[] {
    return this.domain.notes.list(parent)
      .filter((note) => this.sensitivity.canRead('note', note.id, access))
      .map((note) => plainProjection(note))
  }
}

/** Validated, audit-producing write boundary used by MCP tools. */
export class OnMoveCommandService {
  constructor(
    private readonly database: SqliteAdapter,
    private readonly domain: DomainStore,
    private readonly sensitivity: EffectiveSensitivityRepository,
    private readonly audit: McpMutationAuditRepository
  ) {}

  createUpdate(
    input: CreateApplicationUpdate,
    access: OnMoveAccessPolicy,
    clientName?: string
  ): UpdateSnapshot {
    this.assertMutation(access)
    this.assertVisibleParent(input.parent, access)
    if (input.sensitive && access.sensitiveContent === 'deny') {
      throw new ModelValidationError('MCP sensitive-content access is disabled')
    }
    const scope = this.resolveScopeCell(input.parent, input.subjectId, input.date)
    const result = this.database.transaction(() => {
      const created = this.domain.updates.create({
        parent: input.parent,
        date: input.date,
        observation: input.observation ?? '',
        state: input.state ?? 'none',
        sensitive: input.sensitive ?? false,
        scope
      }).toSnapshot()
      this.audit.record({
        toolName: 'onmove.create_update', entityType: 'update', entityId: created.id,
        category: 'create', clientName,
        affectedSensitive: Boolean(this.sensitivity.isSensitive('update', created.id))
      })
      return created
    })
    return result
  }

  createTodo(
    input: CreateApplicationTodo,
    access: OnMoveAccessPolicy,
    clientName?: string
  ): TodoSnapshot {
    this.assertMutation(access)
    this.assertVisibleParent(input.parent, access)
    if (input.subjectId !== undefined && input.sharedAcrossSubjects) {
      throw new ModelValidationError('a Todo cannot be both shared and assigned to one Subject')
    }
    const scope = input.sharedAcrossSubjects
      ? null
      : this.resolveScopeCell(input.parent, input.subjectId)
    const parent: CreateTodoInput['parent'] = scope
      ? { type: `${input.parent.type}-scope`, id: input.parent.id, scope }
      : input.parent
    return this.database.transaction(() => {
      const created = this.domain.todos.create({
        parent,
        name: input.name,
        dueDate: input.dueDate,
        sharedAcrossSubjects: input.sharedAcrossSubjects
      }).toSnapshot()
      this.audit.record({
        toolName: 'onmove.create_todo', entityType: 'todo', entityId: created.id,
        category: 'create', clientName,
        affectedSensitive: Boolean(this.sensitivity.isSensitive('todo', created.id))
      })
      return created
    })
  }

  updateTodo(
    input: UpdateApplicationTodo,
    access: OnMoveAccessPolicy,
    toolName = 'onmove.update_todo',
    clientName?: string
  ): TodoSnapshot {
    this.assertMutation(access)
    if (!this.sensitivity.canRead('todo', input.id, access)) throw new ModelNotFoundError('Todo', input.id)
    return this.database.transaction(() => {
      const updated = this.domain.todos.requireModel(input.id).update({
        name: input.name,
        dueDate: input.dueDate,
        done: input.done
      }).toSnapshot()
      this.audit.record({
        toolName, entityType: 'todo', entityId: updated.id,
        category: input.done === true ? 'complete' : 'update', clientName,
        affectedSensitive: Boolean(this.sensitivity.isSensitive('todo', updated.id))
      })
      return updated
    })
  }

  pokeReview(
    input: PokeApplicationReview,
    access: OnMoveAccessPolicy,
    clientName?: string
  ): unknown {
    this.assertMutation(access)
    this.assertVisibleParent(input.target, access)
    const cell = this.resolveScopeCell(input.target, input.subjectId)
    return this.database.transaction(() => {
      const result = input.target.type === 'thread'
        ? this.domain.threads.pokeReview(input.target.id, new Date(), cell ?? undefined)
        : this.domain.commitments.pokeReview(input.target.id, new Date(), cell ?? undefined)
      this.audit.record({
        toolName: 'onmove.poke_review', entityType: input.target.type,
        entityId: input.target.id, category: 'review', clientName,
        affectedSensitive: Boolean(this.sensitivity.isSensitive(input.target.type, input.target.id))
      })
      return plainProjection(result)
    })
  }

  private assertMutation(access: OnMoveAccessPolicy): void {
    if (access.mutations !== 'allow') {
      throw new ModelValidationError('MCP mutations are disabled in OnMove settings')
    }
  }

  private assertVisibleParent(
    parent: { type: 'thread' | 'commitment'; id: number },
    access: OnMoveAccessPolicy
  ): void {
    assertPositiveId(parent.id, `${parent.type} id`)
    if (!this.sensitivity.canRead(parent.type, parent.id, access)) {
      throw new ModelNotFoundError(parent.type, parent.id)
    }
  }

  private resolveScopeCell(
    parent: { type: 'thread' | 'commitment'; id: number },
    subjectId?: number,
    on?: string
  ): UpdateScopeCell | null {
    const application = this.domain.scopeApplications.get(parent)
    if (application.effectiveScopeId === null) {
      if (subjectId !== undefined) {
        throw new ModelValidationError('an Open parent cannot target a Subject')
      }
      return null
    }
    const subjects = this.domain.scopes.effectiveSubjects(application.effectiveScopeId, on)
    if (subjects.length === 0) {
      if (subjectId !== undefined) {
        throw new ModelValidationError('this parent has no applicable Subjects')
      }
      return null
    }
    if (subjectId === undefined) {
      throw new ModelValidationError('a scoped parent requires a currently applicable Subject')
    }
    assertPositiveId(subjectId, 'subject id')
    if (!subjects.some((subject) => subject.id === subjectId)) {
      throw new ModelValidationError('the Subject is not currently applicable to this parent')
    }
    return { scopeId: application.effectiveScopeId, subjectId }
  }
}
