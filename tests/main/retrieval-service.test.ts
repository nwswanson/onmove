import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { OnMoveAccessPolicy } from '../../src/main/application/access-policy'
import type { EmbeddingProvider } from '../../src/main/application/embedding-provider'
import { RetrievalProjectionRepository } from '../../src/main/application/retrieval-projection'
import {
  RETRIEVAL_FALLBACK_REASONS,
  RetrievalService,
  RetrievalStrategyUnavailableError,
  type RetrievalPage,
  type RetrievalPageCursor
} from '../../src/main/application/retrieval-service'
import { SearchIndexRepository } from '../../src/main/application/search-index'
import { DomainStore } from '../../src/main/data/domain'
import { runMigrations } from '../../src/main/data/migrations'
import { SqliteAdapter } from '../../src/main/data/sqlite-adapter'

const visible: OnMoveAccessPolicy = { sensitiveContent: 'deny', mutations: 'read-only' }

class DeterministicEmbeddingProvider implements EmbeddingProvider {
  readonly modelId = 'deterministic-retrieval-test:1'
  readonly dimensions = 3
  readonly calls: string[][] = []
  failure: Error | null = null
  visibleCharacterLimit: number | null = null
  onEmbed: ((texts: readonly string[]) => void | Promise<void>) | null = null

  async embed(texts: readonly string[]): Promise<number[][]> {
    const batch = [...texts]
    this.calls.push(batch)
    await this.onEmbed?.(batch)
    if (this.failure) throw this.failure
    return batch.map((text) => this.vector(text))
  }

  private vector(input: string): number[] {
    const text = input
      .slice(0, this.visibleCharacterLimit ?? input.length)
      .normalize('NFKC')
      .toLocaleLowerCase()
    if (/monitor|telemetry|observability|blind spot|tailsemantic|replacement signal/u.test(text)) {
      return [1, 0, 0]
    }
    if (/classicneedle|fallbackneedle|pagingneedle|diversityneedle|cache query/u.test(text)) {
      return [0, 1, 0]
    }
    return [0, 0, 1]
  }
}

