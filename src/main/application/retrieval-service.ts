import { createHash } from 'node:crypto'
import type { McpRetrievalMode } from '../../shared/contracts'
import type { OnMoveAccessPolicy } from './access-policy'
import { EmbeddingCacheRepository, type CachedEmbedding } from './embedding-cache'
import type { EmbeddingProvider } from './embedding-provider'
import { OramaRetrievalBackend } from './orama-retrieval-backend'
import type {
  RetrievalBackend,
  RetrievalBackendHit,
  RetrievalDocument,
  RetrievalProjectionSnapshot
} from './retrieval-backend'
import {
  RetrievalProjectionRepository,
  type AuthorizedRetrievalCandidates
} from './retrieval-projection'
import type {
  SearchEntityType,
  SearchLocalDateRange,
  SearchPageCursor,
  SearchQuery,
  SearchResult,
  SearchSortDirection,
  SearchSortField
} from './search-index'

export const RETRIEVAL_STRATEGIES = ['auto', 'lexical', 'hybrid'] as const
export type RetrievalStrategy = (typeof RETRIEVAL_STRATEGIES)[number]

export const RETRIEVAL_UNAVAILABLE_BEHAVIORS = ['fallback', 'error'] as const
export type RetrievalUnavailableBehavior =
  (typeof RETRIEVAL_UNAVAILABLE_BEHAVIORS)[number]

export const RETRIEVAL_DIVERSIFICATION_MODES = ['none', 'lineage'] as const
export type RetrievalDiversificationMode =
  (typeof RETRIEVAL_DIVERSIFICATION_MODES)[number]

export type RetrievalAppliedStrategy = 'structured' | 'lexical' | 'hybrid'

export const RETRIEVAL_FALLBACK_REASONS = {
  enhancedDisabled: 'Enhanced retrieval is disabled; lexical fallback was applied.',
  semanticUnavailable: 'The local semantic index is unavailable; lexical fallback was applied.'
} as const

export type RetrievalBoundary =
  | { type: 'workspace' }
  | { type: 'focus'; focusId: number }
  | { type: 'thread'; focusId: number; threadId: number }

export interface RetrievalContext {
  boundary: RetrievalBoundary
  /** Canonical Subject identity. It intersects the boundary and includes retained attribution. */
  subjectId?: number | null
}

export type RetrievalPageCursor =
  | { type: 'legacy'; value: SearchPageCursor }
  | { type: 'ranked'; offset: number }

export interface RetrievalRequest {
  text: string | null
  context: RetrievalContext
  kinds?: readonly SearchEntityType[]
  date?: SearchLocalDateRange
  createdAt?: SearchLocalDateRange
  updatedAt?: SearchLocalDateRange
  timeZone?: string
  sort?: { field: SearchSortField; direction: SearchSortDirection }
  strategy?: RetrievalStrategy
  onUnavailable?: RetrievalUnavailableBehavior
  diversifyBy?: RetrievalDiversificationMode
  cursor?: RetrievalPageCursor | null
  limit?: number
}

export interface RetrievalMatch {
  channels: Array<'structured' | 'lexical' | 'semantic'>
  lexicalRank: number | null
  semanticRank: number | null
  semanticSimilarity: number | null
  fusedScore: number | null
  lineageKey: string
}

export interface RetrievalResult extends Omit<SearchResult, 'rank'> {
  match: RetrievalMatch
}

export interface RetrievalPage {
  items: RetrievalResult[]
  itemCursors: RetrievalPageCursor[]
  hasMore: boolean
  nextCursor: RetrievalPageCursor | null
  lexicalGeneration: number
  semanticGeneration: number | null
  semanticCoverage: number | null
  requestedStrategy: RetrievalStrategy
  appliedStrategy: RetrievalAppliedStrategy
  fallbackReason: string | null
  retrievalMode: McpRetrievalMode
}

export class RetrievalStrategyUnavailableError extends Error {
  readonly code = 'RETRIEVAL_STRATEGY_UNAVAILABLE'

