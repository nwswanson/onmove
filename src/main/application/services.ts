import type {
  CreateFocusInput,
  CreateRoutineInput,
  CreateThreadInput,
  CreateTrackingCommitmentInput,
  CreateTodoInput,
  DueOverviewSnapshot,
  FocusSnapshot,
  HealthState,
  McpRetrievalMode,
  MoveThreadInput,
  NoteParent,
  NoteSnapshot,
  RichTextDocumentReference,
  RichTextDocumentSnapshot,
  ReviewOverviewSnapshot,
  ScopeSnapshot,
  SubjectSnapshot,
  TagSummarySnapshot,
  TagUseSnapshot,
  ThreadMovePlanSnapshot,
  ThreadSnapshot,
  TodoOverviewSnapshot,
  TodoParent,
  TodoSnapshot,
  UpdateCommitmentInput,
  UpdateFocusInput,
  UpdateRoutineInput,
  UpdateThreadInput,
  UpdateScopeCell,
  UpdateSnapshot
} from '../../shared/contracts'
import {
  onMoveRichTextDocumentFromStored,
  onMoveRichTextDocumentToMarkdown,
  onMoveRichTextDocumentToStored,
  patchOnMoveRichTextDocument,
  type OnMoveRichTextMark,
  type OnMoveRichTextDocument
} from '../../shared/rich-text-document'
import { richTextPlainText, serializedRichTextEditorState } from '../../shared/rich-text-value'
import type { DomainStore } from '../data/domain'
import { ModelNotFoundError, ModelValidationError } from '../data/model'
import type { SqliteAdapter } from '../data/sqlite-adapter'
import { UPDATE_ARCHIVE_RETENTION_DAYS } from '../data/update-archive'
import {
  EffectiveSensitivityRepository,
  type OnMoveAccessPolicy,
  type SensitiveEntityType
} from './access-policy'
import {
  deriveSearchLifecycleClosure,
  SearchIndexRepository,
  SEARCH_TERMINAL_STATUSES,
  type SearchPage,
  type SearchLifecycleMode,
  type SearchLifecycleQuery,
  type SearchLifecycleStatus,
  type SearchResultLifecycle,
  type SearchTerminalStatus,
  type SearchQuery,
  type SearchResult
} from './search-index'
import {
  UniversalSentenceEncoderEmbeddingProvider,
  type EmbeddingProvider
} from './embedding-provider'
import { RetrievalProjectionRepository } from './retrieval-projection'
import {
  RetrievalContextNotVisibleError,
  RetrievalService,
  type RetrievalPage,
  type RetrievalRequest
} from './retrieval-service'

export type ApplicationEntityReference =
  | { type: 'focus'; id: number }
  | { type: 'thread'; id: number }
  | { type: 'commitment'; id: number }
  | { type: 'routine'; id: number }

export type ApplicationDeletableEntityReference =
  | ApplicationEntityReference
  | { type: 'update'; id: number }
  | { type: 'todo'; id: number }
  | { type: 'note'; id: number }
  | { type: 'subject'; id: number }

export interface ApplicationDeleteEntityResult {
  deleted: true
  reference: ApplicationDeletableEntityReference
  /** Static policy signal; never leaks the count of inaccessible descendants. */
  updatesUseArchive: boolean
  archiveRetentionDays: number
  descendantRecordsMayBeDeleted: boolean
}

export interface ListFocusesQuery {
  statuses?: readonly string[]
  includeBreadcrumb?: boolean
  limit?: number
  offset?: number
}

export interface ListHierarchyEntitiesQuery {
  /** Optional owning Focus filter. Omitted means every visible Focus. */
  focusId?: number
  /** Optional owning Thread filter. Valid for Commitments and Routines. */
  threadId?: number
  /** Lifecycle or derived-status filter appropriate to the listed kind. */
  statuses?: readonly string[]
  limit?: number
  offset?: number
}

export type ApplicationListProjection =
  | {
      mode: 'entity' | 'unscoped'
      projectedScope: false
      scope: null
      subject: null
    }
  | {
      mode: 'subject'
      projectedScope: true
      scope: { id: number; name: string; dimension: string; source: string }
      subject: { id: number; name: string }
    }
  | {
      mode: 'empty-scope' | 'scope-hidden'
      projectedScope: true
      scope: { id: number; name: string; dimension: string; source: string } | null
      subject: null
    }

export interface ApplicationCompactListItem {
  /** Unique row identity. Scoped rows repeat the durable entity ID once per Subject. */
  projectionKey: string
  reference: ApplicationEntityReference
  uri: string
  title: string
  displayPath: string
  hierarchy: {
    focus: { id: number; title: string }
    thread: { id: number; title: string } | null
    commitment: { id: number; title: string } | null
    routine: { id: number; title: string } | null
  }
  projection: ApplicationListProjection
  summary: Record<string, unknown>
  breadcrumb?: { text: string; source: 'description'; truncated: boolean }
}

export interface ApplicationCompactListPage {
  items: ApplicationCompactListItem[]
  total: number
  limit: number
  offset: number
  hasMore: boolean
  contentPolicy: {
    childCollectionsIncluded: false
    richTextIncluded: false
    breadcrumbMaximumCharacters: 200
  }
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
  /** Non-fatal projection problems; the readable remainder of the entity is still usable. */
  warnings?: string[]
}

export interface ApplicationNoteContext {
  reference: { type: 'note'; id: number }
  uri: string
  contextPath: Array<{ type: 'focus' | 'thread' | 'commitment'; id: number; title: string }>
  effectiveSensitive: boolean
  note: NoteSnapshot & {
    contentFormat: 'plain-text' | 'markdown'
    richText?: OnMoveRichTextDocument
  }
}

export interface CreateApplicationUpdate {
  parent: { type: 'thread' | 'commitment'; id: number }
  subjectId?: number
  /** Semantic path copied from discovery when the user's wording names a hierarchy destination. */
  semanticPath?: ApplicationSemanticTargetPath
  date?: string
  document?: OnMoveRichTextDocument
  state?: HealthState
  sensitive?: boolean
}

export interface ApplicationSemanticTargetPath {
  focus?: { id: number; title: string }
  thread: { id: number; title: string }
  commitment?: { id: number; title: string }
  subject?: { id: number; name: string }
}

export interface ReparentApplicationUpdate {
  id: number
  parent: { type: 'thread' | 'commitment'; id: number }
  subjectId?: number
  semanticPath?: ApplicationSemanticTargetPath
}

export interface ReparentApplicationUpdateResult {
  update: ApplicationUpdateSnapshot
  previous: {
    parent: { type: 'thread' | 'commitment'; id: number }
    subjectId: number | null
  }
}

export interface ApplicationUpdateSnapshot extends UpdateSnapshot {
  observationFormat: 'plain-text' | 'markdown'
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
  update: ApplicationUpdateSnapshot | (UpdateSnapshot & {
    observationFormat: 'plain-text' | 'markdown'
    observationRevision?: number
  })
  warnings?: string[]
}

export interface ApplicationStandaloneEntityContext {
  reference: { type: 'todo' | 'subject'; id: number }
  uri: string
  effectiveSensitive: boolean
  entity: unknown
}