describe('RetrievalService', () => {
  let directory: string
  let database: SqliteAdapter
  let domain: DomainStore
  let legacy: SearchIndexRepository
  let projection: RetrievalProjectionRepository
  let provider: DeterministicEmbeddingProvider
  let service: RetrievalService
  let services: RetrievalService[]

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'onmove-retrieval-service-'))
    database = new SqliteAdapter(join(directory, 'onmove.sqlite3'))
    runMigrations(database)
    domain = new DomainStore(database)
    legacy = new SearchIndexRepository(database)
    projection = new RetrievalProjectionRepository(database, legacy)
    provider = new DeterministicEmbeddingProvider()
    services = []
    service = createService(provider)
  })

  afterEach(() => {
    services.forEach((value) => value.dispose())
    database.close()
    rmSync(directory, { recursive: true, force: true })
  })

  function createService(embeddings: EmbeddingProvider): RetrievalService {
    const value = new RetrievalService(projection, database, embeddings)
    services.push(value)
    return value
  }

  function hierarchy(prefix: string) {
    const focus = domain.focuses.create({ title: `${prefix} Focus` }).toSnapshot()
    const thread = domain.threads.create({
      focusId: focus.id,
      title: `${prefix} Thread`,
      reviewFrequencyDays: 7
    }).snapshot()
    return { focus, thread }
  }

  it('preserves classic lexical and structured behavior without loading embeddings', async () => {
    const { focus, thread } = hierarchy('Classic')
    const update = domain.updates.create({
      parent: { type: 'thread', id: thread.id },
      observation: 'A classicneedle result from the durable FTS projection'
    }).toSnapshot()
    const expected = legacy.searchPage({
      text: 'classicneedle',
      kinds: ['update'],
      focusId: focus.id,
      limit: 10
    }, visible)

    const lexical = await service.retrieve({
      text: 'classicneedle',
      kinds: ['update'],
      focusId: focus.id,
      strategy: 'auto',
      limit: 10
    }, visible, 'classic')

    expect(lexical.items.map(({ reference }) => reference)).toEqual(
      expected.items.map(({ reference }) => reference)
    )
    expect(lexical).toMatchObject({
      appliedStrategy: 'lexical',
      semanticGeneration: null,
      semanticCoverage: null,
      fallbackReason: null
    })
    expect(lexical.items).toEqual([
      expect.objectContaining({
        reference: { type: 'update', id: update.id },
        match: expect.objectContaining({ channels: ['lexical'] })
      })
    ])

    const structured = await service.retrieve({
      text: null,
      kinds: ['update'],
      threadId: thread.id,
      sort: { field: 'updatedAt', direction: 'desc' },
      strategy: 'auto'
    }, visible, 'classic')
    expect(structured.items[0]).toMatchObject({
      reference: { type: 'update', id: update.id },
      match: { channels: ['structured'] }
    })
    expect(structured.appliedStrategy).toBe('structured')
    expect(provider.calls).toEqual([])
  })

  it('adds paraphrase-only semantic recall and reports each matching stage', async () => {
    const { thread } = hierarchy('Semantic')
    const update = domain.updates.create({
      parent: { type: 'thread', id: thread.id },
      observation: 'Telemetry coverage has material gaps'
    }).toSnapshot()
    expect(legacy.searchPage({
      text: 'monitoring blind spots', kinds: ['update'], threadId: thread.id
    }, visible).items).toEqual([])

    const page = await service.retrieve({
      text: 'monitoring blind spots',
      kinds: ['update'],
      threadId: thread.id,
      strategy: 'hybrid',
      diversifyBy: 'none'
    }, visible, 'enhanced')

    expect(page).toMatchObject({
      appliedStrategy: 'hybrid',
      fallbackReason: null,
      semanticCoverage: 1
    })
    expect(page.semanticGeneration).toBe(page.lexicalGeneration)
    expect(page.items).toEqual([
      expect.objectContaining({
        reference: { type: 'update', id: update.id },
        match: expect.objectContaining({
          channels: ['structured', 'semantic'],
          lexicalRank: null,
          semanticRank: 1,
          semanticSimilarity: expect.any(Number)
        })
      })
    ])
    expect(page.items[0].match.semanticSimilarity).toBeGreaterThanOrEqual(0.25)
  })

  it('strictly intersects Thread and Subject identity despite identical corporate language', async () => {
    const focus = domain.focuses.create({ title: 'Projects' }).toSnapshot()
    const projectA = domain.threads.create({
      focusId: focus.id, title: 'Project A', reviewFrequencyDays: 7
    }).snapshot()
    const projectB = domain.threads.create({
      focusId: focus.id, title: 'Project B', reviewFrequencyDays: 7
    }).snapshot()
    domain.focusScopes.addSubject(focus.id, { name: 'Observability' })
    const scopeA = domain.threadScopes.followFocus(projectA.id)
    const scopeB = domain.threadScopes.followFocus(projectB.id)
    const subject = scopeA.subjects[0]
    expect(scopeB.subjects[0].id).toBe(subject.id)
    const observation = 'Observability service health requires attention'
    const updateA = domain.updates.create({
      parent: { type: 'thread', id: projectA.id },
      scope: { scopeId: scopeA.scopeId as number, subjectId: subject.id },
      observation
    }).toSnapshot()
    const updateB = domain.updates.create({
      parent: { type: 'thread', id: projectB.id },
      scope: { scopeId: scopeB.scopeId as number, subjectId: subject.id },
      observation
    }).toSnapshot()

    const inProjectA = await service.retrieve({
      text: 'monitoring blind spots',
      kinds: ['update'],
      focusId: focus.id,
      threadId: projectA.id,
      subjectId: subject.id,
      strategy: 'hybrid',
      diversifyBy: 'none'
    }, visible, 'enhanced')
    const inProjectB = await service.retrieve({
      text: 'monitoring blind spots',
      kinds: ['update'],
      focusId: focus.id,
      threadId: projectB.id,
      subjectId: subject.id,
      strategy: 'hybrid',
      diversifyBy: 'none'
    }, visible, 'enhanced')

    expect(inProjectA.items.map(({ reference }) => reference)).toEqual([
      { type: 'update', id: updateA.id }
    ])
    expect(inProjectB.items.map(({ reference }) => reference)).toEqual([
      { type: 'update', id: updateB.id }
    ])
    expect(inProjectA.items[0].match.semanticSimilarity).toBe(
      inProjectB.items[0].match.semanticSimilarity
    )
  })

  it('round-robins operational lineages after relevance ranking', async () => {
    const focus = domain.focuses.create({ title: 'Lineage portfolio' }).toSnapshot()
    const projectA = domain.threads.create({
      focusId: focus.id, title: 'Project A', reviewFrequencyDays: 7
    }).snapshot()
    const projectB = domain.threads.create({
      focusId: focus.id, title: 'Project B', reviewFrequencyDays: 7
    }).snapshot()
    for (let index = 0; index < 3; index += 1) {
      domain.updates.create({
        parent: { type: 'thread', id: projectA.id },
        observation: `diversityneedle telemetry evidence ${index}`
      })
    }
    domain.updates.create({
      parent: { type: 'thread', id: projectB.id },
      observation: 'diversityneedle telemetry evidence from Project B'
    })

    const undiversified = await service.retrieve({
      text: 'diversityneedle telemetry', kinds: ['update'], focusId: focus.id,
      strategy: 'hybrid', diversifyBy: 'none', limit: 2
    }, visible, 'enhanced')
    const diversified = await service.retrieve({
      text: 'diversityneedle telemetry', kinds: ['update'], focusId: focus.id,
      strategy: 'hybrid', diversifyBy: 'lineage', limit: 2
    }, visible, 'enhanced')

    expect(undiversified.items.map(({ hierarchy }) => hierarchy.thread?.id)).toEqual([
      projectA.id, projectA.id
    ])
    expect(diversified.items.map(({ hierarchy }) => hierarchy.thread?.id)).toEqual([
      projectA.id, projectB.id
    ])
    expect(new Set(diversified.items.map(({ match }) => match.lineageKey)).size).toBe(2)
  })

  it('reuses the durable cache, invalidates only changed content, and prunes deleted sources', async () => {
    const { thread } = hierarchy('Cache')
    const retained = domain.updates.create({
      parent: { type: 'thread', id: thread.id },
      observation: 'Telemetry evidence retained across rebuilds'
    }).toSnapshot()
    const deleted = domain.updates.create({
      parent: { type: 'thread', id: thread.id },
      observation: 'Telemetry evidence that will be deleted'
    }).toSnapshot()
    const request = {
      text: 'cache query monitoring',
      kinds: ['update'] as const,
      threadId: thread.id,
      strategy: 'hybrid' as const,
      diversifyBy: 'none' as const
    }

    await service.retrieve(request, visible, 'enhanced')
    expect(provider.calls.length).toBe(2)
    provider.calls.length = 0
    await service.retrieve(request, visible, 'enhanced')
    expect(provider.calls).toEqual([['cache query monitoring']])

    service.dispose()
    provider.calls.length = 0
    service = createService(provider)
    await service.retrieve(request, visible, 'enhanced')
    expect(provider.calls).toEqual([['cache query monitoring']])

    domain.updates.requireModel(retained.id).update({
      observation: 'Telemetry replacement evidence after an edit'
    })
    domain.updates.delete(deleted.id)
    provider.calls.length = 0
    await service.retrieve(request, visible, 'enhanced')
    expect(provider.calls[0]).toEqual(['cache query monitoring'])
    expect(provider.calls.slice(1).flat()).toEqual([
      'Telemetry replacement evidence after an edit'
    ])
    const cachedKeys = database.all<{ source_key: string }>(
      `SELECT source_key FROM retrieval_embedding_cache
       WHERE model_id = ? ORDER BY source_key`,
      [provider.modelId]
    ).map(({ source_key: sourceKey }) => sourceKey)
    expect(cachedKeys).toContain(`update:${retained.id}:observation`)
    expect(cachedKeys).not.toContain(`update:${deleted.id}:observation`)
  })

  it('uses bounded content chunks so evidence at the tail contributes to one source vector', async () => {
    provider.visibleCharacterLimit = 480
    const { focus, thread } = hierarchy('Tail project')
    const filler = 'Administrative planning context '.repeat(20)
    const update = domain.updates.create({
      parent: { type: 'thread', id: thread.id },
      observation: `${filler}\n\nTailsemantic telemetry sentinel`
    }).toSnapshot()

    const page = await service.retrieve({
      text: 'tailsemantic signal', kinds: ['update'], threadId: thread.id,
      strategy: 'hybrid', diversifyBy: 'none'
    }, visible, 'enhanced')

    expect(page.items.map(({ reference }) => reference)).toEqual([
      { type: 'update', id: update.id }
    ])
    const embeddedDocumentInputs = provider.calls.slice(1).flat()
    const updateChunks = embeddedDocumentInputs.filter((text) =>
      text.includes('Administrative planning context') || text.includes('Tailsemantic'))
    expect(updateChunks.length).toBeGreaterThan(1)
    expect(updateChunks.some((text) => {
      const tailOffset = text.indexOf('Tailsemantic')
      return tailOffset >= 0 && tailOffset < (provider.visibleCharacterLimit as number)
    })).toBe(true)
    expect(updateChunks.every((text) =>
      !text.includes(focus.title) && !text.includes(thread.title))).toBe(true)
    expect(page.items[0].match.channels).toContain('semantic')
  })

  it('rebuilds a newer generation when content changes during a long embedding build', async () => {
    const { thread } = hierarchy('Generation')
    const update = domain.updates.create({
      parent: { type: 'thread', id: thread.id },
      observation: 'Initial generation evidence'
    }).toSnapshot()
    provider.onEmbed = (texts) => {
      if (!texts.some((text) => text.includes('Initial generation evidence'))) return
      provider.onEmbed = null
      domain.updates.requireModel(update.id).update({
        observation: 'Replacement signal landed during embedding'
      })
    }

    const page = await service.retrieve({
      text: 'replacement signal', kinds: ['update'], threadId: thread.id,
      strategy: 'hybrid', diversifyBy: 'none'
    }, visible, 'enhanced')

    expect(page.semanticGeneration).toBe(page.lexicalGeneration)
    expect(page.items).toEqual([
      expect.objectContaining({
        reference: { type: 'update', id: update.id },
        snippet: 'Replacement signal landed during embedding'
      })
    ])
    expect(provider.calls.flat()).toContain('Initial generation evidence')
    expect(provider.calls.flat()).toContain('Replacement signal landed during embedding')
  })

  it('uses stable fallback metadata, supports strict errors, and never restarts continuations', async () => {
    const { thread } = hierarchy('Fallback')
    domain.updates.create({
      parent: { type: 'thread', id: thread.id },
      observation: 'fallbackneedle lexical evidence one'
    })
    domain.updates.create({
      parent: { type: 'thread', id: thread.id },
      observation: 'fallbackneedle lexical evidence two'
    })
    provider.failure = new Error('private provider stack detail')

    const fallback = await service.retrieve({
      text: 'fallbackneedle', kinds: ['update'], threadId: thread.id,
      strategy: 'hybrid', onUnavailable: 'fallback', limit: 1
    }, visible, 'enhanced')
    expect(fallback).toMatchObject({
      appliedStrategy: 'lexical',
      fallbackReason: RETRIEVAL_FALLBACK_REASONS.semanticUnavailable
    })
    expect(fallback.fallbackReason).not.toContain('private provider')

    let strictError: unknown
    try {
      await service.retrieve({
        text: 'fallbackneedle', kinds: ['update'], threadId: thread.id,
        strategy: 'hybrid', onUnavailable: 'error'
      }, visible, 'enhanced')
    } catch (error) {
      strictError = error
    }
    expect(strictError).toBeInstanceOf(RetrievalStrategyUnavailableError)
    expect((strictError as Error).message).not.toContain('private provider')

    provider.failure = null
    const first = await service.retrieve({
      text: 'fallbackneedle', kinds: ['update'], threadId: thread.id,
      strategy: 'hybrid', onUnavailable: 'fallback', diversifyBy: 'none', limit: 1
    }, visible, 'enhanced')
    expect(first.nextCursor).toEqual({ type: 'ranked', offset: 1 })
    provider.failure = new Error('failure while continuing')
    await expect(service.retrieve({
      text: 'fallbackneedle', kinds: ['update'], threadId: thread.id,
      strategy: 'hybrid', onUnavailable: 'fallback', diversifyBy: 'none', limit: 1,
      cursor: first.nextCursor
    }, visible, 'enhanced')).rejects.toMatchObject({
      code: 'RETRIEVAL_STRATEGY_UNAVAILABLE'
    })

    const legacyCursor: RetrievalPageCursor = {
      type: 'legacy',
      value: legacy.searchPage({ text: 'fallbackneedle', limit: 1 }, visible).itemCursors[0]
    }
    await expect(service.retrieve({
      text: 'fallbackneedle', strategy: 'hybrid', cursor: legacyCursor
    }, visible, 'enhanced')).rejects.toThrow('cursor does not match ranked retrieval')
  })

  it('paginates a stable ranked generation without gaps or duplicates', async () => {
    const { thread } = hierarchy('Paging')
    const expectedIds = Array.from({ length: 5 }, (_, index) => domain.updates.create({
      parent: { type: 'thread', id: thread.id },
      observation: `pagingneedle telemetry evidence ${index}`
    }).toSnapshot().id)
    const seen: number[] = []
    let cursor: RetrievalPageCursor | null = null
    let generation: number | null = null
    let lastPage: RetrievalPage

    do {
      lastPage = await service.retrieve({
        text: 'pagingneedle telemetry', kinds: ['update'], threadId: thread.id,
        strategy: 'hybrid', diversifyBy: 'none', limit: 2, cursor
      }, visible, 'enhanced')
      generation ??= lastPage.lexicalGeneration
      expect(lastPage.lexicalGeneration).toBe(generation)
      expect(lastPage.semanticGeneration).toBe(generation)
      seen.push(...lastPage.items.map(({ reference }) => reference.id))
      cursor = lastPage.nextCursor
    } while (cursor !== null)

    expect(new Set(seen).size).toBe(seen.length)
    expect(new Set(seen)).toEqual(new Set(expectedIds))
    expect(lastPage).toMatchObject({ hasMore: false, nextCursor: null })
  })
})
