import {
  create,
  insertMultiple,
  search,
  type AnyOrama,
  type WhereCondition
} from '@orama/orama'
import { SEARCH_ENTITY_TYPES, type SearchEntityType } from './search-index'
import type {
  RetrievalBackend,
  RetrievalBackendPage,
  RetrievalBackendSearch,
  RetrievalDocument,
  RetrievalProjectionSnapshot,
  RetrievalStructuralFilters
} from './retrieval-backend'

/** Excludes orthogonal vector noise while retaining ordinary paraphrase matches. */
export const ORAMA_MINIMUM_SEMANTIC_SIMILARITY = 0.25
const ORAMA_INSERT_BATCH_SIZE = 250

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

function schemaFor(vectorDimension: number) {
  return {
    id: 'string',
    sourceKey: 'enum',
    kind: 'enum',
    entityId: 'enum',
    field: 'enum',
    title: 'string',
    body: 'string',
    focusId: 'enum',
    threadId: 'enum',
    commitmentId: 'enum',
    subjectId: 'enum',
    scopeId: 'enum',
    lineageKey: 'enum',
    directSensitive: 'boolean',
    status: 'enum',
    state: 'enum',
    embedding: `vector[${vectorDimension}]` as `vector[${number}]`
  } as const
}

type OramaRetrievalSchema = ReturnType<typeof schemaFor>
type OramaRetrievalIndex = AnyOrama<OramaRetrievalSchema>

function positiveInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${field} must be a positive integer`)
  }
}

function nonnegativeInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${field} must be a nonnegative integer`)
  }
}

function finiteVector(value: readonly number[], dimension: number, field: string): number[] {
  if (value.length !== dimension || value.some((entry) => !Number.isFinite(entry))) {
    throw new TypeError(`${field} must contain exactly ${dimension} finite numbers`)
  }
  return [...value]
}

function uniqueStrings(values: readonly string[], field: string): string[] {
  if (values.some((value) => typeof value !== 'string' || value.length === 0)) {
    throw new TypeError(`${field} must contain only non-empty strings`)
  }
  return [...new Set(values)]
}

function uniqueIds(values: readonly number[] | undefined, field: string): number[] | undefined {
  if (values === undefined) return undefined
  for (const value of values) nonnegativeInteger(value, field)
  return [...new Set(values)]
}

function uniqueKinds(values: readonly SearchEntityType[] | undefined): SearchEntityType[] | undefined {
  if (values === undefined) return undefined
  if (values.some((value) => !SEARCH_ENTITY_TYPES.includes(value))) {
    throw new TypeError('filters.kinds contains an unsupported entity type')
  }
  return [...new Set(values)]
}

function oramaDocument(document: RetrievalDocument, vectorDimension: number) {
  if (document.sourceKey.length === 0) {
    throw new TypeError('retrieval document sourceKey must not be empty')
  }
  if (!SEARCH_ENTITY_TYPES.includes(document.kind)) {
    throw new TypeError(`unsupported retrieval document kind: ${document.kind}`)
  }
  positiveInteger(document.entityId, 'retrieval document entityId')
  for (const [field, value] of [
    ['focusId', document.focusId],
    ['threadId', document.threadId],
    ['commitmentId', document.commitmentId],
    ['subjectId', document.subjectId],
    ['scopeId', document.scopeId]
  ] as const) nonnegativeInteger(value, `retrieval document ${field}`)

  return {
    id: document.sourceKey,
    sourceKey: document.sourceKey,
    kind: document.kind,
    entityId: document.entityId,
    field: document.field,
    title: document.title,
    body: document.body,
    focusId: document.focusId,
    threadId: document.threadId,
    commitmentId: document.commitmentId,
    subjectId: document.subjectId,
    scopeId: document.scopeId,
    lineageKey: document.lineageKey,
    directSensitive: document.directSensitive,
    status: document.status,
    state: document.state,
    ...(document.embedding === undefined
      ? {}
      : { embedding: finiteVector(document.embedding, vectorDimension, 'document embedding') })
  }
}

function whereFor(
  filters: RetrievalStructuralFilters
): Partial<WhereCondition<OramaRetrievalSchema>> | null {
  const sourceKeys = uniqueStrings(filters.sourceKeys, 'filters.sourceKeys')
  if (sourceKeys.length === 0) return null

  const conditions: WhereCondition<OramaRetrievalSchema>[] = [
    { sourceKey: { in: sourceKeys } }
  ]
  const kinds = uniqueKinds(filters.kinds)
  if (kinds?.length === 0) return null
  if (kinds) conditions.push({ kind: { in: kinds } })

  for (const [property, values] of [
    ['focusId', uniqueIds(filters.focusIds, 'filters.focusIds')],
    ['threadId', uniqueIds(filters.threadIds, 'filters.threadIds')],
    ['commitmentId', uniqueIds(filters.commitmentIds, 'filters.commitmentIds')],
    ['subjectId', uniqueIds(filters.subjectIds, 'filters.subjectIds')],
    ['scopeId', uniqueIds(filters.scopeIds, 'filters.scopeIds')]
  ] as const) {
    if (values?.length === 0) return null
    if (values) conditions.push({ [property]: { in: values } })
  }
  return conditions.length === 1 ? conditions[0] : { and: conditions }
}