  constructor(message: string, readonly cause?: unknown) {
    super(`${'RETRIEVAL_STRATEGY_UNAVAILABLE'}: ${message}`)
    this.name = 'RetrievalStrategyUnavailableError'
  }
}

export class RetrievalContextNotVisibleError extends Error {
  readonly code = 'CONTEXT_NOT_FOUND_OR_NOT_VISIBLE'

  constructor() {
    super(
      'CONTEXT_NOT_FOUND_OR_NOT_VISIBLE: The requested retrieval context does not exist or is not visible.'
    )
    this.name = 'RetrievalContextNotVisibleError'
  }
}

interface RankedCandidate {
  sourceKey: string
  lexicalRank: number | null
  semanticRank: number | null
  semanticSimilarity: number | null
  fusedScore: number
  lineageKey: string
}

interface SemanticIndexState {
  generation: number
  coverage: number
  documentsBySourceKey: ReadonlyMap<string, RetrievalDocument>
}

const RRF_K = 60
const LEXICAL_WEIGHT = 0.6
const SEMANTIC_WEIGHT = 0.4
const MAX_BACKEND_PAGE = 1_000
const MAX_SEMANTIC_BUILD_ATTEMPTS = 3
const MAX_EMBEDDING_CHUNK_CHARACTERS = 480
const MIN_EMBEDDING_BREAK_CHARACTERS = 240
const EMBEDDING_PIPELINE_VERSION = 'document-content-chunks:1'

function positiveLimit(value: number | undefined): number {
  const limit = value ?? 25
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new TypeError('retrieval limit must be between 1 and 100')
  }
  return limit
}

function rankedOffset(cursor: RetrievalPageCursor | null | undefined): number {
  if (cursor === null || cursor === undefined) return 0
  if (cursor.type !== 'ranked' || !Number.isSafeInteger(cursor.offset) || cursor.offset < 0) {
    throw new TypeError('retrieval cursor does not match ranked retrieval')
  }
  return cursor.offset
}

function legacyCursor(
  cursor: RetrievalPageCursor | null | undefined
): SearchPageCursor | null {
  if (cursor === null || cursor === undefined) return null
  if (cursor.type !== 'legacy') {
    throw new TypeError('retrieval cursor does not match legacy retrieval')
  }
  return cursor.value
}

function documentText(document: RetrievalDocument): string {
  return [document.title.trim(), document.body.trim()].filter(Boolean).join('\n\n')
}

function splitLongEmbeddingUnit(text: string): string[] {
  const chunks: string[] = []
  let start = 0
  while (start < text.length) {
    let end = Math.min(start + MAX_EMBEDDING_CHUNK_CHARACTERS, text.length)
    if (end < text.length) {
      const minimumBreak = start + MIN_EMBEDDING_BREAK_CHARACTERS
      const candidates = [
        text.lastIndexOf('\n', end),
        text.lastIndexOf('. ', end),
        text.lastIndexOf(' ', end)
      ].filter((candidate) => candidate >= minimumBreak)
      if (candidates.length > 0) end = Math.max(...candidates)
    }
    const chunk = text.slice(start, end).trim()
    if (chunk.length > 0) chunks.push(chunk)
    start = end
    while (start < text.length && /\s/u.test(text[start])) start += 1
  }
  return chunks
}

/**
 * USE truncates long inputs. Keep each source as one result, but embed bounded chunks so
 * evidence near the end of a long document still contributes to its cached vector.
 */
function documentEmbeddingChunks(document: RetrievalDocument): string[] {
  const text = documentText(document).trim()
  if (text.length === 0) return ['']
  const chunks: string[] = []
  let pending = ''
  const flush = (): void => {
    if (pending.length > 0) chunks.push(pending)
    pending = ''
  }
  for (const paragraph of text.split(/\n+/u).map((value) => value.trim()).filter(Boolean)) {
    if (paragraph.length > MAX_EMBEDDING_CHUNK_CHARACTERS) {
      flush()
      chunks.push(...splitLongEmbeddingUnit(paragraph))
      continue
    }
    const combined = pending.length === 0 ? paragraph : `${pending}\n\n${paragraph}`
    if (combined.length <= MAX_EMBEDDING_CHUNK_CHARACTERS) {
      pending = combined
    } else {
      flush()
      pending = paragraph
    }
  }
  flush()
  return chunks.length > 0 ? chunks : ['']
}

