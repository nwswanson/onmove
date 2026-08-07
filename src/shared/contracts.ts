export const IPC_CHANNELS = {
  getAppState: 'app:get-state',
  recordGreeting: 'app:record-greeting',
  showDataFolder: 'app:show-data-folder',
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
  setFocusStatus: 'domain:set-focus-status',
  deleteFocus: 'domain:delete-focus',
  getFocusStatusHistory: 'domain:get-focus-status-history',
  listThreads: 'domain:list-threads',
  createThread: 'domain:create-thread',
  listCommitments: 'domain:list-commitments',
  createCommitment: 'domain:create-commitment'
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
}

export interface UpdateFocusInput {
  title?: string
  description?: string | null
  goal?: string
  status?: FocusStatus
}

export type ThreadStatus = FocusStatus
export type CommitmentStatus = FocusStatus

export const HEALTH_STATES = ['red', 'yellow', 'green', 'none'] as const
export type HealthState = (typeof HEALTH_STATES)[number]

export const COMMITMENT_TYPES = ['action', 'ongoing'] as const
export type CommitmentType = (typeof COMMITMENT_TYPES)[number]

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
  createdAt: string
  updatedAt: string
}

export interface CreateThreadInput {
  focusId: number
  title: string
  status?: ThreadStatus
  reviewFrequencyDays: number
}

export interface UpdateThreadInput {
  title?: string
  status?: ThreadStatus
  reviewFrequencyDays?: number
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
  lastUpdateDate: string | null
  nextUpdateDate: string | null
  needsUpdate: boolean
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
}

export interface UpdateCommitmentInput {
  type?: CommitmentType
  title?: string
  status?: CommitmentStatus
  dueDate?: string | null
  cadenceDays?: number | null
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
  createdAt: string
}

export interface CreateUpdateInput {
  parent: UpdateParent
  date?: string
  observation: string
  state?: HealthState
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
  setFocusStatus: (id: number, status: FocusStatus) => Promise<FocusSnapshot>
  deleteFocus: (id: number) => Promise<boolean>
  getFocusStatusHistory: (id: number) => Promise<FocusStatusTransition[]>
  listThreads: (focusId: number) => Promise<ThreadSnapshot[]>
  createThread: (input: CreateThreadInput) => Promise<ThreadSnapshot>
  listCommitments: (parent: CommitmentParent) => Promise<CommitmentSnapshot[]>
  createCommitment: (input: CreateCommitmentInput) => Promise<CommitmentSnapshot>
}

export interface AppState {
  greeting: string
  greetingCount: number
  launchCount: number
  lastGreetingAt: string | null
  databasePath: string
}

export interface OnMoveApi {
  getAppState: () => Promise<AppState>
  recordGreeting: () => Promise<AppState>
  showDataFolder: () => Promise<void>
  domain: DomainApi
}
