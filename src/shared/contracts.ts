export const IPC_CHANNELS = {
  getAppState: 'app:get-state',
  getSensitiveContentHidden: 'app:get-sensitive-content-hidden',
  recordGreeting: 'app:record-greeting',
  showDataFolder: 'app:show-data-folder',
  getBackupState: 'backup:get-state',
  createBackup: 'backup:create',
  showBackupFolder: 'backup:show-folder',
  createRelation: 'domain:create-relation',
  deleteRelation: 'domain:delete-relation',
  createItem: 'domain:create-item',
  getItem: 'domain:get-item',
  deleteItem: 'domain:delete-item',
  moveItem: 'domain:move-item',
  setItemRelation: 'domain:set-item-relation',
  setItemStatus: 'domain:set-item-status',
  getItemStatusHistory: 'domain:get-item-status-history',
  listFocuses: 'domain:list-focuses',
  createFocus: 'domain:create-focus',
  updateFocus: 'domain:update-focus',
  pokeFocusReview: 'domain:poke-focus-review',
  setFocusStatus: 'domain:set-focus-status',
  deleteFocus: 'domain:delete-focus',
  getFocusStatusHistory: 'domain:get-focus-status-history',
  getFocusScope: 'domain:get-focus-scope',
  addFocusScopeSubject: 'domain:add-focus-scope-subject',
  removeFocusScopeSubject: 'domain:remove-focus-scope-subject',
  getThreadScope: 'domain:get-thread-scope',
  getThreadSubjectMatrix: 'domain:get-thread-subject-matrix',
  customizeThreadScope: 'domain:customize-thread-scope',
  addThreadScopeSubject: 'domain:add-thread-scope-subject',
  removeThreadScopeSubject: 'domain:remove-thread-scope-subject',
  followFocusThreadScope: 'domain:follow-focus-thread-scope',
  listThreads: 'domain:list-threads',
  createThread: 'domain:create-thread',
  updateThread: 'domain:update-thread',
  planThreadMove: 'domain:plan-thread-move',
  moveThread: 'domain:move-thread',
  pokeThreadReview: 'domain:poke-thread-review',
  deleteThread: 'domain:delete-thread',
  listCommitments: 'domain:list-commitments',
  getCommitmentWorkingContext: 'domain:get-commitment-working-context',
  createCommitment: 'domain:create-commitment',
  updateCommitment: 'domain:update-commitment',
  planCommitmentMove: 'domain:plan-commitment-move',
  moveCommitment: 'domain:move-commitment',
  pokeCommitmentReview: 'domain:poke-commitment-review',
  deleteCommitment: 'domain:delete-commitment',
  listUpdates: 'domain:list-updates',
  createUpdate: 'domain:create-update',
  updateUpdate: 'domain:update-update',
  deleteUpdate: 'domain:delete-update',
  getArchivedUpdateOverview: 'domain:get-archived-update-overview',
  deleteArchivedUpdate: 'domain:delete-archived-update',
  clearArchivedUpdates: 'domain:clear-archived-updates',
  listTodos: 'domain:list-todos',
  queryTodos: 'domain:query-todos',
  getTodoOverview: 'domain:get-todo-overview',
  createTodo: 'domain:create-todo',
  updateTodo: 'domain:update-todo',
  updateTodoSubjectCompletion: 'domain:update-todo-subject-completion',
  reorderTodos: 'domain:reorder-todos',
  deleteTodo: 'domain:delete-todo',
  listNotes: 'domain:list-notes',
  listTags: 'domain:list-tags',
  listTagUses: 'domain:list-tag-uses',
  getNavigationBadgeOverview: 'domain:get-navigation-badge-overview',
  getReviewOverview: 'domain:get-review-overview',
  getDueOverview: 'domain:get-due-overview',
  getRichTextDocument: 'rich-text:get-document',
  openRichTextDocumentWindow: 'rich-text:open-window',
  getRichTextWindowTarget: 'rich-text:get-window-target'
} as const

export const IPC_SYNC_CHANNELS = {
  saveRichTextDocument: 'rich-text:save-document-sync'
} as const

export const IPC_EVENTS = {
  sensitiveContentVisibilityChanged: 'app:sensitive-content-visibility-changed',
  navigationBadgesInvalidated: 'app:navigation-badges-invalidated',
  richTextDocumentChanged: 'rich-text:document-changed'
} as const

