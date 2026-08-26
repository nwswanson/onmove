import type { OnMoveAccessPolicy } from './access-policy'
import {
  SEARCH_ENTITY_TYPES,
  type SearchEntityType,
  type SearchPage,
  type SearchPageCursor,
  type SearchQuery,
  type SearchResult,
  type SearchIndexRepository
} from './search-index'
import type { RetrievalDocument, RetrievalProjectionSnapshot } from './retrieval-backend'
import type { SqliteAdapter } from '../data/sqlite-adapter'

interface SearchIndexStateRow {
  dirty: number
  generation: number
}

interface RetrievalProjectionRow {
  source_key: string
  entity_type: SearchEntityType
  entity_id: number
  field_name: string
  title: string
  body: string
  focus_id: number | null
  thread_id: number | null
  commitment_id: number | null
  subject_id: number | null
  scope_id: number | null
  direct_sensitive: number
  status: string | null
  state: string | null
  due_on: string | null
  created_at: string
  updated_at: string
}

export interface AuthorizedRetrievalCandidates {
  generation: number
  resultsBySourceKey: ReadonlyMap<string, SearchResult>
}

function idOrZero(value: number | null): number {
  return value === null ? 0 : Number(value)
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

function projectionDocument(row: RetrievalProjectionRow): RetrievalDocument {
  if (!SEARCH_ENTITY_TYPES.includes(row.entity_type)) {
    throw new Error(`search projection contains unsupported entity type: ${row.entity_type}`)
  }
  const focusId = idOrZero(row.focus_id)
  const threadId = idOrZero(row.thread_id)
  const commitmentId = idOrZero(row.commitment_id)
  const subjectId = idOrZero(row.subject_id)
  return {
    sourceKey: row.source_key,
    kind: row.entity_type,
    entityId: Number(row.entity_id),
    field: row.field_name,
    title: row.title,
    body: row.body,
    focusId,
    threadId,
    commitmentId,
    subjectId,
    scopeId: idOrZero(row.scope_id),
    lineageKey: `focus:${focusId}:thread:${threadId}:commitment:${commitmentId}:subject:${subjectId}`,
    directSensitive: Boolean(row.direct_sensitive),
    dueOn: row.due_on ?? '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    status: row.status ?? '',
    state: row.state ?? ''
  }
}

/** Reads the durable SQLite projection while retaining legacy authorization semantics. */
export class RetrievalProjectionRepository {
  constructor(
    private readonly database: SqliteAdapter,
    private readonly legacy: SearchIndexRepository
  ) {}

  searchPage(query: SearchQuery, access: OnMoveAccessPolicy): SearchPage {
    return this.legacy.searchPage(query, access)
  }

  async snapshotIfChanged(
    knownGeneration: number | null
  ): Promise<RetrievalProjectionSnapshot | null> {
    if (
      knownGeneration !== null &&
      (!Number.isSafeInteger(knownGeneration) || knownGeneration < 0)
    ) {
      throw new TypeError('knownGeneration must be null or a nonnegative integer')
    }
    // Give an already-armed foreground deadline a turn before synchronizing. Keep
    // synchronization and the state/row transaction adjacent so a write cannot mark
    // the projection dirty in between them.
    await yieldToEventLoop()
    this.legacy.synchronize()
    const snapshot = this.database.transaction(() => {
      const state = this.database.get<SearchIndexStateRow>(
        'SELECT dirty, generation FROM search_index_state WHERE singleton = 1'
      )
      if (!state) throw new Error('search index state is unavailable')
      if (state.dirty !== 0) throw new Error('search projection remained dirty after synchronization')
      const generation = Number(state.generation)
      if (knownGeneration === generation) return null
      const rows = this.database.all<RetrievalProjectionRow>(
        `SELECT source_key, entity_type, entity_id, field_name, title, body,
                focus_id, thread_id, commitment_id, subject_id, scope_id,
                direct_sensitive, status, state, due_on, created_at, updated_at
         FROM search_documents
         ORDER BY source_key`
      )
      return { generation, rows }
    })
    if (!snapshot) return null
    const documents: RetrievalDocument[] = []
    for (let index = 0; index < snapshot.rows.length; index += 1) {
      documents.push(projectionDocument(snapshot.rows[index]))
      if ((index + 1) % 250 === 0) await yieldToEventLoop()
    }
    return { generation: snapshot.generation, documents }
  }

  /**
   * Enumerates every authorized structured candidate through the legacy queryless
   * path. Text, caller paging, and relevance sorting intentionally do not narrow
   * this security boundary.
   */
  async authorizedCandidates(
    query: SearchQuery,
    access: OnMoveAccessPolicy,
    signal?: AbortSignal
  ): Promise<AuthorizedRetrievalCandidates> {
    const resultsBySourceKey = new Map<string, SearchResult>()
    let cursor: SearchPageCursor | null = null
    let generation: number | null = null
    do {
      signal?.throwIfAborted()
      const page = this.legacy.searchPage({
        ...query,
        text: null,
        sort: { field: 'updatedAt', direction: 'asc' },
        cursor,
        offset: 0,
        limit: 100
      }, access)
      if (generation !== null && generation !== page.generation) {
        throw new Error('search projection changed while authorized candidates were enumerated')
      }
      generation = page.generation
      if (page.items.length !== page.itemCursors.length) {
        throw new Error('legacy search returned misaligned items and source keys')
      }
      for (let index = 0; index < page.items.length; index += 1) {
        const sourceKey = page.itemCursors[index].sourceKey
        if (resultsBySourceKey.has(sourceKey)) {
          throw new Error(`legacy search returned duplicate source key: ${sourceKey}`)
        }
        resultsBySourceKey.set(sourceKey, page.items[index])
      }
      if (page.hasMore && page.nextCursor === null) {
        throw new Error('legacy search omitted a required next cursor')
      }
      cursor = page.nextCursor
      if (cursor !== null) await yieldToEventLoop()
    } while (cursor !== null)

    if (generation === null) throw new Error('legacy search returned no projection generation')
    return { generation, resultsBySourceKey }
  }
}
