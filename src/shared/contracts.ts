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
  listTodos: 'domain:list-todos',
  queryTodos: 'domain:query-todos',
  getTodoOverview: 'domain:get-todo-overview',
  createTodo: 'domain:create-todo',
  updateTodo: 'domain:update-todo',
  updateTodoSubjectCompletion: 'domain:update-todo-subject-completion',
  reorderTodos: 'domain:reorder-todos',
  deleteTodo: 'domain:delete-todo',
  listNotes: 'domain:list-notes',
  getRichTextDocument: 'rich-text:get-document',
  openRichTextDocumentWindow: 'rich-text:open-window',
  getRichTextWindowTarget: 'rich-text:get-window-target'
} as const

export const IPC_SYNC_CHANNELS = {
  saveRichTextDocument: 'rich-text:save-document-sync'
} as const

export const IPC_EVENTS = {
  sensitiveContentVisibilityChanged: 'app:sensitive-content-visibility-changed',
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
  needsReview?: boolean
  sensitive?: boolean
}

export interface UpdateFocusInput {
  title?: string
  description?: string | null
  goal?: string
  status?: FocusStatus
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
  reviewFrequencyDays: number
  needsReview?: boolean
  sensitive?: boolean
  scope?: SetScopeApplicationInput
}

export interface UpdateThreadInput {
  title?: string
  status?: ThreadStatus
  reviewFrequencyDays?: number
  needsReview?: boolean
  sensitive?: boolean
}

export type CommitmentParent =
  | { type: 'focus'; id: number }
  | { type: 'thread'; id: number }

export interface CommitmentSnapshot {
  id: number
  parent: CommitmentParent
  type: CommitmentType
  title: string
  status: CommitmentStatus
  state: HealthState
  dueDate: string | null
  cadenceDays: number | null
  /** Latest direct Update date or explicit review poke, whichever is later. */
  lastReviewDate: string | null
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
  type: CommitmentType
  title: string
  status?: CommitmentStatus
  dueDate?: string | null
  cadenceDays?: number | null
  sensitive?: boolean
}

export interface UpdateCommitmentInput {
  type?: CommitmentType
  title?: string
  status?: CommitmentStatus
  dueDate?: string | null
  cadenceDays?: number | null
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

export type RichTextDocumentReference =
  | { type: 'focus'; id: number; field: 'goal' | 'description' }
  | { type: 'update'; id: number; field: 'observation' }
  | { type: 'note'; id: number; field: 'content' }

export interface RichTextDocumentSnapshot {
  reference: RichTextDocumentReference
  title: string
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
  pokeThreadReview: (id: number) => Promise<ThreadSnapshot>
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
  pokeCommitmentReview: (id: number) => Promise<CommitmentSnapshot>
  deleteCommitment: (id: number) => Promise<boolean>
  listUpdates: (parent: UpdateParent) => Promise<UpdateSnapshot[]>
  createUpdate: (input: CreateUpdateInput) => Promise<UpdateSnapshot>
  updateUpdate: (id: number, input: EditUpdateInput) => Promise<UpdateSnapshot>
  deleteUpdate: (id: number) => Promise<boolean>
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
  recordGreeting: () => Promise<AppState>
  showDataFolder: () => Promise<void>
  backups: BackupApi
  domain: DomainApi
  richText: RichTextApi
}