export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[]

export interface JsonObject {
  [key: string]: JsonValue
}

export interface RelationSnapshot {
  id: number
  name: string
  meta: JsonObject
  createdAt: string
  updatedAt: string
}

export interface StatusTransition {
  id: number
  itemId: number
  from: string | null
  to: string | null
  changedAt: string
  meta: JsonObject
}

/** A UI-ready projection of the current status, backed by an immutable event log. */
export interface MaterializedStatus {
  current: string | null
  previous: string | null
  changedAt: string | null
  transitionCount: number
  lastTransition: StatusTransition | null
}

/**
 * The recursive shape consumed by the renderer. `items` contains children and
 * `relation` is already resolved, so rendering does not require extra lookups.
 */
export interface ItemSnapshot {
  id: number
  parentId: number | null
  relationId: number | null
  relation: RelationSnapshot | null
  meta: JsonObject
  status: MaterializedStatus
  items: ItemSnapshot[]
  createdAt: string
  updatedAt: string
}

export interface CreateRelationInput {
  name: string
  meta?: JsonObject
}

export interface CreateItemInput {
  parentId?: number | null
  relationId?: number | null
  status?: string | null
  meta?: JsonObject
  statusMeta?: JsonObject
}

export interface SetItemStatusInput {
  status: string | null
  meta?: JsonObject
}

export const FOCUS_KINDS = ['generic'] as const
export type FocusKind = (typeof FOCUS_KINDS)[number]

export const FOCUS_STATUSES = ['active', 'paused', 'cancelled', 'done'] as const
export type FocusStatus = (typeof FOCUS_STATUSES)[number]

export interface FocusSnapshot {
  id: number
  kind: FocusKind
  title: string
  description: string | null
  goal: string
  status: FocusStatus
  dueDate: string | null
  statusChangedAt: string
  lastReviewDate: string | null
  needsReview: boolean
  sensitive: boolean
  notes: NoteSnapshot[]
  createdAt: string
  updatedAt: string
}

export interface FocusStatusTransition {
  id: number
  focusId: number
  from: FocusStatus | null
  to: FocusStatus
  changedAt: string
}

export interface CreateFocusInput {
  kind?: FocusKind
  title: string
  description?: string | null
  goal?: string
  status?: FocusStatus
  dueDate?: string | null
  needsReview?: boolean
  sensitive?: boolean
}

export interface UpdateFocusInput {
  title?: string
  description?: string | null
  goal?: string
  status?: FocusStatus
  dueDate?: string | null
  needsReview?: boolean
  sensitive?: boolean
}

export type ThreadStatus = FocusStatus
export type CommitmentStatus = FocusStatus

export const HEALTH_STATES = ['red', 'yellow', 'green', 'none'] as const
export type HealthState = (typeof HEALTH_STATES)[number]

export const COMMITMENT_TYPES = ['action', 'ongoing'] as const
export type CommitmentType = (typeof COMMITMENT_TYPES)[number]

export const SCOPE_SOURCE_TYPES = ['explicit', 'derived'] as const
export type ScopeSourceType = (typeof SCOPE_SOURCE_TYPES)[number]

export const SCOPE_MODES = ['open', 'inherited', 'explicit', 'derived'] as const
export type ScopeMode = (typeof SCOPE_MODES)[number]

export const SCOPE_MEMBERSHIP_EFFECTS = ['include', 'exclude'] as const
export type ScopeMembershipEffect = (typeof SCOPE_MEMBERSHIP_EFFECTS)[number]

export interface SubjectSnapshot {
  id: number
  kind: string
  name: string
  description: string | null
  externalKey: string | null
  sensitive: boolean
  createdAt: string
  updatedAt: string
}

export interface CreateSubjectInput {
  kind?: string
  name: string
  description?: string | null
  externalKey?: string | null
  sensitive?: boolean
}

export interface UpdateSubjectInput {
  kind?: string
  name?: string
  description?: string | null
  externalKey?: string | null
  sensitive?: boolean
}

export interface ScopeSnapshot {
  id: number
  focusId: number
  name: string
  dimension: string
  sourceType: ScopeSourceType
  baseScopeId: number | null
  derivedRelationship: string | null
  contextSubjectId: number | null
  sensitive: boolean
  createdAt: string
  updatedAt: string
}