function contentHash(document: RetrievalDocument): string {
  // Hierarchy labels are intentionally excluded. Repeated corporate vocabulary should not
  // collapse distinct Focus/Thread identities into the vector itself; context remains structural.
  return createHash('sha256')
    .update(EMBEDDING_PIPELINE_VERSION)
    .update('\0')
    .update(document.title)
    .update('\0')
    .update(document.body)
    .digest('hex')
}

function lineageForResult(result: SearchResult): string {
  return [
    `focus:${result.hierarchy.focus?.id ?? 0}`,
    `thread:${result.hierarchy.thread?.id ?? 0}`,
    `commitment:${result.hierarchy.commitment?.id ?? 0}`,
    `subject:${result.subject?.id ?? 0}`
  ].join(':')
}

function withoutRank(result: SearchResult, match: RetrievalMatch): RetrievalResult {
  const record: Partial<SearchResult> = { ...result }
  delete record.rank
  return { ...(record as Omit<SearchResult, 'rank'>), match }
}

function normalizeVector(vector: readonly number[], dimensions: number): number[] {
  if (vector.length !== dimensions || vector.some((value) => !Number.isFinite(value))) {
    throw new Error(`embedding provider returned a vector other than ${dimensions} finite values`)
  }
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + (value * value), 0))
  if (!Number.isFinite(magnitude) || magnitude === 0) {
    throw new Error('embedding provider returned a zero-magnitude vector')
  }
  return vector.map((value) => value / magnitude)
}

function meanVector(vectors: readonly (readonly number[])[], dimensions: number): number[] {
  if (vectors.length === 0) throw new Error('embedding provider returned no document vectors')
  const mean = Array.from({ length: dimensions }, () => 0)
  for (const value of vectors) {
    const normalized = normalizeVector(value, dimensions)
    normalized.forEach((entry, index) => {
      mean[index] += entry / vectors.length
    })
  }
  return normalizeVector(mean, dimensions)
}

function diversifyByLineage(candidates: readonly RankedCandidate[]): RankedCandidate[] {
  const groups = new Map<string, RankedCandidate[]>()
  for (const candidate of candidates) {
    const group = groups.get(candidate.lineageKey)
    if (group) group.push(candidate)
    else groups.set(candidate.lineageKey, [candidate])
  }
  const orderedGroups = [...groups.values()].sort((left, right) =>
    (right[0]?.fusedScore ?? 0) - (left[0]?.fusedScore ?? 0) ||
    (left[0]?.sourceKey ?? '').localeCompare(right[0]?.sourceKey ?? ''))
  const diversified: RankedCandidate[] = []
  for (let position = 0; ; position += 1) {
    let appended = false
    for (const group of orderedGroups) {
      const candidate = group[position]
      if (!candidate) continue
      diversified.push(candidate)
      appended = true
    }
    if (!appended) return diversified
  }
}

/**
 * Coordinates the derived Orama index. SQLite remains authoritative for authorization,
 * hydration, continuation freshness, and all writes.
 */
export class RetrievalService {
  private readonly backend: RetrievalBackend
  private readonly cache: EmbeddingCacheRepository
  private semanticState: SemanticIndexState | null = null
  private buildPromise: Promise<SemanticIndexState> | null = null
  private disposed = false
  private lifecycleRevision = 0

  constructor(
    private readonly projection: RetrievalProjectionRepository,
    database: ConstructorParameters<typeof EmbeddingCacheRepository>[0],
    private readonly embeddings: EmbeddingProvider,
    backend?: RetrievalBackend
  ) {
    if (!Number.isSafeInteger(embeddings.dimensions) || embeddings.dimensions < 1) {
      throw new TypeError('embedding provider dimensions must be a positive integer')
    }
    if (embeddings.modelId.trim().length === 0) {
      throw new TypeError('embedding provider modelId must not be empty')
    }
    this.backend = backend ?? new OramaRetrievalBackend(embeddings.dimensions)
    this.cache = new EmbeddingCacheRepository(database)
  }

