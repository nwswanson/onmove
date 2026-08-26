import { describe, expect, it } from 'vitest'
import {
  ORAMA_MINIMUM_SEMANTIC_SIMILARITY,
  OramaRetrievalBackend
} from '../../src/main/application/orama-retrieval-backend'
import type { RetrievalDocument } from '../../src/main/application/retrieval-backend'

function document(
  sourceKey: string,
  input: Partial<RetrievalDocument> = {}
): RetrievalDocument {
  return {
    sourceKey,
    kind: 'update',
    entityId: Number(sourceKey.match(/\d+/u)?.[0] ?? 1),
    field: 'observation',
    title: 'Project evidence',
    body: 'Routine project monitoring evidence',
    focusId: 1,
    threadId: 1,
    commitmentId: 0,
    subjectId: 1,
    scopeId: 1,
    lineageKey: 'focus:1:thread:1:commitment:0:subject:1',
    directSensitive: false,
    dueOn: '2026-08-26',
    createdAt: '2026-08-26T12:00:00.000Z',
    updatedAt: '2026-08-26T12:00:00.000Z',
    status: '',
    state: 'yellow',
    ...input
  }
}

describe('OramaRetrievalBackend', () => {
  it('searches lexical content only inside the authorized source-key allowlist', async () => {
    const backend = new OramaRetrievalBackend(3)
    const projectA = document('update:1:observation', {
      body: 'Observability found monitoring blind spots in Project A',
      threadId: 11,
      lineageKey: 'focus:1:thread:11:commitment:0:subject:1'
    })
    const projectB = document('update:2:observation', {
      body: 'Observability found monitoring blind spots in Project B',
      threadId: 12,
      lineageKey: 'focus:1:thread:12:commitment:0:subject:1'
    })
    await backend.replace({ generation: 4, documents: [projectA, projectB] })

    const page = await backend.search({
      channel: 'lexical',
      text: 'monitoring blind spots',
      filters: { sourceKeys: [projectA.sourceKey] },
      offset: 0,
      limit: 10
    })

    expect(backend.generation).toBe(4)
    expect(page).toMatchObject({
      hasMore: false,
      hits: [{ sourceKey: projectA.sourceKey, providerRank: 1 }]
    })
    expect(page.hits[0].providerScore).toBeGreaterThan(0)
  })

  it('keeps vector retrieval separate and applies structural context filters', async () => {
    const backend = new OramaRetrievalBackend(3)
    const projectA = document('update:1:observation', {
      threadId: 11,
      embedding: [1, 0, 0]
    })
    const projectB = document('update:2:observation', {
      threadId: 12,
      embedding: [0.8, 0.2, 0]
    })
    const unrelated = document('note:3:content', {
      kind: 'note',
      entityId: 3,
      field: 'content',
      threadId: 11,
      embedding: [1, 0, 0]
    })
    await backend.replace({ generation: 1, documents: [projectA, projectB, unrelated] })

    const page = await backend.search({
      channel: 'vector',
      vector: [1, 0, 0],
      filters: {
        sourceKeys: [projectA.sourceKey, projectB.sourceKey, unrelated.sourceKey],
        threadIds: [11],
        kinds: ['update']
      },
      offset: 0,
      limit: 10
    })

    expect(page.hits.map(({ sourceKey }) => sourceKey)).toEqual([projectA.sourceKey])
    expect(page.hits[0]).toMatchObject({ providerRank: 1, providerScore: 1 })
  })

  it('drops orthogonal vector noise below the conservative similarity floor', async () => {
    const backend = new OramaRetrievalBackend(3)
    const paraphrase = document('update:1:observation', { embedding: [1, 0, 0] })
    const weak = document('update:2:observation', {
      entityId: 2,
      embedding: [0.1, Math.sqrt(0.99), 0]
    })
    await backend.replace({ generation: 1, documents: [paraphrase, weak] })

    const page = await backend.search({
      channel: 'vector',
      vector: [1, 0, 0],
      filters: { sourceKeys: [paraphrase.sourceKey, weak.sourceKey] },
      offset: 0,
      limit: 10
    })

    expect(ORAMA_MINIMUM_SEMANTIC_SIMILARITY).toBeGreaterThan(0)
    expect(page.hits).toEqual([
      expect.objectContaining({ sourceKey: paraphrase.sourceKey, providerScore: 1 })
    ])
  })

  it('swaps complete generations and releases the index on disposal', async () => {
    const backend = new OramaRetrievalBackend(2)
    await backend.replace({
      generation: 1,
      documents: [document('update:1:observation', { body: 'First generation evidence' })]
    })
    await backend.replace({
      generation: 2,
      documents: [document('update:2:observation', { body: 'Second generation evidence' })]
    })

    const oldPage = await backend.search({
      channel: 'lexical', text: 'First', filters: { sourceKeys: ['update:1:observation'] },
      offset: 0, limit: 10
    })
    const newPage = await backend.search({
      channel: 'lexical', text: 'Second', filters: { sourceKeys: ['update:2:observation'] },
      offset: 0, limit: 10
    })
    expect(oldPage.hits).toEqual([])
    expect(newPage.hits).toHaveLength(1)
    expect(backend.generation).toBe(2)

    backend.dispose()
    expect(backend.generation).toBeNull()
    await expect(backend.search({
      channel: 'lexical', text: 'Second', filters: { sourceKeys: ['update:2:observation'] },
      offset: 0, limit: 10
    })).rejects.toThrow('has not been indexed')
  })

  it('validates vector dimensions, duplicate IDs, and empty allowlists', async () => {
    expect(() => new OramaRetrievalBackend(0)).toThrow('positive integer')
    const backend = new OramaRetrievalBackend(3)
    const value = document('update:1:observation', { embedding: [1, 0, 0] })
    await backend.replace({ generation: 1, documents: [value] })
    await expect(backend.replace({ generation: 2, documents: [value, value] }))
      .rejects.toThrow('duplicate retrieval sourceKey')
    expect(backend.generation).toBe(1)

    await expect(backend.search({
      channel: 'vector', vector: [1, 0], filters: { sourceKeys: [value.sourceKey] },
      offset: 0, limit: 10
    })).rejects.toThrow('exactly 3 finite numbers')
    await expect(backend.search({
      channel: 'lexical', text: 'evidence', filters: { sourceKeys: [] },
      offset: 0, limit: 10
    })).resolves.toEqual({ hits: [], hasMore: false })
    await expect(backend.search({
      channel: 'lexical', text: 'evidence',
      filters: { sourceKeys: [value.sourceKey], threadIds: [] },
      offset: 0, limit: 10
    })).resolves.toEqual({ hits: [], hasMore: false })
  })
})