export interface CreateScopeInput {
  focusId: number
  name: string
  dimension: string
  sourceType?: ScopeSourceType
  baseScopeId?: number | null
  derivedRelationship?: string | null
  contextSubjectId?: number | null
  sensitive?: boolean
}

export interface UpdateScopeInput {
  name?: string
  dimension?: string
  baseScopeId?: number | null
  derivedRelationship?: string | null
  contextSubjectId?: number | null
  sensitive?: boolean
}

export interface ScopeMembershipSnapshot {
  id: number
  scopeId: number
  subjectId: number
  effect: ScopeMembershipEffect
  effectiveFrom: string
  effectiveUntil: string | null
  createdAt: string
}

export interface CreateScopeMembershipInput {
  scopeId: number
  subjectId: number
  effect?: ScopeMembershipEffect
  effectiveFrom?: string
  effectiveUntil?: string | null
}

export interface EndScopeMembershipInput {
  effectiveUntil: string
}

export type ScopeOwner =
  | { type: 'focus'; id: number }
  | { type: 'thread'; id: number }
  | { type: 'commitment'; id: number }

export interface SetScopeApplicationInput {
  mode: ScopeMode
  scopeId?: number | null
}

export interface ScopeApplicationSnapshot {
  owner: ScopeOwner
  mode: ScopeMode
  declaredScopeId: number | null
  effectiveScopeId: number | null
  inheritedFrom: ScopeOwner | null
  updatedAt: string
}

export interface ScopeApplicationState {
  mode: ScopeMode
  scopeId: number | null
}

export interface ScopeApplicationTransition {
  id: number
  owner: ScopeOwner
  from: ScopeApplicationState | null
  to: ScopeApplicationState
  changedAt: string
}

/** The bounded Subject set currently applied directly to a Focus. */
export interface FocusScopeSnapshot {
  focusId: number
  mode: Exclude<ScopeMode, 'inherited'>
  scopeId: number | null
  subjects: SubjectSnapshot[]
}

export interface AddFocusScopeSubjectInput {
  name: string
}

/** A Thread's current applicability plus the Subjects offered by its Focus. */
export interface ThreadScopeSnapshot {
  threadId: number
  focusId: number
  mode: ScopeMode
  scopeId: number | null
  subjects: SubjectSnapshot[]
  focusSubjects: SubjectSnapshot[]
}

export interface UpdateScopeCell {
  scopeId: number
  subjectId: number
}

export interface CommitmentScopeCellSnapshot extends UpdateScopeCell {
  subject: SubjectSnapshot
  state: HealthState
  lastReviewDate: string | null
  nextReviewDate: string
  reviewDue: boolean
  lastUpdateDate: string | null
  nextUpdateDate: string | null
  needsUpdate: boolean
}

/** UI-ready current Scope projection for recording exact-cell Commitment evidence. */
export interface CommitmentWorkingContextSnapshot {
  commitmentId: number
  scopeId: number | null
  cells: CommitmentScopeCellSnapshot[]
}

export interface ThreadScopeCellSnapshot extends UpdateScopeCell {
  subject: SubjectSnapshot
  state: HealthState
  lastReviewDate: string | null
  nextReviewDate: string
  reviewDue: boolean
}

/** A Commitment's projection inside one canonical Subject lens on its parent Thread. */
export interface ThreadSubjectCommitmentCellSnapshot extends UpdateScopeCell {
  commitmentId: number
  state: HealthState
  lastUpdateDate: string | null
  nextUpdateDate: string | null
  needsUpdate: boolean
}

/**
 * One operational Subject lens for a bounded Thread. The Thread cell owns direct
 * review evidence; `commitments` contains only bounded child Commitments whose
 * current Scope also includes this canonical Subject.
 */
export interface ThreadSubjectCellSnapshot extends ThreadScopeCellSnapshot {
  commitments: ThreadSubjectCommitmentCellSnapshot[]
}

export interface ThreadSnapshot {
  id: number
  focusId: number
  title: string
  health: HealthState
  status: ThreadStatus
  dueDate: string | null
  reviewFrequencyDays: number
  lastReviewDate: string | null
  nextReviewDate: string
  needsReview: boolean
  reviewDue: boolean
  sensitive: boolean
  notes: NoteSnapshot[]
  createdAt: string
  updatedAt: string
}