/** In-memory Orama candidate index. It never authorizes or hydrates a result. */
export class OramaRetrievalBackend implements RetrievalBackend {
  private index: OramaRetrievalIndex | null = null
  private indexedGeneration: number | null = null
  private replacementRevision = 0

  constructor(private readonly vectorDimension: number) {
    positiveInteger(vectorDimension, 'vectorDimension')
  }

  get generation(): number | null {
    return this.indexedGeneration
  }

  async replace(snapshot: RetrievalProjectionSnapshot): Promise<void> {
    nonnegativeInteger(snapshot.generation, 'snapshot.generation')
    const replacementRevision = ++this.replacementRevision
    const seen = new Set<string>()
    const documents: ReturnType<typeof oramaDocument>[] = []
    for (let index = 0; index < snapshot.documents.length; index += 1) {
      if (replacementRevision !== this.replacementRevision) return
      const document = snapshot.documents[index]
      if (seen.has(document.sourceKey)) {
        throw new TypeError(`duplicate retrieval sourceKey: ${document.sourceKey}`)
      }
      seen.add(document.sourceKey)
      documents.push(oramaDocument(document, this.vectorDimension))
      if ((index + 1) % ORAMA_INSERT_BATCH_SIZE === 0) await yieldToEventLoop()
    }
    if (replacementRevision !== this.replacementRevision) return
    const next = create({ schema: schemaFor(this.vectorDimension) })
    for (let start = 0; start < documents.length; start += ORAMA_INSERT_BATCH_SIZE) {
      if (replacementRevision !== this.replacementRevision) return
      await insertMultiple(next, documents.slice(start, start + ORAMA_INSERT_BATCH_SIZE))
      if (start + ORAMA_INSERT_BATCH_SIZE < documents.length) await yieldToEventLoop()
    }
    if (replacementRevision !== this.replacementRevision) return
    this.index = next
    this.indexedGeneration = snapshot.generation
  }

  async search(input: RetrievalBackendSearch): Promise<RetrievalBackendPage> {
    const index = this.index
    if (!index || this.indexedGeneration === null) {
      throw new Error('retrieval backend has not been indexed')
    }
    nonnegativeInteger(input.offset, 'search offset')
    positiveInteger(input.limit, 'search limit')
    if (input.limit > 1_000) throw new TypeError('search limit must not exceed 1000')
    const where = whereFor(input.filters)
    if (where === null) return { hits: [], hasMore: false }

    const result = input.channel === 'lexical'
      ? await this.lexicalSearch(index, input.text, input.offset, input.limit, where)
      : await this.vectorSearch(index, input.vector, input.offset, input.limit, where)
    return {
      hits: result.hits.map((hit, indexInPage) => ({
        sourceKey: hit.id,
        providerRank: input.offset + indexInPage + 1,
        providerScore: Number(hit.score)
      })),
      hasMore: result.count > input.offset + result.hits.length
    }
  }

  dispose(): void {
    this.replacementRevision += 1
    this.index = null
    this.indexedGeneration = null
  }

  private async lexicalSearch(
    index: OramaRetrievalIndex,
    text: string,
    offset: number,
    limit: number,
    where: Partial<WhereCondition<OramaRetrievalSchema>>
  ) {
    if (typeof text !== 'string' || text.trim().length === 0) {
      throw new TypeError('lexical search text must not be empty')
    }
    if (text.length > 1_000) throw new TypeError('lexical search text must not exceed 1000 characters')
    return search(index, {
      mode: 'fulltext',
      term: text,
      properties: ['title', 'body'],
      boost: { title: 4, body: 1 },
      tolerance: 0,
      offset,
      limit,
      where
    })
  }

  private async vectorSearch(
    index: OramaRetrievalIndex,
    vector: readonly number[],
    offset: number,
    limit: number,
    where: Partial<WhereCondition<OramaRetrievalSchema>>
  ) {
    const value = finiteVector(vector, this.vectorDimension, 'search vector')
    return search(index, {
      mode: 'vector',
      vector: { value, property: 'embedding' },
      similarity: ORAMA_MINIMUM_SEMANTIC_SIMILARITY,
      includeVectors: false,
      offset,
      limit,
      where
    })
  }
}