export interface ApplicationUpdatesResult {
  items: ApplicationUpdateContext[]
  /** Missing and non-visible IDs intentionally share one externally indistinguishable bucket. */
  unavailableIds: number[]
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

export interface CreateApplicationFocus extends CreateFocusInput {
  descriptionRichText?: OnMoveRichTextDocument
}

export type UpdateApplicationFocus = Omit<UpdateFocusInput, 'description'>

export type CreateApplicationThread = CreateThreadInput

export type UpdateApplicationThread = UpdateThreadInput

export interface ApplicationThreadReparentPlan {
  reference: { type: 'thread'; id: number }
  thread: { reference: { type: 'thread'; id: number }; id: number; title: string }
  sourceFocus: { reference: { type: 'focus'; id: number }; id: number; title: string }
  destinationFocus: { reference: { type: 'focus'; id: number }; id: number; title: string }
  plan: Omit<ThreadMovePlanSnapshot, 'ownedRecords'> & {
    ownedRecords: {
      moveWithThread: true
      kinds: readonly ['commitments', 'routines', 'updates', 'todos', 'notes', 'review-evidence']
    }
  }
  status: 'ready' | 'confirmation-required' | 'no-change'
  nextAction: {
    tool: 'onmove.reparent_thread'
    arguments: {
      id: number
      destinationFocusId: number
      plannedFromFocusId: number
      confirmedScopeSubjectIds: number[]
    }
    instruction: string
  }
}

export interface ReparentApplicationThread extends MoveThreadInput {
  id: number
}

export interface ReparentApplicationThreadResult {
  thread: ThreadSnapshot
  previousFocusId: number
  changed: boolean
}

export type CreateApplicationCommitment = CreateTrackingCommitmentInput

export type UpdateApplicationCommitment = UpdateCommitmentInput

export type CreateApplicationRoutine = CreateRoutineInput

export type UpdateApplicationRoutine = UpdateRoutineInput

export interface UpdateApplicationUpdate {
  id: number
  date?: string
  state?: HealthState
  sensitive?: boolean
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

export type ApplicationEntityPathQuery =
  | { type: 'focus'; focusTitle: string }
  | { type: 'thread'; focusTitle?: string; threadTitle: string }
  | {
      type: 'commitment'
      focusTitle?: string
      threadTitle: string
      commitmentTitle: string
    }
  | { type: 'routine'; focusTitle?: string; threadTitle: string; routineTitle: string }

export interface ApplicationEntityPathResolution {
  status: 'resolved' | 'ambiguous' | 'not_found'
  requested: ApplicationEntityPathQuery
  candidates: ApplicationEntityContext[]
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
  /** Safe shorthand suggestions; these never count as an exact resolution. */
  threadCandidates: ApplicationThreadCandidate[]
}

export interface ApplicationThreadCandidate {
  hierarchy: {
    focus: { id: number; title: string }
    thread: { id: number; title: string }
  }
  displayPath: string
  applicableSubjects: Array<{ id: number; name: string }>
}

export interface BrowseApplicationHierarchyQuery {
  /** Null means structural browsing rather than text-match expansion. */
  text: string | null
  focusId?: number | null
  threadId?: number | null
  subjectId?: number | null
  includeThreads?: boolean
  includeCommitments?: boolean
  includeSubjects?: boolean
  includeScopes?: boolean
  /** Omission browses current work. Closed paths must be requested intentionally. */
  lifecycle?: SearchLifecycleQuery
  limit?: number
  offset?: number
}

export interface ApplicationHierarchyPath {
  kind: 'focus' | 'thread' | 'commitment' | 'subject'
  hierarchy: {
    focus: { id: number; title: string }
    thread: { id: number; title: string } | null
    commitment: { id: number; title: string } | null
  }
  subject: { id: number; name: string } | null
  /** Human-readable selector notation. Names are display values; hierarchy above owns the IDs. */
  notation: {
    focus: string
    thread?: string
    commitment?: string
    subject?: string
  }
  displayPath: string
  relativePath: string
  scope?: {
    id: number
    name: string
    dimension: string
    applicationMode: string
  } | null
  /** Lifecycle of this exact path, including terminal owner ancestry. */
  lifecycle: SearchResultLifecycle
  /** Exact typed destination for a safe create_update call, or null when a Subject choice is required. */
  updateTarget: {
    parent: { type: 'thread' | 'commitment'; id: number }
    attribution: { mode: 'unscoped' } | { mode: 'subject'; subjectId: number }
  } | null
}

export interface ApplicationHierarchyBrowseResult {
  paths: ApplicationHierarchyPath[]
  total: number
}

export interface ReviewApplicationSubjectQuery {
  subject: ApplicationSubjectSelector
  thread: ApplicationEntitySelector
  focus?: ApplicationEntitySelector
  limit?: number
}

export interface ApplicationSubjectReviewCandidate {
  subject: { id: number; name: string }
  hierarchy: {
    focus: { id: number; title: string }
    thread: { id: number; title: string }
  }
  displayPath: string
}

export interface ApplicationSubjectReviewResult {
  status: 'resolved' | 'ambiguous' | 'not_found'
  requested: ReviewApplicationSubjectQuery
  candidates: ApplicationSubjectReviewCandidate[]
  /** Safe shorthand suggestions; the caller must retry with one exact returned Thread ID. */
  threadCandidates: ApplicationThreadCandidate[]
  review: null | {
    subject: { id: number; name: string }
    hierarchy: ApplicationSubjectReviewCandidate['hierarchy']
    displayPath: string
    thread: unknown
    updates: unknown[]
    openTodos: unknown[]
    openCommitments: unknown[]
  }
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

export type SemanticTargetIssueCode =
  | 'semantic_path_parent_mismatch'
  | 'semantic_path_requires_subject_attribution'
  | 'semantic_path_subject_mismatch'

export interface SemanticTargetIssue {
  code: SemanticTargetIssueCode
  parent: { type: 'thread' | 'commitment'; id: number }
  subjectId: number | null
  semanticPath: ApplicationSemanticTargetPath
}

/** Prevents a hierarchy-shaped user request from being flattened onto a different or open target. */
export class SemanticTargetValidationError extends ModelValidationError {
  constructor(message: string, readonly issue: SemanticTargetIssue) {
    super(message)
    this.name = 'SemanticTargetValidationError'
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

function normalizedHierarchyLifecycle(query: SearchLifecycleQuery | undefined): {
  mode: SearchLifecycleMode
  terminalStatuses: SearchTerminalStatus[]
} {
  const mode = query?.mode ?? 'current'
  if (!(['current', 'closed', 'all'] as const).includes(mode)) {
    throw new TypeError('hierarchy lifecycle.mode must be current, closed, or all')
  }
  const requested = query?.terminalStatuses ?? SEARCH_TERMINAL_STATUSES
  if (!Array.isArray(requested) || requested.length === 0) {
    throw new TypeError('hierarchy lifecycle.terminalStatuses must contain done or cancelled')
  }
  if (requested.some((status) => !SEARCH_TERMINAL_STATUSES.includes(status))) {
    throw new TypeError(
      'hierarchy lifecycle.terminalStatuses must contain only done or cancelled'
    )
  }
  const selected = new Set(requested)
  return {
    mode,
    terminalStatuses: SEARCH_TERMINAL_STATUSES.filter((status) => selected.has(status))
  }
}

type HierarchyLifecycleOwner = { id: number; status: SearchLifecycleStatus }

function terminalLifecycleStatus(
  status: SearchLifecycleStatus | undefined
): status is SearchTerminalStatus {
  return status === 'done' || status === 'cancelled'
}

function hierarchyPathLifecycle(
  kind: ApplicationHierarchyPath['kind'],
  focus: HierarchyLifecycleOwner,
  thread: HierarchyLifecycleOwner | null,
  commitment: HierarchyLifecycleOwner | null
): SearchResultLifecycle {
  const lineage = {
    focus: { id: focus.id, status: focus.status },
    thread: thread ? { id: thread.id, status: thread.status } : null,
    commitment: commitment ? { id: commitment.id, status: commitment.status } : null
  }
  const statuses = [focus.status, thread?.status, commitment?.status]
  const effective = statuses.some(terminalLifecycleStatus)
    ? 'closed' as const
    : 'current' as const
  const directStatus = kind === 'focus'
    ? focus.status
    : kind === 'thread'
      ? thread?.status ?? null
      : kind === 'commitment'
        ? commitment?.status ?? null
        : null
  const selfLineageType = kind === 'focus' || kind === 'thread' || kind === 'commitment'
    ? kind
    : null
  return {
    directStatus,
    effective,
    lineage,
    closure: deriveSearchLifecycleClosure(directStatus, lineage, selfLineageType)
  }
}

function hierarchyPathSelected(
  lifecycle: SearchResultLifecycle,
  selection: ReturnType<typeof normalizedHierarchyLifecycle>
): boolean {
  const statuses = [
    lifecycle.lineage.focus?.status,
    lifecycle.lineage.thread?.status,
    lifecycle.lineage.commitment?.status
  ]
  const anyTerminal = statuses.some(terminalLifecycleStatus)
  const selectedTerminal = statuses.some((status) =>
    terminalLifecycleStatus(status) && selection.terminalStatuses.includes(status))
  if (selection.mode === 'current') return !anyTerminal
  if (selection.mode === 'closed') return selectedTerminal
  return !anyTerminal || selectedTerminal
}

function plainProjection(value: unknown, key = ''): unknown {
  if (typeof value === 'string') {
    return ['description', 'observation', 'content', 'note'].includes(key)
      ? readableRichText(value).value
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

function readableRichText(value: string): {
  value: string
  format: 'plain-text' | 'markdown'
} {
  if (!serializedRichTextEditorState(value)) return { value, format: 'plain-text' }
  try {
    return {
      value: onMoveRichTextDocumentToMarkdown(onMoveRichTextDocumentFromStored(value)),
      format: 'markdown'
    }
  } catch {
    return { value: richTextPlainText(value), format: 'plain-text' }
  }
}

function compactPlainText(value: string, maximum = 280): string {
  const plain = richTextPlainText(value).replace(/\s+/gu, ' ').trim()
  return plain.length <= maximum ? plain : `${plain.slice(0, maximum - 1).trimEnd()}…`
}

function compactListPage(
  items: ApplicationCompactListItem[],
  query: Pick<ListHierarchyEntitiesQuery, 'limit' | 'offset'>
): ApplicationCompactListPage {
  const { limit, offset } = boundedPage(query.limit, query.offset)
  return {
    items: items.slice(offset, offset + limit),
    total: items.length,
    limit,
    offset,
    hasMore: offset + limit < items.length,
    contentPolicy: {
      childCollectionsIncluded: false,
      richTextIncluded: false,
      breadcrumbMaximumCharacters: 200
    }
  }
}

function descriptionBreadcrumb(
  value: string | null,
  enabled: boolean
): ApplicationCompactListItem['breadcrumb'] | undefined {
  if (!enabled || !value) return undefined
  const complete = richTextPlainText(value).replace(/\s+/gu, ' ').trim()
  if (!complete) return undefined
  return {
    text: compactPlainText(value, 200),
    source: 'description',
    truncated: complete.length > 200
  }
}

function compactListSort(
  left: ApplicationCompactListItem,
  right: ApplicationCompactListItem
): number {
  return left.displayPath.localeCompare(right.displayPath, undefined, { sensitivity: 'base' }) ||
    left.projectionKey.localeCompare(right.projectionKey)
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
  const readable = readableRichText(update.observation)
  return {
    ...update,
    observation: readable.value,
    observationFormat: readable.format,
    observationRichText: onMoveRichTextDocumentFromStored(document.value),
    observationRevision: document.revision
  }
}

function readableUpdateProjection(
  update: UpdateSnapshot,
  observationRevision?: number
): UpdateSnapshot & {
  observationFormat: 'plain-text' | 'markdown'
  observationRevision?: number
} {
  const readable = readableRichText(update.observation)
  return {
    ...update,
    observation: readable.value,
    observationFormat: readable.format,
    ...(observationRevision === undefined ? {} : { observationRevision })
  }
}

function readableNoteProjection(note: NoteSnapshot): NoteSnapshot & {
  contentFormat: 'plain-text' | 'markdown'
} {
  const readable = readableRichText(note.content)
  return { ...note, content: readable.value, contentFormat: readable.format }
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
  if (selector.id !== undefined && selector.title !== undefined) {
    throw new ModelValidationError(
      `${label} selector conflict: provide either id or title, not both. ` +
      'Use the returned ID by itself once discovery has resolved the name.'
    )
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
  if (selector.id !== undefined && selector.name !== undefined) {
    throw new ModelValidationError(
      'subject selector conflict: provide either id or name, not both. ' +
      'Use the returned canonical Subject ID by itself once discovery has resolved the name.'
    )
  }
}

const SHORTHAND_WORDS = new Set(['a', 'an', 'my', 'our', 'the'])

function shorthandTokens(value: string): string[] {
  return value.normalize('NFKC').toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
}

function shorthandThreadScore(requested: string, candidate: string): number {
  const requestedTokens = shorthandTokens(requested)
    .filter((token) => !SHORTHAND_WORDS.has(token))
  const candidateTokens = shorthandTokens(candidate)
  if (requestedTokens.length === 0 || candidateTokens.length === 0) return 0
  const candidateSet = new Set(candidateTokens)
  const matched = requestedTokens.filter((token) => candidateSet.has(token))
  if (matched.length !== requestedTokens.length) return 0
  // Prefer a compact suffix/title match while retaining longer descriptive titles as candidates.
  return (matched.length * 100) - Math.max(0, candidateTokens.length - matched.length)
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
  readonly retrieval: RetrievalService

  constructor(
    private readonly domain: DomainStore,
    private readonly sensitivity: EffectiveSensitivityRepository,
    database: SqliteAdapter,
    embeddingProvider: EmbeddingProvider = new UniversalSentenceEncoderEmbeddingProvider()
  ) {
    this.searchIndex = new SearchIndexRepository(database)
    this.retrieval = new RetrievalService(
      new RetrievalProjectionRepository(database, this.searchIndex),
      database,
      embeddingProvider
    )
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

  listFocuses(query: ListFocusesQuery, access: OnMoveAccessPolicy): ApplicationCompactListPage {
    const statuses = query.statuses ?? []
    const items = this.domain.focuses.list()
      .filter((focus) => statuses.length === 0 || statuses.includes(focus.status))
      .filter((focus) => this.sensitivity.canRead('focus', focus.id, access))
      .map((focus): ApplicationCompactListItem => {
        const reference = { type: 'focus' as const, id: focus.id }
        const breadcrumb = descriptionBreadcrumb(
          focus.description,
          query.includeBreadcrumb !== false
        )
        return {
          projectionKey: `focus:${focus.id}`,
          reference,
          uri: uri(reference),
          title: focus.title,
          displayPath: focus.title,
          hierarchy: {
            focus: { id: focus.id, title: focus.title },
            thread: null,
            commitment: null,
            routine: null
          },
          projection: {
            mode: 'entity', projectedScope: false, scope: null, subject: null
          },
          summary: {
            kind: focus.kind,
            status: focus.status,
            dueDate: focus.dueDate,
            lastReviewDate: focus.lastReviewDate,
            needsReview: focus.needsReview,
            sensitive: focus.sensitive,
            createdAt: focus.createdAt,
            updatedAt: focus.updatedAt
          },
          ...(breadcrumb ? { breadcrumb } : {})
        }
      })
      .sort(compactListSort)
    return compactListPage(items, query)
  }

  listThreads(
    query: ListHierarchyEntitiesQuery,
    access: OnMoveAccessPolicy
  ): ApplicationCompactListPage {
    if (query.focusId !== undefined) assertPositiveId(query.focusId, 'focus id')
    const statuses = query.statuses ?? []
    const items = this.domain.focuses.list().flatMap((focus) => {
      if (query.focusId !== undefined && focus.id !== query.focusId) return []
      if (!this.sensitivity.canRead('focus', focus.id, access)) return []
      return this.domain.threads.listForFocus(focus.id).flatMap((thread) => {
        if (statuses.length > 0 && !statuses.includes(thread.status)) return []
        if (!this.sensitivity.canRead('thread', thread.id, access)) return []
        const scope = this.domain.threadScopes.get(thread.id)
        const scopeRecord = scope.scopeId === null ? null : this.domain.scopes.find(scope.scopeId)
        const visibleScope = this.canListScope(scopeRecord, access, focus.id, thread.id)
        const visibleSubjects = visibleScope
          ? scope.subjects.filter((subject) => this.sensitivity.canReadInContext(
              'subject', subject.id, access, { focusId: focus.id, threadId: thread.id }
            ))
          : []
        const visibleCells = visibleScope
          ? this.domain.threads.scopeMatrix(thread.id).filter((cell) =>
              visibleSubjects.some(({ id }) => id === cell.subjectId))
          : []
        const projections = this.listProjections({
          entityType: 'thread', entityId: thread.id, scopeId: scope.scopeId,
          scopeRecord: visibleScope ? scopeRecord : null,
          source: `thread-effective:${scope.mode}`,
          subjects: visibleSubjects,
          hasHiddenSubjects: scope.subjects.length > visibleSubjects.length,
          scopeHidden: !visibleScope
        })
        return projections.map((projection): ApplicationCompactListItem => {
          const reference = { type: 'thread' as const, id: thread.id }
          const cell = projection.subject === null
            ? null
            : visibleCells.find(({ subjectId }) => subjectId === projection.subject?.id) ?? null
          return {
            projectionKey: this.projectionKey(reference, projection),
            reference,
            uri: uri(reference),
            title: thread.title,
            displayPath: this.projectedDisplayPath(
              [focus.title, thread.title], projection.subject
            ),
            hierarchy: {
              focus: { id: focus.id, title: focus.title },
              thread: { id: thread.id, title: thread.title },
              commitment: null,
              routine: null
            },
            projection,
            summary: {
              status: thread.status,
              state: cell?.state ?? thread.health,
              dueDate: thread.dueDate,
              reviewFrequencyDays: thread.reviewFrequencyDays,
              lastReviewDate: cell?.lastReviewDate ?? thread.lastReviewDate,
              nextReviewDate: cell?.nextReviewDate ?? thread.nextReviewDate,
              needsReview: thread.needsReview,
              reviewDue: cell?.reviewDue ?? thread.reviewDue,
              sensitive: thread.sensitive,
              createdAt: thread.createdAt,
              updatedAt: thread.updatedAt
            }
          }
        })
      })
    }).sort(compactListSort)
    return compactListPage(items, query)
  }

  listCommitments(
    query: ListHierarchyEntitiesQuery,
    access: OnMoveAccessPolicy
  ): ApplicationCompactListPage {
    if (query.focusId !== undefined) assertPositiveId(query.focusId, 'focus id')
    if (query.threadId !== undefined) assertPositiveId(query.threadId, 'thread id')
    const statuses = query.statuses ?? []
    const items = this.domain.focuses.list().flatMap((focus) => {
      if (query.focusId !== undefined && focus.id !== query.focusId) return []
      if (!this.sensitivity.canRead('focus', focus.id, access)) return []
      return this.domain.threads.listForFocus(focus.id).flatMap((thread) => {
        if (query.threadId !== undefined && thread.id !== query.threadId) return []
        if (!this.sensitivity.canRead('thread', thread.id, access)) return []
        return this.domain.commitments.listForThread(thread.id)
          .filter(trackingCommitment)
          .flatMap((commitment) => {
            if (statuses.length > 0 && !statuses.includes(commitment.status)) return []
            if (!this.sensitivity.canRead('commitment', commitment.id, access)) return []
            const application = this.domain.scopeApplications.get({
              type: 'commitment', id: commitment.id
            })
            const scopeRecord = application.effectiveScopeId === null
              ? null
              : this.domain.scopes.find(application.effectiveScopeId)
            const visibleScope = this.canListScope(scopeRecord, access, focus.id, thread.id)
            const cells = visibleScope ? this.domain.commitments.scopeMatrix(commitment.id) : []
            const visibleCells = cells.filter((cell) => this.sensitivity.canReadInContext(
              'subject', cell.subjectId, access, { focusId: focus.id, threadId: thread.id }
            ))
            const projections = this.listProjections({
              entityType: 'commitment', entityId: commitment.id,
              scopeId: application.effectiveScopeId,
              scopeRecord: visibleScope ? scopeRecord : null,
              source: `commitment-effective:${application.mode}`,
              subjects: visibleCells.map(({ subject }) => subject),
              hasHiddenSubjects: cells.length > visibleCells.length,
              scopeHidden: !visibleScope
            })
            return projections.map((projection): ApplicationCompactListItem => {
              const reference = { type: 'commitment' as const, id: commitment.id }
              const cell = projection.subject === null
                ? null
                : visibleCells.find(({ subjectId }) => subjectId === projection.subject?.id) ?? null
              return {
                projectionKey: this.projectionKey(reference, projection),
                reference,
                uri: uri(reference),
                title: commitment.title,
                displayPath: this.projectedDisplayPath(
                  [focus.title, thread.title, commitment.title], projection.subject
                ),
                hierarchy: {
                  focus: { id: focus.id, title: focus.title },
                  thread: { id: thread.id, title: thread.title },
                  commitment: { id: commitment.id, title: commitment.title },
                  routine: null
                },
                projection,
                summary: {
                  status: commitment.status,
                  state: cell?.state ?? commitment.state,
                  dueDate: commitment.dueDate,
                  cadenceDays: commitment.cadenceDays,
                  reviewFrequencyDays: commitment.reviewFrequencyDays,
                  lastReviewDate: cell?.lastReviewDate ?? commitment.lastReviewDate,
                  nextReviewDate: cell?.nextReviewDate ?? commitment.nextReviewDate,
                  reviewDue: cell?.reviewDue ?? commitment.reviewDue,
                  lastUpdateDate: cell?.lastUpdateDate ?? commitment.lastUpdateDate,
                  nextUpdateDate: cell?.nextUpdateDate ?? commitment.nextUpdateDate,
                  needsUpdate: cell?.needsUpdate ?? commitment.needsUpdate,
                  needsReview: commitment.needsReview,
                  sensitive: commitment.sensitive,
                  createdAt: commitment.createdAt,
                  updatedAt: commitment.updatedAt
                }
              }
            })
          })
      })
    }).sort(compactListSort)
    return compactListPage(items, query)
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
        this.sensitivity.canReadInContext('subject', subject.id, access, {
          focusId: id,
          threadId: null
        }))
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
        descriptionFormat: focus.description === null
          ? 'plain-text'
          : readableRichText(focus.description).format,
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

  getThread(
    id: number,
    access: OnMoveAccessPolicy,
    options: ApplicationEntityReadOptions = { includeRichText: true }
  ): ApplicationEntityContext | null {
    assertPositiveId(id, 'thread id')
    const thread = this.domain.threads.find(id)
    if (!thread || !this.sensitivity.canRead('thread', id, access)) return null
    const focus = this.domain.focuses.find(thread.focusId)
    if (!focus) return null
    const scope = this.domain.threadScopes.get(id)
    const visibleSubjects = (subjects: typeof scope.subjects): typeof scope.subjects =>
      subjects.filter((subject) => this.sensitivity.canReadInContext(
        'subject', subject.id, access, { focusId: focus.id, threadId: id }
      ))
    const commitments = this.domain.commitments.listForThread(id)
      .filter((commitment) => this.sensitivity.canRead('commitment', commitment.id, access))
    const routines = this.domain.routines.list()
      .filter((routine) => routine.parent.type === 'thread' && routine.parent.id === id)
      .filter((routine) => this.sensitivity.canRead('routine', routine.id, access))
    const warnings: string[] = []
    const includeRichText = options.includeRichText !== false
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
      updates: this.visibleUpdates({ type: 'thread', id }, access, includeRichText, warnings),
      todos: this.visibleTodos({ type: 'thread', id }, access),
      notes: this.visibleNotes({ type: 'thread', id }, access, includeRichText, warnings),
      commitments: commitments.map((commitment) => plainProjection(commitment)),
      routines: routines.map((routine) => plainProjection(routine)),
      threads: [],
      ...(warnings.length > 0 ? { warnings } : {})
    }
  }

  /**
   * Produces the exact stale-safe move input without mutating. Scope additions
   * are exposed only when every affected Subject is visible to this caller.
   */
  planThreadReparent(
    id: number,
    destinationFocusId: number,
    access: OnMoveAccessPolicy
  ): ApplicationThreadReparentPlan | null {
    assertPositiveId(id, 'thread id')
    assertPositiveId(destinationFocusId, 'destination focus id')
    const thread = this.domain.threads.find(id)
    const destinationFocus = this.domain.focuses.find(destinationFocusId)
    if (!thread || !destinationFocus ||
        !this.sensitivity.canRead('thread', id, access) ||
        !this.sensitivity.canRead('focus', destinationFocusId, {
          ...access,
          permissionPolicy: undefined
        }) ||
        !this.sensitivity.canViewResource('thread', access, {
          focusId: destinationFocusId,
          threadId: null
        })) return null
    const sourceFocus = this.domain.focuses.find(thread.focusId)
    if (!sourceFocus) return null
    const plan = this.domain.threads.planMove(id, destinationFocusId)
    if (plan.scopeSubjectAdditions.some((subject) =>
      !this.sensitivity.canReadInContext('subject', subject.id, access, {
        focusId: sourceFocus.id,
        threadId: id
      }))) return null
    const status = plan.fromFocusId === plan.toFocusId
      ? 'no-change' as const
      : plan.requiresConfirmation ? 'confirmation-required' as const : 'ready' as const
    const confirmedScopeSubjectIds = plan.scopeSubjectAdditions.map(({ id: subjectId }) => subjectId)
    return {
      reference: { type: 'thread', id },
      thread: { reference: { type: 'thread', id }, id, title: thread.title },
      sourceFocus: {
        reference: { type: 'focus', id: sourceFocus.id },
        id: sourceFocus.id,
        title: sourceFocus.title
      },
      destinationFocus: {
        reference: { type: 'focus', id: destinationFocus.id },
        id: destinationFocus.id,
        title: destinationFocus.title
      },
      plan: {
        threadId: plan.threadId,
        fromFocusId: plan.fromFocusId,
        toFocusId: plan.toFocusId,
        sourceScopeMode: plan.sourceScopeMode,
        sourceScopeId: plan.sourceScopeId,
        targetScopeId: plan.targetScopeId,
        scopeStrategy: plan.scopeStrategy,
        scopeSubjectAdditions: plan.scopeSubjectAdditions.map((subject) => ({
          ...subject,
          reference: { type: 'subject' as const, id: subject.id }
        })),
        requiresConfirmation: plan.requiresConfirmation,
        ownedRecords: {
          moveWithThread: true,
          kinds: [
            'commitments', 'routines', 'updates', 'todos', 'notes', 'review-evidence'
          ]
        }
      },
      status,
      nextAction: {
        tool: 'onmove.reparent_thread',
        arguments: {
          id,
          destinationFocusId,
          plannedFromFocusId: plan.fromFocusId,
          confirmedScopeSubjectIds
        },
        instruction: status === 'confirmation-required'
          ? 'Confirm the listed destination Focus Scope additions with the user, then copy these arguments exactly.'
          : status === 'no-change'
            ? 'No mutation is needed because this Thread already belongs to the destination Focus.'
            : 'Copy these arguments exactly to reparent the Thread.'
      }
    }
  }

  getCommitment(
    id: number,
    access: OnMoveAccessPolicy,
    options: ApplicationEntityReadOptions = { includeRichText: true }
  ): ApplicationEntityContext | null {
    assertPositiveId(id, 'commitment id')
    const commitment = this.domain.commitments.find(id)
    if (!commitment || !trackingCommitment(commitment) ||
        !this.sensitivity.canRead('commitment', id, access)) return null
    if (commitment.parent.type !== 'thread') return null
    const thread = this.domain.threads.find(commitment.parent.id)
    const focus = thread ? this.domain.focuses.find(thread.focusId) : null
    if (!thread || !focus) return null
    const cells = this.domain.commitments.scopeMatrix(id).filter((cell) =>
      this.sensitivity.canReadInContext('subject', cell.subjectId, access, {
        focusId: focus.id,
        threadId: thread.id
      }))
    const warnings: string[] = []
    const includeRichText = options.includeRichText !== false
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
      updates: this.visibleUpdates(
        { type: 'commitment', id }, access, includeRichText, warnings
      ),
      todos: this.visibleTodos({ type: 'commitment', id }, access),
      notes: this.visibleNotes({ type: 'commitment', id }, access, includeRichText, warnings),
      commitments: [],
      routines: [],
      threads: [],
      ...(warnings.length > 0 ? { warnings } : {})
    }
  }

  getUpdate(
    id: number,
    access: OnMoveAccessPolicy,
    options: ApplicationEntityReadOptions = { includeRichText: true }
  ): ApplicationUpdateContext | null {
    assertPositiveId(id, 'update id')
    const update = this.domain.updates.find(id)
    return update ? this.updateContext(update, access, options) : null
  }

  getTodo(id: number, access: OnMoveAccessPolicy): ApplicationStandaloneEntityContext | null {
    assertPositiveId(id, 'todo id')
    const todo = this.domain.todos.find(id)
    if (!todo || !this.sensitivity.canRead('todo', id, access)) return null
    return {
      reference: { type: 'todo', id },
      uri: `onmove://todo/${id}`,
      effectiveSensitive: Boolean(this.sensitivity.isSensitive('todo', id)),
      entity: plainProjection(todo)
    }
  }

  getSubject(id: number, access: OnMoveAccessPolicy): ApplicationStandaloneEntityContext | null {
    assertPositiveId(id, 'subject id')
    const subject = this.domain.subjects.find(id)
    if (!subject || !this.sensitivity.canRead('subject', id, access)) return null
    return {
      reference: { type: 'subject', id },
      uri: `onmove://subject/${id}`,
      effectiveSensitive: Boolean(this.sensitivity.isSensitive('subject', id)),
      entity: plainProjection(subject)
    }
  }

  getUpdates(
    ids: readonly number[],
    access: OnMoveAccessPolicy,
    options: ApplicationEntityReadOptions = { includeRichText: true }
  ): ApplicationUpdatesResult {
    if (ids.length < 1 || ids.length > 50) {
      throw new ModelValidationError('Update ids must contain between 1 and 50 values')
    }
    for (const id of ids) assertPositiveId(id, 'update id')
    const uniqueIds = [...new Set(ids)]
    const records = this.domain.updates.findMany(uniqueIds)
    const byId = new Map(records.map((update) => [update.id, update] as const))
    const items: ApplicationUpdateContext[] = []
    const unavailableIds: number[] = []
    for (const id of uniqueIds) {
      const update = byId.get(id)
      const context = update ? this.updateContext(update, access, options) : null
      if (context) items.push(context)
      else unavailableIds.push(id)
    }
    return { items, unavailableIds }
  }

  /**
   * Reads an addressable hierarchy entity from exact, case-insensitive titles.
   * Paths never accept IDs; ID lookups use the dedicated get-by-ID boundary.
   */
  getEntityByPath(
    query: ApplicationEntityPathQuery,
    access: OnMoveAccessPolicy,
    options: ApplicationEntityReadOptions = {}
  ): ApplicationEntityPathResolution {
    const exact = (actual: string, expected: string): boolean =>
      normalizedLookup(actual) === normalizedLookup(expected)
    const focusMatches = (title?: string): FocusSnapshot[] => this.domain.focuses.list()
      .filter((focus) => title === undefined || exact(focus.title, title))
    let candidates: ApplicationEntityContext[]

    if (query.type === 'focus') {
      candidates = focusMatches(query.focusTitle).flatMap((focus) => {
        const context = this.getFocus(focus.id, access, options)
        return context ? [context] : []
      })
    } else if (query.type === 'thread') {
      candidates = focusMatches(query.focusTitle).flatMap((focus) =>
        this.domain.threads.listForFocus(focus.id)
          .filter((thread) => exact(thread.title, query.threadTitle))
          .flatMap((thread) => {
            const context = this.getThread(thread.id, access, options)
            return context ? [context] : []
          }))
    } else if (query.type === 'commitment') {
      candidates = focusMatches(query.focusTitle).flatMap((focus) =>
        this.domain.threads.listForFocus(focus.id)
          .filter((thread) => exact(thread.title, query.threadTitle))
          .flatMap((thread) => this.domain.commitments.listForThread(thread.id)
            .filter(trackingCommitment)
            .filter((commitment) => exact(commitment.title, query.commitmentTitle))
            .flatMap((commitment) => {
              const context = this.getCommitment(commitment.id, access, options)
              return context ? [context] : []
            })))
    } else {
      candidates = this.domain.routines.list().flatMap((routine) => {
        if (routine.parent.type !== 'thread' || !exact(routine.name, query.routineTitle)) return []
        const thread = this.domain.threads.find(routine.parent.id)
        const focus = thread ? this.domain.focuses.find(thread.focusId) : null
        if (!thread || !focus || !exact(thread.title, query.threadTitle) ||
            (query.focusTitle !== undefined && !exact(focus.title, query.focusTitle))) return []
        const context = this.getRoutine(routine.id, access)
        return context ? [context] : []
      })
    }

    return {
      status: candidates.length === 1
        ? 'resolved'
        : candidates.length === 0 ? 'not_found' : 'ambiguous',
      requested: structuredClone(query),
      candidates
    }
  }

  private updateContext(
    update: UpdateSnapshot,
    access: OnMoveAccessPolicy,
    options: ApplicationEntityReadOptions = { includeRichText: true }
  ): ApplicationUpdateContext | null {
    const id = update.id
    if (!this.sensitivity.canRead('update', id, access)) return null
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
    const base = {
      reference: { type: 'update', id },
      uri: `onmove://update/${id}`,
      contextPath,
      effectiveSensitive: Boolean(this.sensitivity.isSensitive('update', id))
    } as const
    try {
      const document = this.domain.richTextDocuments.get({
        type: 'update', id, field: 'observation'
      })
      if (options.includeRichText === false) onMoveRichTextDocumentFromStored(document.value)
      return {
        ...base,
        update: options.includeRichText === false
          ? readableUpdateProjection(update, document.revision)
          : updateProjection(update, document)
      }
    } catch (error) {
      return {
        ...base,
        update: readableUpdateProjection(update),
        warnings: [
          `Update ${id} contains unsupported rich text. Readable observation text was returned ` +
          `without a lossless rich-text document. Detail: ` +
          `${error instanceof Error ? error.message : String(error)}`
        ]
      }
    }
  }

  getNote(
    id: number,
    access: OnMoveAccessPolicy,
    options: ApplicationEntityReadOptions = { includeRichText: true }
  ): ApplicationNoteContext | null {
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
        ...readableNoteProjection(note),
        ...(options.includeRichText === false
          ? {}
          : { richText: onMoveRichTextDocumentFromStored(note.content) })
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
      subject === null || this.sensitivity.canReadInContext(
        'subject', subject.id, access, { focusId: focus.id, threadId: thread.id }
      )
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

  listRoutines(
    query: ListHierarchyEntitiesQuery,
    access: OnMoveAccessPolicy
  ): ApplicationCompactListPage {
    if (query.focusId !== undefined) assertPositiveId(query.focusId, 'focus id')
    if (query.threadId !== undefined) assertPositiveId(query.threadId, 'thread id')
    const statuses = query.statuses ?? []
    const items = this.domain.routines.list().flatMap((routine) => {
      if (statuses.length > 0 && !statuses.includes(routine.status)) return []
      if (!this.sensitivity.canRead('routine', routine.id, access)) return []
      const thread = routine.parent.type === 'thread'
        ? this.domain.threads.find(routine.parent.id)
        : null
      const focus = thread
        ? this.domain.focuses.find(thread.focusId)
        : routine.parent.type === 'focus'
          ? this.domain.focuses.find(routine.parent.id)
          : null
      if (!focus) return []
      if (query.focusId !== undefined && focus.id !== query.focusId) return []
      if (query.threadId !== undefined && thread?.id !== query.threadId) return []
      if (thread && !this.sensitivity.canRead('thread', thread.id, access)) return []
      const scopeRecord = routine.scope === null
        ? null
        : this.domain.scopes.find(routine.scope.id)
      const visibleScope = this.canListScope(scopeRecord, access, focus.id, thread?.id ?? null)
      const visibleSubjects = visibleScope && routine.scope
        ? routine.scope.subjects.filter((subject) => this.sensitivity.canReadInContext(
            'subject', subject.id, access, { focusId: focus.id, threadId: thread?.id ?? null }
          ))
        : []
      const projections = this.listProjections({
        entityType: 'routine', entityId: routine.id,
        scopeId: routine.scope?.id ?? null,
        scopeRecord: visibleScope ? scopeRecord : null,
        source: 'routine-definition',
        subjects: visibleSubjects,
        hasHiddenSubjects: (routine.scope?.subjects.length ?? 0) > visibleSubjects.length,
        scopeHidden: !visibleScope
      })
      return projections.map((projection): ApplicationCompactListItem => {
        const reference = { type: 'routine' as const, id: routine.id }
        const cell = projection.subject === null
          ? null
          : routine.currentRun?.cells.find(
              (candidate) => candidate.subject?.id === projection.subject?.id
            ) ?? null
        const requiredTemplateItems = routine.template.items.filter(({ required }) => required).length
        const parentLabels = [focus.title, thread?.title, routine.name]
          .filter((label): label is string => label !== undefined)
        return {
          projectionKey: this.projectionKey(reference, projection),
          reference,
          uri: uri(reference),
          title: routine.name,
          displayPath: this.projectedDisplayPath(parentLabels, projection.subject),
          hierarchy: {
            focus: { id: focus.id, title: focus.title },
            thread: thread ? { id: thread.id, title: thread.title } : null,
            commitment: null,
            routine: { id: routine.id, title: routine.name }
          },
          projection,
          summary: {
            status: routine.status,
            needsAttestation: routine.needsAttestation,
            scheduleWeekdays: routine.scheduleWeekdays,
            nextReviewDate: routine.nextReviewDate,
            nextScheduledDate: routine.nextScheduledDate,
            overdueDays: routine.overdueDays,
            currentRun: routine.currentRun
              ? {
                  id: routine.currentRun.id,
                  scheduledDate: routine.currentRun.scheduledDate,
                  completionDate: cell?.completionDate ?? routine.currentRun.completionDate,
                  progress: cell?.progress ?? (
                    projection.mode === 'unscoped'
                      ? routine.currentRun.progress
                      : { complete: 0, required: requiredTemplateItems }
                  )
                }
              : null,
            sensitive: routine.sensitive,
            createdAt: routine.createdAt,
            updatedAt: routine.updatedAt
          }
        }
      })
    }).sort(compactListSort)
    return compactListPage(items, query)
  }

  private canListScope(
    scope: ScopeSnapshot | null,
    access: OnMoveAccessPolicy,
    focusId: number,
    threadId: number | null
  ): boolean {
    if (scope === null) return true
    return (access.sensitiveContent === 'allow' || !scope.sensitive) &&
      this.sensitivity.canViewResource('subject', access, { focusId, threadId })
  }

  private listProjections(input: {
    entityType: 'thread' | 'commitment' | 'routine'
    entityId: number
    scopeId: number | null
    scopeRecord: ScopeSnapshot | null
    source: string
    subjects: Array<Pick<SubjectSnapshot, 'id' | 'name'>>
    hasHiddenSubjects: boolean
    scopeHidden: boolean
  }): ApplicationListProjection[] {
    if (input.scopeId === null) {
      return [{ mode: 'unscoped', projectedScope: false, scope: null, subject: null }]
    }
    if (input.scopeHidden) {
      return [{ mode: 'scope-hidden', projectedScope: true, scope: null, subject: null }]
    }
    const scope = input.scopeRecord
      ? {
          id: input.scopeRecord.id,
          name: input.scopeRecord.name,
          dimension: input.scopeRecord.dimension,
          source: input.source
        }
      : null
    if (input.subjects.length === 0) {
      return [{
        mode: input.hasHiddenSubjects ? 'scope-hidden' : 'empty-scope',
        projectedScope: true,
        scope,
        subject: null
      }]
    }
    return input.subjects.map((subject) => ({
      mode: 'subject' as const,
      projectedScope: true as const,
      scope: scope ?? {
        id: input.scopeId as number,
        name: 'Effective scope',
        dimension: 'subject',
        source: input.source
      },
      subject: { id: subject.id, name: subject.name }
    }))
  }

  private projectionKey(
    reference: ApplicationEntityReference,
    projection: ApplicationListProjection
  ): string {
    return projection.mode === 'subject'
      ? `${reference.type}:${reference.id}:subject:${projection.subject.id}`
      : `${reference.type}:${reference.id}:${projection.mode}`
  }

  private projectedDisplayPath(
    labels: string[],
    subject: { id: number; name: string } | null
  ): string {
    const projected = [...labels]
    if (subject && projected.length > 0) {
      projected[projected.length - 1] = `${projected.at(-1)}[${subject.name}]`
    }
    return projected.join(' > ')
  }

  getReviews(access: OnMoveAccessPolicy, asOf?: string): unknown {
    const overview = this.domain.reviews.getOverview(asOf)
    return plainProjection({
      ...overview,
      items: overview.items.flatMap((item) => {
        const type = item.kind as 'thread' | 'commitment'
        const id = item.commitment?.id ?? item.thread?.id
        if (!id || !this.sensitivity.canRead(type, id, access)) return []
        if (item.cell && !this.sensitivity.canReadInContext(
          'subject', item.cell.subjectId, access, this.sensitivity.contextFor(type, id)
        )) return []
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
        (access.sensitiveContent === 'allow' || !use.effectiveSensitive) &&
        this.sensitivity.canRead(use.source.type, use.source.id, access))
      return uses.length === 0 ? [] : [{ name: tag.name, useCount: uses.length }]
    })
  }

  getTagUses(name: string, access: OnMoveAccessPolicy, limit = 50, offset = 0): unknown[] {
    const page = boundedPage(limit, offset)
    return plainProjection(this.domain.tags.uses(name)
      .filter((use) =>
        (access.sensitiveContent === 'allow' || !use.effectiveSensitive) &&
        this.sensitivity.canRead(use.source.type, use.source.id, access))
      .slice(page.offset, page.offset + page.limit)) as unknown[]
  }

  search(query: SearchQuery, access: OnMoveAccessPolicy): SearchResult[] {
    return this.searchIndex.search(query, access)
  }

  searchPage(query: SearchQuery, access: OnMoveAccessPolicy): SearchPage {
    return this.searchIndex.searchPage(query, access)
  }

  async retrievePage(
    request: RetrievalRequest,
    access: OnMoveAccessPolicy,
    retrievalMode: McpRetrievalMode
  ): Promise<RetrievalPage> {
    const boundary = request.context.boundary
    const focusId = boundary.type === 'workspace' ? null : boundary.focusId
    const threadId = boundary.type === 'thread' ? boundary.threadId : null
    const focus = focusId === null ? null : this.domain.focuses.find(focusId)
    const thread = threadId === null ? null : this.domain.threads.find(threadId)
    const subjectId = request.context.subjectId ?? null
    const subject = subjectId === null ? null : this.domain.subjects.find(subjectId)
    const permissionContext = { focusId, threadId }
    let invalid =
      (focusId !== null && (!focus || !this.sensitivity.canRead('focus', focusId, access))) ||
      (threadId !== null && (
        !thread || thread.focusId !== focusId ||
        !this.sensitivity.canRead('thread', threadId, access)
      )) || (subjectId !== null && !subject)
    if (!invalid && subjectId !== null) {
      if (threadId !== null) {
        invalid = !this.sensitivity.canReadInContext(
          'subject', subjectId, access, permissionContext
        )
      } else if (!this.sensitivity.canReadInContext(
        'subject', subjectId, access, permissionContext
      )) {
        // A Focus or workspace request may legitimately include records exposed by a
        // more-specific Thread Subject grant. Treat the context as visible when any readable
        // descendant grants it; the candidate query still enforces every record's exact grant.
        const candidateFocuses = focus ? [focus] : this.domain.focuses.list()
        invalid = !candidateFocuses.some((candidateFocus) =>
          this.sensitivity.canRead('focus', candidateFocus.id, access) &&
          this.domain.threads.listForFocus(candidateFocus.id).some((candidateThread) =>
            this.sensitivity.canRead('thread', candidateThread.id, access) &&
            this.sensitivity.canReadInContext('subject', subjectId, access, {
              focusId: candidateFocus.id,
              threadId: candidateThread.id
            })))
      }
    }
    if (invalid) throw new RetrievalContextNotVisibleError()

    return this.retrieval.retrieve({
      ...request,
      focusId,
      threadId,
      subjectId
    }, access, retrievalMode)
  }

  dispose(): void {
    this.retrieval.dispose()
  }

  /**
   * Browses writable hierarchy paths independently of indexed text. Text hits
   * seed ancestor expansion, while a matched Subject expands every currently
   * applicable Thread and Commitment path for that canonical identity.
   */
  browseHierarchy(
    query: BrowseApplicationHierarchyQuery,
    matches: readonly SearchResult[],
    access: OnMoveAccessPolicy
  ): ApplicationHierarchyBrowseResult {
    const page = boundedPage(query.limit, query.offset)
    const lifecycleSelection = normalizedHierarchyLifecycle(query.lifecycle)
    const structuralBrowse = query.text === null
    const requestedFocusId = query.focusId ?? null
    const requestedThreadId = query.threadId ?? null
    const requestedSubjectId = query.subjectId ?? null
    const hierarchyTokens = query.text?.normalize('NFKC').toLocaleLowerCase()
      .match(/[\p{L}\p{N}_]+/gu) ?? []
    const matchesHierarchyText = (...values: Array<string | null | undefined>): boolean =>
      hierarchyTokens.length > 0 && hierarchyTokens.some((token) =>
        values.some((value) => value?.normalize('NFKC').toLocaleLowerCase().includes(token)))
    const matchedFocusIds = new Set<number>()
    const matchedThreadIds = new Set<number>()
    const matchedCommitmentIds = new Set<number>()
    const matchedSubjectIds = new Set<number>()
    for (const match of matches) {
      if (match.hierarchy.focus && !match.hierarchy.thread) {
        matchedFocusIds.add(match.hierarchy.focus.id)
      }
      if (match.hierarchy.commitment) {
        matchedCommitmentIds.add(match.hierarchy.commitment.id)
      } else if (match.hierarchy.thread) {
        matchedThreadIds.add(match.hierarchy.thread.id)
      }
      if (match.reference.type === 'focus') matchedFocusIds.add(match.reference.id)
      if (match.reference.type === 'thread') matchedThreadIds.add(match.reference.id)
      if (match.reference.type === 'commitment') matchedCommitmentIds.add(match.reference.id)
      if (match.reference.type === 'subject') matchedSubjectIds.add(match.reference.id)
      if (match.subject) matchedSubjectIds.add(match.subject.id)
    }
    if (requestedSubjectId !== null) matchedSubjectIds.add(requestedSubjectId)

    const paths: ApplicationHierarchyPath[] = []
    const seen = new Set<string>()
    const append = (path: ApplicationHierarchyPath): void => {
      if (!hierarchyPathSelected(path.lifecycle, lifecycleSelection)) return
      const key = [
        path.kind,
        path.hierarchy.focus.id,
        path.hierarchy.thread?.id ?? 0,
        path.hierarchy.commitment?.id ?? 0,
        path.subject?.id ?? 0
      ].join(':')
      if (seen.has(key)) return
      seen.add(key)
      paths.push(path)
    }
    const makePath = (
      kind: ApplicationHierarchyPath['kind'],
      focus: { id: number; title: string },
      thread: { id: number; title: string } | null,
      commitment: { id: number; title: string } | null,
      subject: { id: number; name: string } | null,
      scope: ApplicationHierarchyPath['scope'],
      updateTarget: ApplicationHierarchyPath['updateTarget'],
      lifecycle: SearchResultLifecycle
    ): ApplicationHierarchyPath => {
      const notation: ApplicationHierarchyPath['notation'] = { focus: focus.title }
      if (thread) notation.thread = thread.title
      if (commitment) notation.commitment = commitment.title
      if (subject) notation.subject = subject.name
      const labels = [focus.title, thread?.title, commitment?.title]
        .filter((value): value is string => Boolean(value))
      const relativeLabels = [thread?.title, commitment?.title]
        .filter((value): value is string => Boolean(value))
      if (subject) {
        const last = labels.length - 1
        labels[last] = `${labels[last]}[${subject.name}]`
        const relativeLast = relativeLabels.length - 1
        if (relativeLast >= 0) {
          relativeLabels[relativeLast] = `${relativeLabels[relativeLast]}[${subject.name}]`
        }
      }
      return {
        kind,
        hierarchy: { focus, thread, commitment },
        subject,
        notation,
        displayPath: labels.join(' > '),
        relativePath: relativeLabels.join(' > ') || labels.join(' > '),
        ...(query.includeScopes ? { scope } : {}),
        lifecycle,
        updateTarget
      }
    }

    for (const focusRecord of this.domain.focuses.list()) {
      if (requestedFocusId !== null && focusRecord.id !== requestedFocusId) continue
      const focus = { id: focusRecord.id, title: focusRecord.title }
      const focusLifecycle = { id: focusRecord.id, status: focusRecord.status }
      const threadRecords = this.domain.threads.listForFocus(focus.id)
        .filter((thread) => this.sensitivity.canRead('thread', thread.id, access))
      const focusScope = this.domain.focusScopes.get(focus.id)
      const focusScopeRecord = focusScope.scopeId === null
        ? null
        : this.domain.scopes.find(focusScope.scopeId)
      const focusScopeAccessible = focusScopeRecord === null ||
        ((access.sensitiveContent === 'allow' || !focusScopeRecord.sensitive) &&
          this.sensitivity.canViewResource('subject', access, {
            focusId: focus.id,
            threadId: null
          }))
      const focusSubjects = focusScopeAccessible
        ? focusScope.subjects.filter((subject) =>
            (requestedSubjectId === null || subject.id === requestedSubjectId) &&
            this.sensitivity.canReadInContext('subject', subject.id, access, {
              focusId: focus.id,
              threadId: null
            }))
        : []
      const focusScopeSummary = focusScopeRecord && focusScopeAccessible
        ? {
            id: focusScopeRecord.id,
            name: focusScopeRecord.name,
            dimension: focusScopeRecord.dimension,
            applicationMode: focusScope.mode
          }
        : null
      const focusScopeMatched = query.includeScopes === true && focusScopeAccessible &&
        matchesHierarchyText(focusScopeRecord?.name, focusScopeRecord?.dimension)
      const focusMatched = structuralBrowse || matchedFocusIds.has(focus.id) || focusScopeMatched
      if (
        this.sensitivity.canRead('focus', focus.id, access) &&
        focusMatched && requestedThreadId === null && requestedSubjectId === null &&
        (query.includeThreads || query.includeCommitments || query.includeSubjects ||
          query.includeScopes)
      ) {
        append(makePath(
          'focus', focus, null, null, null, focusScopeSummary, null,
          hierarchyPathLifecycle('focus', focusLifecycle, null, null)
        ))
      }
      const focusSubjectMatched = focusSubjects.some((subject) => matchedSubjectIds.has(subject.id))
      if (requestedThreadId === null && (
        query.includeSubjects || focusSubjectMatched ||
        (structuralBrowse && requestedSubjectId !== null)
      )) {
        for (const subject of focusSubjects) {
          if (!structuralBrowse && !focusMatched && !matchedSubjectIds.has(subject.id)) continue
          append(makePath(
            'subject', focus, null, null, { id: subject.id, name: subject.name },
            focusScopeSummary, null,
            hierarchyPathLifecycle('subject', focusLifecycle, null, null)
          ))
        }
      }

      for (const threadRecord of threadRecords) {
        if (requestedThreadId !== null && threadRecord.id !== requestedThreadId) continue
        const thread = { id: threadRecord.id, title: threadRecord.title }
        const threadLifecycle = { id: threadRecord.id, status: threadRecord.status }
        const threadScope = this.domain.threadScopes.get(thread.id)
        const scopeRecord = threadScope.scopeId === null
          ? null
          : this.domain.scopes.find(threadScope.scopeId)
        const scopeAccessible = scopeRecord === null ||
          ((access.sensitiveContent === 'allow' || !scopeRecord.sensitive) &&
            this.sensitivity.canViewResource('subject', access, {
              focusId: focus.id,
              threadId: thread.id
            }))
        const effectiveSubjects = scopeAccessible ? threadScope.subjects : []
        const subjects = scopeAccessible
          ? effectiveSubjects.filter((subject) =>
              (requestedSubjectId === null || subject.id === requestedSubjectId) &&
              this.sensitivity.canReadInContext('subject', subject.id, access, {
                focusId: focus.id,
                threadId: thread.id
              }))
          : []
        const subjectMatched = subjects.some((subject) => matchedSubjectIds.has(subject.id))
        const commitments = this.domain.commitments.listForThread(thread.id)
          .filter(trackingCommitment)
          .filter((commitment) =>
            this.sensitivity.canRead('commitment', commitment.id, access))
        const commitmentMatched = commitments.some((commitment) =>
          matchedCommitmentIds.has(commitment.id))
        const scopeMatched = query.includeScopes === true && scopeAccessible &&
          matchesHierarchyText(scopeRecord?.name, scopeRecord?.dimension)
        const threadMatched = structuralBrowse || focusMatched ||
          matchedThreadIds.has(thread.id) || commitmentMatched || subjectMatched || scopeMatched
        if (!threadMatched) continue
        if (requestedSubjectId !== null && !subjects.some(({ id }) => id === requestedSubjectId)) {
          continue
        }
        const threadScopeSummary = scopeRecord && scopeAccessible
          ? {
              id: scopeRecord.id,
              name: scopeRecord.name,
              dimension: scopeRecord.dimension,
              applicationMode: threadScope.mode
            }
          : null
        const threadUnscopedTarget = scopeAccessible &&
          (threadScope.scopeId === null || effectiveSubjects.length === 0)
          ? {
              parent: { type: 'thread' as const, id: thread.id },
              attribution: { mode: 'unscoped' as const }
            }
          : null
        if (query.includeThreads) {
          append(makePath(
            'thread', focus, thread, null, null, threadScopeSummary, threadUnscopedTarget,
            hierarchyPathLifecycle('thread', focusLifecycle, threadLifecycle, null)
          ))
        }
        if (query.includeSubjects || subjectMatched || requestedSubjectId !== null) {
          for (const subject of subjects) {
            if (
              !structuralBrowse && !focusMatched && !matchedThreadIds.has(thread.id) &&
              !matchedSubjectIds.has(subject.id) && !commitmentMatched
            ) continue
            append(makePath(
              'subject', focus, thread, null, { id: subject.id, name: subject.name },
              threadScopeSummary,
              {
                parent: { type: 'thread', id: thread.id },
                attribution: { mode: 'subject', subjectId: subject.id }
              },
              hierarchyPathLifecycle('subject', focusLifecycle, threadLifecycle, null)
            ))
          }
        }

        for (const commitmentRecord of commitments) {
          const commitment = { id: commitmentRecord.id, title: commitmentRecord.title }
          const commitmentLifecycle = {
            id: commitmentRecord.id,
            status: commitmentRecord.status
          }
          const ownMatch = matchedCommitmentIds.has(commitment.id)
          const commitmentSeeded = structuralBrowse || focusMatched ||
            matchedThreadIds.has(thread.id) || ownMatch || subjectMatched
          if (!commitmentSeeded) continue
          const application = this.domain.scopeApplications.get({
            type: 'commitment', id: commitment.id
          })
          const commitmentScopeRecord = application.effectiveScopeId === null
            ? null
            : this.domain.scopes.find(application.effectiveScopeId)
          const commitmentScopeAccessible = commitmentScopeRecord === null ||
            ((access.sensitiveContent === 'allow' || !commitmentScopeRecord.sensitive) &&
              this.sensitivity.canViewResource('subject', access, {
                focusId: focus.id,
                threadId: thread.id
              }))
          const commitmentSubjects = commitmentScopeAccessible
            ? this.domain.commitments.scopeMatrix(commitment.id)
                .map(({ subject }) => subject)
                .filter((subject) =>
                  (requestedSubjectId === null || subject.id === requestedSubjectId) &&
                  this.sensitivity.canReadInContext('subject', subject.id, access, {
                    focusId: focus.id,
                    threadId: thread.id
                  }))
            : []
          if (
            requestedSubjectId !== null &&
            !commitmentSubjects.some(({ id }) => id === requestedSubjectId)
          ) continue
          const commitmentScopeSummary = commitmentScopeRecord && commitmentScopeAccessible
            ? {
                id: commitmentScopeRecord.id,
                name: commitmentScopeRecord.name,
                dimension: commitmentScopeRecord.dimension,
                applicationMode: application.mode
              }
            : null
          const commitmentUnscopedTarget = commitmentScopeAccessible &&
            application.effectiveScopeId === null
            ? {
                parent: { type: 'commitment' as const, id: commitment.id },
                attribution: { mode: 'unscoped' as const }
              }
            : null
          if (query.includeCommitments) {
            append(makePath(
              'commitment', focus, thread, commitment, null,
              commitmentScopeSummary, commitmentUnscopedTarget,
              hierarchyPathLifecycle(
                'commitment', focusLifecycle, threadLifecycle, commitmentLifecycle
              )
            ))
          }
          if (query.includeSubjects || subjectMatched || requestedSubjectId !== null) {
            for (const subject of commitmentSubjects) {
              if (
                !structuralBrowse && !focusMatched && !matchedThreadIds.has(thread.id) &&
                !ownMatch && !matchedSubjectIds.has(subject.id)
              ) continue
              append(makePath(
                'subject', focus, thread, commitment,
                { id: subject.id, name: subject.name }, commitmentScopeSummary,
                {
                  parent: { type: 'commitment', id: commitment.id },
                  attribution: { mode: 'subject', subjectId: subject.id }
                },
                hierarchyPathLifecycle(
                  'subject', focusLifecycle, threadLifecycle, commitmentLifecycle
                )
              ))
            }
          }
        }
      }

    }

    paths.sort((left, right) =>
      left.displayPath.localeCompare(right.displayPath, undefined, { sensitivity: 'base' }) ||
      left.kind.localeCompare(right.kind))
    return {
      paths: paths.slice(page.offset, page.offset + page.limit),
      total: paths.length
    }
  }

  /**
   * Resolves one Subject inside one Thread and materializes the compact current
   * situation in one read. This deliberately replaces a chain of generic text
   * searches for the Subject, Thread, Updates, Todos, and Commitments.
   */
  reviewSubject(
    query: ReviewApplicationSubjectQuery,
    access: OnMoveAccessPolicy
  ): ApplicationSubjectReviewResult {
    if (!query || typeof query !== 'object') {
      throw new ModelValidationError('Subject review query is required')
    }
    assertSubjectSelector(query.subject)
    assertEntitySelector(query.thread, 'thread')
    if (query.focus) assertEntitySelector(query.focus, 'focus')
    const page = boundedPage(query.limit ?? 10, 0)
    const subjects = this.domain.subjects.list()
      .filter((subject) => matchesSubjectSelector(subject, query.subject))
    const threadCandidates = this.threadCandidates(query.thread, query.focus, access)
      .map((candidate) => ({
        ...candidate,
        applicableSubjects: candidate.applicableSubjects.filter((subject) =>
          matchesSubjectSelector(subject, query.subject))
      }))
    const candidates: ApplicationSubjectReviewCandidate[] = []
    for (const focus of this.domain.focuses.list()) {
      if (query.focus && !matchesEntitySelector(focus, query.focus)) continue
      if (!this.sensitivity.canRead('focus', focus.id, access)) continue
      for (const thread of this.domain.threads.listForFocus(focus.id)) {
        if (!matchesEntitySelector(thread, query.thread)) continue
        if (!this.sensitivity.canRead('thread', thread.id, access)) continue
        const effectiveSubjectIds = new Set(
          this.domain.threadScopes.get(thread.id).subjects.map(({ id }) => id)
        )
        for (const subject of subjects) {
          if (!effectiveSubjectIds.has(subject.id)) continue
          if (!this.sensitivity.canReadInContext('subject', subject.id, access, {
            focusId: focus.id,
            threadId: thread.id
          })) continue
          candidates.push({
            subject: { id: subject.id, name: subject.name },
            hierarchy: {
              focus: { id: focus.id, title: focus.title },
              thread: { id: thread.id, title: thread.title }
            },
            displayPath: `${focus.title} > ${thread.title}[${subject.name}]`
          })
        }
      }
    }
    const status = candidates.length === 1
      ? 'resolved'
      : candidates.length === 0 ? 'not_found' : 'ambiguous'
    if (status !== 'resolved') {
      return {
        status,
        requested: structuredClone(query),
        candidates,
        threadCandidates,
        review: null
      }
    }

    const target = candidates[0]
    const { subject, hierarchy } = target
    const thread = this.domain.threads.find(hierarchy.thread.id)
    if (!thread) {
      return {
        status: 'not_found',
        requested: structuredClone(query),
        candidates: [],
        threadCandidates,
        review: null
      }
    }
    const commitments = this.domain.commitments.listForThread(thread.id)
      .filter(trackingCommitment)
      .filter((commitment) => this.sensitivity.canRead('commitment', commitment.id, access))
    const applicableCommitments = commitments.flatMap((commitment) => {
      const cell = this.domain.commitments.scopeMatrix(commitment.id)
        .find(({ subjectId }) => subjectId === subject.id)
      return cell ? [{ commitment, cell }] : []
    })
    const commitmentIds = new Set(applicableCommitments.map(({ commitment }) => commitment.id))

    const updates = [
      ...this.domain.updates.listForThread(thread.id).map((update) => ({
        update,
        commitment: null
      })),
      ...applicableCommitments.flatMap(({ commitment }) =>
        this.domain.updates.listForCommitment(commitment.id).map((update) => ({
          update,
          commitment: { id: commitment.id, title: commitment.title }
        })))
    ]
      .filter(({ update }) => update.scope?.subjectId === subject.id)
      .filter(({ update }) => this.sensitivity.canRead('update', update.id, access))
      .sort((left, right) =>
        right.update.updatedAt.localeCompare(left.update.updatedAt) ||
        right.update.id - left.update.id)
      .slice(0, page.limit)
      .map(({ update, commitment }) => ({
        id: update.id,
        uri: `onmove://update/${update.id}`,
        parent: update.parent,
        hierarchy: { ...hierarchy, commitment },
        subject,
        displayPath: commitment
          ? `${hierarchy.thread.title} > ${commitment.title}[${subject.name}]`
          : `${hierarchy.thread.title}[${subject.name}]`,
        date: update.date,
        state: update.state,
        snippet: compactPlainText(update.observation),
        sensitive: update.sensitive,
        updatedAt: update.updatedAt
      }))

    const openTodos = this.domain.todos.query({ done: false })
      .filter((todo) => this.sensitivity.canRead('todo', todo.id, access))
      .filter((todo) => {
        const inThread = (todo.parent.type === 'thread' || todo.parent.type === 'thread-scope') &&
          todo.parent.id === thread.id
        const inCommitment =
          (todo.parent.type === 'commitment' || todo.parent.type === 'commitment-scope') &&
          commitmentIds.has(todo.parent.id)
        if (!inThread && !inCommitment) return false
        if (todo.sharedAcrossSubjects) {
          return todo.subjectCompletions.some((completion) =>
            completion.subject.id === subject.id && !completion.done)
        }
        return todo.subject?.id === subject.id
      })
      .slice(0, page.limit)
      .map((todo) => ({
        id: todo.id,
        uri: `onmove://todo/${todo.id}`,
        name: todo.name,
        parent: todo.parent,
        subject,
        sharedAcrossSubjects: todo.sharedAcrossSubjects,
        dueDate: todo.dueDate,
        updatedAt: todo.updatedAt
      }))

    const openCommitments = applicableCommitments
      .filter(({ commitment }) =>
        commitment.status === 'active' || commitment.status === 'paused')
      .slice(0, page.limit)
      .map(({ commitment, cell }) => ({
        id: commitment.id,
        uri: `onmove://commitment/${commitment.id}`,
        title: commitment.title,
        status: commitment.status,
        state: cell.state,
        dueDate: commitment.dueDate,
        lastUpdateDate: cell.lastUpdateDate,
        nextUpdateDate: cell.nextUpdateDate,
        subject,
        displayPath: `${hierarchy.thread.title} > ${commitment.title}[${subject.name}]`,
        updatedAt: commitment.updatedAt
      }))
    const threadCell = this.domain.threads.scopeMatrix(thread.id)
      .find(({ subjectId }) => subjectId === subject.id)
    return {
      status,
      requested: structuredClone(query),
      candidates,
      threadCandidates: [],
      review: {
        subject,
        hierarchy,
        displayPath: target.displayPath,
        thread: {
          id: thread.id,
          uri: `onmove://thread/${thread.id}`,
          title: thread.title,
          status: thread.status,
          state: threadCell?.state ?? 'none',
          dueDate: thread.dueDate,
          lastReviewDate: threadCell?.lastReviewDate ?? thread.lastReviewDate,
          updatedAt: thread.updatedAt
        },
        updates,
        openTodos,
        openCommitments
      }
    }
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
    const threadCandidates = this.threadCandidates(query.thread, query.focus, access)

    const focuses = this.domain.focuses.list()
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
            .filter((subject) => this.sensitivity.canReadInContext(
              'subject', subject.id, access, { focusId: focus.id, threadId: thread.id }
            ))
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
      parentCandidates: parents,
      threadCandidates: candidates.length === 0 && parents.length === 0
        ? threadCandidates
        : []
    }
  }

  /**
   * Resolves a directly owned Note through an exact hierarchy path. The
   * deepest selector identifies the owning parent; descendants are never
   * searched implicitly.
   */
  resolveNote(
    query: ResolveApplicationNoteQuery,
    access: OnMoveAccessPolicy,
    options: ApplicationEntityReadOptions = { includeRichText: true }
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
      .filter((focus) => matchesEntitySelector(focus, query.focus))
    for (const focus of focuses) {
      if (!query.thread) {
        parents.push({ type: 'focus', id: focus.id })
        continue
      }
      const threads = this.domain.threads.listForFocus(focus.id)
        .filter((thread) => matchesEntitySelector(thread, query.thread as ApplicationEntitySelector))
      for (const thread of threads) {
        if (!query.commitment) {
          parents.push({ type: 'thread', id: thread.id })
          continue
        }
        const commitments = this.domain.commitments.listForThread(thread.id)
          .filter(trackingCommitment)
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
        const context = this.getNote(note.id, access, options)
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
    access: OnMoveAccessPolicy,
    includeRichText = true,
    warnings: string[] = []
  ): unknown[] {
    const updates = parent.type === 'thread'
      ? this.domain.updates.listForThread(parent.id)
      : this.domain.updates.listForCommitment(parent.id)
    return updates.filter((update) => this.sensitivity.canRead('update', update.id, access))
      .map((update) => {
        try {
          const document = this.domain.richTextDocuments.get({
            type: 'update', id: update.id, field: 'observation'
          })
          if (!includeRichText) {
            onMoveRichTextDocumentFromStored(document.value)
            return readableUpdateProjection(update, document.revision)
          }
          return updateProjection(
            update,
            document
          )
        } catch (error) {
          warnings.push(
            `Update ${update.id} contains unsupported rich text. Its compact readable ` +
            `projection was returned instead; other Thread data is unaffected. ` +
            `Detail: ${error instanceof Error ? error.message : String(error)}`
          )
          return readableUpdateProjection(update)
        }
      })
  }

  private visibleTodos(parent: TodoParent, access: OnMoveAccessPolicy): unknown[] {
    return this.domain.todos.list(parent)
      .filter((todo) => this.sensitivity.canRead('todo', todo.id, access))
      .map((todo) => plainProjection(todo))
  }

  private visibleNotes(
    parent: { type: 'focus' | 'thread' | 'commitment'; id: number },
    access: OnMoveAccessPolicy,
    includeRichText = false,
    warnings: string[] = []
  ): unknown[] {
    return this.domain.notes.list(parent)
      .filter((note) => this.sensitivity.canRead('note', note.id, access))
      .map((note) => {
        const plain = readableNoteProjection(note)
        try {
          if (!includeRichText) {
            onMoveRichTextDocumentFromStored(note.content)
            return plain
          }
          return { ...plain, richText: onMoveRichTextDocumentFromStored(note.content) }
        } catch (error) {
          warnings.push(
            `Note ${note.id} contains unsupported rich text. Its compact readable ` +
            `projection was returned instead; other Thread data is unaffected. ` +
            `Detail: ${error instanceof Error ? error.message : String(error)}`
          )
          return plain
        }
      })
  }

  private threadCandidates(
    selector: ApplicationEntitySelector,
    focusSelector: ApplicationEntitySelector | undefined,
    access: OnMoveAccessPolicy
  ): ApplicationThreadCandidate[] {
    if (selector.title === undefined || selector.id !== undefined) return []
    const candidates: Array<ApplicationThreadCandidate & { score: number }> = []
    for (const focus of this.domain.focuses.list()) {
      if (focusSelector && !matchesEntitySelector(focus, focusSelector)) continue
      if (!this.sensitivity.canRead('focus', focus.id, access)) continue
      for (const thread of this.domain.threads.listForFocus(focus.id)) {
        if (!this.sensitivity.canRead('thread', thread.id, access)) continue
        const score = shorthandThreadScore(selector.title, thread.title)
        if (score <= 0 || matchesEntitySelector(thread, selector)) continue
        const applicableSubjects = this.domain.threadScopes.get(thread.id).subjects
          .filter((subject) => this.sensitivity.canReadInContext(
            'subject', subject.id, access, { focusId: focus.id, threadId: thread.id }
          ))
          .map((subject) => ({ id: subject.id, name: subject.name }))
        candidates.push({
          hierarchy: {
            focus: { id: focus.id, title: focus.title },
            thread: { id: thread.id, title: thread.title }
          },
          displayPath: `${focus.title} > ${thread.title}`,
          applicableSubjects,
          score
        })
      }
    }
    return candidates
      .sort((left, right) => right.score - left.score ||
        left.displayPath.localeCompare(right.displayPath, undefined, { sensitivity: 'base' }))
      .slice(0, 10)
      .map((candidate) => ({
        hierarchy: candidate.hierarchy,
        displayPath: candidate.displayPath,
        applicableSubjects: candidate.applicableSubjects
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

  createFocus(
    input: CreateApplicationFocus,
    access: OnMoveAccessPolicy,
    clientName?: string
  ): FocusSnapshot {
    this.assertCreateAt('focus', { focusId: null, threadId: null }, access)
    this.assertSensitiveWrite(input.sensitive, access)
    let description = input.description
    if (input.descriptionRichText !== undefined) {
      try {
        description = onMoveRichTextDocumentToStored(input.descriptionRichText)
      } catch (error) {
        throw new ModelValidationError(
          `Focus description rich text is invalid: ${error instanceof Error ? error.message : String(error)}`
        )
      }
    }
    return this.database.transaction(() => {
      const created = this.domain.focuses.create({ ...input, description }).toSnapshot()
      this.auditMutation('onmove.create_focus', 'focus', created.id, 'create', access, clientName)
      return created
    })
  }

  updateFocus(
    id: number,
    input: UpdateApplicationFocus,
    access: OnMoveAccessPolicy,
    clientName?: string
  ): FocusSnapshot {
    this.assertEditPermission('focus', id, access)
    this.assertSensitiveWrite(input.sensitive, access)
    return this.database.transaction(() => {
      const updated = this.domain.focuses.requireModel(id).update(input).toSnapshot()
      this.auditMutation('onmove.update_focus', 'focus', id, 'update', access, clientName)
      return updated
    })
  }

  createThread(
    input: CreateApplicationThread,
    access: OnMoveAccessPolicy,
    clientName?: string
  ): unknown {
    const focus = this.domain.focuses.find(input.focusId)
    if (!focus || !this.sensitivity.canRead('focus', focus.id, {
      ...access,
      permissionPolicy: undefined
    })) throw new ModelNotFoundError('Focus', input.focusId)
    this.assertCreateAt('thread', { focusId: focus.id, threadId: null }, access)
    this.assertSensitiveWrite(input.sensitive, access)
    return this.database.transaction(() => {
      const created = this.domain.threads.create(input).snapshot()
      this.auditMutation('onmove.create_thread', 'thread', created.id, 'create', access, clientName)
      return created
    })
  }

  updateThread(
    id: number,
    input: UpdateApplicationThread,
    access: OnMoveAccessPolicy,
    clientName?: string
  ): unknown {
    this.assertEditPermission('thread', id, access)
    this.assertSensitiveWrite(input.sensitive, access)
    return this.database.transaction(() => {
      const updated = this.domain.threads.requireModel(id).update(input).snapshot()
      this.auditMutation('onmove.update_thread', 'thread', id, 'update', access, clientName)
      return updated
    })
  }

  reparentThread(
    input: ReparentApplicationThread,
    access: OnMoveAccessPolicy,
    clientName?: string
  ): ReparentApplicationThreadResult {
    this.assertEditPermission('thread', input.id, access)
    assertPositiveId(input.focusId, 'destination focus id')
    const destinationFocus = this.domain.focuses.find(input.focusId)
    if (!destinationFocus || !this.sensitivity.canRead('focus', destinationFocus.id, {
      ...access,
      permissionPolicy: undefined
    })) {
      throw new ModelNotFoundError('Focus', input.focusId)
    }
    this.assertCreateAt('thread', { focusId: destinationFocus.id, threadId: null }, access)
    const plan = this.domain.threads.planMove(input.id, input.focusId)
    if (plan.scopeSubjectAdditions.some((subject) =>
      !this.sensitivity.canReadInContext('subject', subject.id, access, {
        focusId: plan.fromFocusId,
        threadId: input.id
      }))) {
      throw new ModelValidationError(
        'Thread reparenting requires Scope changes that are not visible under current MCP access'
      )
    }
    if (plan.fromFocusId === plan.toFocusId) {
      return {
        thread: this.domain.threads.requireModel(input.id).snapshot(),
        previousFocusId: plan.fromFocusId,
        changed: false
      }
    }
    return this.database.transaction(() => {
      const moved = this.domain.threads.move(input.id, {
        focusId: input.focusId,
        plannedFromFocusId: input.plannedFromFocusId,
        confirmedScopeSubjectIds: input.confirmedScopeSubjectIds
      })
      this.auditMutation(
        'onmove.reparent_thread', 'thread', input.id, 'reparent', access, clientName
      )
      return {
        thread: moved,
        previousFocusId: plan.fromFocusId,
        changed: true
      }
    })
  }

  createCommitment(
    input: CreateApplicationCommitment,
    access: OnMoveAccessPolicy,
    clientName?: string
  ): unknown {
    if (input.parent.type !== 'thread') {
      throw new ModelValidationError('A Commitment must belong to one Thread')
    }
    this.assertVisibleParent(input.parent, access)
    this.assertCreateAt(
      'commitment', this.sensitivity.contextFor('thread', input.parent.id), access
    )
    this.assertSensitiveWrite(input.sensitive, access)
    return this.database.transaction(() => {
      const created = this.domain.commitments.create(input).snapshot()
      this.auditMutation(
        'onmove.create_commitment', 'commitment', created.id, 'create', access, clientName
      )
      return created
    })
  }

  updateCommitment(
    id: number,
    input: UpdateApplicationCommitment,
    access: OnMoveAccessPolicy,
    clientName?: string
  ): unknown {
    this.assertEditPermission('commitment', id, access)
    this.assertSensitiveWrite(input.sensitive, access)
    return this.database.transaction(() => {
      const updated = this.domain.commitments.requireModel(id).update(input).snapshot()
      this.auditMutation(
        'onmove.update_commitment', 'commitment', id, 'update', access, clientName
      )
      return updated
    })
  }

  createRoutine(
    input: CreateApplicationRoutine,
    access: OnMoveAccessPolicy,
    clientName?: string
  ): unknown {
    if (input.parent.type !== 'thread') {
      throw new ModelValidationError('A Routine must belong to one Thread')
    }
    this.assertVisibleParent(input.parent, access)
    this.assertCreateAt('routine', this.sensitivity.contextFor('thread', input.parent.id), access)
    this.assertSensitiveWrite(input.sensitive, access)
    return this.database.transaction(() => {
      const created = this.domain.routines.create(input).snapshot()
      this.auditMutation('onmove.create_routine', 'routine', created.id, 'create', access, clientName)
      return created
    })
  }

  updateRoutine(
    id: number,
    input: UpdateApplicationRoutine,
    access: OnMoveAccessPolicy,
    clientName?: string
  ): unknown {
    this.assertEditPermission('routine', id, access)
    this.assertSensitiveWrite(input.sensitive, access)
    return this.database.transaction(() => {
      const updated = this.domain.routines.requireModel(id).update(input).snapshot()
      this.auditMutation('onmove.update_routine', 'routine', id, 'update', access, clientName)
      return updated
    })
  }

  updateUpdate(
    input: UpdateApplicationUpdate,
    access: OnMoveAccessPolicy,
    clientName?: string
  ): UpdateSnapshot {
    this.assertEditPermission('update', input.id, access)
    this.assertSensitiveWrite(input.sensitive, access)
    return this.database.transaction(() => {
      const updated = this.domain.updates.requireModel(input.id).update({
        date: input.date,
        state: input.state,
        sensitive: input.sensitive
      }).toSnapshot()
      this.auditMutation('onmove.update_update', 'update', input.id, 'update', access, clientName)
      return updated
    })
  }

  createUpdate(
    input: CreateApplicationUpdate,
    access: OnMoveAccessPolicy,
    clientName?: string
  ): ApplicationUpdateSnapshot {
    this.assertVisibleParent(input.parent, access)
    this.assertCreatePermission('update', input.parent, access)
    this.assertVisibleSubject(input.parent, input.subjectId, access)
    this.assertSemanticTarget(input.parent, input.subjectId, input.semanticPath)
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

  reparentUpdate(
    input: ReparentApplicationUpdate,
    access: OnMoveAccessPolicy,
    clientName?: string
  ): ReparentApplicationUpdateResult {
    this.assertEditPermission('update', input.id, access)
    this.assertVisibleParent(input.parent, access)
    this.assertCreatePermission('update', input.parent, access)
    this.assertVisibleSubject(input.parent, input.subjectId, access)
    this.assertSemanticTarget(input.parent, input.subjectId, input.semanticPath)
    const current = this.domain.updates.find(input.id)
    if (!current || current.parent.type === 'focus') {
      throw new ModelNotFoundError('Update', input.id)
    }
    const previousParent: { type: 'thread' | 'commitment'; id: number } = current.parent
    const scope = this.resolveScopeCell(
      input.parent,
      input.subjectId,
      current.date,
      'writeGuide.createUpdate'
    )
    return this.database.transaction(() => {
      const updated = this.domain.updates.requireModel(input.id)
        .reparent(input.parent, scope)
        .toSnapshot()
      this.audit.record({
        toolName: 'onmove.reparent_update', entityType: 'update', entityId: input.id,
        category: 'reparent', clientName,
        affectedSensitive: Boolean(this.sensitivity.isSensitive('update', input.id))
      })
      return {
        update: updateProjection(updated, this.domain.richTextDocuments.get({
          type: 'update', id: input.id, field: 'observation'
        })),
        previous: {
          parent: previousParent,
          subjectId: current.scope?.subjectId ?? null
        }
      }
    })
  }

  createTodo(
    input: CreateApplicationTodo,
    access: OnMoveAccessPolicy,
    clientName?: string
  ): TodoSnapshot {
    this.assertVisibleParent(input.parent, access)
    this.assertCreatePermission('todo', input.parent, access)
    this.assertVisibleSubject(input.parent, input.subjectId, access)
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
    this.assertEditPermission('todo', input.id, access)
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

  deleteEntity(
    reference: ApplicationDeletableEntityReference,
    access: OnMoveAccessPolicy,
    clientName?: string
  ): ApplicationDeleteEntityResult {
    this.assertDeletePermission(reference.type, reference.id, access)
    const affectedSensitive = Boolean(this.sensitivity.isSensitive(
      reference.type,
      reference.id
    ))
    return this.database.transaction(() => {
      const deleted = this.deletePersistedEntity(reference)
      if (!deleted) {
        const label = reference.type[0].toUpperCase() + reference.type.slice(1)
        throw new ModelNotFoundError(label, reference.id)
      }
      this.audit.record({
        toolName: 'onmove.delete_entity',
        entityType: reference.type,
        entityId: reference.id,
        category: 'delete',
        clientName,
        affectedSensitive
      })
      return {
        deleted: true,
        reference: structuredClone(reference),
        updatesUseArchive: ['focus', 'thread', 'commitment', 'routine', 'update']
          .includes(reference.type),
        archiveRetentionDays: UPDATE_ARCHIVE_RETENTION_DAYS,
        descendantRecordsMayBeDeleted: ['focus', 'thread', 'commitment', 'routine']
          .includes(reference.type)
      }
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
    this.assertEditPermission(reference.type, reference.id, access)
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
    assertPositiveId(input.id, 'note id')
    if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) {
      throw new ModelValidationError('expected Note revision must be a non-negative integer')
    }
    this.assertEditPermission('note', input.id, access)
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
    this.assertVisibleParent(input.target, access)
    this.assertEditPermission(input.target.type, input.target.id, access)
    this.assertVisibleSubject(input.target, input.subjectId, access)
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

  private assertEditPermission(
    resource: SensitiveEntityType,
    id: number,
    access: OnMoveAccessPolicy
  ): void {
    assertPositiveId(id, `${resource} id`)
    if (!this.sensitivity.canRead(resource, id, access)) {
      const label = resource[0].toUpperCase() + resource.slice(1)
      throw new ModelNotFoundError(label, id)
    }
    if (!access.permissionPolicy && access.mutations !== 'allow') {
      throw new ModelValidationError('MCP mutations are disabled in OnMove settings')
    }
    if (!this.sensitivity.canEdit(resource, id, access)) {
      throw new ModelValidationError(
        `MCP ${resource} editing is disabled for this item in OnMove settings`
      )
    }
  }

  private assertDeletePermission(
    resource: SensitiveEntityType,
    id: number,
    access: OnMoveAccessPolicy
  ): void {
    assertPositiveId(id, `${resource} id`)
    if (!this.sensitivity.canRead(resource, id, access)) {
      const label = resource[0].toUpperCase() + resource.slice(1)
      throw new ModelNotFoundError(label, id)
    }
    if (!access.permissionPolicy && access.mutations !== 'allow') {
      throw new ModelValidationError('MCP mutations are disabled in OnMove settings')
    }
    if (!this.sensitivity.canDelete(resource, id, access)) {
      throw new ModelValidationError(
        `MCP ${resource} deletion is disabled for this item in OnMove settings`
      )
    }
  }

  private deletePersistedEntity(reference: ApplicationDeletableEntityReference): boolean {
    switch (reference.type) {
      case 'focus': return this.domain.focuses.delete(reference.id)
      case 'thread': return this.domain.threads.delete(reference.id)
      case 'commitment': return this.domain.commitments.delete(reference.id)
      case 'routine': return this.domain.routines.delete(reference.id)
      case 'update': return this.domain.updates.delete(reference.id)
      case 'todo': return this.domain.todos.delete(reference.id)
      case 'note': return this.domain.notes.delete(reference.id)
      case 'subject': return this.domain.subjects.delete(reference.id)
    }
  }

  private assertCreatePermission(
    resource: 'update' | 'todo',
    parent: { type: 'thread' | 'commitment'; id: number },
    access: OnMoveAccessPolicy
  ): void {
    if (!access.permissionPolicy && access.mutations !== 'allow') {
      throw new ModelValidationError('MCP mutations are disabled in OnMove settings')
    }
    const context = this.sensitivity.contextFor(parent.type, parent.id)
    if (!this.sensitivity.canEditResource(resource, access, context)) {
      throw new ModelValidationError(
        `MCP ${resource} editing is disabled for this ${parent.type} in OnMove settings`
      )
    }
  }

  private assertCreateAt(
    resource: SensitiveEntityType,
    context: { focusId: number | null; threadId: number | null },
    access: OnMoveAccessPolicy
  ): void {
    if (!access.permissionPolicy && access.mutations !== 'allow') {
      throw new ModelValidationError('MCP mutations are disabled in OnMove settings')
    }
    if (!this.sensitivity.canEditResource(resource, access, context)) {
      throw new ModelValidationError(
        `MCP ${resource} editing is disabled for this hierarchy in OnMove settings`
      )
    }
  }

  private assertSensitiveWrite(value: boolean | undefined, access: OnMoveAccessPolicy): void {
    if (value === true && access.sensitiveContent === 'deny') {
      throw new ModelValidationError('MCP sensitive-content access is disabled')
    }
  }

  private assertVisibleSubject(
    parent: { type: 'thread' | 'commitment'; id: number },
    subjectId: number | undefined,
    access: OnMoveAccessPolicy
  ): void {
    if (subjectId === undefined) return
    assertPositiveId(subjectId, 'subject id')
    if (!this.sensitivity.canReadInContext(
      'subject', subjectId, access, this.sensitivity.contextFor(parent.type, parent.id)
    )) {
      throw new ModelNotFoundError('Subject', subjectId)
    }
  }

  private assertSemanticTarget(
    parent: { type: 'thread' | 'commitment'; id: number },
    subjectId: number | undefined,
    semanticPath: ApplicationSemanticTargetPath | undefined
  ): void {
    if (!semanticPath) return
    assertPositiveId(semanticPath.thread.id, 'semantic path thread id')
    if (semanticPath.focus) assertPositiveId(semanticPath.focus.id, 'semantic path focus id')
    if (semanticPath.commitment) {
      assertPositiveId(semanticPath.commitment.id, 'semantic path commitment id')
    }
    if (semanticPath.subject) {
      assertPositiveId(semanticPath.subject.id, 'semantic path subject id')
    }
    const actualContext = this.sensitivity.contextFor(parent.type, parent.id)
    const expectedParentMatches = parent.type === 'thread'
      ? parent.id === semanticPath.thread.id && semanticPath.commitment === undefined
      : parent.id === semanticPath.commitment?.id &&
        actualContext.threadId === semanticPath.thread.id
    const focusMatches = semanticPath.focus === undefined ||
      actualContext.focusId === semanticPath.focus.id
    if (!expectedParentMatches || !focusMatches) {
      throw new SemanticTargetValidationError(
        'The create target does not match semanticPath. Do not flatten or redirect a named ' +
        'Thread/Commitment/Subject path; use the parent from hierarchy discovery.',
        {
          code: 'semantic_path_parent_mismatch',
          parent,
          subjectId: subjectId ?? null,
          semanticPath: structuredClone(semanticPath)
        }
      )
    }
    if (semanticPath.subject && subjectId === undefined) {
      throw new SemanticTargetValidationError(
        `semanticPath names Subject ${semanticPath.subject.name} (${semanticPath.subject.id}), ` +
        'so an unscoped Update is unsafe. Use attribution.mode="subject" with that Subject ID.',
        {
          code: 'semantic_path_requires_subject_attribution',
          parent,
          subjectId: null,
          semanticPath: structuredClone(semanticPath)
        }
      )
    }
    if (semanticPath.subject && subjectId !== semanticPath.subject.id) {
      throw new SemanticTargetValidationError(
        `semanticPath names Subject ${semanticPath.subject.name} (${semanticPath.subject.id}), ` +
        `but the write targets Subject ${subjectId}. Preserve the requested Subject cell.`,
        {
          code: 'semantic_path_subject_mismatch',
          parent,
          subjectId: subjectId ?? null,
          semanticPath: structuredClone(semanticPath)
        }
      )
    }
  }

  private auditMutation(
    toolName: string,
    entityType: SensitiveEntityType,
    entityId: number,
    category: string,
    access: OnMoveAccessPolicy,
    clientName?: string
  ): void {
    this.audit.record({
      toolName,
      entityType,
      entityId,
      category,
      clientName,
      affectedSensitive: Boolean(this.sensitivity.isSensitive(entityType, entityId))
    })
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