export interface CreateThreadInput {
  focusId: number
  title: string
  status?: ThreadStatus
  dueDate?: string | null
  reviewFrequencyDays: number
  needsReview?: boolean
  sensitive?: boolean
  scope?: SetScopeApplicationInput
}

export interface UpdateThreadInput {
  title?: string
  status?: ThreadStatus
  dueDate?: string | null
  reviewFrequencyDays?: number
  needsReview?: boolean
  sensitive?: boolean
}

export interface ThreadMoveOwnedRecordsSnapshot {
  commitments: number
  updates: number
  todos: number
  notes: number
}

/**
 * Read-only preview of a cross-Focus Thread move. Inherited Threads follow the
 * destination Focus and may require explicit Subject widening. Custom Scope
 * definitions are copied into the destination Focus without widening its
 * aggregate Scope.
 */
export interface ThreadMovePlanSnapshot {
  threadId: number
  fromFocusId: number
  toFocusId: number
  sourceScopeMode: ScopeMode
  sourceScopeId: number | null
  targetScopeId: number | null
  scopeStrategy: 'follow-destination' | 'copy-custom'
  scopeSubjectAdditions: SubjectSnapshot[]
  ownedRecords: ThreadMoveOwnedRecordsSnapshot
  requiresConfirmation: boolean
}

export interface MoveThreadInput {
  focusId: number
  /** Guards a delayed confirmation from moving a Thread whose owner changed. */
  plannedFromFocusId: number
  /** Must exactly match the planner's additions when Focus widening is required. */
  confirmedScopeSubjectIds?: readonly number[]
}

export interface ThreadParentTransition {
  id: number
  threadId: number
  fromFocusId: number | null
  toFocusId: number
  changedAt: string
}

export type CommitmentParent =
  | { type: 'focus'; id: number }
  | { type: 'thread'; id: number }

export interface CommitmentSnapshot {
  id: number
  parent: CommitmentParent
  /** Legacy storage compatibility; user-facing behavior is derived from `dueDate`. */
  type: CommitmentType
  title: string
  status: CommitmentStatus
  state: HealthState
  dueDate: string | null
  cadenceDays: number | null
  reviewFrequencyDays: number
  /** Latest direct Update date or explicit review poke, whichever is later. */
  lastReviewDate: string | null
  nextReviewDate: string
  needsReview: boolean
  reviewDue: boolean
  lastUpdateDate: string | null
  nextUpdateDate: string | null
  needsUpdate: boolean
  sensitive: boolean
  notes: NoteSnapshot[]
  createdAt: string
  updatedAt: string
}

export interface CreateCommitmentInput {
  parent: CommitmentParent
  /** Legacy storage compatibility; callers derive this from `dueDate`. */
  type: CommitmentType
  title: string
  status?: CommitmentStatus
  dueDate?: string | null
  cadenceDays?: number | null
  reviewFrequencyDays?: number
  needsReview?: boolean
  sensitive?: boolean
}

export interface UpdateCommitmentInput {
  /** Legacy storage compatibility; callers derive this from `dueDate`. */
  type?: CommitmentType
  title?: string
  status?: CommitmentStatus
  dueDate?: string | null
  cadenceDays?: number | null
  reviewFrequencyDays?: number
  needsReview?: boolean
  sensitive?: boolean
}

export interface CommitmentMoveOwnedRecordsSnapshot {
  updates: number
  todos: number
  notes: number
}

/**
 * A read-only preview of a Commitment reparenting operation. Exact child Scope
 * attribution is retained; `scopeSubjectAdditions` is the only ancillary
 * mutation the operation may perform.
 */
export interface CommitmentMovePlanSnapshot {
  commitmentId: number
  from: CommitmentParent
  to: CommitmentParent
  sourceScopeMode: ScopeMode
  sourceScopeId: number | null
  targetScopeId: number | null
  scopeSubjectAdditions: SubjectSnapshot[]
  ownedRecords: CommitmentMoveOwnedRecordsSnapshot
  requiresConfirmation: boolean
}

export interface MoveCommitmentInput {
  parent: CommitmentParent
  /** Must exactly match the planner's additions when scope widening is required. */
  confirmedScopeSubjectIds?: readonly number[]
}

