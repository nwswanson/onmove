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
  getItemStatusHistory: 'domain:get-item-status-history'
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
