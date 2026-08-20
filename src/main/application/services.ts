import type {
  CreateTodoInput,
  DueOverviewSnapshot,
  FocusSnapshot,
  HealthState,
  NoteParent,
  NoteSnapshot,
  RichTextDocumentReference,
  RichTextDocumentSnapshot,
  ReviewOverviewSnapshot,
  TagSummarySnapshot,
  TagUseSnapshot,
  TodoOverviewSnapshot,
  TodoParent,
  TodoSnapshot,
  UpdateScopeCell,
  UpdateSnapshot
} from '../../shared/contracts'
import {
  onMoveRichTextDocumentFromStored,
  onMoveRichTextDocumentToStored,
  patchOnMoveRichTextDocument,
  type OnMoveRichTextMark,
  type OnMoveRichTextDocument
} from '../../shared/rich-text-document'
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

export interface ApplicationEntityReadOptions {
  includeRichText?: boolean
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

export interface ApplicationNoteContext {
  reference: { type: 'note'; id: number }
  uri: string
  contextPath: Array<{ type: 'focus' | 'thread' | 'commitment'; id: number; title: string }>
  effectiveSensitive: boolean
  note: NoteSnapshot & { richText: OnMoveRichTextDocument }
}

export interface CreateApplicationUpdate {
  parent: { type: 'thread' | 'commitment'; id: number }
  subjectId?: number
  date?: string
  document?: OnMoveRichTextDocument
  state?: HealthState
  sensitive?: boolean
}

export interface ApplicationUpdateSnapshot extends UpdateSnapshot {
  /** Lossless editor-neutral form of the plain observation projection. */
  observationRichText: OnMoveRichTextDocument
  /** Optimistic-concurrency token for editing the observation. */
  observationRevision: number
}

export interface ApplicationUpdateContext {
  reference: { type: 'update'; id: number }
  uri: string
  contextPath: Array<{ type: 'focus' | 'thread' | 'commitment'; id: number; title: string }>
  effectiveSensitive: boolean
  update: ApplicationUpdateSnapshot
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

export interface UpdateApplicationNote {
  id: number
  expectedRevision: number
  document: OnMoveRichTextDocument
  /** Explicit acknowledgement that an existing non-empty Note may become empty. */
  clear?: boolean
}

export interface PatchApplicationNoteText {
  id: number
  expectedRevision: number
  findText: string
  replaceText?: string
  occurrence?: number
  addMarks?: OnMoveRichTextMark[]
  removeMarks?: OnMoveRichTextMark[]
  /** Explicit acknowledgement that an existing non-empty Note may become empty. */
  clear?: boolean
}

export type ApplicationRichTextReference =
  | { type: 'focus'; id: number; field: 'description' }
  | { type: 'update'; id: number; field: 'observation' }

export interface UpdateApplicationRichText {
  reference: ApplicationRichTextReference
  expectedRevision: number
  document: OnMoveRichTextDocument
  /** Explicit acknowledgement that existing readable text may become empty. */
  clear?: boolean
}

export interface PatchApplicationRichText {
  reference: ApplicationRichTextReference
  expectedRevision: number
  findText: string
  replaceText?: string
  occurrence?: number
  addMarks?: OnMoveRichTextMark[]
  removeMarks?: OnMoveRichTextMark[]
  /** Explicit acknowledgement that existing readable text may become empty. */
  clear?: boolean
}

export interface PokeApplicationReview {
  target: { type: 'thread' | 'commitment'; id: number }
  subjectId?: number
}

export interface ApplicationEntitySelector {
  id?: number
  title?: string
}

export interface ApplicationSubjectSelector {
  id?: number
  name?: string
}

export interface ResolveApplicationTargetQuery {
  focus?: ApplicationEntitySelector
  thread: ApplicationEntitySelector
  commitment?: ApplicationEntitySelector
  subject?: ApplicationSubjectSelector
}

export interface ResolveApplicationNoteQuery {
  /** Required Focus anchor; use its ID or exact title. */
  focus: ApplicationEntitySelector
  /** Optional direct Thread parent inside the Focus. */
  thread?: ApplicationEntitySelector
  /** Optional direct Commitment parent; requires a Thread selector. */
  commitment?: ApplicationEntitySelector
  /** The Note's own ID or exact title under the resolved parent. */
  note: ApplicationEntitySelector
}

export interface ApplicationNoteResolution {
  status: 'resolved' | 'ambiguous' | 'not_found'
  requested: ResolveApplicationNoteQuery
  candidates: ApplicationNoteContext[]
}

export interface ApplicationResolvedTargetCandidate {
  parent: { type: 'thread' | 'commitment'; id: number }
  hierarchy: {
    focus: { id: number; title: string }
    thread: { id: number; title: string }
    commitment: { id: number; title: string } | null
  }
  subject: { id: number; name: string } | null
  allowedSubjects: Array<{ id: number; name: string }>
}

export interface ApplicationTargetResolution {
  status: 'resolved' | 'ambiguous' | 'not_found'
  requested: ResolveApplicationTargetQuery
  candidates: ApplicationResolvedTargetCandidate[]
  /** Parent matches before applying an optional Subject selector, for safe recovery hints. */
  parentCandidates: ApplicationResolvedTargetCandidate[]
}

export type ScopeTargetIssueCode =
  | 'open_parent_cannot_target_subject'
  | 'empty_scope_cannot_target_subject'
  | 'scoped_parent_requires_subject'
  | 'subject_not_applicable'
  | 'open_parent_cannot_share_across_subjects'
  | 'empty_scope_cannot_share_across_subjects'

export interface ScopeTargetIssue {
  code: ScopeTargetIssueCode
  parent: { type: 'thread' | 'commitment'; id: number }
  subjectId: number | null
  effectiveScopeId: number | null
}

/** A typed, recoverable attribution failure for MCP write targets. */
export class ScopeTargetValidationError extends ModelValidationError {
  constructor(message: string, readonly issue: ScopeTargetIssue) {
    super(message)
    this.name = 'ScopeTargetValidationError'
  }
}

export interface NoteRevisionConflictIssue {
  noteId: number
  expectedRevision: number
  currentRevision: number
  parent: NoteParent
}

/** A recoverable optimistic-concurrency failure for live Note editing. */
export class NoteRevisionConflictError extends ModelValidationError {
  constructor(message: string, readonly issue: NoteRevisionConflictIssue) {
    super(message)
    this.name = 'NoteRevisionConflictError'
  }
}

export interface NoteTextDisappearedIssue {
  code: 'NOTE_TEXT_DISAPPEARED'
  noteId: number
  previousRevision: number
}

/** Protects a populated Note from an accidentally structure-only replacement. */
export class NoteTextDisappearedError extends ModelValidationError {
  constructor(message: string, readonly issue: NoteTextDisappearedIssue) {
    super(message)
    this.name = 'NoteTextDisappearedError'
  }
}

export interface RichTextRevisionConflictIssue {
  reference: ApplicationRichTextReference
  expectedRevision: number
  currentRevision: number
}

/** A recoverable optimistic-concurrency failure for a non-Note rich-text field. */
export class RichTextRevisionConflictError extends ModelValidationError {
  constructor(message: string, readonly issue: RichTextRevisionConflictIssue) {
    super(message)
    this.name = 'RichTextRevisionConflictError'
  }
}

export interface RichTextDisappearedIssue {
  code: 'RICH_TEXT_DISAPPEARED'
  reference: ApplicationRichTextReference
  previousRevision: number
}

/** Protects a populated rich-text field from an accidental structure-only replacement. */
export class RichTextDisappearedError extends ModelValidationError {
  constructor(message: string, readonly issue: RichTextDisappearedIssue) {
    super(message)
    this.name = 'RichTextDisappearedError'
  }
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

function updateProjection(
  update: UpdateSnapshot,
  document: RichTextDocumentSnapshot
): ApplicationUpdateSnapshot {
  return {
    ...plainProjection(update) as UpdateSnapshot,
    observationRichText: onMoveRichTextDocumentFromStored(document.value),
    observationRevision: document.revision
  }
}

function normalizedLookup(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase()
}

function assertEntitySelector(
  selector: ApplicationEntitySelector,
  label: string
): void {
  if (selector.id === undefined && selector.title === undefined) {
    throw new ModelValidationError(`${label} selector requires an id or title`)
  }
  if (selector.id !== undefined) assertPositiveId(selector.id, `${label} id`)
  if (selector.title !== undefined && normalizedLookup(selector.title).length === 0) {
    throw new ModelValidationError(`${label} title cannot be empty`)
  }
}

function assertSubjectSelector(selector: ApplicationSubjectSelector): void {
  if (selector.id === undefined && selector.name === undefined) {
    throw new ModelValidationError('subject selector requires an id or name')
  }
  if (selector.id !== undefined) assertPositiveId(selector.id, 'subject id')
  if (selector.name !== undefined && normalizedLookup(selector.name).length === 0) {
    throw new ModelValidationError('subject name cannot be empty')
  }
}

function matchesEntitySelector(
  record: { id: number; title: string },
  selector: ApplicationEntitySelector
): boolean {
  return (selector.id === undefined || record.id === selector.id) &&
    (selector.title === undefined ||
      normalizedLookup(record.title) === normalizedLookup(selector.title))
}

function matchesSubjectSelector(
  record: { id: number; name: string },
  selector: ApplicationSubjectSelector
): boolean {
  return (selector.id === undefined || record.id === selector.id) &&
    (selector.name === undefined ||
      normalizedLookup(record.name) === normalizedLookup(selector.name))
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

  getFocus(
    id: number,
    access: OnMoveAccessPolicy,
    options: ApplicationEntityReadOptions = {}
  ): ApplicationEntityContext | null {
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
    const description = options.includeRichText === true
      ? this.domain.richTextDocuments.get({ type: 'focus', id, field: 'description' })
      : null
    return {
      reference: { type: 'focus', id },
      uri: uri({ type: 'focus', id }),
      contextPath: [{ type: 'focus', id, title: focus.title }],
      effectiveSensitive: Boolean(this.sensitivity.isSensitive('focus', id)),
      entity: {
        ...plainProjection(focus) as FocusSnapshot,
        ...(description
          ? {
              descriptionRichText: onMoveRichTextDocumentFromStored(description.value),
              descriptionRevision: description.revision
            }
          : {})
      },
      scope: plainProjection(visibleScope),
      updates: [],
      todos: [],
      notes: this.visibleNotes({ type: 'focus', id }, access, options.includeRichText === true),
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

  getUpdate(id: number, access: OnMoveAccessPolicy): ApplicationUpdateContext | null {
    assertPositiveId(id, 'update id')
    const update = this.domain.updates.find(id)
    if (!update || !this.sensitivity.canRead('update', id, access)) return null
    const contextPath: ApplicationUpdateContext['contextPath'] = []
    if (update.parent.type === 'focus') {
      const focus = this.domain.focuses.find(update.parent.id)
      if (!focus) return null
      contextPath.push({ type: 'focus', id: focus.id, title: focus.title })
    } else if (update.parent.type === 'thread') {
      const thread = this.domain.threads.find(update.parent.id)
      const focus = thread ? this.domain.focuses.find(thread.focusId) : null
      if (!thread || !focus) return null
      contextPath.push(
        { type: 'focus', id: focus.id, title: focus.title },
        { type: 'thread', id: thread.id, title: thread.title }
      )
    } else {
      const commitment = this.domain.commitments.find(update.parent.id)
      if (!commitment) return null
      if (commitment.parent.type === 'focus') {
        const focus = this.domain.focuses.find(commitment.parent.id)
        if (!focus) return null
        contextPath.push(
          { type: 'focus', id: focus.id, title: focus.title },
          { type: 'commitment', id: commitment.id, title: commitment.title }
        )
      } else {
        const thread = this.domain.threads.find(commitment.parent.id)
        const focus = thread ? this.domain.focuses.find(thread.focusId) : null
        if (!thread || !focus) return null
        contextPath.push(
          { type: 'focus', id: focus.id, title: focus.title },
          { type: 'thread', id: thread.id, title: thread.title },
          { type: 'commitment', id: commitment.id, title: commitment.title }
        )
      }
    }
    const document = this.domain.richTextDocuments.get({
      type: 'update', id, field: 'observation'
    })
    return {
      reference: { type: 'update', id },
      uri: `onmove://update/${id}`,
      contextPath,
      effectiveSensitive: Boolean(this.sensitivity.isSensitive('update', id)),
      update: updateProjection(update, document)
    }
  }

  getNote(id: number, access: OnMoveAccessPolicy): ApplicationNoteContext | null {
    assertPositiveId(id, 'note id')
    const note = this.domain.notes.find(id)
    if (!note || !this.sensitivity.canRead('note', id, access)) return null
    const contextPath: ApplicationNoteContext['contextPath'] = []
    if (note.parent.type === 'focus') {
      const focus = this.domain.focuses.find(note.parent.id)
      if (!focus) return null
      contextPath.push({ type: 'focus', id: focus.id, title: focus.title })
    } else if (note.parent.type === 'thread') {
      const thread = this.domain.threads.find(note.parent.id)
      const focus = thread ? this.domain.focuses.find(thread.focusId) : null
      if (!thread || !focus) return null
      contextPath.push(
        { type: 'focus', id: focus.id, title: focus.title },
        { type: 'thread', id: thread.id, title: thread.title }
      )
    } else {
      const commitment = this.domain.commitments.find(note.parent.id)
      if (!commitment) return null
      if (commitment.parent.type === 'focus') {
        const focus = this.domain.focuses.find(commitment.parent.id)
        if (!focus) return null
        contextPath.push(
          { type: 'focus', id: focus.id, title: focus.title },
          { type: 'commitment', id: commitment.id, title: commitment.title }
        )
      } else {
        const thread = this.domain.threads.find(commitment.parent.id)
        const focus = thread ? this.domain.focuses.find(thread.focusId) : null
        if (!thread || !focus) return null
        contextPath.push(
          { type: 'focus', id: focus.id, title: focus.title },
          { type: 'thread', id: thread.id, title: thread.title },
          { type: 'commitment', id: commitment.id, title: commitment.title }
        )
      }
    }
    return {
      reference: { type: 'note', id },
      uri: `onmove://note/${id}`,
      contextPath,
      effectiveSensitive: Boolean(this.sensitivity.isSensitive('note', id)),
      note: {
        ...plainProjection(note) as NoteSnapshot,
        richText: onMoveRichTextDocumentFromStored(note.content)
      }
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

  /**
   * Resolves a write target in hierarchy order instead of treating names as
   * unrelated global search terms. Exact names are case-insensitive and IDs
   * can be supplied at any level to disambiguate duplicates.
   */
  resolveTarget(
    query: ResolveApplicationTargetQuery,
    access: OnMoveAccessPolicy
  ): ApplicationTargetResolution {
    if (!query || typeof query !== 'object') {
      throw new ModelValidationError('target query is required')
    }
    assertEntitySelector(query.thread, 'thread')
    if (query.focus) assertEntitySelector(query.focus, 'focus')
    if (query.commitment) assertEntitySelector(query.commitment, 'commitment')
    if (query.subject) assertSubjectSelector(query.subject)

    const focuses = this.domain.focuses.list()
      .filter((focus) => this.sensitivity.canRead('focus', focus.id, access))
      .filter((focus) => !query.focus || matchesEntitySelector(focus, query.focus))
    const parents: ApplicationResolvedTargetCandidate[] = []
    for (const focus of focuses) {
      const threads = this.domain.threads.listForFocus(focus.id)
        .filter((thread) => this.sensitivity.canRead('thread', thread.id, access))
        .filter((thread) => matchesEntitySelector(thread, query.thread))
      for (const thread of threads) {
        const targets = query.commitment
          ? this.domain.commitments.listForThread(thread.id)
              .filter(trackingCommitment)
              .filter((commitment) =>
                this.sensitivity.canRead('commitment', commitment.id, access))
              .filter((commitment) =>
                matchesEntitySelector(commitment, query.commitment as ApplicationEntitySelector))
              .map((commitment) => ({
                parent: { type: 'commitment' as const, id: commitment.id },
                commitment: { id: commitment.id, title: commitment.title },
                subjects: this.domain.commitments.scopeMatrix(commitment.id)
                  .map(({ subject }) => subject)
              }))
          : [{
              parent: { type: 'thread' as const, id: thread.id },
              commitment: null,
              subjects: this.domain.threadScopes.get(thread.id).subjects
            }]
        for (const target of targets) {
          const allowedSubjects = [...new Map(target.subjects
            .filter((subject) => this.sensitivity.canRead('subject', subject.id, access))
            .map((subject) => [subject.id, { id: subject.id, name: subject.name }] as const))
            .values()]
          parents.push({
            parent: target.parent,
            hierarchy: {
              focus: { id: focus.id, title: focus.title },
              thread: { id: thread.id, title: thread.title },
              commitment: target.commitment
            },
            subject: null,
            allowedSubjects
          })
        }
      }
    }

    const candidates = query.subject
      ? parents.flatMap((candidate) => candidate.allowedSubjects
          .filter((subject) => matchesSubjectSelector(subject, query.subject as ApplicationSubjectSelector))
          .map((subject) => ({ ...candidate, subject })))
      : parents
    return {
      status: candidates.length === 1
        ? 'resolved'
        : candidates.length === 0 ? 'not_found' : 'ambiguous',
      requested: query,
      candidates,
      parentCandidates: parents
    }
  }

  /**
   * Resolves a directly owned Note through an exact hierarchy path. The
   * deepest selector identifies the owning parent; descendants are never
   * searched implicitly.
   */
  resolveNote(
    query: ResolveApplicationNoteQuery,
    access: OnMoveAccessPolicy
  ): ApplicationNoteResolution {
    if (!query || typeof query !== 'object') {
      throw new ModelValidationError('Note resolution query is required')
    }
    assertEntitySelector(query.focus, 'focus')
    assertEntitySelector(query.note, 'note')
    if (query.thread) assertEntitySelector(query.thread, 'thread')
    if (query.commitment) {
      if (!query.thread) {
        throw new ModelValidationError(
          'A Commitment Note selector requires its parent Thread selector.'
        )
      }
      assertEntitySelector(query.commitment, 'commitment')
    }

    const parents: NoteParent[] = []
    const focuses = this.domain.focuses.list()
      .filter((focus) => this.sensitivity.canRead('focus', focus.id, access))
      .filter((focus) => matchesEntitySelector(focus, query.focus))
    for (const focus of focuses) {
      if (!query.thread) {
        parents.push({ type: 'focus', id: focus.id })
        continue
      }
      const threads = this.domain.threads.listForFocus(focus.id)
        .filter((thread) => this.sensitivity.canRead('thread', thread.id, access))
        .filter((thread) => matchesEntitySelector(thread, query.thread as ApplicationEntitySelector))
      for (const thread of threads) {
        if (!query.commitment) {
          parents.push({ type: 'thread', id: thread.id })
          continue
        }
        const commitments = this.domain.commitments.listForThread(thread.id)
          .filter(trackingCommitment)
          .filter((commitment) =>
            this.sensitivity.canRead('commitment', commitment.id, access))
          .filter((commitment) => matchesEntitySelector(
            commitment,
            query.commitment as ApplicationEntitySelector
          ))
        parents.push(...commitments.map((commitment) => ({
          type: 'commitment' as const,
          id: commitment.id
        })))
      }
    }

    const candidates = parents.flatMap((parent) => this.domain.notes.list(parent)
      .filter((note) => this.sensitivity.canRead('note', note.id, access))
      .filter((note) => matchesEntitySelector(note, query.note))
      .flatMap((note) => {
        const context = this.getNote(note.id, access)
        return context ? [context] : []
      }))
    return {
      status: candidates.length === 1
        ? 'resolved'
        : candidates.length === 0 ? 'not_found' : 'ambiguous',
      requested: query,
      candidates
    }
  }

  private visibleUpdates(
    parent: { type: 'thread' | 'commitment'; id: number },
    access: OnMoveAccessPolicy
  ): unknown[] {
    const updates = parent.type === 'thread'
      ? this.domain.updates.listForThread(parent.id)
      : this.domain.updates.listForCommitment(parent.id)
    return updates.filter((update) => this.sensitivity.canRead('update', update.id, access))
      .map((update) => updateProjection(
        update,
        this.domain.richTextDocuments.get({
          type: 'update', id: update.id, field: 'observation'
        })
      ))
  }

  private visibleTodos(parent: TodoParent, access: OnMoveAccessPolicy): unknown[] {
    return this.domain.todos.list(parent)
      .filter((todo) => this.sensitivity.canRead('todo', todo.id, access))
      .map((todo) => plainProjection(todo))
  }

  private visibleNotes(
    parent: { type: 'focus' | 'thread' | 'commitment'; id: number },
    access: OnMoveAccessPolicy,
    includeRichText = false
  ): unknown[] {
    return this.domain.notes.list(parent)
      .filter((note) => this.sensitivity.canRead('note', note.id, access))
      .map((note) => ({
        ...plainProjection(note) as NoteSnapshot,
        ...(includeRichText
          ? { richText: onMoveRichTextDocumentFromStored(note.content) }
          : {})
      }))
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
  ): ApplicationUpdateSnapshot {
    this.assertMutation(access)
    this.assertVisibleParent(input.parent, access)
    if (input.sensitive && access.sensitiveContent === 'deny') {
      throw new ModelValidationError('MCP sensitive-content access is disabled')
    }
    const scope = this.resolveScopeCell(
      input.parent,
      input.subjectId,
      input.date,
      'writeGuide.createUpdate'
    )
    const result = this.database.transaction(() => {
      let observation = ''
      if (input.document !== undefined) {
        try {
          observation = onMoveRichTextDocumentToStored(input.document)
        } catch (error) {
          throw new ModelValidationError(
            `Update rich-text document is invalid: ${error instanceof Error ? error.message : String(error)}`
          )
        }
      }
      const created = this.domain.updates.create({
        parent: input.parent,
        date: input.date,
        observation,
        state: input.state ?? 'none',
        sensitive: input.sensitive ?? false,
        scope
      }).toSnapshot()
      this.audit.record({
        toolName: 'onmove.create_update', entityType: 'update', entityId: created.id,
        category: 'create', clientName,
        affectedSensitive: Boolean(this.sensitivity.isSensitive('update', created.id))
      })
      return updateProjection(created, this.domain.richTextDocuments.get({
        type: 'update', id: created.id, field: 'observation'
      }))
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
    if (input.sharedAcrossSubjects) this.assertSharedScope(input.parent)
    const scope = input.sharedAcrossSubjects
      ? null
      : this.resolveScopeCell(input.parent, input.subjectId, undefined, 'writeGuide.createTodo')
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

  updateRichText(
    input: UpdateApplicationRichText,
    access: OnMoveAccessPolicy,
    clientName?: string
  ): RichTextDocumentSnapshot {
    return this.writeApplicationRichTextDocument(
      input,
      access,
      'onmove.update_rich_text',
      clientName,
      () => input.document
    )
  }

  patchRichText(
    input: PatchApplicationRichText,
    access: OnMoveAccessPolicy,
    clientName?: string
  ): RichTextDocumentSnapshot {
    return this.writeApplicationRichTextDocument(
      input,
      access,
      'onmove.patch_rich_text',
      clientName,
      (current) => patchOnMoveRichTextDocument(current, input).document
    )
  }

  private writeApplicationRichTextDocument(
    input: {
      reference: ApplicationRichTextReference
      expectedRevision: number
      clear?: boolean
    },
    access: OnMoveAccessPolicy,
    toolName: 'onmove.update_rich_text' | 'onmove.patch_rich_text',
    clientName: string | undefined,
    nextDocument: (current: OnMoveRichTextDocument) => OnMoveRichTextDocument
  ): RichTextDocumentSnapshot {
    this.assertMutation(access)
    const { reference } = input
    assertPositiveId(reference.id, `${reference.type} id`)
    const validReference =
      (reference.type === 'focus' && reference.field === 'description') ||
      (reference.type === 'update' && reference.field === 'observation')
    if (!validReference) {
      throw new ModelValidationError(
        'rich-text target must be a Focus description or Update observation'
      )
    }
    if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) {
      throw new ModelValidationError('expected rich-text revision must be a non-negative integer')
    }
    if (!this.sensitivity.canRead(reference.type, reference.id, access)) {
      throw new ModelNotFoundError(
        reference.type === 'focus' ? 'Focus' : 'Update',
        reference.id
      )
    }
    return this.database.transaction(() => {
      const current = this.domain.richTextDocuments.get(reference as RichTextDocumentReference)
      if (current.revision !== input.expectedRevision) {
        throw new RichTextRevisionConflictError(
          `${reference.type === 'focus' ? 'Focus description' : 'Update observation'} ` +
          `${reference.id} changed after revision ${input.expectedRevision}. The current ` +
          `revision is ${current.revision}. Read it again before retrying.`,
          {
            reference: structuredClone(reference),
            expectedRevision: input.expectedRevision,
            currentRevision: current.revision
          }
        )
      }
      const currentDocument = onMoveRichTextDocumentFromStored(current.value)
      const next = nextDocument(currentDocument)
      let stored: string
      try {
        stored = onMoveRichTextDocumentToStored(next)
      } catch (error) {
        throw new ModelValidationError(
          `${reference.type === 'focus' ? 'Focus description' : 'Update observation'} ` +
          `rich-text document is invalid: ${error instanceof Error ? error.message : String(error)}`
        )
      }
      const textDisappeared = richTextPlainText(current.value).trim().length > 0 &&
        richTextPlainText(stored).trim().length === 0
      if (textDisappeared) {
        if (input.clear !== true) {
          throw new RichTextDisappearedError(
            `The ${reference.type === 'focus' ? 'Focus description' : 'Update observation'} ` +
            `${reference.id} contains text, but this change would leave only empty structure or ` +
            'line breaks. Retry with clear=true only when intentionally clearing it.',
            {
              code: 'RICH_TEXT_DISAPPEARED',
              reference: structuredClone(reference),
              previousRevision: current.revision
            }
          )
        }
        stored = ''
      }
      const document = this.domain.richTextDocuments.save(reference, stored)
      this.audit.record({
        toolName,
        entityType: reference.type,
        entityId: reference.id,
        category: 'update',
        clientName,
        affectedSensitive: Boolean(this.sensitivity.isSensitive(reference.type, reference.id))
      })
      return document
    })
  }

  updateNote(
    input: UpdateApplicationNote,
    access: OnMoveAccessPolicy,
    clientName?: string
  ): RichTextDocumentSnapshot {
    return this.writeNoteDocument(
      input,
      access,
      'onmove.update_note',
      clientName,
      () => input.document
    )
  }

  patchNoteText(
    input: PatchApplicationNoteText,
    access: OnMoveAccessPolicy,
    clientName?: string
  ): RichTextDocumentSnapshot {
    return this.writeNoteDocument(
      input,
      access,
      'onmove.patch_note_text',
      clientName,
      (current) => patchOnMoveRichTextDocument(current, input).document
    )
  }

  private writeNoteDocument(
    input: { id: number; expectedRevision: number; clear?: boolean },
    access: OnMoveAccessPolicy,
    toolName: 'onmove.update_note' | 'onmove.patch_note_text',
    clientName: string | undefined,
    nextDocument: (current: OnMoveRichTextDocument) => OnMoveRichTextDocument
  ): RichTextDocumentSnapshot {
    this.assertMutation(access)
    assertPositiveId(input.id, 'note id')
    if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) {
      throw new ModelValidationError('expected Note revision must be a non-negative integer')
    }
    if (!this.sensitivity.canRead('note', input.id, access)) {
      throw new ModelNotFoundError('Note', input.id)
    }
    return this.database.transaction(() => {
      const current = this.domain.notes.find(input.id)
      if (!current) throw new ModelNotFoundError('Note', input.id)
      if (current.revision !== input.expectedRevision) {
        throw new NoteRevisionConflictError(
          `Note ${input.id} changed after revision ${input.expectedRevision}. ` +
          `The current revision is ${current.revision}. Read the Note again before retrying.`,
          {
            noteId: input.id,
            expectedRevision: input.expectedRevision,
            currentRevision: current.revision,
            parent: current.parent
          }
        )
      }
      const currentDocument = onMoveRichTextDocumentFromStored(current.content)
      const next = nextDocument(currentDocument)
      let stored: string
      try {
        stored = onMoveRichTextDocumentToStored(next)
      } catch (error) {
        throw new ModelValidationError(
          `Note rich-text document is invalid: ${error instanceof Error ? error.message : String(error)}`
        )
      }
      const textDisappeared = richTextPlainText(current.content).trim().length > 0 &&
        richTextPlainText(stored).trim().length === 0
      if (textDisappeared) {
        if (input.clear !== true) {
          throw new NoteTextDisappearedError(
            `Note ${input.id} contains text, but this change would leave only empty structure or ` +
            'line breaks. Retry with clear=true only when intentionally clearing the Note.',
            {
              code: 'NOTE_TEXT_DISAPPEARED',
              noteId: input.id,
              previousRevision: current.revision
            }
          )
        }
        stored = ''
      }
      const document = this.domain.richTextDocuments.save({
        type: 'note', id: input.id, field: 'content'
      }, stored)
      this.audit.record({
        toolName, entityType: 'note', entityId: input.id,
        category: 'update', clientName,
        affectedSensitive: Boolean(this.sensitivity.isSensitive('note', input.id))
      })
      return document
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
    on?: string,
    writeGuidePath?: string
  ): UpdateScopeCell | null {
    const application = this.domain.scopeApplications.get(parent)
    const parentName = `${parent.type === 'thread' ? 'Thread' : 'Commitment'} ${parent.id}`
    const inspect = writeGuidePath
      ? ` Call onmove.get_${parent.type} with id ${parent.id} and inspect ${writeGuidePath}.`
      : ''
    if (application.effectiveScopeId === null) {
      if (subjectId !== undefined) {
        throw new ScopeTargetValidationError(
          `${parentName} is Open (unscoped), so it cannot target Subject ${subjectId}. ` +
          'Retry without subjectId (or set subjectId to null) to create an unscoped record.' +
          inspect,
          {
            code: 'open_parent_cannot_target_subject', parent, subjectId,
            effectiveScopeId: null
          }
        )
      }
      return null
    }
    const subjects = this.domain.scopes.effectiveSubjects(application.effectiveScopeId, on)
    if (subjects.length === 0) {
      if (subjectId !== undefined) {
        throw new ScopeTargetValidationError(
          `${parentName}'s Scope currently has no applicable Subjects, so it cannot target ` +
          `Subject ${subjectId}. Retry without subjectId (or set subjectId to null).${inspect}`,
          {
            code: 'empty_scope_cannot_target_subject', parent, subjectId,
            effectiveScopeId: application.effectiveScopeId
          }
        )
      }
      return null
    }
    if (subjectId === undefined) {
      throw new ScopeTargetValidationError(
        `${parentName} is scoped and requires one currently applicable subjectId. ` +
        `${inspect.trim()} Retry with one of its allowed Subject IDs.`,
        {
          code: 'scoped_parent_requires_subject', parent, subjectId: null,
          effectiveScopeId: application.effectiveScopeId
        }
      )
    }
    assertPositiveId(subjectId, 'subject id')
    if (!subjects.some((subject) => subject.id === subjectId)) {
      throw new ScopeTargetValidationError(
        `Subject ${subjectId} is not currently applicable to ${parentName}. ` +
        `${inspect.trim()} Retry with one of its allowed Subject IDs.`,
        {
          code: 'subject_not_applicable', parent, subjectId,
          effectiveScopeId: application.effectiveScopeId
        }
      )
    }
    return { scopeId: application.effectiveScopeId, subjectId }
  }

  private assertSharedScope(parent: { type: 'thread' | 'commitment'; id: number }): void {
    const application = this.domain.scopeApplications.get(parent)
    const parentName = `${parent.type === 'thread' ? 'Thread' : 'Commitment'} ${parent.id}`
    if (application.effectiveScopeId === null) {
      throw new ScopeTargetValidationError(
        `${parentName} is Open (unscoped), so it cannot create a Todo shared across Subjects. ` +
        `Use attribution.mode="unscoped", or inspect writeGuide.createTodo after adding a Scope.`,
        {
          code: 'open_parent_cannot_share_across_subjects', parent, subjectId: null,
          effectiveScopeId: null
        }
      )
    }
    if (this.domain.scopes.effectiveSubjects(application.effectiveScopeId).length === 0) {
      throw new ScopeTargetValidationError(
        `${parentName}'s Scope has no applicable Subjects, so it cannot create a shared Todo. ` +
        'Use attribution.mode="unscoped" until the Scope has Subjects.',
        {
          code: 'empty_scope_cannot_share_across_subjects', parent, subjectId: null,
          effectiveScopeId: application.effectiveScopeId
        }
      )
    }
  }
}