export interface CommitmentParentTransition {
  id: number
  commitmentId: number
  from: CommitmentParent | null
  to: CommitmentParent
  changedAt: string
}

export type UpdateParent =
  | { type: 'focus'; id: number }
  | { type: 'thread'; id: number }
  | { type: 'commitment'; id: number }

export interface UpdateSnapshot {
  id: number
  parent: UpdateParent
  date: string
  observation: string
  state: HealthState
  sensitive: boolean
  scope: UpdateScopeCell | null
  createdAt: string
  updatedAt: string
}

/** Exact Subject cell represented by one review-queue entry. */
export interface ReviewScopeCellSnapshot extends UpdateScopeCell {
  subject: SubjectSnapshot
}

/**
 * One review target with enough domain context to render its full working
 * surface without asking the renderer to reconstruct hierarchy ownership.
 * Thread and Commitment entries are repeated per effective Subject cell.
 */
export interface ReviewQueueItemSnapshot {
  key: string
  kind: 'focus' | 'thread' | 'commitment'
  focus: FocusSnapshot
  thread: ThreadSnapshot | null
  commitment: CommitmentSnapshot | null
  cell: ReviewScopeCellSnapshot | null
  lastReviewDate: string | null
  nextReviewDate: string | null
  due: boolean
  state: HealthState | null
  updates: UpdateSnapshot[]
  commitments: CommitmentSnapshot[]
}

export interface ReviewOverviewSnapshot {
  asOf: string
  items: ReviewQueueItemSnapshot[]
}

export type DueWorkKind = 'focus' | 'thread' | 'commitment'

/** Direct hierarchy parent used to explain deadline alignment without constraining it. */
export interface DueWorkParentSnapshot {
  kind: 'focus' | 'thread'
  title: string
  dueDate: string | null
}

/**
 * One due-dated work record with enough ownership context for global ordering,
 * mutation, sensitivity filtering, and a single atomic workspace destination.
 */
export interface DueWorkItemSnapshot {
  key: string
  kind: DueWorkKind
  focus: FocusSnapshot
  thread: ThreadSnapshot | null
  commitment: CommitmentSnapshot | null
  dueDate: string
  parent: DueWorkParentSnapshot | null
}

export interface DueOverviewSnapshot {
  asOf: string
  items: DueWorkItemSnapshot[]
}

export interface NavigationBadgeCountSnapshot {
  /** Count before applying the presentation-level sensitive-content preference. */
  total: number
  /** Count whose complete hierarchy is non-sensitive. */
  nonSensitive: number
}

/** Bounded, actionable counts for the primary application navigation. */
export interface NavigationBadgeOverviewSnapshot {
  asOf: string
  dueThrough: string
  todos: NavigationBadgeCountSnapshot
  review: NavigationBadgeCountSnapshot
  due: NavigationBadgeCountSnapshot
}

export type NoteParent =
  | { type: 'focus'; id: number }
  | { type: 'thread'; id: number }
  | { type: 'commitment'; id: number }

export interface NoteSnapshot {
  id: number
  parent: NoteParent
  title: string
  content: string
  revision: number
  sort: number
  createdAt: string
  updatedAt: string
}

export type TagUseSource =
  | { type: 'focus'; id: number; field: 'title' | 'description' | 'goal' }
  | { type: 'thread'; id: number; field: 'title' }
  | { type: 'commitment'; id: number; field: 'title' }
  | { type: 'update'; id: number; field: 'observation' }
  | { type: 'todo'; id: number; field: 'name' }
  | { type: 'note'; id: number; field: 'title' | 'content' }

export interface TagUseFocusSnapshot {
  id: number
  title: string
  sensitive: boolean
}

export interface TagUseThreadSnapshot {
  id: number
  title: string
  sensitive: boolean
}

export interface TagUseCommitmentSnapshot {
  id: number
  title: string
  sensitive: boolean
}

/** Resolved hierarchy needed to open the record's containing workspace. */
export interface TagUseContextSnapshot {
  focus: TagUseFocusSnapshot
  thread: TagUseThreadSnapshot | null
  commitment: TagUseCommitmentSnapshot | null
  subject: SubjectSnapshot | null
}

/** One canonical tag use per field, projected to a compact plain-text snippet. */
export interface TagUseSnapshot {
  id: string
  name: string
  source: TagUseSource
  context: TagUseContextSnapshot
  snippet: string
  effectiveSensitive: boolean
}

