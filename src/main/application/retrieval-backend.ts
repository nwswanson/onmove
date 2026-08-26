import type { SearchEntityType } from './search-index'

export interface RetrievalDocument {
  sourceKey: string
  kind: SearchEntityType
  entityId: number
  field: string
  title: string
  body: string
  focusId: number
  threadId: number
  commitmentId: number
  subjectId: number
  scopeId: number
  lineageKey: string
  directSensitive: boolean
  dueOn: string
  createdAt: string
  updatedAt: string
  status: string
  state: string
  embedding?: readonly number[]
}

export interface RetrievalProjectionSnapshot {
  generation: number
  documents: readonly RetrievalDocument[]
}

/**
 * Security-sensitive eligibility is expressed as an explicit source-key allowlist.
 * The other filters only reduce work inside a backend and must never replace that
 * authorization boundary.
 */
export interface RetrievalStructuralFilters {
  sourceKeys: readonly string[]
  kinds?: readonly SearchEntityType[]
  focusIds?: readonly number[]
  threadIds?: readonly number[]
  commitmentIds?: readonly number[]
  subjectIds?: readonly number[]
  scopeIds?: readonly number[]
}

interface RetrievalBackendSearchBase {
  filters: RetrievalStructuralFilters
  offset: number
  limit: number
}

export type RetrievalBackendSearch =
  | (RetrievalBackendSearchBase & {
      channel: 'lexical'
      text: string
    })
  | (RetrievalBackendSearchBase & {
      channel: 'vector'
      vector: readonly number[]
    })

export interface RetrievalBackendHit {
  sourceKey: string
  providerRank: number
  providerScore: number
}

export interface RetrievalBackendPage {
  hits: RetrievalBackendHit[]
  hasMore: boolean
}

/** Provider-neutral ranked-candidate boundary. SQLite hydrates and authorizes hits. */
export interface RetrievalBackend {
  readonly generation: number | null
  replace(snapshot: RetrievalProjectionSnapshot): Promise<void>
  search(input: RetrievalBackendSearch): Promise<RetrievalBackendPage>
  dispose(): void
}