  async retrieve(
    request: Omit<RetrievalRequest, 'context'> & Pick<SearchQuery, 'focusId' | 'threadId' | 'subjectId'>,
    access: OnMoveAccessPolicy,
    retrievalMode: McpRetrievalMode
  ): Promise<RetrievalPage> {
    this.assertActive()
    const limit = positiveLimit(request.limit)
    const requestedStrategy = request.strategy ?? 'auto'
    const unavailable = request.onUnavailable ?? 'fallback'
    const diversifyBy = request.diversifyBy ?? 'lineage'
    const text = request.text
    const sort = request.sort ?? (text === null
      ? { field: 'updatedAt' as const, direction: 'desc' as const }
      : { field: 'relevance' as const, direction: 'asc' as const })
    const structured = text === null
    const hybridEligible = !structured && sort.field === 'relevance'
    const hybridRequested = requestedStrategy === 'hybrid' ||
      (requestedStrategy === 'auto' && retrievalMode === 'enhanced')

    if (!hybridEligible || !hybridRequested) {
      return this.legacyPage(
        request,
        access,
        retrievalMode,
        requestedStrategy,
        structured ? 'structured' : 'lexical',
        null,
        limit
      )
    }

    // Validate before entering the semantic-fallback boundary. A legacy cursor cannot
    // become ranked, and a malformed cursor must never silently restart at page one.
    rankedOffset(request.cursor)
    if (typeof text !== 'string' || text.trim().length === 0) {
      throw new TypeError('hybrid retrieval requires non-empty text')
    }

    if (retrievalMode !== 'enhanced') {
      const reason = RETRIEVAL_FALLBACK_REASONS.enhancedDisabled
      if (unavailable === 'error') throw new RetrievalStrategyUnavailableError(reason)
      if (request.cursor !== null && request.cursor !== undefined) {
        throw new RetrievalStrategyUnavailableError(
          'A ranked continuation cannot fall back to lexical pagination.'
        )
      }
      return this.legacyPage(
        request,
        access,
        retrievalMode,
        requestedStrategy,
        'lexical',
        reason,
        limit
      )
    }

    try {
      return await this.hybridPage(
        request,
        access,
        retrievalMode,
        requestedStrategy,
        diversifyBy,
        limit
      )
    } catch (error) {
      if (request.cursor !== null && request.cursor !== undefined) {
        if (error instanceof RetrievalStrategyUnavailableError) throw error
        throw new RetrievalStrategyUnavailableError(
          'A ranked continuation cannot fall back to lexical pagination.',
          error
        )
      }
      if (unavailable === 'error') {
        if (error instanceof RetrievalStrategyUnavailableError) throw error
        throw new RetrievalStrategyUnavailableError(
          'The local semantic index could not be prepared.',
          error
        )
      }
      return this.legacyPage(
        { ...request, cursor: null },
        access,
        retrievalMode,
        requestedStrategy,
        'lexical',
        RETRIEVAL_FALLBACK_REASONS.semanticUnavailable,
        limit
      )
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.lifecycleRevision += 1
    this.backend.dispose()
    this.semanticState = null
    this.buildPromise = null
  }

  private legacyPage(
    request: Omit<RetrievalRequest, 'context'> & Pick<SearchQuery, 'focusId' | 'threadId' | 'subjectId'>,
    access: OnMoveAccessPolicy,
    retrievalMode: McpRetrievalMode,
    requestedStrategy: RetrievalStrategy,
    appliedStrategy: 'structured' | 'lexical',
    fallbackReason: string | null,
    limit: number
  ): RetrievalPage {
    const page = this.projection.searchPage({
      ...this.searchQuery(request),
      cursor: legacyCursor(request.cursor),
      limit,
      offset: 0
    }, access)
    const channel = appliedStrategy === 'structured' ? 'structured' : 'lexical'
    const items = page.items.map((item) => withoutRank(item, {
      channels: [channel],
      lexicalRank: null,
      semanticRank: null,
      semanticSimilarity: null,
      fusedScore: null,
      lineageKey: lineageForResult(item)
    }))
    const itemCursors = page.itemCursors.map((value): RetrievalPageCursor => ({
      type: 'legacy',
      value
    }))
    return {
      items,
      itemCursors,
      hasMore: page.hasMore,
      nextCursor: page.nextCursor ? { type: 'legacy', value: page.nextCursor } : null,
      lexicalGeneration: page.generation,
      semanticGeneration: this.semanticState?.generation ?? null,
      semanticCoverage: this.semanticState?.coverage ?? null,
      requestedStrategy,
      appliedStrategy,
      fallbackReason,
      retrievalMode
    }
  }

  private async hybridPage(
    request: Omit<RetrievalRequest, 'context'> & Pick<SearchQuery, 'focusId' | 'threadId' | 'subjectId'>,
    access: OnMoveAccessPolicy,
    retrievalMode: McpRetrievalMode,
    requestedStrategy: RetrievalStrategy,
    diversifyBy: RetrievalDiversificationMode,
    limit: number
  ): Promise<RetrievalPage> {
    if (typeof request.text !== 'string' || request.text.trim().length === 0) {
      throw new TypeError('hybrid retrieval requires non-empty text')
    }
    const text = request.text
    const offset = rankedOffset(request.cursor)
    const lifecycleRevision = this.lifecycleRevision
    // Query embedding can load a model and take much longer than a lookup. Complete it
    // before aligning authorization and semantic generations.
    const [queryVector] = await this.embeddings.embed([text])
    this.assertActive(lifecycleRevision)
    const normalizedQueryVector = normalizeVector(queryVector, this.embeddings.dimensions)
    let authorized: AuthorizedRetrievalCandidates | null = null
    let semantic: SemanticIndexState | null = null
    for (let attempt = 0; attempt < 2; attempt += 1) {
      authorized = this.projection.authorizedCandidates(this.searchQuery(request), access)
      semantic = await this.ensureSemanticIndex()
      if (authorized.generation === semantic.generation) break
      authorized = null
      semantic = null
    }
    if (!authorized || !semantic || authorized.generation !== semantic.generation) {
      throw new Error('data changed while the semantic index was prepared')
    }

    const sourceKeys = [...authorized.resultsBySourceKey.keys()]
    if (sourceKeys.length === 0) {
      return {
        items: [],
        itemCursors: [],
        hasMore: false,
        nextCursor: null,
        lexicalGeneration: authorized.generation,
        semanticGeneration: semantic.generation,
        semanticCoverage: semantic.coverage,
        requestedStrategy,
        appliedStrategy: 'hybrid',
        fallbackReason: null,
        retrievalMode
      }
    }

    const filters = {
      sourceKeys,
      ...(request.kinds ? { kinds: request.kinds } : {}),
      ...(request.focusId ? { focusIds: [request.focusId] } : {}),
      ...(request.threadId ? { threadIds: [request.threadId] } : {}),
      ...(request.subjectId ? { subjectIds: [request.subjectId] } : {})
    }
    const [lexicalHits, semanticHits] = await Promise.all([
      this.searchAll({ channel: 'lexical', text, filters }),
      this.searchAll({ channel: 'vector', vector: normalizedQueryVector, filters })
    ])
    const rankings = new Map<string, RankedCandidate>()
    const add = (hit: RetrievalBackendHit, channel: 'lexical' | 'semantic'): void => {
      const document = semantic?.documentsBySourceKey.get(hit.sourceKey)
      if (!document || !authorized?.resultsBySourceKey.has(hit.sourceKey)) return
      const existing = rankings.get(hit.sourceKey) ?? {
        sourceKey: hit.sourceKey,
        lexicalRank: null,
        semanticRank: null,
        semanticSimilarity: null,
        fusedScore: 0,
        lineageKey: document.lineageKey
      }
      if (channel === 'lexical') {
        existing.lexicalRank = hit.providerRank
        existing.fusedScore += LEXICAL_WEIGHT / (RRF_K + hit.providerRank)
      } else {
        existing.semanticRank = hit.providerRank
        existing.semanticSimilarity = hit.providerScore
        existing.fusedScore += SEMANTIC_WEIGHT / (RRF_K + hit.providerRank)
      }
      rankings.set(hit.sourceKey, existing)
    }
    lexicalHits.forEach((hit) => add(hit, 'lexical'))
    semanticHits.forEach((hit) => add(hit, 'semantic'))
    const relevanceOrdered = [...rankings.values()].sort((left, right) =>
      right.fusedScore - left.fusedScore || left.sourceKey.localeCompare(right.sourceKey))
    const ordered = diversifyBy === 'lineage'
      ? diversifyByLineage(relevanceOrdered)
      : relevanceOrdered
    const pageCandidates = ordered.slice(offset, offset + limit)
    const items = pageCandidates.flatMap((candidate) => {
      const record = authorized?.resultsBySourceKey.get(candidate.sourceKey)
      if (!record) return []
      // Structural eligibility is an explicit stage of hybrid retrieval, not an
      // inference from semantic similarity.
      const channels: RetrievalMatch['channels'] = ['structured']
      if (candidate.lexicalRank !== null) channels.push('lexical')
      if (candidate.semanticRank !== null) channels.push('semantic')
      return [withoutRank(record, {
        channels,
        lexicalRank: candidate.lexicalRank,
        semanticRank: candidate.semanticRank,
        semanticSimilarity: candidate.semanticSimilarity,
        fusedScore: candidate.fusedScore,
        lineageKey: candidate.lineageKey
      })]
    })
    const itemCursors = items.map((_, index): RetrievalPageCursor => ({
      type: 'ranked',
      offset: offset + index + 1
    }))
    const hasMore = offset + items.length < ordered.length
    return {
      items,
      itemCursors,
      hasMore,
      nextCursor: hasMore ? { type: 'ranked', offset: offset + items.length } : null,
      lexicalGeneration: authorized.generation,
      semanticGeneration: semantic.generation,
      semanticCoverage: semantic.coverage,
      requestedStrategy,
      appliedStrategy: 'hybrid',
      fallbackReason: null,
      retrievalMode
    }
  }

  private searchQuery(
    request: Omit<RetrievalRequest, 'context'> & Pick<SearchQuery, 'focusId' | 'threadId' | 'subjectId'>
  ): SearchQuery {
    return {
      text: request.text,
      ...(request.kinds ? { kinds: request.kinds } : {}),
      focusId: request.focusId ?? null,
      threadId: request.threadId ?? null,
      subjectId: request.subjectId ?? null,
      ...(request.date ? { date: request.date } : {}),
      ...(request.createdAt ? { createdAt: request.createdAt } : {}),
      ...(request.updatedAt ? { updatedAt: request.updatedAt } : {}),
      ...(request.timeZone ? { timeZone: request.timeZone } : {}),
      ...(request.sort ? { sort: request.sort } : {})
    }
  }

  private async searchAll(
    input:
      | { channel: 'lexical'; text: string; filters: { sourceKeys: string[] } }
      | { channel: 'vector'; vector: readonly number[]; filters: { sourceKeys: string[] } }
  ): Promise<RetrievalBackendHit[]> {
    const hits: RetrievalBackendHit[] = []
    let offset = 0
    let hasMore = true
    while (hasMore) {
      const page = await this.backend.search({
        ...input,
        offset,
        limit: MAX_BACKEND_PAGE
      })
      hits.push(...page.hits)
      offset += page.hits.length
      hasMore = page.hasMore
      if (hasMore && page.hits.length === 0) {
        throw new Error('retrieval backend pagination made no progress')
      }
    }
    return hits
  }

  private async ensureSemanticIndex(): Promise<SemanticIndexState> {
    let pendingSnapshot: RetrievalProjectionSnapshot | null = null
    let buildAttempts = 0
    for (;;) {
      this.assertActive()
      const snapshot = pendingSnapshot ?? this.projection.snapshotIfChanged(
        this.semanticState?.generation ?? null
      )
      pendingSnapshot = null
      if (!snapshot && this.semanticState) return this.semanticState

      if (this.buildPromise) {
        await this.buildPromise
        continue
      }

      const requiredSnapshot = snapshot ?? this.projection.snapshotIfChanged(null)
      if (!requiredSnapshot) throw new Error('semantic projection snapshot is unavailable')
      buildAttempts += 1
      if (buildAttempts > MAX_SEMANTIC_BUILD_ATTEMPTS) {
        throw new Error('data continued changing while the semantic index was prepared')
      }
      const lifecycleRevision = this.lifecycleRevision
      const build = this.buildSemanticIndex(requiredSnapshot, lifecycleRevision)
      this.buildPromise = build
      try {
        const state = await build
        this.assertActive(lifecycleRevision)
        this.semanticState = state
        // Embedding and index replacement can be slow. Synchronize once more before
        // serving this generation, and rebuild immediately if a write landed meanwhile.
        pendingSnapshot = this.projection.snapshotIfChanged(state.generation)
        if (!pendingSnapshot) return state
      } finally {
        if (this.buildPromise === build) this.buildPromise = null
      }
    }
  }

  private async buildSemanticIndex(
    snapshot: RetrievalProjectionSnapshot,
    lifecycleRevision: number
  ): Promise<SemanticIndexState> {
    const cached = this.cache.list(this.embeddings.modelId, this.embeddings.dimensions)
    const enriched: RetrievalDocument[] = []
    const missing: Array<{
      document: RetrievalDocument
      hash: string
      chunks: string[]
    }> = []
    for (const document of snapshot.documents) {
      const hash = contentHash(document)
      const cacheEntry = cached.get(document.sourceKey)
      if (cacheEntry?.contentHash === hash) {
        enriched.push({
          ...document,
          embedding: normalizeVector(cacheEntry.vector, this.embeddings.dimensions)
        })
      } else {
        missing.push({ document, hash, chunks: documentEmbeddingChunks(document) })
      }
    }

    const stored: CachedEmbedding[] = []
    if (missing.length > 0) {
      const inputs = missing.flatMap(({ chunks }) => chunks)
      const vectors = await this.embeddings.embed(inputs)
      this.assertActive(lifecycleRevision)
      if (vectors.length !== inputs.length) {
        throw new Error('embedding provider returned the wrong number of vectors')
      }
      let vectorOffset = 0
      for (let index = 0; index < missing.length; index += 1) {
        const entry = missing[index]
        const vector = meanVector(
          vectors.slice(vectorOffset, vectorOffset + entry.chunks.length),
          this.embeddings.dimensions
        )
        vectorOffset += entry.chunks.length
        enriched.push({ ...entry.document, embedding: vector })
        stored.push({
          sourceKey: entry.document.sourceKey,
          contentHash: entry.hash,
          vector
        })
      }
      this.assertActive(lifecycleRevision)
      this.cache.store(this.embeddings.modelId, this.embeddings.dimensions, stored)
    }
    this.assertActive(lifecycleRevision)
    this.cache.prune(
      this.embeddings.modelId,
      new Set(snapshot.documents.map(({ sourceKey }) => sourceKey))
    )
    enriched.sort((left, right) => left.sourceKey.localeCompare(right.sourceKey))
    await this.backend.replace({ generation: snapshot.generation, documents: enriched })
    this.assertActive(lifecycleRevision)
    return {
      generation: snapshot.generation,
      coverage: snapshot.documents.length === 0 ? 1 : enriched.length / snapshot.documents.length,
      documentsBySourceKey: new Map(enriched.map((document) => [document.sourceKey, document]))
    }
  }

  private assertActive(lifecycleRevision = this.lifecycleRevision): void {
    if (this.disposed || lifecycleRevision !== this.lifecycleRevision) {
      throw new Error('retrieval service has been disposed')
    }
  }
}