/** Lowercase canonical identity; sensitive counts let the renderer own visibility. */
export interface TagSummarySnapshot {
  name: string
  useCount: number
  sensitiveUseCount: number
}

export type RichTextDocumentReference =
  | { type: 'focus'; id: number; field: 'goal' | 'description' }
  | { type: 'update'; id: number; field: 'observation' }
  | { type: 'note'; id: number; field: 'content' }

export interface RichTextDocumentSnapshot {
  reference: RichTextDocumentReference
  title: string
  /** Receiver-neutral hierarchy segments for a compact document breadcrumb. */
  contextPath: string[]
  value: string
  revision: number
  updatedAt: string
}

export interface RichTextDocumentChange {
  document: RichTextDocumentSnapshot
  sourceWindowId: number
}

export interface CreateUpdateInput {
  parent: UpdateParent
  date?: string
  observation?: string
  state?: HealthState
  sensitive?: boolean
  scope?: UpdateScopeCell | null
}

export interface EditUpdateInput {
  date?: string
  observation?: string
  state?: HealthState
  sensitive?: boolean
}

/** Former hierarchy labels captured before a parent cascade removes them. */
export interface ArchivedUpdateContextSnapshot {
  focusTitle: string | null
  threadTitle: string | null
  commitmentTitle: string | null
  subjectName: string | null
}

/** Immutable Update evidence retained temporarily after leaving the live graph. */
export interface ArchivedUpdateSnapshot {
  archiveId: string
  originalUpdateId: number
  parent: UpdateParent
  scope: UpdateScopeCell | null
  date: string
  observation: string
  state: HealthState
  sensitive: boolean
  effectiveSensitive: boolean
  observationRevision: number
  createdAt: string
  updatedAt: string
  context: ArchivedUpdateContextSnapshot
  deletedAt: string
}

/** SQLite-bounded retention projection; expired rows never cross IPC. */
export interface ArchivedUpdateOverviewSnapshot {
  generatedAt: string
  retainedSince: string
  retentionDays: number
  items: ArchivedUpdateSnapshot[]
}

export type TodoEntityParent =
  | { type: 'focus'; id: number }
  | { type: 'thread'; id: number }
  | { type: 'commitment'; id: number }

/**
 * A Todo can belong to an aggregate entity or to one exact Subject cell under
 * a Thread/Commitment. Focus-level Todos are always aggregate.
 */
export type TodoParent =
  | TodoEntityParent
  | { type: 'thread-scope'; id: number; scope: UpdateScopeCell }
  | { type: 'commitment-scope'; id: number; scope: UpdateScopeCell }

export interface TodoSortPlacementSnapshot {
  context: TodoParent
  position: number
}

/** One current canonical Subject's durable completion of a shared Todo. */
export interface TodoSubjectCompletionSnapshot {
  subject: SubjectSnapshot
  done: boolean
  completedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface TodoSnapshot {
  id: number
  name: string
  parent: TodoParent
  /** Resolved canonical Subject for scoped Todos; null for aggregate Todos. */
  subject: SubjectSnapshot | null
  /** Shared parents project one independently completable cell per current Subject. */
  sharedAcrossSubjects: boolean
  subjectCompletions: TodoSubjectCompletionSnapshot[]
  dueDate: string | null
  done: boolean
  /** Set only while done; reopening clears it and completing again records a new instant. */
  completedAt: string | null
  /** Independent positions for the exact context and its aggregate rollup. */
  sort: TodoSortPlacementSnapshot[]
  createdAt: string
  updatedAt: string
}

export interface TodoOverviewFocusSnapshot {
  id: number
  title: string
  sensitive: boolean
}

export interface TodoOverviewThreadSnapshot {
  id: number
  title: string
  sensitive: boolean
}

export interface TodoOverviewCommitmentSnapshot {
  id: number
  title: string
  sensitive: boolean
}

/** One globally queryable Todo with its resolved hierarchy context. */
export interface TodoOverviewItemSnapshot extends TodoSnapshot {
  focus: TodoOverviewFocusSnapshot
  /** The direct Thread, or the owning Thread for a Commitment Todo. */
  thread: TodoOverviewThreadSnapshot | null
  commitment: TodoOverviewCommitmentSnapshot | null
}

/**
 * Bounded aggregate projection. Completed Todos older than `completedSince`
 * have already been excluded by SQLite and never cross the IPC boundary.
 */
export interface TodoOverviewSnapshot {
  items: TodoOverviewItemSnapshot[]
  today: string
  recentlyCompletedDays: number
  completedSince: string
}

export interface CreateTodoInput {
  name: string
  parent: TodoParent
  dueDate?: string | null
  done?: boolean
  /** Valid only for aggregate Thread/Commitment parents with current Subjects. */
  sharedAcrossSubjects?: boolean
}

export interface UpdateTodoInput {
  name?: string
  dueDate?: string | null
  done?: boolean
}

/** Filtering never creates a new ordering domain; it preserves the context order. */
export interface TodoListOptions {
  done?: boolean
  dueOnOrBefore?: string
  dueOnOrAfter?: string
}

export interface ThreadStatusTransition {
  id: number
  threadId: number
  from: ThreadStatus | null
  to: ThreadStatus
  changedAt: string
}

export interface CommitmentStatusTransition {
  id: number
  commitmentId: number
  from: CommitmentStatus | null
  to: CommitmentStatus
  changedAt: string
}

export interface DomainApi {
  createRelation: (input: CreateRelationInput) => Promise<RelationSnapshot>
  deleteRelation: (id: number) => Promise<boolean>
  createItem: (input: CreateItemInput) => Promise<ItemSnapshot>
  getItem: (id: number) => Promise<ItemSnapshot | null>
  deleteItem: (id: number) => Promise<boolean>
  moveItem: (id: number, parentId: number | null) => Promise<ItemSnapshot>
  setItemRelation: (id: number, relationId: number | null) => Promise<ItemSnapshot>
  setItemStatus: (id: number, input: SetItemStatusInput) => Promise<ItemSnapshot>
  getItemStatusHistory: (id: number) => Promise<StatusTransition[]>
  listFocuses: () => Promise<FocusSnapshot[]>
  createFocus: (input: CreateFocusInput) => Promise<FocusSnapshot>
  updateFocus: (id: number, input: UpdateFocusInput) => Promise<FocusSnapshot>
  pokeFocusReview: (id: number) => Promise<FocusSnapshot>
  setFocusStatus: (id: number, status: FocusStatus) => Promise<FocusSnapshot>
  deleteFocus: (id: number) => Promise<boolean>
  getFocusStatusHistory: (id: number) => Promise<FocusStatusTransition[]>
  getFocusScope: (focusId: number) => Promise<FocusScopeSnapshot>
  addFocusScopeSubject: (
    focusId: number,
    input: AddFocusScopeSubjectInput
  ) => Promise<FocusScopeSnapshot>
  removeFocusScopeSubject: (
    focusId: number,
    subjectId: number
  ) => Promise<FocusScopeSnapshot>
  getThreadScope: (threadId: number) => Promise<ThreadScopeSnapshot>
  getThreadSubjectMatrix: (threadId: number) => Promise<ThreadSubjectCellSnapshot[]>
  customizeThreadScope: (threadId: number) => Promise<ThreadScopeSnapshot>
  addThreadScopeSubject: (
    threadId: number,
    input: AddFocusScopeSubjectInput
  ) => Promise<ThreadScopeSnapshot>
  removeThreadScopeSubject: (
    threadId: number,
    subjectId: number
  ) => Promise<ThreadScopeSnapshot>
  followFocusThreadScope: (threadId: number) => Promise<ThreadScopeSnapshot>
  listThreads: (focusId: number) => Promise<ThreadSnapshot[]>
  createThread: (input: CreateThreadInput) => Promise<ThreadSnapshot>
  updateThread: (id: number, input: UpdateThreadInput) => Promise<ThreadSnapshot>
  planThreadMove: (id: number, focusId: number) => Promise<ThreadMovePlanSnapshot>
  moveThread: (id: number, input: MoveThreadInput) => Promise<ThreadSnapshot>
  pokeThreadReview: (id: number, cell?: UpdateScopeCell) => Promise<ThreadSnapshot>
  deleteThread: (id: number) => Promise<boolean>
  listCommitments: (parent: CommitmentParent) => Promise<CommitmentSnapshot[]>
  getCommitmentWorkingContext: (
    commitmentId: number
  ) => Promise<CommitmentWorkingContextSnapshot>
  createCommitment: (input: CreateCommitmentInput) => Promise<CommitmentSnapshot>
  updateCommitment: (id: number, input: UpdateCommitmentInput) => Promise<CommitmentSnapshot>
  planCommitmentMove: (
    id: number,
    parent: CommitmentParent
  ) => Promise<CommitmentMovePlanSnapshot>
  moveCommitment: (id: number, input: MoveCommitmentInput) => Promise<CommitmentSnapshot>
  pokeCommitmentReview: (id: number, cell?: UpdateScopeCell) => Promise<CommitmentSnapshot>
  deleteCommitment: (id: number) => Promise<boolean>
  listUpdates: (parent: UpdateParent) => Promise<UpdateSnapshot[]>
  createUpdate: (input: CreateUpdateInput) => Promise<UpdateSnapshot>
  updateUpdate: (id: number, input: EditUpdateInput) => Promise<UpdateSnapshot>
  deleteUpdate: (id: number) => Promise<boolean>
  getArchivedUpdateOverview: () => Promise<ArchivedUpdateOverviewSnapshot>
  deleteArchivedUpdate: (archiveId: string) => Promise<boolean>
  clearArchivedUpdates: () => Promise<number>
  listTodos: (context: TodoParent, options?: TodoListOptions) => Promise<TodoSnapshot[]>
  /** Cross-context query for future aggregate screens; each Todo appears once. */
  queryTodos: (options?: TodoListOptions) => Promise<TodoSnapshot[]>
  getTodoOverview: () => Promise<TodoOverviewSnapshot>
  createTodo: (input: CreateTodoInput) => Promise<TodoSnapshot>
  updateTodo: (id: number, input: UpdateTodoInput) => Promise<TodoSnapshot>
  updateTodoSubjectCompletion: (
    id: number,
    subjectId: number,
    done: boolean
  ) => Promise<TodoSnapshot>
  reorderTodos: (context: TodoParent, orderedTodoIds: readonly number[]) => Promise<TodoSnapshot[]>
  deleteTodo: (id: number) => Promise<boolean>
  listNotes: (parent: NoteParent) => Promise<NoteSnapshot[]>
  listTags: () => Promise<TagSummarySnapshot[]>
  listTagUses: (name: string) => Promise<TagUseSnapshot[]>
  getNavigationBadgeOverview: () => Promise<NavigationBadgeOverviewSnapshot>
  getReviewOverview: () => Promise<ReviewOverviewSnapshot>
  getDueOverview: () => Promise<DueOverviewSnapshot>
}

export interface RichTextApi {
  getDocument: (reference: RichTextDocumentReference) => Promise<RichTextDocumentSnapshot>
  /** A local SQLite commit completes before this method returns. */
  saveDocument: (
    reference: RichTextDocumentReference,
    value: string
  ) => RichTextDocumentSnapshot
  openWindow: (reference: RichTextDocumentReference) => Promise<void>
  getWindowTarget: () => Promise<RichTextDocumentReference | null>
  onDocumentChanged: (listener: (change: RichTextDocumentChange) => void) => () => void
}

export interface AppState {
  greeting: string
  greetingCount: number
  launchCount: number
  lastGreetingAt: string | null
  databasePath: string
}

export interface BackupSnapshot {
  fileName: string
  createdAt: string
  sizeBytes: number
}

export interface BackupStateSnapshot {
  automatic: true
  intervalHours: number
  retentionLimit: number
  directoryPath: string
  lastBackupAt: string | null
  nextBackupAt: string | null
  backups: BackupSnapshot[]
}

export interface BackupApi {
  getState: () => Promise<BackupStateSnapshot>
  createNow: () => Promise<BackupStateSnapshot>
  showFolder: () => Promise<void>
}

export interface OnMoveApi {
  getAppState: () => Promise<AppState>
  getSensitiveContentHidden: () => Promise<boolean>
  onSensitiveContentVisibilityChanged: (listener: (hidden: boolean) => void) => () => void
  onNavigationBadgesInvalidated: (listener: () => void) => () => void
  recordGreeting: () => Promise<AppState>
  showDataFolder: () => Promise<void>
  backups: BackupApi
  domain: DomainApi
  richText: RichTextApi
}
